import { readFileSync } from 'node:fs';
import {
  textAreaInset,
  type LiveRun,
  type LiveTextStyle,
  type RichParagraph,
} from '@slider/shared';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { listLabels } from '@slider/shared/live-text';
import { OdpDocument, OdpError, placedBox } from '../src';
import { OdpArchive } from '../src/archive';

const DEMO = new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url)));

const open = async () => {
  const document = await OdpDocument.open(DEMO);
  document.ensureIds();
  return document;
};

const roundtrip = async (document: OdpDocument) => OdpDocument.open(await document.toBytes());

const byName = (document: OdpDocument, slide: number, name: string) => {
  const found = document.slides()[slide]?.elements.find((element) => element.name === name);
  if (!found) throw new Error(`no ${name} on slide ${slide}`);
  return found;
};

/** The fill each shape named `name` gets from its paragraph style, which LibreOffice draws. */
const textStyleFills = async (bytes: Uint8Array, name: string) => {
  const content = await (await OdpArchive.open(bytes)).readText('content.xml');
  return [...content.matchAll(new RegExp(`<draw:[^>]* draw:name="${name}"[^>]*>`, 'g'))].map(
    ([shape]) => {
      const style = / draw:text-style-name="([^"]*)"/.exec(shape)?.[1];
      const props = new RegExp(
        `<style:style [^>]*style:name="${style}"[^>]*>.*?<loext:graphic-properties([^>]*)>`,
      ).exec(content)?.[1];
      return {
        fill: / draw:fill="([^"]*)"/.exec(props ?? '')?.[1],
        color: / draw:fill-color="([^"]*)"/.exec(props ?? '')?.[1],
      };
    },
  );
};

const style = (over: Partial<LiveTextStyle> = {}): LiveTextStyle => ({
  font: 'Calibri',
  size: 20,
  color: '#112233',
  bold: false,
  italic: false,
  underline: false,
  ...over,
});
const run = (text: string, over: Partial<LiveTextStyle> = {}): LiveRun => ({
  ...style(over),
  text,
});

describe('live elements', () => {
  it('draws text frames and boxes live, resolving placeholder looks, and types in any shape with text but not over fields', async () => {
    const document = await open();
    const live = document
      .slides()
      .map((slide) => slide.elements.map((element) => [element.name, element.live !== null]));
    expect(live[2]).toEqual([
      ['Title 1', true],
      ['Tabelle Umsatz', false],
      ['Hinweis', true],
    ]);
    expect(live[3]).toEqual([
      ['Title 1', true],
      ['Roadmap Visual', false],
      ['Meilensteine', false],
    ]);
    // Resolves the look of placeholder text through its styles.
    {
      const document = await open();
      const title = byName(document, 0, 'Title 1').live!;
      expect(title.verticalAlign).toBe('bottom');
      expect(title.fill).toBeNull();
      expect(title.paragraphs[0]).toMatchObject({
        align: 'center',
        fontIndependent: true,
        lineSpacing: { type: 'proportional', value: 0.9 },
        runs: [{ text: 'Q4 Strategie 2026', font: 'Calibri Light', size: 60, color: '#000000' }],
      });
      const agenda = byName(document, 1, 'Content 2').live!;
      expect(agenda.paragraphs).toHaveLength(4);
      expect(agenda.paragraphs[0]).toMatchObject({
        level: 1,
        spaceBefore: expect.closeTo(10, 1),
        marginLeft: 18,
        bullet: { char: '•', font: 'Arial', size: 28, at: 0, width: 18 },
      });
      const hint = byName(document, 2, 'Hinweis').live!;
      expect(hint).toMatchObject({ fill: '#f1f5f9', stroke: null, verticalAlign: 'middle' });
      expect(hint.paragraphs[0]?.runs[0]).toMatchObject({ italic: true, color: '#334155' });
    }
    // Where no style sets the text's distance from the box: LibreOffice's standard for frames,
    // none for placeholders (their text otherwise jumped when typing began).
    {
      const zip = await JSZip.loadAsync(DEMO);
      for (const name of ['content.xml', 'styles.xml']) {
        const xml = await zip.file(name)!.async('string');
        zip.file(name, xml.replace(/ fo:padding(-\w+)?="[^"]*"/g, ''));
      }
      const document = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
      document.ensureIds();
      expect(byName(document, 0, 'Title 1').live!.padding).toEqual({
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      });
      expect(byName(document, 2, 'Hinweis').live!.padding).toEqual({
        top: expect.closeTo(3.54, 2),
        bottom: expect.closeTo(3.54, 2),
        left: expect.closeTo(7.09, 2),
        right: expect.closeTo(7.09, 2),
      });
    }
    // Types in any shape with text, but not over fields.
    {
      const document = await open();
      // Under the picture or not: only the typed text is drawn over it, the slide stays as it is.
      const roadmap = byName(document, 3, 'Roadmap Visual');
      document.apply([
        { type: 'setBox', elementId: byName(document, 3, 'Title 1').id, box: roadmap.bbox },
      ]);
      expect(byName(document, 3, 'Title 1').live).not.toBeNull();
    }
  });
});

describe('writing live elements', () => {
  it('writes formatted text that reads back the same, keeping bullets and sharing equal styles', async () => {
    const document = await open();
    const title = byName(document, 1, 'Title 1');
    const paragraphs: RichParagraph[] = [
      {
        align: 'center',
        runs: [run('Agenda '), run('neu', { bold: true, color: '#c2410c', font: 'Arial' })],
      },
      { align: 'right', runs: [run('zweite Zeile\nmit Umbruch', { italic: true, size: 30 })] },
      { align: 'left', runs: [run('gesperrt', { caps: 'uppercase', letterSpacing: 2 })] },
      // See-through letters; the next run does not take the paragraph's (the first run's) opacity.
      { align: 'left', runs: [run('halb', { opacity: 0.5 }), run(' voll')] },
    ];
    document.apply([{ type: 'setRichText', elementId: title.id, paragraphs }]);
    const again = await roundtrip(document);
    const live = byName(again, 1, 'Title 1').live!;
    expect(live.paragraphs.map((paragraph) => paragraph.align)).toEqual([
      'center',
      'right',
      'left',
      'left',
    ]);
    expect(live.paragraphs.map((paragraph) => paragraph.runs)).toEqual(
      paragraphs.map((paragraph) => paragraph.runs),
    );
    // The paragraph keeps its spacing; its own text style is the first run's.
    expect(live.paragraphs[0]?.lineSpacing).toEqual({ type: 'proportional', value: 0.9 });
    expect(live.paragraphs[1]?.mark).toEqual(style({ italic: true, size: 30 }));
    expect(byName(again, 1, 'Title 1').paragraphs).toEqual([
      'Agenda neu',
      'zweite Zeile\nmit Umbruch',
      'gesperrt',
      'halb voll',
    ]);
    // Keeps bullets and list items when the text gets more paragraphs.
    {
      const document = await open();
      const content = byName(document, 1, 'Content 2');
      document.apply([
        {
          type: 'setRichText',
          elementId: content.id,
          paragraphs: ['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf'].map((text) => ({
            align: 'left' as const,
            runs: [run(text, { size: 28 })],
          })),
        },
      ]);
      const live = byName(await roundtrip(document), 1, 'Content 2').live!;
      expect(live.paragraphs).toHaveLength(5);
      expect(live.paragraphs.every((paragraph) => paragraph.bullet?.char === '•')).toBe(true);
    }
    // Puts paragraphs in lists – the shape's own bullets, else lists of its own – and out again,
    // numbers counting per level, with strike and line spacing.
    {
      const document = await open();
      const content = byName(document, 1, 'Content 2');
      const line = (text: string, list: RichParagraph['list'], over = {}): RichParagraph => ({
        align: 'left',
        runs: [run(text, over)],
        list,
        lineSpacing: { type: 'proportional', value: 1.5 },
      });
      document.apply([
        {
          type: 'setRichText',
          elementId: content.id,
          paragraphs: [
            line('Punkt', { kind: 'bullet', level: 1 }),
            line('ohne', null),
            line('eins', { kind: 'number', level: 1 }),
            line('zwei', { kind: 'number', level: 1 }, { strike: true }),
            line('zwei a', { kind: 'number', level: 2 }),
            line('drei', { kind: 'number', level: 1 }),
          ],
        },
      ]);
      const live = byName(await roundtrip(document), 1, 'Content 2').live!;
      expect(listLabels(live.paragraphs)).toEqual(['•', null, '1.', '2.', '1.', '3.']);
      expect(live.paragraphs[0]?.bullet).toMatchObject({ font: 'Arial', width: 18 });
      expect(live.paragraphs[4]?.bullet).toMatchObject({ at: 27, width: 27, size: 20 });
      expect(live.paragraphs[3]?.runs[0]).toMatchObject({ text: 'zwei', strike: true });
      expect(live.paragraphs.every((p) => p.lineSpacing.value === 1.5)).toBe(true);
    }
    // Shares equal styles instead of writing them again.
    {
      const document = await open();
      const title = byName(document, 1, 'Title 1');
      const write = () =>
        document.apply([
          {
            type: 'setRichText',
            elementId: title.id,
            paragraphs: [{ align: 'left', runs: [run('A', { bold: true }), run('B')] }],
          },
        ]);
      write();
      const once = (await document.toBytes()).byteLength;
      write();
      write();
      expect((await document.toBytes()).byteLength).toBe(once);
    }
  });

  it('sets fill, border and alignment in a style of its own, adds boxes with the editor’s ids and refuses what is not live', async () => {
    const document = await open();
    const hint = byName(document, 2, 'Hinweis');
    document.apply([
      {
        type: 'setShapeStyle',
        elementId: hint.id,
        fill: '#ABCDEF',
        stroke: { color: '#000000', width: 2 },
        verticalAlign: 'top',
      },
    ]);
    const live = byName(await roundtrip(document), 2, 'Hinweis').live!;
    expect(live.fill).toBe('#abcdef');
    expect(live.stroke?.color).toBe('#000000');
    expect(live.stroke?.width).toBe(2);
    expect(live.verticalAlign).toBe('top');
    // Written in points: 1 pt reads back as 1, not 0.99 (0.035 cm).
    document.apply([
      { type: 'setShapeStyle', elementId: hint.id, stroke: { color: '#000000', width: 1 } },
    ]);
    expect(byName(await roundtrip(document), 2, 'Hinweis').live!.stroke?.width).toBe(1);
    // LibreOffice draws the fill its paragraph style carries (PowerPoint imports): that one too.
    expect(await textStyleFills(await document.toBytes(), 'Hinweis')).toEqual([
      { fill: 'solid', color: '#abcdef' },
    ]);
    document.apply([{ type: 'setShapeStyle', elementId: hint.id, fill: null, stroke: null }]);
    expect(byName(document, 2, 'Hinweis').live).toMatchObject({ fill: null, stroke: null });
    // Adds text boxes and boxes with the editor’s ids.
    {
      const document = await open();
      document.apply([
        {
          type: 'addElement',
          pageId: document.pageIds()[0]!,
          elementId: 'sltest-box',
          kind: 'rect',
          box: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
          fill: '#ff0000',
          stroke: null,
          paragraphs: [{ align: 'center', runs: [run('Box')] }],
        },
        {
          type: 'addElement',
          pageId: document.pageIds()[0]!,
          elementId: 'sltest-hexagon',
          kind: 'rect',
          shape: 'hexagon',
          box: { x: 0.5, y: 0.1, w: 0.2, h: 0.3 },
          fill: '#ff0000',
          stroke: null,
          paragraphs: [{ align: 'center', runs: [run('Sechseck')] }],
        },
        {
          type: 'addElement',
          pageId: document.pageIds()[0]!,
          elementId: 'sltest-text',
          kind: 'text',
          box: { x: 0.1, y: 0.5, w: 0.3, h: 0.3 },
          fill: null,
          stroke: null,
          paragraphs: [{ align: 'right', runs: [run('Unten rechts')] }],
        },
        // A plain text box sits at the bottom of its box too (the 3 × 3 grid of the text tab).
        { type: 'setShapeStyle', elementId: 'sltest-text', verticalAlign: 'bottom' },
      ]);
      const elements = (await roundtrip(document)).slides()[0]!.elements;
      expect(elements.find((element) => element.id === 'sltest-text')!.live).toMatchObject({
        verticalAlign: 'bottom',
        autoGrow: true,
        fill: null,
        stroke: null,
      });
      const added = elements.find((element) => element.id === 'sltest-box')!;
      expect(added).toMatchObject({ kind: 'shape', name: 'Rechteck 1', paragraphs: ['Box'] });
      expect(added.bbox.x).toBeCloseTo(0.1, 3);
      expect(added.live).toMatchObject({
        fill: '#ff0000',
        verticalAlign: 'middle',
        autoGrow: false,
      });
      // A rectangle lays its text out in its box, a hexagon in its middle – as LibreOffice does.
      expect(added.live!.textArea).toBeUndefined();
      const hexagon = elements.find((element) => element.id === 'sltest-hexagon')!.live!;
      const inset = (5400 * 100) / 234 + 1700;
      expect(hexagon.textArea).toEqual({
        left: expect.closeTo(inset / 21600, 5),
        top: expect.closeTo(inset / 21600, 5),
        right: expect.closeTo(inset / 21600, 5),
        bottom: expect.closeTo(inset / 21600, 5),
      });
      // As LibreOffice writes geometry out: equations; a rounded rectangle wider than high keeps
      // its corners (stretch point), so its sides' insets are smaller.
      const roundRect = textAreaInset(
        {
          type: 'round-rectangle',
          viewBox: '0 0 21600 21600',
          modifiers: '3600',
          textAreas: '?f3 ?f4 ?f5 ?f6',
          stretchX: '10800',
          stretchY: '10800',
          equations: {
            f0: '45',
            f1: '$0 *sin(?f0 *(pi/180))',
            f2: '?f1 *3163/7636',
            f3: 'left+?f2 ',
            f4: 'top+?f2 ',
            f5: 'right-?f2 ',
            f6: 'bottom-?f2 ',
          },
        },
        5.5,
        3.713,
      )!;
      expect(roundRect.top).toBeCloseTo(0.04882, 4);
      expect(roundRect.left).toBeCloseTo(0.04882 / (5.5 / 3.713), 4);
      // From PowerPoint: in the box's own 1/100 mm.
      const ooxml = textAreaInset(
        {
          type: 'ooxml-hexagon',
          viewBox: '0 0 0 0',
          textAreas: '?f1 ?f2 ?f3 ?f4',
          equations: {
            f0: 'min(logwidth,logheight)/6',
            f1: '?f0',
            f2: '?f0',
            f3: 'logwidth-?f0',
            f4: 'logheight-?f0',
          },
        },
        6,
        3,
      )!;
      expect(ooxml).toMatchObject({
        left: expect.closeTo(1 / 12, 5),
        top: expect.closeTo(1 / 6, 5),
      });
      // Unreadable: the whole box, as before.
      expect(
        textAreaInset({ textAreas: '?f0 0 21600 21600', equations: { f0: 'gamma(2)' } }, 1, 1),
      ).toBeNull();
      expect(() =>
        document.apply([
          {
            type: 'addElement',
            pageId: document.pageIds()[0]!,
            elementId: 'sltest-box',
            kind: 'text',
            box: { x: 0, y: 0, w: 0.1, h: 0.1 },
            fill: null,
            stroke: null,
            paragraphs: [],
          },
        ]),
      ).toThrow(OdpError);
    }
    // Lines: across the frame as drawn, an arrow head LibreOffice's own; moved, flattened,
    // turned and copied by their ends; restyled, the heads sized with the line.
    {
      const document = await open();
      const pageId = document.pageIds()[0]!;
      document.apply([
        {
          type: 'addElement',
          pageId,
          elementId: 'sltest-arrow',
          kind: 'line',
          box: { x: 0.1, y: 0.2, w: 0.4, h: 0.3 },
          flip: { x: true, y: false },
          heads: 'end',
          fill: null,
          stroke: { color: '#112233', width: 3, dash: 'dash' },
          paragraphs: [],
        },
      ]);
      const bytes = await document.toBytes();
      const archive = await OdpArchive.open(bytes);
      expect(await archive.readText('styles.xml')).toContain(
        '<draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="M10 0l-10 30h20z"/>',
      );
      // Three times as wide as the line (9 pt), as PowerPoint's medium head.
      expect(await archive.readText('content.xml')).toMatch(
        /draw:marker-end="Arrow" draw:marker-end-width="0.318cm" draw:marker-end-center="false"/,
      );
      const arrow = (await OdpDocument.open(bytes))
        .slides()[0]!
        .elements.find((element) => element.id === 'sltest-arrow')!;
      expect(arrow).toMatchObject({
        kind: 'line',
        name: 'Pfeil 1',
        movable: true,
        live: null,
        flip: { x: true, y: false },
        line: { heads: 'end' },
        look: { fill: null, fills: [], stroke: { color: '#112233', width: 3, dash: 'dash' } },
        paint: { outline: 'line' },
      });
      expect(arrow.bbox.w).toBeCloseTo(0.4, 3);
      // Laid flat (a level line) and turned upright by its centre: its ends follow.
      document.apply([
        {
          type: 'setBox',
          elementId: 'sltest-arrow',
          box: { x: 0.2, y: 0.5, w: 0.3, h: 0 },
          flip: { x: false, y: false },
        },
      ]);
      const flat = document.slides()[0]!.elements.find((item) => item.id === 'sltest-arrow')!;
      expect(flat.bbox).toMatchObject({ x: expect.closeTo(0.2, 3), h: 0 });
      expect(flat.flip).toEqual({ x: false, y: false });
      document.apply([
        { type: 'setBox', elementId: 'sltest-arrow', box: flat.bbox, rotation: 90 },
        { type: 'setShapeStyle', elementId: 'sltest-arrow', heads: 'both' },
        {
          type: 'copyElement',
          elementId: 'sltest-arrow',
          pageId,
          newElementId: 'sltest-arrow-copy',
          box: { x: 0.6, y: 0.1, w: 0, h: 0.3 },
        },
      ]);
      const upright = document.slides()[0]!.elements.find((item) => item.id === 'sltest-arrow')!;
      expect(upright.bbox.w).toBeCloseTo(0, 3);
      expect(upright.bbox.x + upright.bbox.w / 2).toBeCloseTo(0.35, 3);
      // Turned clockwise: its start, on the left, comes on top.
      expect(upright.flip).toEqual({ x: false, y: false });
      expect(upright.rotation).toBe(0);
      expect(upright.line).toEqual({ heads: 'both' });
      const copy = document.slides()[0]!.elements.find((item) => item.id === 'sltest-arrow-copy')!;
      expect(copy).toMatchObject({
        kind: 'line',
        line: { heads: 'both' },
        paint: { outline: 'line' },
      });
      expect(copy.bbox.x).toBeCloseTo(0.6, 3);
      // Thinner: its heads with it, still drawn by the browser.
      document.apply([
        {
          type: 'setShapeStyle',
          elementId: 'sltest-arrow',
          stroke: { color: '#ff0000', width: 1 },
        },
      ]);
      expect(
        await (await OdpArchive.open(await document.toBytes())).readText('content.xml'),
      ).toMatch(/draw:marker-start-width="0.21cm"/);
      expect(
        document.slides()[0]!.elements.find((item) => item.id === 'sltest-arrow')!.paint,
      ).toEqual({ outline: 'line', radius: 0 });
      // Heads are a line's only.
      expect(() =>
        document.apply([
          { type: 'setShapeStyle', elementId: byName(document, 2, 'Hinweis').id, heads: 'end' },
        ]),
      ).toThrow(OdpError);
    }
    // Refuses formatted text on what is not live.
    {
      const document = await open();
      const table = byName(document, 2, 'Tabelle Umsatz');
      expect(() =>
        document.apply([
          {
            type: 'setRichText',
            elementId: table.id,
            paragraphs: [{ align: 'left', runs: [run('x')] }],
          },
        ]),
      ).toThrow(OdpError);
    }
  });
});

describe('the picture typed over', () => {
  it('draws the picture typed over without the text, the same while only the text changes – refusing what cannot be typed in', async () => {
    const document = await open();
    const hint = byName(document, 2, 'Hinweis');
    const blank = document.blankText(hint.id);
    expect(blank?.pageIndex).toBe(2);
    const after = (await roundtrip(document)).slides()[2]?.elements;
    expect(after?.map((element) => element.name)).toEqual(['Title 1', 'Tabelle Umsatz', 'Hinweis']);
    const left = after?.find((element) => element.name === 'Hinweis');
    expect(left?.paragraphs?.join('')).toBe('');
    expect(left?.live).toMatchObject({ fill: '#f1f5f9', autoGrow: false });

    // Draws the same picture while only the text changes.
    const fingerprint = async (change: (document: OdpDocument) => void) => {
      const document = await open();
      change(document);
      return document.blankText(byName(document, 2, 'Title 1').id)?.fingerprint;
    };
    const before = await fingerprint(() => {});
    const typed = await fingerprint((document) =>
      document.apply([
        {
          type: 'setRichText',
          elementId: byName(document, 2, 'Title 1').id,
          paragraphs: [{ align: 'left', runs: [run('Neu')] }],
        },
      ]),
    );
    const moved = await fingerprint((document) => {
      const table = byName(document, 2, 'Tabelle Umsatz');
      document.apply([{ type: 'setBox', elementId: table.id, box: { ...table.bbox, x: 0.01 } }]);
    });
    expect(typed).toBe(before);
    expect(moved).not.toBe(before);
    // Refuses what cannot be typed in.
    {
      const document = await open();
      expect(document.blankText(byName(document, 2, 'Tabelle Umsatz').id)).toBeNull();
    }
  });
});

describe('the copy LibreOffice draws', () => {
  it('keeps every page but empties those not drawn, and drops what nothing shows', async () => {
    const document = await open();
    const before = document.slides();
    const pictures = (bytes: Uint8Array) =>
      OdpArchive.open(bytes).then((archive) =>
        archive.paths().filter((path) => path.startsWith('Pictures/')),
      );
    const allPictures = await pictures(await document.toBytes());
    const copy = await OdpDocument.open(await document.toDrawingBytes([1], () => null));
    const after = copy.slides();
    expect(after).toHaveLength(before.length);
    expect(after[1]!.elements.map((element) => element.name)).toEqual(
      before[1]!.elements.map((element) => element.name),
    );
    for (const [index, slide] of after.entries()) {
      if (index !== 1) expect(slide.elements).toEqual([]);
    }
    expect((await pictures(await copy.toBytes())).length).toBeLessThan(allPictures.length);
  });
});

describe('fonts for the render pool', () => {
  it('names each font by its substitute, in declarations and styles', async () => {
    const document = await open();
    const replaced = document.replaceFonts((family) =>
      family === 'Calibri Light' ? 'Carlito' : null,
    );
    expect(replaced).toBeGreaterThan(0);
    const reread = await roundtrip(document);
    expect(byName(reread, 0, 'Title 1').live!.paragraphs[0]!.runs[0]!.font).toBe('Carlito');
    // Fonts without a substitute stay.
    expect(byName(reread, 1, 'Content 2').live!.paragraphs[0]!.runs[0]!.font).toBe(
      byName(document, 1, 'Content 2').live!.paragraphs[0]!.runs[0]!.font,
    );
  });
});

describe('layers of a slide', () => {
  it('draws the slide without its elements, then each alone on white and black – off the page and tilted ones whole and flat, parts named by what they show', async () => {
    const document = await open();
    const count = document.slides().length;
    const elements = document.slides()[2]!.elements;
    const layers = await (await open()).toLayerBytes(2, () => null);
    expect(layers.elementIds).toEqual(elements.map((element) => element.id));
    expect(layers.pages).toEqual(Array.from({ length: 1 + 2 * elements.length }, (_, i) => 3 + i));
    const copy = await OdpDocument.open(layers.bytes);
    const slides = copy.slides();
    expect(slides).toHaveLength(count + 2 * elements.length);
    expect(slides[2]!.elements).toEqual([]);
    elements.forEach((element, i) => {
      for (const at of [3 + 2 * i, 4 + 2 * i]) {
        expect(slides[at]!.elements.map((item) => item.name)).toEqual([element.name]);
      }
    });
    for (const [index, slide] of slides.entries()) {
      if (index < 2 || index > 2 + 2 * elements.length) expect(slide.elements).toEqual([]);
    }
    // The elements alone sit on an empty master of their own.
    const styles = await (await OdpArchive.open(layers.bytes)).readText('styles.xml');
    expect(styles).toMatch(
      /<style:master-page [^>]*style:name="slLayers"[^>]*\/>|style:name="slLayers"[^>]*><\/style:master-page>/,
    );
    // Each drawn with its middle on the page's: moved – even reaching off the page – it is
    // drawn whole and not again, its picture's box taken back to where it lies.
    {
      const document = await open();
      const title = byName(document, 2, 'Title 1');
      const before = await (await open()).toLayerBytes(2, () => null);
      document.apply([{ type: 'setBox', elementId: title.id, box: { ...title.bbox, x: -0.3 } }]);
      const layers = await document.toLayerBytes(2, () => null);
      const at = layers.elementIds.indexOf(title.id);
      expect(layers.layers).toEqual(before.layers);
      const centred = 0.5 - title.bbox.w / 2;
      expect(layers.placements[at]?.shift.x).toBeCloseTo(centred + 0.3);
      expect(layers.placements[at]?.shift.y).toBeCloseTo(before.placements[at]?.shift.y ?? NaN);
      // On its own pages it lies in the page's middle.
      const copy = await OdpDocument.open(layers.bytes);
      const alone = copy.slides()[3 + 2 * at]!.elements[0]!;
      expect(alone.bbox.x).toBeCloseTo(centred);
      expect(placedBox(alone.bbox, layers.placements[at]!).x).toBeCloseTo(-0.3);
      expect(layers.placements[at]?.scale).toEqual({ x: 1, y: 1 });
      // A group goes there with its parts (it drew where it lay, placed as if moved).
      const grouped = await (await open()).toLayerBytes(3, () => null);
      const group = byName(await open(), 3, 'Meilensteine');
      const g = grouped.elementIds.indexOf(group.id);
      const alongside = (await OdpDocument.open(grouped.bytes)).slides()[4 + 2 * g]!.elements[0]!;
      const back = placedBox(alongside.bbox, grouped.placements[g]!);
      expect(back.x).toBeCloseTo(group.bbox.x);
      expect(back.y).toBeCloseTo(group.bbox.y);
    }
    // One larger than the page (off its top and bottom): drawn smaller to fit, not cut – its box
    // comes back where it lies. One holding text keeps its size (smaller, it would wrap anew).
    {
      const document = await open();
      const picture = byName(document, 3, 'Roadmap Visual');
      const title = byName(document, 3, 'Title 1');
      const box = { x: 0.1, y: -0.05, w: 0.5, h: 1.2 };
      document.apply([
        { type: 'setBox', elementId: picture.id, box },
        { type: 'setBox', elementId: title.id, box },
      ]);
      const layers = await document.toLayerBytes(3, () => null);
      expect(layers.placements[layers.elementIds.indexOf(title.id)]?.scale).toEqual({ x: 1, y: 1 });
      const at = layers.elementIds.indexOf(picture.id);
      const placement = layers.placements[at]!;
      const { scale } = placement;
      expect(scale.x).toBe(1);
      expect(scale.y).toBeCloseTo(1 / 1.2);
      const alone = (await OdpDocument.open(layers.bytes)).slides()[4 + 2 * at]!.elements[0]!;
      expect(alone.bbox.y).toBeCloseTo(0);
      expect(alone.bbox.y + alone.bbox.h).toBeCloseTo(1);
      // Back where it lies (scale · p + shift = drawn).
      const back = placedBox(alone.bbox, placement);
      expect(back.x).toBeCloseTo(box.x);
      expect(back.y).toBeCloseTo(box.y);
      expect(back.h).toBeCloseTo(box.h);
    }
    // Draws a tilted element flat and alone, its picture in no part.
    {
      const document = await open();
      const hint = byName(document, 2, 'Hinweis');
      const png = new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url)));
      document.apply(
        [
          {
            type: 'setTilt',
            elementId: hint.id,
            tilt: { x: 0, y: 30 },
            picture: { imageId: 'tilted', box: hint.bbox },
          },
        ],
        new Map([['tilted', { bytes: png, mediaType: 'image/png', width: 10, height: 10 }]]),
      );
      const layers = await document.toLayerBytes(2, () => null);
      expect(layers.elementIds).toContain(hint.id);
      const content = await (await OdpArchive.open(layers.bytes)).readText('content.xml');
      expect(content).not.toContain('Hinweis (3D)');
      expect(content).not.toContain('draw:display="none"');
    }

    // Names each part by what it shows – the same in another order, another once changed.
    const parts = async (change?: 'move' | 'box' | 'size') => {
      const document = await open();
      const title = byName(document, 2, 'Title 1');
      if (change === 'move') {
        document.apply([{ type: 'moveElement', elementId: title.id, to: 1 }]);
      }
      if (change === 'box') {
        document.apply([
          { type: 'setBox', elementId: title.id, box: { ...title.bbox, x: title.bbox.x + 0.05 } },
        ]);
      }
      if (change === 'size') {
        document.apply([
          { type: 'setBox', elementId: title.id, box: { ...title.bbox, w: title.bbox.w - 0.05 } },
        ]);
      }
      const drawing = await document.toLayerBytes(2, () => null);
      const byId = new Map(drawing.elementIds.map((id, at) => [id, drawing.layers[at]]));
      return { background: drawing.background, byId, title: title.id };
    };
    const before = await parts();
    expect((await parts()).byId).toEqual(before.byId);
    const moved = await parts('move');
    expect(moved.background).toBe(before.background);
    expect(moved.byId).toEqual(before.byId);
    // Moved on the slide: drawn as it was (where it lies is no part of its picture).
    expect((await parts('box')).byId).toEqual(before.byId);
    // Composed (the per-element editor): what the browser draws whole is not drawn – no layer,
    // no pages; a text typed live is left out of its element's picture.
    {
      const document = await open();
      const hint = byName(document, 2, 'Hinweis');
      const title = byName(document, 2, 'Title 1');
      expect(title.paint).toBeDefined();
      document.apply([
        {
          type: 'setShapeStyle',
          elementId: hint.id,
          effects: {
            shadow: { x: 2, y: 2, blur: 4, color: '#000000', opacity: 0.4 },
            blur: null,
            glow: null,
            backdrop: null,
          },
        },
      ]);
      expect(byName(document, 2, 'Hinweis').paint).toBeUndefined();
      const drawing = await document.toLayerBytes(2, () => null, { compose: true });
      const drawn = drawing.layers.filter((layer) => layer !== null);
      expect(drawing.layers[drawing.elementIds.indexOf(title.id)]).toBeNull();
      // The master's background alone, its shapes alone (on white and on black), then each
      // element drawn.
      expect(drawing.masterShapes).toEqual(expect.any(String));
      expect(drawing.masterGround).toEqual(expect.any(String));
      expect(drawing.pages).toHaveLength(1 + 1 + 2 + 2 * drawn.length);
      const content = await (await OdpArchive.open(drawing.bytes)).readText('content.xml');
      expect(content).not.toContain('Planwerte');
      expect(content).toContain('presentation:background-objects-visible="false"');
      // The same for another slide of its master: drawn once.
      const other = await (await open()).toLayerBytes(1, () => null, { compose: true });
      expect(other.masterGround).toBe(drawing.masterGround);
      expect((await (await open()).toLayerBytes(2, () => null)).masterGround).toBeNull();
    }
    const boxed = await parts('size');
    expect(boxed.background).toBe(before.background);
    expect(boxed.byId.get(before.title)).not.toBe(before.byId.get(before.title));
    for (const [id, part] of before.byId) {
      if (id !== before.title) expect(boxed.byId.get(id)).toBe(part);
    }

    // Composed, the master's shapes over the slide's own background (the browser draws that
    // beneath them): the slide without its elements on white and on black, named the same
    // whatever its own background and wherever its elements lie.
    const masterShapes = async (change?: 'background' | 'box') => {
      const document = await open();
      const slide = document.slides()[2]!;
      const title = byName(document, 2, 'Title 1');
      if (change === 'background') {
        document.apply([
          {
            type: 'setSlideBackground',
            pageId: slide.pageId!,
            fills: [
              {
                type: 'gradient',
                kind: 'linear',
                angle: 135,
                stops: [
                  { color: '#112233', at: 0 },
                  { color: '#ddeeff', at: 1 },
                ],
                opacity: 1,
                visible: true,
              },
            ],
          },
        ]);
      }
      if (change === 'box') {
        document.apply([
          { type: 'setBox', elementId: title.id, box: { ...title.bbox, x: title.bbox.x + 0.05 } },
        ]);
      }
      return document.toLayerBytes(2, () => null, { compose: true });
    };
    const plain = await masterShapes();
    expect(plain.pages.slice(1, 3)).toEqual([4, 5]);
    const drawnXml = await (await OdpArchive.open(plain.bytes)).readText('content.xml');
    expect(drawnXml).toContain('draw:fill-color="#ffffff"');
    expect(drawnXml).toContain('draw:fill-color="#000000"');
    expect((await masterShapes('background')).masterShapes).toBe(plain.masterShapes);
    expect((await masterShapes('box')).masterShapes).toBe(plain.masterShapes);
    // Not composed: none.
    expect((await (await open()).toLayerBytes(2, () => null)).masterShapes).toBeNull();
  });
});

describe('looks and an element left out', () => {
  it('offers fill and border for shapes and text frames only and leaves an element out of its slide', async () => {
    const document = await open();
    expect(byName(document, 1, 'Title 1').look).not.toBeNull();
    const table = byName(document, 2, 'Tabelle Umsatz');
    expect(table.look).toBeNull();
    expect(() =>
      document.apply([{ type: 'setShapeStyle', elementId: table.id, fill: '#ffffff' }]),
    ).toThrow(OdpError);

    // Leaves an element out of its slide, and what lies over it.
    {
      const document = await open();
      const title = byName(document, 2, 'Title 1');
      expect(document.blankElement(title.id)).toMatchObject({ pageIndex: 2 });
      expect(document.slides()[2]!.elements).toEqual([]);
      const other = await open();
      other.blankElement(byName(other, 2, 'Hinweis').id);
      expect(other.slides()[2]!.elements.map((element) => element.name)).toEqual([
        'Title 1',
        'Tabelle Umsatz',
      ]);
    }
  });
});

describe('what LibreOffice is handed to draw', () => {
  /** The demo deck with a Basic macro that runs when it is opened, and a Python one. */
  const withMacros = async () => {
    const zip = await JSZip.loadAsync(DEMO);
    const content = (await zip.file('content.xml')!.async('string')).replace(
      /(<office:document-content[^>]*>)/,
      '$1<office:scripts><office:event-listeners><script:event-listener script:language="ooo:script" script:event-name="dom:load" xlink:href="vnd.sun.star.script:Standard.Module1.Main?language=Basic&amp;location=document" xlink:type="simple"/></office:event-listeners></office:scripts>',
    );
    zip.file('content.xml', content);
    zip.file('Basic/script-lc.xml', '<library:libraries/>');
    zip.file('Basic/Standard/Module1.xml', '<script:module>Sub Main\nEnd Sub</script:module>');
    zip.file('Scripts/python/run.py', 'def main(*args):\n    pass\n');
    const document = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
    document.ensureIds();
    return document;
  };
  const executable = async (bytes: Uint8Array) => {
    const archive = await OdpArchive.open(bytes);
    const content = await archive.readText('content.xml');
    return {
      files: archive.paths().filter((path) => /^(Basic|Scripts|Configurations2)\//.test(path)),
      events: /event-listener|office:scripts/.test(content),
    };
  };

  it('holds no macro and no event, whatever the deck has', async () => {
    const page = await (await withMacros()).toDrawingBytes([0], () => null);
    expect(await executable(page)).toEqual({ files: [], events: false });
    // Nor a slide taken apart (the composed editor's layers).
    const layers = await (await withMacros()).toLayerBytes(2, () => null, { compose: true });
    expect(await executable(layers.bytes)).toEqual({ files: [], events: false });
  });
});
