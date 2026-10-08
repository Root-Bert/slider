import { memo } from 'react';
import { cn, Icon, Spinner } from '@/ui';
import { accentColor } from '@/lib/accent';
import { ApiError } from '@/lib/api-client';
import { useInsertSlide } from '@/lib/queries';
import type { Thread } from '../lib/comment-selectors';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';

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
  const insert = useInsertSlideHere(afterSlideId);
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
              mode === 'insert'
                ? insert.run()
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

/**
 * Inserts a slide after `afterSlideId` and jumps to it once the new revision is loaded. Without
 * write consent yet the browser goes to Microsoft and comes back to the deck.
 */
function useInsertSlideHere(afterSlideId: string | null) {
  const { deck } = useViewerData();
  const mutation = useInsertSlide(deck.id);
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const showToast = useViewerToast();

  const run = () => {
    if (!afterSlideId) return;
    mutation.mutate(
      { afterSlideId },
      {
        onSuccess: ({ result, slideId }) => {
          if (result.status === 'error') {
            showToast(
              result.error?.message ?? 'Die Folie konnte nicht eingefügt werden.',
              'danger',
            );
            return;
          }
          if (slideId) {
            dispatch({ type: 'activeSlideChanged', slideId });
            registry.revealSlide(slideId, { align: 'nearest', behavior: 'smooth' });
          }
          showToast(
            slideId
              ? 'Folie eingefügt und in der PowerPoint gespeichert'
              : 'Folie in der PowerPoint gespeichert – die Vorschau folgt gleich',
            'neutral',
          );
        },
        onError: (error) => {
          if (error instanceof ApiError && error.loginUrl) {
            window.location.assign(error.loginUrl);
            return;
          }
          showToast(error.message, 'danger');
        },
      },
    );
  };

  return { run, isPending: mutation.isPending };
}
