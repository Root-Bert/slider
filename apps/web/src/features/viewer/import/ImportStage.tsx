import { useMemo, useRef, useState, type ReactNode } from 'react';
import { cn, useIsNarrow, useMediaQuery } from '@/ui';
import { loadStoredSplit } from '@/lib/preferences/split';
import { useTimelineMetrics } from '../timeline/hooks/useTimelineMetrics';
import {
  computeTrackGeometry,
  layoutTrack,
  revealScrollLeft,
  slideHeightAt,
  TRACK_PAD_TOP,
  visibleRange,
} from '../timeline/lib/timeline-layout';
import {
  CONTROLS_DELAY,
  DEALT_MAX,
  DEAL_MS,
  DEAL_STAGGER,
  REVEAL_SLOTS_MAX,
  REVEAL_STAGGER,
  type ImportPicture,
} from './lib/import-skeleton';
import { GhostControls } from './stage/GhostControls';
import { GhostMinimap } from './stage/GhostMinimap';
import { Slot } from './stage/Slot';
import {
  EASE_DEAL,
  EASE_OUT,
  EASE_PAN,
  SETTLE_TRANSITION,
  stageSlotState,
  type StagePhase,
} from './stage/stage-motion';
import { STAGE_TONE } from './stage/stage-tones';
import { useIntro, useLeaving, useReach } from './stage/useStageTimers';

export type { StagePhase };

const DEFAULT_AR = 16 / 9;
interface ImportStageProps {
  picture: ImportPicture;
  phase: StagePhase;
  /** The real slides' aspect ratios, once loaded – the placeholders settle onto them. */
  aspectRatios: readonly number[] | null;
  /** A card docked in the comment area under the first slide (like a comment card) – the error. */
  children?: ReactNode;
  /** The outro's last placeholder in view has dissolved. */
  onDissolved?: () => void;
}

/**
 * The deck page while a deck imports: the viewer's own layout – track, minimap, controls row,
 * split handle, comment area – in placeholders, laid out with the timeline's geometry so every
 * placeholder sits exactly where its real counterpart will. Once the import has counted the
 * slides, one placeholder per slide is dealt in; they fill in as they render (the camera
 * following along) and finally dissolve, one after another, into the real viewer underneath.
 */
export function ImportStage({
  picture,
  phase,
  aspectRatios,
  children,
  onDissolved,
}: ImportStageProps) {
  const wrapperRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow();
  const motion = !useMediaQuery('(prefers-reduced-motion: reduce)');
  const metrics = useTimelineMetrics(wrapperRef, scrollerRef, controlsRef);
  const [split] = useState(loadStoredSplit);
  const morphing = phase !== 'import';
  const real = morphing && aspectRatios !== null;

  // Until the import has counted the slides, a single ghost stands in for the first one (dealt
  // in right away, while the page cross-fades in); then exactly one placeholder per slide.
  const n = real ? aspectRatios.length : (picture.count ?? 1);
  const intro = useIntro(real || picture.count !== null);
  const leaving = useLeaving(n);
  const drawn = Math.max(n, leaving?.to ?? 0);

  const ratios = useMemo(
    () => Array.from({ length: drawn }, (_, i) => (real ? aspectRatios[i] : null) ?? DEFAULT_AR),
    [drawn, real, aspectRatios],
  );
  const geometry = useMemo(
    () =>
      metrics &&
      computeTrackGeometry({
        aspectRatios: n > 0 ? ratios.slice(0, n) : [DEFAULT_AR],
        ...metrics,
        narrow,
      }),
    [metrics, ratios, n, narrow],
  );
  const slideH = geometry && Math.round(slideHeightAt(narrow ? null : split, geometry));
  const layout = useMemo(() => (slideH ? layoutTrack(ratios, slideH) : null), [ratios, slideH]);
  const clientW = metrics?.clientW ?? 0;

  // The camera keeps the slide being printed centred; once all have printed it heads home for
  // the outro (the real viewer opens at the first slide).
  const focus = Math.max(0, picture.current);
  const pan =
    layout && clientW && focus > 0 ? revealScrollLeft(layout, focus, 0, clientW, 'center') : 0;

  const range = layout ? visibleRange(layout, pan, clientW) : { first: 0, last: -1 };
  // Placeholders stay mounted once the camera has passed them: one mounted again would deal in
  // (and print) all over again on its way back home.
  // The dealt hand (the first `DEALT_MAX` slots) is on the track from the start, so each lands on
  // time; slots further on show up as the camera reaches them, already in place.
  const reach = useReach(Math.max(range.last, DEALT_MAX - 1), drawn - 1);
  // Outro order: left to right as seen on screen.
  const firstInView = layout ? visibleRange(layout, pan, clientW, 0).first : 0;
  const revealDelay = (index: number) =>
    Math.min(REVEAL_SLOTS_MAX, Math.max(0, index - firstInView)) * REVEAL_STAGGER;
  // The outro ends when the last placeholder in view has dissolved (later ones share its delay).
  const lastInView = Math.min(range.last, n - 1);

  const slots = [];
  const lines = [];
  for (let i = 0; layout && i <= reach; i++) {
    const box = layout.slides[i];
    const gap = layout.gaps[i];
    if (!box || !gap) continue;
    const isLeaving = i >= n;
    const deals = motion && i < DEALT_MAX;
    const dealDelay = intro ? i * DEAL_STAGGER : 0;
    const state = stageSlotState(i, picture, real);
    slots.push(
      <Slot
        key={i}
        index={i}
        state={state}
        x={box.x}
        w={box.w}
        h={layout.h}
        settling={morphing}
        outer={
          phase === 'reveal'
            ? `import-dissolve 640ms ${EASE_OUT} ${revealDelay(i) + 220}ms forwards`
            : isLeaving
              ? `import-leave 520ms ${EASE_OUT} ${(i - n) * 60}ms forwards`
              : deals
                ? `import-deal ${DEAL_MS}ms ${EASE_DEAL} ${dealDelay}ms both`
                : undefined
        }
        sheen={
          phase === 'reveal' ? `import-sheen 760ms ease-in-out ${revealDelay(i)}ms both` : undefined
        }
        failed={picture.failed}
        onDissolved={phase === 'reveal' && i === lastInView ? onDissolved : undefined}
      />,
    );
    {
      lines.push(
        <span
          key={i}
          className={cn('absolute top-0 w-px origin-center', STAGE_TONE.gapLine)}
          style={{
            left: gap.x + Math.floor(gap.w / 2),
            height: layout.h,
            transition: morphing ? SETTLE_TRANSITION : undefined,
            animation:
              phase === 'reveal'
                ? `import-fade-out 300ms ease-out ${revealDelay(i) + 200}ms forwards`
                : isLeaving
                  ? 'import-fade-out 200ms ease-out forwards'
                  : deals
                    ? `import-grow-y 680ms ${EASE_OUT} ${dealDelay + 620}ms both`
                    : undefined,
          }}
        />,
      );
    }
  }

  const fadeOut = (delay: number, ms = 320) =>
    phase === 'reveal' ? `import-fade-out ${ms}ms ease-out ${delay}ms forwards` : undefined;

  return (
    <div
      className={cn(
        'fixed inset-0 z-(--z-stage) flex flex-col overflow-hidden text-fg',
        phase === 'reveal' && 'pointer-events-none',
      )}
    >
      <div
        aria-hidden
        className="dot-grid absolute inset-0"
        style={{ animation: fadeOut(260, 520) }}
      />
      <main ref={wrapperRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollerRef}
          className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--color-surface-4)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
        >
          <div className="relative min-h-full">
            {/* Track: placeholders on the real slides' spots; the inner layer is the camera. */}
            <div aria-hidden style={{ paddingTop: TRACK_PAD_TOP }}>
              <div
                className="relative"
                style={{
                  height: slideH ?? 0,
                  transition: morphing ? `height 520ms ${EASE_OUT}` : undefined,
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    transform: `translateX(${-pan}px)`,
                    transition: `transform 900ms ${EASE_PAN}`,
                  }}
                >
                  {lines}
                  {slots}
                </div>
              </div>
            </div>
            {/* Minimap, controls row and split handle: the timeline's band, same heights. */}
            <div ref={controlsRef} aria-hidden className="pt-2 max-md:pb-2">
              <div className="px-3">
                <GhostMinimap
                  ratios={ratios}
                  count={n}
                  picture={picture}
                  phase={phase}
                  availableW={clientW - 24}
                  motion={motion}
                  real={real}
                  wave={motion && !intro && !picture.failed}
                />
              </div>
              <div className="px-4 pt-2">
                <GhostControls count={picture.count ?? (real ? n : null)} phase={phase} />
              </div>
              {!narrow && (
                <div className="pt-1" style={{ animation: fadeOut(120) }}>
                  <div className="flex h-3 items-center justify-center">
                    <span
                      className={cn('h-1 w-10 rounded-full', STAGE_TONE.handle)}
                      style={{
                        animation: `import-pop 520ms ${EASE_OUT} ${CONTROLS_DELAY + 420}ms both`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            {/* Comment area: the status card under the first slide. Comments come in only once the viewer is up. */}
            <div className={cn('relative px-4 pb-6', narrow ? 'pt-4' : 'pt-12')}>
              {children && (
                <div
                  className="relative w-full md:max-w-[400px]"
                  style={{
                    animation: morphing
                      ? `import-card-out 320ms ${EASE_OUT} forwards`
                      : `import-rise 520ms ${EASE_OUT} 120ms both`,
                  }}
                >
                  {children}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
