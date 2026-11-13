import { useSyncExternalStore } from 'react';

/** Kept in this browser: a word one said is right stays right on every deck. */
const STORAGE_KEY = 'slider.spelling.accepted';

function read(): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((w) => typeof w === 'string') : []);
  } catch {
    return new Set();
  }
}

let accepted: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

const current = () => (accepted ??= read());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** „Passt so“ on a misspelt word (right click on it): no longer marked, anywhere. */
export function acceptWord(word: string): void {
  accepted = new Set([...current(), word]);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...accepted]));
  } catch {
    // Not stored (private window): right for as long as the page is open.
  }
  for (const listener of listeners) listener();
}

/** The words one said are right (`acceptWord`), the same object until one more is. */
export function useAcceptedWords(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, current);
}
