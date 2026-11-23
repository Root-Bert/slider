import { useState } from 'react';
import { useNavigate } from 'react-router';
import { cloudAccessAtLeast, type CloudAgentSummary, type CloudArea } from '@slider/shared';
import { useCloudAgents, useMe, useOrderCloudAgent } from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { canCreateDecks, ViewSearch } from '@/features/workspaces';
import { Avatar, GlassPanel, SegmentedControl } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { useStoredChoice } from '../hooks/useStoredChoice';
import { AgentComposer } from './AgentComposer';
import {
  AgentList,
  AgentListSkeleton,
  agentsNone,
  agentsSaying,
  AgentViewToggle,
  useAgentView,
} from './AgentList';
import { AreaMark } from './AreaMark';
import { LoadFailed } from './Empty';

/** Whose agents of the area show: one's own in it, or those its people share. */
const SCOPES = ['own', 'area'] as const;
type Scope = (typeof SCOPES)[number];
const SCOPE_WORDS: Record<Scope, { label: string; hint: string; none: string }> = {
  own: {
    label: 'Meine',
    hint: 'Nur du siehst sie',
    none: 'Du hast in diesem Bereich noch keinen eigenen Agenten.',
  },
  area: {
    label: 'Bereich',
    hint: 'Alle im Bereich lesen mit',
    none: 'Dem Bereich ist noch kein Agent gegeben.',
  },
};
/** The workspace's own area: its agents stand in no area, shared they are the workspace's. */
const ROOT_WORDS: Record<Scope, { label: string; hint: string; none: string }> = {
  own: {
    label: 'Meine',
    hint: 'Nur du siehst sie',
    none: 'Du hast im Workspace noch keinen eigenen Agenten.',
  },
  area: {
    label: 'Workspace',
    hint: 'Alle im Workspace lesen mit',
    none: 'Dem Workspace ist noch kein Agent gegeben.',
  },
};

/**
 * An area's agents – the view beside its files (`AreaAgentsPage`), laid out as „Agenten“ is:
 * one's own in this area or those shared with its people, picked beside the order's field,
 * as tiles or rows. An order written here makes an agent in this area, one's own until given
 * to the area – by who may change things in it. The workspace's own area shows the workspace's
 * (those in no area), as „Agenten“'s „Workspace“ – the same, under the workspace's tabs.
 */
export function AreaAgents({ area }: { area: CloudArea }) {
  const ui = useCloud();
  const navigate = useNavigate();
  const agents = useCloudAgents(ui.workspace.id);
  // The workspace's own: in no area, as an order on „Agenten“.
  const order = useOrderCloudAgent(ui.workspace.id, area.root ? null : area.id);
  const words = area.root ? ROOT_WORDS : SCOPE_WORDS;
  const me = useMe().data?.viewer.author;
  const [view, setView] = useAgentView();
  // None picked: all of the area's. A click on the one picked lets go of it.
  const [picked, setScope] = useStoredChoice(
    'slider.cloud.area-agents-scope',
    ['all', ...SCOPES] as const,
    'all',
  );
  const scope = picked === 'all' ? null : picked;
  const list = (agents.data ?? []).filter((agent) =>
    area.root ? !agent.areaId : agent.areaId === area.id,
  );
  const groups: Record<Scope, CloudAgentSummary[]> = {
    own: list.filter((agent) => !agent.shared),
    area: list.filter((agent) => agent.shared),
  };
  const orders =
    canCreateDecks(ui.workspace.role) && (area.root || cloudAccessAtLeast(area.access, 'edit'));
  const shown = scope ? groups[scope] : list;
  // The page's own field (⌘K), as on „Agenten“.
  const [query, setQuery] = useState('');
  const found = agentsSaying(shown, query);
  return (
    <>
      {/* The order's field, whose and tiles or rows: one line, as on „Agenten“. */}
      <div className="flex items-center gap-3">
        {orders && (
          <div className="min-w-48 flex-1">
            <AgentComposer
              top
              placeholder={`Was soll in „${area.name}“ erledigt werden?`}
              autoFocus
              // The area's own draft – on „Entwürfe“ by its name, a click comes back here.
              keep={
                area.root
                  ? {
                      key: draftKeys.newAgent(ui.workspace.id),
                      target: { kind: 'agent-new', workspaceId: ui.workspace.id },
                    }
                  : {
                      key: draftKeys.newAgent(ui.workspace.id, area.id),
                      target: {
                        kind: 'agent-new',
                        workspaceId: ui.workspace.id,
                        areaId: area.id,
                        area: area.name,
                      },
                    }
              }
              busy={order.isPending}
              onSend={(text) =>
                order.mutateAsync(text).then(
                  (agent) => {
                    void navigate(routes.cloudAgent(ui.workspace.id, agent.id));
                    return true;
                  },
                  (error: Error) => {
                    ui.notify(error.message, 'danger');
                    return false;
                  },
                )
              }
            />
          </div>
        )}
        <GlassPanel className="shrink-0 p-1">
          <SegmentedControl
            label="Wessen Agenten"
            value={scope ?? 'all'}
            onChange={(next) => setScope(next === scope ? 'all' : next)}
            segments={SCOPES.map((each) => ({
              value: each,
              label: words[each].label,
              // One's own by a person, the area's by its dot – as „Agenten“ marks the workspace's.
              ...(each === 'own'
                ? {
                    // Oneself, by one's own picture – a person's symbol until it is there.
                    ...(me
                      ? { lead: <Avatar author={me} size={20} nativeTitle={false} /> }
                      : { icon: 'person' as const }),
                    iconOnly: true,
                  }
                : { lead: <AreaMark area={area} /> }),
              count: groups[each].length,
              title: `${words[each].label} | ${words[each].hint}`,
            }))}
          />
        </GlassPanel>
        {/* The search on the right, in the row – as Post's. */}
        {list.length > 0 && (
          <ViewSearch
            label="Agenten durchsuchen"
            value={query}
            onChange={setQuery}
            className="min-w-36 shrink"
          />
        )}
        <AgentViewToggle view={view} onChange={setView} />
      </div>
      {agents.isPending ? (
        <AgentListSkeleton />
      ) : agents.isLoadingError ? (
        <LoadFailed message={agents.error.message} onRetry={() => void agents.refetch()} />
      ) : (
        <section
          aria-label={scope ? words[scope].label : 'Alle Agenten'}
          className="flex flex-col gap-3"
        >
          {shown.length === 0 ? (
            <p className="text-body text-fg-muted">
              {scope
                ? words[scope].none
                : area.root
                  ? 'Im Workspace gibt es noch keinen Agenten.'
                  : 'In diesem Bereich gibt es noch keinen Agenten.'}
              {scope !== 'area' && orders && ' Schreib oben, was hier erledigt werden soll.'}
            </p>
          ) : found.length === 0 ? (
            <p className="text-body text-fg-muted">{agentsNone(query)}</p>
          ) : (
            <AgentList label={scope ? words[scope].label : 'Agenten'} agents={found} view={view} />
          )}
        </section>
      )}
    </>
  );
}
