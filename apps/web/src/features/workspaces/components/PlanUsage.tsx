import type { Workspace } from '@slider/shared';
import { formatFileSize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { Badge, cn, Notice, Section, TextLink } from '@/ui';
import {
  deckState,
  formatRatio,
  LOCKED_MESSAGE,
  planLabel,
  seatState,
  storageState,
  unlimitedUsage,
  type LimitState,
} from '../lib/plan';

/** "Free-Plan" / "Paid-Plan" (BER-130, BER-152). */
export function PlanBadge({ plan }: { plan: string }) {
  return <Badge tone="info">{planLabel(plan)}</Badge>;
}

/** Up to this many slots, the meter shows one segment per slot. */
const MAX_SEGMENTS = 10;

/**
 * One tile: big count, label, and – with a limit – a meter and what is left. `format` writes the
 * numbers (storage: "1,2 GB"); counts stay plain.
 */
export function UsageMeter({
  label,
  state,
  hint,
  format = String,
}: {
  label: string;
  state: LimitState;
  hint?: string;
  format?: (value: number) => string;
}) {
  const { used, max, full, remaining } = state;
  const status =
    max === null ? 'Kein Limit' : full ? 'Limit erreicht' : `Noch ${format(remaining ?? 0)} frei`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-panel bg-surface-1 p-4">
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-display leading-none font-semibold tabular-nums',
            full ? 'text-warning' : 'text-fg',
          )}
        >
          {format(used)}
        </span>
        {max !== null && (
          <span className="text-sm text-fg-subtle tabular-nums">von {format(max)}</span>
        )}
      </div>
      <span className="text-body text-fg-muted">{label}</span>
      {max !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={used}
          aria-valuetext={
            format === String ? formatRatio(state) : `${format(used)} von ${format(max)}`
          }
          className="flex h-1.5 gap-1"
        >
          {max > 0 && max <= MAX_SEGMENTS ? (
            Array.from({ length: max }, (_, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-full',
                  i < used ? (full ? 'bg-warning' : 'bg-fg') : 'bg-hover',
                )}
              />
            ))
          ) : (
            <div className="flex-1 overflow-hidden rounded-full bg-hover">
              <div
                className={cn('h-full rounded-full', full ? 'bg-warning' : 'bg-fg')}
                style={{ width: `${Math.round((state.ratio ?? 0) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
      <p className={cn('text-xs', full ? 'text-warning' : 'text-fg-subtle')}>
        {status}
        {hint && <span className="text-fg-subtle"> | {hint}</span>}
      </p>
    </div>
  );
}

/** Settings: plan badge with members, decks and storage against the plan's limits. */
export function UsageSection({ workspace }: { workspace: Workspace }) {
  const { usage } = workspace;
  const pending = usage.seatsUsed - usage.members;
  // Self-hosted instances have no limits – no plan to name there.
  const unlimited = unlimitedUsage(usage);
  return (
    <Section
      title="Plan & Nutzung"
      description={
        unlimited
          ? 'Zusammenarbeit und Kommentare gibt es innerhalb der Organisation.'
          : 'Zusammenarbeit und Kommentare gibt es innerhalb der Organisation. Offene E-Mail-Einladungen halten einen Platz frei.'
      }
      aside={unlimited ? undefined : <PlanBadge plan={workspace.plan} />}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <UsageMeter
          label="Mitglieder"
          state={seatState(usage)}
          hint={
            pending > 0
              ? `${pending} ${pending === 1 ? 'offene Einladung' : 'offene Einladungen'}`
              : undefined
          }
        />
        <UsageMeter
          label="Reviews"
          state={deckState(usage)}
          hint={usage.maxDecks !== null ? 'Archivierte zählen mit.' : undefined}
        />
        <UsageMeter label="Speicher" state={storageState(usage)} format={formatFileSize} />
      </div>
      {workspace.locked && (
        <Notice tone="warning" variant="tinted" size="sm">
          {LOCKED_MESSAGE}
        </Notice>
      )}
      <TextLink
        to={routes.usage(workspace.id)}
        variant="underline"
        size="body"
        className="self-start"
      >
        Speicher und Abrechnung unter „Nutzung“
      </TextLink>
    </Section>
  );
}
