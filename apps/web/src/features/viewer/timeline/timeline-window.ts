import { useSyncExternalStore } from 'react';
import type { visibleRange } from './lib/timeline-layout';

type Range = ReturnType<typeof visibleRange>;

/** Only the track and columns need a new render when the virtual window moves. */
export function createTimelineWindow() {
  let range: Range = { first: 0, last: -1 };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => range,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (next: Range) => {
      if (range.first === next.first && range.last === next.last) return;
      range = next;
      for (const listener of listeners) listener();
    },
  };
}

export type TimelineWindow = ReturnType<typeof createTimelineWindow>;

export function useTimelineRange(window: TimelineWindow): Range {
  return useSyncExternalStore(window.subscribe, window.getSnapshot, window.getSnapshot);
}
