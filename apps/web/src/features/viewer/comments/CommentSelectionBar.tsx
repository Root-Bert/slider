import { useState, type AnimationEvent } from 'react';
import { cn, ContextMenu, SelectionBar } from '@/ui';
import { useBulkCommentActions } from './hooks/useBulkCommentActions';
import type { Thread } from './lib/comment-selectors';

/**
 * The comments selected under the slides (a box drawn over them, ⌘/⇧-click) and what can be
 * done with them – grown out of the split handle's line and shrunk back into it once nothing is
 * selected, as the find bar does. Lives in the handle's spot; stays mounted for its delete dialog.
 */
export function CommentSelectionBar({
  threads,
  onClear,
  menuAt,
  onMenuClose,
}: {
  threads: readonly Thread[];
  onClear: () => void;
  /** Right click on one of the selected: their actions there (`onContextMenuCapture`). */
  menuAt: { x: number; y: number } | null;
  onMenuClose: () => void;
}) {
  // The threads it shows, kept while it shrinks back (its buttons don't change on the way).
  const [shown, setShown] = useState(threads);
  const [closing, setClosing] = useState(false);
  if (threads.length > 0 && (threads !== shown || closing)) {
    setShown(threads);
    setClosing(false);
  } else if (threads.length === 0 && shown.length > 0 && !closing) {
    setClosing(true);
  }
  const bulk = useBulkCommentActions(shown, { onDone: onClear });

  const onMorphEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !closing) return;
    setShown([]);
    setClosing(false);
  };

  return (
    <>
      {shown.length > 0 && (
        <div
          data-comment-selection
          inert={closing}
          // As wide as the gap the controls leave in the middle (`useHandleRoom`), at most what
          // the bar needs with its labels: a container, so they give way to icons when it's less.
          className="absolute z-(--z-raised) flex w-[min(680px,calc(100%-3.5rem))] justify-center @container"
        >
          <SelectionBar
            label="Ausgewählte Kommentare"
            count={shown.length}
            actions={bulk.actions}
            onClear={onClear}
            onAnimationEnd={onMorphEnd}
            labelClassName="@max-[660px]:hidden"
            countLabelClassName="@max-[300px]:hidden"
            className={cn(
              'relative min-w-0',
              closing ? 'animate-morph-into-handle' : 'animate-morph-out-of-handle',
            )}
            backdrop={
              // The handle's line, fading into the bar as it grows.
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-0 bg-fg-muted',
                  closing ? 'animate-handle-fade-in' : 'animate-handle-fade-out',
                )}
              />
            }
          />
        </div>
      )}
      {menuAt && threads.length > 1 && (
        <ContextMenu
          label={`Aktionen für ${threads.length} ausgewählte Kommentare`}
          actions={bulk.actions}
          at={menuAt}
          onClose={onMenuClose}
        />
      )}
      {bulk.dialog}
    </>
  );
}
