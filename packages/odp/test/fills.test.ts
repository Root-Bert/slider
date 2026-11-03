import { NO_EFFECTS, type FillLayer, type SlideOperation } from '@slider/shared';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { OdpDocument, blankOdp, type OdpImage } from '../src';

// A 1×1 PNG.
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);
const image = (): OdpImage => ({ bytes: PNG, mediaType: 'image/png', width: 1, height: 1 });

const gradient: FillLayer = {
  type: 'gradient',
  kind: 'linear',
  angle: 45,
  stops: [
    { color: '#ff0000', at: 0 },
    { color: '#00ff00', at: 0.4 },
    { color: '#0000ff', at: 1 },
  ],
  opacity: 0.8,
  visible: true,
};

async function withBox() {
  const document = await OdpDocument.open(await blankOdp(new Date()));
  document.ensureIds();
  document.apply([
    {
      type: 'addElement',
      pageId: document.pageIds()[0]!,
      elementId: 'slbox',
      kind: 'rect',
      box: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
      fill: '#000000',
      stroke: null,
      paragraphs: [],
    },
  ]);
  return document;
}

const reopen = async (document: OdpDocument) => OdpDocument.open(await document.toBytes());
const lookOf = (document: OdpDocument) =>
  document.slides()[0]!.elements.find((element) => element.id === 'slbox')!.look!;

async function contentXml(document: OdpDocument): Promise<string> {
  const zip = await JSZip.loadAsync(await document.toBytes());
  return zip.file('content.xml')!.async('string');
}

/** The file without Slider's layers: as another program would leave it. */
async function withoutLayers(document: OdpDocument): Promise<OdpDocument> {
  const zip = await JSZip.loadAsync(await document.toBytes());
  const content = await zip.file('content.xml')!.async('string');
  zip.file('content.xml', content.replace(/ slider:fills="[^"]*"/g, ''));
  return OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
}

describe('fill layers', () => {
  it('writes gradients as gradients and reads them back, radial ones from the middle out – nothing without layers shown', async () => {
    const document = await withBox();
    document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fills: [gradient] }]);
    const again = await reopen(document);
    expect(lookOf(again)).toMatchObject({ fill: null, fills: [gradient], fillAspect: null });
    expect(await contentXml(again)).toContain('xmlns:slider=');
    // Read from the file's own gradient: the same.
    expect(lookOf(await withoutLayers(again)).fills).toEqual([gradient]);
    // Reads every form back from the file's own gradient – the centred ones from their centre out.
    for (const layer of [
      { ...gradient, kind: 'radial', angle: 0, opacity: 1 },
      { ...gradient, kind: 'radial', angle: 0, center: { x: 0.25, y: 0.8 }, opacity: 1 },
      { ...gradient, kind: 'axial', angle: 90 },
      { ...gradient, kind: 'ellipsoid', angle: 30, center: { x: 0.3, y: 0.5 } },
      { ...gradient, kind: 'square', angle: 0 },
      { ...gradient, kind: 'rectangular', angle: 45, center: { x: 0.5, y: 0.1 } },
    ] as FillLayer[]) {
      const document = await withBox();
      document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fills: [layer] }]);
      expect(lookOf(await withoutLayers(document)).fills).toEqual([layer]);
    }
    // See-through colours: a transparency gradient running as the colours do, the layer's
    // opacity in it – read back from the file as the stops' own.
    {
      const document = await withBox();
      const layer = {
        ...gradient,
        kind: 'radial',
        angle: 0,
        stops: [
          { color: '#ff0000', at: 0, opacity: 0.5 },
          { color: '#00ff00', at: 0.4 },
          { color: '#0000ff', at: 1, opacity: 0 },
        ],
      } as FillLayer;
      document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fills: [layer] }]);
      expect(lookOf(await reopen(document)).fills).toEqual([layer]);
      const styles = await (
        await JSZip.loadAsync(await document.toBytes())
      )
        .file('styles.xml')!
        .async('string');
      expect(styles).toMatch(/<draw:opacity [^>]*draw:style="radial"/);
      expect(styles).toContain('<loext:opacity-stop svg:offset="0" svg:stop-opacity="0"/>');
      expect(lookOf(await withoutLayers(document)).fills).toEqual([
        {
          ...layer,
          opacity: 1,
          stops: [
            { color: '#ff0000', at: 0, opacity: 0.4 },
            { color: '#00ff00', at: 0.4, opacity: 0.8 },
            { color: '#0000ff', at: 1, opacity: 0 },
          ],
        },
      ]);
    }
    // Fills nothing without layers shown.
    {
      const document = await withBox();
      document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fills: [] }]);
      expect(lookOf(await reopen(document))).toMatchObject({ fill: null, fills: [] });
    }
  });

  it('keeps hidden layers, draws layers as their picture kept in the file and forgets them when the fill is set otherwise', async () => {
    const document = await withBox();
    const fills: FillLayer[] = [
      { type: 'solid', color: '#123456', opacity: 0.5, visible: true },
      { ...gradient, visible: false },
    ];
    document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fills }]);
    const again = await reopen(document);
    expect(lookOf(again)).toMatchObject({ fill: '#123456', fills });
    expect(lookOf(await withoutLayers(again)).fills).toEqual([fills[0]]);
    // Draws layers as their picture, with each layer’s picture kept in the file.
    {
      const document = await withBox();
      const fills: FillLayer[] = [
        // Filled with a part of it chosen on the slide (as a picture element's: „Ausschnitt“).
        {
          type: 'image',
          src: 'up.png',
          fit: 'fill',
          focus: { x: 0.3, y: 0.6, zoom: 2.5 },
          opacity: 1,
          visible: true,
        },
        gradient,
      ];
      const operation: SlideOperation = {
        type: 'setShapeStyle',
        elementId: 'slbox',
        fills,
        composite: { imageId: 'baked.png', aspect: 2 },
      };
      expect(() => document.apply([operation], new Map([['up.png', image()]]))).toThrow(
        /nicht mehr da/,
      );
      const fresh = await withBox();
      fresh.apply(
        [operation],
        new Map([
          ['up.png', image()],
          ['baked.png', image()],
        ]),
      );
      const again = await reopen(fresh);
      const look = lookOf(again);
      expect(look.fillAspect).toBe(2);
      const [picture] = look.fills;
      expect(picture).toMatchObject({
        type: 'image',
        fit: 'fill',
        focus: { x: 0.3, y: 0.6, zoom: 2.5 },
      });
      expect(picture?.type === 'image' && picture.src).toMatch(/^Pictures\//);
      expect(await again.picture((picture as { src: string }).src)).not.toBeNull();
      // Without its layers: the picture of them, stretched.
      expect(lookOf(await withoutLayers(again)).fills).toEqual([
        {
          type: 'image',
          src: expect.stringMatching(/^Pictures\//),
          fit: 'stretch',
          opacity: 1,
          visible: true,
        },
      ]);
    }
    // A backdrop blur: kept in the mark with the layers, to be baked until baked from what lies
    // under the element now – its place, the slide under it – not from what lies over it.
    {
      const document = await withBox();
      const glass: FillLayer[] = [{ type: 'solid', color: '#ffffff', opacity: 0.4, visible: true }];
      const frost = { ...NO_EFFECTS, backdrop: 12 };
      document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fills: glass, effects: frost }]);
      let again = await reopen(document);
      expect(lookOf(again)).toMatchObject({ fill: '#ffffff', fills: glass, effects: frost });
      const [work, ...more] = again.backdropWork();
      expect(more).toEqual([]);
      expect(work).toMatchObject({ elementId: 'slbox', pageIndex: 0, radius: 12, fills: glass });
      again.bakeBackdrop('slbox', { bytes: PNG, mediaType: 'image/png' }, work!.source);
      again = await reopen(again);
      expect(again.backdropWork()).toEqual([]);
      const baked = lookOf(again);
      expect(baked).toMatchObject({ fill: null, fills: glass, effects: frost });
      expect(baked.fillAspect).toBeGreaterThan(0);
      expect(await contentXml(again)).toMatch(/draw:fill="bitmap"/);
      // Another blur strength, or only the layers changed: baked anew.
      const blurred = await reopen(again);
      blurred.apply([
        { type: 'setShapeStyle', elementId: 'slbox', effects: { ...frost, backdrop: 20 } },
      ]);
      expect(blurred.backdropWork()).toMatchObject([{ radius: 20 }]);
      expect(lookOf(blurred).effects.backdrop).toBe(20);
      // Something new over it changes nothing; moved, or under something new, it is baked anew.
      const pageId = again.pageIds()[0]!;
      const add = (elementId: string): SlideOperation => ({
        type: 'addElement',
        pageId,
        elementId,
        kind: 'rect',
        box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
        fill: '#ff0000',
        stroke: null,
        paragraphs: [],
      });
      again.apply([add('slover')]);
      expect(again.backdropWork()).toEqual([]);
      const moved = await reopen(again);
      moved.apply([
        { type: 'setBox', elementId: 'slbox', box: { x: 0.2, y: 0.1, w: 0.4, h: 0.2 } },
      ]);
      expect(moved.backdropWork()).toMatchObject([{ elementId: 'slbox' }]);
      const under = await reopen(again);
      under.apply([add('slunder'), { type: 'moveElement', elementId: 'slunder', to: 0 }]);
      expect(under.backdropWork()).toMatchObject([{ elementId: 'slbox' }]);
      // A part of a group alike (entered by a double click): grouped, nothing under it changed;
      // the part or its group moved, or something under it in the group, it is baked anew.
      const grouped = await reopen(again);
      grouped.apply([
        { type: 'groupElements', elementIds: ['slbox', 'slover'], newElementId: 'slgroup' },
      ]);
      expect(grouped.backdropWork()).toEqual([]);
      const inGroup = async (operations: SlideOperation[]) => {
        const copy = await reopen(grouped);
        copy.apply(operations);
        return copy.backdropWork();
      };
      expect(
        await inGroup([
          { type: 'setBox', elementId: 'slbox', box: { x: 0.2, y: 0.1, w: 0.4, h: 0.2 } },
        ]),
      ).toMatchObject([{ elementId: 'slbox' }]);
      const groupBox = grouped.slides()[0]!.elements.find((item) => item.id === 'slgroup')!.bbox;
      expect(
        await inGroup([
          { type: 'setBox', elementId: 'slgroup', box: { ...groupBox, x: groupBox.x + 0.05 } },
        ]),
      ).toMatchObject([{ elementId: 'slbox' }]);
      expect(await inGroup([{ type: 'moveElement', elementId: 'slover', to: 0 }])).toMatchObject([
        { elementId: 'slbox' },
      ]);
      expect(grouped.blankElement('slbox')).toMatchObject({ pageIndex: 0 });
      expect(await contentXml(grouped)).not.toContain('slbox');
      // Taken off: one colour drawn as such at once, nothing left to bake.
      again.apply([{ type: 'setShapeStyle', elementId: 'slbox', effects: NO_EFFECTS }]);
      const off = await reopen(again);
      expect(off.backdropWork()).toEqual([]);
      expect(lookOf(off)).toMatchObject({ fill: '#ffffff', fills: glass, fillAspect: null });
      expect(lookOf(off).effects.backdrop).toBeNull();
      expect(await contentXml(off)).not.toContain('"backdrop"');
    }
    // Forgets the layers when the fill is set otherwise.
    {
      const document = await withBox();
      document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fills: [gradient] }]);
      document.apply([{ type: 'setShapeStyle', elementId: 'slbox', fill: '#abcdef' }]);
      const again = await reopen(document);
      expect(lookOf(again)).toMatchObject({
        fill: '#abcdef',
        fills: [{ type: 'solid', color: '#abcdef', opacity: 1, visible: true }],
      });
      expect(await contentXml(again)).not.toContain('slider:fills');
    }
  });

  it('fills a slide’s background with layers, and the master’s back', async () => {
    const document = await withBox();
    const pageId = document.pageIds()[0]!;
    const slide = (of: OdpDocument) => of.slides()[0]!;
    const opaque = { ...gradient, opacity: 1 };
    document.apply([{ type: 'setSlideBackground', pageId, fills: [opaque] }]);
    let again = await reopen(document);
    expect(slide(again)).toMatchObject({
      background: null,
      ownBackground: true,
      backgroundFills: [opaque],
    });
    // Read from the file's own gradient: the same.
    expect(slide(await withoutLayers(again)).backgroundFills).toEqual([opaque]);
    // See-through – the layer or one of its colours: LibreOffice draws a slide's background
    // opaque, so it goes as a picture of it (on white) like several layers.
    for (const layer of [
      gradient,
      { ...opaque, stops: [{ color: '#ff0000', at: 0, opacity: 0.5 }, ...opaque.stops.slice(1)] },
    ] as FillLayer[])
      expect(() =>
        document.apply([{ type: 'setSlideBackground', pageId, fills: [layer] }]),
      ).toThrow('Das Bild ist nicht mehr da');

    const credit = { name: 'A', profileUrl: 'https://a', photoUrl: 'https://a/p' };
    const fills: FillLayer[] = [
      { type: 'image', src: 'up.png', fit: 'fill', opacity: 1, visible: true, credit },
      { type: 'solid', color: '#000000', opacity: 0.3, visible: true },
    ];
    again.apply(
      [{ type: 'setSlideBackground', pageId, fills, composite: { imageId: 'baked.png' } }],
      new Map([
        ['up.png', image()],
        ['baked.png', image()],
      ]),
    );
    again = await reopen(again);
    const [picture, tint] = slide(again).backgroundFills;
    expect(picture).toMatchObject({ type: 'image', fit: 'fill', credit });
    expect(picture?.type === 'image' && picture.src).toMatch(/^Pictures\//);
    expect(tint).toEqual(fills[1]);
    // Without its layers: the picture of them, stretched over the slide.
    expect(slide(await withoutLayers(again)).backgroundFills).toEqual([
      expect.objectContaining({ type: 'image', fit: 'stretch' }),
    ]);

    again.apply([{ type: 'setSlideBackground', pageId, color: '#ff0000' }]);
    expect(slide(again)).toMatchObject({
      background: '#ff0000',
      backgroundFills: [{ type: 'solid', color: '#ff0000', opacity: 1, visible: true }],
    });
    again.apply([{ type: 'setSlideBackground', pageId, fills: [] }]);
    again = await reopen(again);
    expect(slide(again)).toMatchObject({ ownBackground: false, backgroundFills: [] });
  });
});
