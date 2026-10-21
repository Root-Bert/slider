import type { Slide } from '@slider/shared';
import { cn } from '@/ui';
import { layoutMinimap, MINIMAP_PAD, THUMB_H } from '../../timeline/lib/minimap';
import {
  APPEAR_MS,
  appearDelay,
  CHROME_DELAY,
  WAVE_MS,
  type ImportPicture,
  type SlotState,
} from '../lib/import-skeleton';
import { EASE_DEAL, EASE_OUT, stageSlotState } from './stage-motion';
import { STAGE_TONE } from './stage-tones';

interface GhostMinimapProps {
  ratios: readonly number[];
  /** Thumbnails past the count are leaving. */
  count: number;
  picture: ImportPicture;
  availableW: number;
  real: boolean;
  /** The intro has played and the import runs: the thumbnail of the slide at work bounces. */
  wave: boolean;
  /** The intro plays: the thumbnails pop in. */
  popIn: boolean;
  /** The real slides, once the viewer has its data: their thumbnails are loaded, hidden … */
  slides: readonly Slide[] | undefined;
  /** … and appear one after another, each with its slide on the track. */
  appearing: boolean;
}

const THUMB_STYLE: Record<SlotState, string> = {
  ghost: STAGE_TONE.thumbPending,
  pending: STAGE_TONE.thumbPending,
  current: STAGE_TONE.thumbCurrent,
  rendered: STAGE_TONE.thumbRendered,
};

/** The minimap's thumbnails: one per slide, lighting up as the slides render. */
export function GhostMinimap({
  ratios,
  count,
  picture,
  availableW,
  real,
  wave,
  popIn,
  slides,
  appearing,
}: GhostMinimapProps) {
  const rowH = THUMB_H + 2 * MINIMAP_PAD;
  const mini = layoutMinimap(ratios, Math.max(0, availableW - 2 * MINIMAP_PAD));
  return (
    <div className="relative overflow-hidden" style={{ height: rowH }}>
      {mini.slides.map((box, i) => {
        if (box.x > availableW) return null;
        const state = stageSlotState(i, picture, real);
        return (
          <span
            key={i}
            className={cn(
              'absolute overflow-hidden rounded-thumb transition-colors duration-500',
              THUMB_STYLE[state],
            )}
            style={{
              left: MINIMAP_PAD + box.x,
              top: MINIMAP_PAD,
              width: box.w,
              height: mini.h,
              animation:
                i >= count
                  ? `import-leave 480ms ${EASE_OUT} ${(i - count) * 50}ms forwards`
                  : wave && state === 'current'
                    ? `import-wave ${WAVE_MS}ms ease-in-out infinite`
                    : // Popping in is the intro's only: played again later (a thumbnail done
                      // waving) it would start from transparent and flash.
                      popIn
                      ? `import-pop 600ms ${EASE_DEAL} ${CHROME_DELAY + Math.min(i, 16) * 50}ms both`
                      : undefined,
            }}
          >
            {state === 'rendered' && (
              <span
                className={cn(
                  'absolute top-[22%] left-[12%] h-[12%] w-[46%] rounded-mark',
                  STAGE_TONE.thumbSketch,
                )}
              />
            )}
            {slides?.[i] && (
              // The viewer's thumbnail, as its minimap shows it.
              <img
                src={slides[i].thumbnailUrl}
                alt=""
                decoding="async"
                draggable={false}
                className={cn(
                  'absolute inset-0 size-full bg-placeholder object-cover',
                  !appearing ? 'opacity-0' : slides[i].hidden ? 'opacity-40' : 'opacity-100',
                )}
                style={{
                  transition: appearing
                    ? `opacity ${APPEAR_MS}ms ease-out ${appearDelay(i)}ms`
                    : undefined,
                }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
