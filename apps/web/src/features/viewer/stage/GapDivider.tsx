import { memo } from 'react';
import { cn, CountBubble, Icon } from '@/ui';
import type { Thread } from '../comments/lib/comment-selectors';
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
}

/**
 * Short hairline: fades out towards both ends and pauses 8px around the ⊕. Literal for Tailwind.
 * `#000` is mask paint (opaque keeps, transparent cuts), not a visible colour.
 */
const HAIRLINE_MASK =
  '[mask-image:linear-gradient(transparent,#000_30%,#000_calc(50%-20px),transparent_calc(50%-20px),transparent_calc(50%+20px),#000_calc(50%+20px),#000_70%,transparent)]';
/** Without a ⊕ the line runs through, still fading towards both ends. */
const HAIRLINE_FADE = '[mask-image:linear-gradient(transparent,#000_30%,#000_70%,transparent)]';

/**
 * A short hairline between two slides with an always-visible ⊕ that starts a "hier fehlt eine
 * Folie" comment (BER-103). Existing gap comments show as a marker below the button.
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
}: GapDividerProps) {
  const dispatch = useViewerDispatch();
  const openThreads = threads?.filter((thread) => thread.root.status === 'open') ?? [];
  const first = threads?.[0];
  // Narrow gaps (small slides) get a smaller button.
  const tight = width < 32;

  return (
    <div
      data-gap-key={gapKey}
      className="absolute flex justify-center"
      style={{ left: x, top, width, height }}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-1/5 h-3/5 w-px transition-colors',
          isDrafting ? 'bg-fg' : 'bg-fg-subtle',
          canComment ? HAIRLINE_MASK : HAIRLINE_FADE,
        )}
      />
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        {canComment && (
          // A mark on the track rather than a toolbar control (like pins): no hover fill, so not
          // an IconButton. Sits in the hairline's pause.
          <button
            type="button"
            aria-label="Kommentar zwischen den Folien – hier fehlt etwas"
            title="Hier fehlt eine Folie"
            onClick={() => dispatch({ type: 'gapDraftStarted', afterSlideId, beforeSlideId })}
            className={cn(
              'flex items-center justify-center rounded-full transition-colors',
              tight ? 'size-5' : 'size-6',
              isDrafting ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon name="addCircle" size={tight ? 'lg' : 'xl'} />
          </button>
        )}
        {first && (
          <CountBubble
            count={threads.length}
            color={first.root.author.color}
            dim={openThreads.length === 0}
            // The connector line to the gap comment's card starts below this marker.
            data-gap-marker
            data-hover-thread={first.id}
            onClick={() => dispatch({ type: 'threadFocused', threadId: first.id, openPanel: true })}
            aria-label={`${threads.length} Kommentar${threads.length === 1 ? '' : 'e'} zwischen den Folien`}
          />
        )}
      </div>
    </div>
  );
});
