import { useId } from 'react';
import { linePaths, spread } from '../lib/line';

/**
 * A headline number of the dashboard: label, value, what happened in the period and – for counts
 * that grow – a sparkline of the window in plain white (the big chart below has the
 * details on hover).
 */
export function KpiTile({
  label,
  value,
  delta,
  trend,
}: {
  label: string;
  value: string;
  /** e.g. "+12 in 30 Tagen" – plain text, never the series colour. */
  delta?: string;
  /** New per stretch of the period, oldest first. */
  trend?: readonly number[];
}) {
  return (
    <div
      className="glass flex min-w-0 flex-col gap-3 rounded-panel p-5"
      role="group"
      aria-label={label}
    >
      <span className="text-body text-fg-muted">{label}</span>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-display leading-none font-semibold text-fg">{value}</span>
          {delta && <span className="text-xs text-fg-subtle">{delta}</span>}
        </div>
        {trend && trend.length > 1 && <Sparkline values={trend} />}
      </div>
    </div>
  );
}

const WIDTH = 104;
const HEIGHT = 36;

/**
 * The big chart's line in small: rounded corners, a wash fading out below, a comment pin on the
 * latest value; decorative (the chart has the values). Not on phones, where the number needs the
 * room.
 */
function Sparkline({ values }: { values: readonly number[] }) {
  const gradient = useId();
  const max = Math.max(...values, 1);
  const points = spread(values, WIDTH, (value) => HEIGHT - 4 - (value / max) * (HEIGHT - 10));
  const { line, area } = linePaths(points, HEIGHT);
  const end = points.at(-1);
  return (
    <svg
      aria-hidden
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="shrink-0 overflow-visible max-sm:hidden"
    >
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-fg)" stopOpacity={0.14} />
          <stop offset="1" stopColor="var(--color-fg)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradient})`} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-fg-muted)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {end && <circle cx={end.x} cy={end.y} r={3} fill="var(--color-fg)" />}
    </svg>
  );
}
