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
  /**
   * Threads per slide column that pass the filter: comments on the slide itself plus gap
   * comments in front of the first slide (there is no divider before it). Arrays are stable
   * until data or filter change.
   */
  bySlide: ReadonlyMap<string, Thread[]>;
  /** Gap threads that pass the filter, keyed by `gapKey` – they live under their ⊕ divider. */
  byGap: ReadonlyMap<string, Thread[]>;
  /** Counts for the whole deck. */
  counts: StatusCounts;
}

const EMPTY: Thread[] = [];

/** Applies the comment filter bar (status, "aus PowerPoint") to the deck's threads. */
export function useCommentThreads(): VisibleThreads {
  const { threads, threadsBySlide, gapThreads } = useViewerData();
  const { statusFilter, pptxOnly } = useViewerState();

  const filter = useMemo<ThreadFilter>(
    () => ({ status: statusFilter, pptxOnly }),
    [statusFilter, pptxOnly],
  );

  const bySlide = useMemo(
    () =>
      new Map(
        [...threadsBySlide].map(([slideId, list]) => [
          slideId,
          filterThreads(
            list.filter(
              ({ root: { anchor } }) => anchor.type !== 'gap' || anchor.afterSlideId === null,
            ),
            filter,
          ),
        ]),
      ),
    [threadsBySlide, filter],
  );

  const byGap = useMemo(() => {
    const result = new Map<string, Thread[]>();
    for (const [key, list] of gapThreads) {
      if (key.startsWith('start→')) continue;
      const visible = filterThreads(list, filter);
      if (visible.length > 0) result.set(key, visible);
    }
    return result;
  }, [gapThreads, filter]);

  const counts = useMemo(() => countByStatus(threads, pptxOnly), [threads, pptxOnly]);

  return { filter, bySlide, byGap, counts };
}

export const threadsOf = (bySlide: ReadonlyMap<string, Thread[]>, key: string | null): Thread[] =>
  (key ? bySlide.get(key) : undefined) ?? EMPTY;
