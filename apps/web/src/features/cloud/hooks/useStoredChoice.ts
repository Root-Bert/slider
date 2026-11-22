import { useState } from 'react';
import { readString, writeString } from '@/lib/storage';

/** A choice among a few (sort order, rows or tiles), remembered in this browser. */
export function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = readString(key);
    return (options as readonly string[]).includes(stored ?? '') ? (stored as T) : fallback;
  });
  const update = (next: T) => {
    setValue(next);
    writeString(key, next);
  };
  return [value, update] as const;
}
