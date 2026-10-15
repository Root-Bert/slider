import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn, GlassPanel } from '@/ui';
import { useIsNarrow, useMediaQuery } from '@/features/viewer/hooks/useMediaQuery';
import { useTimelineMetrics } from '@/features/viewer/hooks/useTimelineMetrics';
import { layoutMinimap, MINIMAP_PAD, THUMB_H } from '@/features/viewer/lib/minimap';
import { loadStoredSplit } from '@/features/viewer/lib/split';
import {
  computeTrackGeometry,
  layoutTrack,
  revealScrollLeft,
  slideHeightAt,
  TRACK_PAD_TOP,
  visibleRange,
} from '@/features/viewer/lib/timeline-layout';
import {
  CHROME_DELAY,
  CONTROLS_DELAY,
  DEALT_MAX,
  DEAL_MS,
  DEAL_STAGGER,
  INTRO_MS,
  PRINT_MS,
  REVEAL_SLOTS_MAX,
  REVEAL_STAGGER,
  slideSketch,
  slotState,
  WAVE_MS,
  WAVE_STAGGER,
  type ImportPicture,
  type SlideSketch,
  type SlotState,
} from '../lib/import-skeleton';

/**
 * `import`: the deck is importing. `settle`: the slides are loaded and the viewer is mounting
 * underneath – the placeholders take the real slides' sizes and the camera pans home. `reveal`:
 * the placeholders dissolve, one after another, into the real slides right under them.
 */
export type StagePhase = 'import' | 'settle' | 'reveal';

const DEFAULT_AR = 16 / 9;
const EASE_OUT = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
const EASE_DEAL = 'cubic-bezier(0.16, 0.92, 0.24, 1.05)';
const EASE_PAN = 'cubic-bezier(0.65, 0, 0.35, 1)';
const SETTLE_TRANSITION = `left 520ms ${EASE_OUT}, width 520ms ${EASE_OUT}, height 520ms ${EASE_OUT}`;

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
          className="absolute top-0 w-px origin-center bg-white/15"
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
        'fixed inset-0 z-[60] flex flex-col overflow-hidden text-fg',
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
          className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:rgb(255_255_255/0.2)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
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
                      className="h-1 w-10 rounded-full bg-white/25"
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

/**
 * A slot's state on the stage. Once the viewer's data is in (`real`), slides past the import's
 * count (it was off) have nothing left to print.
 */
function stageSlotState(index: number, picture: ImportPicture, real: boolean): SlotState {
  if (real && picture.count !== null && index >= picture.count) return 'rendered';
  return slotState(index, picture);
}

/** True until the intro, starting once `started`, has played – placeholders mounted until then are dealt in one after another. */
function useIntro(started: boolean) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!started) return;
    const timer = setTimeout(() => setDone(true), INTRO_MS);
    return () => clearTimeout(timer);
  }, [started]);
  return !done;
}

/** The highest index `last` has reached, up to `max` (the track's last slot). */
function useReach(last: number, max: number) {
  const [reach, setReach] = useState(-1);
  const next = Math.min(Math.max(reach, last), max);
  if (next !== reach) setReach(next);
  return next;
}

/** Slots past a shrunken count stay a moment to fly off the track. */
function useLeaving(n: number) {
  const [shown, setShown] = useState(n);
  const [leaving, setLeaving] = useState<{ to: number } | null>(null);
  if (n !== shown) {
    setShown(n);
    setLeaving(n < shown ? { to: shown } : null);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), 700);
    return () => clearTimeout(timer);
  }, [leaving]);
  return leaving;
}

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

function Slot({ index, state, x, w, h, settling, outer, sheen, failed, onDissolved }: SlotProps) {
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

const BAR = 'absolute rounded-[3px] bg-white/[0.13]';
const SOFT = 'absolute rounded-[3px] bg-white/[0.07]';
const pct = (left: number, top: number, width: number, height: number): CSSProperties => ({
  left: `${left}%`,
  top: `${top}%`,
  width: `${width}%`,
  height: `${height}%`,
});

/** Abstract slide content, in % of the slide so it scales with the track. */
function Sketch({ kind }: { kind: SlideSketch }) {
  const title = <span className={BAR} style={pct(7, 10, 44, 7)} />;
  switch (kind) {
    case 'cover':
      return (
        <>
          <span className={BAR} style={pct(24, 38, 52, 9)} />
          <span className={SOFT} style={pct(32, 53, 36, 4)} />
        </>
      );
    case 'bullets':
      return (
        <>
          {title}
          {[64, 52, 70, 42].map((width, i) => (
            <span key={i}>
              <span
                className="absolute rounded-full bg-white/[0.13]"
                style={pct(8, 31.5 + i * 12, 1.6, 2.8)}
              />
              <span className={SOFT} style={pct(12, 31 + i * 12, width, 3.8)} />
            </span>
          ))}
        </>
      );
    case 'chart':
      return (
        <>
          {title}
          {[26, 38, 32, 50, 44, 60].map((height, i) => (
            <span key={i} className={BAR} style={pct(8 + i * 7.4, 86 - height, 5, height)} />
          ))}
          {[30, 24, 28].map((width, i) => (
            <span key={i} className={SOFT} style={pct(60, 34 + i * 11, width, 3.8)} />
          ))}
        </>
      );
    case 'columns':
      return (
        <>
          {title}
          {[7, 52].map((left) => (
            <span key={left} className={SOFT} style={pct(left, 28, 41, 60)} />
          ))}
          {[7, 52].map((left) => (
            <span key={left} className={BAR} style={pct(left + 4, 36, 22, 5)} />
          ))}
        </>
      );
  }
}

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
  pending: 'bg-[#141414]',
  current: 'bg-[#1c1c1c] shadow-[0_0_0_1px_rgb(255_255_255/0.35)]',
  rendered: 'bg-[#2a2a2a]',
};

/** The minimap's thumbnails: one per slide, lighting up as the slides render. */
function GhostMinimap({
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
              <span className="absolute top-[22%] left-[12%] h-[12%] w-[46%] rounded-[2px] bg-white/15" />
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Controls row in outline: tool bar, filter, upload – and the slide counter, already counting. */
function GhostControls({ count, phase }: { count: number | null; phase: StagePhase }) {
  const rise = (index: number) =>
    phase === 'reveal'
      ? `import-fade-out 300ms ease-out ${180 + index * 40}ms forwards`
      : `import-rise 680ms ${EASE_OUT} ${CONTROLS_DELAY + index * 80}ms both`;
  return (
    <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
      <GlassPanel
        className="flex h-10 w-[265px] shrink-0 items-center p-1"
        style={{ animation: rise(0) }}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <GhostIcon key={i} className={i === 5 ? 'ml-2' : undefined} />
        ))}
      </GlassPanel>
      <GlassPanel
        className="flex h-10 w-[360px] max-w-full min-w-0 items-center gap-3 px-3"
        style={{ animation: rise(1) }}
      >
        {[52, 64, 72].map((width, i) => (
          <span key={i} className="h-3 shrink-0 rounded-full bg-white/10" style={{ width }} />
        ))}
      </GlassPanel>
      <GlassPanel className="flex size-10 shrink-0 items-center p-1" style={{ animation: rise(2) }}>
        <GhostIcon />
      </GlassPanel>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <GlassPanel
          className="flex h-10 shrink-0 items-center gap-2 py-1 pr-4 pl-1 text-base leading-5 tabular-nums max-md:pr-3"
          style={{ animation: rise(3) }}
        >
          <span className="flex h-8 min-w-8 items-center justify-center px-1.5 text-fg-muted">
            1
          </span>
          <span className="text-fg-subtle">/</span>
          {count === null ? (
            <span className="skeleton h-3 w-4 rounded-full" />
          ) : (
            <span key={count} className="animate-pop-in text-fg-muted">
              {count}
            </span>
          )}
        </GlassPanel>
        <GlassPanel className="flex h-10 w-[76px] items-center p-1" style={{ animation: rise(4) }}>
          <GhostIcon />
          <GhostIcon />
        </GlassPanel>
      </div>
    </div>
  );
}

function GhostIcon({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center', className)}>
      <span className="size-4 rounded-[5px] bg-white/10" />
    </span>
  );
}
