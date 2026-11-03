import { useSyncExternalStore } from 'react';
import type { SlideTransition } from '@slider/shared';
import { useEditing } from '../editing-context';

/**
 * Transitions just picked, by slide id, until the server has them: the gap's button, the picker
 * and a slide show use them at once – no waiting on the edit's round trip.
 */
let picked: ReadonlyMap<string, SlideTransition> = new Map();
const listeners = new Set<() => void>();

const publish = (next: ReadonlyMap<string, SlideTransition>) => {
  picked = next;
  for (const listener of listeners) listener();
};

/** Shows `transition` for the slide while `done` is on its way; it settles back to the server's. */
export function showPickedTransition(
  slideId: string,
  transition: SlideTransition,
  done: Promise<unknown>,
): void {
  publish(new Map(picked).set(slideId, transition));
  const settle = () => {
    // A newer pick for the slide stays.
    if (picked.get(slideId) !== transition) return;
    const next = new Map(picked);
    next.delete(slideId);
    publish(next);
  };
  void done.then(settle, settle);
}

/** The transition just picked for the slide, while its edit is on its way. */
export const pickedTransition = (slideId: string): SlideTransition | undefined =>
  picked.get(slideId);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * The transition each slide comes in with – one just picked before the server's answer. `null`:
 * one from the file Slider does not offer; `undefined`: not known (no edit state).
 */
export function useTransitionOf(): (slideId: string) => SlideTransition | null | undefined {
  const { state } = useEditing();
  const current = useSyncExternalStore(subscribe, () => picked);
  return (slideId) =>
    current.get(slideId) ?? state?.slides.find((slide) => slide.slideId === slideId)?.transition;
}
