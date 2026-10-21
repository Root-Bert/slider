import { useMemo, useRef, useState, type ReactNode } from 'react';
import { cn, useIsNarrow, useMediaQuery } from '@/ui';
import { loadStoredBoxMode } from '@/lib/preferences/box-mode';
import { loadStoredSplit } from '@/lib/preferences/split';
import { loadWorkPreferences } from '@/lib/preferences/work-preferences';
import { useTimelineMetrics } from '../timeline/hooks/useTimelineMetrics';
import { MINIMAP_ROW_H } from '../timeline/lib/minimap';
import {
  computeTrackGeometry,
  layoutTrack,
  revealScrollLeft,
  slideHeightAt,
  TRACK_PAD_TOP,
  visibleRange,
} from '../timeline/lib/timeline-layout';
import {
  APPEAR_MS,
  appearDelay,
  DEAL_STAGGER,
  DEALT_MAX,
  LEAVE_MS,
  REVEAL_PLAIN_MS,
  type ImportPicture,
} from './lib/import-skeleton';
import { pickChoreography } from './stage/choreography';
import { GhostControls, GhostHandle, type GhostControlsSetup } from './stage/GhostControls';
import { GhostMinimap } from './stage/GhostMinimap';
import { Slot } from './stage/Slot';
import { EASE_OUT, EASE_PAN, stageSlotState, type StagePhase } from './stage/stage-motion';
import { useIntro, useLeaving, useReach } from './stage/useStageTimers';

export type { StagePhase };

const DEFAULT_AR = 16 / 9;
interface ImportStageProps {
  picture: ImportPicture;
  phase: StagePhase;
  /** The real slides' aspect ratios, once loaded – the placeholders settle onto them. */
  aspectRatios: readonly number[] | null;
  /** The import is done: nothing starts any more, the camera heads home. */
  done: boolean;
  /** What the controls row will offer: rights, and the hidden slides once the viewer's data is in. */
  viewer: Pick<GhostControlsSetup, 'canComment' | 'canUpload' | 'opening'>;
  /** A card docked in the comment area under the first slide (like a comment card) – the error. */
  children?: ReactNode;
  /** The outro's fade into the viewer is over. */
  onDissolved?: () => void;
}

/**
 * The deck page while a deck imports: the viewer's own layout – track, minimap, controls row,
 * split handle, comment area – in placeholders, laid out with the timeline's geometry so every
 * placeholder sits exactly where its real counterpart will. Once the import has counted the
 * slides, one placeholder per slide is dealt in; they fill in as they render (the camera
 * following along). How they move is a choreography picked at random for each import
 * (`stage/choreography.ts`) – all the play happens while the import runs. The outro is calm:
 * the camera home, a moment of rest, then the real slides appear over their placeholders one
 * after another and the stage – by then a copy of the viewer underneath – leaves.
 */
export function ImportStage({
  picture,
  phase,
  aspectRatios,
  done,
  viewer,
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
  const [choreography] = useState(pickChoreography);
  // The viewer opens with the minimap folded away if so set: the stage leaves it out as well.
  const [preferences] = useState(loadWorkPreferences);
  const [boxMode] = useState(loadStoredBoxMode);
  const showMinimap = !preferences.hideMinimap;
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
        // Like the viewer: a hidden minimap's row goes to the slides, not to the comment area.
        controlsH: metrics.controlsH + (showMinimap ? 0 : MINIMAP_ROW_H),
        freedH: showMinimap ? 0 : MINIMAP_ROW_H,
        narrow,
      }),
    [metrics, ratios, n, narrow, showMinimap],
  );
  const slideH = geometry && Math.round(slideHeightAt(narrow ? null : split, geometry));
  const layout = useMemo(() => (slideH ? layoutTrack(ratios, slideH) : null), [ratios, slideH]);
  const clientW = metrics?.clientW ?? 0;

  // The camera keeps the slide at work centred; once the tour is through, or the import done, it
  // glides home (the real viewer opens at the first slide).
  const focus = Math.max(0, picture.current);
  const pan =
    layout && clientW && focus > 0 ? revealScrollLeft(layout, focus, 0, clientW, 'center') : 0;

  const range = layout ? visibleRange(layout, pan, clientW) : { first: 0, last: -1 };
  // Placeholders stay mounted once the camera has passed them: one mounted again would deal in
  // (and print) all over again on its way back home.
  // The dealt hand (the first `DEALT_MAX` slots) is on the track from the start, so each lands on
  // time; slots further on show up as the camera reaches them, already in place.
  const reach = useReach(Math.max(range.last, DEALT_MAX - 1), drawn - 1);

  // Only the slide at work moves, and only while the import runs.
  const playing = motion && phase === 'import' && !done && !picture.failed;
  // The outro: the real slides appear one after another; then the stage leaves.
  const appearing = motion && phase === 'reveal';
  const lastAppear = appearDelay(n - 1);
  const slides = viewer.opening?.slides;
  const slots = [];
  for (let i = 0; layout && i <= reach; i++) {
    const box = layout.slides[i];
    if (!box) continue;
    const isLeaving = i >= n;
    const deals = motion && i < DEALT_MAX;
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
        deal={deals ? { delay: intro ? i * DEAL_STAGGER : 0 } : null}
        leave={isLeaving ? `import-leave 520ms ${EASE_OUT} ${(i - n) * 60}ms forwards` : undefined}
        failed={picture.failed}
        playing={playing}
        real={slides?.[i] ?? null}
        appear={appearing ? appearDelay(i) : null}
      />,
    );
  }

  const setup: GhostControlsSetup = {
    ...viewer,
    boxMode,
    showGuides: preferences.showGuides,
    showHiddenSlides: viewer.opening?.showHiddenSlides ?? preferences.showHiddenSlides,
    statusFilter: preferences.statusFilter,
    showMinimap,
  };

  return (
    <div
      data-import-anim={choreography}
      className={cn(
        'fixed inset-0 z-(--z-stage) flex flex-col overflow-hidden text-fg',
        phase === 'reveal' && 'pointer-events-none',
      )}
      // The outro: once the last slide has appeared the stage leaves (without motion: a plain cross-fade).
      style={{
        animation:
          phase !== 'reveal'
            ? undefined
            : appearing
              ? `import-fade-out ${LEAVE_MS}ms ease-out ${lastAppear + APPEAR_MS}ms forwards`
              : `import-fade-out ${REVEAL_PLAIN_MS}ms var(--ease-symmetric) forwards`,
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === 'import-fade-out')
          onDissolved?.();
      }}
    >
      <div aria-hidden className="dot-grid absolute inset-0" />
      <main ref={wrapperRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollerRef}
          className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--color-surface-4)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
        >
          <div className="relative min-h-full">
            {/* The track's band is opaque like the viewer's – the dot grid starts below it. */}
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 bg-canvas"
              style={{
                height: TRACK_PAD_TOP + (slideH ?? 0),
                transition: morphing ? `height 520ms ${EASE_OUT}` : undefined,
              }}
            />
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
                  {slots}
                </div>
              </div>
            </div>
            {/* Minimap, controls row and split handle: the timeline's band, same heights and
                edges – the handle sits centred in the controls row, behind its pills. */}
            <div ref={controlsRef} aria-hidden inert className="pt-2 pb-2 @container">
              {showMinimap && (
                <div className="px-3">
                  <GhostMinimap
                    ratios={ratios}
                    count={n}
                    picture={picture}
                    availableW={clientW - 24}
                    real={real}
                    wave={playing && !intro}
                    popIn={motion && intro}
                    slides={slides}
                    appearing={appearing}
                  />
                </div>
              )}
              <div className="relative px-4 pt-2">
                {!narrow && (
                  <div className="absolute inset-x-0 top-2 bottom-0 flex items-center justify-center">
                    <GhostHandle />
                  </div>
                )}
                <div className="relative">
                  <GhostControls count={picture.count ?? (real ? n : null)} setup={setup} />
                </div>
              </div>
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
