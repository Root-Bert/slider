import { useMemo } from 'react';
import {
  countByStatus,
  filterThreads,
  isBareDrawing,
  type StatusCounts,
  type Thread,
  threadsOnCurrentSlides,
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
  /** Like `bySlide`, plus drawings without a comment – everything marked on the slides. */
  marksBySlide: ReadonlyMap<string, Thread[]>;
  /** Gap threads that pass the filter, keyed by `gapKey` – they live under their ⊕ divider. */
  byGap: ReadonlyMap<string, Thread[]>;
  /** Counts for the whole deck (current slides only). */
  counts: StatusCounts;
}

const EMPTY: Thread[] = [];

/** Applies the comment filter bar (status, "aus PowerPoint") to the deck's threads. */
export function useCommentThreads(): VisibleThreads {
  const { threads, threadsBySlide, gapThreads, slideIndex } = useViewerData();
  const { statusFilter, pptxOnly } = useViewerState();

  const filter = useMemo<ThreadFilter>(
    () => ({ status: statusFilter, pptxOnly }),
    [statusFilter, pptxOnly],
  );

  const marksBySlide = useMemo(
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

  const bySlide = useMemo(
    () =>
      new Map(
        [...marksBySlide].map(([slideId, list]) => [
          slideId,
          list.some(isBareDrawing) ? list.filter((thread) => !isBareDrawing(thread)) : list,
        ]),
      ),
    [marksBySlide],
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

  // Threads on deleted slides are only reachable through "Gelöschte Folien": not counted here.
  // Drawings without a comment are no comments either.
  const counts = useMemo(
    () =>
      countByStatus(
        threadsOnCurrentSlides(threads, slideIndex).filter((thread) => !isBareDrawing(thread)),
        pptxOnly,
      ),
    [threads, slideIndex, pptxOnly],
  );

  return { filter, bySlide, marksBySlide, byGap, counts };
}

export const threadsOf = (bySlide: ReadonlyMap<string, Thread[]>, key: string | null): Thread[] =>
  (key ? bySlide.get(key) : undefined) ?? EMPTY;
