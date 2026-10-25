import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { InstanceBucket } from '@slider/shared';
import { formatDay, pluralize } from '@/lib/format';
import { Section, SegmentedControl } from '@/ui';
import { useWidth } from '../hooks/useWidth';
import { linePaths, spread } from '../lib/line';
import {
  bucketSpan,
  bucketStart,
  countTicks,
  formatCount,
  stretchName,
  windowSpan,
  type Metric,
} from '../lib/period';

const METRICS = [
  { value: 'users', label: 'Personen' },
  { value: 'workspaces', label: 'Workspaces' },
  { value: 'decks', label: 'Reviews' },
] as const satisfies readonly { value: Metric; label: string }[];

/** "4 neue Personen" – the tooltip's and the screen reader's value. */
const NEW_LABEL: Record<Metric, (count: number) => string> = {
  users: (n) => pluralize(n, 'neue Person', 'neue Personen'),
  workspaces: (n) => pluralize(n, 'neuer Workspace', 'neue Workspaces'),
  decks: (n) => pluralize(n, 'neue Review', 'neue Reviews'),
};

const HEIGHT = 224;
/** Room above the highest point for its pin. */
const TOP_GAP = 12;
/** About the tooltip's size: closer to the right or bottom edge, it opens the other way. */
const TOOLTIP_WIDTH = 160;
const TOOLTIP_HEIGHT = 64;
/** Corners of the line: the comment connectors' radius. */
const CORNER_RADIUS = 8;

/**
 * What was created per stretch of the window (an hour up to a week) – one measure at a time
 * (they differ in scale, so never two on one axis). Drawn like a comment: a 2px line in the
 * admin's colour with the connectors' 8px corners, drawn in like them, over a wash that fades into
 * the card; the value nearest the pointer (or focused) gets a comment pin with a mark on its
 * corner, glass behind it. A hidden table carries every value.
 */
export function GrowthChart({
  timeline,
  stretchHours,
  view,
  metric,
  onMetricChange,
  accent,
  children,
}: {
  timeline: readonly InstanceBucket[];
  /** Length of one stretch of `timeline`. */
  stretchHours: number;
  /** The window shown, whether it follows the time, and how its length reads ("in 31 Tagen"). */
  view: { from: number; to: number; live: boolean; phrase: string };
  metric: Metric;
  onMetricChange: (metric: Metric) => void;
  /** The line's colour (the admin's own); the floating mark takes it along. */
  accent: string;
  /** Under the chart: the history strip to move the window. */
  children?: ReactNode;
}) {
  // The value pointed at, and where the plot is on screen then: its pin and mark float above the
  // page (see below), read once per point – a scroll ends the hover anyway.
  const [hover, setHover] = useState<{ index: number; rect: DOMRect } | null>(null);
  const [plotRef, width] = useWidth<HTMLDivElement>();
  const ids = useId();
  const values = timeline.map((bucket) => bucket[metric]);
  const ticks = countTicks(Math.max(...values, 0));
  const top = ticks.at(-1) ?? 1;
  const y = (value: number) => HEIGHT - (value / top) * (HEIGHT - TOP_GAP);
  const points = spread(values, width, y);
  const { line, area } = linePaths(points, HEIGHT, CORNER_RADIUS);
  const total = values.reduce((sum, value) => sum + value, 0);
  const label = METRICS.find((each) => each.value === metric)?.label ?? '';
  const stretch = stretchName(stretchHours);
  const middle = Math.floor((timeline.length - 1) / 2);
  // At rest the pin marks the latest value, like the end of a connector.
  const pin = points[hover?.index ?? timeline.length - 1];

  const point = (index: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (rect) setHover({ index, rect });
  };
  const leave = () => setHover(null);

  // Fixed to the screen, the mark would stay behind while the page scrolls: it goes.
  const hovering = hover !== null;
  useEffect(() => {
    if (!hovering) return;
    window.addEventListener('scroll', leave, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', leave, { capture: true });
  }, [hovering]);

  return (
    // The line, its wash and pin wear the admin's colour.
    <div className="contents" style={{ '--accent': accent } as CSSProperties}>
      <Section
        title="Neu auf der Instanz"
        description={`${NEW_LABEL[metric](total)} ${view.live ? view.phrase : `vom ${windowSpan(view.from, view.to)}`}, je ${stretch}.`}
        density="compact"
        asideOnPhones="below"
        aside={
          <SegmentedControl
            label="Was zeigen"
            size="sm"
            track="soft"
            segments={METRICS}
            value={metric}
            onChange={(next) => {
              onMetricChange(next);
              leave();
            }}
          />
        }
      >
        <div className="flex gap-3">
          {/* Count axis: the values that aren't labelled. */}
          <div aria-hidden className="relative w-8 shrink-0" style={{ height: HEIGHT }}>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 -translate-y-1/2 text-caption text-fg-subtle tabular-nums"
                style={{ top: y(tick) }}
              >
                {formatCount(tick)}
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div
              ref={plotRef}
              className="relative"
              style={{ height: HEIGHT }}
              onMouseLeave={leave}
              // The point nearest to the pointer – they sit from edge to edge, not in the middle of
              // the hit targets below.
              onMouseMove={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                if (box.width === 0) return;
                const share = (event.clientX - box.left) / box.width;
                const nearest = Math.round(share * (timeline.length - 1));
                if (nearest !== hover?.index) {
                  point(Math.min(timeline.length - 1, Math.max(0, nearest)));
                }
              }}
            >
              {width > 0 && (
                <svg
                  aria-hidden
                  width={width}
                  height={HEIGHT}
                  className="absolute inset-0 overflow-visible"
                >
                  <defs>
                    {/* The wash: the line's colour, fading out towards the baseline. */}
                    <linearGradient id={`${ids}-wash`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="var(--accent)" stopOpacity={0.32} />
                      <stop offset="0.6" stopColor="var(--accent)" stopOpacity={0.08} />
                      <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                    <filter id={`${ids}-glow`} x="-10%" y="-50%" width="120%" height="200%">
                      <feGaussianBlur stdDeviation="6" />
                    </filter>
                  </defs>
                  {ticks.map((tick) => (
                    <line
                      key={tick}
                      x1={0}
                      x2={width}
                      y1={y(tick)}
                      y2={y(tick)}
                      stroke="var(--color-hairline)"
                    />
                  ))}
                  {/* Keyed: a new measure or period draws its line in anew. */}
                  <g key={`${metric}-${stretchHours}`}>
                    <path d={area} fill={`url(#${ids}-wash)`} className="animate-fade-in" />
                    <path
                      d={line}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={6}
                      strokeOpacity={0.35}
                      filter={`url(#${ids}-glow)`}
                      pathLength={1}
                      className="draw-in"
                    />
                    <path
                      d={line}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pathLength={1}
                      className="draw-in"
                    />
                  </g>
                  {hover && pin && (
                    <line
                      x1={pin.x}
                      x2={pin.x}
                      y1={pin.y}
                      y2={HEIGHT}
                      stroke="var(--color-hairline-strong)"
                    />
                  )}
                </svg>
              )}
              {pin && !hover && (
                // The comment pin: a dot in the line's colour, ringed, with an even shadow – over the
                // mark's corner.
                <span
                  aria-hidden
                  className="pointer-events-none absolute z-(--z-raised) size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--accent) shadow-[0_0_0_2px_var(--color-fg),var(--shadow-pin)] transition-[left,top] duration-150 ease-out"
                  style={{ left: pin.x, top: pin.y }}
                />
              )}
              {hover &&
                pin &&
                createPortal(
                  // Above the page, not inside the card: the card's own glass would keep the mark's
                  // blur from reaching the line behind it.
                  <div
                    aria-hidden
                    className="pointer-events-none fixed z-(--z-popover)"
                    style={
                      {
                        left: hover.rect.left + pin.x,
                        top: hover.rect.top + pin.y,
                        '--accent': accent,
                      } as CSSProperties
                    }
                  >
                    {/* Like a comment's mark on a slide: 4px corners, a 2px edge in the colour,
                      glass behind, the pin on its corner. It opens away from the chart's edges. */}
                    <div
                      className="glass-panel absolute flex flex-col gap-0.5 rounded-thumb border-2 border-(--accent) px-3 py-2 whitespace-nowrap shadow-float"
                      style={{
                        transform: `translate(${pin.x > width - TOOLTIP_WIDTH ? '-100%' : '0'}, ${pin.y > HEIGHT - TOOLTIP_HEIGHT ? '-100%' : '0'})`,
                      }}
                    >
                      <span className="text-sm font-semibold text-fg tabular-nums">
                        {formatCount(values[hover.index] ?? 0)}{' '}
                        <span className="font-normal text-fg-muted">{label}</span>
                      </span>
                      <span className="text-caption text-fg-subtle">
                        {bucketSpan(timeline[hover.index], stretchHours)}
                      </span>
                    </div>
                    <span className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--accent) shadow-[0_0_0_2px_var(--color-fg),var(--shadow-pin)]" />
                  </div>,
                  document.body,
                )}
              {/* Hit targets: every stretch, full height – the pointer never has to meet the line. */}
              <div className="absolute inset-0 flex">
                {timeline.map((bucket, index) => (
                  <button
                    key={bucket.start}
                    type="button"
                    aria-label={`${bucketSpan(bucket, stretchHours)}: ${NEW_LABEL[metric](values[index] ?? 0)}`}
                    onFocus={() => point(index)}
                    onBlur={leave}
                    className="h-full min-w-0 flex-1 rounded-mark outline-none focus-visible:bg-surface-1"
                  />
                ))}
              </div>
            </div>
            {/* Time axis: start, middle, now. */}
            <div aria-hidden className="relative h-4 text-caption text-fg-subtle">
              {timeline[0] && (
                <span className="absolute left-0">{bucketStart(timeline[0], stretchHours)}</span>
              )}
              {timeline[middle] && middle > 0 && (
                <span
                  className="absolute -translate-x-1/2"
                  style={{ left: `${(middle / Math.max(timeline.length - 1, 1)) * 100}%` }}
                >
                  {bucketStart(timeline[middle], stretchHours)}
                </span>
              )}
              <span className="absolute right-0">
                {view.live ? 'jetzt' : formatDay(view.to - 1)}
              </span>
            </div>
          </div>
        </div>
        {children}
        <table className="sr-only">
          <caption>{`Neue ${label} je ${stretch}`}</caption>
          <thead>
            <tr>
              <th scope="col">{stretch}</th>
              <th scope="col">{label}</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((bucket, index) => (
              <tr key={bucket.start}>
                <td>{bucketSpan(bucket, stretchHours)}</td>
                <td>{values[index]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
