import { useMemo } from 'react';
import {
  countByStatus,
  filterThreads,
  type StatusCounts,
  type Thread,
  type ThreadFilter,
} from '../lib/comment-selectors';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

export interface VisibleThreads {
  filter: ThreadFilter;
  /** Threads per home slide that pass the current filter. Arrays are stable until data or filter change. */
  bySlide: ReadonlyMap<string, Thread[]>;
  /** Counts for the active slide (or the whole deck in "Alle Folien" scope). */
  counts: StatusCounts;
}

const EMPTY: Thread[] = [];

/** Applies the comment filter bar (status, "aus PowerPoint", scope) to the deck's threads. */
export function useCommentThreads(): VisibleThreads {
  const { threads, threadsBySlide } = useViewerData();
  const { statusFilter, pptxOnly, scope, activeSlideId } = useViewerState();

  const filter = useMemo<ThreadFilter>(
    () => ({ status: statusFilter, pptxOnly }),
    [statusFilter, pptxOnly],
  );

  const bySlide = useMemo(
    () =>
      new Map([...threadsBySlide].map(([slideId, list]) => [slideId, filterThreads(list, filter)])),
    [threadsBySlide, filter],
  );

  const counts = useMemo(() => {
    const pool =
      scope === 'deck'
        ? threads
        : ((activeSlideId ? threadsBySlide.get(activeSlideId) : undefined) ?? EMPTY);
    return countByStatus(pool, pptxOnly);
  }, [scope, threads, threadsBySlide, activeSlideId, pptxOnly]);

  return { filter, bySlide, counts };
}

export const threadsOf = (
  bySlide: ReadonlyMap<string, Thread[]>,
  slideId: string | null,
): Thread[] => (slideId ? bySlide.get(slideId) : undefined) ?? EMPTY;
