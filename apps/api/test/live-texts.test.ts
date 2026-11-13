import { afterEach, describe, expect, it } from 'vitest';
import { OdpDocument } from '@slider/odp';
import type { Author, LiveEvent, LiveParagraph } from '@slider/shared';
import { livePresenceInputSchema } from '@slider/shared';
import {
  fromBase64,
  liveTextOf,
  readLiveText,
  toBase64,
  typedParagraphs,
} from '@slider/shared/live-text';
import * as Y from 'yjs';
import { LiveHub } from '../src/realtime/live-hub';
import { LiveTexts, MAX_LIVE_TEXT_LENGTH } from '../src/realtime/live-texts';
import { silentLogger } from '../src/logger';
import { fileSlides } from '../src/services/edits/file-slides';
import { newRevisionToLiveTexts } from '../src/services/edits/live-texts';
import type { BlobStorage } from '../src/storage/blob-storage';
import { DEMO_ODP } from './odp-helpers';

/* Texts typed in together, without the HTTP around them (the routes: edits.test.ts). */

const author: Author = { id: 'u1', name: 'Anna', type: 'owner', color: 'blue' };
const style: LiveParagraph['mark'] = {
  font: 'Arial',
  size: 18,
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
};
/** A paragraph of plain text. */
const paragraph = (text: string): LiveParagraph => ({
  runs: [{ ...style, text }],
  mark: style,
  align: 'left',
  fontIndependent: false,
  lineSpacing: { type: 'proportional', value: 1 },
  spaceBefore: 0,
  spaceAfter: 0,
  marginLeft: 0,
  indent: 0,
  level: 0,
  bullet: null,
});
const textOf = (doc: Y.Doc) =>
  readLiveText(liveTextOf(doc), paragraph(''))
    .map((p) => p.runs.map((run) => run.text).join(''))
    .join('\n');

let hub: LiveHub | undefined;
afterEach(() => {
  hub?.closeAll();
  hub = undefined;
});

/** An editor that has nothing yet. */
const NEW_EDITOR = { start: '', state: toBase64(Y.encodeStateVector(new Y.Doc())) };

function setup(graceMs = 30_000) {
  hub = new LiveHub();
  const texts = new LiveTexts(hub, Date.now, graceMs);
  const heard: LiveEvent[] = [];
  const a = hub.join('deck', author, () => {});
  const b = hub.join('deck', author, (event) => heard.push(event));
  // As an editor of another start would (none, here): all of the shared text comes back.
  const join = async (key: string, text = 'Hallo') => {
    const joined = await texts.join(key, 'el', async () => [paragraph(text)], {
      member: key,
      ...NEW_EDITOR,
    });
    if (!joined || joined === 'invalid') throw new Error('not joined');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(joined.update));
    return { doc, start: joined.start };
  };
  return { hub, texts, heard, a, b, join };
}

describe('texts typed in together', () => {
  it('keeps a text a while after the last one left and lets connections and editors leave apart', async () => {
    {
      // Presence says who is on the material page; left out, they are on the slides.
      const { hub, heard, a } = setup();
      const bare = { activeSlideId: null, cursor: null, focusedThreadId: null };
      expect(livePresenceInputSchema.parse(bare).onMaterial).toBe(false);
      hub.update(a, livePresenceInputSchema.parse({ ...bare, onMaterial: true }));
      expect(heard.at(-1)).toMatchObject({ type: 'peer', peer: { onMaterial: true } });
    }
    {
      const { texts, a, join } = setup(20);
      const first = await join(a);
      texts.leave(a, a, 'el');
      expect(texts.members('deck', 'el')).toBe(0);
      expect((await join(a, 'aus der Datei')).start).toBe(first.start);
      texts.leave(a, a, 'el');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(texts.elementsOf('deck')).toEqual([]);
      const fresh = await join(a, 'aus der Datei');
      expect(fresh.start).not.toBe(first.start);
      expect(textOf(fresh.doc)).toBe('aus der Datei');
    }
    {
      const { hub, texts, a, b, join } = setup();
      await join(a);
      await join(b);
      expect(texts.typesIn(a)).toBe(true);
      texts.leaveAll(a);
      expect(texts.typesIn(a)).toBe(false);
      expect(texts.update(a, a, 'el', toBase64(new Uint8Array([0, 0])))).toBe('gone');
      hub.closeAll();
      expect(texts.elementsOf('deck')).toEqual([]);
    }
    {
      // One editor leaves without the other one of its tab (opened again meanwhile).
      const { texts, a } = setup();
      for (const member of ['first', 'second']) {
        await texts.join(a, 'el', async () => [paragraph('Hallo')], { ...NEW_EDITOR, member });
      }
      // The first one's leave comes late, after the second joined.
      texts.leave(a, 'first', 'el');
      expect(texts.members('deck', 'el')).toBe(1);
      expect(texts.update(a, 'first', 'el', toBase64(new Uint8Array([0, 0])))).toBe('gone');
      expect(texts.update(a, 'second', 'el', toBase64(Y.encodeStateAsUpdate(new Y.Doc())))).toBe(
        'ok',
      );
    }
  });

  it('refuses what is no Y update, makes a text too long or builds on what the text lacks', async () => {
    {
      const { texts, a, b, join } = setup();
      expect(
        await texts.join(a, 'el', async () => [paragraph('x')], {
          member: a,
          start: '',
          state: '!!!',
        }),
      ).toBe('invalid');
      const { doc } = await join(a);
      await join(b);
      expect(texts.update(a, a, 'el', toBase64(new Uint8Array([255, 255, 255, 255])))).toBe(
        'invalid',
      );

      const updates: Uint8Array[] = [];
      doc.on('update', (update: Uint8Array) => updates.push(update));
      liveTextOf(doc).insert(3, 'a'.repeat(MAX_LIVE_TEXT_LENGTH));
      expect(texts.update(a, a, 'el', toBase64(updates.pop()!))).toBe('too_long');
      // Just below the limit: in; then deleting from it still works.
      liveTextOf(doc).delete(3, 100);
      const below = Y.encodeStateAsUpdate(doc);
      expect(texts.update(a, a, 'el', toBase64(below))).toBe('ok');
      liveTextOf(doc).delete(3, 10);
      expect(texts.update(a, a, 'el', toBase64(updates.pop()!))).toBe('ok');
    }
    {
      // A character next to one the text never had.
      const { texts, a, join } = setup();
      const { doc } = await join(a);
      // Typed after a character of a text the server never saw (another start's).
      const elsewhere = new Y.Doc();
      liveTextOf(elsewhere).insert(0, 'x');
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(elsewhere));
      const vector = Y.encodeStateVector(doc);
      liveTextOf(doc).insert(liveTextOf(doc).toString().indexOf('x') + 1, 'y');
      expect(texts.update(a, a, 'el', toBase64(Y.encodeStateAsUpdate(doc, vector)))).toBe(
        'invalid',
      );
    }
    {
      // An update that builds on what the text does not have.
      const { texts, a, join } = setup();
      const { doc } = await join(a);
      const updates: Uint8Array[] = [];
      doc.on('update', (update: Uint8Array) => updates.push(update));
      liveTextOf(doc).insert(1, 'a');
      liveTextOf(doc).insert(2, 'b');
      // The second without the first.
      expect(texts.update(a, a, 'el', toBase64(updates[1]!))).toBe('invalid');
      expect(texts.update(a, a, 'el', toBase64(updates[0]!))).toBe('ok');
      expect(texts.update(a, a, 'el', toBase64(updates[1]!))).toBe('ok');
    }
  });

  it('writes a changed file into the text for everyone typing, keeping what was typed since', async () => {
    {
      const { texts, heard, a, b, join } = setup();
      const docA = await join(a);
      const docB = await join(b);
      // The file says what the text says: nothing to send.
      texts.fileChanged('deck', 'el', [paragraph('Hallo')], [paragraph('Hallo')]);
      expect(heard.filter((event) => event.type === 'text')).toEqual([]);

      texts.fileChanged('deck', 'el', [paragraph('Hallo')], [paragraph('Hallo Welt')]);
      const sent = heard.filter((event) => event.type === 'text');
      expect(sent).toHaveLength(1);
      Y.applyUpdate(docB.doc, fromBase64((sent[0] as { update: string }).update));
      expect(textOf(docB.doc)).toBe('Hallo Welt');
      // Who joins now gets it too, merged with what it had.
      const again = await texts.join(a, 'el', async () => [], {
        member: a,
        start: docA.start,
        state: toBase64(Y.encodeStateVector(docA.doc)),
      });
      if (!again || again === 'invalid') throw new Error('not joined');
      Y.applyUpdate(docA.doc, fromBase64(again.update));
      expect(textOf(docA.doc)).toBe('Hallo Welt');
    }
    {
      const { texts, heard, a, b, join } = setup();
      const docA = await join(a);
      await join(b);
      // A typed „ Welt“, not saved yet.
      const updates: Uint8Array[] = [];
      docA.doc.on('update', (update: Uint8Array) => updates.push(update));
      liveTextOf(docA.doc).insert(liveTextOf(docA.doc).length, ' Welt');
      expect(texts.update(a, a, 'el', toBase64(Y.mergeUpdates(updates)))).toBe('ok');
      // Meanwhile the file got „Hallo!“ from elsewhere (the AI, the panel).
      texts.fileChanged('deck', 'el', [paragraph('Hallo')], [paragraph('Hallo!')]);
      const sent = heard.filter((event) => event.type === 'text').at(-1) as { update: string };
      Y.applyUpdate(docA.doc, fromBase64(sent.update));
      expect(textOf(docA.doc)).toBe('Hallo! Welt');
    }
    {
      // A new revision synced from elsewhere reaches the texts typed in together.
      const files = new Map<string, Uint8Array>();
      const storage = {
        get: async (key: string) => files.get(key) ?? null,
      } as unknown as BlobStorage;
      const before = await OdpDocument.open(DEMO_ODP);
      before.ensureIds();
      files.set('before.odp', await before.toBytes());
      const { slides } = await fileSlides({ storage }, 'before.odp');
      const element = slides
        .flatMap((slide) => slide.elements)
        .find((item) => item.live?.paragraphs.length)!;
      const was = typedParagraphs(element.live!);
      const after = await OdpDocument.open(files.get('before.odp')!);
      after.apply([{ type: 'setText', elementId: element.id, paragraphs: ['Synchronisiert'] }]);
      files.set('after.odp', await after.toBytes());

      const revHub = new LiveHub();
      hub = revHub;
      const texts = new LiveTexts(revHub);
      const heard: LiveEvent[] = [];
      const key = revHub.join('deck', author, (event) => heard.push(event));
      const joined = await texts.join(key, element.id, async () => was, {
        member: 'm',
        start: '',
        state: toBase64(Y.encodeStateVector(new Y.Doc())),
      });
      if (!joined || joined === 'invalid') throw new Error('not joined');
      const doc = new Y.Doc();
      Y.applyUpdate(doc, fromBase64(joined.update));
      // Typed there, not saved yet.
      const updates: Uint8Array[] = [];
      doc.on('update', (update: Uint8Array) => updates.push(update));
      liveTextOf(doc).insert(1, '» ');
      expect(texts.update(key, 'm', element.id, toBase64(Y.mergeUpdates(updates)))).toBe('ok');

      await newRevisionToLiveTexts(
        { storage, liveTexts: texts, log: silentLogger },
        'deck',
        'before.odp',
        'after.odp',
      );
      const sent = heard.filter((event) => event.type === 'text');
      expect(sent).toHaveLength(1);
      Y.applyUpdate(doc, fromBase64((sent[0] as { update: string }).update));
      const text = readLiveText(liveTextOf(doc), was[0]!).map((p) =>
        p.runs.map((r) => r.text).join(''),
      );
      expect(text).toEqual(['» Synchronisiert']);
      hub.closeAll();
    }
  });
});
