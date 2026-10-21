import { STORAGE_CATEGORIES, type InstanceOverview } from '@slider/shared';
import { formatFileSize } from '@/lib/format';
import { cn, Section } from '@/ui';
import { STORAGE_COLORS, STORAGE_LABELS, WorkspaceMark } from '@/features/workspaces';
import { formatCount } from '../lib/period';

/** One part of a bar that shows a whole: share, colour (a token class), name, value. */
interface Part {
  key: string;
  label: string;
  value: number;
  /** Shown in the legend; the plain count when absent. */
  display?: string;
  color: string;
}

/**
 * Part-to-whole as one stacked bar – segments apart by a 2px gap, never outlined – with a legend
 * below that names every part with its value, so nothing hangs on colour or on hovering.
 */
function PartsBar({ parts, label }: { parts: readonly Part[]; label: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="flex flex-col gap-4">
      <div role="img" aria-label={label} className="flex h-2.5 gap-0.5">
        {total === 0 ? (
          <div className="flex-1 rounded-full bg-surface-2" />
        ) : (
          parts
            .filter((part) => part.value > 0)
            .map((part) => (
              <div
                key={part.key}
                title={`${part.label}: ${part.display ?? formatCount(part.value)}`}
                className={cn('min-w-1 rounded-full', part.color)}
                style={{ flexGrow: part.value, flexBasis: 0 }}
              />
            ))
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-2 text-body">
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', part.color)} />
            <span className="min-w-0 flex-1 truncate text-fg-muted">{part.label}</span>
            <span className="text-fg tabular-nums">{part.display ?? formatCount(part.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The number a card leads with, and what it counts. */
function Figure({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-2xl leading-none font-semibold whitespace-nowrap text-fg">{value}</span>
      <span className="text-body text-fg-subtle">{caption}</span>
    </div>
  );
}

/** Every file of every review together. */
const storageTotal = ({ storage }: InstanceOverview) =>
  STORAGE_CATEGORIES.reduce((sum, key) => sum + storage[key], 0);

export function StorageCard({ overview }: { overview: InstanceOverview }) {
  const { storage } = overview;
  const total = storageTotal(overview);
  return (
    <Section title="Speicher" density="compact">
      <Figure value={formatFileSize(total)} caption="alle Reviews und Aufnahmen" />
      <PartsBar
        label="Speicher nach Art der Datei"
        parts={STORAGE_CATEGORIES.map((key) => ({
          key,
          label: STORAGE_LABELS[key],
          value: storage[key],
          display: formatFileSize(storage[key]),
          color: STORAGE_COLORS[key],
        }))}
      />
    </Section>
  );
}

/**
 * When accounts last used Slider – plain white, brighter the more recent (a magnitude, not
 * categories), and grey for those away longer. The colour stays an accent of the chart.
 */
export function ActivityCard({ overview }: { overview: InstanceOverview }) {
  const { total, activeWeek, active, activeQuarter } = overview.users;
  return (
    <Section title="Aktivität" density="compact">
      <Figure
        value={`${formatCount(active)} von ${formatCount(total)}`}
        caption="in den letzten 30 Tagen"
      />
      <PartsBar
        label="Personen nach letzter Nutzung"
        parts={[
          {
            key: 'week',
            label: 'In den letzten 7 Tagen',
            value: activeWeek,
            color: 'bg-fg',
          },
          {
            key: 'month',
            label: 'Vor 8 bis 30 Tagen',
            value: active - activeWeek,
            color: 'bg-fg/45',
          },
          {
            key: 'quarter',
            label: 'Vor 31 bis 90 Tagen',
            value: activeQuarter - active,
            color: 'bg-fg/20',
          },
          {
            key: 'older',
            label: 'Länger nicht',
            value: total - activeQuarter,
            color: 'bg-surface-4',
          },
        ]}
      />
    </Section>
  );
}

/** Plans (where they differ) and what is blocked – counts only. */
export function StatusCard({ overview }: { overview: InstanceOverview }) {
  const { workspaces, users } = overview;
  return (
    <Section title={overview.plans ? 'Pläne' : 'Sperren'} density="compact">
      {overview.plans ? (
        <>
          <Figure
            value={formatCount(workspaces.paid)}
            caption={`von ${formatCount(workspaces.total)} im Paid-Plan`}
          />
          <PartsBar
            label="Organisationen nach Plan"
            parts={[
              {
                key: 'stripe',
                label: 'Paid über Stripe',
                value: workspaces.paid - workspaces.granted,
                color: 'bg-fg',
              },
              {
                key: 'granted',
                label: 'Paid freigeschaltet',
                value: workspaces.granted,
                color: 'bg-fg/45',
              },
              {
                key: 'free',
                label: 'Free',
                value: workspaces.total - workspaces.paid,
                color: 'bg-surface-4',
              },
            ]}
          />
        </>
      ) : (
        <Figure value={formatCount(users.blocked + workspaces.blocked)} caption="gesperrt" />
      )}
      <ul className="flex flex-col gap-2 border-t border-hairline pt-3 text-body">
        <li className="flex justify-between gap-3">
          <span className="text-fg-muted">Gesperrte Konten</span>
          <span className="text-fg tabular-nums">{formatCount(users.blocked)}</span>
        </li>
        <li className="flex justify-between gap-3">
          <span className="text-fg-muted">Gesperrte Organisationen</span>
          <span className="text-fg tabular-nums">{formatCount(workspaces.blocked)}</span>
        </li>
      </ul>
    </Section>
  );
}

/**
 * The organisations taking up the most storage: together first, like the other cards' figure,
 * then each with its share of the whole instance as a thin bar – the largest in full white, the
 * rest quieter. Names and sizes only.
 */
export function LargestCard({ overview }: { overview: InstanceOverview }) {
  const total = storageTotal(overview);
  const together = overview.largest.reduce((sum, workspace) => sum + workspace.storageBytes, 0);
  const share = (bytes: number) => (total > 0 ? (bytes / total) * 100 : 0);
  // A sliver is "< 1 %", not "0 %".
  const percent = (bytes: number) => {
    const value = share(bytes);
    return value > 0 && value < 1 ? '< 1 %' : `${Math.round(value)} %`;
  };
  return (
    <Section title="Größte Organisationen" density="compact">
      {overview.largest.length === 0 ? (
        <p className="text-body text-fg-subtle">Noch keine Dateien.</p>
      ) : (
        <>
          <Figure value={formatFileSize(together)} caption={`${percent(together)} des Speichers`} />
          <ol className="flex flex-col gap-3.5">
            {overview.largest.map((workspace, index) => (
              <li key={workspace.id} className="flex items-center gap-3">
                <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-baseline gap-3 text-body">
                    <span className="min-w-0 flex-1 truncate text-fg">{workspace.name}</span>
                    <span className="shrink-0 text-fg-muted tabular-nums">
                      {formatFileSize(workspace.storageBytes)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div aria-hidden className="h-1 flex-1 rounded-full bg-surface-2">
                      <div
                        className={cn(
                          'h-full min-w-1 rounded-full',
                          index === 0 ? 'bg-fg' : 'bg-fg/45',
                        )}
                        style={{ width: `${share(workspace.storageBytes)}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-caption text-fg-subtle tabular-nums">
                      {percent(workspace.storageBytes)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Section>
  );
}
