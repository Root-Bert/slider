import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { shapeAreaSteps, shapeOutlinePath } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { OdpDocument, OdpError, imageSize, isPackagePath, type OdpImage } from '../src';
import { OdpArchive } from '../src/archive';

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
  it('lists slides with elements, kinds, titles, hidden state and normalised boxes, unique ids surviving a save – refusing other files', async () => {
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
    // Normalises boxes to the page.
    {
      const document = await open();
      const size = document.pageSize();
      expect(size.width / size.height).toBeCloseTo(16 / 9, 2);
      const title = byRole(document, 2, 'title');
      expect(title.bbox.x).toBeCloseTo(2.328 / size.width, 4);
      expect(title.bbox.w).toBeCloseTo(29.209 / size.width, 4);
    }
    // Gives every element a unique id that survives writing the file.
    {
      const document = await OdpDocument.open(DEMO);
      expect(document.slides()[0]?.elements[0]?.id).toBe('');
      expect(document.ensureIds()).toBeGreaterThan(10);
      const ids = document.slides().flatMap((slide) => slide.elements.map((element) => element.id));
      expect(new Set(ids).size).toBe(ids.length);
      const again = await roundtrip(document);
      expect(
        again.slides().flatMap((slide) => slide.elements.map((element) => element.id)),
      ).toEqual(ids);
      expect(again.ensureIds()).toBe(0);
    }

    // Refuses files that are no presentation.
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
  it('replaces and adds text keeping paragraph, run and list styles, spaces and special characters', async () => {
    const document = await open();
    const title = byRole(document, 2, 'title');
    document.apply([
      { type: 'setText', elementId: title.id, paragraphs: ['Umsatz 2026 – Rekord'] },
    ]);
    const again = await roundtrip(document);
    expect(byRole(again, 2, 'title').paragraphs).toEqual(['Umsatz 2026 – Rekord']);
    // Adds and removes paragraphs, list items included.
    {
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
    }
    // Keeps spaces, tabs, line breaks and special characters.
    {
      const document = await open();
      const note = byName(document, 2, 'Hinweis');
      const text = '  A <b> & "c"\tTab   drei\nZeile 2';
      document.apply([{ type: 'setText', elementId: note.id, paragraphs: [text] }]);
      const again = await roundtrip(document);
      expect(byName(again, 2, 'Hinweis').paragraphs).toEqual([text]);
    }
  });

  it('moves, resizes, turns and mirrors elements – groups move with their parts but do not turn', async () => {
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
    // Turns an element around its centre and back, its box kept.
    {
      const document = await open();
      const note = byName(document, 2, 'Hinweis');
      expect(note.rotation).toBe(0);
      document.apply([{ type: 'setBox', elementId: note.id, box: note.bbox, rotation: 30 }]);
      const turned = byName(await roundtrip(document), 2, 'Hinweis');
      expect(turned.rotation).toBeCloseTo(30, 3);
      expect(turned.movable).toBe(true);
      expect(turned.live).not.toBeNull();
      for (const key of ['x', 'y', 'w', 'h'] as const) {
        expect(turned.bbox[key]).toBeCloseTo(note.bbox[key], 3);
      }
      // Moved while turned: it keeps its turn.
      const box = { ...note.bbox, x: note.bbox.x + 0.1 };
      document.apply([{ type: 'setBox', elementId: note.id, box }]);
      const moved = byName(await roundtrip(document), 2, 'Hinweis');
      expect(moved.rotation).toBeCloseTo(30, 3);
      expect(moved.bbox.x).toBeCloseTo(box.x, 3);
      // -90 is 270; 360 is none – and the transform goes.
      document.apply([{ type: 'setBox', elementId: note.id, box, rotation: -90 }]);
      expect(byName(document, 2, 'Hinweis').rotation).toBeCloseTo(270, 3);
      document.apply([{ type: 'setBox', elementId: note.id, box, rotation: 360 }]);
      expect(byName(document, 2, 'Hinweis').rotation).toBe(0);
      const content = await (
        await OdpArchive.open(await document.toBytes())
      ).readText('content.xml');
      expect(content).not.toContain('rotate (');
    }
    // Does not turn a group.
    {
      const document = await open();
      const group = byName(document, 3, 'Meilensteine');
      expect(() =>
        document.apply([{ type: 'setBox', elementId: group.id, box: group.bbox, rotation: 45 }]),
      ).toThrow(OdpError);
    }
    // Mirrors pictures and drawn shapes, not text frames.
    {
      const document = await open();
      const note = byName(document, 2, 'Hinweis');
      const picture = byName(document, 3, 'Roadmap Visual');
      const title = byName(document, 2, 'Title 1');
      expect(note.flip).toEqual({ x: false, y: false });
      expect(picture.flip).toEqual({ x: false, y: false });
      expect(title.flip).toBeNull();

      document.apply([
        { type: 'setBox', elementId: note.id, box: note.bbox, flip: { x: true, y: true } },
        { type: 'setBox', elementId: picture.id, box: picture.bbox, flip: { x: true, y: false } },
      ]);
      const again = await roundtrip(document);
      expect(byName(again, 2, 'Hinweis').flip).toEqual({ x: true, y: true });
      expect(byName(again, 3, 'Roadmap Visual').flip).toEqual({ x: true, y: false });
      expect(byName(again, 3, 'Roadmap Visual').rotation).toBe(0);

      // A picture mirrored top to bottom: turned half round, mirrored left to right instead.
      const mirrored = byName(again, 3, 'Roadmap Visual');
      again.apply([
        { type: 'setBox', elementId: mirrored.id, box: mirrored.bbox, flip: { x: true, y: true } },
      ]);
      const upside = byName(await roundtrip(again), 3, 'Roadmap Visual');
      expect(upside.flip).toEqual({ x: false, y: false });
      expect(upside.rotation).toBeCloseTo(180, 3);
      for (const key of ['x', 'y', 'w', 'h'] as const) {
        expect(upside.bbox[key]).toBeCloseTo(mirrored.bbox[key], 3);
      }

      expect(() =>
        document.apply([
          { type: 'setBox', elementId: title.id, box: title.bbox, flip: { x: true, y: false } },
        ]),
      ).toThrow(OdpError);
    }
    // Locks any element in place – as LibreOffice's „Position und Größe schützen“ – and unlocks it.
    {
      const document = await open();
      const note = byName(document, 2, 'Hinweis');
      const title = byName(document, 2, 'Title 1');
      const picture = byName(document, 3, 'Roadmap Visual');
      const group = byName(document, 3, 'Meilensteine');
      for (const element of [note, title, picture, group]) expect(element.locked).toBeUndefined();
      document.apply(
        [note, title, picture, group].map((element) => ({
          type: 'setLocked' as const,
          elementId: element.id,
          locked: true,
        })),
      );
      const again = await roundtrip(document);
      expect(byName(again, 2, 'Hinweis').locked).toBe(true);
      expect(byName(again, 2, 'Title 1').locked).toBe(true);
      expect(byName(again, 3, 'Roadmap Visual').locked).toBe(true);
      expect(byName(again, 3, 'Meilensteine').locked).toBe(true);
      // Only the lock changed: still moved and typed in as before (by the file, the AI).
      expect(byName(again, 2, 'Hinweis').live).toEqual(note.live);
      expect(byName(again, 2, 'Hinweis').look).toEqual(note.look);
      const content = await (await OdpArchive.open(await again.toBytes())).readText('content.xml');
      expect(content).toContain('style:protect="position size"');
      again.apply([{ type: 'setLocked', elementId: note.id, locked: false }]);
      const unlocked = await roundtrip(again);
      expect(byName(unlocked, 2, 'Hinweis').locked).toBeUndefined();
      expect(byName(unlocked, 2, 'Title 1').locked).toBe(true);
      // Kept in place by whoever asks: not moved or tilted, still typed in.
      const locked = byName(unlocked, 2, 'Title 1');
      expect(() =>
        unlocked.apply([
          { type: 'setBox', elementId: locked.id, box: { ...locked.bbox, x: locked.bbox.x + 0.1 } },
        ]),
      ).toThrow('gesperrt');
      expect(() =>
        unlocked.apply([{ type: 'setTilt', elementId: locked.id, tilt: null, picture: null }]),
      ).toThrow('gesperrt');
      unlocked.apply([{ type: 'setText', elementId: locked.id, paragraphs: ['Neu'] }]);
      // A slide written from outside (the AI) keeps it where it is – or leaves it out.
      const xml = unlocked.slideXml(2);
      const tag = /<draw:frame[^>]*draw:name="Title 1"[^>]*>/.exec(xml)![0];
      const moved = xml.replace(tag, tag.replace(/svg:x="[^"]*"/, 'svg:x="0.5cm"'));
      expect(() => unlocked.replaceSlide(2, moved)).toThrow('Title 1');
      unlocked.replaceSlide(2, xml);
    }
    // What the file protected before stays: a frame protected in size is so again once unlocked.
    {
      const protectOf = async (bytes: Uint8Array) => {
        const content = await (await JSZip.loadAsync(bytes)).file('content.xml')!.async('string');
        const tag = /<draw:[a-z-]+ [^>]*draw:name="Hinweis"[^>]*>/.exec(content)![0];
        const name = /draw:style-name="([^"]+)"/.exec(tag)![1];
        const style = new RegExp(
          `<style:style [^>]*style:name="${name}"[^>]*>.*?</style:style>`,
          's',
        ).exec(content)![0];
        return { content, style, protect: /style:protect="([^"]*)"/.exec(style)?.[1] };
      };
      const document = await open();
      const first = await protectOf(await document.toBytes());
      expect(first.protect).toBeUndefined();
      const sized = first.content.replace(
        first.style,
        first.style.replace(
          '<style:graphic-properties',
          '<style:graphic-properties style:protect="size"',
        ),
      );
      const zip = await JSZip.loadAsync(await document.toBytes());
      zip.file('content.xml', sized);
      const file = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
      const note = byName(file, 2, 'Hinweis');
      file.apply([{ type: 'setLocked', elementId: note.id, locked: true }]);
      expect((await protectOf(await file.toBytes())).protect).toBe('size position');
      file.apply([{ type: 'setLocked', elementId: note.id, locked: false }]);
      const after = await protectOf(await file.toBytes());
      expect(after.protect).toBe('size');
      expect(after.content).not.toContain('slider:protect-before');
    }
  });

  it('tilts an element: unseen in the file, its picture over it and kept with copies of it and its slide', async () => {
    const document = await open();
    const note = byName(document, 2, 'Hinweis');
    const count = document.slides()[2]!.elements.length;
    const image: OdpImage = { bytes: png(40, 40), mediaType: 'image/png', width: 40, height: 40 };
    const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };
    document.apply(
      [
        {
          type: 'setTilt',
          elementId: note.id,
          tilt: { x: 20, y: -30 },
          picture: { imageId: 'tilted', box },
        },
      ],
      new Map([['tilted', image]]),
    );
    const again = await roundtrip(document);
    const tilted = byName(again, 2, 'Hinweis');
    expect(tilted.tilt).toEqual({ x: 20, y: -30 });
    // Typed on the slide all the same, tilted.
    expect(tilted.live).not.toBeNull();
    // Its picture typed over leaves out its tilted picture too.
    const blank = await roundtrip(again);
    expect(blank.blankText(note.id)).not.toBeNull();
    const blanked = await (await OdpArchive.open(await blank.toBytes())).readText('content.xml');
    expect(blanked).not.toContain('Hinweis (3D)');
    // The picture is no element of its own.
    expect(again.slides()[2]!.elements).toHaveLength(count);
    const content = await (await OdpArchive.open(await again.toBytes())).readText('content.xml');
    expect(content).toContain('draw:display="none"');
    expect(content).toContain('Hinweis (3D)');

    // Moved and stacked with it, deleted with it.
    again.apply([{ type: 'moveElement', elementId: note.id, to: 0 }]);
    expect(byName(again, 2, 'Hinweis').tilt).toEqual({ x: 20, y: -30 });
    again.apply([{ type: 'setTilt', elementId: note.id, tilt: null, picture: null }]);
    const flat = byName(await roundtrip(again), 2, 'Hinweis');
    expect(flat.tilt).toBeNull();
    expect(flat.live).not.toBeNull();
    const after = await (await OdpArchive.open(await again.toBytes())).readText('content.xml');
    expect(after).not.toContain('Hinweis (3D)');
    expect(after).not.toContain('draw:display="none"');
    // Keeps a tilted element’s picture with its copy when the slide is duplicated.
    {
      const document = await open();
      const note = byName(document, 2, 'Hinweis');
      const image: OdpImage = { bytes: png(40, 40), mediaType: 'image/png', width: 40, height: 40 };
      document.apply(
        [
          {
            type: 'setTilt',
            elementId: note.id,
            tilt: { x: 10, y: 10 },
            picture: { imageId: 'tilted', box: note.bbox },
          },
          {
            type: 'duplicateSlide',
            pageId: document.pageIds()[2]!,
            newPageId: 'sl-copy',
            after: document.pageIds()[2]!,
          },
        ],
        new Map([['tilted', image]]),
      );
      const copy = byName(document, 3, 'Hinweis');
      expect(copy.id).not.toBe(note.id);
      expect(copy.tilt).toEqual({ x: 10, y: 10 });
      expect(document.slides()[3]!.elements).toHaveLength(document.slides()[2]!.elements.length);
    }
    // Copies a tilted element with a picture of its own.
    {
      const document = await open();
      const note = byName(document, 2, 'Hinweis');
      const image: OdpImage = { bytes: png(40, 40), mediaType: 'image/png', width: 40, height: 40 };
      const pageId = document.pageIds()[1]!;
      document.apply(
        [
          {
            type: 'setTilt',
            elementId: note.id,
            tilt: { x: 10, y: 10 },
            picture: { imageId: 'tilted', box: note.bbox },
          },
          {
            type: 'copyElement',
            elementId: note.id,
            pageId,
            newElementId: 'sl-tilt',
            box: note.bbox,
          },
        ],
        new Map([['tilted', image]]),
      );
      const again = await roundtrip(document);
      const copy = again.slides()[1]!.elements.find((element) => element.id === 'sl-tilt');
      expect(copy?.tilt).toEqual({ x: 10, y: 10 });
      // A pasted copy keeps who it was, for the morph transition.
      expect(copy?.morphKey).toBe(note.id);
      expect(byName(again, 2, 'Hinweis').tilt).toEqual({ x: 10, y: 10 });
      const content = await (await OdpArchive.open(await again.toBytes())).readText('content.xml');
      expect(content.match(/Hinweis \(3D\)/g)).toHaveLength(2);
    }
  });

  it('copies, deletes and restacks elements, copies getting ids of their own', async () => {
    const document = await open();
    const note = byName(document, 2, 'Hinweis');
    const group = byName(document, 3, 'Meilensteine');
    const box = { ...note.bbox, x: note.bbox.x + 0.02, y: note.bbox.y + 0.03 };
    const pageIds = document.pageIds();
    document.apply([
      {
        type: 'copyElement',
        elementId: note.id,
        pageId: pageIds[2]!,
        newElementId: 'sl-note',
        box,
      },
      {
        type: 'copyElement',
        elementId: group.id,
        pageId: pageIds[0]!,
        newElementId: 'sl-group',
        box: group.bbox,
      },
    ]);
    const again = await roundtrip(document);
    const copy = again.slides()[2]!.elements.at(-1)!;
    expect(copy.id).toBe('sl-note');
    expect(copy.paragraphs).toEqual(note.paragraphs);
    expect(copy.bbox.x).toBeCloseTo(box.x, 3);
    expect(copy.bbox.y).toBeCloseTo(box.y, 3);
    expect(byName(again, 2, 'Hinweis').id).toBe(note.id);
    const groupCopy = again.slides()[0]!.elements.at(-1)!;
    expect(groupCopy.id).toBe('sl-group');
    expect(groupCopy.kind).toBe(group.kind);
    expect(groupCopy.bbox.w).toBeCloseTo(group.bbox.w, 3);
    // No id twice in the file.
    const content = await (await OdpArchive.open(await again.toBytes())).readText('content.xml');
    const ids = [...content.matchAll(/xml:id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // An id taken, a source gone: does not fit.
    expect(() =>
      again.apply([
        {
          type: 'copyElement',
          elementId: note.id,
          pageId: pageIds[2]!,
          newElementId: 'sl-note',
          box,
        },
      ]),
    ).toThrow(OdpError);
    expect(() =>
      again.apply([
        { type: 'copyElement', elementId: 'gone', pageId: pageIds[2]!, newElementId: 'sl-x', box },
      ]),
    ).toThrow(OdpError);
    // Deletes an element.
    {
      const document = await open();
      const note = byName(document, 2, 'Hinweis');
      document.apply([{ type: 'deleteElement', elementId: note.id }]);
      const again = await roundtrip(document);
      expect(again.slides()[2]?.elements.some((element) => element.name === 'Hinweis')).toBe(false);
    }
    // Copied back once gone (cut, or deleted after ⌘C): from the file before, its picture along –
    // which the file lost on saving without it.
    {
      const document = await open();
      const image: OdpImage = { bytes: png(40, 40), mediaType: 'image/png', width: 40, height: 40 };
      const page = document.pageIds()[1]!;
      const photoBox = { x: 0.1, y: 0.2, w: 0.3, h: 0.3 };
      document.apply(
        [{ type: 'addImage', pageId: page, elementId: 'sl-photo', box: photoBox, imageId: 'new' }],
        new Map([['new', image]]),
      );
      const before = await document.toBytes();
      const cut = await OdpDocument.open(before);
      const note = byName(cut, 2, 'Hinweis');
      cut.apply([
        { type: 'deleteElement', elementId: 'sl-photo' },
        { type: 'deleteElement', elementId: note.id },
      ]);
      const cutBytes = await cut.toBytes();
      const picturesOf = async (file: Uint8Array) =>
        Object.keys((await JSZip.loadAsync(file)).files).filter((path) =>
          path.startsWith('Pictures/'),
        );
      const kept = await picturesOf(cutBytes);
      const lost = (await picturesOf(before)).filter((path) => !kept.includes(path));
      expect(lost).toHaveLength(1);
      const now = await OdpDocument.open(cutBytes);
      const earlier = await OdpDocument.open(before);
      const sources = new Map();
      for (const id of ['sl-photo', note.id]) sources.set(id, await earlier.elementSource(id));
      expect(await now.elementSource('sl-photo')).toBeNull();
      now.apply(
        [
          {
            type: 'copyElement',
            elementId: 'sl-photo',
            pageId: page,
            newElementId: 'sl-back',
            box,
          },
          { type: 'copyElement', elementId: note.id, pageId: page, newElementId: 'sl-note2', box },
        ],
        new Map(),
        new Map(),
        sources,
      );
      const bytes = await now.toBytes();
      const back = await OdpDocument.open(bytes);
      const elements = back.slides()[1]!.elements;
      expect(elements.find((element) => element.id === 'sl-back')?.kind).toBe('image');
      expect(elements.find((element) => element.id === 'sl-note2')?.paragraphs).toEqual(
        note.paragraphs,
      );
      const zip = await JSZip.loadAsync(bytes);
      expect(await picturesOf(bytes)).toContain(lost[0]);
      expect(await zip.file('content.xml')!.async('string')).toContain(lost[0]);
      expect(await zip.file('META-INF/manifest.xml')?.async('string')).toContain(lost[0]);
    }
    // Moves an element in its slide's stacking order.
    {
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
    }
    // Groups elements into a `draw:g` where the topmost was, each keeping its id and place – a
    // turned one too, the group still moving –, and takes it apart again in their order.
    {
      let document = await open();
      const ids = (doc: OdpDocument) => doc.slides()[2]!.elements.map((element) => element.id);
      const before = ids(document);
      const title = byName(document, 2, 'Title 1');
      const hint = byName(document, 2, 'Hinweis');
      document.apply([{ type: 'setBox', elementId: hint.id, box: hint.bbox, rotation: 30 }]);
      document = await roundtrip(document);
      document.apply([
        { type: 'groupElements', elementIds: [hint.id, title.id], newElementId: 'sl-group1' },
      ]);
      let again = await roundtrip(document);
      const group = again.slides()[2]!.elements.find((element) => element.id === 'sl-group1')!;
      expect(group).toMatchObject({ kind: 'group', name: 'Gruppe 1', movable: true });
      expect(group.members).toEqual([title.id, hint.id]);
      expect(ids(again)).toEqual(
        before
          .filter((id) => id !== title.id && id !== hint.id)
          .toSpliced(before.indexOf(hint.id) - 1, 0, 'sl-group1'),
      );
      again.apply([
        { type: 'setBox', elementId: 'sl-group1', box: { ...group.bbox, x: group.bbox.x + 0.05 } },
      ]);
      // Entered (a double click, Figma): its parts are elements of their own, by their ids –
      // moved, typed in, pasted into it, restacked in it, deleted; its box the one round them.
      expect(group.children?.map((child) => child.id)).toEqual([title.id, hint.id]);
      expect(group.children?.[1]?.rotation).toBeCloseTo(30, 3);
      const part = group.children![0]!;
      const lower = { ...part.bbox, x: part.bbox.x + 0.05, y: part.bbox.y + 0.1 };
      again.apply([
        { type: 'setBox', elementId: title.id, box: lower },
        { type: 'setText', elementId: title.id, paragraphs: ['In der Gruppe'] },
        {
          type: 'copyElement',
          elementId: title.id,
          pageId: again.slides()[2]!.pageId!,
          newElementId: 'sl-part-copy',
          box: part.bbox,
          groupId: 'sl-group1',
        },
        { type: 'moveElement', elementId: 'sl-part-copy', to: 0 },
      ]);
      const entered = await roundtrip(again);
      const inside = entered.slides()[2]!.elements.find((element) => element.id === 'sl-group1')!;
      expect(inside.children?.map((child) => child.id)).toEqual([
        'sl-part-copy',
        title.id,
        hint.id,
      ]);
      expect(inside.children?.[1]?.paragraphs).toEqual(['In der Gruppe']);
      expect(inside.children?.[1]?.bbox.y).toBeCloseTo(lower.y, 3);
      expect(inside.bbox.y + inside.bbox.h).toBeGreaterThanOrEqual(lower.y + lower.h - 1e-3);
      expect(() =>
        again.apply([{ type: 'moveElement', elementId: 'sl-part-copy', to: 3 }]),
      ).toThrow(/Gruppe/);
      // Composed, the group is drawn from its parts – no picture of the group itself.
      const drawing = await entered.toLayerBytes(2, () => null, { compose: true });
      expect(drawing.elementIds).toEqual(
        expect.arrayContaining(['sl-part-copy', title.id, hint.id]),
      );
      expect(drawing.elementIds).not.toContain('sl-group1');
      // Copied (⌘C ⌘V): its parts under the ids the editor gave them – one not named, the file's.
      const source = await roundtrip(again);
      const copyGroup = (newElementId: string, partIds: Record<string, string>) =>
        source.apply([
          {
            type: 'copyElement',
            elementId: 'sl-group1',
            pageId: source.slides()[2]!.pageId!,
            newElementId,
            box: inside.bbox,
            partIds,
          },
        ]);
      copyGroup('sl-group-copy', { [title.id]: 'sl-copy-title', [hint.id]: 'sl-copy-hint' });
      const copied = (await roundtrip(source)).slides()[2]!.elements.at(-1)!;
      const copiedParts = copied.children!.map((child) => child.id);
      expect(copied.id).toBe('sl-group-copy');
      expect(copiedParts.slice(1)).toEqual(['sl-copy-title', 'sl-copy-hint']);
      expect(copiedParts[0]).not.toBe('sl-part-copy');
      expect(() => copyGroup('sl-group-copy2', { [title.id]: hint.id })).toThrow(/gibt es schon/);
      again.apply([{ type: 'deleteElement', elementId: 'sl-part-copy' }]);
      again.apply([{ type: 'ungroupElements', elementId: 'sl-group1' }]);
      again = await roundtrip(again);
      const apart = again.slides()[2]!.elements;
      expect(apart.map((element) => element.id)).toEqual(
        before.filter((id) => id !== title.id).toSpliced(before.indexOf(hint.id) - 1, 0, title.id),
      );
      const turned = apart.find((element) => element.id === hint.id)!;
      expect(turned.rotation).toBeCloseTo(30, 3);
      expect(turned.bbox.x).toBeCloseTo(hint.bbox.x + 0.05, 3);
      expect(() => again.apply([{ type: 'ungroupElements', elementId: hint.id }])).toThrow(
        /keine Gruppe/,
      );
      expect(() =>
        again.apply([
          {
            type: 'groupElements',
            elementIds: [hint.id, group.members![0]!],
            newElementId: hint.id,
          },
        ]),
      ).toThrow(/gibt es schon/);
      // A group whose last part is deleted goes with it.
      again.apply([
        { type: 'groupElements', elementIds: [hint.id, title.id], newElementId: 'sl-group2' },
        { type: 'deleteElement', elementId: hint.id },
        { type: 'deleteElement', elementId: title.id },
      ]);
      expect(again.slideOf('sl-group2')).toBeNull();
    }
  });

  it('changes the fingerprint of the changed slide only and refuses operations that do not fit', async () => {
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
    // Refuses operations that do not fit.
    {
      const document = await open();
      const picture = byName(document, 3, 'Roadmap Visual');
      expect(() =>
        document.apply([{ type: 'setText', elementId: picture.id, paragraphs: ['x'] }]),
      ).toThrow(OdpError);
      expect(() => document.apply([{ type: 'deleteElement', elementId: 'nope' }])).toThrow(
        /gibt es nicht mehr/,
      );
      expect(() =>
        document.apply([{ type: 'replaceImage', elementId: picture.id, imageId: 'missing' }]),
      ).toThrow(/nochmal hochladen/);
    }
  });

  it('swaps a picture and adds picture frames, fitted into their box, the unused old picture dropped', async () => {
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
    // Adds a picture frame – a placeholder filling the box, or an image fitted into it.
    {
      const document = await open();
      const box = { x: 0.1, y: 0.2, w: 0.4, h: 0.3 };
      const image: OdpImage = { bytes: png(40, 40), mediaType: 'image/png', width: 40, height: 40 };
      const page = document.pageIds()[1]!;
      document.apply(
        [
          { type: 'addImage', pageId: page, elementId: 'sl-empty', box, imageId: null },
          { type: 'addImage', pageId: page, elementId: 'sl-photo', box, imageId: 'new' },
        ],
        new Map([['new', image]]),
      );
      const bytes = await document.toBytes();
      const zip = await JSZip.loadAsync(bytes);
      const svg = Object.keys(zip.files).filter((path) => path.endsWith('.svg'));
      expect(svg).toHaveLength(1);
      expect(await zip.file('META-INF/manifest.xml')?.async('string')).toContain(svg[0]);

      const again = await OdpDocument.open(bytes);
      const elements = again.slides()[1]!.elements;
      const empty = elements.find((element) => element.id === 'sl-empty');
      const photo = elements.find((element) => element.id === 'sl-photo');
      expect(empty).toMatchObject({
        kind: 'image',
        name: 'Bild 1',
        movable: true,
        resizable: true,
      });
      expect(photo).toMatchObject({ kind: 'image', name: 'Bild 2' });
      expect(empty!.bbox.x).toBeCloseTo(box.x, 3);
      expect(empty!.bbox.w).toBeCloseTo(box.w, 3);
      // Square image in a wide box: as high as the box, centred.
      const size = again.pageSize();
      expect(photo!.bbox.h).toBeCloseTo(box.h, 3);
      expect(photo!.bbox.w * size.width).toBeCloseTo(photo!.bbox.h * size.height, 2);
      expect(photo!.bbox.x + photo!.bbox.w / 2).toBeCloseTo(box.x + box.w / 2, 3);
      // On top of the slide's elements.
      expect(elements.slice(-2).map((element) => element.id)).toEqual(['sl-empty', 'sl-photo']);

      // The placeholder can be swapped for a picture like any other.
      again.apply(
        [{ type: 'replaceImage', elementId: 'sl-empty', imageId: 'new' }],
        new Map([['new', image]]),
      );
      expect(again.slides()[1]!.elements.find((element) => element.id === 'sl-empty')?.kind).toBe(
        'image',
      );
      expect(() =>
        again.apply([
          { type: 'addImage', pageId: page, elementId: 'sl-gone', box, imageId: 'missing' },
        ]),
      ).toThrow(/nochmal hochladen/);
    }
    // Filled (cut to the frame, `fo:clip` in the picture's own size) or stretched – kept so when
    // the frame is resized; an imported picture's size is read ahead.
    {
      const document = await open();
      const page = document.pageIds()[1]!;
      // 400 × 200 px at 96 dpi: 10.5833 × 5.2917 cm.
      const wide: OdpImage = {
        bytes: png(400, 200),
        mediaType: 'image/png',
        width: 400,
        height: 200,
      };
      const box = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 };
      document.apply(
        [{ type: 'addImage', pageId: page, elementId: 'sl-wide', box, imageId: 'w' }],
        new Map([['w', wide]]),
      );
      const shown = () => document.slides()[1]!.elements.find((item) => item.id === 'sl-wide')!;
      const clips = async () =>
        [
          ...(
            (await (
              await JSZip.loadAsync(await document.toBytes())
            )
              .file('content.xml')
              ?.async('string')) ?? ''
          ).matchAll(/fo:clip="([^"]+)"/g),
        ].map((m) => m[1]);
      expect(shown().picture).toMatchObject({ fit: 'fill', focus: null });
      expect(shown().picture!.aspect).toBeCloseTo(2, 5);
      expect(shown().picture!.src).toMatch(/^Pictures\//);
      // Made square: its middle half shown, not squeezed.
      const size = document.pageSize();
      const square = { ...shown().bbox, w: (shown().bbox.h * size.height) / size.width };
      document.apply([{ type: 'setBox', elementId: 'sl-wide', box: square }]);
      expect(await clips()).toContain('rect(0cm, 2.6458cm, 0cm, 2.6458cm)');
      // Its left edge, zoomed in twice.
      document.apply([
        {
          type: 'setImageFit',
          elementId: 'sl-wide',
          fit: 'fill',
          focus: { x: 0, y: 0.5, zoom: 2 },
        },
      ]);
      expect(await clips()).toContain('rect(1.3229cm, 7.9375cm, 1.3229cm, 0cm)');
      // Cut as Slider fits it: still drawn by the browser in Bearbeiten (`shownCrop` is the clip).
      expect(shown().paint?.outline).toBe('picture');
      const again = await roundtrip(document);
      expect(
        again.slides()[1]!.elements.find((item) => item.id === 'sl-wide')!.picture,
      ).toMatchObject({
        fit: 'fill',
        focus: { x: 0, y: 0.5, zoom: 2 },
      });
      // Stretched: nothing cut off, resized as it is.
      document.apply([{ type: 'setImageFit', elementId: 'sl-wide', fit: 'stretch' }]);
      document.apply([{ type: 'setBox', elementId: 'sl-wide', box }]);
      expect(await clips()).toContain('rect(0cm, 0cm, 0cm, 0cm)');
      expect(shown().picture).toMatchObject({ fit: 'stretch', focus: null });
      // Filled again: from its middle.
      document.apply([{ type: 'setImageFit', elementId: 'sl-wide', fit: 'fill' }]);
      expect(shown().picture!.focus).toBeNull();
      // An imported picture: its size read first, else refused.
      const roadmap = byName(document, 3, 'Roadmap Visual');
      expect(roadmap.picture).toMatchObject({ fit: 'stretch', aspect: null });
      const fill = [{ type: 'setImageFit' as const, elementId: roadmap.id, fit: 'fill' as const }];
      expect(() => document.apply(fill)).toThrow(/unbekannt/);
      await document.preparePictures(fill);
      document.apply(fill);
      expect(byName(document, 3, 'Roadmap Visual').picture).toMatchObject({ fit: 'fill' });
      expect(byName(document, 3, 'Roadmap Visual').picture!.aspect).toBeGreaterThan(0);
    }
  });
});

describe('slides as XML', () => {
  it('reads, finds in and replaces slides as XML, with styles, catalog, unique ids and valid animations', async () => {
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
    // Finds text and XML in slides and styles, any case.
    {
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
    }
    // Replaces a slide with new styles, keeping ids unique and animations valid.
    {
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
    }
    // Takes a slide back as it was, without checks.
    {
      const document = await open();
      const before = document.slideXml(2);
      document.replaceSlide(2, before.replace('>Umsatz nach Region<', '>Neu<'));
      document.replaceSlide(2, before, { trusted: true });
      expect(document.slideXml(2)).toBe(before);
    }
  });

  it('fills a shape with a picture and lists and adds pictures once, with who shows them', async () => {
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
    // Lists the pictures, who shows them and how large they are.
    {
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
    }
    // Adds a picture once, for a slide written to show it.
    {
      const document = await open();
      const bytes = png(40, 30);
      const path = document.addPicture(bytes, 'image/png');
      expect(document.addPicture(bytes, 'image/png')).toBe(path);
      expect(() => document.addPicture(bytes, 'image/svg+xml')).toThrow(OdpError);
      // Read back from the same document before writing (an AI run lists what it just added).
      expect(await document.picture(path)).toEqual(bytes);
      expect((await document.pictures()).find((picture) => picture.path === path)).toMatchObject({
        bytes: bytes.length,
        width: 40,
        height: 30,
      });
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
    }
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

  it('refuses unknown styles, namespaces and files and cleans scripts, events, embedded data and links out', async () => {
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
    // A parent among the automatic styles, which LibreOffice ignores: what it meant is taken in,
    // and a file that has one anyway is read as LibreOffice draws it (without the parent).
    {
      const document = await open();
      document.addStyles(
        '<style:style style:name="aiBigP" style:family="paragraph"><style:text-properties fo:font-size="66pt" fo:color="#111111"/></style:style>' +
          '<style:style style:name="aiBigTextP" style:family="paragraph" style:parent-style-name="aiBigP"><style:text-properties fo:color="#fef3c7"/></style:style>',
      );
      const frame = (style: string) =>
        `<draw:frame draw:layer="layout" svg:x="1cm" svg:y="1cm" svg:width="10cm" svg:height="3cm"><draw:text-box><text:p text:style-name="${style}">Halloween</text:p></draw:text-box></draw:frame></draw:page>`;
      document.replaceSlide(2, document.slideXml(2).replace('</draw:page>', frame('aiBigTextP')));
      const run = () => document.slides()[2]!.elements.at(-1)!.live!.paragraphs[0]!.runs[0]!;
      expect(run()).toMatchObject({ size: 66, color: '#fef3c7' });
      expect(document.stylesXml(['aiBigTextP']).xml.join('')).not.toContain('parent-style-name');

      const zip = await JSZip.loadAsync(await document.toBytes());
      const content = await zip.file('content.xml')!.async('string');
      zip.file(
        'content.xml',
        content
          .replace(
            '</office:automatic-styles>',
            '<style:style style:name="aiLostP" style:family="paragraph" style:parent-style-name="aiBigP"/></office:automatic-styles>',
          )
          .replace('<text:p text:style-name="aiBigTextP">', '<text:p text:style-name="aiLostP">'),
      );
      const raw = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
      expect(raw.slides()[2]!.elements.at(-1)!.live!.paragraphs[0]!.runs[0]!.size).not.toBe(66);
    }
    // Cleans what it is given: scripts, events, embedded data, links out.
    {
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
    }
  });
});

describe('slides moving', () => {
  const titles = (document: OdpDocument) => document.slides().map((slide) => slide.title);

  it('gives slides page ids that survive rewriting and arranges slides by them', async () => {
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
    // Arranges slides by page id – rewritten, put back, left out.
    {
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
      expect(() => document.arrange(['nope'], new Map())).toThrow(/gibt es nicht mehr/);
      expect(() => document.arrange([], new Map())).toThrow(OdpError);
    }
  });

  it('inserts, removes and moves slides, also as operations naming slides that moved – keeping the last one', async () => {
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
    expect(() => document.insertSlide(0, xml, { trusted: true })).toThrow(/es gibt sie schon/);
    expect(() => document.moveSlide(0, 6)).toThrow(/position/);
    // Keeps the last slide.
    {
      const document = await open();
      for (let i = 0; i < 5; i += 1) document.removeSlide(0);
      expect(() => document.removeSlide(0)).toThrow(/letzte Folie/);
    }
    // Deletes and moves slides as operations, page ids staying.
    {
      // A file without page ids gets those every reading of it gets.
      const document = await OdpDocument.open(DEMO);
      const ids = (await open()).pageIds();
      document.apply([
        { type: 'moveSlide', pageId: ids[0]!, after: ids[2]! },
        { type: 'deleteSlide', pageId: ids[5]! },
      ]);
      expect(document.pageIds()).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);
      // Back towards the front, and first.
      document.apply([{ type: 'moveSlide', pageId: ids[4]!, after: ids[1]! }]);
      expect(document.pageIds()).toEqual([ids[1], ids[4], ids[2], ids[0], ids[3]]);
      document.apply([{ type: 'moveSlide', pageId: ids[3]!, after: null }]);
      expect(document.pageIds()).toEqual([ids[3], ids[1], ids[4], ids[2], ids[0]]);
      for (const id of [ids[3], ids[1], ids[4], ids[2]]) {
        document.apply([{ type: 'deleteSlide', pageId: id! }]);
      }
      expect(() => document.apply([{ type: 'deleteSlide', pageId: ids[0]! }])).toThrow(
        /letzte Folie/,
      );
      expect(() => document.apply([{ type: 'deleteSlide', pageId: ids[1]! }])).toThrow(
        /gibt es nicht mehr/,
      );
      expect(() =>
        document.apply([{ type: 'moveSlide', pageId: ids[0]!, after: ids[0]! }]),
      ).toThrow(OdpError);
    }
    // Finds the slide an operation names after others moved or came before it.
    {
      const document = await open();
      const ids = document.pageIds();
      const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };
      // Someone else moved slide 4 to the front and added one before it meanwhile.
      document.apply([
        { type: 'moveSlide', pageId: ids[3]!, after: null },
        { type: 'addSlide', like: ids[0]!, newPageId: 'sl-theirs', after: null },
      ]);
      // An edit made on the old order still lands on slide 4.
      document.apply([
        {
          type: 'addElement',
          pageId: ids[3]!,
          elementId: 'sl-mine',
          kind: 'rect',
          shape: 'ellipse',
          box,
          fill: '#ff0000',
          stroke: null,
          paragraphs: [],
        },
      ]);
      const slide = document.slides().find((item) => item.pageId === ids[3]);
      expect(slide!.index).toBe(1);
      expect(slide!.elements.find((element) => element.id === 'sl-mine')?.name).toBe('Ellipse 1');
      // The outline is LibreOffice's preset, named only.
      expect(document.slideXml(1)).toMatch(/draw:type="ellipse"/);
      // An ellipse's frame is its box (its outline only cuts a fill drawn over it); a triangle's
      // follows the triangle.
      expect(slide!.elements.find((element) => element.id === 'sl-mine')?.outline).toEqual({
        type: 'ellipse',
      });
      document.apply([
        {
          type: 'addElement',
          pageId: ids[3]!,
          elementId: 'sl-peak',
          kind: 'rect',
          shape: 'isosceles-triangle',
          box,
          fill: '#ff0000',
          stroke: null,
          paragraphs: [],
        },
      ]);
      const peak = document
        .slides()
        .find((item) => item.pageId === ids[3])!
        .elements.find((element) => element.id === 'sl-peak');
      expect(peak?.outline).toEqual({ type: 'isosceles-triangle' });
      expect(shapeOutlinePath(peak!.outline!, 100, 50)).toBe('M50 0 L100 50 L0 50 Z');
      expect(shapeOutlinePath(peak!.outline!, 100, 50, { x: false, y: true })).toBe(
        'M50 50 L100 0 L0 0 Z',
      );
      // An outline of its own (PowerPoint's cloud as LibreOffice imports it): its path, formulas and
      // views read – what a fill drawn over it is cut to (`shapeAreaSteps`), its arcs inside it
      // apart; the frame stays its box.
      const paths = await OdpDocument.open(
        new Uint8Array(readFileSync(new URL('./fixtures/own-paths.odp', import.meta.url))),
      );
      const cloud = paths.slides()[0]!.elements.find((element) => element.id === 'slpath-cloud')!;
      expect(cloud.outline).toMatchObject({
        type: 'ooxml-cloud',
        path: {
          path: expect.stringMatching(/^M 3900 14370 G /),
          subViews: '43200 43200 43200 43200',
        },
      });
      expect(cloud.outline!.path!.equations?.f10).toBe('(-11429249)/60000.0');
      const area = shapeAreaSteps(cloud.outline!.path!, 'ooxml-cloud', undefined, 10, 5)!;
      expect([area[0]!.op, area.at(-1)!.op, area.filter((step) => step.op === 'M').length]).toEqual(
        ['M', 'Z', 1],
      );
      expect(
        shapeAreaSteps(cloud.outline!.path!, 'ooxml-cloud', undefined, 10, 5, true)!.length,
      ).toBeGreaterThan(0);
      expect(shapeOutlinePath(cloud.outline!, 100, 50)).toBeNull();
      // Drawn by the browser in Bearbeiten (`paint`): the ellipse and the triangle (a preset with
      // its apex), turned and mirrored too; a Slider dash on a box, not on a star or as dots.
      const drawn = (id: string) =>
        document
          .slides()
          .find((item) => item.pageId === ids[3])!
          .elements.find((element) => element.id === id);
      expect(drawn('sl-mine')?.paint).toEqual({ outline: 'ellipse', radius: 0 });
      expect(peak?.paint).toEqual({
        outline: 'preset',
        radius: 0,
        preset: { type: 'isosceles-triangle' },
      });
      document.apply([
        { type: 'setBox', elementId: 'sl-peak', box, rotation: 30, flip: { x: false, y: true } },
        {
          type: 'setShapeStyle',
          elementId: 'sl-mine',
          fills: [{ type: 'solid', color: '#ff0000', opacity: 0.5, visible: true }],
        },
      ]);
      expect(drawn('sl-peak')?.paint?.outline).toBe('preset');
      expect(drawn('sl-mine')?.paint?.fillOpacity).toBeCloseTo(0.5, 2);
      document.apply([
        {
          type: 'addElement',
          pageId: ids[3]!,
          elementId: 'sl-dashed',
          kind: 'rect',
          box,
          fill: null,
          stroke: { color: '#112233', width: 2, dash: 'dash' },
          paragraphs: [],
        },
      ]);
      expect(drawn('sl-dashed')?.look?.stroke?.dash).toBe('dash');
      expect(drawn('sl-dashed')?.paint?.outline).toBe('rect');
      document.apply([
        {
          type: 'setShapeStyle',
          elementId: 'sl-dashed',
          stroke: { color: '#112233', width: 2, dash: 'dot' },
        },
      ]);
      expect(drawn('sl-dashed')?.paint).toBeUndefined();
      // One gradient as the editor writes it: drawn by the browser – not turned, not an ellipsoid
      // of more than two colours.
      const gradient = (kind: 'linear' | 'ellipsoid', colours: string[]) => ({
        type: 'gradient' as const,
        kind,
        angle: 90,
        stops: colours.map((color, i) => ({ color, at: i / (colours.length - 1) })),
        opacity: 1,
        visible: true,
      });
      document.apply([
        {
          type: 'setShapeStyle',
          elementId: 'sl-mine',
          fills: [gradient('linear', ['#112233', '#ffeedd'])],
        },
      ]);
      expect(drawn('sl-mine')?.paint?.gradient).toBe(true);
      document.apply([
        {
          type: 'setShapeStyle',
          elementId: 'sl-mine',
          fills: [gradient('ellipsoid', ['#112233', '#445566', '#ffeedd'])],
        },
      ]);
      expect(drawn('sl-mine')?.paint).toBeUndefined();
      document.apply([
        {
          type: 'setShapeStyle',
          elementId: 'sl-mine',
          fills: [gradient('linear', ['#112233', '#ffeedd'])],
        },
        { type: 'setBox', elementId: 'sl-mine', box, rotation: 10 },
      ]);
      expect(drawn('sl-mine')?.paint).toBeUndefined();
      // A rectangle's corners: rounded by a radius (pt) and sharp again – no ellipse's or
      // triangle's. Kept through the file, the text area following the rounding.
      document.apply([
        {
          type: 'addElement',
          pageId: ids[3]!,
          elementId: 'sl-box',
          kind: 'rect',
          box,
          fill: '#ff0000',
          stroke: null,
          paragraphs: [],
        },
      ]);
      const boxOf = (file: OdpDocument) =>
        file
          .slides()
          .find((item) => item.pageId === ids[3])!
          .elements.find((element) => element.id === 'sl-box')!;
      expect(boxOf(document).cornerRadius).toBe(0);
      expect(peak?.cornerRadius).toBeUndefined();
      expect(() =>
        document.apply([{ type: 'setCornerRadius', elementId: 'sl-peak', radius: 5 }]),
      ).toThrow(/Rechteck/);
      document.apply([{ type: 'setCornerRadius', elementId: 'sl-box', radius: 12 }]);
      const rounded = await roundtrip(document);
      expect(boxOf(rounded).cornerRadius).toBeCloseTo(12, 0);
      // Its rounding drawn by the browser too.
      expect(boxOf(rounded).paint?.outline).toBe('rect');
      expect(boxOf(rounded).paint?.radius).toBeCloseTo(12, 0);
      expect(boxOf(rounded).live?.textArea).toBeTruthy();
      expect(rounded.slideXml(1)).toMatch(/draw:type="round-rectangle" draw:modifiers="\d+"/);
      // Never rounder than half the shorter side.
      rounded.apply([{ type: 'setCornerRadius', elementId: 'sl-box', radius: 2000 }]);
      const short = Math.min(box.w * rounded.pageSize().width, box.h * rounded.pageSize().height);
      expect(boxOf(rounded).cornerRadius).toBeCloseTo((short / 2) * (72 / 2.54), 0);
      rounded.apply([{ type: 'setCornerRadius', elementId: 'sl-box', radius: 0 }]);
      expect(boxOf(rounded).cornerRadius).toBe(0);
      expect(boxOf(rounded).live?.textArea).toBeUndefined();
      // A new rounded box (no modifier written): LibreOffice's default rounding, the browser's too.
      rounded.apply([
        {
          type: 'addElement',
          pageId: ids[3]!,
          elementId: 'sl-round',
          kind: 'rect',
          shape: 'round-rectangle',
          box,
          fill: '#ff0000',
          stroke: null,
          paragraphs: [],
        },
      ]);
      const round = (await roundtrip(rounded))
        .slides()
        .find((item) => item.pageId === ids[3])!
        .elements.find((element) => element.id === 'sl-round')!;
      expect(round.cornerRadius).toBeCloseTo((3600 / 21600) * short * (72 / 2.54), 1);
      expect(round.paint?.radius).toBeCloseTo(round.cornerRadius!, 2);
    }
  });

  it('copies a slide with ids of its own, also at a gap as an operation', async () => {
    const document = await open();
    const ids = document.pageIds();
    document.apply([
      { type: 'duplicateSlide', pageId: ids[3]!, newPageId: 'sl-copy', after: ids[0]! },
    ]);
    const again = await roundtrip(document);
    const pageIds = again.pageIds();
    expect(pageIds).toEqual([ids[0], 'sl-copy', ...ids.slice(1)]);
    expect(again.slides()[1]!.title).toBe(again.slides()[4]!.title);
    // First, too; the new id must be free and the slides named there.
    document.apply([
      { type: 'duplicateSlide', pageId: ids[0]!, newPageId: 'sl-first', after: null },
    ]);
    expect(document.pageIds()[0]).toBe('sl-first');
    expect(() =>
      document.apply([
        { type: 'duplicateSlide', pageId: ids[0]!, newPageId: 'sl-copy', after: null },
      ]),
    ).toThrow(/gibt es schon/);
    expect(() =>
      document.apply([
        { type: 'duplicateSlide', pageId: ids[0]!, newPageId: 'sl-other', after: 'sl-gone' },
      ]),
    ).toThrow(/gibt es nicht mehr/);
    // Variants: hidden copies marked with their slide, one taking its slide's place; speaker
    // notes written and read back – neither changes what is drawn (the fingerprint).
    {
      const document = await open();
      const ids = document.pageIds();
      const drawn = document.slides()[0]!.fingerprint;
      document.apply([
        { type: 'setSlideNotes', pageId: ids[0]!, text: 'Erst begrüßen.\n  Dann  zeigen.' },
        { type: 'addVariant', pageId: ids[0]!, newPageId: 'sl-variant-a' },
        { type: 'addVariant', pageId: 'sl-variant-a', newPageId: 'sl-variant-b' },
      ]);
      const again = await roundtrip(document);
      const slides = again.slides();
      expect(slides[0]!.notes).toBe('Erst begrüßen.\n  Dann  zeigen.');
      expect(slides[0]!.fingerprint).toBe(drawn);
      expect(again.pageIds().slice(0, 4)).toEqual([ids[0], 'sl-variant-a', 'sl-variant-b', ids[1]]);
      expect(slides.slice(0, 3).map((slide) => [slide.hidden, slide.variantOf])).toEqual([
        [false, null],
        [true, ids[0]],
        [true, ids[0]],
      ]);
      // The copy carries the notes; emptied, the notes go.
      expect(slides[1]!.notes).toBe(slides[0]!.notes);
      // Formatted notes: spans and lists in the file, read back as written; plain text alike.
      const rich = [
        {
          runs: [
            { text: 'Erst ' },
            { text: 'laut', bold: true },
            { text: ' und klar', italic: true },
          ],
        },
        { runs: [{ text: 'Punkt', underline: true }], list: { kind: 'bullet' as const, level: 1 } },
        { runs: [{ text: 'tiefer', strike: true }], list: { kind: 'bullet' as const, level: 2 } },
        { runs: [{ text: 'Eins' }], list: { kind: 'number' as const, level: 1 } },
        { runs: [] },
      ];
      const text = 'Erst laut und klar\nPunkt\ntiefer\nEins';
      again.apply([{ type: 'setSlideNotes', pageId: ids[1]!, text, paragraphs: rich }]);
      const formatted = await roundtrip(again);
      const notesSlide = formatted.slides().find((slide) => slide.pageId === ids[1])!;
      expect(notesSlide.notes).toBe(text);
      expect(notesSlide.notesRich).toEqual(rich.slice(0, 4));
      const notesXml = formatted.slideXml(notesSlide.index);
      expect(notesXml).toMatch(/<text:list text:style-name="[^"]+"><text:list-item><text:p>/);
      expect(notesXml).toMatch(/<text:span text:style-name="[^"]+">laut<\/text:span>/);
      // The same again changes nothing; old notes are plain paragraphs.
      expect(() =>
        formatted.apply([{ type: 'setSlideNotes', pageId: ids[1]!, text, paragraphs: rich }]),
      ).not.toThrow();
      expect(slides[0]!.notesRich).toEqual([
        { runs: [{ text: 'Erst begrüßen.' }] },
        { runs: [{ text: '  Dann  zeigen.' }] },
      ]);
      again.apply([{ type: 'useVariant', pageId: 'sl-variant-b' }]);
      expect(again.pageIds().slice(0, 3)).toEqual(['sl-variant-b', ids[0], 'sl-variant-a']);
      expect(
        again
          .slides()
          .slice(0, 3)
          .map((slide) => [slide.hidden, slide.variantOf]),
      ).toEqual([
        [false, null],
        [true, 'sl-variant-b'],
        [true, 'sl-variant-b'],
      ]);
      expect(() => again.apply([{ type: 'useVariant', pageId: 'sl-variant-b' }])).toThrow(
        /keine Variante/,
      );
      again.apply([{ type: 'setSlideNotes', pageId: 'sl-variant-b', text: '' }]);
      expect(again.slides()[0]!.notes).toBe('');
      // Its slide deleted, a variant is a hidden slide like others.
      again.apply([{ type: 'deleteSlide', pageId: 'sl-variant-b' }]);
      expect(again.slides()[0]).toMatchObject({ hidden: true, variantOf: null });
    }
    // Copies a slide with ids of its own, animations following.
    {
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
    }
  });

  it('adds slides of a layout, their placeholders empty to type into', async () => {
    const document = await open();
    const ids = document.pageIds();
    const master = (index: number) =>
      document.slideXml(index).match(/draw:master-page-name="([^"]*)"/)?.[1];
    document.apply([{ type: 'addSlide', like: ids[2]!, newPageId: 'sl-new', after: ids[2]! }]);
    const again = await roundtrip(document);
    const pageIds = again.pageIds();
    expect(pageIds).toEqual([...ids.slice(0, 3), 'sl-new', ...ids.slice(3)]);
    // „Neue Folie“: completely empty – no placeholder, none of the master's shapes – on the
    // slide's master and background.
    expect(again.slides()[3]!.elements).toEqual([]);
    expect(again.slideXml(3)).not.toContain('presentation:placeholder');
    expect(again.slides()[3]!.hidden).toBe(false);
    expect(master(3)).toBe(master(2));
    expect(again.slides()[3]!.background).toBe(again.slides()[2]!.background);
    const pageStyle = again.slideXml(3).match(/draw:style-name="([^"]*)"/)?.[1];
    const content = await (await OdpArchive.open(await again.toBytes())).readText('content.xml');
    expect(content).toMatch(
      new RegExp(
        `style:name="${pageStyle}"[^>]*>\\s*<style:drawing-page-properties[^>]*presentation:background-objects-visible="false"`,
      ),
    );
    // In the design of a hidden slide, it still shows.
    document.apply([{ type: 'addSlide', like: ids[5]!, newPageId: 'sl-top', after: null }]);
    expect(document.slides()[0]!.hidden).toBe(false);
    expect(() =>
      document.apply([{ type: 'addSlide', like: 'sl-gone', newPageId: 'sl-more', after: null }]),
    ).toThrow(/gibt es nicht mehr/);
    // Adds a slide of a layout, its placeholders empty.
    {
      const document = await open();
      const [master] = document.masterPages();
      const [first] = document.pageIds();
      document.apply([
        {
          type: 'addSlide',
          like: first!,
          newPageId: 'sl-layout',
          after: first!,
          master: master!.name,
        },
      ]);
      const xml = (await roundtrip(document)).slideXml(1);
      expect(xml).toContain(`draw:master-page-name="${master!.name}"`);
      const kinds = [...xml.matchAll(/presentation:class="(\w+)"/g)].map((match) => match[1]);
      expect(kinds.length).toBeGreaterThan(0);
      expect(kinds).toEqual(
        master!.placeholders
          .filter(
            (frame) =>
              !(
                frame.kind === 'outline' &&
                master!.placeholders.some((other) => other.kind === 'subtitle')
              ),
          )
          .map((frame) => frame.kind),
      );
      expect(xml.match(/presentation:placeholder="true"/g)).toHaveLength(kinds.length);
      expect(() =>
        document.apply([
          { type: 'addSlide', like: first!, newPageId: 'sl-nope', after: first!, master: 'nope' },
        ]),
      ).toThrow(/Layout/);
    }
  });

  it('hides a slide and gives it a background and a transition of its own', async () => {
    const document = await open();
    const hidden = () => document.slides().map((slide) => slide.hidden);
    const ids = document.pageIds();
    document.apply([{ type: 'setSlideHidden', pageId: ids[1]!, hidden: true }]);
    expect(hidden()).toEqual([false, true, false, false, true, false]);
    document.apply([{ type: 'setSlideHidden', pageId: ids[4]!, hidden: false }]);
    expect(hidden()).toEqual([false, true, false, false, false, false]);
    const fingerprint = document.slides()[2]!.fingerprint;
    document.apply([{ type: 'setSlideHidden', pageId: ids[2]!, hidden: false }]);
    expect(document.slides()[2]!.fingerprint).toBe(fingerprint);
    const again = await roundtrip(document);
    expect(again.slides().map((slide) => slide.hidden)).toEqual(hidden());
    // Gives a slide a background colour of its own and the master's back.
    {
      const document = await open();
      const ids = document.pageIds();
      const backgrounds = () => document.slides().map((slide) => slide.background);
      expect(backgrounds()).toEqual([null, null, null, null, null, null]);
      const fingerprint = document.slides()[1]!.fingerprint;
      document.apply([{ type: 'setSlideBackground', pageId: ids[1]!, color: '#FF0000' }]);
      expect(backgrounds()).toEqual([null, '#ff0000', null, null, null, null]);
      expect(document.slides()[1]!.fingerprint).not.toBe(fingerprint);
      // Hidden as it was: only the fill changes.
      expect(document.slides()[4]!.hidden).toBe(true);
      document.apply([{ type: 'setSlideBackground', pageId: ids[4]!, color: '#0f172a' }]);
      expect(document.slides()[4]).toMatchObject({ hidden: true, background: '#0f172a' });
      const again = await roundtrip(document);
      expect(again.slides().map((slide) => slide.background)).toEqual(backgrounds());
      expect(document.slides().map((slide) => slide.ownBackground)).toEqual([
        false,
        true,
        false,
        false,
        true,
        false,
      ]);
      document.apply([{ type: 'setSlideBackground', pageId: ids[1]!, color: null }]);
      expect(backgrounds()[1]).toBeNull();
      expect(document.slides()[1]!.ownBackground).toBe(false);
    }
    // Gives a slide a transition, in its style and in the transition LibreOffice keeps.
    {
      const document = await open();
      const ids = document.pageIds();
      const transitions = () => document.slides().map((slide) => slide.transition);
      expect(transitions()).toEqual(['none', 'none', 'none', 'none', 'none', 'none']);
      document.apply([{ type: 'setSlideTransition', pageId: ids[1]!, transition: 'fadeBlack' }]);
      // The slides shared a page style: the others keep none.
      expect(transitions()).toEqual(['none', 'fadeBlack', 'none', 'none', 'none', 'none']);
      expect(document.slides()[4]!.hidden).toBe(true);
      const again = await roundtrip(document);
      expect(again.slides().map((slide) => slide.transition)).toEqual(transitions());
      document.apply([{ type: 'setSlideTransition', pageId: ids[1]!, transition: 'none' }]);
      expect(transitions()[1]).toBe('none');

      // As LibreOffice saves it: the timing root's transition wins over the style – and follows.
      const zip = await JSZip.loadAsync(await document.toBytes());
      const content = (await zip.file('content.xml')!.async('string')).replace(
        /(<draw:page [^>]*>)/,
        '$1<anim:par presentation:node-type="timing-root"><anim:par smil:begin="p.begin"><anim:transitionFilter smil:dur="2s" smil:type="pushWipe" smil:subtype="fromRight"/></anim:par><anim:seq presentation:node-type="main-sequence"/></anim:par>',
      );
      zip.file('content.xml', content);
      const saved = await OdpDocument.open(await zip.generateAsync({ type: 'uint8array' }));
      expect(saved.slides()[0]!.transition).toBe('push');
      saved.apply([{ type: 'setSlideTransition', pageId: ids[0]!, transition: 'dissolve' }]);
      const written = await (
        await JSZip.loadAsync(await saved.toBytes())
      )
        .file('content.xml')!
        .async('string');
      expect(written).toContain(
        '<anim:transitionFilter smil:dur="2s" smil:type="dissolve" smil:subtype="defaultSubtype"/>',
      );
      saved.apply([{ type: 'setSlideTransition', pageId: ids[0]!, transition: 'none' }]);
      expect(saved.slides()[0]!.transition).toBe('none');
      expect(
        await (await JSZip.loadAsync(await saved.toBytes())).file('content.xml')!.async('string'),
      ).not.toContain('anim:transitionFilter');

      // Morph: a crossfade for LibreOffice and PowerPoint, marked for Slider – a plain crossfade
      // stays one. Elements copied with their slide keep who they were, a copy of the copy too.
      saved.apply([{ type: 'setSlideTransition', pageId: ids[2]!, transition: 'morph' }]);
      saved.apply([{ type: 'setSlideTransition', pageId: ids[3]!, transition: 'fade' }]);
      const morphed = await roundtrip(saved);
      expect(
        morphed
          .slides()
          .map((slide) => slide.transition)
          .slice(2, 4),
      ).toEqual(['morph', 'fade']);
      const morphXml = await (
        await JSZip.loadAsync(await saved.toBytes())
      )
        .file('content.xml')!
        .async('string');
      expect(morphXml).toMatch(
        /smil:type="fade" smil:subtype="crossfade" slider:transition="morph"/,
      );
      const source = saved.slides()[2]!.elements;
      expect(source.length).toBeGreaterThan(0);
      expect(source.every((element) => element.morphKey === undefined)).toBe(true);
      saved.apply([
        { type: 'duplicateSlide', pageId: ids[2]!, newPageId: 'slcopy-one', after: ids[2]! },
      ]);
      saved.apply([
        {
          type: 'duplicateSlide',
          pageId: 'slcopy-one',
          newPageId: 'slcopy-two',
          after: 'slcopy-one',
        },
      ]);
      const keys = (at: number) => saved.slides()[at]!.elements.map((element) => element.morphKey);
      expect(keys(3)).toEqual(source.map((element) => element.id));
      expect(keys(4)).toEqual(keys(3));
      expect(saved.slides()[3]!.elements.map((element) => element.id)).not.toEqual(
        source.map((element) => element.id),
      );
    }
  });
});

describe('writing', () => {
  it('writes mimetype first and uncompressed, tells ODPs by their bytes and reads image sizes', async () => {
    const document = await open();
    const bytes = await document.toBytes();
    // Local file header: name at offset 30, compression method at offset 8 (0 = stored).
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe('mimetype');
    expect(bytes[8]).toBe(0);

    // Tells an ODP by its first bytes.
    const { isOdpBytes } = await import('../src');
    expect(isOdpBytes(DEMO)).toBe(true);
    expect(isOdpBytes(await (await open()).toBytes())).toBe(true);
    expect(isOdpBytes(new TextEncoder().encode('%PDF-1.7'))).toBe(false);

    // Reads PNG, GIF, JPEG and WebP headers.
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

  it('removes links LibreOffice could follow, keeping web links, and tells package paths from links', async () => {
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
    // Removes links out of embedded objects and click actions to anything but the web.
    {
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
    }

    // Tells package paths from links.
    expect(isPackagePath('Pictures/a.png')).toBe(true);
    expect(isPackagePath('./Object 1')).toBe(true);
    expect(isPackagePath('../secret.png')).toBe(false);
    expect(isPackagePath('/etc/passwd')).toBe(false);
    expect(isPackagePath('file:///etc/passwd')).toBe(false);
    expect(isPackagePath('https://example.com/a.png')).toBe(false);
    expect(isPackagePath(' http://127.0.0.1/a.png')).toBe(false);
    expect(isPackagePath('\thttp://127.0.0.1/a.png')).toBe(false);
  });
});
