import { useAgentAvatars } from '@/features/workspaces';
import { cn } from '@/ui';

/**
 * An agent's own picture – a rounded square, so it is not taken for a person's round avatar – in
 * the style its workspace picked (`workspaceId`, else the active one). `working`: a light runs
 * round its rim and glows under it, as round a comment the AI is answering (`ai-rim`, `ai-glow`).
 */
export function AgentAvatar({
  id,
  size = 36,
  className,
  workspaceId,
  working = false,
}: {
  id: string;
  size?: number;
  className?: string;
  workspaceId?: string;
  working?: boolean;
}) {
  const avatarOf = useAgentAvatars(workspaceId);
  if (!working) {
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
  // At work the corners and shadow given are the frame's; picture, light and glow take its corners.
  return (
    <span
      className={cn('relative inline-flex shrink-0 rounded-control', className)}
      style={{ width: size, height: size }}
    >
      {/* The glow only round a large picture: on the side bar's small ones it would be a smudge. */}
      {size >= 32 && (
        <span
          aria-hidden
          className="ai-glow pointer-events-none absolute -inset-1 rounded-[inherit]"
        />
      )}
      <img
        src={avatarOf(id)}
        alt=""
        draggable={false}
        className="relative size-full rounded-[inherit] bg-placeholder object-cover"
      />
      <span
        aria-hidden
        className="ai-rim pointer-events-none absolute -inset-[1.5px] rounded-[inherit]"
      />
      <span className="sr-only">Arbeitet</span>
    </span>
  );
}
