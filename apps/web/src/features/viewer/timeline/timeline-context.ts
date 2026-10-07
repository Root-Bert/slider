import { createContext, useContext, type RefObject } from 'react';
import type { TrackGeometry, TrackLayout } from '../lib/timeline-layout';

/** Content point that must stay under `viewportX` (px from the scroller's left edge) when zooming. */
export interface ZoomAnchor {
  contentX: number;
  viewportX: number;
  /** Index of a slide that must end up fully in view after the zoom (revealed `nearest`). */
  keep?: number;
}

export interface TimelineContextValue {
  geometry: TrackGeometry;
  layout: TrackLayout;
  /** Set right before dispatching `zoomChanged`; consumed by the timeline's next layout. */
  anchorRef: RefObject<ZoomAnchor | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
}

export const TimelineContext = createContext<TimelineContextValue | null>(null);

export function useTimeline(): TimelineContextValue {
  const value = useContext(TimelineContext);
  if (!value) throw new Error('useTimeline must be used inside <Timeline>');
  return value;
}
