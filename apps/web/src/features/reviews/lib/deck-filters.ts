import { searchFold, type Deck } from '@slider/shared';

export const REVIEW_TABS = ['all', 'open', 'archive'] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export const DECK_SORTS = ['opened', 'updated', 'name', 'comments'] as const;
export type DeckSort = (typeof DECK_SORTS)[number];

export const SORT_LABELS: Record<DeckSort, string> = {
  opened: 'Zuletzt geöffnet',
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

/** When the user last opened a deck in the viewer (see `last-visits`), `undefined` if never. */
export type OpenedAt = (deckId: string) => number | undefined;

/** Recently opened first; decks never opened follow, by last update. */
const byOpened = (openedAt: OpenedAt) => (a: Deck, b: Deck) =>
  (openedAt(b.id) ?? -Infinity) - (openedAt(a.id) ?? -Infinity) || byUpdated(a, b);

const comparators = (openedAt: OpenedAt): Record<DeckSort, (a: Deck, b: Deck) => number> => ({
  opened: byOpened(openedAt),
  updated: byUpdated,
  name: (a, b) => titleCollator.compare(a.title, b.title),
  comments: (a, b) => b.openCommentCount - a.openCommentCount || byUpdated(a, b),
});

const neverOpened: OpenedAt = () => undefined;
const nonePinned = () => false;

/**
 * Which folder is shown: `null` = the top level (decks outside any folder), a folder id = that
 * folder, `'*'` = every deck wherever it is (a search from the top level).
 */
export type FolderScope = string | null | '*';

export const inFolder = (deck: Deck, scope: FolderScope) =>
  scope === '*' || (deck.folderId ?? null) === scope;

/**
 * The scope a tab really looks at. Archiving keeps a deck's folder, but the folder tiles only
 * count active decks – so the top-level "Archiv" collects the archived decks of every folder,
 * or a deck archived inside a folder would seem gone.
 */
export const tabScope = (tab: ReviewTab, folder: FolderScope): FolderScope =>
  tab === 'archive' && folder === null ? '*' : folder;

/** Tab badges for the decks in `folder` (default: all), with the top-level archive as above. */
export function countByTab(
  decks: readonly Deck[],
  folder: FolderScope = '*',
): Record<ReviewTab, number> {
  const count = (tab: ReviewTab) =>
    decks.filter((deck) => inFolder(deck, tabScope(tab, folder)) && TAB_PREDICATES[tab](deck))
      .length;
  return { all: count('all'), open: count('open'), archive: count('archive') };
}

export function selectDecks(
  decks: readonly Deck[],
  {
    tab,
    query,
    sort,
    folder = '*',
    openedAt = neverOpened,
    isPinned = nonePinned,
    contentMatches,
  }: {
    tab: ReviewTab;
    folder?: FolderScope;
    query: string;
    sort: DeckSort;
    openedAt?: OpenedAt;
    /** Pinned decks come first under every sort, sorted among themselves. */
    isPinned?: (deckId: string) => boolean;
    /** Decks whose slides or comments contain the query (BER-175): they match like a title. */
    contentMatches?: ReadonlySet<string>;
  },
): Deck[] {
  const needle = searchFold(query.trim());
  const bySort = comparators(openedAt)[sort];
  return decks
    .filter((deck) => inFolder(deck, tabScope(tab, folder)))
    .filter(TAB_PREDICATES[tab])
    .filter(
      (deck) =>
        needle === '' ||
        searchFold(deck.title).includes(needle) ||
        contentMatches?.has(deck.id) === true,
    )
    .sort((a, b) => Number(isPinned(b.id)) - Number(isPinned(a.id)) || bySort(a, b));
}

/** Decks per folder id, for the folder tiles – archived ones don't count. */
export function countByFolder(decks: readonly Deck[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const deck of decks) {
    if (!deck.folderId || !TAB_PREDICATES.all(deck)) continue;
    counts.set(deck.folderId, (counts.get(deck.folderId) ?? 0) + 1);
  }
  return counts;
}

/** Totals for the page subline ("6 Reviews | 30 offene Kommentare"), excluding the archive. */
export function activeTotals(decks: readonly Deck[]) {
  const active = decks.filter(TAB_PREDICATES.all);
  return {
    reviews: active.length,
    openComments: active.reduce((sum, deck) => sum + deck.openCommentCount, 0),
  };
}

/**
 * "Der Ordner ist leer" only for an open folder without any deck – a folder whose decks just
 * don't match the tab ("Offen", "Archiv") gets the tab's own empty state instead.
 */
export function isEmptyFolder({
  folderOpen,
  query,
  decksInFolder,
}: {
  folderOpen: boolean;
  query: string;
  decksInFolder: number;
}): boolean {
  return folderOpen && query.trim() === '' && decksInFolder === 0;
}

/**
 * Nothing matches at the top level, but the folder tiles above are the whole answer: on "Alle",
 * every deck simply sits in a folder. Other tabs still say why nothing shows (no open comments,
 * nothing archived), because the folder tiles do not filter by tab.
 */
export function onlyFolderTiles({
  tab,
  atTop,
  folderCount,
  deckCount,
}: {
  tab: ReviewTab;
  atTop: boolean;
  folderCount: number;
  deckCount: number;
}): boolean {
  return tab === 'all' && atTop && folderCount > 0 && deckCount > 0;
}
