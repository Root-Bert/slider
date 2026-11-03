import type { LiveParagraph, LiveTextStyle } from '@slider/shared';
import {
  fromBase64,
  liveTextDoc,
  liveTextOf,
  readLiveText,
  toBase64,
} from '@slider/shared/live-text';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { SharedText } from './shared-text';

// The live stream, as one tab per editor: the connection a SharedText is made in is its own.
const stream = vi.hoisted(() => ({
  key: 'a',
  listeners: new Map<string, (update: string) => void>(),
}));
vi.mock('../../live/lib/live-store', () => ({
  liveConnection: () => ({ deckId: 'deck', key: stream.key }),
  onLiveText: (_elementId: string, listener: (update: string) => void) => {
    stream.listeners.set(stream.key, listener);
    return () => {};
  },
  onLiveHello: () => () => {},
  setPresence: () => {},
}));

const style: LiveTextStyle = {
  font: 'Calibri',
  size: 20,
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
};
const paragraph = (text: string): LiveParagraph => ({
  runs: [{ ...style, text }],
  mark: style,
  align: 'left',
  fontIndependent: true,
  lineSpacing: { type: 'proportional', value: 1 },
  spaceBefore: 0,
  spaceAfter: 0,
  marginLeft: 0,
  indent: 0,
  level: 0,
  bullet: null,
});
const textOf = (paragraphs: readonly LiveParagraph[]) =>
  paragraphs.map((item) => item.runs.map((run) => run.text).join('')).join('\n');

/** The server's side (`LiveTexts`): one shared text, made from the file by the first to join. */
const server = {
  file: [paragraph('Titel')],
  doc: null as Y.Doc | null,
  start: '',
  members: new Set<string>(),
};

async function answer(url: string, init: RequestInit): Promise<Response> {
  const [, , key, , , action] = new URL(url, 'http://x').pathname.replace('/api', '').split('/');
  const body = JSON.parse(String(init.body)) as { start?: string; state?: string; update?: string };
  if (action === 'join') {
    if (!server.doc) ({ doc: server.doc, start: server.start } = liveTextDoc(server.file));
    server.members.add(key!);
    const update =
      body.start === server.start
        ? Y.encodeStateAsUpdate(server.doc, fromBase64(body.state!))
        : Y.encodeStateAsUpdate(server.doc);
    return Response.json({
      update: toBase64(update),
      start: server.start,
      state: toBase64(Y.encodeStateVector(server.doc)),
    });
  }
  if (action === 'leave') {
    server.members.delete(key!);
    if (server.members.size === 0) server.doc = null;
    return new Response(null, { status: 204 });
  }
  if (!server.doc || !server.members.has(key!)) return new Response(null, { status: 404 });
  Y.applyUpdate(server.doc, fromBase64(body.update!));
  for (const member of server.members) {
    if (member !== key) stream.listeners.get(member)?.(body.update!);
  }
  return new Response(null, { status: 204 });
}

/**
 * Answers held back until let go (`gate`): the server has done its part, the answer is still on
 * its way – a join's, or a text post's.
 */
const holds: { join: Promise<void> | null; text: Promise<void> | null } = {
  join: null,
  text: null,
};
function gate(kind: keyof typeof holds): () => void {
  let open = () => {};
  holds[kind] = new Promise((resolve) => {
    open = resolve;
  });
  return () => {
    holds[kind] = null;
    open();
  };
}
/** Every post made, by its path's last part (`join`, `leave`, or the element's for a text). */
const posts: string[] = [];
/** A status the server answers text posts with instead (`null`: as it would). */
let refuse: number | null = null;

/**
 * An editor typing in the text, in a tab of its own (`key`): opened on the file as it is now,
 * joining the others on its own right away.
 */
function editor(key: string, opened = server.file) {
  stream.key = key;
  let shown = opened;
  let merges = 0;
  const shared: SharedText = new SharedText('deck', 'title', opened, {
    changed: () => {
      shown = shared.read();
    },
    merged: () => (merges += 1),
    beforeRemote: () => {},
  });
  return {
    shared,
    text: () => textOf(shown),
    /** How often it was told to write the text merged with the others'. */
    merges: () => merges,
    /** Its join (made as it opened) answered. */
    async joined() {
      await vi.advanceTimersByTimeAsync(0);
      shown = shared.read();
    },
    type(next: string) {
      // Its tab acts: a join it makes on its own (after a 404) is in its connection.
      stream.key = key;
      const after = [paragraph(next)];
      shared.change(after);
      shown = after;
    },
  };
}

const serverText = () =>
  server.doc ? textOf(readLiveText(liveTextOf(server.doc), server.file[0]!)) : null;

/** A fresh server and stream, for the next scenario. */
function reset() {
  holds.join = null;
  holds.text = null;
  posts.length = 0;
  refuse = null;
  server.file = [paragraph('Titel')];
  server.doc = null;
  server.members.clear();
  stream.listeners.clear();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const action = url.split('/').at(-1)!;
    posts.push(action);
    if (refuse && action === 'title') return new Response(null, { status: refuse });
    const response = await answer(url, init);
    const held = action === 'join' ? holds.join : action === 'leave' ? null : holds.text;
    if (held) await held;
    return response;
  });
  reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('typing in one text together, as the editor does', () => {
  it('merges what two type at the same moment, and ⌘Z takes back only its own typing', async () => {
    {
      // merges what two type at the same moment – both see all of it
      const anna = editor('a');
      const ben = editor('b');
      await anna.joined();
      await ben.joined();
      anna.type('Titel von Anna');
      ben.type('Ben: Titel');
      await vi.advanceTimersByTimeAsync(100);
      expect(anna.text()).toBe('Ben: Titel von Anna');
      expect(ben.text()).toBe('Ben: Titel von Anna');
      expect(serverText()).toBe('Ben: Titel von Anna');
    }
    reset();
    {
      // two typing at the same place: each caret stays right after its own letters – the next
      // ones go on there, the two words never interleave
      const anna = editor('a');
      const ben = editor('b');
      await anna.joined();
      await ben.joined();
      const at = (offset: number) => ({
        start: { paragraph: 0, offset },
        end: { paragraph: 0, offset },
      });
      anna.shared.setCaret(at(5));
      ben.shared.setCaret(at(5));
      anna.type('Titel A');
      anna.shared.setCaret(at(7));
      ben.type('Titel B');
      ben.shared.setCaret(at(7));
      await vi.advanceTimersByTimeAsync(100);
      const merged = anna.text();
      expect(ben.text()).toBe(merged);
      expect(anna.shared.caretRange()).toEqual(at(merged.indexOf('A') + 1));
      expect(ben.shared.caretRange()).toEqual(at(merged.indexOf('B') + 1));
    }
    reset();
    {
      // takes back only its own typing (⌘Z), not what the other typed
      const anna = editor('a');
      const ben = editor('b');
      await anna.joined();
      await ben.joined();
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      ben.type('Ben: Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      expect(anna.shared.step('undo')).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(serverText()).toBe('Ben: Titel');
      expect(ben.text()).toBe('Ben: Titel');
    }
    reset();
    {
      // fonts tried on (a list stepped through, slowly) are one step; put back, none at all
      const anna = editor('a');
      await anna.joined();
      const inFont = (font: string) => [
        { ...paragraph('Titel'), runs: [{ ...style, font, text: 'Titel' }] },
      ];
      const fontNow = () => anna.shared.read()[0]!.runs[0]!.font;
      anna.type('Titel');
      anna.shared.holdStep();
      for (const font of ['Arial', 'Inter', 'Lato']) {
        anna.shared.change(inFont(font));
        await vi.advanceTimersByTimeAsync(2000);
      }
      anna.shared.endStep();
      expect(fontNow()).toBe('Lato');
      expect(anna.shared.step('undo')).toBe(true);
      expect(fontNow()).toBe('Calibri');
      expect(anna.shared.step('redo')).toBe(true);
      anna.shared.holdStep();
      anna.shared.change(inFont('Arial'));
      await vi.advanceTimersByTimeAsync(2000);
      anna.shared.change(inFont('Inter'));
      expect(anna.shared.dropStep()).toBe(true);
      expect(fontNow()).toBe('Lato');
      // Nothing to redo, and nothing tried: nothing taken back.
      expect(anna.shared.step('redo')).toBe(false);
      anna.shared.holdStep();
      expect(anna.shared.dropStep()).toBe(false);
      expect(fontNow()).toBe('Lato');
    }
  });

  it('types at once while its join is on its way – both ways round, and letting go if gone', async () => {
    {
      // types at once – what was typed before its join answered goes out with it
      const anna = editor('a');
      await anna.joined();
      const open = gate('join');
      const ben = editor('b');
      // Ben types before the server answered; Anna types meanwhile too.
      ben.type('Ben: Titel');
      await vi.advanceTimersByTimeAsync(0);
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      open();
      await vi.advanceTimersByTimeAsync(100);
      expect(serverText()).toBe('Ben: Titel von Anna');
      expect(anna.text()).toBe('Ben: Titel von Anna');
      expect(ben.text()).toBe('Ben: Titel von Anna');
    }
    reset();
    {
      // takes what the others typed while its join was on its way
      const anna = editor('a');
      await anna.joined();
      const open = gate('join');
      const ben = editor('b');
      // Ben is a member on the server, the answer (without Anna's typing) not here yet.
      await vi.advanceTimersByTimeAsync(0);
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      open();
      await ben.joined();
      expect(ben.text()).toBe('Titel von Anna');
    }
    reset();
    {
      // lets go of a join answered after it was gone (no member left behind)
      const open = gate('join');
      const anna = editor('a');
      await vi.advanceTimersByTimeAsync(0);
      anna.shared.destroy();
      open();
      await vi.advanceTimersByTimeAsync(0);
      expect(server.members.size).toBe(0);
    }
  });

  it('carries typing over onto a changed file or others’ typing and writes the merged text', async () => {
    {
      // carries its typing over when the file changed before it joined – both changes stay
      // Opened on „Titel“; meanwhile the file became „Titel neu“ (someone saved, the AI).
      server.file = [paragraph('Titel neu')];
      const anna = editor('a', [paragraph('Titel')]);
      anna.type('Der Titel');
      await anna.joined();
      await vi.advanceTimersByTimeAsync(100);
      expect(anna.text()).toBe('Der Titel neu');
      expect(serverText()).toBe('Der Titel neu');
      // Carried over is no step of Anna's: ⌘Z would take the whole text back.
      expect(anna.shared.step('undo')).toBe(false);
    }
    reset();
    {
      // keeps what the others typed when carrying its typing over – and writes the merged text
      const anna = editor('a');
      await anna.joined();
      anna.type('Hello world');
      await vi.advanceTimersByTimeAsync(100);
      // Ben opened the text as an older file had it, and types before his join answered.
      const ben = editor('b', [paragraph('Hell')]);
      ben.type('Hell!');
      await ben.joined();
      await vi.advanceTimersByTimeAsync(100);
      expect(ben.text()).toBe('Hello world!');
      expect(anna.text()).toBe('Hello world!');
      expect(ben.merges()).toBe(1);
    }
    reset();
    {
      // writes the merged text once joined after typing alone
      const anna = editor('a');
      await anna.joined();
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      const open = gate('join');
      const ben = editor('b');
      ben.type('Ben: Titel');
      open();
      await ben.joined();
      expect(ben.text()).toBe('Ben: Titel von Anna');
      expect(ben.merges()).toBe(1);
      // Joined without typing alone: nothing of its own to write.
      expect(anna.merges()).toBe(0);
    }
  });

  it('joins again when the server forgot it or made the text anew, without repeating it', async () => {
    {
      // joins again when the server forgot it, sending what was typed meanwhile
      const anna = editor('a');
      const ben = editor('b');
      await anna.joined();
      await ben.joined();
      // The stream reconnected: the server no longer has Anna as typing in it.
      server.members.delete('a');
      anna.type('Titel neu');
      await vi.advanceTimersByTimeAsync(100);
      expect(server.members.has('a')).toBe(true);
      expect(ben.text()).toBe('Titel neu');
      expect(serverText()).toBe('Titel neu');
    }
    reset();
    {
      // merges into a text made anew from the same file, without repeating it
      const anna = editor('a');
      await anna.joined();
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      // The server restarted before anything was saved: the text is made from the file again.
      server.doc = null;
      server.members.clear();
      anna.type('Titel von Anna!');
      await vi.advanceTimersByTimeAsync(100);
      expect(serverText()).toBe('Titel von Anna!');
      expect(anna.text()).toBe('Titel von Anna!');
      const ben = editor('b');
      await ben.joined();
      expect(ben.text()).toBe('Titel von Anna!');
      // Still Anna's own typing: ⌘Z takes it back.
      expect(anna.shared.step('undo')).toBe(true);
    }
  });

  it('takes up a text of another start, heard after and only once released – nothing doubled', async () => {
    {
      // is heard after its text was swapped for one of another start
      const anna = editor('a');
      await anna.joined();
      let changes = 0;
      anna.shared.onChange(() => (changes += 1));
      // The server restarted, the file had been saved meanwhile: another start.
      server.file = [paragraph('Titel!')];
      server.doc = null;
      server.members.clear();
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      const ben = editor('b');
      await ben.joined();
      const before = changes;
      ben.type('Ben: ' + ben.text());
      await vi.advanceTimersByTimeAsync(100);
      expect(anna.text()).toBe(ben.text());
      expect(anna.text().startsWith('Ben: ')).toBe(true);
      expect(changes).toBeGreaterThan(before);
    }
    reset();
    {
      // takes up a text of another start only once released – nothing doubled
      const anna = editor('a');
      await anna.joined();
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      // Ben opened the text as an older file had it: his start is another than the shared text's.
      const ben = editor('b', [paragraph('Titel alt')]);
      ben.shared.hold('composing');
      ben.type('Der Titel alt');
      await ben.joined();
      await vi.advanceTimersByTimeAsync(100);
      // Not joined while composing: nothing of his went out, nothing doubled.
      expect(serverText()).toBe('Titel von Anna');
      ben.shared.release('composing');
      await vi.advanceTimersByTimeAsync(100);
      expect(serverText()).toBe('Der Titel von Anna');
      expect(anna.text()).toBe('Der Titel von Anna');
      expect(ben.text()).toBe('Der Titel von Anna');
    }
    reset();
    {
      // keeps what the others typed while held when a text of another start is taken up
      const anna = editor('a');
      const ben = editor('b');
      await anna.joined();
      await ben.joined();
      ben.shared.hold('composing');
      anna.type('Titel von Anna');
      await vi.advanceTimersByTimeAsync(100);
      // The server restarted with Anna's text saved: Ben joins again onto another start.
      server.file = [paragraph('Titel von Anna')];
      server.doc = null;
      server.members.clear();
      anna.type('Titel von Anna.');
      await vi.advanceTimersByTimeAsync(100);
      await ben.shared.join();
      ben.shared.release('composing');
      await vi.advanceTimersByTimeAsync(100);
      expect(anna.text()).toBe('Titel von Anna.');
      expect(ben.text()).toBe('Titel von Anna.');
    }
  });

  it('sends the last keys as it leaves, and nothing more once the server refused an update', async () => {
    {
      // sends the last keys as it goes, after the post on its way, then leaves
      const anna = editor('a');
      const ben = editor('b');
      await anna.joined();
      await ben.joined();
      const open = gate('text');
      anna.type('Titel A');
      await vi.advanceTimersByTimeAsync(40);
      // The first post is on its way; the last keys wait for it.
      anna.type('Titel AB');
      anna.shared.destroy();
      open();
      await vi.advanceTimersByTimeAsync(100);
      expect(serverText()).toBe('Titel AB');
      expect(ben.text()).toBe('Titel AB');
      expect(server.members.has('a')).toBe(false);
    }
    reset();
    {
      // types on alone once the server refused an update – nothing more goes out
      const anna = editor('a');
      await anna.joined();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      refuse = 413;
      anna.type('Titel neu');
      await vi.advanceTimersByTimeAsync(100);
      refuse = null;
      anna.type('Titel neu!');
      await vi.advanceTimersByTimeAsync(5000);
      expect(posts.filter((action) => action === 'title')).toHaveLength(1);
      expect(server.members.has('a')).toBe(false);
      expect(anna.text()).toBe('Titel neu!');
      warn.mockRestore();
    }
  });

  it('holds remote typing and its own steps back while selecting, and restores the caret on ⌘Z', async () => {
    {
      // holds what the others type while selecting with the mouse, then draws it once
      const anna = editor('a');
      const ben = editor('b');
      await anna.joined();
      await ben.joined();
      anna.shared.hold('selecting');
      ben.type('Titel von Ben');
      await vi.advanceTimersByTimeAsync(100);
      expect(anna.text()).toBe('Titel');
      anna.shared.release('selecting');
      expect(anna.text()).toBe('Titel von Ben');
    }
    reset();
    {
      // draws a step taken back while held once released
      const anna = editor('a');
      await anna.joined();
      anna.type('Titel1');
      anna.shared.hold('selecting');
      expect(anna.shared.step('undo')).toBe(true);
      // Not drawn yet: the pointer is down.
      expect(anna.text()).toBe('Titel1');
      anna.shared.release('selecting');
      expect(anna.text()).toBe('Titel');
    }
    reset();
    {
      // puts the caret back where it was before the step taken back
      const anna = editor('a');
      await anna.joined();
      anna.shared.setCaret({
        start: { paragraph: 0, offset: 5 },
        end: { paragraph: 0, offset: 5 },
      });
      anna.type('Titel neu');
      anna.shared.setCaret({
        start: { paragraph: 0, offset: 9 },
        end: { paragraph: 0, offset: 9 },
      });
      expect(anna.shared.step('undo')).toBe(true);
      expect(anna.text()).toBe('Titel');
      expect(anna.shared.caretRange()).toEqual({
        start: { paragraph: 0, offset: 5 },
        end: { paragraph: 0, offset: 5 },
      });
    }
  });
});
