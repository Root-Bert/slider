import { searchFold, type Deck } from '@slider/shared';

export const REVIEW_TABS = ['all', 'open', 'archive', 'trash'] as const;
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
  // The trash has a list of its own (`TrashedDecks`).
  trash: () => false,
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

/** The order a sort puts presentations in – the trash sorts by it too. */
export const deckOrder = (sort: DeckSort, openedAt: OpenedAt) => comparators(openedAt)[sort];

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
): Record<Exclude<ReviewTab, 'trash'>, number> {
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
