import { pluralize } from '@/lib/format';
import { FilterChip, GlassPanel, SegmentedControl } from '@/ui';
import { useCommentThreads } from '../hooks/useCommentThreads';
import type { StatusFilter } from '../lib/comment-selectors';
import { slideLabel } from '../lib/labels';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/** Filter pill (B1): "Folie 1 · 7 Kommentare", Alle / Offen / Erledigt, "aus PowerPoint", "Alle Folien". */
export function CommentFilterBar() {
  const { slideIndex } = useViewerData();
  const { activeSlideId, statusFilter, pptxOnly, scope } = useViewerState();
  const dispatch = useViewerDispatch();
  const { counts } = useCommentThreads();
  const position = activeSlideId ? (slideIndex.get(activeSlideId) ?? 0) : 0;

  return (
    <GlassPanel className="scrollbar-none flex max-w-full items-center gap-3 overflow-x-auto py-1 pr-1 pl-3">
      <span className="shrink-0 text-xs whitespace-nowrap text-fg-muted" aria-live="polite">
        {scope === 'deck' ? 'Alle Folien' : slideLabel(position)} ·{' '}
        {pluralize(counts.all, 'Kommentar', 'Kommentare')}
      </span>
      <SegmentedControl<StatusFilter>
        label="Kommentare nach Status filtern"
        value={statusFilter}
        onChange={(filter) => dispatch({ type: 'statusFilterChanged', filter })}
        segments={[
          { value: 'all', label: 'Alle', count: counts.all },
          { value: 'open', label: 'Offen', count: counts.open },
          { value: 'done', label: 'Erledigt', count: counts.done },
        ]}
      />
      <span aria-hidden className="h-5 w-px shrink-0 bg-white/15" />
      <div className="flex items-center gap-1">
        <FilterChip selected={pptxOnly} onClick={() => dispatch({ type: 'pptxOnlyToggled' })}>
          aus PowerPoint
        </FilterChip>
        <FilterChip
          selected={scope === 'deck'}
          onClick={() =>
            dispatch({ type: 'scopeChanged', scope: scope === 'deck' ? 'slide' : 'deck' })
          }
        >
          Alle Folien
        </FilterChip>
      </div>
    </GlassPanel>
  );
}
