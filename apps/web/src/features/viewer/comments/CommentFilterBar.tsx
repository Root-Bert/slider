import { GlassPanel, SegmentedControl } from '@/ui';
import { useCommentThreads } from './hooks/useCommentThreads';
import type { StatusFilter } from './lib/comment-selectors';
import { statusSegments } from './lib/status-segments';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Filter pill (B1): Ausgeblendet / Alle / Offen / KI / Erledigt. Every slide's comments are always
 * on screen in the timeline, so the counts are deck-wide – "Alle" carries the total. PowerPoint
 * comments are no filter of their own: they count like any other and are marked on the comment
 * itself. Icon and count only, right-aligned before the deck controls; the name is the tooltip.
 */
export function CommentFilterBar() {
  const { statusFilter } = useViewerState();
  const dispatch = useViewerDispatch();
  const { counts } = useCommentThreads();

  return (
    <GlassPanel className="scrollbar-none flex max-w-full min-w-0 items-center gap-3 overflow-x-auto p-1">
      <SegmentedControl<StatusFilter>
        label="Kommentare nach Status filtern"
        iconOnly
        value={statusFilter}
        onChange={(filter) => dispatch({ type: 'statusFilterChanged', filter })}
        segments={statusSegments(counts)}
      />
    </GlassPanel>
  );
}
