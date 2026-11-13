import { useMemo } from 'react';
import { AI_AUTHOR } from '@slider/shared';
import {
  deckStatusCounts,
  filterThreads,
  gapKey,
  isBareDrawing,
  isBareSticker,
  type StatusCounts,
  type Thread,
  type ThreadFilter,
} from '../lib/comment-selectors';
import { useViewerData } from '../../state/viewer-data';
import { useAiThreads } from './useAiThreads';
import { useViewerState } from '../../state/viewer-state';

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

/**
 * Applies the comment filter bar (status, or the threads the AI asks back in) and the avatar filter (your avatar:
 * threads that @mention you; someone else's: threads they wrote in, the AI's also those it
 * answered in) to the deck's threads.
 * A thread being replied to stays listed, whatever its status now (`useKeepThreadListed`).
 */
export function useCommentThreads(): VisibleThreads {
  const { threads, threadsBySlide, gapThreads, slides, slideIndex, mentionedThreadIds, viewer } =
    useViewerData();
  const { asking: aiThreadIds, answered: aiAnswered, working: aiWorking } = useAiThreads();
  const { statusFilter, personFilter, composingThreads } = useViewerState();
  const keep = useMemo(() => new Set(composingThreads.keys()), [composingThreads]);

  const threadIds = useMemo(() => {
    if (personFilter === null) return null;
    if (personFilter === viewer.author.id) return mentionedThreadIds;
    const ids = new Set(
      threads
        .filter((thread) => thread.participants.some((author) => author.id === personFilter))
        .map((thread) => thread.id),
    );
    // The AI's avatar: also the threads it answered in, not only those it wrote a comment in.
    if (personFilter === AI_AUTHOR.id) for (const id of aiAnswered) ids.add(id);
    return ids;
  }, [personFilter, viewer.author.id, mentionedThreadIds, threads, aiAnswered]);

  const filter = useMemo<ThreadFilter>(
    () => ({ status: statusFilter, threadIds, aiThreadIds, keep }),
    [statusFilter, threadIds, aiThreadIds, keep],
  );

  // Gap threads sit under their divider – except those in front of the first slide (where they
  // sit now, `placeGap`), which has no divider before it.
  const firstSlideId = slides[0]?.id;
  const inFront = useMemo(
    () => new Set(firstSlideId ? (gapThreads.get(gapKey(null, firstSlideId)) ?? []) : []),
    [gapThreads, firstSlideId],
  );
  const marksBySlide = useMemo(
    () =>
      new Map(
        [...threadsBySlide].map(([slideId, list]) => [
          slideId,
          filterThreads(
            list.filter((thread) => thread.root.anchor.type !== 'gap' || inFront.has(thread)),
            filter,
          ),
        ]),
      ),
    [threadsBySlide, inFront, filter],
  );

  const bySlide = useMemo(() => {
    // No card for what is all on the slide: a drawing without a comment, and a sticker sent
    // without one – until something is said to it (a reply, the AI at work or its answer).
    const cardless = (thread: Thread) =>
      isBareDrawing(thread) ||
      (isBareSticker(thread) &&
        !aiAnswered.has(thread.id) &&
        !aiWorking.has(thread.id) &&
        !keep.has(thread.id));
    return new Map(
      [...marksBySlide].map(([slideId, list]) => [
        slideId,
        list.some(cardless) ? list.filter((thread) => !cardless(thread)) : list,
      ]),
    );
  }, [marksBySlide, aiAnswered, aiWorking, keep]);

  const byGap = useMemo(() => {
    const result = new Map<string, Thread[]>();
    for (const [key, list] of gapThreads) {
      if (key.startsWith('start→')) continue;
      const visible = filterThreads(list, filter);
      if (visible.length > 0) result.set(key, visible);
    }
    return result;
  }, [gapThreads, filter]);

  const counts = useMemo(
    () => deckStatusCounts(threads, slides, slideIndex, threadIds, aiThreadIds),
    [threads, slides, slideIndex, threadIds, aiThreadIds],
  );

  return { filter, bySlide, marksBySlide, byGap, counts };
}

export const threadsOf = (bySlide: ReadonlyMap<string, Thread[]>, key: string | null): Thread[] =>
  (key ? bySlide.get(key) : undefined) ?? EMPTY;
