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
  DEAL_MS,
  DEAL_STAGGER,
  hasGhostComment,
  INTRO_MS,
  REVEAL_SLOTS_MAX,
  REVEAL_STAGGER,
  slideSketch,
  slotState,
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
const GHOST_COUNT = 10;
const EASE_OUT = 'cubic-bezier(0.2, 0.9, 0.25, 1)';
const EASE_DEAL = 'cubic-bezier(0.16, 0.92, 0.24, 1.05)';
const EASE_PAN = 'cubic-bezier(0.65, 0, 0.35, 1)';
const SETTLE_TRANSITION = `left 520ms ${EASE_OUT}, width 520ms ${EASE_OUT}, height 520ms ${EASE_OUT}`;

interface ImportStageProps {
  picture: ImportPicture;
  phase: StagePhase;
  /** The real slides' aspect ratios, once loaded – the placeholders settle onto them. */
  aspectRatios: readonly number[] | null;
  /** The status card, docked in the comment area under the first slide (like a comment card). */
  children: ReactNode;
}

/**
 * The deck page while a deck imports: the viewer's own layout – track, minimap, controls row,
 * split handle, comment area – in placeholders, laid out with the timeline's geometry so every
 * placeholder sits exactly where its real counterpart will. Slides are dealt in, riffle while
 * the import looks for them, fill in as they render (the camera following along) and finally
 * dissolve into the real viewer mounted underneath.
 */
export function ImportStage({ picture, phase, aspectRatios, children }: ImportStageProps) {
  const wrapperRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow();
  const motion = !useMediaQuery('(prefers-reduced-motion: reduce)');
  const metrics = useTimelineMetrics(wrapperRef, scrollerRef, controlsRef);
  const [split] = useState(loadStoredSplit);
  const intro = useIntro();
  const morphing = phase !== 'import';
  const real = morphing && aspectRatios !== null;

  // Before the import has counted the slides, ghosts stand in; the extra ones fly off once it has.
  const n = real ? aspectRatios.length : (picture.count ?? GHOST_COUNT);
  const leaving = useLeaving(n);
  const drawn = Math.max(n, leaving?.to ?? 0);

  const ratios = useMemo(
    () => Array.from({ length: drawn }, (_, i) => (real ? aspectRatios[i] : null) ?? DEFAULT_AR),
    [drawn, real, aspectRatios],
  );
  const geometry = useMemo(
    () =>
      metrics &&
      computeTrackGeometry({ aspectRatios: ratios.slice(0, Math.max(1, n)), ...metrics, narrow }),
    [metrics, ratios, n, narrow],
  );
  const slideH = geometry && Math.round(slideHeightAt(narrow ? null : split, geometry));
  const layout = useMemo(() => (slideH ? layoutTrack(ratios, slideH) : null), [ratios, slideH]);
  const clientW = metrics?.clientW ?? 0;

  // The camera keeps the slide being rendered centred; it heads home for the comments and the
  // outro (the real viewer opens at the first slide).
  const focus = !morphing && picture.current > 0 ? picture.current : 0;
  const pan =
    layout && clientW && focus > 0 ? revealScrollLeft(layout, focus, 0, clientW, 'center') : 0;

  const range = layout ? visibleRange(layout, pan, clientW) : { first: 0, last: -1 };
  // Outro order: left to right as seen on screen.
  const firstInView = layout ? visibleRange(layout, pan, clientW, 0).first : 0;
  const revealDelay = (index: number) =>
    Math.min(REVEAL_SLOTS_MAX, Math.max(0, index - firstInView)) * REVEAL_STAGGER;

  const slots = [];
  const lines = [];
  const ghostCards = [];
  for (let i = range.first; layout && i <= range.last; i++) {
    const box = layout.slides[i];
    const gap = layout.gaps[i];
    if (!box || !gap) continue;
    const isLeaving = i >= n;
    const dealDelay = intro ? Math.min(i, 7) * DEAL_STAGGER : 0;
    const state: SlotState = morphing ? 'rendered' : slotState(i, picture);
    slots.push(
      <Slot
        key={i}
        index={i}
        state={state}
        x={box.x}
        w={box.w}
        h={layout.h}
        motion={motion}
        settling={morphing}
        outer={
          phase === 'reveal'
            ? `import-dissolve 560ms ${EASE_OUT} ${revealDelay(i) + 220}ms forwards`
            : isLeaving
              ? `import-leave 520ms ${EASE_OUT} ${(i - n) * 60}ms forwards`
              : motion
                ? `import-deal ${DEAL_MS}ms ${EASE_DEAL} ${dealDelay}ms both`
                : undefined
        }
        riffle={
          motion && state === 'ghost' && !isLeaving && !picture.failed
            ? `import-riffle 3.4s ${EASE_OUT} ${INTRO_MS + 300 + i * 420}ms infinite both`
            : undefined
        }
        sheen={
          phase === 'reveal' ? `import-sheen 760ms ease-in-out ${revealDelay(i)}ms both` : undefined
        }
        printDelay={morphing ? Math.min(i, REVEAL_SLOTS_MAX) * 60 : 0}
        failed={picture.failed}
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
                  : motion
                    ? `import-grow-y 520ms ${EASE_OUT} ${dealDelay + 480}ms both`
                    : undefined,
          }}
        />,
      );
    }
    if ((picture.comments || morphing) && i < n && hasGhostComment(i)) {
      ghostCards.push(
        <GhostComment
          key={i}
          x={box.x}
          w={Math.min(280, box.w)}
          animation={
            phase === 'reveal'
              ? `import-fade-out 280ms ease-out ${revealDelay(i) + 160}ms forwards`
              : `import-pop 420ms ${EASE_DEAL} ${Math.min(i, 6) * 90}ms both`
          }
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
                  morphing={morphing}
                  phase={phase}
                  availableW={clientW - 24}
                  motion={motion}
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
                        animation: `import-pop 400ms ${EASE_OUT} ${CHROME_DELAY + 500}ms both`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            {/* Comment area: the status card under the first slide, ghost comments under others. */}
            <div className={cn('relative px-4 pb-6', narrow ? 'pt-4' : 'pt-12')}>
              <div
                aria-hidden
                className={cn('absolute inset-x-0 top-0', narrow ? 'pt-4' : 'pt-12')}
                style={{
                  transform: `translateX(${-pan}px)`,
                  transition: `transform 900ms ${EASE_PAN}`,
                }}
              >
                {ghostCards}
              </div>
              <div
                className="relative w-full md:max-w-[400px]"
                style={{
                  animation: morphing
                    ? `import-card-out 320ms ${EASE_OUT} forwards`
                    : `import-rise 520ms ${EASE_OUT} ${CHROME_DELAY + 380}ms both`,
                }}
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/** True during the intro – placeholders mounted until then are dealt in one after another. */
function useIntro() {
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(timer);
  }, []);
  return intro;
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
  motion: boolean;
  settling: boolean;
  /** Animation of the whole slot: dealt in, flying off, dissolving. */
  outer: string | undefined;
  /** The ghost loop: lifting off and sliding back in, while the slides are being found. */
  riffle: string | undefined;
  sheen: string | undefined;
  printDelay: number;
  failed: boolean;
}

function Slot({
  index,
  state,
  x,
  w,
  h,
  motion,
  settling,
  outer,
  riffle,
  sheen,
  printDelay,
  failed,
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
    >
      <div
        className={cn(
          'relative size-full overflow-hidden rounded-panel bg-[#101010] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] transition-[filter,opacity] duration-500',
          state === 'ghost' && 'skeleton',
          failed && 'opacity-40 grayscale',
        )}
        style={{
          // Inline animations replace the `skeleton` shimmer – a riffling ghost keeps both.
          animation: riffle
            ? `shimmer 1.6s linear infinite, ${riffle}`
            : current && motion
              ? 'import-glow 1.8s ease-in-out infinite'
              : undefined,
        }}
      >
        {current && (
          <div className="absolute inset-0 opacity-25">
            <Sketch kind={slideSketch(index)} />
          </div>
        )}
        {state === 'rendered' && (
          <div
            className="absolute inset-0 bg-[#1b1b1b]"
            style={{ animation: `import-print 640ms ${EASE_OUT} ${printDelay}ms both` }}
          >
            <Sketch kind={slideSketch(index)} />
          </div>
        )}
        {(current || state === 'rendered') && motion && (
          // The scan line: loops over the slide being rendered, sweeps once as it fills in.
          <div
            key={state}
            className="pointer-events-none absolute inset-0"
            style={{
              animation: current
                ? 'import-scan 1.6s ease-in-out infinite'
                : `import-scan 640ms ${EASE_OUT} ${printDelay}ms both`,
            }}
          >
            <div className="h-px w-full bg-white/70 shadow-[0_0_24px_4px_rgb(255_255_255/0.25)]" />
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
  morphing: boolean;
  phase: StagePhase;
  availableW: number;
  motion: boolean;
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
  morphing,
  phase,
  availableW,
  motion,
}: GhostMinimapProps) {
  const rowH = THUMB_H + 2 * MINIMAP_PAD;
  const mini = layoutMinimap(ratios, Math.max(0, availableW - 2 * MINIMAP_PAD));
  return (
    <div className="relative overflow-hidden" style={{ height: rowH }}>
      {mini.slides.map((box, i) => {
        if (box.x > availableW) return null;
        const state: SlotState = morphing ? 'rendered' : slotState(i, picture);
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
                    : motion
                      ? `import-pop 460ms ${EASE_DEAL} ${CHROME_DELAY + Math.min(i, 16) * 35}ms both`
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
      : `import-rise 520ms ${EASE_OUT} ${CHROME_DELAY + 140 + index * 70}ms both`;
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

function GhostComment({ x, w, animation }: { x: number; w: number; animation: string }) {
  return (
    <div
      className="glass absolute flex flex-col gap-2.5 rounded-panel p-3.5"
      style={{ left: x, width: w, animation }}
    >
      <div className="flex items-center gap-2">
        <span className="size-5 rounded-full bg-white/12" />
        <span className="h-2.5 w-20 rounded-full bg-white/12" />
      </div>
      <span className="h-2.5 w-[85%] rounded-full bg-white/8" />
      <span className="h-2.5 w-[60%] rounded-full bg-white/8" />
    </div>
  );
}
