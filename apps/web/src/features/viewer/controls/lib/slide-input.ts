/**
 * Slide number typed into the counter → 1-based position within 1..total, or null when the
 * input is not a number (the field then reverts). Out-of-range numbers clamp to the deck.
 */
export function parseSlideInput(raw: string, total: number): number | null {
  const text = raw.trim();
  if (!/^[+-]?\d+([.,]\d*)?$/.test(text) || total < 1) return null;
  return clampSlide(Math.round(Number(text.replace(',', '.'))), total);
}

/** Position `delta` slides away from `current`, kept within 1..total. */
export function stepSlide(current: number, delta: number, total: number): number {
  return clampSlide(current + delta, total);
}

function clampSlide(position: number, total: number): number {
  return Math.max(1, Math.min(Math.max(1, total), position));
}
