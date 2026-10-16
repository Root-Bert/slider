import { useSyncExternalStore } from 'react';
import { lastVisitsStore } from '@/lib/last-visits';

/** When this browser last opened each deck (sort "Zuletzt geöffnet"). */
export function useLastVisits() {
  const visits = useSyncExternalStore(lastVisitsStore.subscribe, lastVisitsStore.getSnapshot);
  return {
    openedAt: (deckId: string): number | undefined => visits.opened?.[deckId],
  };
}
