import type { FillLayer } from '@slider/shared';
import { useSyncExternalStore } from 'react';

/*
 * A slide's background as it is being changed, before the editor's model has it: a gradient's
 * handle dragged, a colour picked – the per-element editor (`SlideCompositor`) draws these layers
 * in the same frame, beneath the master's shapes, until the model has the change (or another one
 * past it).
 */
export interface BackgroundPreview {
  /** The same while changes follow each other; a new one after the last settled. */
  key: number;
  fills: readonly FillLayer[];
  /** The slide's own background when the changes began: the model past it, this one is done. */
  before: readonly FillLayer[];
  /** The server has the last change. */
  settled: boolean;
}

const previews = new Map<string, BackgroundPreview>();
const listeners = new Set<() => void>();
let nextKey = 1;

const changed = () => {
  for (const listener of listeners) listener();
};

export const backgroundPreviews = {
  get: (slideId: string): BackgroundPreview | null => previews.get(slideId) ?? null,
  /** Shows `fills` as the slide's background (it had `before`) until the model has it. */
  show(slideId: string, fills: readonly FillLayer[], before: readonly FillLayer[]): number {
    const current = previews.get(slideId);
    const key = current && !current.settled ? current.key : nextKey++;
    previews.set(slideId, {
      key,
      fills,
      before: current && !current.settled ? current.before : before,
      settled: false,
    });
    changed();
    return key;
  },
  settle(slideId: string, key: number) {
    const current = previews.get(slideId);
    if (current?.key !== key || current.settled) return;
    previews.set(slideId, { ...current, settled: true });
    changed();
  },
  /** Takes it away – the model has it, or it cannot be shown so. */
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

export function useBackgroundPreview(slideId: string): BackgroundPreview | null {
  return useSyncExternalStore(
    backgroundPreviews.subscribe,
    () => backgroundPreviews.get(slideId),
    () => backgroundPreviews.get(slideId),
  );
}
