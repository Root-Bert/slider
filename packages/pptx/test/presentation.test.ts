import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { openPptx } from '../src';
import { textHash } from '../src/hash';
import { buildPptx, LAYOUT_NAMES } from './fixtures/build-pptx';
import { defined, openDeck } from './helpers';

describe('presentation structure', () => {
  it('lists slides in sldIdLst order with ids, paths, size, hidden flags, sections and guides', async () => {
    const { presentation } = await openDeck({
      size: { cx: 9_144_000, cy: 6_858_000 },
      slides: [
        { sldId: 300, title: 'First' },
        { sldId: 257, title: 'Second', hidden: true },
        { sldId: 1024, title: 'Third' },
      ],
      sections: [
        { name: 'Intro', slides: [0] },
        { name: 'Analyse & Ausblick', slides: [1, 2] },
      ],
      // 4:3 is 5760 × 4320 master units; the last one lies off the slide.
      guides: [
        { orient: 'horz', pos: 2160 },
        { orient: 'vert', pos: 288 },
        { orient: 'vert', pos: 288 },
        { orient: 'vert', pos: 9000 },
      ],
    });

    expect(presentation.size).toEqual({ cx: 9_144_000, cy: 6_858_000 });
    expect(presentation.slides.map(({ sldId, index, path }) => ({ sldId, index, path }))).toEqual([
      { sldId: 300, index: 0, path: 'ppt/slides/slide1.xml' },
      { sldId: 257, index: 1, path: 'ppt/slides/slide2.xml' },
      { sldId: 1024, index: 2, path: 'ppt/slides/slide3.xml' },
    ]);
    expect(presentation.slides.map((slide) => slide.hidden)).toEqual([false, true, false]);
    expect(presentation.sections).toEqual([
      { name: 'Intro', slideIds: [300] },
      { name: 'Analyse & Ausblick', slideIds: [257, 1024] },
    ]);
    for (const slide of presentation.slides) {
      expect(slide.guides).toEqual([
        { orientation: 'horizontal', position: 0.5 },
        { orientation: 'vertical', position: 0.05 },
      ]);
    }
  });

  it('has no sections or guides when the deck defines none, and reads raw package bytes', async () => {
    const pptx = await openDeck({ slides: [{ title: 'A' }] });
    expect(pptx.presentation.sections).toEqual([]);
    expect(defined(pptx.presentation.slides[0]).guides).toEqual([]);
    expect(
      new TextDecoder().decode(defined(await pptx.readFile('ppt/presentation.xml'))),
    ).toContain('p:sldIdLst');
    expect(await pptx.readFile('ppt/missing.xml')).toBeNull();
  });

  it('refuses a slide list that names one slide part twice', async () => {
    const zip = await JSZip.loadAsync(
      await buildPptx({ slides: [{ title: 'A' }, { title: 'B' }] }),
    );
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const rels = defined(await zip.file(relsPath)?.async('string'), 'presentation rels');
    zip.file(relsPath, rels.replace('slides/slide2.xml', 'slides/slide1.xml'));

    await expect(openPptx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toMatchObject({
      code: 'corrupt',
    });
  });
});

describe('slide metadata', () => {
  it('takes the title from the title or ctrTitle placeholder, names the layout, reads the background', async () => {
    const { presentation } = await openDeck({
      slides: [
        { layout: 'title', title: 'Q4 Strategie', body: 'Untertitel', background: '0F172A' },
        { title: 'Agenda', body: ['Punkt 1'] },
        { body: ['Only body text'] },
      ],
    });

    expect(presentation.slides.map((slide) => slide.title)).toEqual([
      'Q4 Strategie',
      'Agenda',
      null,
    ]);
    expect(presentation.slides.map((slide) => slide.layoutName)).toEqual([
      LAYOUT_NAMES.title,
      LAYOUT_NAMES.content,
      LAYOUT_NAMES.content,
    ]);
    // The slide's own background, else the master's (theme colour bg1).
    expect(presentation.slides.map((slide) => slide.background)).toEqual([
      '#0f172a',
      '#ffffff',
      '#ffffff',
    ]);
  });

  it('hashes the normalised slide text so cosmetic changes keep the hash', async () => {
    const { presentation } = await openDeck({
      slides: [
        { title: 'Umsatz  nach Region', body: ['DACH', 'Nordeuropa'] },
        { title: 'umsatz nach region', body: ['DACH  ', 'NORDEUROPA'] },
        { title: 'Umsatz nach Region', body: ['DACH', 'Südeuropa'] },
      ],
    });
    const [first, second, third] = presentation.slides.map((slide) => slide.textHash);

    expect(first).toBe(textHash('Umsatz nach Region\nDACH\nNordeuropa'));
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it('exposes table cells as rows and as tab-separated text', async () => {
    const { presentation } = await openDeck({
      slides: [
        {
          title: 'Tabelle',
          shapes: [
            {
              type: 'table',
              box: { x: 0, y: 0, w: 6_000_000, h: 2_000_000 },
              rows: [
                ['Region', 'Umsatz'],
                ['DACH', '12,4'],
              ],
            },
          ],
        },
      ],
    });
    const table = defined(presentation.slides[0]?.shapes.find((shape) => shape.kind === 'table'));

    expect(table.tableRows).toEqual([
      ['Region', 'Umsatz'],
      ['DACH', '12,4'],
    ]);
    expect(table.text).toBe('Region\tUmsatz\nDACH\t12,4');
  });
});

describe('Strict Open XML', () => {
  /** Rewrites every relationship type to the strict namespace, as "Strict Open XML" saves do. */
  async function toStrict(bytes: Uint8Array): Promise<Uint8Array> {
    const zip = await JSZip.loadAsync(bytes);
    for (const path of Object.keys(zip.files).filter((p) => p.endsWith('.rels'))) {
      const xml = await defined(zip.file(path)).async('string');
      zip.file(
        path,
        xml.replaceAll(
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
          'http://purl.oclc.org/ooxml/officeDocument/relationships/',
        ),
      );
    }
    return zip.generateAsync({ type: 'uint8array' });
  }

  it('reads layouts, placeholder boxes and legacy comments like a transitional file', async () => {
    const bytes = await buildPptx({
      slides: [
        {
          title: 'Kickoff',
          body: ['Eins', 'Zwei'],
          legacyComments: [
            { author: 'Lena', text: 'Erster', position: { x: 10, y: 10 } },
            { author: 'Jonas', text: 'Zweiter', position: { x: 20, y: 20 } },
          ],
        },
      ],
    });
    const transitional = (await openPptx(bytes)).presentation;
    const strict = (await openPptx(await toStrict(bytes))).presentation;
    const slide = defined(strict.slides[0]);
    expect(slide.layoutName).toBe(defined(transitional.slides[0]).layoutName);
    expect(slide.layoutName).not.toBeNull();
    expect(slide.shapes.map((shape) => shape.bbox)).toEqual(
      defined(transitional.slides[0]).shapes.map((shape) => shape.bbox),
    );
    expect(slide.shapes.every((shape) => shape.bbox.w > 0 && shape.bbox.h > 0)).toBe(true);
    expect(strict.comments.map((comment) => comment.text)).toEqual(['Erster', 'Zweiter']);
  });
});
