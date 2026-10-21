import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * 0 (folded) … 1 (open), eased over `ms` whenever `open` flips – one value per animation frame.
 * For folds that the layout has to follow in the same frame (the minimap: the slides grow with
 * the band), which a CSS transition, only reported back by a ResizeObserver a frame later, can't.
 * A flip mid-fold turns around from where it is. Instant under reduced motion.
 */
export function useFoldProgress(open: boolean, ms: number): number {
  const [progress, setProgress] = useState(open ? 1 : 0);
  const current = useRef(progress);

  useEffect(() => {
    const target = open ? 1 : 0;
    const from = current.current;
    if (from === target) return;
    const set = (value: number) => {
      current.current = value;
      setProgress(value);
    };
    if (prefersReducedMotion()) {
      set(target);
      return;
    }
    // A fold turned around halfway takes only the time for the rest of the way.
    const duration = ms * Math.abs(target - from);
    let start: number | null = null;
    let frame = requestAnimationFrame(function step(now) {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      set(from + (target - from) * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, ms]);

  return progress;
}
