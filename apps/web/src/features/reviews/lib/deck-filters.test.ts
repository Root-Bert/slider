import { describe, expect, it } from 'vitest';
import {
  activeTotals,
  countByFolder,
  countByTab,
  onlyFolderTiles,
  selectDecks,
} from './deck-filters';
import { makeDeck } from './deck-fixture';

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

  it('puts pinned decks first under every sort, sorted among themselves', () => {
    const isPinned = (id: string) => id === 'a' || id === 'c';
    expect(ids(selectDecks(decks, { tab: 'all', query: '', sort: 'updated', isPinned }))).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(ids(selectDecks(decks, { tab: 'all', query: '', sort: 'name', isPinned }))).toEqual([
      'c',
      'a',
      'b',
    ]);
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
    expect(countByTab(decks)).toEqual({ all: 3, open: 2, archive: 1 });
    expect(activeTotals(decks)).toEqual({ reviews: 3, openComments: 10 });
  });
});

describe('folders', () => {
  const filed = [
    makeDeck({ id: 'top', title: 'Top' }),
    makeDeck({ id: 'in', title: 'Drin', folderId: 'f1' }),
    makeDeck({ id: 'old', title: 'Alt', folderId: 'f1', archivedAt: '2026-09-01T00:00:00Z' }),
  ];
  const opts = { tab: 'all', query: '', sort: 'name' } as const;

  it('shows the top level, one folder, or everything', () => {
    expect(ids(selectDecks(filed, { ...opts, folder: null }))).toEqual(['top']);
    expect(ids(selectDecks(filed, { ...opts, folder: 'f1' }))).toEqual(['in']);
    expect(ids(selectDecks(filed, { ...opts, folder: '*' }))).toEqual(['in', 'top']);
  });

  it('counts active decks per folder', () => {
    expect(countByFolder(filed)).toEqual(new Map([['f1', 1]]));
  });
});

describe('onlyFolderTiles', () => {
  const top = { atTop: true, folderCount: 2, deckCount: 3 };

  it('on "Alle", folder tiles alone are enough when every deck sits in a folder', () => {
    expect(onlyFolderTiles({ tab: 'all', ...top })).toBe(true);
  });

  it('on "Offen" and "Archiv" the empty state still explains why nothing shows', () => {
    expect(onlyFolderTiles({ tab: 'open', ...top })).toBe(false);
    expect(onlyFolderTiles({ tab: 'archive', ...top })).toBe(false);
  });

  it('needs folders, decks and the top level', () => {
    expect(onlyFolderTiles({ tab: 'all', ...top, folderCount: 0 })).toBe(false);
    expect(onlyFolderTiles({ tab: 'all', ...top, deckCount: 0 })).toBe(false);
    expect(onlyFolderTiles({ tab: 'all', ...top, atTop: false })).toBe(false);
  });
});
