import { createStoredStore } from './storage';

/**
 * Remembers when the viewer last showed each deck, for the sort "Zuletzt geöffnet" in "Reviews".
 * Purely client-side. The hook is `useLastVisits` (reviews feature).
 */
export interface VisitState {
  opened?: Readonly<Record<string, number>>;
}

// Older entries also carry `baseline` and `decks` (the dropped "Neu" badge); they're ignored.
const STORAGE_KEY = 'slider.lastVisits.v1';

function isVisitState(value: unknown): value is VisitState {
  if (typeof value !== 'object' || value === null) return false;
  const { opened } = value as VisitState;
  return opened === undefined || (typeof opened === 'object' && opened !== null);
}

/** The single store behind `useLastVisits`; several open tabs stay in sync. */
export const lastVisitsStore = createStoredStore<VisitState>({
  key: STORAGE_KEY,
  parse: (value) => (isVisitState(value) ? { opened: value.opened } : {}),
  fallback: {},
  crossTab: true,
});

/** Feeds the sort "Zuletzt geöffnet"; called by the viewer once the deck has loaded. */
export function markDeckOpened(deckId: string, at: number = Date.now()) {
  const current = lastVisitsStore.getSnapshot();
  lastVisitsStore.set({ ...current, opened: { ...current.opened, [deckId]: at } });
}
