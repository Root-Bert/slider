import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseShareLink, type Deck } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { queryKeys, useImportLink } from '@/lib/queries';

export const INVALID_LINK_MESSAGE = 'Kein gültiger OneDrive- oder SharePoint-Link';
const EMPTY_LINK_MESSAGE = 'Füge einen OneDrive- oder SharePoint-Link ein.';
const NO_ACCESS_MESSAGE = 'Kein Zugriff – der Link ist nur intern freigegeben.';

/** The link could be parsed, but Slider can't read the file without a Microsoft login (A3). */
export interface NoAccessInfo {
  host: string;
  message: string;
}

/**
 * State of the "PowerPoint-Link einfügen" form (BER-92): live validation with `parseShareLink`
 * (errors only after blur/submit), the import mutation and the A3 "no access" outcome.
 */
export function useLinkImport(onImported: (deck: Deck) => void) {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [submittedHost, setSubmittedHost] = useState<string | null>(null);
  const importLink = useImportLink();
  const queryClient = useQueryClient();

  const parsed = parseShareLink(url);
  const apiError = importLink.error instanceof ApiError ? importLink.error : null;

  const noAccess: NoAccessInfo | null =
    apiError?.code === 'microsoft_login_required' && submittedHost
      ? { host: submittedHost, message: apiError.message }
      : null;

  const clientError =
    !touched || parsed ? null : url.trim() === '' ? EMPTY_LINK_MESSAGE : INVALID_LINK_MESSAGE;
  const error = clientError ?? (noAccess ? NO_ACCESS_MESSAGE : (importLink.error?.message ?? null));

  const change = (value: string) => {
    setUrl(value);
    if (importLink.error) importLink.reset();
  };

  const submit = () => {
    setTouched(true);
    if (!parsed) return;
    setSubmittedHost(parsed.host);
    importLink.mutate(parsed.url.toString(), {
      onSuccess: (deck) => {
        queryClient.setQueryData(queryKeys.deck(deck.id), deck);
        void queryClient.invalidateQueries({ queryKey: queryKeys.decks, exact: true });
        onImported(deck);
      },
    });
  };

  return {
    url,
    change,
    blur: () => setTouched(url.trim() !== ''),
    submit,
    error,
    noAccess,
    pending: importLink.isPending,
    /** Leave the A3 state, e.g. when switching to a file upload. */
    reset: () => importLink.reset(),
  };
}
