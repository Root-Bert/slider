import type { Author } from '@slider/shared';
import { useMemo } from 'react';
import { useColorOverrides } from '../../hooks/useColorOverrides';
import { withColorOverride } from '../../lib/color-overrides';
import { getLiveSnapshot, useLiveKey, type LiveSnapshot } from './live-store';

export interface LivePerson {
  author: Author;
  /** The slide they have active (their latest tab), `null` before it is known. */
  activeSlideId: string | null;
}

/**
 * The other open viewers right now – once per person, however many windows they have open; your
 * own other windows count too.
 */
export function useLivePeople(): LivePerson[] {
  const overrides = useColorOverrides();
  // Re-rendered on presence changes only when someone switches slides or comes and goes – not on
  // the many cursor moves.
  const key = useLiveKey(peopleKey);
  return useMemo(() => {
    const { peers } = getLiveSnapshot();
    const people = new Map<string, LivePerson>();
    for (const peer of peers.values()) {
      people.set(peer.author.id, {
        author: withColorOverride(peer.author, overrides),
        activeSlideId: peer.activeSlideId,
      });
    }
    return [...people.values()];
    // `key` captures what matters of the peers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, overrides]);
}

const peopleKey = ({ peers }: LiveSnapshot) =>
  [...peers.values()]
    .map(
      (peer) => `${peer.connectionId}:${peer.author.id}:${peer.author.color}:${peer.activeSlideId}`,
    )
    .join('|');
