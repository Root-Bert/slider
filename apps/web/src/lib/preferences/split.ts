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
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    const stored = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
    return Number.isFinite(stored) ? clampSplit(stored) : null;
  } catch {
    return null;
  }
}

export function storeSplit(split: number | null) {
  try {
    if (split === null) localStorage.removeItem(SPLIT_STORAGE_KEY);
    else localStorage.setItem(SPLIT_STORAGE_KEY, split.toFixed(4));
  } catch {
    // Not persisted – the split still applies for this session.
  }
}
