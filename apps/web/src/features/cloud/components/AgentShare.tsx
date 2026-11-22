import { cloudAccessAtLeast, type CloudAgentSummary } from '@slider/shared';
import { useShareCloudAgent } from '@/lib/api';
import { Icon, Menu, type MenuAction } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { areaTree, isWorkspaceOwn } from '../lib/areas';
import { AreaDot } from './AreaDot';

/**
 * Who sees an agent: its owner alone („Nur ich“ – it stays where it stands), the workspace, or
 * an area's people – then it stands in that area. Its owner picks (`actions`, none for anyone
 * else); everyone else reads it.
 */
export function useAgentShare(agent: CloudAgentSummary) {
  const ui = useCloud();
  const share = useShareCloudAgent(ui.workspace.id);
  const areas = ui.home?.areas ?? [];
  const area = areas.find((each) => each.id === agent.areaId) ?? null;
  const whose = !agent.shared ? 'Nur ich' : agent.areaId ? (area?.name ?? 'Bereich') : 'Workspace';
  const mark =
    agent.shared && area ? (
      <AreaDot color={area.color} size="md" />
    ) : (
      <Icon name={!agent.shared ? 'lock' : agent.areaId ? 'workspaces' : 'groups'} size={18} />
    );
  if (!agent.mine) return { whose, mark, actions: [] as MenuAction[] };

  const pick = (shared: boolean, areaId: string | null, said: string) => {
    if (shared === agent.shared && areaId === agent.areaId) return;
    share.mutate(
      { agentId: agent.id, shared, areaId },
      {
        // It leaves the list it stood in: said, so it is found again.
        onSuccess: () => ui.notify(said),
        onError: (error) => ui.notify(error.message, 'danger'),
      },
    );
  };
  const actions: MenuAction[] = [
    {
      label: 'Nur ich',
      icon: 'lock',
      // It stays where it stands: in its area, or in none.
      onSelect: () => pick(false, agent.areaId, 'Nur du siehst den Agenten'),
    },
    {
      label: 'Workspace',
      icon: 'groups',
      onSelect: () => pick(true, null, 'Alle im Workspace sehen den Agenten'),
    },
    // An area's: where one may change things – the workspace's own is „Workspace“ above.
    ...areaTree(
      areas.filter((each) => !isWorkspaceOwn(each) && cloudAccessAtLeast(each.access, 'edit')),
    ).map(({ area: each }): MenuAction => ({
      label: each.name,
      // As wide as the icons above it, so the names stand in one line.
      icon: (
        <span className="flex size-4.5 items-center justify-center">
          <AreaDot color={each.color} size="md" />
        </span>
      ),
      onSelect: () => pick(true, each.id, `Alle im Bereich „${each.name}“ sehen den Agenten`),
    })),
  ];
  return { whose, mark, actions };
}

/** Who sees the agent, on its page: a menu for its owner, words for everyone else. */
export function AgentShare({ agent }: { agent: CloudAgentSummary }) {
  const { whose, mark, actions } = useAgentShare(agent);
  if (!agent.mine) {
    return (
      <span className="flex h-8 shrink-0 items-center gap-2 px-1 text-body text-fg-muted">
        {mark}
        {whose}
      </span>
    );
  }
  return (
    <Menu
      label="Wer den Agenten sieht"
      actions={actions}
      triggerText={
        <span className="flex items-center gap-2">
          {mark}
          <span className="max-w-40 truncate">{whose}</span>
        </span>
      }
    />
  );
}
