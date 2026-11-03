import { useSyncExternalStore } from 'react';

/*
 * The slides shown composed right now (`SlideCompositor`). Bearbeiten works on a slide only once
 * it is composed – its handles, picking and typing wait till then (the first time a few tenths of
 * a second): before, the slide is LibreOffice's picture alone and nothing is drawn over it.
 */
const composed = new Set<string>();
const listeners = new Set<() => void>();

export function markComposed(slideId: string, on: boolean): void {
  if (composed.has(slideId) === on) return;
  if (on) composed.add(slideId);
  else composed.delete(slideId);
  for (const listener of listeners) listener();
}

export const isComposed = (slideId: string): boolean => composed.has(slideId);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Whether `slideId` is shown composed – re-rendered when that changes. */
export const useComposed = (slideId: string): boolean =>
  useSyncExternalStore(subscribe, () => composed.has(slideId));
