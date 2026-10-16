import { useState } from 'react';
import { readString, writeString } from '@/lib/storage';

const isOneOf = <T extends string>(options: readonly T[], value: string | null): value is T =>
  value !== null && (options as readonly string[]).includes(value);

/**
 * A string-union preference persisted in localStorage (sort order, grid/list view).
 * Unknown stored values fall back to the default; storage errors (private mode) are ignored.
 */
export function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = readString(key);
    return isOneOf(options, stored) ? stored : fallback;
  });

  const update = (next: T) => {
    setValue(next);
    // Not persisted (private mode) – the choice still applies for this session.
    writeString(key, next);
  };

  return [value, update] as const;
}
