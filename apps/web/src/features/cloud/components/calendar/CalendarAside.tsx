import { useSyncExternalStore } from 'react';
import type { Calendar } from '@slider/shared';
import { useCalendarOverview, useOrderCloudAgent } from '@/lib/api';
import { routes } from '@/lib/routes';
import { createStoredStore } from '@/lib/storage';
import { Button, Icon } from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { AsideAgent, AsideBullets, AsidePart } from '../AsidePart';
import { CalendarList } from './CalendarList';
import { iso } from './days';
import { MonthGrid } from './MonthGrid';

/** The agent asked beside the calendar, per workspace – opened again, its chat is back. */
const agentsStore = createStoredStore<Record<string, string>>({
  key: 'slider.calendar.agents',
  parse: (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, string] => {
            return typeof entry[1] === 'string';
          }),
        )
      : {},
  fallback: {},
  crossTab: true,
});

function useCalendarAgent(workspaceId: string) {
  const all = useSyncExternalStore(agentsStore.subscribe, agentsStore.getSnapshot);
  const set = (agentId: string | null) => {
    const { [workspaceId]: _gone, ...rest } = agentsStore.getSnapshot();
    agentsStore.set(agentId ? { ...rest, [workspaceId]: agentId } : rest);
  };
  return [all[workspaceId] ?? null, set] as const;
}

/**
 * „KI zum Kalender“ beside its days, as „KI zur Mail“ beside a mail: the small month, the AI's
 * word on the coming seven days and what it proposes (a click hands it to an agent of one's own),
 * the calendars shown or hidden, and „Nachfragen“ at the foot.
 */
export function CalendarAside({
  anchor,
  onPick,
  busy,
  calendars,
  hidden,
  onToggle,
}: {
  anchor: Date;
  onPick: (day: string) => void;
  busy: ReadonlySet<string>;
  calendars: Calendar[] | undefined;
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const ui = useCloud();
  const workspaceId = ui.workspace.id;
  const overview = useCalendarOverview(workspaceId, hidden);
  const [agentId, setAgentId] = useCalendarAgent(workspaceId);
  const order = useOrderCloudAgent(workspaceId);
  const data = overview.data;
  const ready = data?.state === 'ready' ? data : null;
  const propose = (text: string) =>
    order.mutate(text, {
      onSuccess: (agent) => setAgentId(agent.id),
      onError: (error) => ui.notify(error.message, 'danger'),
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="sr-only">KI zum Kalender</h2>
      {/* Free on the page, level with the days beside it; scrolls as one, „Nachfragen“ under it. */}
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto overscroll-contain px-1 pt-1">
        {/* Its month's name on the parts' edge below. */}
        <div className="-mx-2 shrink-0">
          <MonthGrid
            key={iso(anchor).slice(0, 7)}
            value={iso(anchor)}
            onPick={onPick}
            marked={busy}
          />
        </div>
        {data?.state !== 'off' && (
          <AsidePart label="Überblick" icon="autoAwesome" working={overview.isFetching}>
            {ready && ready.bullets.length > 0 ? (
              <AsideBullets label="Die nächsten sieben Tage" items={ready.bullets} />
            ) : ready ? (
              <p className="text-caption text-fg-muted">Die nächsten sieben Tage sind frei.</p>
            ) : overview.isError ? (
              <p className="flex items-center gap-2 text-caption text-fg-muted">
                <span className="min-w-0 flex-1">{overview.error.message}</span>
                <Button variant="ghost" size="xs" onClick={() => void overview.refetch()}>
                  Erneut versuchen
                </Button>
              </p>
            ) : (
              <p className="text-caption text-fg-muted">Die KI schaut auf die nächsten Tage …</p>
            )}
          </AsidePart>
        )}
        {ready && ready.suggestions.length > 0 && (
          <AsidePart label="Vorschläge" icon="autoFixHigh">
            <ul className="flex flex-col gap-1">
              {ready.suggestions.map((text, index) => (
                <li key={index}>
                  <button
                    type="button"
                    disabled={order.isPending}
                    title="Einem Agenten auftragen"
                    onClick={() => propose(text)}
                    className="-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2 rounded-chip px-1 py-1 text-left text-body text-fg transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-50"
                  >
                    <Icon name="send" size={16} className="mt-0.5 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1">{text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </AsidePart>
        )}
        {calendars && (
          <AsidePart label="Kalender" icon="calendar">
            <div className="-mx-2">
              <CalendarList calendars={calendars} hidden={hidden} onToggle={onToggle} />
            </div>
          </AsidePart>
        )}
      </div>
      {/* At the column's foot, always in sight: its chat scrolls in itself. */}
      <div className="flex max-h-[55%] shrink-0 flex-col overflow-y-auto overscroll-contain px-1 pt-6">
        <AsideAgent
          workspaceId={workspaceId}
          agentId={agentId}
          onAgent={setAgentId}
          order={order}
          placeholder="Frag zu deinem Kalender …"
          off={
            data?.state === 'off'
              ? 'Fragen zum Kalender beantwortet die KI – für diesen Workspace ist keine eingerichtet.'
              : null
          }
          agentPath={(id) => routes.cloudAgent(workspaceId, id)}
          notify={ui.notify}
        />
      </div>
    </div>
  );
}
