import { pluralize } from '@/lib/format';
import { FilterChip, GlassPanel, SegmentedControl } from '@/ui';
import { useCommentThreads } from '../hooks/useCommentThreads';
import type { StatusFilter } from '../lib/comment-selectors';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Filter pill (B1): "12 Kommentare", Alle / Offen / Erledigt, "aus PowerPoint". Every slide's
 * comments are always on screen in the timeline, so the counts are deck-wide.
 */
export function CommentFilterBar() {
  const { statusFilter, pptxOnly } = useViewerState();
  const dispatch = useViewerDispatch();
  const { counts } = useCommentThreads();

  return (
    <GlassPanel className="scrollbar-none flex max-w-full min-w-0 items-center gap-3 overflow-x-auto py-1 pr-1 pl-3">
      <span
        className="shrink-0 text-xs whitespace-nowrap text-fg-muted md:@max-[1100px]:hidden"
        aria-live="polite"
      >
        {pluralize(counts.all, 'Kommentar', 'Kommentare')}
      </span>
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
      <span aria-hidden className="h-5 w-px shrink-0 bg-white/15" />
      <FilterChip
        selected={pptxOnly}
        icon="description"
        onClick={() => dispatch({ type: 'pptxOnlyToggled' })}
      >
        aus PowerPoint
      </FilterChip>
    </GlassPanel>
  );
}
