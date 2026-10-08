import type { Deck } from '@slider/shared';

export const REVIEW_TABS = ['all', 'open', 'archive'] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export const DECK_SORTS = ['updated', 'name', 'comments'] as const;
export type DeckSort = (typeof DECK_SORTS)[number];

export const SORT_LABELS: Record<DeckSort, string> = {
  updated: 'Zuletzt aktualisiert',
  name: 'Name',
  comments: 'Offene Kommentare',
};

const isArchived = (deck: Deck) => deck.archivedAt !== null;

const TAB_PREDICATES: Record<ReviewTab, (deck: Deck) => boolean> = {
  all: (deck) => !isArchived(deck),
  open: (deck) => !isArchived(deck) && deck.openCommentCount > 0,
  archive: isArchived,
};

const byUpdated = (a: Deck, b: Deck) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
const titleCollator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const COMPARATORS: Record<DeckSort, (a: Deck, b: Deck) => number> = {
  updated: byUpdated,
  name: (a, b) => titleCollator.compare(a.title, b.title),
  comments: (a, b) => b.openCommentCount - a.openCommentCount || byUpdated(a, b),
};

export function countByTab(decks: readonly Deck[]): Record<ReviewTab, number> {
  return {
    all: decks.filter(TAB_PREDICATES.all).length,
    open: decks.filter(TAB_PREDICATES.open).length,
    archive: decks.filter(TAB_PREDICATES.archive).length,
  };
}

const normalize = (text: string) =>
  text.toLocaleLowerCase('de').normalize('NFKD').replace(/\p{M}/gu, '');

export function selectDecks(
  decks: readonly Deck[],
  { tab, query, sort }: { tab: ReviewTab; query: string; sort: DeckSort },
): Deck[] {
  const needle = normalize(query.trim());
  return decks
    .filter(TAB_PREDICATES[tab])
    .filter((deck) => needle === '' || normalize(deck.title).includes(needle))
    .sort(COMPARATORS[sort]);
}

/** Totals for the page subline ("6 Reviews · 30 offene Kommentare"), excluding the archive. */
export function activeTotals(decks: readonly Deck[]) {
  const active = decks.filter(TAB_PREDICATES.all);
  return {
    reviews: active.length,
    openComments: active.reduce((sum, deck) => sum + deck.openCommentCount, 0),
  };
}

/** "Mit mir geteilt": the decks someone else added to one of my organisations. */
export const sharedWith = (decks: readonly Deck[], userId: string): Deck[] =>
  decks.filter((deck) => deck.owner.id !== userId);
