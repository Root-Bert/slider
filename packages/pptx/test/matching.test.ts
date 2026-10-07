import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assignPairs,
  fingerprintFromParsed,
  hungarian,
  jaccard,
  longestIncreasingSubsequence,
  matchSlides,
  relinkDeletedSlides,
  tokens,
  type SlideFingerprint,
  type SlideMatchResult,
} from '../src';
import { sampleDeck } from '../scripts/sample-deck';
import type { DeckSpec, SlideSpec } from './fixtures/build-pptx';
import { openDeck } from './helpers';

/** The sample deck's slides with explicit sldIds, so variants can drop or reorder slides. */
const BASE: SlideSpec[] = sampleDeck.slides.map((slide, index) => ({
  ...slide,
  sldId: 256 + index,
}));
const TITLES = BASE.map((slide) => slide.title ?? '');

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** Opens a deck and returns fingerprints keyed by `title#sldId` with render hashes. */
async function fingerprints(
  slides: SlideSpec[],
  options: { withRender?: boolean; dropSldId?: boolean } = {},
): Promise<SlideFingerprint[]> {
  const deck: DeckSpec = { title: sampleDeck.title, slides };
  const pkg = await openDeck(deck);
  return Promise.all(
    pkg.presentation.slides.map(async (slide) => {
      const fp = fingerprintFromParsed(slide, {
        key: `${slide.title ?? ''}#${slide.sldId}`,
        renderHash: options.withRender === false ? null : sha(await pkg.renderSlideSvg(slide)),
      });
      return options.dropSldId ? { ...fp, sldId: null } : fp;
    }),
  );
}

const title = (key: string | null) => (key ? key.split('#')[0] : null);
const byStatus = (results: SlideMatchResult[], status: SlideMatchResult['status']) =>
  results.filter((result) => result.status === status);

let baseline: SlideFingerprint[] | undefined;
const base = async () => (baseline ??= await fingerprints(BASE));

describe('matchSlides on the sample deck', () => {
  it('(1) identical deck: everything unchanged, by sldId, confidence 1', async () => {
    const results = matchSlides(await base(), await fingerprints(BASE));
    expect(results).toHaveLength(6);
    for (const result of results) {
      expect(result).toMatchObject({ status: 'unchanged', moved: false, confidence: 1 });
      expect(result.matchedBy).toBe('sldId');
      expect(result.prevKey).toBe(result.nextKey);
    }
  });

  it('(2) text edited: only that slide is modified', async () => {
    const edited = BASE.map((slide, i) =>
      i === 1
        ? {
            ...slide,
            body: [
              'Rückblick Q3: Ziele und Ergebnisse',
              'Umsatz nach Region und Land',
              'Produkt-Roadmap bis Jahresende',
              'Nächste Schritte und Verantwortlichkeiten',
            ],
          }
        : slide,
    );
    const results = matchSlides(await base(), await fingerprints(edited));
    const modified = byStatus(results, 'modified');
    expect(modified).toHaveLength(1);
    expect(modified[0]).toMatchObject({ prevKey: 'Agenda#257', nextKey: 'Agenda#257' });
    expect(byStatus(results, 'unchanged')).toHaveLength(5);
  });

  it('(3) reordered: swapping two slides marks exactly one as moved', async () => {
    const swapped = [BASE[0], BASE[2], BASE[1], BASE[3], BASE[4], BASE[5]] as SlideSpec[];
    const results = matchSlides(await base(), await fingerprints(swapped));
    expect(byStatus(results, 'moved')).toHaveLength(1);
    expect(byStatus(results, 'new')).toHaveLength(0);
    expect(byStatus(results, 'deleted')).toHaveLength(0);
    expect(byStatus(results, 'unchanged')).toHaveLength(5);
  });

  it('(4) inserted: one new slide, the following slides are not moved', async () => {
    const inserted: SlideSpec = { sldId: 400, title: 'Wettbewerb', body: ['Marktanteile 2026'] };
    const slides = [BASE[0], BASE[1], inserted, ...BASE.slice(2)] as SlideSpec[];
    const results = matchSlides(await base(), await fingerprints(slides));
    expect(byStatus(results, 'new').map((r) => title(r.nextKey))).toEqual(['Wettbewerb']);
    expect(byStatus(results, 'unchanged')).toHaveLength(6);
    expect(results.some((r) => r.moved)).toBe(false);
  });

  it('(5) deleted: one slide is deleted, the rest unchanged', async () => {
    const slides = BASE.filter((slide) => slide.title !== 'Umsatz nach Region');
    const results = matchSlides(await base(), await fingerprints(slides));
    const deleted = byStatus(results, 'deleted');
    expect(deleted.map((r) => r.prevKey)).toEqual(['Umsatz nach Region#258']);
    expect(deleted[0]?.confidence).toBeGreaterThan(0.5);
    expect(byStatus(results, 'unchanged')).toHaveLength(5);
    // Deleted slides come last, after the slides of the new revision.
    expect(results.at(-1)?.status).toBe('deleted');
  });

  it('(6) duplicated: the original keeps its identity, the copy is new', async () => {
    const copy = { ...BASE[1], sldId: 300 } as SlideSpec;
    const slides = [BASE[0], BASE[1], copy, ...BASE.slice(2)] as SlideSpec[];
    const results = matchSlides(await base(), await fingerprints(slides));
    expect(results.find((r) => r.nextKey === 'Agenda#257')).toMatchObject({
      prevKey: 'Agenda#257',
      status: 'unchanged',
    });
    expect(byStatus(results, 'new').map((r) => r.nextKey)).toEqual(['Agenda#300']);
  });

  it('(6b) duplicated without sldIds: the copy nearest the old position keeps the identity', async () => {
    const copy = { ...BASE[1], sldId: 300 } as SlideSpec;
    const slides = [BASE[0], BASE[1], copy, ...BASE.slice(2)] as SlideSpec[];
    const prev = await fingerprints(BASE, { dropSldId: true });
    const next = await fingerprints(slides, { dropSldId: true });
    const results = matchSlides(prev, next);
    expect(results.find((r) => r.nextKey === 'Agenda#257')?.prevKey).toBe('Agenda#257');
    expect(byStatus(results, 'new').map((r) => r.nextKey)).toEqual(['Agenda#300']);
  });

  it('(7) renumbered: all sldIds +1000 are matched by content', async () => {
    const renumbered = BASE.map((slide) => ({ ...slide, sldId: (slide.sldId ?? 0) + 1000 }));
    const results = matchSlides(await base(), await fingerprints(renumbered));
    expect(results.every((r) => r.matchedBy === 'content' && r.status === 'unchanged')).toBe(true);
    expect(results.map((r) => title(r.prevKey))).toEqual(TITLES);
  });

  it('(7b) shuffled sldIds: the renumber guard drops them and content wins', async () => {
    // Every slide gets the id of its successor, so ids point at other content.
    const shuffled = BASE.map((slide, i) => ({ ...slide, sldId: 256 + ((i + 1) % BASE.length) }));
    const results = matchSlides(await base(), await fingerprints(shuffled));
    expect(byStatus(results, 'new')).toHaveLength(0);
    expect(byStatus(results, 'deleted')).toHaveLength(0);
    for (const result of results) {
      expect(title(result.prevKey)).toBe(title(result.nextKey));
      expect(result.matchedBy).toBe('content');
    }
  });

  it('(8) legacy rows without sldId: edited + renumbered + deleted combined', async () => {
    const slides = BASE.filter((slide) => slide.title !== 'Produkt-Roadmap').map((slide) =>
      slide.title === 'Agenda'
        ? {
            ...slide,
            sldId: 900,
            body: ['Rückblick Q3: Ziele und Ergebnisse', 'Umsatz nach Region', 'Nächste Schritte'],
          }
        : { ...slide, sldId: (slide.sldId ?? 0) + 2000 },
    );
    const prev = (await base()).map((fp) => ({ ...fp, sldId: null }));
    const results = matchSlides(prev, await fingerprints(slides));
    const agenda = results.find((r) => title(r.nextKey) === 'Agenda');
    expect(agenda).toMatchObject({
      prevKey: 'Agenda#257',
      status: 'modified',
      matchedBy: 'content',
    });
    expect(agenda?.confidence).toBeGreaterThanOrEqual(0.45);
    expect(byStatus(results, 'deleted').map((r) => title(r.prevKey))).toEqual(['Produkt-Roadmap']);
    expect(byStatus(results, 'new')).toHaveLength(0);
  });

  it('(9) picture-only slides match via render hash, empty slides via layout and neighbours', async () => {
    const picture: SlideSpec = {
      sldId: 500,
      shapes: [{ type: 'picture', name: 'Foto', box: { x: 0, y: 0, w: 6_000_000, h: 3_000_000 } }],
    };
    const empty: SlideSpec = { sldId: 501 };
    const before = [BASE[0], picture, empty, BASE[5]] as SlideSpec[];
    const after = before.map((slide) => ({ ...slide, sldId: (slide.sldId ?? 0) + 7 }));
    const withRender = matchSlides(await fingerprints(before), await fingerprints(after));
    expect(withRender.every((r) => r.status === 'unchanged')).toBe(true);
    expect(withRender.map((r) => r.prevKey)).toEqual([
      'Q4 Strategie 2026#256',
      '#500',
      '#501',
      'Vielen Dank#261',
    ]);

    const noRender = matchSlides(
      await fingerprints(before, { withRender: false }),
      await fingerprints(after, { withRender: false }),
    );
    expect(byStatus(noRender, 'new')).toHaveLength(0);
    expect(noRender.map((r) => r.prevKey)).toEqual(withRender.map((r) => r.prevKey));
  });
});

describe('matching helpers', () => {
  it('tokenises normalised words of two or more characters', () => {
    expect([...tokens('Q4 Strategie – 2026, a b')]).toEqual(['q4', 'strategie', '2026']);
    expect(tokens(null).size).toBe(0);
  });

  it('computes Jaccard similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBeNull();
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
  });

  it('finds a longest increasing subsequence', () => {
    expect([...longestIncreasingSubsequence([0, 2, 1, 3])].sort()).toHaveLength(3);
    expect(longestIncreasingSubsequence([0, 1, 2, 3]).size).toBe(4);
    expect(longestIncreasingSubsequence([3, 2, 1, 0]).size).toBe(1);
    expect(longestIncreasingSubsequence([]).size).toBe(0);
  });

  it('solves a 3×3 assignment optimally', () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    // Greedy would take (1,1)=0 first and end at 0+4+2=6; the optimum is 1+2+2=5.
    expect(hungarian(cost)).toEqual([1, 0, 2]);
  });

  it('solves rectangular assignments in both orientations', () => {
    expect(hungarian([[5, 1, 9, 3]])).toEqual([1]);
    expect(hungarian([[5], [1], [9]])).toEqual([-1, 0, -1]);
    expect(
      hungarian([
        [1, 9],
        [9, 1],
        [5, 5],
      ]),
    ).toEqual([0, 1, -1]);
  });

  it('accepts pairs at the threshold only', () => {
    expect(assignPairs([[0.44]], 0.45)).toEqual([-1]);
    expect(assignPairs([[0.46]], 0.45)).toEqual([0]);
  });

  it('turns a below-threshold pair into new + deleted', () => {
    const fp = (key: string, text: string): SlideFingerprint => ({
      key,
      sldId: null,
      position: 0,
      title: null,
      layoutName: null,
      textHash: null,
      text,
    });
    const results = matchSlides([fp('a', 'alpha beta gamma')], [fp('b', 'delta epsilon zeta')]);
    expect(results.map((r) => r.status)).toEqual(['new', 'deleted']);
    expect(results[0]?.confidence).toBeGreaterThan(0.5);
  });

  it('keeps a same-sldId pair even when the slide text was fully rewritten (regression)', () => {
    const deck = (rewrite: boolean): SlideFingerprint[] =>
      Array.from({ length: 10 }, (_, i) => {
        const text =
          rewrite && i === 3
            ? 'Komplett neuer Inhalt ohne Überschneidung mit vorher'
            : `Folie ${i} Thema${i} Punkt eins${i} Punkt zwei${i}`;
        return {
          key: `${rewrite ? 'n' : 'p'}${i}`,
          sldId: 256 + i,
          position: i,
          title: rewrite && i === 3 ? 'Neuer Titel' : `Titel ${i}`,
          layoutName: 'Titel und Inhalt',
          textHash: text,
          text,
        };
      });
    const results = matchSlides(deck(false), deck(true));
    expect(results).toHaveLength(10);
    const rewritten = results.find((r) => r.nextKey === 'n3');
    expect(rewritten).toMatchObject({ prevKey: 'p3', status: 'modified', matchedBy: 'sldId' });
    expect(results.filter((r) => r.status === 'new' || r.status === 'deleted')).toEqual([]);
  });

  it('re-links restored slides by content only, and not on a mere sldId reuse', () => {
    const fp = (key: string, sldId: number, title: string, text: string): SlideFingerprint => ({
      key,
      sldId,
      position: 0,
      title,
      layoutName: 'Titel und Inhalt',
      textHash: text,
      text: `${title}\n${text}`,
    });
    const deleted = [fp('old-a', 261, 'Vielen Dank', 'Fragen und Diskussion')];
    expect(
      relinkDeletedSlides(deleted, [fp('n5', 300, 'Vielen Dank', 'Fragen und Diskussion')]),
    ).toEqual(new Map([['n5', 'old-a']]));
    expect(relinkDeletedSlides(deleted, [fp('n5', 261, 'Anhang', 'Glossar Quellen')])).toEqual(
      new Map(),
    );
    expect(relinkDeletedSlides([], [fp('n5', 261, 'Anhang', 'Glossar')]).size).toBe(0);
  });
});
