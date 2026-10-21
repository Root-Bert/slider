import { createStoredStore, readString, writeString } from './storage';

/**
 * Remembers when the viewer last showed each deck, for the sort "Zuletzt geöffnet" in "Reviews".
 * Purely client-side, but per account: on a shared computer the next person's sort reflects only
 * their own visits. The hook is `useLastVisits` (reviews feature).
 */
export type OpenedAt = Readonly<Record<string, number>>;
/** By user id. */
export type Visits = Readonly<Record<string, OpenedAt>>;

const STORAGE_KEY = 'slider.lastVisits.v2';
/**
 * One list for the whole browser (`{ opened }`; older entries also carry `baseline` and `decks`
 * of the dropped "Neu" badge). The first account to use the sort takes it over, then it goes.
 */
const LEGACY_KEY = 'slider.lastVisits.v1';

const NONE: OpenedAt = {};
const EMPTY: Visits = {};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Keeps the entries with a usable time; anything else gives nothing. */
const parseOpened = (value: unknown): OpenedAt =>
  isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' && Number.isFinite(entry[1]),
        ),
      )
    : NONE;

/** The single store behind `useLastVisits`; several open tabs stay in sync. */
export const lastVisitsStore = createStoredStore<Visits>({
  key: STORAGE_KEY,
  parse: (value) =>
    isRecord(value)
      ? Object.fromEntries(
          Object.entries(value)
            .map(([userId, opened]) => [userId, parseOpened(opened)] as const)
            .filter(([, opened]) => Object.keys(opened).length > 0),
        )
      : EMPTY,
  fallback: EMPTY,
  crossTab: true,
});

/** When `userId` last opened each deck, from a store snapshot. */
export const openedIn = (visits: Visits, userId: string): OpenedAt => visits[userId] ?? NONE;

/**
 * Hands the browser-wide visits of before (`v1`) to `userId` and deletes them, so no other account
 * inherits them. Visits the account has already recorded win. Does nothing once they're gone.
 */
export function adoptLegacyVisits(userId: string) {
  const raw = readString(LEGACY_KEY);
  if (raw === null) return;
  writeString(LEGACY_KEY, null);
  let legacy = NONE;
  try {
    const value: unknown = JSON.parse(raw);
    legacy = parseOpened(isRecord(value) ? value.opened : null);
  } catch {
    // Corrupt: nothing to take over.
  }
  if (Object.keys(legacy).length === 0) return;
  const visits = lastVisitsStore.getSnapshot();
  lastVisitsStore.set({ ...visits, [userId]: { ...legacy, ...openedIn(visits, userId) } });
}

/** Feeds the sort "Zuletzt geöffnet"; called by the viewer once the deck has loaded. */
export function markDeckOpened(userId: string, deckId: string, at: number = Date.now()) {
  adoptLegacyVisits(userId);
  const visits = lastVisitsStore.getSnapshot();
  lastVisitsStore.set({ ...visits, [userId]: { ...openedIn(visits, userId), [deckId]: at } });
}
