import { useRef, useState } from 'react';
import { intervalMs, stretchMs, type InstanceInterval } from '@slider/shared';
import { alignEnd, snapEnd } from '../lib/period';
import { useNow } from './useNow';

/** How often a window that follows the time moves on with it. */
const TICK_MS = 60_000;

/**
 * The chart's window: how wide (`interval`) and where it ends. Unmoved it follows the time,
 * ending at now rounded up to its next stretch; moved – dragged, scrolled, by keys – it stays,
 * on whole stretches, never past now nor before the history (`historyFrom`).
 */
export function useTimeWindow(historyFrom: number | undefined) {
  const [interval, setChosen] = useState<InstanceInterval>('31d');
  // Where a moved window ends; `null` follows the time.
  const [pinnedEnd, setPinnedEnd] = useState<number | null>(null);
  const now = useNow(TICK_MS);
  const liveEnd = alignEnd(now, interval);
  const end = pinnedEnd ?? liveEnd;
  const windowMs = intervalMs(interval);
  const stepMs = stretchMs(interval);
  // The strip begins with the history – or a window's width back from now, if that is earlier.
  const domainStart = Math.min(historyFrom ?? liveEnd, liveEnd - windowMs);
  const minEnd = domainStart + windowMs;

  const moveTo = (wanted: number) => setPinnedEnd(snapEnd(wanted, liveEnd, stepMs, minEnd));

  // Sideways scrolling comes in small amounts: the window moves once a whole stretch came.
  const panned = useRef(0);
  const pan = (ms: number) => {
    panned.current += ms;
    const steps = Math.trunc(panned.current / stepMs);
    if (steps === 0) return;
    panned.current -= steps * stepMs;
    setPinnedEnd((current) =>
      snapEnd((current ?? liveEnd) + steps * stepMs, liveEnd, stepMs, minEnd),
    );
  };

  return {
    interval,
    /** A new width; a moved window keeps its end, on the new width's stretches. */
    chooseInterval: (next: InstanceInterval) => {
      setChosen(next);
      setPinnedEnd((current) => (current === null ? null : alignEnd(current, next)));
    },
    from: end - windowMs,
    end,
    liveEnd,
    /** Unmoved: it ends now and follows the time. */
    live: pinnedEnd === null,
    windowMs,
    stepMs,
    domainStart,
    moveTo,
    pan,
    follow: () => setPinnedEnd(null),
  };
}

export type TimeWindow = ReturnType<typeof useTimeWindow>;
