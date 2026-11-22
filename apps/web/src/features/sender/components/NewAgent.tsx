import { useNavigate } from 'react-router';
import { useCloudAgents, useOrderCloudAgent } from '@/lib/api';
import { draftKeys } from '@/lib/drafts';
import {
  AgentComposer,
  AgentList,
  AgentListSkeleton,
  CloudProvider,
  Empty,
  LoadFailed,
} from '@/features/cloud';
import { useSender } from '../hooks/useSender';

/**
 * „Neu“ › Agent: Cloud's „Agenten“ – the order's field on top, one's own agents below as the same
 * cards. Only one's own (one's chats are one's own), so neither whose nor tiles or rows to pick.
 * A new one, as its card, opens as a chat (`agentPath`: Sender's, or Cloud's agent page).
 */
export function NewAgent({ inCloud }: { inCloud: boolean }) {
  const ui = useSender();
  // The cards' menu (share, delete) and their marks are Cloud's – there it is around already.
  return inCloud ? (
    <Agents />
  ) : (
    <CloudProvider workspace={ui.workspace}>
      <Agents />
    </CloudProvider>
  );
}

function Agents() {
  const ui = useSender();
  const navigate = useNavigate();
  const order = useOrderCloudAgent(ui.workspace.id);
  const agents = useCloudAgents(ui.workspace.id);
  const own = (agents.data ?? []).filter((agent) => !agent.shared);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <AgentComposer
        top
        placeholder="Was soll erledigt werden?"
        autoFocus
        // One draft for a new agent, wherever it is ordered (Cloud's „Agenten“ too).
        keep={{
          key: draftKeys.newAgent(ui.workspace.id),
          target: { kind: 'agent-new', workspaceId: ui.workspace.id },
        }}
        busy={order.isPending}
        // Esc goes back, as from „Neu“'s other forms.
        onEscape={() => void navigate(-1)}
        onSend={(text) =>
          order.mutateAsync(text).then(
            (agent) => {
              void navigate(ui.agentPath(agent.id), { replace: true });
              return true;
            },
            (error: Error) => {
              ui.notify(error.message, 'danger');
              return false;
            },
          )
        }
      />
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-2 pb-6">
        {agents.isPending ? (
          <AgentListSkeleton />
        ) : agents.isLoadingError ? (
          <LoadFailed message={agents.error.message} onRetry={() => void agents.refetch()} />
        ) : own.length === 0 ? (
          <Empty
            icon="autoAwesome"
            title="Noch kein Agent"
            message="Schreib oben, was erledigt werden soll."
          />
        ) : (
          <AgentList
            label="Meine Agenten"
            agents={own}
            view="tiles"
            showArea
            hrefOf={ui.agentPath}
          />
        )}
      </div>
    </div>
  );
}
