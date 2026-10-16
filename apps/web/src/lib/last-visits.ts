import { useSyncExternalStore } from 'react';

/**
 * Remembers when the viewer last showed each deck, for the sort "Zuletzt geöffnet" in "Reviews".
 * Purely client-side.
 */
interface VisitState {
  opened?: Readonly<Record<string, number>>;
}

// Older entries also carry `baseline` and `decks` (the dropped "Neu" badge); they're ignored.
const STORAGE_KEY = 'slider.lastVisits.v1';

const listeners = new Set<() => void>();
let state: VisitState | null = null;

function isVisitState(value: unknown): value is VisitState {
  if (typeof value !== 'object' || value === null) return false;
  const { opened } = value as VisitState;
  return opened === undefined || (typeof opened === 'object' && opened !== null);
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
    if (isVisitState(parsed)) return { opened: parsed.opened };
  } catch {
    // Corrupt or inaccessible storage – start over.
  }
  return {};
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

/** Feeds the sort "Zuletzt geöffnet"; called by the viewer once the deck has loaded. */
export function markDeckOpened(deckId: string, at: number = Date.now()) {
  const current = getSnapshot();
  setState({ ...current, opened: { ...current.opened, [deckId]: at } });
}

export function useLastVisits() {
  const visits = useSyncExternalStore(subscribe, getSnapshot);
  return {
    openedAt: (deckId: string): number | undefined => visits.opened?.[deckId],
  };
}
