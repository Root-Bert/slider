import { describe, expect, it } from 'vitest';
import { activeTotals, countByTab, selectDecks, sharedWith } from './deck-filters';
import { makeDeck, owner } from './deck-fixture';

const decks = [
  makeDeck({
    id: 'a',
    title: 'Österreich Roadmap',
    openCommentCount: 3,
    updatedAt: '2026-10-03T00:00:00Z',
  }),
  makeDeck({
    id: 'b',
    title: 'Budget 2027',
    openCommentCount: 0,
    updatedAt: '2026-10-05T00:00:00Z',
  }),
  makeDeck({ id: 'c', title: 'Agenda', openCommentCount: 7, updatedAt: '2026-10-04T00:00:00Z' }),
  makeDeck({ id: 'z', title: 'Alt', openCommentCount: 9, archivedAt: '2026-09-01T00:00:00Z' }),
];

const ids = (list: readonly { id: string }[]) => list.map((deck) => deck.id);

describe('selectDecks', () => {
  it('excludes archived decks from "Alle" and sorts by last update', () => {
    expect(ids(selectDecks(decks, { tab: 'all', query: '', sort: 'updated' }))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('sorts by last opened, never-opened decks after by last update', () => {
    const opened: Record<string, number> = { a: 2, c: 1 };
    expect(
      ids(
        selectDecks(decks, { tab: 'all', query: '', sort: 'opened', openedAt: (id) => opened[id] }),
      ),
    ).toEqual(['a', 'c', 'b']);
  });

  it('"Offen" keeps decks with open comments only', () => {
    expect(ids(selectDecks(decks, { tab: 'open', query: '', sort: 'comments' }))).toEqual([
      'c',
      'a',
    ]);
  });

  it('"Archiv" shows archived decks only', () => {
    expect(ids(selectDecks(decks, { tab: 'archive', query: '', sort: 'updated' }))).toEqual(['z']);
  });

  it('sorts by name with German collation', () => {
    expect(ids(selectDecks(decks, { tab: 'all', query: '', sort: 'name' }))).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('searches titles case- and accent-insensitively', () => {
    expect(
      ids(selectDecks(decks, { tab: 'all', query: '  osterreich ', sort: 'updated' })),
    ).toEqual(['a']);
  });

  it('does not mutate its input', () => {
    const copy = [...decks];
    selectDecks(decks, { tab: 'all', query: '', sort: 'name' });
    expect(decks).toEqual(copy);
  });
});

describe('totals', () => {
  it('counts tabs and the non-archived open comments', () => {
    expect(countByTab(decks)).toEqual({ all: 3, open: 2, archive: 1, shared: 0 });
    expect(activeTotals(decks)).toEqual({ reviews: 3, openComments: 10 });
  });
});

describe('shared tab', () => {
  const colleague = { ...owner, id: 'u2', name: 'Kollegin' };
  const mixed = [
    makeDeck({ id: 'mine' }),
    makeDeck({ id: 'theirs', owner: colleague }),
    makeDeck({ id: 'old', owner: colleague, archivedAt: '2026-09-01T00:00:00Z' }),
  ];

  it('keeps only the decks someone else added', () => {
    expect(ids(sharedWith(mixed, owner.id))).toEqual(['theirs', 'old']);
  });

  it('lists and counts the non-archived shared decks', () => {
    const shared = sharedWith(mixed, owner.id);
    expect(ids(selectDecks(shared, { tab: 'shared', query: '', sort: 'updated' }))).toEqual([
      'theirs',
    ]);
    expect(countByTab(decks, shared).shared).toBe(1);
  });
});
