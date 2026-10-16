import type { Workspace } from '@slider/shared';
import { Badge, cn, Section } from '@/ui';
import { deckState, formatRatio, planLabel, seatState, type LimitState } from '../lib/plan';

/** "Free-Plan" (BER-130). */
export function PlanBadge({ plan }: { plan: string }) {
  return <Badge tone="info">{planLabel(plan)}</Badge>;
}

/** Up to this many slots, the meter shows one segment per slot. */
const MAX_SEGMENTS = 10;

/** One tile: big count, label, and – with a limit – a meter and what is left. */
export function UsageMeter({
  label,
  state,
  hint,
}: {
  label: string;
  state: LimitState;
  hint?: string;
}) {
  const { used, max, full, remaining } = state;
  const status = max === null ? 'Kein Limit' : full ? 'Limit erreicht' : `Noch ${remaining} frei`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-panel bg-surface-1 p-4">
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-display leading-none font-semibold tabular-nums',
            full ? 'text-warning' : 'text-fg',
          )}
        >
          {used}
        </span>
        {max !== null && <span className="text-sm text-fg-subtle tabular-nums">von {max}</span>}
      </div>
      <span className="text-body text-fg-muted">{label}</span>
      {max !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={used}
          aria-valuetext={formatRatio(state)}
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
        {hint && <span className="text-fg-subtle"> · {hint}</span>}
      </p>
    </div>
  );
}

/** Settings: plan badge with members and decks against the plan's limits. */
export function UsageSection({ workspace }: { workspace: Workspace }) {
  const { usage } = workspace;
  const pending = usage.seatsUsed - usage.members;
  // Self-hosted instances have no limits – no plan to name there.
  const unlimited = usage.maxMembers === null && usage.maxDecks === null;
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
      </div>
    </Section>
  );
}
