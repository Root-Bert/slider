import { cn } from '@/ui';
import { PRINT_MS, slideSketch, type SlotState } from '../lib/import-skeleton';
import { Sketch } from './SlideSketch';
import { EASE_OUT, SETTLE_TRANSITION } from './stage-motion';
import { STAGE_TONE } from './stage-tones';

interface SlotProps {
  index: number;
  state: SlotState;
  x: number;
  w: number;
  h: number;
  settling: boolean;
  /** Animation of the whole slot: dealt in, flying off, dissolving. */
  outer: string | undefined;
  sheen: string | undefined;
  failed: boolean;
  onDissolved: (() => void) | undefined;
}

export function Slot({
  index,
  state,
  x,
  w,
  h,
  settling,
  outer,
  sheen,
  failed,
  onDissolved,
}: SlotProps) {
  const current = state === 'current';
  return (
    <div
      className="absolute top-0"
      style={{
        left: x,
        width: w,
        height: h,
        animation: outer,
        transition: settling ? SETTLE_TRANSITION : undefined,
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === 'import-dissolve')
          onDissolved?.();
      }}
    >
      <div
        className={cn(
          'relative size-full overflow-hidden rounded-panel transition-[filter,opacity] duration-500',
          STAGE_TONE.slot,
          state === 'ghost' && 'skeleton',
          failed && 'opacity-40 grayscale',
        )}
      >
        {current && (
          <div className="absolute inset-0 opacity-25">
            <Sketch kind={slideSketch(index)} />
          </div>
        )}
        {state === 'rendered' && (
          <div
            className={cn('absolute inset-0', STAGE_TONE.slotPrinted)}
            style={{ animation: `import-print ${PRINT_MS}ms ${EASE_OUT} both` }}
          >
            <Sketch kind={slideSketch(index)} />
          </div>
        )}
        {sheen && (
          <div
            className={cn('pointer-events-none absolute inset-0', STAGE_TONE.sheen)}
            style={{ animation: sheen }}
          />
        )}
      </div>
    </div>
  );
}
