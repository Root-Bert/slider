import { useEffect, useSyncExternalStore } from 'react';
import { useMe } from '@/lib/api';
import { adoptLegacyVisits, lastVisitsStore, openedIn } from '@/lib/last-visits';

/**
 * When the signed-in account last opened each deck in this browser (sort "Zuletzt geöffnet").
 * Without an account (still loading) no deck counts as opened.
 */
export function useLastVisits() {
  const visits = useSyncExternalStore(lastVisitsStore.subscribe, lastVisitsStore.getSnapshot);
  const userId = useMe().data?.user?.id;
  // The browser-wide visits of before go to the first account that looks.
  useEffect(() => {
    if (userId) adoptLegacyVisits(userId);
  }, [userId]);
  const opened = userId ? openedIn(visits, userId) : undefined;
  return {
    openedAt: (deckId: string): number | undefined => opened?.[deckId],
  };
}
