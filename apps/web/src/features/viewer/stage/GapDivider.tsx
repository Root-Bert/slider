import { memo } from 'react';
import { cn, Icon } from '@/ui';
import { accentColor } from '@/lib/accent';
import type { Thread } from '../lib/comment-selectors';
import { useViewerDispatch } from '../state/viewer-state';
import { GAP_DIVIDER_PX } from './stage-layout';

interface GapDividerProps {
  gapKey: string;
  afterSlideId: string | null;
  beforeSlideId: string | null;
  threads: Thread[] | undefined;
  isDrafting: boolean;
  canComment: boolean;
}

/**
 * Hairline between two slides with a ⊕ button: "hier fehlt eine Folie" (BER-103).
 * Existing gap comments show as a marker below the button.
 */
export const GapDivider = memo(function GapDivider({
  gapKey,
  afterSlideId,
  beforeSlideId,
  threads,
  isDrafting,
  canComment,
}: GapDividerProps) {
  const dispatch = useViewerDispatch();
  const openThreads = threads?.filter((thread) => thread.root.status === 'open') ?? [];
  const first = threads?.[0];

  return (
    <div
      data-gap-key={gapKey}
      className="relative flex shrink-0 justify-center self-stretch"
      style={{ width: GAP_DIVIDER_PX }}
    >
      {/* Figma: the hairline pauses 16px above and below the ⊕. */}
      <span
        aria-hidden
        className={cn(
          'h-full w-px transition-colors',
          isDrafting ? 'bg-fg' : 'bg-white/50',
          canComment &&
            '[mask-image:linear-gradient(#000_calc(50%-28px),transparent_calc(50%-28px),transparent_calc(50%+28px),#000_calc(50%+28px))]',
        )}
      />
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        {canComment && (
          <button
            type="button"
            aria-label="Kommentar zwischen den Folien – hier fehlt etwas"
            title="Hier fehlt eine Folie"
            onClick={() => dispatch({ type: 'gapDraftStarted', afterSlideId, beforeSlideId })}
            className={cn(
              'flex size-7 items-center justify-center rounded-full bg-canvas transition-colors',
              isDrafting ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon name="addCircle" size={24} />
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
