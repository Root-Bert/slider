import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { InstanceHistory } from '@slider/shared';
import { cn } from '@/ui';
import { linePaths, spread } from '../lib/line';
import { useSidewaysWheel } from '../hooks/useSidewaysWheel';
import { formatDay } from '@/lib/format';
import { windowSpan, type Metric } from '../lib/period';
import type { TimeWindow } from '../hooks/useTimeWindow';

const HEIGHT = 44;
/**
 * The line stays this far above the bottom, at least the strip's corner radius: lower, a flat
 * line runs into the rounded corners and makes them look square.
 */
const BOTTOM_ROOM = 12;
/** The frame stands this far out around the strip's content, like the minimap's bracket. */
const OUTSET = 3;
const VIEW_WIDTH = 1000;
/** A frame narrower than this is hard to grab: a day out of years. */
const MIN_FRAME_PX = 16;

/**
 * The whole history under the chart, like the viewer's minimap under the track: a faint line of
 * everything since the first account, and a frame around the window the chart shows – clear
 * inside, dimmed outside. Drag the frame (or press beside it) to move the window; scrolling
 * sideways moves it too. Arrow keys move it by a stretch, Page keys by a whole window, Home and End
 * to the start and to now. Where it may go is the window's business (`useTimeWindow`); the strip
 * only turns pixels into time.
 */
export function HistoryStrip({
  history,
  metric,
  view,
}: {
  history: InstanceHistory;
  metric: Metric;
  /** The chart's window: where the frame is, and how it moves. */
  view: TimeWindow;
}) {
  const washId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; grab: number } | null>(null);
  const { domainStart, liveEnd, end, windowMs, stepMs, moveTo } = view;

  const span = liveEnd - domainStart;
  /** Share of the strip, 0–100. */
  const x = (at: number) => ((at - domainStart) / span) * 100;
  const frameLeft = x(end - windowMs);
  const frameWidth = x(end) - frameLeft;

  // The history as a faint line over time, from its first stretch to now and on to the strip's
  // right edge (the window's end rounds up past now); before it began the strip stays empty.
  // Drawn on a 1000-wide canvas stretched to the strip; the strokes keep their width.
  const at = (time: number) => ((time - domainStart) / span) * VIEW_WIDTH;
  const values = history.buckets.map((bucket) => bucket[metric]);
  const max = Math.max(...values, 1);
  const historyStart = at(Date.parse(history.from));
  const points = spread(
    values,
    at(Date.parse(history.to)) - historyStart,
    (value) => HEIGHT - BOTTOM_ROOM - (value / max) * (HEIGHT - BOTTOM_ROOM - 8),
  ).map((point) => ({ ...point, x: point.x + historyStart }));
  const latest = points.at(-1);
  if (latest && latest.x < VIEW_WIDTH) points.push({ x: VIEW_WIDTH, y: latest.y });
  const { line, area } = linePaths(points, HEIGHT, 4);

  // Sideways over the strip: the frame moves along, at the strip's scale.
  const stripRef = useSidewaysWheel<HTMLDivElement>((px, width) => view.pan((px / width) * span));
  const atPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return domainStart + ((event.clientX - box.left) / box.width) * span;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const pointer = atPointer(event);
    // On the frame as drawn (a short window's frame is wider than its time): drag it from there.
    // Beside it: the window jumps there (centred), then drags on from there.
    const inside = event.target === frameRef.current;
    const grab = inside ? end - pointer : windowMs / 2;
    if (!inside) moveTo(pointer + grab);
    drag.current = { pointerId: event.pointerId, grab };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.grab = 'drag';
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    moveTo(atPointer(event) + current.grab);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    delete event.currentTarget.dataset.grab;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, number> = {
      ArrowLeft: -stepMs,
      ArrowRight: stepMs,
      PageUp: -windowMs,
      PageDown: windowMs,
    };
    if (event.key in by) moveTo(end + (by[event.key] ?? 0));
    else if (event.key === 'Home') moveTo(domainStart + windowMs);
    else if (event.key === 'End') view.follow();
    else return;
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={stripRef}
        className={cn(
          'relative cursor-pointer touch-none overflow-hidden rounded-control-sm bg-well-dark select-none',
          'data-[grab=drag]:cursor-grabbing',
        )}
        style={{ height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <svg
          aria-hidden
          viewBox={`0 0 ${VIEW_WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
        >
          <defs>
            {/* The wash fades out downwards, so the corners stay the strip's own. */}
            <linearGradient id={washId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--color-fg)" stopOpacity={0.08} />
              <stop offset="1" stopColor="var(--color-fg)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${washId})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--color-fg-subtle)"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          ref={frameRef}
          role="slider"
          tabIndex={0}
          aria-label="Zeitraum verschieben"
          aria-valuemin={domainStart + windowMs}
          aria-valuemax={liveEnd}
          aria-valuenow={end}
          aria-valuetext={windowSpan(end - windowMs, end)}
          onKeyDown={onKeyDown}
          // A window onto the history: clear inside, everything outside dimmed by the shadow's
          // spread (the strip clips it) – the minimap's bracket.
          className="absolute cursor-grab border-[1.5px] border-fg-muted bg-surface-1 shadow-[0_0_12px_var(--color-hairline),0_0_0_9999px_var(--color-well-dark)] outline-none focus-visible:border-fg"
          style={
            {
              // At least wide enough to grab, and always inside the strip: a short window at
              // either end would otherwise stand out of it and be cut off.
              '--frame-width': `max(calc(${frameWidth}% + ${OUTSET}px), ${MIN_FRAME_PX}px)`,
              width: 'var(--frame-width)',
              left: `clamp(0px, calc(${frameLeft}% - ${OUTSET / 2}px), calc(100% - var(--frame-width)))`,
              top: OUTSET / 2,
              bottom: OUTSET / 2,
              // Concentric with the strip's corners, just inside them.
              borderRadius: `calc(var(--radius-control-sm) - ${OUTSET / 2}px)`,
            } as CSSProperties
          }
        />
      </div>
      <div aria-hidden className="flex justify-between text-caption text-fg-subtle">
        <span>{formatDay(domainStart)}</span>
        <span>jetzt</span>
      </div>
    </div>
  );
}
