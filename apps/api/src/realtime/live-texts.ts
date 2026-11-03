import { MAX_ELEMENT_TEXT, type LiveParagraph } from '@slider/shared';
import {
  applyLiveChange,
  fromBase64,
  isEmptyUpdate,
  liveTextDoc,
  liveTextOf,
  readLiveText,
  rebaseLive,
  toBase64,
  updateHasGaps,
} from '@slider/shared/live-text';
import * as Y from 'yjs';
import type { LiveHub } from './live-hub';

/**
 * Updates one connection may post per second to texts typed in together; the client sends at
 * most one per 30 ms. Posts beyond this are refused (429): the client sends them again, merged.
 */
export const LIVE_TEXT_POSTS_PER_SECOND = 50;

/**
 * The longest a text typed in together may get (UTF-16 units of its Y.Text): the most an element
 * holds in the file, its paragraph marks and line breaks with room to spare – the editor keeps to
 * the file's limit, an update beyond this one is refused.
 */
export const MAX_LIVE_TEXT_LENGTH = 2 * MAX_ELEMENT_TEXT;

/**
 * How long a shared text stays once the last one typing in it left: a reload, a dropped stream
 * or clicking out and back in joins the same one again (its carets and what was typed meanwhile
 * merge) instead of one made anew from the file.
 */
export const LIVE_TEXT_GRACE_MS = 30_000;

/** The origin of what the server writes into a shared text (the file changed under it). */
const FROM_FILE = 'file';

/** A text typed in together: its shared Y document and who types in it. */
interface Session {
  deckId: string;
  elementId: string;
  doc: Y.Doc;
  /** What it started from (`liveTextDoc`): editors who started from the same merge into it. */
  start: string;
  /** The editors typing in it (`member`) and the connection each is on (its secret key). */
  members: Map<string, string>;
  /** Everyone left: it goes when this runs out, unless someone joins again before. */
  expiry: ReturnType<typeof setTimeout> | null;
}

/** What became of an update posted (`update`). */
export type LiveTextUpdateOutcome = 'ok' | 'gone' | 'busy' | 'invalid' | 'too_long';

/**
 * Texts typed in by several people at once (the live editor), in the API process like the
 * {@link LiveHub} – kept while someone types in them, and a little longer
 * ({@link LIVE_TEXT_GRACE_MS}). The first one to start makes the shared text from the file;
 * everyone after gets it as it is by then. An update goes into the shared text and on to the
 * others typing in it, never to anyone else (guests reading along see the text once it is saved).
 * The file is written by the editors themselves (`setRichText`); when another hand changes it
 * (an undo, the AI), {@link fileChanged} writes that into the shared text.
 */
export class LiveTexts {
  private readonly sessions = new Map<string, Session>();
  /** Session ids by deck – who to look at when a deck's file changed. */
  private readonly byDeck = new Map<string, Set<string>>();
  private readonly posts = new Map<string, { since: number; count: number }>();
  private readonly unsubscribe: (() => void)[];

  constructor(
    private readonly hub: LiveHub,
    private readonly now: () => number = Date.now,
    private readonly graceMs: number = LIVE_TEXT_GRACE_MS,
  ) {
    this.unsubscribe = [hub.onLeave((key) => this.leaveAll(key)), hub.onClose(() => this.close())];
  }

  /**
   * Starts typing in an element with the others (or picks it up again): the shared text, made
   * from `paragraphs` (the file's) when nobody types in it yet. The editor started its own text
   * from `start` and has `state` of it: from the same start only what it lacks comes back, from
   * another (the file changed meanwhile) all of it – the editor carries its typing over. `member`
   * names the editor (its text box) on the connection `key`. `null` when the connection is gone,
   * `invalid` when `state` is no state vector.
   */
  async join(
    key: string,
    elementId: string,
    paragraphs: () => Promise<readonly LiveParagraph[]>,
    editor: { member: string; start: string; state: string },
  ): Promise<{ update: string; start: string; state: string } | null | 'invalid'> {
    let vector: Uint8Array;
    try {
      vector = fromBase64(editor.state);
      Y.decodeStateVector(vector);
    } catch {
      return 'invalid';
    }
    const connection = this.hub.connectionOf(key);
    if (!connection) return null;
    const id = sessionId(connection.deckId, elementId);
    let session = this.sessions.get(id);
    if (!session) {
      const loaded = await paragraphs();
      // Someone else started meanwhile (`paragraphs` waited for the file): theirs counts.
      session = this.sessions.get(id);
      if (!session) {
        const { doc, start } = liveTextDoc(loaded);
        session = {
          deckId: connection.deckId,
          elementId,
          doc,
          start,
          members: new Map(),
          expiry: null,
        };
        this.sessions.set(id, session);
        const ofDeck = this.byDeck.get(connection.deckId) ?? new Set();
        ofDeck.add(id);
        this.byDeck.set(connection.deckId, ofDeck);
      }
    }
    // Gone while the file was read: nothing to keep for it (one made for it goes after a while).
    if (!this.hub.connectionOf(key)) {
      if (session.members.size === 0) this.expire(id, session);
      return null;
    }
    if (session.expiry) clearTimeout(session.expiry);
    session.expiry = null;
    session.members.set(editor.member, key);
    const update =
      editor.start === session.start
        ? Y.encodeStateAsUpdate(session.doc, vector)
        : Y.encodeStateAsUpdate(session.doc);
    return {
      update: toBase64(update),
      start: session.start,
      state: toBase64(Y.encodeStateVector(session.doc)),
    };
  }

  /**
   * What one typed: into the shared text and on to the others typing in it. `gone` when that
   * editor does not type in the element (not joined, or gone – it joins again); `invalid` when it
   * is no Y update; `too_long` when it would make the text longer than {@link MAX_LIVE_TEXT_LENGTH}.
   */
  update(key: string, member: string, elementId: string, update: string): LiveTextUpdateOutcome {
    const connection = this.hub.connectionOf(key);
    const session = connection && this.sessions.get(sessionId(connection.deckId, elementId));
    if (!connection || session?.members.get(member) !== key) return 'gone';
    if (!this.admit(key)) return 'busy';
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(update);
    } catch {
      return 'invalid';
    }
    // Building on what the text does not have: it would wait in it forever (and grow it) – no
    // editor sends that, an update goes out after what it builds on.
    try {
      if (updateHasGaps(session.doc, bytes)) return 'invalid';
    } catch {
      return 'invalid';
    }
    // An update inserts at most a character per byte: only one that might go past the limit (or
    // with updates still waiting for what they build on) is tried on a copy first – so deleting
    // in a full text still works, and an everyday keystroke costs no copy.
    const length = liveTextOf(session.doc).length;
    if (length + bytes.length > MAX_LIVE_TEXT_LENGTH || session.doc.store.pendingStructs) {
      const probe = new Y.Doc();
      try {
        Y.applyUpdate(probe, Y.encodeStateAsUpdate(session.doc));
        Y.applyUpdate(probe, bytes);
        if (liveTextOf(probe).length > MAX_LIVE_TEXT_LENGTH) return 'too_long';
      } catch {
        return 'invalid';
      } finally {
        probe.destroy();
      }
    }
    try {
      Y.applyUpdate(session.doc, bytes);
    } catch {
      return 'invalid';
    }
    // Not back to its own tab (another text box there on the same text is on its way out).
    const others = new Set([...session.members.values()].filter((other) => other !== key));
    this.hub.sendTo(others, { type: 'text', elementId, update });
    return 'ok';
  }

  /**
   * An editor stops typing in an element (only that one – one opened again meanwhile in the same
   * tab stays); the shared text goes a while after nobody types in it.
   */
  leave(key: string, member: string, elementId: string): void {
    const connection = this.hub.connectionOf(key);
    const id = connection && sessionId(connection.deckId, elementId);
    const session = id && this.sessions.get(id);
    if (!id || !session || session.members.get(member) !== key) return;
    session.members.delete(member);
    if (session.members.size === 0) this.expire(id, session);
  }

  /** Every editor of a connection stops typing (it went, or may no longer edit the deck). */
  leaveAll(key: string): void {
    for (const [id, session] of [...this.sessions]) {
      let left = false;
      for (const [member, on] of session.members) {
        if (on !== key) continue;
        session.members.delete(member);
        left = true;
      }
      if (left && session.members.size === 0) this.expire(id, session);
    }
    this.posts.delete(key);
  }

  /** The connection types in some text right now. */
  typesIn(key: string): boolean {
    for (const session of this.sessions.values()) {
      for (const on of session.members.values()) if (on === key) return true;
    }
    return false;
  }

  /** Who types in an element right now (tests, diagnostics). */
  members(deckId: string, elementId: string): number {
    return this.sessions.get(sessionId(deckId, elementId))?.members.size ?? 0;
  }

  /** Elements of a deck with a shared text right now (also those kept a while after). */
  elementsOf(deckId: string): string[] {
    return [...(this.byDeck.get(deckId) ?? [])].flatMap((id) => {
      const session = this.sessions.get(id);
      return session ? [session.elementId] : [];
    });
  }

  /**
   * Another hand than the typing changed an element's text in the deck's file (an undo, the AI,
   * the format panel): from `was` to `now`. That change is made in the shared text – merged three
   * ways with what was typed there since the file last had it, which stays – as a change of the
   * server's own, and goes to everyone typing in it like an update of theirs, so their editors
   * show it and do not write their older text back over it. Nothing when there is nothing to do.
   */
  fileChanged(
    deckId: string,
    elementId: string,
    was: readonly LiveParagraph[] | null,
    now: readonly LiveParagraph[],
  ): void {
    const session = this.sessions.get(sessionId(deckId, elementId));
    const fallback = now[0];
    if (!session || !fallback) return;
    const text = liveTextOf(session.doc);
    const typed = readLiveText(text, fallback);
    const vector = Y.encodeStateVector(session.doc);
    applyLiveChange(text, was ? rebaseLive(was, typed, now, fallback) : now, FROM_FILE);
    const update = Y.encodeStateAsUpdate(session.doc, vector);
    if (isEmptyUpdate(update)) return;
    this.hub.sendTo(new Set(session.members.values()), {
      type: 'text',
      elementId,
      update: toBase64(update),
    });
  }

  /** Shutdown (or a test's end): every shared text goes, its timer with it. */
  close(): void {
    for (const session of this.sessions.values()) {
      if (session.expiry) clearTimeout(session.expiry);
      session.doc.destroy();
    }
    this.sessions.clear();
    this.byDeck.clear();
    this.posts.clear();
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
  }

  /** Nobody types in it any more: it goes after {@link graceMs}, unless someone joins again. */
  private expire(id: string, session: Session): void {
    if (session.expiry) clearTimeout(session.expiry);
    session.expiry = setTimeout(() => {
      if (this.sessions.get(id) !== session || session.members.size > 0) return;
      session.doc.destroy();
      this.sessions.delete(id);
      const ofDeck = this.byDeck.get(session.deckId);
      ofDeck?.delete(id);
      if (ofDeck?.size === 0) this.byDeck.delete(session.deckId);
    }, this.graceMs);
    // A timer of its own keeps no process (or test run) from ending.
    (session.expiry as { unref?: () => void }).unref?.();
  }

  private admit(key: string): boolean {
    const now = this.now();
    const posts = this.posts.get(key) ?? { since: now, count: 0 };
    if (now - posts.since >= 1_000) {
      posts.since = now;
      posts.count = 0;
    }
    posts.count += 1;
    this.posts.set(key, posts);
    return posts.count <= LIVE_TEXT_POSTS_PER_SECOND;
  }
}

const sessionId = (deckId: string, elementId: string) => `${deckId}\u0000${elementId}`;
