import type { Workspace } from '@slider/shared';
import { Badge, cn } from '@/ui';
import { deckState, formatRatio, planLabel, seatState, type LimitState } from '../lib/plan';
import { SettingsSection } from './SettingsSection';

/** "Free-Plan" (BER-130). */
export function PlanBadge({ plan }: { plan: string }) {
  return <Badge tone="info">{planLabel(plan)}</Badge>;
}

/** "Mitglieder 3/5" with a small meter; amber when full. */
export function UsageMeter({
  label,
  state,
  hint,
}: {
  label: string;
  state: LimitState;
  hint?: string;
}) {
  const percent = state.ratio === null ? null : Math.round(state.ratio * 100);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-fg-muted">{label}</span>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            state.full ? 'text-warning' : 'text-fg',
          )}
        >
          {formatRatio(state)}
          {state.max === null && (
            <span className="ml-1 font-normal text-fg-subtle">· unbegrenzt</span>
          )}
        </span>
      </div>
      {percent !== null && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={state.max ?? 0}
          aria-valuenow={state.used}
          aria-valuetext={formatRatio(state)}
          className="h-1.5 overflow-hidden rounded-full bg-white/10"
        >
          <div
            className={cn('h-full rounded-full', state.full ? 'bg-warning' : 'bg-fg')}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

/** Settings: plan badge with members and decks against the plan's limits. */
export function UsageSection({ workspace }: { workspace: Workspace }) {
  const { usage } = workspace;
  const pending = usage.seatsUsed - usage.members;
  return (
    <SettingsSection
      title="Plan & Nutzung"
      description="Zusammenarbeit und Kommentare gibt es innerhalb der Organisation. Offene E-Mail-Einladungen halten einen Platz frei."
      aside={<PlanBadge plan={workspace.plan} />}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-8">
        <UsageMeter
          label="Mitglieder"
          state={seatState(usage)}
          hint={
            pending > 0
              ? `${usage.members} Mitglieder + ${pending} offene ${pending === 1 ? 'Einladung' : 'Einladungen'}`
              : undefined
          }
        />
        <UsageMeter
          label="Präsentationen"
          state={deckState(usage)}
          hint={usage.maxDecks !== null ? 'Archivierte zählen mit.' : undefined}
        />
      </div>
    </SettingsSection>
  );
}
