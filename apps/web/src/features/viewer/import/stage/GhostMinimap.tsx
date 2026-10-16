import { cn } from '@/ui';
import { layoutMinimap, MINIMAP_PAD, THUMB_H } from '../../timeline/lib/minimap';
import {
  CHROME_DELAY,
  WAVE_MS,
  WAVE_STAGGER,
  type ImportPicture,
  type SlotState,
} from '../lib/import-skeleton';
import { EASE_DEAL, EASE_OUT, stageSlotState, type StagePhase } from './stage-motion';
import { STAGE_TONE } from './stage-tones';

interface GhostMinimapProps {
  ratios: readonly number[];
  /** Thumbnails past the count are leaving. */
  count: number;
  picture: ImportPicture;
  phase: StagePhase;
  availableW: number;
  motion: boolean;
  real: boolean;
  /** The intro has played: the thumbnails bounce in a wave while the import runs. */
  wave: boolean;
}

const THUMB_STYLE: Record<SlotState, string> = {
  ghost: 'skeleton',
  pending: STAGE_TONE.thumbPending,
  current: STAGE_TONE.thumbCurrent,
  rendered: STAGE_TONE.thumbRendered,
};

/** The minimap's thumbnails: one per slide, lighting up as the slides render. */
export function GhostMinimap({
  ratios,
  count,
  picture,
  phase,
  availableW,
  motion,
  real,
  wave,
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
                phase === 'reveal'
                  ? `import-fade-out 260ms ease-out ${120 + Math.min(i, 16) * 22}ms forwards`
                  : i >= count
                    ? `import-leave 480ms ${EASE_OUT} ${(i - count) * 50}ms forwards`
                    : wave
                      ? `import-wave ${WAVE_MS}ms ease-in-out ${(i * WAVE_STAGGER) % WAVE_MS}ms infinite`
                      : motion
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
          </span>
        );
      })}
    </div>
  );
}
