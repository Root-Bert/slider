import { useNavigate } from 'react-router';
import type { CloudAgentSummary } from '@slider/shared';
import { useCloudAgents, useMe, useOrderCloudAgent } from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { canCreateDecks, WorkspaceMark } from '@/features/workspaces';
import { Avatar, GlassPanel, SegmentedControl } from '@/ui';
import { AgentComposer } from './components/AgentComposer';
import {
  AgentList,
  AgentListSkeleton,
  AgentViewToggle,
  useAgentView,
} from './components/AgentList';
import { CloudPage } from './components/CloudPage';
import { Empty, LoadFailed } from './components/Empty';
import { useCloud } from './hooks/useCloud';
import { useStoredChoice } from './hooks/useStoredChoice';

/** Whose agents the page shows: one's own or the workspace's. */
const SCOPES = ['own', 'workspace'] as const;
type Scope = (typeof SCOPES)[number];
const SCOPE_WORDS: Record<Scope, { label: string; hint: string; none: string }> = {
  own: { label: 'Meine', hint: 'Nur du siehst sie', none: 'Du hast noch keinen eigenen Agenten.' },
  workspace: {
    label: 'Workspace',
    hint: 'Alle im Workspace lesen mit',
    none: 'Dem Workspace ist noch kein Agent gegeben.',
  },
};

/**
 * „Agenten“: orders to the AI that it works on in the server, across as many files as it takes.
 * One's own or the workspace's, picked beside the order's field; an area's agents stand in that
 * area.
 * A new one starts with what is to be done, as one's own.
 */
export function Component() {
  const ui = useCloud();
  const navigate = useNavigate();
  const agents = useCloudAgents(ui.workspace.id);
  const order = useOrderCloudAgent(ui.workspace.id);
  // One's own are all here, those standing in an area named by it. What an area's people share
  // stands in that area (`AreaAgents`), not here.
  const list = (agents.data ?? []).filter((agent) => !(agent.shared && agent.areaId));
  const own = list.filter((agent) => !agent.shared);
  const workspace = list.filter((agent) => agent.shared);
  const me = useMe().data?.viewer.author;
  const [view, setView] = useAgentView();
  // None picked: all of them. A click on the one picked lets go of it.
  const [picked, setScope] = useStoredChoice(
    'slider.cloud.agents-scope',
    ['all', ...SCOPES] as const,
    'all',
  );
  const groups: Record<Scope, CloudAgentSummary[]> = { own, workspace };
  const scope = picked !== 'all' ? picked : null;
  const shown = scope ? groups[scope] : list;
  // Who looks or comments reads what agents did; giving one work is for members and admins (as the server says).
  const orders = canCreateDecks(ui.workspace.role);
  return (
    <CloudPage
      docTitle="Agenten"
      title="Agenten"
      crumbs={[{ label: ui.workspace.name }, { label: 'Agenten' }]}
      nodes={[]}
    >
      {() => (
        <>
          {!orders && (
            <p className="text-body text-fg-muted">Agenten beauftragen Mitglieder und Admins.</p>
          )}
          {(orders || list.length > 0) && (
            // The order's field and how the agents below are shown: one line.
            <div className="flex items-center gap-3">
              {orders && (
                <div className="min-w-0 flex-1">
                  <AgentComposer
                    top
                    placeholder="Was soll erledigt werden?"
                    autoFocus
                    keep={{
                      key: draftKeys.newAgent(ui.workspace.id),
                      target: { kind: 'agent-new', workspaceId: ui.workspace.id },
                    }}
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
              {list.length > 0 && (
                <GlassPanel className="shrink-0 p-1">
                  <SegmentedControl
                    label="Wessen Agenten"
                    value={scope ?? 'all'}
                    onChange={(next) => setScope(next === scope ? 'all' : next)}
                    segments={SCOPES.map((each) => ({
                      value: each,
                      label: SCOPE_WORDS[each].label,
                      // One's own by a person, the workspace's by its mark.
                      ...(each === 'workspace'
                        ? {
                            lead: (
                              <WorkspaceMark
                                name={ui.workspace.name}
                                logoUrl={ui.workspace.logoUrl}
                                size={24}
                                className="size-4.5!"
                              />
                            ),
                          }
                        : {
                            // Oneself, by one's own picture – a person's symbol until it is there.
                            ...(me
                              ? { lead: <Avatar author={me} size={20} nativeTitle={false} /> }
                              : { icon: 'person' as const }),
                            iconOnly: true,
                          }),
                      count: groups[each].length,
                      title: `${SCOPE_WORDS[each].label} | ${SCOPE_WORDS[each].hint}`,
                    }))}
                  />
                </GlassPanel>
              )}
              {list.length > 0 && <AgentViewToggle view={view} onChange={setView} />}
            </div>
          )}
          {agents.isPending ? (
            <AgentListSkeleton />
          ) : agents.isLoadingError ? (
            <LoadFailed message={agents.error.message} onRetry={() => void agents.refetch()} />
          ) : list.length === 0 ? (
            <Empty
              icon="autoAwesome"
              title="Noch kein Agent"
              message={
                orders
                  ? 'Schreib oben, was erledigt werden soll.'
                  : 'Hier steht, was Agenten im Workspace erledigt haben.'
              }
            />
          ) : (
            // All of them, or the ones picked beside the order's field.
            <section
              aria-label={scope ? SCOPE_WORDS[scope].label : 'Alle Agenten'}
              className="flex flex-col gap-3"
            >
              {scope && shown.length === 0 ? (
                <p className="text-body text-fg-muted">{SCOPE_WORDS[scope].none}</p>
              ) : (
                <AgentList
                  label={scope ? SCOPE_WORDS[scope].label : 'Agenten'}
                  agents={shown}
                  view={view}
                  // One's own may stand in an area: which, is said on each.
                  showArea
                />
              )}
            </section>
          )}
        </>
      )}
    </CloudPage>
  );
}
