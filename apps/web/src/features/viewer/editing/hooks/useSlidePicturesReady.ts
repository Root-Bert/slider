import type { Slide } from '@slider/shared';
import { hashKey, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { queryKeys } from '@/lib/api';

/**
 * An edit's server answer precedes its slide-image refresh. An intermediate image from an
 * earlier edit must not end the current live preview while that refresh is pending or failed –
 * nor in the render before the refreshed pictures reach the slides on screen (`shown`): the cache
 * says it is done a render before the viewer's slides have them (a moved shape's live drawing
 * ended over the old picture, the shape flashed at its old place).
 */
export function useSlidePicturesReady(
  deckId: string,
  shown?: readonly Pick<Slide, 'id' | 'imageUrl'>[],
): boolean {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const queryKey = queryKeys.slides(deckId);
  const hash = hashKey(queryKey);
  // Only the slides' own query, told after the render it changed in: a query another component
  // builds while rendering (the composed layers, …) must not update this provider in the middle.
  const subscribe = useCallback(
    (listener: () => void) =>
      cache.subscribe((event) => {
        if (event.query.queryHash === hash) queueMicrotask(listener);
      }),
    [cache, hash],
  );
  const settled = useSyncExternalStore(
    subscribe,
    () => {
      const state = client.getQueryState(queryKey);
      return (
        (!state || state.fetchStatus === 'idle') &&
        state?.isInvalidated !== true &&
        state?.status !== 'error'
      );
    },
    () => false,
  );
  if (!settled || !shown) return settled;
  const fetched = client.getQueryData<Slide[]>(queryKey);
  if (!fetched) return true;
  const latest = new Map(fetched.map((slide) => [slide.id, slide.imageUrl]));
  return shown.every((slide) => !latest.has(slide.id) || latest.get(slide.id) === slide.imageUrl);
}
