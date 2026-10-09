import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { parseShareLink, type Deck, type ParsedShareLink } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import { queryKeys, useImportLink } from '@/lib/queries';
import { ACCOUNT_LIMIT_MESSAGE } from '@/features/auth/lib/return-to';

export const INVALID_LINK_MESSAGE = 'Kein gültiger OneDrive-, SharePoint- oder PPTX-Link';
const EMPTY_LINK_MESSAGE = 'Füge einen OneDrive-, SharePoint- oder PPTX-Link ein.';
const NO_ACCESS_MESSAGE = 'Kein Zugriff – der Link ist nur intern freigegeben.';

export const LOGIN_DENIED_MESSAGE = 'Die Anmeldung wurde abgebrochen.';
export const CONSENT_MESSAGE =
  'Deine Organisation erlaubt Slider noch keinen Zugriff auf Dateien. Eine Administratorin oder ein Administrator muss Slider einmalig freigeben (Admin-Zustimmung). Bis dahin kannst du die Datei als PPTX hochladen.';
const LOGIN_FAILED_MESSAGE =
  'Die Anmeldung bei Microsoft hat nicht geklappt. Bitte versuche es erneut oder lade die Datei hoch.';

/**
 * Why the A3 card shows:
 * - `login`: Slider needs a Microsoft login to read the file.
 * - `not_configured`: … but this server has no Microsoft app registration.
 * - `consent`: the organisation has to approve Slider first.
 * - `denied`: the person cancelled the Microsoft login (or it failed).
 */
export type NoAccessKind = 'login' | 'not_configured' | 'consent' | 'denied';

/** The link could be parsed, but Slider can't read the file without a Microsoft login (A3). */
export interface NoAccessInfo {
  host: string;
  kind: NoAccessKind;
  message: string;
  /** Where "Mit Microsoft anmelden" goes; missing when the login is not set up. */
  loginUrl?: string;
}

/** The API's login URL for a link, for states that did not come from an API error. */
const loginUrlFor = (link: string) =>
  `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/neu?link=${encodeURIComponent(link)}`)}`;

function noAccessFromError(error: ApiError, host: string, link: string): NoAccessInfo | null {
  switch (error.code) {
    case 'microsoft_login_required':
      return {
        host,
        kind: 'login',
        message: error.message,
        loginUrl: error.loginUrl ?? loginUrlFor(link),
      };
    case 'microsoft_not_configured':
      return { host, kind: 'not_configured', message: error.message };
    case 'microsoft_consent_required':
      return { host, kind: 'consent', message: error.message, loginUrl: loginUrlFor(link) };
    default:
      return null;
  }
}

/** `?msError=` from the login callback → A3 variant. */
function noAccessFromLoginError(kind: string, host: string, link: string): NoAccessInfo {
  const loginUrl = loginUrlFor(link);
  if (kind === 'admin_consent')
    return { host, kind: 'consent', message: CONSENT_MESSAGE, loginUrl };
  if (kind === 'denied') return { host, kind: 'denied', message: LOGIN_DENIED_MESSAGE, loginUrl };
  if (kind === 'account_limit')
    return { host, kind: 'denied', message: ACCOUNT_LIMIT_MESSAGE, loginUrl };
  return { host, kind: 'denied', message: LOGIN_FAILED_MESSAGE, loginUrl };
}

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
