import { describe, expect, it } from 'vitest';
import { textHash } from '../src/hash';
import { LAYOUT_NAMES } from './fixtures/build-pptx';
import { defined, openDeck } from './helpers';

describe('presentation structure', () => {
  it('lists slides in sldIdLst order with their ids, paths and size', async () => {
    const { presentation } = await openDeck({
      size: { cx: 9_144_000, cy: 6_858_000 },
      slides: [
        { sldId: 300, title: 'First' },
        { sldId: 257, title: 'Second' },
        { sldId: 1024, title: 'Third' },
      ],
    });

    expect(presentation.size).toEqual({ cx: 9_144_000, cy: 6_858_000 });
    expect(presentation.slides.map(({ sldId, index, path }) => ({ sldId, index, path }))).toEqual([
      { sldId: 300, index: 0, path: 'ppt/slides/slide1.xml' },
      { sldId: 257, index: 1, path: 'ppt/slides/slide2.xml' },
      { sldId: 1024, index: 2, path: 'ppt/slides/slide3.xml' },
    ]);
  });

  it('flags hidden slides', async () => {
    const { presentation } = await openDeck({
      slides: [{ title: 'Visible' }, { title: 'Backup', hidden: true }],
    });

    expect(presentation.slides.map((slide) => slide.hidden)).toEqual([false, true]);
  });

  it('reads sections with the sldIds they contain', async () => {
    const { presentation } = await openDeck({
      slides: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      sections: [
        { name: 'Intro', slides: [0] },
        { name: 'Analyse & Ausblick', slides: [1, 2] },
      ],
    });

    expect(presentation.sections).toEqual([
      { name: 'Intro', slideIds: [256] },
      { name: 'Analyse & Ausblick', slideIds: [257, 258] },
    ]);
  });

  it('has no sections when the deck defines none', async () => {
    const { presentation } = await openDeck({ slides: [{ title: 'A' }] });
    expect(presentation.sections).toEqual([]);
  });
});

describe('slide metadata', () => {
  it('takes the title from the title or ctrTitle placeholder', async () => {
    const { presentation } = await openDeck({
      slides: [
        { layout: 'title', title: 'Q4 Strategie', body: 'Untertitel' },
        { title: 'Agenda', body: ['Punkt 1'] },
        { body: ['Only body text'] },
      ],
    });

    expect(presentation.slides.map((slide) => slide.title)).toEqual([
      'Q4 Strategie',
      'Agenda',
      null,
    ]);
  });

  it('names the layout of each slide', async () => {
    const { presentation } = await openDeck({
      slides: [{ layout: 'title', title: 'A' }, { title: 'B' }],
    });

    expect(presentation.slides.map((slide) => slide.layoutName)).toEqual([
      LAYOUT_NAMES.title,
      LAYOUT_NAMES.content,
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

  it('uses the slide background, falling back to the master (theme colour bg1)', async () => {
    const { presentation } = await openDeck({
      slides: [{ title: 'Dark', background: '0F172A' }, { title: 'Default' }],
    });

    expect(presentation.slides.map((slide) => slide.background)).toEqual(['#0f172a', '#ffffff']);
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

  it('reads raw bytes of package entries', async () => {
    const pptx = await openDeck({ slides: [{ title: 'A' }] });

    expect(
      new TextDecoder().decode(defined(await pptx.readFile('ppt/presentation.xml'))),
    ).toContain('p:sldIdLst');
    expect(await pptx.readFile('ppt/missing.xml')).toBeNull();
  });
});
