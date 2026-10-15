import { GlassPanel, SegmentedControl } from '@/ui';
import { useCommentThreads } from '../hooks/useCommentThreads';
import type { StatusFilter } from '../lib/comment-selectors';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Filter pill (B1): Alle / Offen / Erledigt. Every slide's comments are always on screen in
 * the timeline, so the counts are deck-wide – "Alle" carries the total. PowerPoint comments
 * are no filter of their own: they count like any other and are marked on the comment itself.
 */
export function CommentFilterBar() {
  const { statusFilter } = useViewerState();
  const dispatch = useViewerDispatch();
  const { counts } = useCommentThreads();

  return (
    <GlassPanel className="scrollbar-none flex max-w-full min-w-0 items-center gap-3 overflow-x-auto p-1">
      <SegmentedControl<StatusFilter>
        label="Kommentare nach Status filtern"
        value={statusFilter}
        onChange={(filter) => dispatch({ type: 'statusFilterChanged', filter })}
        segments={[
          { value: 'all', label: 'Alle', icon: 'chatBubble', count: counts.all },
          { value: 'open', label: 'Offen', icon: 'radioButtonUnchecked', count: counts.open },
          { value: 'done', label: 'Erledigt', icon: 'checkCircleOutline', count: counts.done },
        ]}
      />
    </GlassPanel>
  );
}
