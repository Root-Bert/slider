import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { SlideOperation } from '@slider/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OdpDocument, OdpError, type OdpImage } from '../src';

/*
 * Edits made on an older state of a deck go in with what still fits (`applyWhatFits`): each
 * operation whole or not at all – one left out leaves the file byte for byte as it was.
 */

const DEMO = new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url)));

/** Some bytes as a picture: the package does not look into them. */
const IMAGE: OdpImage = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
  mediaType: 'image/png',
  width: 40,
  height: 30,
};
const IMAGES = new Map([['photo', IMAGE]]);

/** The demo deck as a step of its history stores it: written once, with its ids. */
async function stored(): Promise<Uint8Array> {
  const document = await OdpDocument.open(DEMO);
  document.ensureIds();
  return document.toBytes();
}

const open = async (bytes: Uint8Array) => {
  const document = await OdpDocument.open(bytes);
  document.ensureIds();
  return document;
};

/**
 * Every part of a package with its unpacked bytes: what two files must agree on to be the same
 * (the zip itself differs by the time its `mimetype` entry was written again).
 */
async function parts(bytes: Uint8Array): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir) out[path] = Buffer.from(await entry.async('uint8array')).toString('base64');
  }
  return out;
}

/** Applies `operations` leniently to the stored deck; asserts all were left out and nothing changed. */
async function expectUntouched(operations: SlideOperation[]) {
  const bytes = await stored();
  const document = await open(bytes);
  expect(document.changed).toBe(false);
  const outcome = document.applyWhatFits(operations, IMAGES);
  expect(outcome).toEqual({ applied: [], dropped: operations, reason: expect.any(String) });
  expect(document.changed).toBe(false);
  const written = await document.toBytes();
  expect(await parts(written)).toEqual(await parts(bytes));
}

/** The ids an operation can name in the demo deck. */
async function demoIds() {
  const document = await open(await stored());
  const slides = document.slides();
  const elements = slides.flatMap((slide) => slide.elements);
  const picture = elements.find((element) => element.kind === 'image');
  const text = elements.find((element) => element.kind === 'text');
  if (!picture || !text) throw new Error('the demo deck lacks a picture or text');
  return { pages: document.pageIds(), picture: picture.id, text: text.id };
}

const BOX = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applying what still fits', () => {
  it('leaves out every operation whose element, slide or picture is gone and applies the others around it', async () => {
    const { pages, picture, text } = await demoIds();
    const page = pages[1] as string;
    const cases: SlideOperation[] = [
      { type: 'setText', elementId: 'gone', paragraphs: ['x'] },
      { type: 'setBox', elementId: 'gone', box: BOX, rotation: 10 },
      {
        type: 'setRichText',
        elementId: 'gone',
        paragraphs: [{ align: 'left', runs: [] }],
      },
      {
        type: 'setShapeStyle',
        elementId: 'gone',
        fill: '#ff0000',
        stroke: { color: '#000000', width: 2, dash: 'dash' },
      },
      {
        type: 'addElement',
        pageId: 'gone',
        elementId: 'sl-new',
        kind: 'rect',
        box: BOX,
        fill: '#ff0000',
        stroke: null,
        paragraphs: [],
      },
      // Its new id is taken by now (a request sent again).
      {
        type: 'addElement',
        pageId: page,
        elementId: text,
        kind: 'text',
        box: BOX,
        fill: null,
        stroke: null,
        paragraphs: [],
      },
      { type: 'addImage', pageId: 'gone', elementId: 'sl-new', box: BOX, imageId: 'photo' },
      { type: 'addImage', pageId: page, elementId: 'sl-new', box: BOX, imageId: 'missing' },
      { type: 'replaceImage', elementId: 'gone', imageId: 'photo' },
      { type: 'replaceImage', elementId: picture, imageId: 'missing' },
      { type: 'replaceImage', elementId: text, imageId: 'photo' },
      {
        type: 'setTilt',
        elementId: 'gone',
        tilt: { x: 10, y: 0 },
        picture: { imageId: 'photo', box: BOX },
      },
      {
        type: 'setTilt',
        elementId: text,
        tilt: { x: 10, y: 0 },
        picture: { imageId: 'missing', box: BOX },
      },
      { type: 'deleteElement', elementId: 'gone' },
      { type: 'moveElement', elementId: 'gone', to: 0 },
      { type: 'moveElement', elementId: text, to: 10_000 },
      { type: 'deleteSlide', pageId: 'gone' },
      { type: 'setSlideHidden', pageId: 'gone', hidden: true },
      { type: 'moveSlide', pageId: 'gone', after: null },
      { type: 'moveSlide', pageId: page, after: 'gone' },
      { type: 'duplicateSlide', pageId: 'gone', newPageId: 'sl-copy', after: null },
      { type: 'duplicateSlide', pageId: page, newPageId: 'sl-copy', after: 'gone' },
      { type: 'duplicateSlide', pageId: page, newPageId: text, after: null },
      { type: 'addSlide', like: 'gone', newPageId: 'sl-copy', after: null },
      { type: 'addSlide', like: page, newPageId: 'sl-copy', after: 'gone' },
      { type: 'addSlide', like: page, newPageId: 'sl-copy', after: null, master: 'gone' },
    ];
    // Every kind of operation there is, at least once.
    expect(new Set(cases.map((operation) => operation.type)).size).toBe(15);
    for (const operation of cases) await expectUntouched([operation]);
    await expectUntouched(cases);
    // Applies the others around one left out.
    {
      const { pages, text } = await demoIds();
      const document = await open(await stored());
      const good: SlideOperation[] = [
        { type: 'setText', elementId: text, paragraphs: ['Noch da'] },
        { type: 'setSlideHidden', pageId: pages[1] as string, hidden: true },
      ];
      const bad: SlideOperation = { type: 'deleteElement', elementId: 'gone' };
      const outcome = document.applyWhatFits([good[0]!, bad, good[1]!], IMAGES);
      expect(outcome).toEqual({
        applied: good,
        dropped: [bad],
        reason: 'Dieses Element gibt es nicht mehr.',
      });
      const again = await open(await document.toBytes());
      const elements = again.slides().flatMap((slide) => slide.elements);
      expect(elements.find((element) => element.id === text)?.paragraphs).toEqual(['Noch da']);
      expect(again.slides()[1]?.hidden).toBe(true);
    }
    // Opens and writes the demo deck once per case: well over 5 s on a busy CI runner.
  }, 30_000);

  it('takes back everything an operation did before it found it does not fit', async () => {
    const { pages } = await demoIds();
    const bytes = await stored();
    const document = await open(bytes);
    // A picture frame that fails at the very end: its picture is in the package by then, in the
    // manifest, and its frame style among the automatic styles.
    const prototype = OdpDocument.prototype as unknown as { putOnTop: () => void };
    vi.spyOn(prototype, 'putOnTop').mockImplementation(() => {
      throw new OdpError('operation', 'Passt nicht mehr.');
    });
    const operation: SlideOperation = {
      type: 'addImage',
      pageId: pages[1] as string,
      elementId: 'sl-new',
      box: BOX,
      imageId: 'photo',
    };
    expect(document.applyWhatFits([operation], IMAGES)).toEqual({
      applied: [],
      dropped: [operation],
      reason: 'Passt nicht mehr.',
    });
    expect(document.changed).toBe(false);
    const written = await document.toBytes();
    expect(await parts(written)).toEqual(await parts(bytes));
  });

  it('throws what is no misfit, the document as it was before', async () => {
    const { text } = await demoIds();
    const bytes = await stored();
    const document = await open(bytes);
    const done: SlideOperation = { type: 'setText', elementId: text, paragraphs: ['Davor'] };
    const prototype = OdpDocument.prototype as unknown as { deleteElement: () => void };
    const original = (OdpDocument.prototype as unknown as Record<string, unknown>)
      .deleteElement as (this: OdpDocument, ...args: unknown[]) => void;
    vi.spyOn(prototype, 'deleteElement').mockImplementation(function (
      this: OdpDocument,
      ...args: unknown[]
    ) {
      original.apply(this, args);
      throw new Error('Platte voll');
    });
    expect(() =>
      document.applyWhatFits([done, { type: 'deleteElement', elementId: text }], IMAGES),
    ).toThrow('Platte voll');
    expect(document.changed).toBe(false);
    expect(await parts(await document.toBytes())).toEqual(await parts(bytes));
  });

  it('copies the deck once for an edit that fits whole, once more per operation only when one does not', async () => {
    const { pages, text } = await demoIds();
    const prototype = OdpDocument.prototype as unknown as { snapshot: () => unknown };
    const snapshot = vi.spyOn(prototype, 'snapshot');
    const good: SlideOperation[] = [
      { type: 'setText', elementId: text, paragraphs: ['Alles passt'] },
      { type: 'setSlideHidden', pageId: pages[1] as string, hidden: true },
    ];
    const fits = await open(await stored());
    expect(fits.applyWhatFits(good, IMAGES)).toMatchObject({ applied: good, dropped: [] });
    expect(snapshot).toHaveBeenCalledTimes(1);

    snapshot.mockClear();
    const bad: SlideOperation = { type: 'deleteElement', elementId: 'gone' };
    const misfit = await open(await stored());
    expect(misfit.applyWhatFits([...good, bad], IMAGES)).toMatchObject({ applied: good });
    // The whole edit, then each of its three operations.
    expect(snapshot).toHaveBeenCalledTimes(4);
  });
});
