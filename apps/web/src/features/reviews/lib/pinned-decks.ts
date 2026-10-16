import { createStoredStore } from '@/lib/storage';

/**
 * Decks pinned to the top of "Reviews", whatever the sort. Like the last visits kept per
 * browser in localStorage, but per account and workspace: each workspace's page has its own
 * {@link MAX_PINNED} slots, and a second account on the same browser keeps its own pins. In the
 * order they were pinned. The hook is `usePinnedDecks`.
 */
export const MAX_PINNED = 3;

/** Whose pins, on which workspace's page. */
export interface PinScope {
  userId: string;
  workspaceId: string;
}

/** `v1` was one list for the whole browser; it is not carried over. */
const STORAGE_KEY = 'slider.reviews.pinned.v2';
const NONE: readonly string[] = [];
type Pins = Readonly<Record<string, readonly string[]>>;
const EMPTY: Pins = {};

const scopeKey = ({ userId, workspaceId }: PinScope) => `${userId}/${workspaceId}`;

const parseIds = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string').slice(0, MAX_PINNED)
    : NONE;

/** The single store behind `usePinnedDecks`; several open tabs stay in sync. */
export const pinnedDecksStore = createStoredStore<Pins>({
  key: STORAGE_KEY,
  parse: (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .map(([key, ids]) => [key, parseIds(ids)] as const)
            .filter(([, ids]) => ids.length > 0),
        )
      : EMPTY,
  fallback: EMPTY,
  crossTab: true,
});

/** The pinned deck ids of one scope, from a store snapshot. */
export const pinnedIn = (pins: Pins, scope: PinScope): readonly string[] =>
  pins[scopeKey(scope)] ?? NONE;

function setPins(scope: PinScope, ids: readonly string[]) {
  const { [scopeKey(scope)]: _old, ...rest } = pinnedDecksStore.getSnapshot();
  pinnedDecksStore.set(ids.length > 0 ? { ...rest, [scopeKey(scope)]: ids } : rest);
}

/** Pins the deck; returns false when {@link MAX_PINNED} decks are pinned already. */
export function pinDeck(scope: PinScope, deckId: string): boolean {
  const current = pinnedIn(pinnedDecksStore.getSnapshot(), scope);
  if (current.includes(deckId)) return true;
  if (current.length >= MAX_PINNED) return false;
  setPins(scope, [...current, deckId]);
  return true;
}

export function unpinDeck(scope: PinScope, deckId: string) {
  const current = pinnedIn(pinnedDecksStore.getSnapshot(), scope);
  if (current.includes(deckId))
    setPins(
      scope,
      current.filter((id) => id !== deckId),
    );
}

/**
 * Drops this scope's pins of decks that no longer exist (or left the workspace), so they don't
 * block a slot. Other accounts' and workspaces' pins stay.
 */
export function prunePinnedDecks(scope: PinScope, existing: ReadonlySet<string>) {
  const current = pinnedIn(pinnedDecksStore.getSnapshot(), scope);
  const kept = current.filter((id) => existing.has(id));
  if (kept.length !== current.length) setPins(scope, kept);
}
