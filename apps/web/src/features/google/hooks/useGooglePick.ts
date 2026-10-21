import { useCallback, useEffect, useState } from 'react';
import type { Deck } from '@slider/shared';
import { googlePickUrl, useImportGoogleItem } from '@/lib/api';

/** What a page carries back from Google (connect or picker). */
export const RETURN_PARAMS = [
  'google',
  'googleFile',
  'googleError',
  'googlePicked',
  'googleConnection',
] as const;

/**
 * "Aus Google Drive wählen" (BER-158): Google's file picker as its own page – the browser leaves
 * for it (`open`, connecting an account first if there is none) and comes back with the picked
 * file, which `importPicked` imports. On the page Google loads the previews itself; embedded in
 * Slider it could not (a `drive.file` token may not read files that are not picked yet).
 */
export function useGooglePick(workspaceId: string, onImported: (deck: Deck) => void) {
  const { mutate, isPending } = useImportGoogleItem(workspaceId);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back from Google with the browser's back button: the page may come from its cache.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  /** Leaves for Google's picker – on `fileId` only, for a pasted link Slider may not read yet. */
  const open = (fileId?: string | null) => {
    setError(null);
    setLeaving(true);
    // Back to this page, without what brought the person here from Google last time.
    const here = new URL(window.location.href);
    for (const key of RETURN_PARAMS) here.searchParams.delete(key);
    window.location.assign(googlePickUrl(here.pathname + here.search, fileId ?? undefined));
  };

  const importPicked = useCallback(
    (connectionId: string, fileId: string) => {
      setError(null);
      mutate(
        { connectionId, fileId },
        {
          onSuccess: (deck) => onImported(deck),
          onError: (cause) => setError(cause.message),
        },
      );
    },
    [mutate, onImported],
  );

  return { open, importPicked, pending: leaving || isPending, error };
}
