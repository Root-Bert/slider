import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCloudAgents, useOrderCloudAgent } from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { canCreateDecks, ViewSearch } from '@/features/workspaces';
import { AgentComposer } from './components/AgentComposer';
import {
  AgentList,
  AgentListSkeleton,
  AgentsNoHits,
  agentsSaying,
  AgentViewToggle,
  useAgentView,
} from './components/AgentList';
import { CloudPage } from './components/CloudPage';
import { Empty, LoadFailed } from './components/Empty';
import { ScopeTabs } from './components/ScopeTabs';
import { useCloud } from './hooks/useCloud';
import { ALL_SCOPE, OWN_SCOPE, scopeTabs, useScope, WORKSPACE_SCOPE } from './lib/scopes';

/**
 * „Agenten“: orders to the AI that it works on in the server, across as many files as it takes.
 * Tabs as the title, as Post's mailboxes: all, one's own, the workspace's, then each area's.
 * A new one starts with what is to be done – one's own under „Alle“ and „Meine“, under
 * „Workspace“ or an area's tab given to its people, as one written in the area itself.
 */
export function Component() {
  const ui = useCloud();
  const navigate = useNavigate();
  const agents = useCloudAgents(ui.workspace.id);
  const list = agents.data ?? [];
  const areas = ui.home?.areas ?? [];
  const { tabs, current } = scopeTabs(areas, useScope(), {
    own: 'Nur du siehst sie',
    workspace: 'Alle im Workspace lesen mit',
  });
  // An order goes where the tab stands: under „Alle“ and „Meine“ one's own, under „Workspace“
  // the workspace's, under an area's that area's – as in the area itself.
  const place = current === ALL_SCOPE || current === OWN_SCOPE ? null : current;
  const order = useOrderCloudAgent(
    ui.workspace.id,
    place === WORKSPACE_SCOPE ? null : place,
    undefined,
    place !== null,
  );
  // One's own wherever they stand; the workspace's are given to it and stand in no area.
  const shown =
    current === ALL_SCOPE
      ? list
      : current === OWN_SCOPE
        ? list.filter((agent) => !agent.shared)
        : current === WORKSPACE_SCOPE
          ? list.filter((agent) => agent.shared && !agent.areaId)
          : list.filter((agent) => agent.areaId === current);
  const tab = tabs.find((each) => each.key === current);
  const none =
    current === OWN_SCOPE
      ? 'Du hast noch keinen eigenen Agenten.'
      : current === WORKSPACE_SCOPE
        ? 'Dem Workspace ist noch kein Agent gegeben.'
        : `In „${tab?.label ?? ''}“ steht noch kein Agent.`;
  const [view, setView] = useAgentView();
  // The page's own field (⌘K): only those with every word in them.
  const [query, setQuery] = useState('');
  const found = agentsSaying(shown, query);
  // Who looks or comments reads what agents did; giving one work is for members and admins (as the server says).
  const orders = canCreateDecks(ui.workspace.role);
  return (
    <CloudPage
      docTitle="Agenten"
      title={<ScopeTabs tabs={tabs} current={current} />}
      crumbs={[{ label: 'Agenten' }]}
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
                <div className="min-w-48 flex-1">
                  <AgentComposer
                    top
                    placeholder={
                      place === null
                        ? 'Was soll erledigt werden?'
                        : `Was soll in „${place === WORKSPACE_SCOPE ? ui.workspace.name : (tab?.label ?? '')}“ erledigt werden?`
                    }
                    autoFocus
                    keep={{
                      key: draftKeys.newAgent(ui.workspace.id),
                      target: { kind: 'agent-new', workspaceId: ui.workspace.id },
                    }}
                    busy={order.isPending}
                    workspaceId={ui.workspace.id}
                    onSend={(text, attachments) =>
                      order.mutateAsync({ text, attachments }).then(
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
              {/* The search on the right, in the row – as Post's. */}
              {list.length > 0 && (
                <ViewSearch
                  label="Agenten durchsuchen"
                  value={query}
                  onChange={setQuery}
                  className="min-w-36 shrink"
                />
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
            // The open tab's.
            <section
              aria-label={current === ALL_SCOPE ? 'Alle Agenten' : (tab?.label ?? 'Agenten')}
              className="flex flex-col gap-3"
            >
              {shown.length === 0 ? (
                <Empty icon="autoAwesome" title="Noch kein Agent" message={none} />
              ) : found.length === 0 ? (
                <AgentsNoHits query={query} />
              ) : (
                <AgentList
                  label={tab?.label ?? 'Agenten'}
                  agents={found}
                  view={view}
                  // Any may stand in an area: which, is said on each.
                  showArea={current === ALL_SCOPE || current === OWN_SCOPE}
                />
              )}
            </section>
          )}
        </>
      )}
    </CloudPage>
  );
}
