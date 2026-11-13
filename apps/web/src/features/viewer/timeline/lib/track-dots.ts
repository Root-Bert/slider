import { createContext, use } from 'react';
import type { TrackStack } from './timeline-layout';

/** A dot's button and the gap between two (px) – `size-2.5`, `gap-1`. */
const DOT = 10;
const DOT_GAP = 4;

/** The band's tracks for the dots in its gaps: none without tracks besides the slides'. */
export const TrackDotsContext = createContext<{
  stack: TrackStack;
  track: number;
  go: (track: number) => void;
} | null>(null);

/** How tall the dots of `stack` are (px); 0 without tracks besides the slides'. */
export function trackDotsHeight(stack: TrackStack | undefined): number {
  const count = stack ? stack.above + stack.below + 1 : 1;
  return count > 1 ? count * DOT + (count - 1) * DOT_GAP : 0;
}

/** The band's tracks, if it has more than the slides'. */
export function useTrackDots() {
  const dots = use(TrackDotsContext);
  return dots && dots.stack.above + dots.stack.below > 0 ? dots : null;
}
