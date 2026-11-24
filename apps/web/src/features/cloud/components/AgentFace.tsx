import type { CloudAreaColor } from '@slider/shared';
import { WorkspaceMark } from '@/features/workspaces';
import { cn, Icon, Tooltip } from '@/ui';
import { AgentAvatar } from './AgentAvatar';
import { areaColor } from './AreaDot';

/**
 * An agent's picture – with where it belongs at its corner: the workspace's mark, or its area's
 * dot. An area's dot also on one's own agent that stands in an area – but not inside that area,
 * where every agent is of it and the dot tells those given to its people. So a list of all of
 * them tells them apart at a glance, by the same marks they are picked by beside the order's
 * field – and the side bar's small pictures by the same, only smaller. `working`: the light round
 * its rim (`AgentAvatar`). Areas and workspace come from the page (Cloud's or Sender's).
 */
export function AgentFace({
  agent,
  size,
  showArea,
  areas,
  workspace,
  working = false,
  className,
}: {
  agent: { id: string; areaId: string | null; shared: boolean };
  areas: readonly { id: string; name: string; color: CloudAreaColor }[] | undefined;
  workspace: { name: string; logoUrl?: string | null };
  size: 18 | 32 | 48;
  /** The list is not one area's own: an agent's area is news. */
  showArea: boolean;
  working?: boolean;
  /** The picture's own (corners, shadow). */
  className?: string;
}) {
  const small = size < 32;
  const area = agent.areaId ? areas?.find((each) => each.id === agent.areaId) : null;
  const inArea = agent.areaId ? `im Bereich „${area?.name ?? ''}“`.replace(' „“', '') : '';
  // One's own among the area's, in the area's own list: only its owner sees it there.
  const secret = Boolean(agent.areaId) && !agent.shared && !showArea;
  const label = secret
    ? 'Nur du siehst ihn'
    : agent.areaId
      ? agent.shared
        ? `Agent des Bereichs${area ? ` „${area.name}“` : ''}`
        : showArea
          ? `Dein Agent ${inArea}`
          : null
      : agent.shared
        ? 'Agent des Workspace'
        : null;
  const icon = small ? 8 : 12;
  return (
    <span className="relative flex shrink-0">
      <AgentAvatar id={agent.id} size={size} working={working} className={className} />
      {label && (
        // The corner is this span's: the tooltip's own box stands where it is put – from the
        // mark to the right, since the face stands at the list's left edge, which would cut it.
        <span
          className={cn(
            'absolute z-(--z-raised) flex',
            small ? '-right-1 -bottom-1' : '-right-1.5 -bottom-1.5',
          )}
        >
          <Tooltip label={label} decorative align="start">
            <span
              role="img"
              aria-label={label}
              className={cn(
                'flex items-center justify-center overflow-hidden bg-surface-1 ring-canvas',
                small ? 'size-2.5 rounded-[3px] ring-[1.5px]' : 'size-[18px] rounded-[6px] ring-2',
              )}
            >
              {secret ? (
                <Icon name="lock" size={icon} className="text-fg-muted" />
              ) : area ? (
                // Small, the colour fills the mark; large, its dot stands in it.
                <span
                  className={small ? 'size-full' : 'size-2.5 rounded-mark'}
                  style={{ backgroundColor: areaColor(area.color) }}
                />
              ) : agent.areaId ? (
                <Icon name="workspaces" size={icon} className="text-fg-muted" />
              ) : (
                <WorkspaceMark
                  name={workspace.name}
                  logoUrl={workspace.logoUrl}
                  size={24}
                  className="size-full! rounded-none!"
                />
              )}
            </span>
          </Tooltip>
        </span>
      )}
    </span>
  );
}
