import type { Rect } from '@slider/shared';
import { useSyncExternalStore } from 'react';

/**
 * Stock photos shown in their frame before the slide has them (BER-183): a click on another of
 * the AI's photos – or on one found in the editor – puts Unsplash's picture of it, cut to the
 * frame, over the slide at once; the server writes the file meanwhile. Once the slide's new
 * picture has loaded, it is the slide's own again (`PhotoPreviewLayer`).
 */
export interface PhotoPreview {
  /** The same while clicks follow each other; a new one after it settled. */
  key: number;
  /** Where on the slide (0–1). */
  rect: Rect;
  url: string;
  /** The server has the last choice, and the slide's pictures are reloaded. */
  settled: boolean;
}

const previews = new Map<string, PhotoPreview>();
const listeners = new Set<() => void>();
let nextKey = 1;

const changed = () => {
  for (const listener of listeners) listener();
};

export const photoPreviews = {
  get: (slideId: string): PhotoPreview | null => previews.get(slideId) ?? null,
  /** Shows `url` in `rect` of the slide until {@link settle} and the slide's new picture. */
  show(slideId: string, rect: Rect, url: string): number {
    const current = previews.get(slideId);
    const key = current && !current.settled ? current.key : nextKey++;
    previews.set(slideId, { key, rect, url, settled: false });
    changed();
    return key;
  },
  settle(slideId: string, key: number) {
    const current = previews.get(slideId);
    if (current?.key !== key || current.settled) return;
    previews.set(slideId, { ...current, settled: true });
    changed();
  },
  /** Takes it away – the slide's picture is there, or the change failed. */
  clear(slideId: string, key?: number) {
    if (key !== undefined && previews.get(slideId)?.key !== key) return;
    if (previews.delete(slideId)) changed();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function usePhotoPreview(slideId: string): PhotoPreview | null {
  return useSyncExternalStore(
    photoPreviews.subscribe,
    () => photoPreviews.get(slideId),
    () => photoPreviews.get(slideId),
  );
}
