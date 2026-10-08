import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { insertSlide, openPptx, SlideInsertError } from '../src';
import { buildPptx, LAYOUT_NAMES } from './fixtures/build-pptx';

const readPart = async (bytes: Uint8Array, path: string) =>
  (await JSZip.loadAsync(bytes)).file(path)?.async('string');

describe('insertSlide', () => {
  it('adds an empty slide after the given one, with its neighbour layout', async () => {
    const original = await buildPptx({
      slides: [
        { sldId: 300, title: 'First', layout: 'title' },
        { sldId: 257, title: 'Second' },
      ],
    });

    const result = await insertSlide(original, { afterSldId: 300 });
    const { presentation } = await openPptx(result.bytes);

    expect(result.sldId).toBe(301);
    expect(result.path).toBe('ppt/slides/slide3.xml');
    expect(presentation.slides.map((slide) => [slide.sldId, slide.title])).toEqual([
      [300, 'First'],
      [301, null],
      [257, 'Second'],
    ]);
    const inserted = presentation.slides[1];
    expect(inserted?.layoutName).toBe(LAYOUT_NAMES.title);
    expect(inserted?.shapes.map((shape) => shape.placeholder)).toEqual(['ctrTitle', 'subTitle']);
  });

  it('inserts at the start when there is no slide before', async () => {
    const original = await buildPptx({ slides: [{ sldId: 256, title: 'Only' }] });

    const { bytes, sldId } = await insertSlide(original, { afterSldId: null });
    const { presentation } = await openPptx(bytes);

    expect(presentation.slides.map((slide) => slide.sldId)).toEqual([sldId, 256]);
    expect(presentation.slides[0]?.layoutName).toBe(LAYOUT_NAMES.content);
  });

  it('puts the new slide into the section of its neighbour', async () => {
    const original = await buildPptx({
      slides: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      sections: [
        { name: 'Intro', slides: [0] },
        { name: 'Rest', slides: [1, 2] },
      ],
    });

    const { bytes, sldId } = await insertSlide(original, { afterSldId: 257 });
    const { presentation } = await openPptx(bytes);

    expect(presentation.sections).toEqual([
      { name: 'Intro', slideIds: [256] },
      { name: 'Rest', slideIds: [257, sldId, 258] },
    ]);
  });

  it('registers the part and counts it, leaving every other part untouched', async () => {
    const original = await buildPptx({ slides: [{ title: 'A' }, { title: 'B' }] });

    const { bytes, path } = await insertSlide(original, { afterSldId: 257 });

    expect(await readPart(bytes, '[Content_Types].xml')).toContain(
      `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
    expect(await readPart(bytes, 'docProps/app.xml')).toContain('<Slides>3</Slides>');
    expect(await readPart(bytes, 'ppt/slides/_rels/slide3.xml.rels')).toContain(
      'Target="../slideLayouts/slideLayout2.xml"',
    );

    const changed = new Set([
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      '[Content_Types].xml',
      'docProps/app.xml',
    ]);
    const before = await JSZip.loadAsync(original);
    const after = await JSZip.loadAsync(bytes);
    for (const name of Object.keys(before.files).filter((name) => !changed.has(name))) {
      expect(await after.file(name)?.async('string'), name).toBe(
        await before.file(name)?.async('string'),
      );
    }
  });

  it('refuses a slide id that is not in the deck', async () => {
    const original = await buildPptx({ slides: [{ title: 'A' }] });

    await expect(insertSlide(original, { afterSldId: 999 })).rejects.toBeInstanceOf(
      SlideInsertError,
    );
  });
});
