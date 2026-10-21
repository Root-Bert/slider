/**
 * Per-browser storage (`localStorage`, or `sessionStorage` for this tab). Every access is
 * guarded: storage can be missing or throw (private mode, quota, blocked site data) – reads then
 * fall back, writes are simply not remembered. Keys are the callers' and never change here.
 */

export type StorageArea = 'local' | 'session';

const area = (kind: StorageArea): Storage => (kind === 'session' ? sessionStorage : localStorage);

/** The stored string, or `null` when there is none or storage is unavailable. */
export function readString(key: string, kind: StorageArea = 'local'): string | null {
  try {
    return area(kind).getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value`; `null` removes the key. Never throws. */
export function writeString(key: string, value: string | null, kind: StorageArea = 'local'): void {
  try {
    if (value === null) area(kind).removeItem(key);
    else area(kind).setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota) – not remembered.
  }
}

/**
 * The stored JSON, checked by `parse` (which gets the parsed `unknown` and returns a valid
 * value). Missing, corrupt or unreadable storage – or `parse` throwing – gives `fallback`.
 */
export function readJson<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

/** Stores `value` as JSON. Never throws. */
export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota) – the value lives in memory only.
  }
}

/** A value kept in `localStorage` and read through `useSyncExternalStore`. */
export interface StoredStore<T> {
  /** The current value; loaded from storage on first use. For `useSyncExternalStore`. */
  getSnapshot: () => T;
  /** For `useSyncExternalStore`; with `crossTab`, also follows other tabs' writes. */
  subscribe: (listener: () => void) => () => void;
  /** Replaces the value, persists it (best effort) and notifies subscribers. */
  set: (next: T) => void;
}

export interface StoredStoreOptions<T> {
  key: string;
  /** Validates the parsed JSON (see {@link readJson}). */
  parse: (value: unknown) => T;
  /** The value without (usable) storage. */
  fallback: T;
  /** Re-read when another tab writes the key (`storage` event). */
  crossTab?: boolean;
}

/**
 * One module-level store per key: a single in-memory value shared by every hook, persisted as
 * JSON. Storage failures keep the value in memory for this page.
 */
export function createStoredStore<T>({
  key,
  parse,
  fallback,
  crossTab = false,
}: StoredStoreOptions<T>): StoredStore<T> {
  const listeners = new Set<() => void>();
  let state: T | undefined;
  let loaded = false;

  const load = () => readJson(key, parse, fallback);

  const getSnapshot = (): T => {
    if (!loaded) {
      state = load();
      loaded = true;
    }
    return state as T;
  };

  const set = (next: T) => {
    state = next;
    loaded = true;
    writeJson(key, next);
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (!crossTab) return () => void listeners.delete(listener);
    // Keep several open tabs in sync.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      state = load();
      loaded = true;
      listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  };

  return { getSnapshot, subscribe, set };
}
