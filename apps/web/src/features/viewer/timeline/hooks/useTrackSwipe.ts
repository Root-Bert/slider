import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { clamp } from '@slider/shared';
import { prefersReducedMotion } from '@/lib/motion';
import type { TrackStack } from '../lib/timeline-layout';
import { TrackPager } from '../lib/track-paging';

export interface TrackSwipe {
  /** The track shown (`trackStack`: 0 the slides). */
  track: number;
  /** A swipe is on or the band is settling: `reach` is drawn too, clipped to the band. */
  moving: boolean;
  /** Tracks drawn besides the one shown while it moves: those beside it, those it passes. */
  reach: readonly number[];
  /** Gets the band, where its tracks move with the swipe (`--track-drag`), set without rendering. */
  attachBand: (node: HTMLElement | null) => void;
  /** Shows track `track`, sliding to it. */
  go: (track: number) => void;
  /** A vertical wheel over the band: swipes the tracks (and takes the event); `false` with none to swipe. */
  wheel: (event: WheelEvent) => boolean;
}

/**
 * The band of tracks paged up and down like a phone's pages (`TrackPager`): a trackpad swipe
 * moves it 1:1 with the fingers, and when they let go a spring carries it on to the next track
 * – past half way, or flicked – or back. A mouse wheel goes a track a notch, a dot click to its
 * track, on the same spring. Drawn through `--track-drag` on the band, without rendering; down
 * shows what is over the slides (their variants), up what is under them (their notes), as content
 * scrolls.
 */
export function useTrackSwipe(stack: TrackStack, height: number): TrackSwipe {
  const [track, setTrack] = useState(0);
  const [reach, setReach] = useState<readonly number[]>([]);
  const [pager] = useState(
    () =>
      new TrackPager({
        show: setTrack,
        draw: (levels) =>
          setReach((drawn) => {
            if (!levels) return drawn.length ? [] : drawn;
            const missing = levels.filter((level) => !drawn.includes(level));
            return missing.length ? [...drawn, ...missing] : drawn;
          }),
        reducedMotion: prefersReducedMotion,
      }),
  );
  // The track shown no longer there (a variant used or deleted): the nearest one that is.
  const shown = clamp(track, -stack.above, stack.below);
  useLayoutEffect(() => pager.sync(shown, stack, height));
  useEffect(() => () => pager.dispose(), [pager]);

  const attachBand = useCallback((node: HTMLElement | null) => pager.attach(node), [pager]);
  const go = useCallback((to: number) => pager.go(to), [pager]);
  const wheel = useCallback((event: WheelEvent) => pager.wheel(event), [pager]);

  return { track: shown, moving: reach.length > 0, reach, attachBand, go, wheel };
}
