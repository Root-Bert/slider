/**
 * Which slide pictures are on screen (`SwapImage` tells): what an edit drew live over the slide
 * goes in the very frame its new picture shows – never a frame early (the old picture flashes up)
 * nor late. Keyed by the picture's URL.
 */
const shown = new Set<string>();
const waiting = new Map<string, Set<() => void>>();
/** Enough for every slide on screen and then some; the oldest go first. */
const KEEP = 200;

/** `src` is on screen now (called in the same task that swaps it in). */
export function pictureShown(src: string): void {
  shown.delete(src);
  shown.add(src);
  if (shown.size > KEEP) shown.delete(shown.values().next().value!);
  const callbacks = waiting.get(src);
  if (!callbacks) return;
  waiting.delete(src);
  for (const callback of callbacks) callback();
}

/** Calls `callback` once `src` is on screen – at once when it is; returns a cancel. */
export function whenPictureShown(src: string, callback: () => void): () => void {
  if (shown.has(src)) {
    callback();
    return () => undefined;
  }
  const callbacks = waiting.get(src) ?? new Set();
  callbacks.add(callback);
  waiting.set(src, callbacks);
  return () => void callbacks.delete(callback);
}
