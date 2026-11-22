import { useAgentAvatars } from '@/features/workspaces';
import { cn } from '@/ui';

/**
 * An agent's own picture – a rounded square, so it is not taken for a person's round avatar – in
 * the style its workspace picked (`workspaceId`, else the active one).
 */
export function AgentAvatar({
  id,
  size = 36,
  className,
  workspaceId,
}: {
  id: string;
  size?: number;
  className?: string;
  workspaceId?: string;
}) {
  const avatarOf = useAgentAvatars(workspaceId);
  return (
    <img
      src={avatarOf(id)}
      alt=""
      draggable={false}
      className={cn('shrink-0 rounded-control bg-placeholder object-cover', className)}
      style={{ width: size, height: size }}
    />
  );
}
