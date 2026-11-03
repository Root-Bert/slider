import type { LiveDrag } from '@slider/shared';
import { useMemo } from 'react';
import { accentColor } from '@/lib/accent';
import { useLiveKey } from '../../live/lib/live-store';

/** Someone else's pick of an element: their name and colour. */
export interface PeerPick {
  elementId: string;
  name: string;
  color: string;
}

/**
 * What the others in the deck do to `elementIds` (a slide's elements) right now: the ones they
 * drag, where (their presence's `drag`, no step yet), and the ones they have picked. Renders again
 * only when that changes – not on their cursor moves.
 */
export function usePeersOn(elementIds: readonly string[]): {
  drags: ReadonlyMap<string, LiveDrag>;
  picks: readonly PeerPick[];
} {
  const ids = new Set(elementIds);
  const key = useLiveKey((snapshot) => {
    const drags: LiveDrag[] = [];
    const picks: PeerPick[] = [];
    for (const peer of snapshot.peers.values()) {
      if (peer.drag && ids.has(peer.drag.elementId)) drags.push(peer.drag);
      if (peer.picked && ids.has(peer.picked)) {
        picks.push({
          elementId: peer.picked,
          name: peer.author.name,
          color: accentColor(peer.author.color),
        });
      }
    }
    return drags.length === 0 && picks.length === 0 ? '' : JSON.stringify({ drags, picks });
  });
  return useMemo(() => {
    if (!key) return { drags: new Map(), picks: [] };
    const { drags, picks } = JSON.parse(key) as { drags: LiveDrag[]; picks: PeerPick[] };
    return { drags: new Map(drags.map((drag) => [drag.elementId, drag])), picks };
  }, [key]);
}
