import { readString, writeString } from '../storage';

/**
 * The viewer's split handle position as a per-browser preference: `t` ∈ [0, 1] between the
 * smallest and the largest slide height, or `null` for the default (see the viewer's
 * `timeline/lib/split`).
 */
export const SPLIT_MIN = 0;
export const SPLIT_MAX = 1;
export const SPLIT_STORAGE_KEY = 'slider.viewer.split.v1';

export const clampSplit = (split: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, split));

/** Persisted split of this browser; missing or unreadable means the default (`null`). */
export function loadStoredSplit(): number | null {
  const raw = readString(SPLIT_STORAGE_KEY);
  const stored = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(stored) ? clampSplit(stored) : null;
}

/** `null` forgets the split; when not persisted, it still applies for this session. */
export function storeSplit(split: number | null) {
  writeString(SPLIT_STORAGE_KEY, split === null ? null : split.toFixed(4));
}
