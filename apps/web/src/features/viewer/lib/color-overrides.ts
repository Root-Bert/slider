import { ACCENT_COLORS, type AccentColor, type Author } from '@slider/shared';
import { useSyncExternalStore } from 'react';

/**
 * Colours the viewer picked for *other* people (click their avatar). Only this browser sees
 * them – everyone keeps their own colour for themselves and for the others.
 */
type Overrides = Readonly<Record<string, AccentColor>>;

const STORAGE_KEY = 'slider.colorOverrides.v1';
const EMPTY: Overrides = {};

const listeners = new Set<() => void>();
let state: Overrides | null = null;

function load(): Overrides {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return EMPTY;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, AccentColor] =>
        (ACCENT_COLORS as readonly unknown[]).includes(entry[1]),
      ),
    );
  } catch {
    return EMPTY;
  }
}

function read(): Overrides {
  state ??= load();
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `null` drops the override – the person shows in their own colour again. */
export function setColorOverride(authorId: string, color: AccentColor | null) {
  const { [authorId]: _, ...rest } = read();
  state = color ? { ...rest, [authorId]: color } : rest;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota) – keep the state in memory only.
  }
  for (const listener of listeners) listener();
}

export function useColorOverrides(): Overrides {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** `author` in the colour the viewer picked for them, if any. PowerPoint authors stay orange. */
export function withColorOverride<T extends Author>(author: T, overrides: Overrides): T {
  if (author.type === 'external') return author;
  const color = overrides[author.id];
  return color && color !== author.color ? { ...author, color } : author;
}
