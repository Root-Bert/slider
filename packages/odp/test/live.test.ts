import { readFileSync } from 'node:fs';
import type { LiveRun, LiveTextStyle, RichParagraph } from '@slider/shared';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { OdpDocument, OdpError } from '../src';
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
  it('draws text frames and plain boxes live, tables, pictures and groups not', async () => {
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
  });

  it('resolves the look of placeholder text through its styles', async () => {
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
  });

  it('types in any shape with text, but not over fields or numbering', async () => {
    const document = await open();
    // Under the picture or not: only the typed text is drawn over it, the slide stays as it is.
    const roadmap = byName(document, 3, 'Roadmap Visual');
    document.apply([
      { type: 'setBox', elementId: byName(document, 3, 'Title 1').id, box: roadmap.bbox },
    ]);
    expect(byName(document, 3, 'Title 1').live).not.toBeNull();
  });
});

describe('writing live elements', () => {
  it('writes formatted text that reads back the same', async () => {
    const document = await open();
    const title = byName(document, 1, 'Title 1');
    const paragraphs: RichParagraph[] = [
      {
        align: 'center',
        runs: [run('Agenda '), run('neu', { bold: true, color: '#c2410c', font: 'Arial' })],
      },
      { align: 'right', runs: [run('zweite Zeile\nmit Umbruch', { italic: true, size: 30 })] },
      { align: 'left', runs: [run('gesperrt', { caps: 'uppercase', letterSpacing: 2 })] },
    ];
    document.apply([{ type: 'setRichText', elementId: title.id, paragraphs }]);
    const again = await roundtrip(document);
    const live = byName(again, 1, 'Title 1').live!;
    expect(live.paragraphs.map((paragraph) => paragraph.align)).toEqual([
      'center',
      'right',
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
    ]);
  });

  it('keeps bullets and list items when the text gets more paragraphs', async () => {
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
  });

  it('shares equal styles instead of writing them again', async () => {
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
  });

  it('sets fill, border and vertical alignment in a style of the element’s own', async () => {
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
  });

  it('adds text boxes and boxes with the editor’s ids', async () => {
    const document = await open();
    document.apply([
      {
        type: 'addElement',
        slideIndex: 0,
        elementId: 'sltest-box',
        kind: 'rect',
        box: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
        fill: '#ff0000',
        stroke: null,
        paragraphs: [{ align: 'center', runs: [run('Box')] }],
      },
    ]);
    const added = (await roundtrip(document))
      .slides()[0]!
      .elements.find((element) => element.id === 'sltest-box')!;
    expect(added).toMatchObject({ kind: 'shape', name: 'Rechteck 1', paragraphs: ['Box'] });
    expect(added.bbox.x).toBeCloseTo(0.1, 3);
    expect(added.live).toMatchObject({ fill: '#ff0000', verticalAlign: 'middle', autoGrow: false });
    expect(() =>
      document.apply([
        {
          type: 'addElement',
          slideIndex: 0,
          elementId: 'sltest-box',
          kind: 'text',
          box: { x: 0, y: 0, w: 0.1, h: 0.1 },
          fill: null,
          stroke: null,
          paragraphs: [],
        },
      ]),
    ).toThrow(OdpError);
  });

  it('refuses formatted text on what is not live', async () => {
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
  });
});

describe('the picture typed over', () => {
  it('leaves out the text and keeps the shape', async () => {
    const document = await open();
    const hint = byName(document, 2, 'Hinweis');
    const blank = document.blankText(hint.id);
    expect(blank?.pageIndex).toBe(2);
    const after = (await roundtrip(document)).slides()[2]?.elements;
    expect(after?.map((element) => element.name)).toEqual(['Title 1', 'Tabelle Umsatz', 'Hinweis']);
    const left = after?.find((element) => element.name === 'Hinweis');
    expect(left?.paragraphs?.join('')).toBe('');
    expect(left?.live).toMatchObject({ fill: '#f1f5f9', autoGrow: false });
  });

  it('draws the same picture while only the text changes', async () => {
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
  });

  it('refuses what cannot be typed in', async () => {
    const document = await open();
    expect(document.blankText(byName(document, 2, 'Tabelle Umsatz').id)).toBeNull();
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
  it('draws the slide without its elements, then each element alone on white and on black', async () => {
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
  });

  it('names each part by what it shows – the same in another order, another once changed', async () => {
    const parts = async (change?: 'move' | 'box') => {
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
      const drawing = await document.toLayerBytes(2, () => null);
      const byId = new Map(drawing.elementIds.map((id, at) => [id, drawing.layers[at]]));
      return { background: drawing.background, byId, title: title.id };
    };
    const before = await parts();
    expect((await parts()).byId).toEqual(before.byId);
    const moved = await parts('move');
    expect(moved.background).toBe(before.background);
    expect(moved.byId).toEqual(before.byId);
    const boxed = await parts('box');
    expect(boxed.background).toBe(before.background);
    expect(boxed.byId.get(before.title)).not.toBe(before.byId.get(before.title));
    for (const [id, part] of before.byId) {
      if (id !== before.title) expect(boxed.byId.get(id)).toBe(part);
    }
  });
});

describe('cutouts for drawing an element live', () => {
  const idsOf = async (bytes: Uint8Array) => {
    const content = await (await OdpArchive.open(bytes)).readText('content.xml');
    return [...content.matchAll(/ xml:id="([^"]*)"/g)].map((match) => match[1]);
  };

  it('draws a shape alone, its area and its outline in black', async () => {
    const document = await open();
    const count = document.slides().length;
    const hint = byName(document, 2, 'Hinweis');
    const cut = (await document.toCutoutBytes(hint.id, () => null))!;
    // Nothing lies over it: its page twice.
    expect(cut).toMatchObject({ pages: [3, 4], above: false, plain: true });
    const copy = await OdpDocument.open(cut.bytes);
    const slides = copy.slides();
    expect(slides).toHaveLength(count + 1);
    expect(slides[2]!.elements.map((element) => element.name)).toEqual(['Hinweis']);
    expect(slides[3]!.elements.map((element) => element.name)).toEqual(['Hinweis']);
    expect(slides[2]!.elements[0]!.live).toMatchObject({ fill: '#000000', stroke: null });
    expect(slides[3]!.elements[0]!.live).toMatchObject({
      fill: null,
      stroke: { color: '#000000' },
    });
    expect(slides[2]!.elements[0]!.live!.paragraphs.flatMap((p) => p.runs)).toEqual([]);
    // Black also in its paragraph style, which LibreOffice draws over the shape's own fill …
    expect(await textStyleFills(cut.bytes, 'Hinweis')).toMatchObject([
      { fill: 'solid', color: '#000000' },
      { fill: 'none' },
    ]);
    // … on white pages, not the master's background presentation style.
    const content = await (await OdpArchive.open(cut.bytes)).readText('content.xml');
    const grounds = [...content.matchAll(/<draw:page [^>]*draw:style-name="([^"]*)"/g)]
      .slice(2, 4)
      .map(
        ([, name]) =>
          new RegExp(
            `style:name="${name}"><style:drawing-page-properties[^>]* draw:fill-color="([^"]*)"`,
          ).exec(content)?.[1],
      );
    expect(grounds).toEqual(['#ffffff', '#ffffff']);
    // Every other page is empty.
    for (const [index, slide] of slides.entries()) {
      if (index !== 2 && index !== 3) expect(slide.elements).toEqual([]);
    }
    const ids = await idsOf(cut.bytes);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('adds what lies over it, on white and on black', async () => {
    const document = await open();
    const title = byName(document, 2, 'Title 1');
    const cut = (await document.toCutoutBytes(title.id, () => null))!;
    expect(cut).toMatchObject({ pages: [3, 4, 5, 6], above: true });
    const slides = (await OdpDocument.open(cut.bytes)).slides();
    for (const index of [4, 5]) {
      expect(slides[index]!.elements.map((element) => element.name)).toEqual([
        'Tabelle Umsatz',
        'Hinweis',
      ]);
    }
  });

  it('names the same look the same, another look otherwise', async () => {
    const fingerprint = async (fill?: string) => {
      const document = await open();
      const hint = byName(document, 2, 'Hinweis');
      if (fill) document.apply([{ type: 'setShapeStyle', elementId: hint.id, fill }]);
      return (await document.toCutoutBytes(hint.id, () => null))!.fingerprint;
    };
    // Its own colours are not in the masks: another fill draws the same cutout.
    expect(await fingerprint()).toBe(await fingerprint());
    expect(await fingerprint('#123456')).toBe(await fingerprint());
    const moved = await open();
    const hint = byName(moved, 2, 'Hinweis');
    moved.apply([{ type: 'setBox', elementId: hint.id, box: { ...hint.bbox, x: 0.1 } }]);
    expect((await moved.toCutoutBytes(hint.id, () => null))!.fingerprint).not.toBe(
      await fingerprint(),
    );
  });

  it('leaves an element out of its slide, and what lies over it', async () => {
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
    const document = await withMacros();
    const cut = await document.toCutoutBytes(byName(document, 2, 'Hinweis').id, () => null);
    expect(await executable(cut!.bytes)).toEqual({ files: [], events: false });
  });
});
