import { useState } from 'react';

const isOneOf = <T extends string>(options: readonly T[], value: string | null): value is T =>
  value !== null && (options as readonly string[]).includes(value);

/**
 * A string-union preference persisted in localStorage (sort order, grid/list view).
 * Unknown stored values fall back to the default; storage errors (private mode) are ignored.
 */
export function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return isOneOf(options, stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });

  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Not persisted – the choice still applies for this session.
    }
  };

  return [value, update] as const;
}
