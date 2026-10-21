import type { Slide } from '@slider/shared';
import type { CSSProperties } from 'react';
import { cn } from '@/ui';
import { slideSrcSet, THUMB_MAX_W } from '../../stage/lib/slide-image';
import { APPEAR_MS, slideSketch, type SlotState } from '../lib/import-skeleton';
import { Sketch } from './SlideSketch';
import { SETTLE_TRANSITION } from './stage-motion';
import { STAGE_TONE } from './stage-tones';

interface SlotProps {
  index: number;
  state: SlotState;
  x: number;
  w: number;
  h: number;
  settling: boolean;
  /** Dealt in by the stage's choreography (CSS, `[data-deal]`), this long after the first slot. */
  deal: { delay: number } | null;
  /** Flying off the track (the count shrank): overrides the deal. */
  leave: string | undefined;
  failed: boolean;
  /** Motion is on and the import runs: the slot at work makes its gesture. */
  playing: boolean;
  /** The real slide, once the viewer has its data – loaded, hidden, until it appears. */
  real: Slide | null;
  /** The outro: the real slide appears over the placeholder, this long after the first. */
  appear: number | null;
}

/**
 * One slide placeholder. Waiting for its turn it is an empty card. When its turn comes the card
 * makes the choreography's gesture (`data-working`) and its sketch builds up (`data-sketch`),
 * once; then it stays as it is – printing only fades the card's fill. Only the slot at work moves.
 * How it moves is the choreography's (index.css). In the outro the real slide appears over it,
 * exactly as the viewer underneath shows it.
 */
export function Slot({
  index,
  state,
  x,
  w,
  h,
  settling,
  deal,
  leave,
  failed,
  playing,
  real,
  appear,
}: SlotProps) {
  // Before the import has counted the slides, the one ghost slot is already at work on a title slide.
  const atWork = state === 'current' || state === 'ghost';
  return (
    <div
      data-deal={deal && !leave ? '' : undefined}
      className="absolute top-0"
      style={
        {
          left: x,
          width: w,
          height: h,
          animation: leave,
          transition: settling ? SETTLE_TRANSITION : undefined,
          '--i': index,
          '--deal-delay': deal ? `${deal.delay}ms` : undefined,
        } as CSSProperties
      }
    >
      <div
        data-working={playing && atWork ? '' : undefined}
        className={cn(
          'relative size-full overflow-hidden rounded-panel transition-[filter,opacity,background-color] duration-500',
          STAGE_TONE.slot,
          state === 'rendered' ? STAGE_TONE.slotPrinted : STAGE_TONE.slotFill,
          failed && 'opacity-40 grayscale',
        )}
      >
        {/* Mounted when the slot's turn comes and kept: its pieces build up once, then stay. */}
        {state !== 'pending' && (
          <div data-sketch className="absolute inset-0">
            <Sketch kind={slideSketch(index)} />
          </div>
        )}
      </div>
      {real && (
        // The same image the viewer shows (same source and size), so the stage can leave
        // without a seam once every slide has appeared.
        <div
          className={cn(
            'absolute inset-0 overflow-hidden bg-placeholder',
            w < THUMB_MAX_W ? 'rounded-thumb' : 'rounded-panel',
          )}
          style={{
            opacity: appear !== null ? 1 : 0,
            transition: appear !== null ? `opacity ${APPEAR_MS}ms ease-out ${appear}ms` : undefined,
          }}
        >
          <img
            src={w < THUMB_MAX_W ? real.thumbnailUrl : real.imageUrl}
            {...slideSrcSet(real, w)}
            alt=""
            decoding="async"
            draggable={false}
            className={cn('size-full object-contain', real.hidden && 'opacity-40')}
          />
        </div>
      )}
    </div>
  );
}
