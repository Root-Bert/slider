import { memo } from 'react';
import { cn, Icon, Spinner } from '@/ui';
import { accentColor } from '@/lib/accent';
import { useInsertSlide } from '../hooks/useInsertSlide';
import type { Thread } from '../lib/comment-selectors';
import { useViewerDispatch } from '../state/viewer-state';

interface GapDividerProps {
  gapKey: string;
  /** Position and size in the track (px). */
  x: number;
  top: number;
  width: number;
  height: number;
  afterSlideId: string | null;
  beforeSlideId: string | null;
  threads: Thread[] | undefined;
  isDrafting: boolean;
  canComment: boolean;
  /** The ⊕ inserts a slide into the PowerPoint instead of starting a gap comment (BER-128). */
  canInsert: boolean;
}

/** Figma: the hairline pauses 16px above and below the ⊕ – while the ⊕ shows. Literal for Tailwind. */
const HAIRLINE_GAP =
  '[mask-image:linear-gradient(#000_calc(50%-28px),transparent_calc(50%-28px),transparent_calc(50%+28px),#000_calc(50%+28px))]';
const HAIRLINE_GAP_ON_HOVER =
  'group-hover:[mask-image:linear-gradient(#000_calc(50%-28px),transparent_calc(50%-28px),transparent_calc(50%+28px),#000_calc(50%+28px))] ' +
  'group-focus-within:[mask-image:linear-gradient(#000_calc(50%-28px),transparent_calc(50%-28px),transparent_calc(50%+28px),#000_calc(50%+28px))]';

/**
 * Hairline between two slides with a ⊕ that appears on hover. For the owner of a deck linked
 * from OneDrive/SharePoint it inserts an empty slide there (BER-128); for everyone else who may
 * comment it starts a "hier fehlt eine Folie" comment (BER-103). Existing gap comments show as
 * a marker below the button.
 */
export const GapDivider = memo(function GapDivider({
  gapKey,
  x,
  top,
  width,
  height,
  afterSlideId,
  beforeSlideId,
  threads,
  isDrafting,
  canComment,
  canInsert,
}: GapDividerProps) {
  const dispatch = useViewerDispatch();
  const insert = useInsertSlide();
  const openThreads = threads?.filter((thread) => thread.root.status === 'open') ?? [];
  const first = threads?.[0];
  // Narrow gaps (small slides) get a smaller ⊕.
  const tight = width < 32;
  const mode = canInsert && afterSlideId ? 'insert' : canComment ? 'comment' : null;
  const pinned = isDrafting || insert.isPending;

  return (
    <div
      data-gap-key={gapKey}
      className="group absolute flex justify-center"
      style={{ left: x, top, width, height }}
    >
      <span
        aria-hidden
        className={cn(
          'h-full w-px transition-colors',
          isDrafting ? 'bg-fg' : 'bg-white/50',
          mode && (pinned ? HAIRLINE_GAP : HAIRLINE_GAP_ON_HOVER),
        )}
      />
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        {mode && (
          <button
            type="button"
            aria-label={
              mode === 'insert'
                ? 'Neue Folie hier einfügen'
                : 'Kommentar zwischen den Folien – hier fehlt etwas'
            }
            title={mode === 'insert' ? 'Folie einfügen' : 'Hier fehlt eine Folie'}
            aria-busy={insert.isPending || undefined}
            disabled={insert.isPending}
            onClick={() =>
              mode === 'insert' && afterSlideId
                ? insert.run(afterSlideId)
                : dispatch({ type: 'gapDraftStarted', afterSlideId, beforeSlideId })
            }
            className={cn(
              'flex items-center justify-center rounded-full bg-canvas transition-[color,opacity] disabled:cursor-progress',
              tight ? 'size-6' : 'size-7',
              isDrafting ? 'text-fg' : 'text-fg-muted hover:text-fg',
              pinned
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            {insert.isPending ? (
              <Spinner size={tight ? 16 : 20} className="text-fg-muted" />
            ) : (
              <Icon name="addCircle" size={tight ? 20 : 24} />
            )}
          </button>
        )}
        {first && (
          <button
            type="button"
            // The connector line to the gap comment's card starts below this marker.
            data-gap-marker
            onClick={() => dispatch({ type: 'threadFocused', threadId: first.id, openPanel: true })}
            onPointerEnter={() => dispatch({ type: 'threadHovered', threadId: first.id })}
            onPointerLeave={() => dispatch({ type: 'threadHovered', threadId: null })}
            aria-label={`${threads.length} Kommentar${threads.length === 1 ? '' : 'e'} zwischen den Folien`}
            className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white ring-2 ring-canvas"
            style={{
              backgroundColor: accentColor(first.root.author.color),
              opacity: openThreads.length ? 1 : 0.5,
            }}
          >
            {threads.length}
          </button>
        )}
      </div>
    </div>
  );
});
