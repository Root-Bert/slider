import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Deck, ParsedShareLink } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { queryKeys, useImportLink } from '@/lib/api';
import {
  invalidLinkMessage,
  NO_ACCESS_MESSAGE,
  noAccessFromError,
  noAccessFromLoginError,
  parseImportLink,
  type NoAccessInfo,
} from '../lib/link-import-errors';
import { rememberLinkLogin, takeLinkLogin } from '../lib/link-login';

export {
  CONSENT_MESSAGE,
  INVALID_LINK_MESSAGE,
  LOGIN_DENIED_MESSAGE,
  type NoAccessInfo,
  type NoAccessKind,
} from '../lib/link-import-errors';

/**
 * State of the "Link zur Präsentation einfügen" form (BER-92): live validation with `parseImportLink`
 * (errors only after blur/submit), the import mutation and the A3 "no access" outcome.
 *
 * After the Microsoft login the API sends the browser back to `/neu?link=…`: the link is
 * prefilled, and imported once automatically if this tab started that login for this link and
 * workspace (`link-login.ts`) – a crafted `/neu?link=…` only prefills. `&msError=…` instead
 * explains why the login failed.
 */
export function useLinkImport(workspaceId: string, onImported: (deck: Deck) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Back from the Microsoft login: `?link=` (and maybe `&msError=`), read once on mount.
  const [resume] = useState(() => {
    const link = searchParams.get('link');
    const parsed = link ? parseImportLink(link) : null;
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

  const parsed = parseImportLink(url);
  const apiError = importLink.error instanceof ApiError ? importLink.error : null;

  const noAccess: NoAccessInfo | null =
    loginError ??
    (apiError && submittedHost ? noAccessFromError(apiError, submittedHost, url.trim()) : null);

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

  // Retry the import once after a successful login this tab started, and drop the parameters
  // from the URL.
  useEffect(() => {
    if (resumed.current || resume.link === null) return;
    resumed.current = true;
    const ownLogin = takeLinkLogin(resume.link, workspaceId);
    setSearchParams(
      (params) => {
        params.delete('link');
        params.delete('msError');
        return params;
      },
      { replace: true },
    );
    if (resume.parsed && !resume.msError && ownLogin) startImport(resume.parsed);
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

  /** "Mit Microsoft anmelden" on the A3 card: remembers the link, then leaves for the login. */
  const signIn = () => {
    if (!noAccess?.loginUrl) return;
    rememberLinkLogin(url.trim(), workspaceId);
    window.location.assign(noAccess.loginUrl);
  };

  /** After connecting the Nextcloud the A3 card asked for: the same link again. */
  const retry = () => {
    if (!parsed) return;
    importLink.reset();
    startImport(parsed);
  };

  return {
    url,
    signIn,
    retry,
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
