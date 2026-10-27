import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { OdpDocument, OdpError, imageSize, isPackagePath, type OdpImage } from '../src';

const DEMO = new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url)));

const open = async () => {
  const document = await OdpDocument.open(DEMO);
  document.ensureIds();
  return document;
};

/** Writes and reads a document again, like a save and a later request do. */
const roundtrip = async (document: OdpDocument) => OdpDocument.open(await document.toBytes());

const byName = (document: OdpDocument, slide: number, name: string) => {
  const found = document.slides()[slide]?.elements.find((element) => element.name === name);
  if (!found) throw new Error(`no ${name} on slide ${slide}`);
  return found;
};

const byRole = (document: OdpDocument, slide: number, role: string) => {
  const found = document.slides()[slide]?.elements.find((element) => element.role === role);
  if (!found) throw new Error(`no ${role} on slide ${slide}`);
  return found;
};

function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y += 1) rows[y * (width * 3 + 1)] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe('reading', () => {
  it('lists the slides with their elements, kinds, titles and hidden state', async () => {
    const document = await open();
    const slides = document.slides();
    expect(slides.map((slide) => slide.title)).toEqual([
      'Q4 Strategie 2026',
      'Agenda',
      'Umsatz nach Region',
      'Produkt-Roadmap',
      expect.stringContaining('Backup'),
      'Vielen Dank',
    ]);
    expect(slides.map((slide) => slide.hidden)).toEqual([false, false, false, false, true, false]);

    expect(byName(document, 2, 'Tabelle Umsatz').kind).toBe('table');
    expect(byName(document, 2, 'Hinweis')).toMatchObject({
      kind: 'shape',
      paragraphs: ['Planwerte vorbehaltlich der Budgetfreigabe im Oktober.'],
      movable: true,
    });
    expect(byName(document, 3, 'Roadmap Visual').kind).toBe('image');
    expect(byName(document, 3, 'Meilensteine')).toMatchObject({
      kind: 'group',
      movable: true,
      resizable: false,
    });
    expect(byRole(document, 1, 'outline').paragraphs?.length).toBeGreaterThan(1);
  });

  it('normalises boxes to the page', async () => {
    const document = await open();
    const size = document.pageSize();
    expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
    const title = byRole(document, 2, 'title');
    expect(title.bbox.x).toBeCloseTo(2.328 / size.width, 4);
    expect(title.bbox.w).toBeCloseTo(29.209 / size.width, 4);
  });

  it('gives every element a unique id that survives writing the file', async () => {
    const document = await OdpDocument.open(DEMO);
    expect(document.slides()[0]?.elements[0]?.id).toBe('');
    expect(document.ensureIds()).toBeGreaterThan(10);
    const ids = document.slides().flatMap((slide) => slide.elements.map((element) => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    const again = await roundtrip(document);
    expect(again.slides().flatMap((slide) => slide.elements.map((element) => element.id))).toEqual(
      ids,
    );
    expect(again.ensureIds()).toBe(0);
  });

  it('refuses files that are no presentation', async () => {
    await expect(OdpDocument.open(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'corrupt',
    });
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
    const text = await zip.generateAsync({ type: 'uint8array' });
    await expect(OdpDocument.open(text)).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('operations', () => {
  it('replaces text keeping the paragraph and run style', async () => {
    const document = await open();
    const title = byRole(document, 2, 'title');
    document.apply([
      { type: 'setText', elementId: title.id, paragraphs: ['Umsatz 2026 – Rekord'] },
    ]);
    const again = await roundtrip(document);
    expect(byRole(again, 2, 'title').paragraphs).toEqual(['Umsatz 2026 – Rekord']);
  });

  it('adds and removes paragraphs, list items included', async () => {
    const document = await open();
    const outline = byRole(document, 1, 'outline');
    const before = outline.paragraphs ?? [];
    document.apply([
      {
        type: 'setText',
        elementId: outline.id,
        paragraphs: [...before, 'Neuer Punkt', 'Noch einer'],
      },
    ]);
    expect(byRole(document, 1, 'outline').paragraphs).toEqual([
      ...before,
      'Neuer Punkt',
      'Noch einer',
    ]);
    document.apply([{ type: 'setText', elementId: outline.id, paragraphs: ['Nur noch einer'] }]);
    const again = await roundtrip(document);
    expect(byRole(again, 1, 'outline').paragraphs).toEqual(['Nur noch einer']);
  });

  it('keeps spaces, tabs, line breaks and special characters', async () => {
    const document = await open();
    const note = byName(document, 2, 'Hinweis');
    const text = '  A <b> & "c"\tTab   drei\nZeile 2';
    document.apply([{ type: 'setText', elementId: note.id, paragraphs: [text] }]);
    const again = await roundtrip(document);
    expect(byName(again, 2, 'Hinweis').paragraphs).toEqual([text]);
  });

  it('moves and resizes an element, and moves a group with its parts', async () => {
    const document = await open();
    const picture = byName(document, 3, 'Roadmap Visual');
    const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.3 };
    document.apply([{ type: 'setBox', elementId: picture.id, box }]);
    const moved = byName(document, 3, 'Roadmap Visual').bbox;
    expect(moved.x).toBeCloseTo(0.2, 3);
    expect(moved.w).toBeCloseTo(0.4, 3);

    const group = byName(document, 3, 'Meilensteine');
    const target = { ...group.bbox, x: group.bbox.x - 0.1, y: group.bbox.y + 0.05 };
    document.apply([{ type: 'setBox', elementId: group.id, box: target }]);
    const shifted = byName(document, 3, 'Meilensteine').bbox;
    expect(shifted.x).toBeCloseTo(target.x, 3);
    expect(shifted.y).toBeCloseTo(target.y, 3);
    expect(shifted.w).toBeCloseTo(group.bbox.w, 3);
  });

  it('changes the fingerprint of the changed slide only', async () => {
    const document = await open();
    const before = document.fingerprints();
    document.apply([
      { type: 'setText', elementId: byRole(document, 2, 'title').id, paragraphs: ['Neu'] },
    ]);
    const after = document.fingerprints();
    expect(after.map((value, index) => value !== before[index])).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('swaps a picture, fits it into the frame and drops the unused old one', async () => {
    const document = await open();
    const picture = byName(document, 3, 'Roadmap Visual');
    const image: OdpImage = { bytes: png(40, 40), mediaType: 'image/png', width: 40, height: 40 };
    document.apply(
      [{ type: 'replaceImage', elementId: picture.id, imageId: 'new' }],
      new Map([['new', image]]),
    );
    const bytes = await document.toBytes();
    const zip = await JSZip.loadAsync(bytes);
    const pictures = Object.keys(zip.files).filter(
      (path) => path.startsWith('Pictures/') && path.endsWith('.png'),
    );
    expect(pictures).toHaveLength(1);
    expect(await zip.file('META-INF/manifest.xml')?.async('string')).toContain(pictures[0]);
    expect(await zip.file('content.xml')?.async('string')).toContain(pictures[0]);

    const again = await OdpDocument.open(bytes);
    const size = again.pageSize();
    const fitted = byName(again, 3, 'Roadmap Visual').bbox;
    // Square picture in a wide frame: as high as before, centred horizontally.
    expect(fitted.h).toBeCloseTo(picture.bbox.h, 3);
    expect(fitted.w * size.width).toBeCloseTo(fitted.h * size.height, 2);
    expect(fitted.x + fitted.w / 2).toBeCloseTo(picture.bbox.x + picture.bbox.w / 2, 3);
  });

  it('deletes an element', async () => {
    const document = await open();
    const note = byName(document, 2, 'Hinweis');
    document.apply([{ type: 'deleteElement', elementId: note.id }]);
    const again = await roundtrip(document);
    expect(again.slides()[2]?.elements.some((element) => element.name === 'Hinweis')).toBe(false);
  });

  it("moves an element in its slide's stacking order", async () => {
    const document = await open();
    const names = (doc: OdpDocument) => doc.slides()[2]!.elements.map((element) => element.name);
    const before = names(document);
    expect(before.slice(0, 3)).toEqual(['Title 1', 'Tabelle Umsatz', 'Hinweis']);
    const title = byName(document, 2, 'Title 1');
    // To the top: after every other element, still before notes and animations.
    document.apply([{ type: 'moveElement', elementId: title.id, to: before.length - 1 }]);
    let again = await roundtrip(document);
    expect(names(again)).toEqual([...before.slice(1), 'Title 1']);
    // And to the bottom again.
    again.apply([{ type: 'moveElement', elementId: title.id, to: 0 }]);
    again = await roundtrip(again);
    expect(names(again)).toEqual(before);
    const hint = byName(again, 2, 'Hinweis');
    again.apply([{ type: 'moveElement', elementId: hint.id, to: 1 }]);
    expect(names(again).slice(0, 3)).toEqual(['Title 1', 'Hinweis', 'Tabelle Umsatz']);
    expect(() =>
      again.apply([{ type: 'moveElement', elementId: hint.id, to: before.length }]),
    ).toThrow(/Ebenen/);
  });

  it('refuses operations that do not fit', async () => {
    const document = await open();
    const picture = byName(document, 3, 'Roadmap Visual');
    expect(() =>
      document.apply([{ type: 'setText', elementId: picture.id, paragraphs: ['x'] }]),
    ).toThrow(OdpError);
    expect(() => document.apply([{ type: 'deleteElement', elementId: 'nope' }])).toThrow(
      /keiner Folie/,
    );
    expect(() =>
      document.apply([{ type: 'replaceImage', elementId: picture.id, imageId: 'missing' }]),
    ).toThrow(/nochmal hochladen/);
  });
});

describe('slides as XML', () => {
  it('reads a slide, the styles it names and the deck’s catalog', async () => {
    const document = await open();
    const xml = document.slideXml(2);
    expect(xml).toMatch(/^<draw:page draw:name="Umsatz nach Region"/);
    const names = document.styleNamesOf(2);
    expect(names).toEqual(expect.arrayContaining(['dp1', 'pr4', 'P7']));
    expect(names).not.toContain('Title_20_and_20_Content');
    const { xml: styles, missing } = document.stylesXml(['pr4', 'nope']);
    expect(styles[0]).toMatch(/^<style:style style:name="pr4"/);
    expect(missing).toEqual(['nope']);
    expect(document.styleCatalog()).toContain('style:master-page Title_20_and_20_Content');
    expect(() => document.slideXml(9)).toThrow(OdpError);
  });

  it('replaces a slide with new styles, keeping ids unique and animations valid', async () => {
    const document = await open();
    const before = document.slides();
    const xml = document
      .slideXml(2)
      .replace('>Umsatz nach Region<', '>Umsatz im Blick<')
      .replace('draw:style-name="gr2"', 'draw:style-name="aiFill"')
      // A copy of another slide's id must not clash with it.
      .replace(/xml:id="[^"]+"/, `xml:id="${before[0]!.elements[0]!.id}"`);
    expect(
      document.addStyles(
        '<style:style style:name="aiFill" style:family="graphic" style:parent-style-name="objectwithoutfill"><style:graphic-properties draw:fill="solid" draw:fill-color="#2a6f4e"/></style:style>',
      ),
    ).toEqual(['aiFill']);
    document.replaceSlide(2, xml);
    const again = await roundtrip(document);
    const slides = again.slides();
    expect(slides[2]!.title).toBe('Umsatz im Blick');
    expect(again.slideXml(2)).toContain('draw:style-name="aiFill"');
    expect(again.stylesXml(['aiFill']).xml[0]).toContain('#2a6f4e');
    const ids = slides.flatMap((slide) => slide.elements.map((element) => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(Boolean)).toBe(true);
    expect(slides[0]!.fingerprint).toBe(before[0]!.fingerprint);
  });

  it('fills a shape with a picture of the file – a photo with rounded corners', async () => {
    const document = await open();
    const picture = 'Pictures/1000000000000140000000B4BC9E3B02.png';
    expect(
      document.addStyles(
        `<draw:fill-image draw:name="aiPhoto" xlink:href="${picture}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
          '<style:style style:name="aiRound" style:family="graphic"><style:graphic-properties draw:fill="bitmap" draw:fill-image-name="aiPhoto" style:repeat="stretch" draw:stroke="none"/></style:style>',
      ),
    ).toEqual(['aiPhoto', 'aiRound']);
    document.replaceSlide(
      2,
      document
        .slideXml(2)
        .replace(
          '</draw:page>',
          '<draw:rect draw:style-name="aiRound" draw:corner-radius="0.5cm" svg:x="2cm" svg:y="2cm" svg:width="8cm" svg:height="4.5cm"/></draw:page>',
        ),
    );
    const again = await roundtrip(document);
    expect(again.slideXml(2)).toContain('draw:corner-radius="0.5cm"');
    expect(again.stylesXml(['aiPhoto']).xml[0]).toContain(picture);
    expect(await again.picture(picture)).not.toBeNull();
    // A picture not in the file cannot fill a shape.
    expect(() =>
      document.addStyles('<draw:fill-image draw:name="aiNone" xlink:href="Pictures/x.png"/>'),
    ).toThrow(/no such file/);
  });

  it('embeds the fonts the file names for drawing, and keeps them in the drawing', async () => {
    const document = await open();
    const bytes = new Uint8Array(
      readFileSync(new URL('../../../fonts/google/NotoSans-Regular.ttf', import.meta.url)),
    );
    const face = { weight: 400 as const, italic: false, format: 'ttf' as const, bytes };
    expect(
      document.embedFonts([
        { ...face, family: 'noto sans' },
        { ...face, family: 'Noto Sans', weight: 700 },
        // Named nowhere in the file: not embedded.
        { ...face, family: 'Pacifico' },
      ]),
    ).toBe(2);
    const drawn = await JSZip.loadAsync(await document.toDrawingBytes([0], () => null));
    const fonts = Object.keys(drawn.files).filter(
      (name) => name.startsWith('Fonts/') && !name.endsWith('/'),
    );
    expect(fonts.sort()).toEqual(['Fonts/slider-1-400.ttf', 'Fonts/slider-1-700.ttf']);
    const styles = await drawn.file('styles.xml')!.async('string');
    expect(styles).toContain(
      'style:name="Slider embedded 1" svg:font-family="&apos;noto sans&apos;"',
    );
    expect(styles).toContain('<svg:font-face-uri xlink:href="Fonts/slider-1-400.ttf"');
    expect(await drawn.file('META-INF/manifest.xml')!.async('string')).toContain(
      'manifest:full-path="Fonts/slider-1-700.ttf"',
    );
  });

  it('refuses unknown styles, namespaces and files, and taken style names', async () => {
    const document = await open();
    const page = document.slideXml(2);
    expect(() =>
      document.replaceSlide(
        2,
        page.replace('presentation:style-name="pr4"', 'presentation:style-name="nope"'),
      ),
    ).toThrow(/nope.*no such style/);
    expect(() =>
      document.replaceSlide(2, page.replace('</draw:page>', '<foo:frame/></draw:page>')),
    ).toThrow(/Unknown namespace/);
    expect(() =>
      document.replaceSlide(
        2,
        page.replace(
          '</draw:page>',
          '<draw:frame><draw:image xlink:href="Pictures/x.png"/></draw:frame></draw:page>',
        ),
      ),
    ).toThrow(/no such file/);
    expect(() => document.replaceSlide(2, '<draw:frame/>')).toThrow(/exactly one <draw:page>/);
    expect(() => document.replaceSlide(2, '<draw:page>')).toThrow(OdpError);
    expect(() =>
      document.addStyles('<style:style style:name="pr4" style:family="presentation"/>'),
    ).toThrow(/exists already/);
    // Several styles one after another, as the AI writes them and as a stored change holds them.
    expect(
      document.addStyles(
        '<?xml version="1.0"?><style:style style:name="a1" style:family="graphic"/>\n<style:style style:name="a2" style:family="paragraph"/>',
      ),
    ).toEqual(['a1', 'a2']);
    // Written in the same session, it may be written again; stored, it is skipped.
    document.addStyles('<style:style style:name="mine" style:family="graphic"/>');
    expect(
      document.addStyles('<style:style style:name="mine" style:family="paragraph"/>', {
        replace: new Set(['mine']),
      }),
    ).toEqual(['mine']);
    expect(document.stylesXml(['mine']).xml).toHaveLength(1);
    expect(
      document.addStyles('<style:style style:name="mine" style:family="graphic"/>', {
        keepExisting: true,
      }),
    ).toEqual([]);
    expect(() => document.addStyles('<draw:frame draw:name="x"/>')).toThrow(/cannot be added/);
  });

  it('cleans what it is given: scripts, events, embedded data, links out', async () => {
    const document = await open();
    const page = document
      .slideXml(2)
      .replace(
        '>Umsatz nach Region<',
        '><text:a xlink:href="javascript:alert(1)">A</text:a><text:a xlink:href="https://example.com">B</text:a><',
      )
      .replace(
        '</draw:page>',
        '<office:event-listeners><presentation:event-listener script:event-name="dom:click" xlink:href="vnd.sun.star.script:x"/></office:event-listeners><draw:frame draw:layer="layout" svg:x="1cm" svg:y="1cm" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="https://example.com/track.png"><office:binary-data>AAAA</office:binary-data></draw:image></draw:frame></draw:page>',
      );
    document.replaceSlide(2, page);
    const xml = document.slideXml(2);
    expect(xml).not.toContain('javascript:');
    expect(xml).toContain('xlink:href="https://example.com"');
    expect(xml).not.toContain('event-listener');
    expect(xml).not.toContain('binary-data');
    expect(xml).not.toContain('track.png');
  });

  it('finds text and XML in slides and styles, any case', async () => {
    const document = await open();
    const { places, total } = document.search('umsatz nach region');
    expect(total).toBeGreaterThan(0);
    expect(places.map((place) => place.where)).toContain('slide 3');
    expect(places[0]?.excerpt).toMatch(/Umsatz nach Region/);
    expect(document.search('Pictures/1000000000000140000000B4BC9E3B02').places[0]?.where).toBe(
      'slide 4',
    );
    expect(
      document
        .search('style:master-page')
        .places.some((place) => place.where.startsWith('style:master-page')),
    ).toBe(true);
    expect(document.search('nicht-im-deck').total).toBe(0);
    expect(document.search('').total).toBe(0);
    const capped = document.search('draw:', 3);
    expect(capped.places).toHaveLength(3);
    expect(capped.total).toBeGreaterThan(3);
  });

  it('lists the pictures, who shows them and how large they are', async () => {
    const document = await open();
    const pictures = await document.pictures();
    const roadmap = pictures.find((picture) => picture.path.endsWith('B4BC9E3B02.png'));
    expect(roadmap).toMatchObject({
      mediaType: 'image/png',
      width: 320,
      height: 180,
      usedBy: ['slide 4'],
    });
    expect(roadmap?.bytes).toBeGreaterThan(0);
    expect(await document.picture(roadmap?.path ?? '')).toBeInstanceOf(Uint8Array);
    expect(await document.picture('content.xml')).toBeNull();
    expect(await document.picture('Pictures/../content.xml')).toBeNull();
  });

  it('adds a picture once, for a slide written to show it', async () => {
    const document = await open();
    const bytes = png(40, 30);
    const path = document.addPicture(bytes, 'image/png');
    expect(document.addPicture(bytes, 'image/png')).toBe(path);
    expect(() => document.addPicture(bytes, 'image/svg+xml')).toThrow(OdpError);
    const xml = document
      .slideXml(3)
      .replace(/Pictures\/1000000000000140000000B4BC9E3B02\.png/, path);
    document.replaceSlide(3, xml);
    const again = await roundtrip(document);
    const listed = await again.pictures();
    expect(listed.find((picture) => picture.path === path)).toMatchObject({
      width: 40,
      height: 30,
      usedBy: ['slide 4'],
    });
    // The old picture no slide shows any more is gone.
    expect(listed.some((picture) => picture.path.endsWith('B4BC9E3B02.png'))).toBe(false);
  });

  it('takes a slide back as it was, without checks', async () => {
    const document = await open();
    const before = document.slideXml(2);
    document.replaceSlide(2, before.replace('>Umsatz nach Region<', '>Neu<'));
    document.replaceSlide(2, before, { trusted: true });
    expect(document.slideXml(2)).toBe(before);
  });
});

describe('slides moving', () => {
  const titles = (document: OdpDocument) => document.slides().map((slide) => slide.title);

  it('gives every slide a page id – the same for the same file – kept when it is rewritten', async () => {
    const document = await open();
    const ids = document.pageIds();
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids.every((id) => id.startsWith('sl'))).toBe(true);
    expect((await open()).pageIds()).toEqual(ids);
    expect(document.slides()[2]?.pageId).toBe(ids[2]);
    const fingerprints = (await OdpDocument.open(DEMO)).fingerprints();
    expect(document.fingerprints()).toEqual(fingerprints);
    document.replaceSlide(2, document.slideXml(2).replace(/ xml:id="[^"]*"/, ''));
    expect(document.pageIds()[2]).toBe(ids[2]);
  });

  it('inserts, removes and moves slides', async () => {
    const document = await open();
    const ids = document.pageIds();
    const xml = document
      .slideXml(1)
      .replace('draw:name="Agenda"', 'draw:name="Neu"')
      .replace(/ xml:id="[^"]*"/g, '');
    const added = document.insertSlide(1, xml);
    expect(document.pageIds()).toEqual([ids[0], added, ...ids.slice(1)]);
    expect(ids).not.toContain(added);
    document.removeSlide(4);
    document.moveSlide(0, 4);
    const again = await roundtrip(document);
    expect(again.pageIds()).toEqual([added, ids[1], ids[2], ids[4], ids[0], ids[5]]);
    expect(titles(again)[4]).toBe('Q4 Strategie 2026');
    expect(() => document.insertSlide(9, xml)).toThrow(/position/);
    expect(() => document.insertSlide(0, xml.replace('dp1', 'nope'))).toThrow(/nope/);
    expect(() => document.insertSlide(0, xml, { trusted: true })).toThrow(/page id/);
    expect(() => document.moveSlide(0, 6)).toThrow(/position/);
  });

  it('copies a slide with ids of its own, animations following', async () => {
    const document = await open();
    const target = byRole(document, 2, 'title').id;
    const animated = document
      .slideXml(2)
      .replace(
        '</draw:page>',
        `<anim:par presentation:node-type="timing-root"><anim:seq presentation:node-type="main-sequence"><anim:par presentation:node-type="on-click"><anim:set smil:targetElement="${target}" smil:attributeName="visibility" smil:to="visible"/></anim:par></anim:seq></anim:par></draw:page>`,
      );
    document.replaceSlide(2, animated);
    const copy = document.duplicateSlide(2);
    const again = await roundtrip(document);
    expect(again.pageIds()[3]).toBe(copy);
    const original = again.slides()[2]!;
    const copied = again.slides()[3]!;
    expect(copied.name).toBe('Umsatz nach Region (2)');
    expect(copied.title).toBe(original.title);
    const ids = (slide: typeof original) => slide.elements.map((element) => element.id);
    expect(ids(copied).some((id) => ids(original).includes(id))).toBe(false);
    const copiedTitle = copied.elements.find((element) => element.role === 'title')!.id;
    expect(again.slideXml(3)).toContain(`smil:targetElement="${copiedTitle}"`);
    expect(again.slideXml(2)).toContain(`smil:targetElement="${target}"`);
  });

  it('arranges slides by page id – rewritten, put back, left out', async () => {
    const document = await open();
    const ids = document.pageIds();
    const removed = document.slideXml(4);
    const changed = document.slideXml(2).replace('>Umsatz nach Region<', '>Anders<');
    document.removeSlide(4);
    document.arrange(
      [ids[2]!, ids[0]!, ids[4]!, ids[1]!],
      new Map([
        [ids[2]!, changed],
        [ids[4]!, removed],
      ]),
    );
    const again = await roundtrip(document);
    expect(again.pageIds()).toEqual([ids[2], ids[0], ids[4], ids[1]]);
    expect(titles(again)[0]).toBe('Anders');
    expect(titles(again)[2]).toBe('Backup: Detailzahlen pro Land');
    expect(() => document.arrange(['nope'], new Map())).toThrow(/no slide/);
    expect(() => document.arrange([], new Map())).toThrow(OdpError);
  });

  it('keeps the last slide', async () => {
    const document = await open();
    for (let i = 0; i < 5; i += 1) document.removeSlide(0);
    expect(() => document.removeSlide(0)).toThrow(/last slide/);
  });

  it('hides and shows a slide with a page style of its own', async () => {
    const document = await open();
    const hidden = () => document.slides().map((slide) => slide.hidden);
    document.apply([{ type: 'setSlideHidden', slideIndex: 1, hidden: true }]);
    expect(hidden()).toEqual([false, true, false, false, true, false]);
    document.apply([{ type: 'setSlideHidden', slideIndex: 4, hidden: false }]);
    expect(hidden()).toEqual([false, true, false, false, false, false]);
    const fingerprint = document.slides()[2]!.fingerprint;
    document.apply([{ type: 'setSlideHidden', slideIndex: 2, hidden: false }]);
    expect(document.slides()[2]!.fingerprint).toBe(fingerprint);
    const again = await roundtrip(document);
    expect(again.slides().map((slide) => slide.hidden)).toEqual(hidden());
  });

  it('deletes and moves slides as operations, page ids staying', async () => {
    const document = await OdpDocument.open(DEMO);
    const ids = (await open()).pageIds();
    document.apply([
      { type: 'moveSlide', slideIndex: 0, to: 2 },
      { type: 'deleteSlide', slideIndex: 5 },
    ]);
    expect(document.pageIds()).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);
    for (let i = 0; i < 4; i += 1) document.apply([{ type: 'deleteSlide', slideIndex: 0 }]);
    expect(() => document.apply([{ type: 'deleteSlide', slideIndex: 0 }])).toThrow(/letzte Folie/);
    expect(() => document.apply([{ type: 'moveSlide', slideIndex: 3, to: 0 }])).toThrow(OdpError);
  });
});

describe('writing', () => {
  it('puts mimetype first and uncompressed', async () => {
    const document = await open();
    const bytes = await document.toBytes();
    // Local file header: name at offset 30, compression method at offset 8 (0 = stored).
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe('mimetype');
    expect(bytes[8]).toBe(0);
  });

  it('removes links LibreOffice could follow, keeping hyperlinks', async () => {
    const zip = await JSZip.loadAsync(DEMO);
    const content = (await zip.file('content.xml')!.async('string'))
      .replace('Pictures/1000000000000140000000B4BC9E3B02.png', 'https://example.com/track.png')
      .replace(
        'Planwerte vorbehaltlich',
        '<text:a xlink:type="simple" xlink:href="https://example.com">Planwerte</text:a> vorbehaltlich',
      );
    zip.file('content.xml', content);
    const document = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
    // The linked picture, plus the (empty) scripts element LibreOffice always writes.
    expect(document.removeExternalLinks()).toBe(2);
    const written = await (
      await JSZip.loadAsync(await document.toBytes())
    )
      .file('content.xml')!
      .async('string');
    expect(written).not.toContain('track.png');
    expect(written).toContain('xlink:href="https://example.com"');
  });

  it('removes links out of embedded objects and click actions to anything but the web', async () => {
    const zip = await JSZip.loadAsync(DEMO);
    const content = (await zip.file('content.xml')!.async('string')).replace(
      'Planwerte vorbehaltlich',
      '<text:a xlink:type="simple" xlink:href="vnd.sun.star.script:Standard.M.Main?language=Basic&amp;location=document">Planwerte</text:a> vorbehaltlich',
    );
    zip.file(
      'content.xml',
      content.replace(
        '</draw:page>',
        '<office:event-listeners><presentation:event-listener script:event-name="dom:click" presentation:action="execute" xlink:href="calc.exe"/><presentation:event-listener script:event-name="dom:click" presentation:action="show" xlink:href="https://example.com/next"/><presentation:event-listener script:event-name="dom:click" presentation:action="show" xlink:href="file:///etc/passwd"/></office:event-listeners></draw:page>',
      ),
    );
    zip.file(
      'Object 1/content.xml',
      '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"><office:body><draw:image xlink:href="file:///etc/passwd"/><draw:image xlink:href="Pictures/a.png"/></office:body></office:document-content>',
    );
    const document = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
    document.removeExternalLinks();
    const written = await JSZip.loadAsync(await document.toBytes());
    const main = await written.file('content.xml')!.async('string');
    expect(main).not.toContain('vnd.sun.star.script');
    expect(main).not.toContain('calc.exe');
    expect(main).not.toContain('file:///etc/passwd');
    expect(main).toContain('xlink:href="https://example.com/next"');
    const object = await written.file('Object 1/content.xml')!.async('string');
    expect(object).not.toContain('file:///');
    expect(object).toContain('xlink:href="Pictures/a.png"');
  });

  it('tells package paths from links', () => {
    expect(isPackagePath('Pictures/a.png')).toBe(true);
    expect(isPackagePath('./Object 1')).toBe(true);
    expect(isPackagePath('../secret.png')).toBe(false);
    expect(isPackagePath('/etc/passwd')).toBe(false);
    expect(isPackagePath('file:///etc/passwd')).toBe(false);
    expect(isPackagePath('https://example.com/a.png')).toBe(false);
  });
});

describe('imageSize', () => {
  it('reads PNG, GIF, JPEG and WebP headers', () => {
    expect(imageSize(png(64, 48))).toEqual({ mediaType: 'image/png', width: 64, height: 48 });
    const gif = new Uint8Array([...Buffer.from('GIF89a'), 10, 0, 20, 0]);
    expect(imageSize(gif)).toEqual({ mediaType: 'image/gif', width: 10, height: 20 });
    // SOI, an APP0 segment, then SOF0 with height 300, width 400.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c,
      0x01, 0x90, 0x03, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(imageSize(jpeg)).toEqual({ mediaType: 'image/jpeg', width: 400, height: 300 });
    const webp = new Uint8Array(30);
    webp.set(Buffer.from('RIFF'), 0);
    webp.set(Buffer.from('WEBPVP8X'), 8);
    webp.set([199, 0, 0], 24); // width − 1
    webp.set([99, 0, 0], 27); // height − 1
    expect(imageSize(webp)).toEqual({ mediaType: 'image/webp', width: 200, height: 100 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('isOdpBytes', () => {
  it('tells an ODP by its first bytes', async () => {
    const { isOdpBytes } = await import('../src');
    expect(isOdpBytes(DEMO)).toBe(true);
    expect(isOdpBytes(await (await open()).toBytes())).toBe(true);
    expect(isOdpBytes(new TextEncoder().encode('%PDF-1.7'))).toBe(false);
  });
});
