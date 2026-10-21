import { useEffect, useState } from 'react';
import { motionMs } from '@/lib/motion';
import { INTRO_MS } from '../lib/import-skeleton';

/** True until the intro, starting once `started`, has played – placeholders mounted until then are dealt in one after another. */
export function useIntro(started: boolean) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => setDone(true), INTRO_MS);
    return () => clearTimeout(timer);
  }, [started]);
  return !done;
}

/** The highest index `last` has reached, up to `max` (the track's last slot). */
export function useReach(last: number, max: number) {
  const [reach, setReach] = useState(-1);
  const next = Math.min(Math.max(reach, last), max);
  if (next !== reach) setReach(next);
  return next;
}

/** How long slots past a shrunken count stay to fly off the track. */
const LEAVING_MS = 700;

/** Slots past a shrunken count stay a moment to fly off the track. */
export function useLeaving(n: number) {
  const [shown, setShown] = useState(n);
  const [leaving, setLeaving] = useState<{ to: number } | null>(null);
  if (n !== shown) {
    setShown(n);
    setLeaving(n < shown ? { to: shown } : null);
  }
  useEffect(() => {
    if (!leaving) return;
    // Waits for the slots' `import-leave` (520 ms + stagger); nothing to wait for without motion.
    const timer = setTimeout(() => setLeaving(null), motionMs(LEAVING_MS));
    return () => clearTimeout(timer);
  }, [leaving]);
  return leaving;
}
