import type { AccountAuthor } from '@slider/shared';
import { useOnlineMembers } from '@/lib/api';
import { Avatar, type AvatarSize } from '@/ui';

/**
 * Someone one writes with, and whether they are in Slider right now: a green dot on the face
 * (the header's heartbeat, `useOnlineMembers` – nothing asked twice).
 */
export function PersonFace({
  person,
  size,
  workspaceId,
}: {
  person: AccountAuthor;
  size: AvatarSize;
  workspaceId: string;
}) {
  const online = useOnlineMembers(workspaceId).data?.some((each) => each.id === person.id);
  const dot = Math.max(6, Math.round(size / 4));
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar author={person} size={size} />
      {online && (
        <span
          role="img"
          aria-label="Online"
          title="Online"
          style={{ width: dot, height: dot }}
          className="absolute -right-px -bottom-px rounded-full bg-success ring-2 ring-canvas"
        />
      )}
    </span>
  );
}
