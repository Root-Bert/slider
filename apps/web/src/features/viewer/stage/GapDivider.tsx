import { memo } from 'react';
import { cn, CountBubble, Icon, usePopover } from '@/ui';
import type { Thread } from '../comments/lib/comment-selectors';
import { SlideInsertPicker } from '../editing/SlideInsertPicker';
import { useTransitionOf } from '../editing/transition/picked-transitions';
import { SlideTransitionPicker } from '../editing/transition/SlideTransitionPicker';
import { transitionLabel } from '../editing/transition/transition-frames';
import { useViewerDispatch } from '../state/viewer-state';
import { trackDotsHeight, useTrackDots } from '../timeline/lib/track-dots';
import { TrackDots } from '../timeline/TrackDots';
import { gapButtons, gapDotsLift } from './lib/gap-buttons';

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
  /**
   * The deck is editable here: a ⊕ above the comment button inserts a slide, a button between
   * them picks the transition of the slide after the gap.
   */
  canInsert: boolean;
}

/**
 * Short hairline: fades out towards both ends and pauses 8px around the ⊕. Literal for Tailwind.
 * `#000` is mask paint (opaque keeps, transparent cuts), not a visible colour.
 */
const HAIRLINE_MASK =
  '[mask-image:linear-gradient(transparent,#000_30%,#000_calc(50%-20px),transparent_calc(50%-20px),transparent_calc(50%+20px),#000_calc(50%+20px),#000_70%,transparent)]';
/** With two buttons (insert, comment) the pause is taller. */
const HAIRLINE_MASK_PAIR =
  '[mask-image:linear-gradient(transparent,#000_30%,#000_calc(50%-32px),transparent_calc(50%-32px),transparent_calc(50%+32px),#000_calc(50%+32px),#000_70%,transparent)]';
/** With three (insert, transition, comment) taller still. */
const HAIRLINE_MASK_TRIPLE =
  '[mask-image:linear-gradient(transparent,#000_25%,#000_calc(50%-48px),transparent_calc(50%-48px),transparent_calc(50%+48px),#000_calc(50%+48px),#000_75%,transparent)]';
/** Without buttons the line runs through, still fading towards both ends. */
const HAIRLINE_FADE = '[mask-image:linear-gradient(transparent,#000_30%,#000_70%,transparent)]';
/** By the number of buttons in the pause. */
const HAIRLINE_MASKS = [HAIRLINE_FADE, HAIRLINE_MASK, HAIRLINE_MASK_PAIR, HAIRLINE_MASK_TRIPLE];
/** Half the pause by the number of buttons (as in the masks above); none: a little round the dots. */
const HAIRLINE_PAUSES = [6, 20, 32, 48];

/** The pause reaching further up, over the track dots over the buttons (`below` + `above` px). */
const hairlineMaskAround = (below: number, above: number) =>
  `linear-gradient(transparent,#000 25%,#000 calc(50% - ${above}px),transparent calc(50% - ${above}px),transparent calc(50% + ${below}px),#000 calc(50% + ${below}px),#000 75%,transparent)`;

/**
 * A short hairline between two slides with always-visible buttons in its pause: on an editable
 * deck a ⊕ that inserts a slide there (its picker opens beside it) and the transition of the
 * slide after it (likewise), and the comment button that
 * starts a "hier fehlt eine Folie" comment (BER-103). Existing gap comments show as a marker
 * below them.
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
  canComment: commentable,
  canInsert: insertable,
}: GapDividerProps) {
  const dispatch = useViewerDispatch();
  const openThreads = threads?.filter((thread) => thread.root.status === 'open') ?? [];
  const first = threads?.[0];
  // Narrow gaps (small slides) get a smaller button.
  const tight = width < 32;
  const {
    canInsert,
    canComment,
    canTransition,
    count: buttons,
  } = gapButtons({ afterSlideId, beforeSlideId, canInsert: insertable, canComment: commentable });
  // The band's tracks (variants, notes): their dots sit over the buttons.
  const dots = trackDotsHeight(useTrackDots()?.stack);
  const pause = HAIRLINE_PAUSES[buttons] ?? 0;
  const lift = gapDotsLift(buttons, width);

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
          !dots && HAIRLINE_MASKS[buttons],
        )}
        style={dots ? { maskImage: hairlineMaskAround(pause, lift + dots + 6) } : undefined}
      />
      {/* Above the slides' elements: one reaching past its slide would cover the buttons. */}
      {/* The buttons centred; the track dots over them and the comments' marker under them lie
          outside, so neither moves them (nor the hairline's pause). */}
      <div className="absolute top-1/2 left-1/2 z-(--z-overlay) flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <TrackDots className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2" />
        {canInsert && afterSlideId && (
          <InsertSlideButton afterSlideId={afterSlideId} tight={tight} />
        )}
        {canTransition && beforeSlideId && (
          <TransitionButton afterSlideId={afterSlideId} slideId={beforeSlideId} tight={tight} />
        )}
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
            <Icon name={canInsert ? 'addComment' : 'addCircle'} size={tight ? 'lg' : 'xl'} />
          </button>
        )}
        {first && (
          <CountBubble
            className="absolute top-full left-1/2 mt-2 -translate-x-1/2"
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

/** The gap's ⊕ on an editable deck: opens „Folie einfügen“ beside it. */
function InsertSlideButton({ afterSlideId, tight }: { afterSlideId: string; tight: boolean }) {
  const { open, close, triggerProps, triggerRef, panelRef, panelId } = usePopover({
    hasPopup: 'dialog',
  });
  return (
    <>
      <button
        type="button"
        {...triggerProps}
        aria-label="Folie einfügen"
        title="Folie einfügen"
        className={cn(
          'flex items-center justify-center rounded-full transition-colors',
          tight ? 'size-5' : 'size-6',
          open ? 'text-fg' : 'text-fg-muted hover:text-fg',
        )}
      >
        <Icon name="addCircle" size={tight ? 'lg' : 'xl'} />
      </button>
      {open && (
        <SlideInsertPicker
          anchorRef={triggerRef}
          panelRef={panelRef}
          panelId={panelId}
          afterSlideId={afterSlideId}
          onClose={close}
        />
      )}
    </>
  );
}

/**
 * The gap's transition button on an editable deck: opens „Übergang“ for the slide after the gap.
 * Drawn stronger while that slide has one.
 */
function TransitionButton({
  afterSlideId,
  slideId,
  tight,
}: {
  afterSlideId: string | null;
  slideId: string;
  tight: boolean;
}) {
  const transitionOf = useTransitionOf();
  const { open, close, triggerProps, triggerRef, panelRef, panelId } = usePopover({
    hasPopup: 'dialog',
  });
  const transition = transitionOf(slideId) ?? 'none';
  const label =
    transition === 'none' ? 'Übergang wählen' : `Übergang: ${transitionLabel(transition)}`;
  return (
    <>
      <button
        type="button"
        {...triggerProps}
        aria-label={label}
        title={label}
        className={cn(
          'flex items-center justify-center rounded-full transition-colors',
          tight ? 'size-5' : 'size-6',
          open || transition !== 'none' ? 'text-fg' : 'text-fg-muted hover:text-fg',
        )}
      >
        <Icon name="animation" size={tight ? 'lg' : 'xl'} />
      </button>
      {open && (
        <SlideTransitionPicker
          anchorRef={triggerRef}
          panelRef={panelRef}
          panelId={panelId}
          afterSlideId={afterSlideId}
          slideId={slideId}
          onClose={close}
        />
      )}
    </>
  );
}
