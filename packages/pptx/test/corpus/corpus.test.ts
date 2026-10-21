import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SlideMatchStatus } from '../../src';
import { CASES, CORPUS_DIR, REAL_DIR } from './cases';
import {
  buildCase,
  formatExpected,
  metaOf,
  runCase,
  writeCase,
  type DeckSummary,
  type Expected,
} from './run-case';

/**
 * BER-106 corpus. Per case: (1) the committed decks are what `cases.ts` builds, (2) matching the
 * committed decks gives exactly `expected.json`, (3) hand-written assertions of what the case is
 * about, so regenerating `expected.json` cannot quietly bless a regression.
 *
 * Regenerate after an intended change: `bun run corpus` or `UPDATE_CORPUS=1 bunx vitest run
 * packages/pptx/test/corpus`.
 */

const UPDATE = process.env.UPDATE_CORPUS === '1';

const readExpected = async (dir: string): Promise<Expected> =>
  JSON.parse(await readFile(join(dir, 'expected.json'), 'utf8')) as Expected;

// ── Helpers for the intents ─────────────────────────────────────────────────

/**
 * Every slide not named in `changes` is `unchanged` and not moved; named ones have the given
 * status. Labels are keyed by the next deck (by the previous one for deleted slides).
 */
function expectChanges(
  e: Expected,
  changes: Record<string, SlideMatchStatus>,
  options: { matchedBy?: 'sldId' | 'content' } = {},
): void {
  const seen = new Set<string>();
  for (const match of e.matches) {
    const label = match.next ?? match.prev ?? '';
    seen.add(label);
    const want = changes[label] ?? 'unchanged';
    expect(match.status, label).toBe(want);
    if (want === 'unchanged') expect(match.moved, label).toBe(false);
    if (options.matchedBy && match.prev && match.next) {
      expect(match.matchedBy, label).toBe(options.matchedBy);
    }
  }
  for (const label of Object.keys(changes)) expect(seen.has(label), label).toBe(true);
}

const slide = (deck: DeckSummary, label: string) => {
  const found = deck.slides.find((s) => s.label === label);
  if (!found) throw new Error(`No slide ${label}`);
  return found;
};
/** `hiddenChanged` by label; slides without one are left out. */
const hiddenChanges = (e: Expected) =>
  Object.fromEntries(
    e.matches.flatMap((m) => (m.hiddenChanged ? [[m.next ?? m.prev, m.hiddenChanged]] : [])),
  );
const hiddenLabels = (deck: DeckSummary) => deck.slides.filter((s) => s.hidden).map((s) => s.label);
const match = (e: Expected, label: string) => {
  const found = e.matches.find((m) => (m.next ?? m.prev) === label);
  if (!found) throw new Error(`No match for ${label}`);
  return found;
};

const expectGoogleExport = (deck: DeckSummary) => {
  expect(deck.sections).toEqual([]);
  expect(deck.comments).toEqual([]);
  expect(deck.slides.map((s) => s.sldId)).toEqual(deck.slides.map((_, i) => 256 + i));
  expect(deck.slides.map((s) => s.part)).toEqual(
    deck.slides.map((_, i) => `ppt/slides/slide${i + 1}.xml`),
  );
  for (const s of deck.slides) expect(['TITLE', 'TITLE_AND_BODY']).toContain(s.layoutName);
};

// ── Intents, one per case ───────────────────────────────────────────────────

const INTENTS: Record<string, (e: Expected) => void> = {
  'basis-simple': (e) => expectChanges(e, {}, { matchedBy: 'sldId' }),
  'basis-hidden': (e) => {
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect(hiddenLabels(e.next)).toEqual(['reserve', 'anhang']);
  },
  'basis-groups': (e) => expectChanges(e, {}, { matchedBy: 'sldId' }),
  'basis-sections': (e) => {
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect(e.next.sections.map((s) => s.name)).toEqual(['Einleitung', 'Analyse', 'Abschluss']);
  },

  'insert-start': (e) => {
    expectChanges(e, { neu: 'new' }, { matchedBy: 'sldId' });
    expect(match(e, 'neu').position).toBe(0);
    expect(slide(e.next, 'neu').sldId).toBe(261);
  },
  'insert-start-slide-numbers': (e) => {
    // Every later slide got a new number (and the date changed): still unchanged.
    expectChanges(e, { neu: 'new' }, { matchedBy: 'sldId' });
    expect(match(e, 'neu').position).toBe(0);
  },
  'insert-middle': (e) => {
    expectChanges(e, { neu: 'new' }, { matchedBy: 'sldId' });
    expect(match(e, 'neu').position).toBe(2);
  },
  'insert-end': (e) => {
    expectChanges(e, { neu: 'new' }, { matchedBy: 'sldId' });
    expect(match(e, 'neu').position).toBe(5);
  },
  'delete-middle': (e) => {
    expectChanges(e, { ziele: 'deleted' }, { matchedBy: 'sldId' });
    expect(e.matches.at(-1)).toMatchObject({ prev: 'ziele', next: null, previousPosition: 2 });
  },
  'move-slide': (e) => {
    expectChanges(e, { budget: 'moved' }, { matchedBy: 'sldId' });
    expect(match(e, 'budget')).toMatchObject({ previousPosition: 4, position: 2, moved: true });
  },
  'move-section': (e) => {
    // The matcher keeps the longest run in order, so the two "Abschluss" slides count as moved,
    // not the three "Analyse" slides that were actually dragged (see README, Known behaviour).
    expectChanges(e, { fazit: 'moved', fragen: 'moved' }, { matchedBy: 'sldId' });
    expect(e.next.sections.map((s) => s.name)).toEqual(['Einleitung', 'Abschluss', 'Analyse']);
    for (const s of e.next.slides) expect(s.section).toBe(slide(e.prev, s.label).section);
  },
  duplicate: (e) => {
    expectChanges(e, { 'ziele-kopie': 'new' }, { matchedBy: 'sldId' });
    const copy = slide(e.next, 'ziele-kopie');
    expect(copy.sldId).not.toBe(slide(e.next, 'ziele').sldId);
    expect(copy.title).toBe(slide(e.next, 'ziele').title);
  },
  'reuse-slides': (e) => {
    // Same title as the existing budget slide: it must still be new, and budget untouched.
    expectChanges(e, { 'fremd-budget': 'new' }, { matchedBy: 'sldId' });
    expect(slide(e.next, 'fremd-budget')).toMatchObject({
      title: 'Budget',
      layoutName: '1_Title and Content',
    });
  },

  'text-changed': (e) => {
    expectChanges(e, { ziele: 'modified' }, { matchedBy: 'sldId' });
    expect(match(e, 'ziele').confidence).toBeLessThan(1);
  },
  'image-swapped': (e) => expectChanges(e, { zeitplan: 'modified' }, { matchedBy: 'sldId' }),
  'layout-changed': (e) => {
    expectChanges(e, { agenda: 'modified' }, { matchedBy: 'sldId' });
    expect(slide(e.prev, 'agenda').layoutName).toBe('Title and Content');
    expect(slide(e.next, 'agenda').layoutName).toBe('Title Slide');
  },
  'groups-text-changed': (e) =>
    expectChanges(e, { organigramm: 'modified' }, { matchedBy: 'sldId' }),

  hide: (e) => {
    // Hiding is no content change; it comes as its own signal.
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect(hiddenLabels(e.prev)).toEqual([]);
    expect(hiddenLabels(e.next)).toEqual(['zeitplan']);
    expect(hiddenChanges(e)).toEqual({ zeitplan: 'hidden' });
  },
  unhide: (e) => {
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect(hiddenLabels(e.prev)).toEqual(['reserve', 'anhang']);
    expect(hiddenLabels(e.next)).toEqual(['anhang']);
    expect(hiddenChanges(e)).toEqual({ reserve: 'shown' });
  },

  'comments-modern': (e) => {
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect(e.prev.comments).toEqual([]);
    expect(e.next.comments.map((c) => [c.slide, c.format, c.anchor, c.status])).toEqual([
      ['agenda', 'modern', 'shape', 'open'],
      ['ziele', 'modern', 'point', 'open'],
      ['budget', 'modern', 'slide', 'open'],
    ]);
  },
  'comments-legacy': (e) => {
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect(e.next.comments.map((c) => [c.slide, c.format, c.author])).toEqual([
      ['agenda', 'legacy', 'Lena Hoffmann'],
      ['budget', 'legacy', 'Jonas Weber'],
      ['budget', 'legacy', 'Lena Hoffmann'],
    ]);
    for (const c of e.next.comments) expect(c).toMatchObject({ status: 'open', replies: 0 });
  },
  'comments-threads': (e) => {
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect(e.prev.comments.map((c) => c.replies)).toEqual([1]);
    expect(e.next.comments.map((c) => [c.slide, c.replies, c.status])).toEqual([
      ['agenda', 3, 'open'],
    ]);
  },
  'comments-legacy-threads': (e) => {
    // p15:threadingInfo/p15:parentCm: the two replies hang under their root comment.
    expect(e.next.comments).toHaveLength(1);
    expect(e.next.comments[0]).toMatchObject({ slide: 'agenda', format: 'legacy', replies: 2 });
  },
  'comments-resolved': (e) => {
    expect(e.prev.comments.map((c) => c.status)).toEqual(['open', 'open', 'open']);
    expect(e.next.comments.map((c) => c.status)).toEqual(['done', 'done', 'open']);
  },
  'comments-moved-slide': (e) => {
    expectChanges(e, { agenda: 'moved' }, { matchedBy: 'sldId' });
    expect(e.next.comments.map((c) => c.slide)).toEqual(['agenda']);
    expect(slide(e.next, 'agenda').sldId).toBe(slide(e.prev, 'agenda').sldId);
  },

  'google-roundtrip': (e) => {
    // Google renumbers the sldIds: the guard drops them and content finds every slide again.
    // The render is identical, so nothing counts as modified despite the renamed layouts.
    expectChanges(e, {}, { matchedBy: 'content' });
    expectGoogleExport(e.next);
    expect(e.prev.sections).toHaveLength(3);
    expect(e.prev.comments).toHaveLength(1);
  },
  'google-insert': (e) => {
    expectChanges(e, { neu: 'new' }, { matchedBy: 'content' });
    expectGoogleExport(e.prev);
    expectGoogleExport(e.next);
    // The old ids now point at the slide before: trusting them would have been wrong.
    expect(slide(e.next, 'kickoff').sldId).toBe(slide(e.prev, 'agenda').sldId);
  },
  'google-move': (e) => {
    expectChanges(e, { budget: 'moved' }, { matchedBy: 'content' });
    expectGoogleExport(e.next);
  },
  'google-hidden': (e) => {
    expectChanges(e, {});
    expect(hiddenChanges(e)).toEqual({ reserve: 'shown' });
    expectGoogleExport(e.next);
    expect(hiddenLabels(e.prev)).toEqual(['reserve', 'anhang']);
    expect(hiddenLabels(e.next)).toEqual(['anhang']);
  },

  'producer-win': (e) => {
    expectChanges(e, { ziele: 'modified' }, { matchedBy: 'sldId' });
    expect(e.next.comments.map((c) => [c.format, c.status, c.providerId, c.replies])).toEqual([
      ['modern', 'done', 'AD', 2],
      ['modern', 'open', 'Windows Live', 0],
    ]);
  },
  'producer-mac': (e) => {
    expectChanges(e, { ziele: 'modified' }, { matchedBy: 'sldId' });
    // Legacy comments: threads come back via p15:threadingInfo, "resolved" is lost.
    expect(e.next.comments.map((c) => [c.format, c.status, c.replies])).toEqual([
      ['legacy', 'open', 2],
      ['legacy', 'open', 0],
    ]);
  },
  'producer-online': (e) => {
    expectChanges(e, { ziele: 'modified' }, { matchedBy: 'sldId' });
    expect(e.next.author).toBe('Mira Schulz');
    expect(e.next.comments.map((c) => [c.format, c.status, c.providerId])).toEqual([
      ['modern', 'done', 'AD'],
      ['modern', 'open', 'Windows Live'],
    ]);
  },
  'producer-win-to-online': (e) => {
    expectChanges(e, {}, { matchedBy: 'sldId' });
    expect([e.prev.author, e.next.author]).toEqual(['Jonas Weber', 'Mira Schulz']);
    expect(e.next.comments).toEqual(e.prev.comments);
  },
  'producer-win-move': (e) => {
    expectChanges(e, { budget: 'moved' }, { matchedBy: 'sldId' });
    for (const s of e.next.slides) expect(s.part).toBe(slide(e.prev, s.label).part);
  },

  'rewrite-most-slides': (e) => {
    // Most sldId pairs disagree on content, but nothing points elsewhere: keep every sldId.
    expectChanges(
      e,
      { kickoff: 'modified', agenda: 'modified', ziele: 'modified', zeitplan: 'modified' },
      { matchedBy: 'sldId' },
    );
    for (const m of e.matches) expect(m.prev).toBe(m.next);
  },
  'ppt-delete-last-insert': (e) => {
    expect(slide(e.next, 'neu').sldId).toBe(slide(e.prev, 'budget').sldId);
    expectChanges(e, { neu: 'new', budget: 'deleted' }, { matchedBy: 'sldId' });
  },
  'google-insert-late': (e) => {
    expectChanges(e, { neu: 'new' });
    expect(match(e, 'zeitplan').prev).toBe('zeitplan');
    expect(match(e, 'budget').prev).toBe('budget');
    // Positional ids with a shifted pair say nothing about any slide: content finds them all.
    for (const m of e.matches) if (m.prev && m.next) expect(m.matchedBy, m.next).toBe('content');
  },
  'google-delete-late': (e) => {
    expectChanges(e, { zeitplan: 'deleted' });
    expect(match(e, 'budget').prev).toBe('budget');
  },
  // A shared footer makes neighbours look alike; the shifted ids must still not win.
  'google-insert-footer': (e) => {
    expectChanges(e, { neu: 'new' });
    expectGoogleExport(e.next);
  },
  'google-delete-footer': (e) => {
    expectChanges(e, { agenda: 'deleted' });
    expectGoogleExport(e.next);
  },
  'google-move-footer': (e) => {
    expectChanges(e, { budget: 'moved' });
    expectGoogleExport(e.next);
  },
  // Edited slides have no exact twin elsewhere; the shifted ids must still not win.
  'google-insert-edits': (e) => {
    expectChanges(e, { neu: 'new', kickoff: 'modified', agenda: 'modified', ziele: 'modified' });
    expectGoogleExport(e.prev);
    expectGoogleExport(e.next);
  },
  'ppt-replace-slide-same-title': (e) => {
    expect(slide(e.next, 'ziele-neu').title).toBe(slide(e.prev, 'ziele').title);
    expectChanges(e, { 'ziele-neu': 'new', ziele: 'deleted' }, { matchedBy: 'sldId' });
    // The one box both share – the title, same name and text – carries its comments over.
    expect(e.movedBoxes).toEqual([
      { prev: 'ziele', shape: '2', next: 'ziele-neu', nextShape: '2' },
    ]);
  },

  // Boxes decide: a freed sldId whose boxes are all new is a new slide, the old one deleted.
  'freed-id-new-boxes': (e) => {
    expect(slide(e.next, 'team').sldId).toBe(slide(e.prev, 'budget').sldId);
    expectChanges(e, { team: 'new', budget: 'deleted' }, { matchedBy: 'sldId' });
    expect(e.movedBoxes).toBeUndefined();
  },
  'box-moved-to-other-slide': (e) => {
    expectChanges(e, { agenda: 'modified', ziele: 'modified' }, { matchedBy: 'sldId' });
    expect(e.movedBoxes).toEqual([
      { prev: 'agenda', shape: expect.any(String), next: 'ziele', nextShape: expect.any(String) },
    ]);
  },
  'one-box-survives': (e) => {
    // Title box kept, everything else new: still the same slide (its comments stay).
    expectChanges(e, { ziele: 'modified' }, { matchedBy: 'sldId' });
    expect(e.movedBoxes).toBeUndefined();
  },
};

// ── Invariants for every case ───────────────────────────────────────────────

function expectInvariants(e: Expected, labels: { v1: string[]; v2: string[] }): void {
  expect(e.matches.filter((m) => m.next).map((m) => m.next)).toEqual(labels.v2);
  expect(
    e.matches
      .filter((m) => m.prev)
      .map((m) => m.prev)
      .sort(),
  ).toEqual([...labels.v1].sort());
  const firstDeleted = e.matches.findIndex((m) => m.status === 'deleted');
  if (firstDeleted >= 0) {
    expect(e.matches.slice(firstDeleted).every((m) => m.status === 'deleted')).toBe(true);
  }
  for (const m of e.matches) {
    expect(m.confidence).toBeGreaterThanOrEqual(0);
    expect(m.confidence).toBeLessThanOrEqual(1);
    // A pair always joins the same slide: in this corpus a label never changes its meaning.
    if (m.prev && m.next) expect(m.next, `${m.prev} matched to ${m.next}`).toBe(m.prev);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BER-106 corpus', () => {
  it('has one intent per case and no stray folders', async () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(INTENTS).sort()).toEqual([...ids].sort());
    const folders = (await readdir(CORPUS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(folders).toEqual([...ids].sort());
  });

  describe.each(CASES)('$id', (c) => {
    const dir = join(CORPUS_DIR, c.id);

    it('committed decks are byte-identical to a fresh build (`bun run corpus`)', async () => {
      if (UPDATE) await writeCase(CORPUS_DIR, c);
      const fresh = await buildCase(c);
      const [v1, v2] = await Promise.all([
        readFile(join(dir, 'v1.pptx')),
        readFile(join(dir, 'v2.pptx')),
      ]);
      expect(Buffer.from(fresh.v1).equals(v1), 'v1.pptx').toBe(true);
      expect(Buffer.from(fresh.v2).equals(v2), 'v2.pptx').toBe(true);
    });

    it('matching the committed decks gives expected.json', async () => {
      const [v1, v2] = await Promise.all([
        readFile(join(dir, 'v1.pptx')),
        readFile(join(dir, 'v2.pptx')),
      ]);
      const actual = await runCase(metaOf(c), v1, v2);
      if (UPDATE) await writeFile(join(dir, 'expected.json'), await formatExpected(actual));
      expect(actual).toEqual(await readExpected(dir));
    });

    it('does what the case is about', async () => {
      const expected = await readExpected(dir);
      expectInvariants(expected, metaOf(c).labels ?? { v1: [], v2: [] });
      const intent = INTENTS[c.id];
      if (!intent) throw new Error(`No intent for ${c.id}`);
      intent(expected);
    });
  });
});

// Real exports (Google Slides, PowerPoint Win/Mac/Online) dropped into real/<name>/.
const realCases = existsSync(REAL_DIR)
  ? (await readdir(REAL_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(REAL_DIR, name, 'v1.pptx')))
      .sort()
  : [];

describe.runIf(realCases.length > 0)('BER-106 corpus: real files', () => {
  it.each(realCases)('%s matches expected.json', async (name) => {
    const dir = join(REAL_DIR, name);
    const [v1, v2] = await Promise.all([
      readFile(join(dir, 'v1.pptx')),
      readFile(join(dir, 'v2.pptx')),
    ]);
    const actual = await runCase({ id: name, tags: ['real'], synthetic: false }, v1, v2);
    if (UPDATE) await writeFile(join(dir, 'expected.json'), await formatExpected(actual));
    else if (!existsSync(join(dir, 'expected.json'))) {
      throw new Error(`real/${name}/expected.json missing: review the file, then UPDATE_CORPUS=1`);
    }
    expect(actual).toEqual(await readExpected(dir));
  });
});
