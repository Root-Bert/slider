import { useOnlineMembers } from '@/lib/api';
import { AvatarStack } from '@/ui';
import { useActiveWorkspace } from '../hooks/useWorkspace';

/**
 * Who else of the active workspace is in Slider right now: their avatars left of your own in the
 * header, a little apart from it. Nothing while you're alone.
 */
export function OnlineMembers() {
  const workspace = useActiveWorkspace();
  // A blocked workspace answers 403 to everything but leaving: nobody to ask about.
  const { data: people = [] } = useOnlineMembers(
    workspace && !workspace.blocked ? workspace.id : null,
  );
  if (people.length === 0) return null;
  return (
    <AvatarStack
      authors={people}
      size={28}
      max={4}
      interactive
      className="mr-3 animate-fade-in max-sm:hidden"
    />
  );
}
