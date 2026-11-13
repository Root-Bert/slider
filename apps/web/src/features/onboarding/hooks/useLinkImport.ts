import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Deck, ParsedShareLink } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { queryKeys, useImportLink } from '@/lib/api';
import {
  invalidLinkMessage,
  NO_ACCESS_MESSAGE,
  noAccessFromError,
  parseImportLink,
  type NoAccessInfo,
} from '../lib/link-import-errors';

export {
  INVALID_LINK_MESSAGE,
  type NoAccessInfo,
  type NoAccessKind,
} from '../lib/link-import-errors';

/**
 * State of the "Link zur Präsentation einfügen" form (BER-92): live validation with `parseImportLink`
 * (errors only after blur/submit), the import mutation and the A3 "no access" outcome.
 */
export function useLinkImport(workspaceId: string, onImported: (deck: Deck) => void) {
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [submittedHost, setSubmittedHost] = useState<string | null>(null);
  const importLink = useImportLink(workspaceId);
  const queryClient = useQueryClient();

  const parsed = parseImportLink(url);
  const apiError = importLink.error instanceof ApiError ? importLink.error : null;

  const noAccess: NoAccessInfo | null =
    apiError && submittedHost ? noAccessFromError(apiError, submittedHost) : null;

  const clientError = !touched || parsed ? null : invalidLinkMessage(url);
  const error = clientError ?? (noAccess ? NO_ACCESS_MESSAGE : (importLink.error?.message ?? null));

  const startImport = (link: ParsedShareLink) =>
    importLink.mutate(link.url.toString(), {
      onSuccess: (deck) => {
        queryClient.setQueryData(queryKeys.deck(deck.id), deck);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
        onImported(deck);
      },
    });

  const change = (value: string) => {
    setUrl(value);
    if (importLink.error) importLink.reset();
  };

  const submit = () => {
    setTouched(true);
    if (!parsed) return;
    setSubmittedHost(parsed.host);
    startImport(parsed);
  };

  /** After connecting the Nextcloud the A3 card asked for: the same link again. */
  const retry = () => {
    if (!parsed) return;
    importLink.reset();
    startImport(parsed);
  };

  return {
    url,
    retry,
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
