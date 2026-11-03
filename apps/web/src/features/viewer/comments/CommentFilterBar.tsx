import { useRef } from 'react';
import { smoothScroll } from '@/lib/motion';
import { GlassPanel, SegmentedControl } from '@/ui';
import { useCommentThreads } from './hooks/useCommentThreads';
import {
  homeSlideId,
  nextThread,
  threadsInDeckOrder,
  type StatusFilter,
} from './lib/comment-selectors';
import { statusSegments } from './lib/status-segments';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Filter pill (B1): Ausgeblendet / Alle / Offen / KI / Erledigt. Every slide's comments are always
 * on screen in the timeline, so the counts are deck-wide – "Alle" carries the total. PowerPoint
 * comments are no filter of their own: they count like any other and are marked on the comment
 * itself. Icon and count only, right-aligned before the deck controls; the name is the tooltip.
 * Clicking the selected filter again scrolls to its next thread in deck order, from the start after
 * the last one – only scrolls: the thread is neither focused nor opened. The walk goes on from the
 * thread focused by hand, if one was since.
 */
export function CommentFilterBar() {
  const { statusFilter, focusedThreadId } = useViewerState();
  const dispatch = useViewerDispatch();
  const { slides, slideIndex } = useViewerData();
  const { counts, bySlide, byGap } = useCommentThreads();
  const registry = useStageRegistry();
  // The thread the last click scrolled to, and the focus at that time.
  const walk = useRef<{ threadId: string; focusedThreadId: string | null } | null>(null);

  const onChange = (filter: StatusFilter) => {
    if (filter !== statusFilter) {
      walk.current = null;
      dispatch({ type: 'statusFilterChanged', filter });
      return;
    }
    if (filter === 'hidden') return;
    const from =
      walk.current && walk.current.focusedThreadId === focusedThreadId
        ? walk.current.threadId
        : focusedThreadId;
    const next = nextThread(threadsInDeckOrder(slides, bySlide, byGap), from);
    if (!next) return;
    walk.current = { threadId: next.id, focusedThreadId };
    const slideId = homeSlideId(next.root, slides, slideIndex);
    if (!slideId) return;
    dispatch({ type: 'activeSlideChanged', slideId });
    registry.revealSlide(slideId, { align: 'nearest' });
    // Down to its card too, once the slide's column is rendered (cards are windowed).
    requestAnimationFrame(() => revealCard(registry.getScroller(), next.id));
  };

  return (
    <GlassPanel className="scrollbar-none flex max-w-full min-w-0 items-center gap-3 overflow-x-auto p-1">
      <SegmentedControl<StatusFilter>
        label="Kommentare nach Status filtern"
        iconOnly
        value={statusFilter}
        onChange={onChange}
        segments={statusSegments(counts)}
      />
    </GlassPanel>
  );
}

/** Scrolls the track up or down (not sideways – `revealSlide` does that) until the card shows. */
function revealCard(scroller: HTMLElement | null, threadId: string) {
  const card = scroller?.querySelector(`[data-brick="${CSS.escape(threadId)}"]`);
  if (!scroller || !card) return;
  const view = scroller.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const margin = 24;
  const delta =
    box.top < view.top + margin
      ? box.top - view.top - margin
      : box.bottom > view.bottom - margin
        ? Math.min(box.bottom - view.bottom + margin, box.top - view.top - margin)
        : 0;
  if (Math.abs(delta) >= 1) scroller.scrollBy({ top: delta, behavior: smoothScroll() });
}
