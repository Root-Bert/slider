import { useSyncExternalStore } from 'react';
import type { Deck } from '@slider/shared';

/**
 * Remembers when the user last opened each deck, so "Meine Reviews" can flag decks that
 * changed since (badge "Neu", notifications). Purely client-side until the API tracks
 * read state per user (BER-120 / BER-124).
 *
 * `baseline` is set on the very first visit, so a fresh browser doesn't mark every deck as new.
 */
interface VisitState {
  baseline: number;
  decks: Readonly<Record<string, number>>;
  /** When the viewer last showed each deck – unlike `decks`, not bumped by rename or "alle gelesen". */
  opened?: Readonly<Record<string, number>>;
}

const STORAGE_KEY = 'slider.lastVisits.v1';

const listeners = new Set<() => void>();
let state: VisitState | null = null;

function isVisitState(value: unknown): value is VisitState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<VisitState>;
  return (
    typeof candidate.baseline === 'number' &&
    typeof candidate.decks === 'object' &&
    candidate.decks !== null
  );
}

function persist(next: VisitState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) – keep the state in memory only.
  }
}

function load(): VisitState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (isVisitState(parsed)) return parsed;
  } catch {
    // Corrupt or inaccessible storage – start over.
  }
  const initial: VisitState = { baseline: Date.now(), decks: {} };
  persist(initial);
  return initial;
}

const getSnapshot = (): VisitState => (state ??= load());

function setState(next: VisitState) {
  state = next;
  persist(next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keep several open tabs in sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    state = load();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function markDecksVisited(deckIds: readonly string[], at: number = Date.now()) {
  if (deckIds.length === 0) return;
  const current = getSnapshot();
  const decks = { ...current.decks };
  for (const id of deckIds) decks[id] = at;
  setState({ ...current, decks });
}

export const markDeckVisited = (deckId: string) => markDecksVisited([deckId]);

/** Feeds the sort "Zuletzt geöffnet"; called by the viewer once the deck has loaded. */
export function markDeckOpened(deckId: string, at: number = Date.now()) {
  const current = getSnapshot();
  setState({ ...current, opened: { ...current.opened, [deckId]: at } });
}

const lastVisitOf = (visits: VisitState, deckId: string) => visits.decks[deckId] ?? visits.baseline;

/** True when the deck changed after the user last opened it. */
export const hasUnseenChanges = (
  visits: VisitState,
  deck: Pick<Deck, 'id' | 'updatedAt'>,
): boolean => Date.parse(deck.updatedAt) > lastVisitOf(visits, deck.id);

export function useLastVisits() {
  const visits = useSyncExternalStore(subscribe, getSnapshot);
  return {
    isUnseen: (deck: Pick<Deck, 'id' | 'updatedAt'>) => hasUnseenChanges(visits, deck),
    openedAt: (deckId: string): number | undefined => visits.opened?.[deckId],
  };
}
