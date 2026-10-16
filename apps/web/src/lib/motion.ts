import { useSyncExternalStore } from 'react';

/*
 * Motion that JavaScript times itself (timeouts that wait for an animation, scroll tweens, …).
 * CSS animations are cut short by the reduced-motion rule in `styles/index.css`; JS timings have
 * to ask here. Durations follow Tailwind's scale (150 · 200 · 300 · 500 ms), easings are the
 * `--ease-*` tokens.
 */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const reducedMotionList = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION)
    : null;

/** Whether the user asked for reduced motion right now (`false` without a DOM). */
export const prefersReducedMotion = (): boolean => reducedMotionList()?.matches ?? false;

/** `ms`, or 0 under reduced motion – for timers that wait for an animation to finish. */
export const motionMs = (ms: number): number => (prefersReducedMotion() ? 0 : ms);

const subscribe = (onChange: () => void) => {
  const list = reducedMotionList();
  if (!list) return () => {};
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
};

/** Reactive {@link prefersReducedMotion}: re-renders when the system setting changes. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
