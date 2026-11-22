import { createContext, use } from 'react';
import type { TrackStack } from './timeline-layout';

/** The band's tracks for the dots in its gaps: none without tracks besides the slides'. */
export const TrackDotsContext = createContext<{
  stack: TrackStack;
  track: number;
  go: (track: number) => void;
} | null>(null);

/** The band's tracks, if it has more than the slides'. */
export function useTrackDots() {
  const dots = use(TrackDotsContext);
  return dots && dots.stack.above + dots.stack.below > 0 ? dots : null;
}
