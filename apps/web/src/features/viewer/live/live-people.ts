import type { Author } from '@slider/shared';
import { useMemo } from 'react';
import { useColorOverrides, withColorOverride } from '../lib/color-overrides';
import { useLiveSnapshot } from './live-store';

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
  const { peers } = useLiveSnapshot();
  const overrides = useColorOverrides();
  // Recomputed on presence changes only when someone switches slides or comes and goes.
  const key = [...peers.values()]
    .map(
      (peer) => `${peer.connectionId}:${peer.author.id}:${peer.author.color}:${peer.activeSlideId}`,
    )
    .join('|');
  return useMemo(() => {
    const people = new Map<string, LivePerson>();
    for (const peer of peers.values()) {
      people.set(peer.author.id, {
        author: withColorOverride(peer.author, overrides),
        activeSlideId: peer.activeSlideId,
      });
    }
    return [...people.values()];
    // `key` captures what matters of `peers`; cursor moves alone don't recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, overrides]);
}
