import { cn } from '@/ui';
import { PRINT_MS, slideSketch, type SlotState } from '../lib/import-skeleton';
import { Sketch } from './SlideSketch';
import { EASE_OUT, SETTLE_TRANSITION } from './stage-motion';

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
          'relative size-full overflow-hidden rounded-panel bg-[#101010] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] transition-[filter,opacity] duration-500',
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
            className="absolute inset-0 bg-[#1b1b1b]"
            style={{ animation: `import-print ${PRINT_MS}ms ${EASE_OUT} both` }}
          >
            <Sketch kind={slideSketch(index)} />
          </div>
        )}
        {sheen && (
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_30%,rgb(255_255_255/0.22)_50%,transparent_70%)]"
            style={{ animation: sheen }}
          />
        )}
      </div>
    </div>
  );
}
