import { cn } from '@/ui';
import { formatElapsed } from './lib/show-sync';
import type { ShowRunRow } from './lib/show-runs';

/** „Gesamtzeit 4:05, 2 Folien nicht gezeigt“. */
export function SummaryLine({ total, skipped }: { total: number; skipped: number }) {
  return (
    <>
      Gesamtzeit <span className="text-fg tabular-nums">{formatElapsed(total)}</span>
      {skipped > 0 && `, ${skipped === 1 ? 'eine Folie' : `${skipped} Folien`} nicht gezeigt`}
    </>
  );
}

/**
 * A run's time per slide as bars, with thumbnail, number and title; slides never shown dimmed –
 * at the presenter view's end and in „Letzter Durchgang“.
 */
export function SummaryRows({ rows }: { rows: readonly ShowRunRow[] }) {
  const longest = Math.max(1, ...rows.map((row) => row.ms));
  return (
    <ol aria-label="Zeit je Folie" className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={row.slideId}
          data-summary-row
          className={cn('flex items-center gap-3', row.skipped && 'opacity-50')}
        >
          <img
            src={row.thumbnailUrl || undefined}
            alt=""
            className="h-10 shrink-0 rounded-thumb object-cover"
            style={{ aspectRatio: row.aspectRatio }}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-sm text-fg">
              <span className="text-fg-subtle tabular-nums">{row.number}</span>{' '}
              {row.title || `Folie ${row.number}`}
            </p>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-fg-muted"
                style={{ width: `${(row.ms / longest) * 100}%` }}
              />
            </span>
          </div>
          <span className="w-24 shrink-0 text-right text-sm text-fg-muted tabular-nums">
            {row.skipped ? 'nicht gezeigt' : formatElapsed(row.ms)}
          </span>
        </li>
      ))}
    </ol>
  );
}
