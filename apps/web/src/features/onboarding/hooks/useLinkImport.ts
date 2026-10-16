import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { parseShareLink, type Deck, type ParsedShareLink } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { queryKeys, useImportLink } from '@/lib/api';
import {
  EMPTY_LINK_MESSAGE,
  INVALID_LINK_MESSAGE,
  NO_ACCESS_MESSAGE,
  noAccessFromError,
  noAccessFromLoginError,
  type NoAccessInfo,
} from '../lib/link-import-errors';

export {
  CONSENT_MESSAGE,
  INVALID_LINK_MESSAGE,
  LOGIN_DENIED_MESSAGE,
  type NoAccessInfo,
  type NoAccessKind,
} from '../lib/link-import-errors';

/**
 * State of the "PowerPoint-Link einfügen" form (BER-92): live validation with `parseShareLink`
 * (errors only after blur/submit), the import mutation and the A3 "no access" outcome.
 *
 * After the Microsoft login the API sends the browser back to `/neu?link=…`: the link is
 * prefilled and imported once automatically. `&msError=…` instead explains why the login failed.
 */
export function useLinkImport(workspaceId: string, onImported: (deck: Deck) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Back from the Microsoft login: `?link=` (and maybe `&msError=`), read once on mount.
  const [resume] = useState(() => {
    const link = searchParams.get('link');
    const parsed = link ? parseShareLink(link) : null;
    return { link, parsed, msError: searchParams.get('msError') };
  });
  const [url, setUrl] = useState(resume.link ?? '');
  const [touched, setTouched] = useState(resume.link !== null && !resume.parsed);
  const [submittedHost, setSubmittedHost] = useState(resume.parsed?.host ?? null);
  const [loginError, setLoginError] = useState<NoAccessInfo | null>(() =>
    resume.parsed && resume.link && resume.msError
      ? noAccessFromLoginError(resume.msError, resume.parsed.host, resume.link)
      : null,
  );
  const importLink = useImportLink(workspaceId);
  const queryClient = useQueryClient();
  const resumed = useRef(false);

  const parsed = parseShareLink(url);
  const apiError = importLink.error instanceof ApiError ? importLink.error : null;

  const noAccess: NoAccessInfo | null =
    loginError ??
    (apiError && submittedHost ? noAccessFromError(apiError, submittedHost, url.trim()) : null);

  const clientError =
    !touched || parsed ? null : url.trim() === '' ? EMPTY_LINK_MESSAGE : INVALID_LINK_MESSAGE;
  const error = clientError ?? (noAccess ? NO_ACCESS_MESSAGE : (importLink.error?.message ?? null));

  const startImport = (link: ParsedShareLink) =>
    importLink.mutate(link.url.toString(), {
      onSuccess: (deck) => {
        queryClient.setQueryData(queryKeys.deck(deck.id), deck);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
        onImported(deck);
      },
    });

  // Retry the import once after a successful login, and drop the parameters from the URL.
  useEffect(() => {
    if (resumed.current || resume.link === null) return;
    resumed.current = true;
    setSearchParams(
      (params) => {
        params.delete('link');
        params.delete('msError');
        return params;
      },
      { replace: true },
    );
    if (resume.parsed && !resume.msError) startImport(resume.parsed);
    // Runs once on mount; `startImport` only uses stable mutation and query-client handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (value: string) => {
    setUrl(value);
    setLoginError(null);
    if (importLink.error) importLink.reset();
  };

  const submit = () => {
    setTouched(true);
    if (!parsed) return;
    setSubmittedHost(parsed.host);
    setLoginError(null);
    startImport(parsed);
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
    reset: () => {
      setLoginError(null);
      importLink.reset();
    },
  };
}
