import type { Author } from '@slider/shared';
import { accentColor } from '@/lib/accent';
import { AvatarStack } from '@/ui';
import { useColorOverrides, withColorOverride } from '../lib/color-overrides';
import { getLiveSnapshot, useLiveKey } from './lib/live-store';

/**
 * Who else has this comment open right now (BER-104): a frame in their colour around the card and
 * their avatar on its corner. Re-renders only when that set of people changes.
 */
export function LiveThreadMarker({ threadId }: { threadId: string }) {
  const overrides = useColorOverrides();
  // Author ids, sorted and deduplicated (two tabs of one person count once).
  const key = useLiveKey((snapshot) =>
    [
      ...new Set(
        [...snapshot.peers.values()]
          .filter((peer) => peer.focusedThreadId === threadId)
          .map((peer) => peer.author.id),
      ),
    ]
      .sort()
      .join(','),
  );
  if (!key) return null;

  const ids = new Set(key.split(','));
  const byId = new Map<string, Author>();
  for (const peer of getLiveSnapshot().peers.values()) {
    if (ids.has(peer.author.id))
      byId.set(peer.author.id, withColorOverride(peer.author, overrides));
  }
  const people = [...byId.values()];
  const first = people[0];
  if (!first) return null;

  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-[3px] z-10 animate-fade-in rounded-[calc(var(--radius-panel)+3px)]"
        style={{ boxShadow: `0 0 0 2px ${accentColor(first.color)}` }}
      />
      <span
        className="pointer-events-none absolute -top-2.5 -right-2.5 z-20 animate-pop-in"
        title={`${people.map((person) => person.name).join(', ')} ${people.length === 1 ? 'schaut' : 'schauen'} sich das gerade an`}
      >
        <AvatarStack authors={people} size={20} max={3} />
      </span>
    </>
  );
}
