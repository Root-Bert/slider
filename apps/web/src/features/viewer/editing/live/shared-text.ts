import {
  API_PREFIX,
  LIVE_TEXT_VERSION,
  liveTextJoinSchema,
  type LiveParagraph,
  type LiveTextCaret,
} from '@slider/shared';
import {
  LOCAL,
  applyLiveChange,
  fromBase64,
  indexOfPoint,
  isEmptyUpdate,
  liveTextDoc,
  liveTextOf,
  pointOfIndex,
  readLiveText,
  rebaseLive,
  toBase64,
  type LiveTextPoint,
} from '@slider/shared/live-text';
import * as Y from 'yjs';
import { liveConnection, onLiveHello, onLiveText, setPresence } from '../../live/lib/live-store';

/** Changes that came from the others (or the server's text at a join). */
const REMOTE = 'remote';
/**
 * What was typed here carried over onto a shared text of another start (`join`): sent to the
 * others like typing, but no step for ⌘Z – taking it back would take the whole text with it.
 */
const CARRIED = 'carried';
/** Typing within this long (ms) of the last key is one step for ⌘Z. */
const TYPING_STEP_MS = 1000;
/** What was typed goes out this often at most, merged (the server allows 50 posts a second). */
const SEND_MS = 30;
/** A post that did not go through is sent again (merged with what came since) this much later. */
const RETRY_MS = 1000;
/** A join the server could not answer is tried again after this, doubling up to the max. */
const JOIN_RETRY_MS = 1000;
const JOIN_RETRY_MAX_MS = 30_000;
/**
 * A post the page may still send as it goes (`keepalive`) carries this much at most – the browser
 * allows 64 KB for all of them together; a larger one goes as a plain post.
 */
const KEEPALIVE_BYTES = 60_000;

/** A selection in the text: where it starts and ends (the same for a caret). */
export interface SharedRange {
  start: LiveTextPoint;
  end: LiveTextPoint;
}

/** A caret kept on its characters, whatever is typed around them. */
interface Caret {
  anchor: Y.RelativePosition;
  head: Y.RelativePosition;
}

/** Why what the others type waits (`hold`): composing a character, or selecting with the mouse. */
export type HoldReason = 'composing' | 'selecting';

/** What the editor hears of the shared text. */
export interface SharedTextHooks {
  /** Changed by another hand than the editor's (the others, ⌘Z, a join): it is drawn anew. */
  changed: () => void;
  /**
   * Joined (again) with what was typed here while not joined, or back after being away: the
   * shared text has this editor's text now, merged with what the others typed – the editor
   * writes it (what it wrote meanwhile had its own text only, or it held its write back).
   */
  merged: () => void;
  /**
   * What the others typed is about to come in: the editor says where its caret is right now – the
   * browser may have moved it (a key) without telling yet – so it stays on its characters.
   */
  beforeRemote: () => void;
}

/** A join's answer: the shared text (what this editor lacks of it), its start, what it has. */
interface Joined {
  update: Uint8Array;
  start: string;
  state: Uint8Array;
  /** The connection it joined on. */
  key: string;
}

/** `keepalive`: kept going as the page goes (the last posts of a text left, see `destroy`). */
const post = (path: string, body: unknown, keepalive = false) => {
  const json = JSON.stringify(body);
  return fetch(`${API_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: json,
    keepalive: keepalive && json.length < KEEPALIVE_BYTES,
  });
};

/**
 * One text typed in together (`@slider/shared/live-text`), as the inline editor uses it: the
 * editor's text is a Y.Text from the first moment – made from the file the same way the server
 * makes its own (`liveTextDoc`), so typing starts at once and the two merge once joined. What is
 * typed here goes out to the others, what they type comes in. Joined while the live stream is
 * up, again whenever it comes back; without it (offline) the editor types on its own text and
 * the file still gets it.
 */
export class SharedText {
  doc: Y.Doc;
  text: Y.Text;
  /** This editor (its text box) among those typing in the text – also another one of this tab. */
  private readonly member = crypto.randomUUID();
  /** What this text started from (`liveTextDoc`): a shared text of the same start merges in. */
  private start: string;
  /**
   * The text as the server has it, as far as this editor knows: what came from it and what it
   * took from here. A shared text of another start gets what changed here since (`carryOver`).
   */
  private shadow: Y.Doc;
  /** The look of a paragraph that lost its own (a mark deleted twice at once). */
  private readonly fallback: LiveParagraph;
  /** A member of the server's shared text right now: what is typed goes out at once. */
  private online = false;
  /** Typed here while not a member: once joined, the editor writes the merged text. */
  private typedAway = false;
  /** The server refused what was typed here (too long): this editor types on alone. */
  private refused = false;
  /** The stream connection it joined with (the last one): posts and the leave go there. */
  private key: string | null = null;
  private outgoing: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The post on its way (`flush`): the last ones wait for it as the editor goes (`destroy`). */
  private sending: Promise<void> | null = null;
  /** Each join gets the next number: an answer to an older one is not taken. */
  private joins = 0;
  /** Joins asked and not answered yet: what comes in meanwhile waits for their text (`pending`). */
  private joining = 0;
  private joinRetry: { timer: ReturnType<typeof setTimeout> | null; delay: number } = {
    timer: null,
    delay: JOIN_RETRY_MS,
  };
  /**
   * What the others typed while a join was on its way: the server relays to a member from its
   * join on, before its answer is here – applied after the join's text (twice is harmless).
   */
  private pending: Uint8Array[] = [];
  /** Why what the others type waits right now (`hold`), and what came meanwhile. */
  private readonly holds = new Set<HoldReason>();
  private held: Uint8Array[] = [];
  /** Changed by another hand while held without an update held (⌘Z): drawn once released. */
  private changedWhileHeld = false;
  /**
   * A join answered with a shared text of another start while held: taken up – this text swapped
   * for it – once released; what the others type meanwhile is kept with it (`updates`).
   */
  private heldJoin: (Joined & { updates: Uint8Array[] }) | null = null;
  /** Taking a step back or forth, or swapping texts: the editor hears of it once, after. */
  private quiet = false;
  private readonly listeners = new Set<() => void>();
  private undo: Y.UndoManager;
  private caret: Caret | null = null;
  /** A caret of this editor is shown to the others: taken away as it goes. */
  private shown = false;
  private readonly stop: (() => void)[] = [];
  private destroyed = false;

  constructor(
    private readonly deckId: string,
    readonly elementId: string,
    /** The paragraphs typing starts from (`typedParagraphs` of the element in the file). */
    paragraphs: readonly LiveParagraph[],
    private readonly hooks: SharedTextHooks,
  ) {
    const { doc, start } = liveTextDoc(paragraphs);
    this.doc = doc;
    this.text = liveTextOf(doc);
    this.start = start;
    // The server makes the same start, so it has at least that.
    this.shadow = liveTextDoc(paragraphs).doc;
    this.fallback = paragraphs[0] as LiveParagraph;
    this.undo = this.bind();
    this.stop.push(
      onLiveText(elementId, (update) => this.receive(fromBase64(update))),
      // The stream came back: joined anew – the server let go of this editor with the old one.
      onLiveHello(() => void this.join()),
    );
    void this.join();
  }

  /** A member of the shared text right now: what is typed here is in it. */
  get joined(): boolean {
    return this.online;
  }

  /**
   * Joined once and not now (the stream dropped): it joins again, bringing what was typed
   * meanwhile itself – the editor waits with its writes till then (`InlineTextEditor`).
   */
  get away(): boolean {
    return this.key !== null && !this.online && !this.refused;
  }

  /** Hears of every change of the text, by any hand (the others' carets move with it). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bind(): Y.UndoManager {
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Typed here, taken back (⌘Z) or carried over: to the others.
      if (origin !== REMOTE) this.queue(update);
    });
    this.text.observe((event) => {
      if (this.quiet) return;
      if (event.transaction.origin !== LOCAL) this.notify();
      for (const listener of this.listeners) listener();
    });
    // ⌘Z takes back what was typed here only, never what the others typed – and puts the caret
    // back where it was before that step (`step`).
    const undo = new Y.UndoManager(this.text, {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: TYPING_STEP_MS,
    });
    undo.on('stack-item-added', ({ stackItem }: { stackItem: { meta: Map<string, unknown> } }) => {
      if (this.caret && !stackItem.meta.has('caret')) stackItem.meta.set('caret', this.caret);
    });
    return undo;
  }

  /** The editor hears of a change by another hand – once released, while held. */
  private notify(): void {
    if (this.holds.size === 0) this.hooks.changed();
    else this.changedWhileHeld = true;
  }

  /** After a quiet change: the editor and the listeners hear of it once. */
  private notifyAll(): void {
    this.notify();
    for (const listener of this.listeners) listener();
  }

  /** What the others typed: into what the server is known to have, and into the text – or held. */
  private takeRemote(updates: Uint8Array[]): void {
    if (updates.length === 0) return;
    const update = Y.mergeUpdates(updates);
    Y.applyUpdate(this.shadow, update, REMOTE);
    if (this.holds.size > 0) this.held.push(update);
    else this.applyRemote(update);
  }

  /** The others' update into the text, the editor's caret taken where it is first. */
  private applyRemote(update: Uint8Array): void {
    this.hooks.beforeRemote();
    Y.applyUpdate(this.doc, update, REMOTE);
  }

  /**
   * Joins the others typing in the text (again, after the stream or the server let go of it):
   * their text comes in, what was typed here meanwhile goes out. `false` when it cannot – typing
   * goes on here; it joins again once the stream is back, or tries again after a while when the
   * server could not answer.
   */
  async join(): Promise<boolean> {
    const connection = liveConnection();
    if (this.destroyed || this.refused || !connection || connection.deckId !== this.deckId) {
      return false;
    }
    if (this.joinRetry.timer) clearTimeout(this.joinRetry.timer);
    this.joinRetry.timer = null;
    const attempt = (this.joins += 1);
    this.online = false;
    this.heldJoin = null;
    this.joining += 1;
    let answer: Joined | 'retry' | null;
    try {
      const response = await post(`${this.textPath(connection.key)}/join`, {
        version: LIVE_TEXT_VERSION,
        member: this.member,
        start: this.start,
        state: toBase64(Y.encodeStateVector(this.doc)),
      });
      if (response.ok) {
        const joined = liveTextJoinSchema.parse(await response.json());
        answer = {
          update: fromBase64(joined.update),
          start: joined.start,
          state: fromBase64(joined.state),
          key: connection.key,
        };
      } else {
        // Busy or failing: again later. Refused (not allowed, another version): typing alone.
        answer = response.status === 429 || response.status >= 500 ? 'retry' : null;
      }
    } catch {
      answer = 'retry';
    } finally {
      this.joining -= 1;
    }
    if (this.destroyed) {
      // Gone meanwhile: the server has it as typing in the text – let go of it again.
      if (answer !== null && answer !== 'retry') void this.leave(connection.key);
      return false;
    }
    // Overtaken by a later join (the same editor to the server): that one's answer counts.
    if (attempt !== this.joins) return false;
    if (answer === null || answer === 'retry') {
      this.pending = [];
      if (answer === 'retry') this.retryJoin();
      else {
        // Turned down for good (no longer allowed, another version of this): typing on alone,
        // written as usual – not away, waiting to join again.
        this.refused = true;
        this.hideCaret();
      }
      return false;
    }
    this.joinRetry.delay = JOIN_RETRY_MS;
    const updates = [answer.update, ...this.pending];
    this.pending = [];
    // Another start while held: swapping the text now would pull it from under the composition
    // or the selection – taken up once released, nothing sent before (it is not joined yet).
    if (answer.start !== this.start && this.holds.size > 0) {
      this.key = answer.key;
      this.heldJoin = { ...answer, updates };
      return true;
    }
    this.takeUp(answer, updates);
    return true;
  }

  /**
   * Takes up a join's answer: the shared text in (merged, or carried over onto when of another
   * start), then joined – what the server lacks goes out, the caret shows.
   */
  private takeUp(joined: Joined, updates: Uint8Array[]): void {
    // Back after being away: a write the editor held back meanwhile goes out now (`merged`).
    const back = this.key !== null;
    let carried = false;
    if (joined.start === this.start) this.takeRemote(updates);
    else carried = this.carryOver(joined.start, updates);
    this.key = joined.key;
    this.online = true;
    // What the server lacks – typed before joining, or while away – goes out now.
    const lacking = Y.encodeStateAsUpdate(this.doc, joined.state);
    this.outgoing = isEmptyUpdate(lacking) ? [] : [lacking];
    this.schedule(0);
    this.publishCaret();
    if (this.typedAway || carried || back) this.hooks.merged();
    this.typedAway = false;
  }

  /** The server could not answer a join: tried again later, waiting longer each time. */
  private retryJoin(): void {
    if (this.joinRetry.timer || this.destroyed) return;
    const delay = this.joinRetry.delay;
    this.joinRetry.delay = Math.min(delay * 2, JOIN_RETRY_MAX_MS);
    this.joinRetry.timer = setTimeout(() => {
      this.joinRetry.timer = null;
      void this.join();
    }, delay);
  }

  /**
   * The shared text started from another text than this one (the file changed before it joined,
   * or the server made it anew from a file saved since): this text is swapped for it, and what
   * changed here since the server last had it (`shadow`) is made in it – what changed there
   * stays. `true` when that changed the shared text.
   */
  private carryOver(start: string, updates: Uint8Array[]): boolean {
    // Held while composing or selecting (they are in `shadow` already): this text has them too,
    // or they would count as deleted here.
    this.quiet = true;
    try {
      if (this.held.length > 0) Y.applyUpdate(this.doc, Y.mergeUpdates(this.held), REMOTE);
    } finally {
      this.quiet = false;
    }
    this.held = [];
    const agreed = readLiveText(liveTextOf(this.shadow), this.fallback);
    const mine = this.read();
    this.undo.destroy();
    this.doc.destroy();
    this.shadow.destroy();
    this.doc = new Y.Doc();
    this.text = liveTextOf(this.doc);
    this.shadow = new Y.Doc();
    this.undo = this.bind();
    this.start = start;
    this.caret = null;
    this.quiet = true;
    let carried: boolean;
    try {
      const update = Y.mergeUpdates(updates);
      Y.applyUpdate(this.doc, update, REMOTE);
      Y.applyUpdate(this.shadow, update, REMOTE);
      const theirs = this.read();
      const before = Y.encodeStateVector(this.doc);
      applyLiveChange(this.text, rebaseLive(agreed, mine, theirs, this.fallback), CARRIED);
      carried = !isEmptyUpdate(Y.encodeStateAsUpdate(this.doc, before));
    } finally {
      this.quiet = false;
    }
    this.notifyAll();
    return carried;
  }

  /** The text as paragraphs. */
  read(): LiveParagraph[] {
    return readLiveText(this.text, this.fallback);
  }

  /** The editor's text became `after` (typed, formatted): only what differs is written. */
  change(after: readonly LiveParagraph[]): void {
    applyLiveChange(this.text, after);
    if (!this.online) this.typedAway = true;
  }

  /** What changes next is a step of its own for ⌘Z (formatting is; typing goes on in one). */
  endStep(): void {
    this.undo.captureTimeout = TYPING_STEP_MS;
    this.undo.stopCapturing();
  }

  /** The steps there were when {@link holdStep} began one, while it lasts. */
  private heldFrom: number | null = null;

  /**
   * What changes from now until {@link endStep} or {@link dropStep} is one step for ⌘Z, however
   * long it takes (fonts tried on while a list is stepped through).
   */
  holdStep(): void {
    this.endStep();
    this.heldFrom = this.undo.undoStack.length;
    this.undo.captureTimeout = Number.POSITIVE_INFINITY;
  }

  /** Takes back what changed since {@link holdStep}, leaving nothing to redo; `false`: nothing did. */
  dropStep(): boolean {
    const from = this.heldFrom;
    this.heldFrom = null;
    this.endStep();
    if (from === null || this.undo.undoStack.length <= from) return false;
    const redoable = this.undo.redoStack.length;
    if (!this.step('undo')) return false;
    this.undo.redoStack.length = redoable;
    return true;
  }

  /** One step of what was typed here back (⌘Z) or forth (⇧⌘Z); `false` when there is none. */
  step(direction: 'undo' | 'redo'): boolean {
    this.quiet = true;
    let item;
    try {
      item = direction === 'undo' ? this.undo.undo() : this.undo.redo();
    } finally {
      this.quiet = false;
    }
    if (!item) return false;
    // The caret where it was before that step – drawn with it.
    const caret = item.meta.get('caret') as Caret | undefined;
    if (caret) this.caret = caret;
    this.publishCaret();
    this.notifyAll();
    return true;
  }

  /** What the others type waits (`reason`): composing a character, selecting with the mouse. */
  hold(reason: HoldReason): void {
    this.holds.add(reason);
  }

  /** That reason is gone: once none is left, what came meanwhile goes in, drawn once. */
  release(reason: HoldReason): void {
    if (!this.holds.delete(reason) || this.holds.size > 0) return;
    const joined = this.heldJoin;
    const changed = this.changedWhileHeld;
    this.heldJoin = null;
    this.changedWhileHeld = false;
    // A text of another start taken up: what was held goes into the old one first (`carryOver`).
    if (joined) {
      this.takeUp(joined, joined.updates);
      return;
    }
    const held = this.held;
    this.held = [];
    if (held.length > 0) this.applyRemote(Y.mergeUpdates(held));
    else if (changed) this.hooks.changed();
  }

  /**
   * Where this editor's caret is: kept on its characters, and shown to the others. `start` is
   * where the selection began (its anchor), `end` where it is moved (its head) – backwards too.
   */
  setCaret(range: SharedRange | null): void {
    if (!range) {
      this.caret = null;
      this.publishCaret();
      return;
    }
    const start = indexOfPoint(this.text, range.start);
    const end = indexOfPoint(this.text, range.end);
    // A caret holds on to the character before it (what was just typed here): someone typing at
    // the same place goes before or after that word, never in between its letters (a caret held
    // to the character after it moved behind each of theirs – both words interleaved). A
    // selection keeps what the others type at its edges outside it.
    const position = (index: number, isStart: boolean) =>
      Y.createRelativePositionFromTypeIndex(this.text, index, start === end || !isStart ? -1 : 0);
    this.caret = {
      anchor: position(start, start <= end),
      head: position(end, end < start),
    };
    this.publishCaret();
  }

  /** The caret shown to the others – once joined. */
  private publishCaret(): void {
    if (!this.online) return;
    this.shown = this.caret !== null;
    setPresence({
      textCaret: this.caret && {
        elementId: this.elementId,
        anchor: toBase64(Y.encodeRelativePosition(this.caret.anchor)),
        head: toBase64(Y.encodeRelativePosition(this.caret.head)),
      },
    });
  }

  /** No caret shown to the others any more (gone, or typing on alone). */
  private hideCaret(): void {
    if (this.shown) setPresence({ textCaret: null });
    this.shown = false;
  }

  /** This editor's caret where its characters are now (after the others typed, or ⌘Z). */
  caretRange(): SharedRange | null {
    if (!this.caret) return null;
    const start = this.pointOf(this.caret.anchor);
    const end = this.pointOf(this.caret.head);
    return start && end ? { start, end } : null;
  }

  /** Where someone else's caret is, in this text (`null`: not in it, or not known here). */
  rangeOf(caret: LiveTextCaret): SharedRange | null {
    if (caret.elementId !== this.elementId) return null;
    try {
      const start = this.pointOf(Y.decodeRelativePosition(fromBase64(caret.anchor)));
      const end = this.pointOf(Y.decodeRelativePosition(fromBase64(caret.head)));
      return start && end ? { start, end } : null;
    } catch {
      return null;
    }
  }

  private pointOf(position: Y.RelativePosition): LiveTextPoint | null {
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, this.doc);
    return absolute && absolute.type === this.text ? pointOfIndex(this.text, absolute.index) : null;
  }

  /** Done typing: the others see the caret go, the server lets go of the text once all left. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const stop of this.stop) stop();
    if (this.timer) clearTimeout(this.timer);
    if (this.joinRetry.timer) clearTimeout(this.joinRetry.timer);
    this.timer = null;
    // Also when no longer joined: the caret it showed would stay with the others.
    this.hideCaret();
    void this.finish();
  }

  /**
   * The last of it, after `destroy`: the post on its way first, then what was typed since (the
   * last keys), then the leave – in this order, or the server could let go of the text before
   * the last keys reached it. These keep going as the page goes (`keepalive`).
   */
  private async finish(): Promise<void> {
    await this.sending;
    const key = this.key;
    if (key) {
      if (this.online && this.outgoing.length > 0) {
        const update = Y.mergeUpdates(this.outgoing);
        this.outgoing = [];
        await post(this.textPath(key), { member: this.member, update: toBase64(update) }, true)
          .then(() => {})
          .catch(() => {});
      }
      await this.leave(key);
    }
    this.undo.destroy();
    this.doc.destroy();
    this.shadow.destroy();
  }

  private leave(key: string): Promise<void> {
    return post(`${this.textPath(key)}/leave`, { member: this.member }, true)
      .then(() => {})
      .catch(() => {});
  }

  private textPath(key: string): string {
    return `/live/${encodeURIComponent(key)}/text/${encodeURIComponent(this.elementId)}`;
  }

  private receive(update: Uint8Array): void {
    if (this.destroyed) return;
    if (this.heldJoin) this.heldJoin.updates.push(update);
    else if (this.online) this.takeRemote([update]);
    // A join on its way: this belongs after its text. Otherwise not a member – nothing to keep.
    else if (this.joining > 0) this.pending.push(update);
  }

  /** Not joined, nothing is kept to send: the join sends what the server lacks. */
  private queue(update: Uint8Array): void {
    if (!this.online) return;
    this.outgoing.push(update);
    this.schedule(SEND_MS);
  }

  private schedule(delay: number): void {
    if (this.timer || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }

  /** Sends what waits, merged – one post at a time; after `destroy` only `finish` sends. */
  private flush(): void {
    if (this.destroyed || this.sending || !this.online || !this.key || this.outgoing.length === 0)
      return;
    const update = Y.mergeUpdates(this.outgoing);
    this.outgoing = [];
    // Once taken, the server has all this text has now that `shadow` lacks – also what went out
    // before and was taken though its answer got lost.
    const known = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.shadow));
    const sending = this.send(this.key, update, { doc: this.doc, known });
    this.sending = sending;
    void sending.finally(() => {
      if (this.sending === sending) this.sending = null;
    });
  }

  private async send(
    key: string,
    update: Uint8Array,
    from: { doc: Y.Doc; known: Uint8Array },
  ): Promise<void> {
    let outcome: 'sent' | 'retry' | 'rejoin' | 'refused';
    let status = 0;
    try {
      const response = await post(this.textPath(key), {
        member: this.member,
        update: toBase64(update),
      });
      status = response.status;
      outcome = response.ok
        ? 'sent'
        : // The server forgot it (restarted, or the stream reconnected).
          status === 404
          ? 'rejoin'
          : // Too many at once, or the server or the network failing: again in a moment.
            status === 429 || status >= 500
            ? 'retry'
            : 'refused';
    } catch {
      outcome = 'retry';
    }
    // The text was swapped meanwhile (carried over): this belonged to the old one – the join that
    // swapped it sent what the server lacks.
    if (from.doc !== this.doc) {
      if (!this.destroyed) this.schedule(SEND_MS);
      return;
    }
    if (outcome === 'sent') Y.applyUpdate(this.shadow, from.known, REMOTE);
    else if (outcome === 'retry') this.outgoing.unshift(update);
    else if (outcome === 'refused') {
      // Not taken, and what follows builds on it – the others would never see it. This editor
      // types on alone: the file still gets its text, the others get it with their next join.
      console.warn(`Live text update refused (${status}): typing on alone`);
      this.refused = true;
      this.outgoing = [];
    }
    // Not a member any more: nothing goes out until joined again (nor from `finish`).
    if (outcome === 'rejoin' || outcome === 'refused') this.online = false;
    if (this.destroyed) return;
    if (outcome === 'refused') {
      this.hideCaret();
      this.key = null;
      void this.leave(key);
    } else if (outcome === 'rejoin') {
      // Joined again: the join sends all the server lacks.
      void this.join();
    } else if (outcome === 'retry') {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, RETRY_MS);
    } else if (this.outgoing.length > 0) this.schedule(SEND_MS);
  }
}
