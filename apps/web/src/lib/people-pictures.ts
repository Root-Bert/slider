import { useSyncExternalStore } from 'react';
import type { PeoplePictures } from '@slider/shared';

/*
 * The pictures people chose for themselves (Konto › Profil), by user id – what every `Avatar`
 * shows instead of the one seeded by the name. A module store, not a query or a context: avatars
 * stand outside the router and the query's provider too (calls, `CallProvider`), and comments
 * keep their author as a snapshot, so the picture is looked up by id where it is drawn.
 * Filled by `PeoplePicturesSync` while someone is signed in.
 */

let pictures: PeoplePictures = {};
const listeners = new Set<() => void>();

export function setPeoplePictures(next: PeoplePictures): void {
  const same =
    Object.keys(next).length === Object.keys(pictures).length &&
    Object.entries(next).every(([id, url]) => pictures[id] === url);
  if (same) return;
  pictures = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The picture `userId` chose, `undefined` without one (or without an id). */
export const usePersonPicture = (userId: string | undefined): string | undefined =>
  useSyncExternalStore(
    subscribe,
    () => (userId ? pictures[userId] : undefined),
    () => undefined,
  );
