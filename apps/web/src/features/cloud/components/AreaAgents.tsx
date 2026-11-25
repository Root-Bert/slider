import { useState } from 'react';
import { useNavigate } from 'react-router';
import { cloudAccessAtLeast, type CloudArea } from '@slider/shared';
import { useCloudAgents, useOrderCloudAgent } from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import { routes } from '@/lib/routes';
import { canCreateDecks, ViewSearch } from '@/features/workspaces';
import { useCloud } from '../hooks/useCloud';
import { AgentComposer } from './AgentComposer';
import {
  AgentList,
  AgentListSkeleton,
  AgentsNoHits,
  agentsSaying,
  AgentViewToggle,
  useAgentView,
} from './AgentList';
import { Empty, LoadFailed } from './Empty';

/**
 * An area's agents – the view beside its files (`AreaAgentsPage`), laid out as „Agenten“ is: the
 * order's field, search, tiles or rows. Only the area's: those given to its people and one's own
 * standing in it (a lock says only one sees them). An order written here gives the new agent to
 * the area's people – by who may change things in it; „Agenten“ › „Meine“ makes one's own. The
 * workspace's own area shows the workspace's (shared, in no area), as „Agenten“'s „Workspace“.
 */
export function AreaAgents({ area }: { area: CloudArea }) {
  const ui = useCloud();
  const navigate = useNavigate();
  const agents = useCloudAgents(ui.workspace.id);
  // The workspace's own: in no area, given to the workspace.
  const order = useOrderCloudAgent(ui.workspace.id, area.root ? null : area.id, undefined, true);
  const [view, setView] = useAgentView();
  const list = (agents.data ?? []).filter((agent) =>
    area.root ? !agent.areaId && agent.shared : agent.areaId === area.id,
  );
  const orders =
    canCreateDecks(ui.workspace.role) && (area.root || cloudAccessAtLeast(area.access, 'edit'));
  // The page's own field (⌘F), as on „Agenten“.
  const [query, setQuery] = useState('');
  const found = agentsSaying(list, query);
  return (
    <>
      {/* The order's field, search and tiles or rows: one line, as on „Agenten“. */}
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
        <AgentViewToggle view={view} onChange={setView} />
      </div>
      {agents.isPending ? (
        <AgentListSkeleton />
      ) : agents.isLoadingError ? (
        <LoadFailed message={agents.error.message} onRetry={() => void agents.refetch()} />
      ) : (
        <section aria-label="Agenten" className="flex flex-col gap-3">
          {list.length === 0 ? (
            // As on „Agenten“: the picture, what it means, what to do.
            <Empty
              icon="autoAwesome"
              title="Noch kein Agent"
              message={
                orders
                  ? 'Schreib oben, was hier erledigt werden soll.'
                  : area.root
                    ? 'Hier steht, was Agenten im Workspace erledigt haben.'
                    : 'Hier steht, was Agenten in diesem Bereich erledigt haben.'
              }
            />
          ) : found.length === 0 ? (
            <AgentsNoHits query={query} />
          ) : (
            <AgentList label="Agenten" agents={found} view={view} />
          )}
        </section>
      )}
    </>
  );
}
