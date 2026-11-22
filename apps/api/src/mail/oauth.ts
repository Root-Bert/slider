import { eq } from 'drizzle-orm';
import { MAIL_OAUTH_LABELS, type MailOAuthProvider } from '@slider/shared';
import { validateIdToken, type IdTokenClaims } from '../auth/id-token';
import type { Pkce } from '../auth/microsoft';
import type { Config } from '../config';
import { mailAccounts, type MailAccountRow } from '../db/schema';
import type { AppDeps } from '../deps';

/*
 * Mailboxes that sign in through their provider instead of a password – „Mit Microsoft
 * anmelden“ (Outlook.com, Hotmail, Live and Microsoft 365, which take no password) and „Mit Google
 * anmelden“ (Gmail, Google Workspace). The login's own app registrations and redirect URIs are
 * used; the authorization code flow with PKCE and the client secret asks for IMAP and SMTP as that
 * person (XOAUTH2) and a refresh token. Plain `fetch`, as the login does.
 *
 * The refresh token is kept sealed on the mailbox (`mail_accounts.refresh_token`), the access
 * token only here in memory until shortly before it ends. Neither is ever logged.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The servers a provider's mailboxes are read and sent through. */
export interface MailServerSettings {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

interface Client {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface ProviderSpec {
  /** The login's app registration; `null` when that login is not set up here. */
  client(config: Config): Client | null;
  authorizeUrl(config: Config): string;
  tokenUrl(config: Config): string;
  scopes: string;
  /** What a refresh asks for again (Google keeps the grant's scopes without a word). */
  refreshScopes?: string;
  /**
   * Reading the account's calendars (`services/calendar/mail-calendars.ts`), asked for at sign-in
   * beside mail. Microsoft's is another resource (Graph): consented to at the authorize step, its
   * token fetched apart (`calendarAccessToken`) – the code's exchange keeps to `scopes`.
   */
  calendarScopes: string;
  /** Further authorize parameters: Google hands out a refresh token only with these. */
  authorizeParams: Record<string, string>;
  issuer(iss: string, claims: Record<string, unknown>): boolean;
  /** The account's address – only one the provider vouches for. */
  address(claims: IdTokenClaims): string | null;
  servers(claims: IdTokenClaims): MailServerSettings;
}

const msAuthority = (config: Config) =>
  `https://login.microsoftonline.com/${encodeURIComponent(config.microsoft?.tenant ?? 'common')}/oauth2/v2.0`;
/** The directory (`tid`) all personal Microsoft accounts are in. */
export const PERSONAL_MICROSOFT_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const MS_MAIL_SCOPES =
  'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send';

export const MAIL_OAUTH: Record<MailOAuthProvider, ProviderSpec> = {
  microsoft: {
    client: (config) => config.microsoft,
    authorizeUrl: (config) => `${msAuthority(config)}/authorize`,
    tokenUrl: (config) => `${msAuthority(config)}/token`,
    // v2 dynamic consent: the delegated scopes are asked for here, nothing set in the portal.
    scopes: `openid email ${MS_MAIL_SCOPES}`,
    refreshScopes: MS_MAIL_SCOPES,
    calendarScopes: 'https://graph.microsoft.com/Calendars.Read',
    authorizeParams: { response_mode: 'query', prompt: 'select_account' },
    issuer: (iss, claims) =>
      typeof claims['tid'] === 'string' &&
      iss === `https://login.microsoftonline.com/${claims['tid']}/v2.0`,
    address: (claims) =>
      [claims.email, claims.preferred_username]
        .find((one): one is string => typeof one === 'string' && one.includes('@'))
        ?.toLowerCase() ?? null,
    // Microsoft's settings: IMAP 993 with TLS; SMTP 587 with STARTTLS – Outlook.com's own
    // name for personal accounts, Microsoft 365's for work and school ones.
    servers: (claims) => ({
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapSecure: true,
      smtpHost:
        claims.tid === PERSONAL_MICROSOFT_TENANT ? 'smtp-mail.outlook.com' : 'smtp.office365.com',
      smtpPort: 587,
      smtpSecure: false,
    }),
  },
  google: {
    client: (config) => config.auth.google,
    authorizeUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    // IMAP and SMTP need Google's full mail scope (restricted: see docs/agent-notes.md, Mail).
    scopes: 'openid email https://mail.google.com/',
    calendarScopes: 'https://www.googleapis.com/auth/calendar.readonly',
    // A refresh token comes only offline and with the consent screen shown.
    authorizeParams: { access_type: 'offline', prompt: 'consent select_account' },
    issuer: (iss) => iss === 'https://accounts.google.com' || iss === 'accounts.google.com',
    address: (claims) =>
      typeof claims.email === 'string' &&
      claims.email.includes('@') &&
      claims.email_verified !== false &&
      claims.email_verified !== 'false'
        ? claims.email.toLowerCase()
        : null,
    servers: () => ({
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapSecure: true,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
    }),
  },
};

/** Offered for a new mailbox here: its client set up – Google's only with `GOOGLE_MAILBOXES`. */
export const mailOAuthConfigured = (config: Config, provider: MailOAuthProvider) =>
  MAIL_OAUTH[provider].client(config) !== null &&
  (provider !== 'google' || config.auth.googleMailboxes);

/** A refusal of the provider's authorize or token endpoint. */
export class MailOAuthError extends Error {
  constructor(
    /** The provider's `error` code, e.g. `invalid_grant`. */
    readonly code: string,
    description = '',
  ) {
    super(`${code}: ${description}`);
    this.name = 'MailOAuthError';
  }
}

/** The provider is not reached (network, its outage) – try again later, nothing is wrong. */
export class MailOAuthUnreachable extends Error {}

/** The provider ended the mailbox's sign-in: its person signs in anew (state `signin`). */
export class MailSignInNeeded extends Error {
  constructor(provider: MailOAuthProvider) {
    super(signInAgainText(provider));
    this.name = 'MailSignInNeeded';
  }
}

export const signInAgainText = (provider: MailOAuthProvider) =>
  `${MAIL_OAUTH_LABELS[provider]} hat die Anmeldung dieses Postfachs beendet – melde dich neu an.`;

/** Answers of a token endpoint that mean: this grant is over, only a new sign-in helps. */
const ENDED = new Set([
  'invalid_grant',
  'interaction_required',
  'consent_required',
  'login_required',
]);

/** The provider's sign-in page for a mailbox. */
export function mailAuthorizeUrl(
  config: Config,
  provider: MailOAuthProvider,
  pkce: Pkce,
  loginHint?: string,
): string {
  const spec = MAIL_OAUTH[provider];
  const client = spec.client(config);
  if (!client) throw new Error(`${provider} login is not configured`);
  const url = new URL(spec.authorizeUrl(config));
  url.search = new URLSearchParams({
    client_id: client.clientId,
    response_type: 'code',
    // The login's redirect URI – the registered one; the state tells the callback it is mail.
    redirect_uri: client.redirectUri,
    scope: `${spec.scopes} ${spec.calendarScopes}`,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    ...spec.authorizeParams,
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

interface TokenBody {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  deps: Pick<AppDeps, 'config' | 'mailOAuthFetch'>,
  provider: MailOAuthProvider,
  form: Record<string, string>,
): Promise<TokenBody> {
  const spec = MAIL_OAUTH[provider];
  const client = spec.client(deps.config);
  if (!client) throw new MailOAuthError('not_configured');
  const fetch: Fetch = deps.mailOAuthFetch ?? globalThis.fetch;
  const response = await fetch(spec.tokenUrl(deps.config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      ...form,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => {
    throw new MailOAuthUnreachable(`${MAIL_OAUTH_LABELS[provider]} ist gerade nicht erreichbar.`, {
      cause: error,
    });
  });
  const body = (await response.json().catch(() => ({}))) as TokenBody;
  if (!response.ok) {
    if (response.status >= 500 && !body.error) {
      throw new MailOAuthUnreachable(`${MAIL_OAUTH_LABELS[provider]} antwortet gerade nicht.`);
    }
    throw new MailOAuthError(body.error ?? `http_${response.status}`, body.error_description);
  }
  return body;
}

export interface MailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** The code for the mailbox's tokens, the address that signed in and its servers. */
export async function exchangeMailCode(
  deps: Pick<AppDeps, 'config' | 'mailOAuthFetch' | 'clock'>,
  provider: MailOAuthProvider,
  code: string,
  pkce: { verifier: string; nonce: string },
): Promise<MailTokens & { address: string | null; servers: MailServerSettings }> {
  const spec = MAIL_OAUTH[provider];
  const client = spec.client(deps.config)!;
  const body = await tokenRequest(deps, provider, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: client.redirectUri,
    code_verifier: pkce.verifier,
    // Microsoft wants the scopes again; Google takes the grant's.
    ...(provider === 'microsoft' ? { scope: spec.scopes } : {}),
  });
  if (!body.id_token || !body.access_token || !body.refresh_token) {
    // No refresh token: offline access was not granted – reading every minute could not go on.
    throw new MailOAuthError('missing_token', 'a token was not granted');
  }
  const claims = validateIdToken(body.id_token, {
    issuer: spec.issuer,
    clientId: client.clientId,
    nonce: pkce.nonce,
    now: deps.clock.now(),
  });
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: expiry(deps, body),
    address: spec.address(claims),
    servers: spec.servers(claims),
  };
}

const expiry = (deps: Pick<AppDeps, 'clock'>, body: TokenBody) =>
  // An hour, as both say; without a word five minutes – asked again after that.
  new Date(deps.clock.now().getTime() + (Number(body.expires_in) || 300) * 1000);

// ── Access tokens in use ───────────────────────────────────────────────────

/** Asked for anew this long before it ends: a round reading mail takes a while. */
const EARLY_MS = 5 * 60_000;
const held = new Map<string, { token: string; expiresAt: number }>();
const asking = new Map<string, Promise<string>>();

/** Keeps a mailbox's access token (just signed in) for its next rounds. */
export function holdMailToken(
  accountId: string,
  tokens: Pick<MailTokens, 'accessToken' | 'expiresAt'>,
) {
  held.set(accountId, { token: tokens.accessToken, expiresAt: tokens.expiresAt.getTime() });
}

/** The mailbox is deleted or signs in anew: its access token goes. */
export function forgetMailToken(accountId: string) {
  held.delete(accountId);
  held.delete(calendarKey(accountId));
}

const calendarKey = (accountId: string) => `${accountId}#calendar`;

/**
 * An access token for a mailbox that signs in through its provider: the one held, or a new one
 * for its refresh token (a new refresh token the provider hands out is kept). A grant the
 * provider ended marks the mailbox `signin` and drops the refresh token – no further tries until
 * its person signs in anew – and throws `MailSignInNeeded`.
 */
export function mailAccessToken(deps: AppDeps, row: MailAccountRow): Promise<string> {
  const provider = row.auth as MailOAuthProvider;
  const now = deps.clock.now().getTime();
  const kept = held.get(row.id);
  if (kept && kept.expiresAt - EARLY_MS > now) return Promise.resolve(kept.token);
  if (!row.refreshToken || row.state === 'signin') {
    return Promise.reject(new MailSignInNeeded(provider));
  }
  // One refresh at a time per mailbox: a round and a reply at once ask once.
  const running = asking.get(row.id);
  if (running) return running;
  const refresh = (async () => {
    let body: TokenBody;
    try {
      body = await tokenRequest(deps, provider, {
        grant_type: 'refresh_token',
        refresh_token: row.refreshToken!,
        ...(MAIL_OAUTH[provider].refreshScopes
          ? { scope: MAIL_OAUTH[provider].refreshScopes! }
          : {}),
      });
    } catch (error) {
      if (error instanceof MailOAuthError && ENDED.has(error.code)) {
        held.delete(row.id);
        await deps.db
          .update(mailAccounts)
          .set({ state: 'signin', error: signInAgainText(provider), refreshToken: null })
          .where(eq(mailAccounts.id, row.id));
        throw new MailSignInNeeded(provider);
      }
      throw error instanceof MailOAuthUnreachable
        ? error
        : new MailOAuthUnreachable(
            `${MAIL_OAUTH_LABELS[provider]} hat keinen neuen Zugang ausgegeben – es geht beim nächsten Abruf weiter.`,
            { cause: error },
          );
    }
    if (!body.access_token) throw new MailOAuthUnreachable('No access token');
    if (body.refresh_token && body.refresh_token !== row.refreshToken) {
      await deps.db
        .update(mailAccounts)
        .set({ refreshToken: body.refresh_token })
        .where(eq(mailAccounts.id, row.id));
    }
    holdMailToken(row.id, { accessToken: body.access_token, expiresAt: expiry(deps, body) });
    return body.access_token;
  })().finally(() => asking.delete(row.id));
  asking.set(row.id, refresh);
  return refresh;
}

/**
 * An access token to read a mailbox's calendars. Google's one token carries every scope granted
 * (the mailbox's, `mailAccessToken`); Microsoft's calendars are Graph's, another resource, so its
 * refresh token is asked for a Graph token apart. A refusal here never touches the mailbox: one
 * signed in before calendars were asked for has no consent to them (`consent_required`) and keeps
 * reading mail – it throws `MailOAuthError` and the calendars stay away until it signs in anew.
 */
export async function calendarAccessToken(deps: AppDeps, row: MailAccountRow): Promise<string> {
  const provider = row.auth as MailOAuthProvider;
  if (provider !== 'microsoft') return mailAccessToken(deps, row);
  const key = calendarKey(row.id);
  const kept = held.get(key);
  if (kept && kept.expiresAt - EARLY_MS > deps.clock.now().getTime()) return kept.token;
  if (!row.refreshToken || row.state === 'signin') throw new MailSignInNeeded(provider);
  const running = asking.get(key);
  if (running) return running;
  const refresh = (async () => {
    const body = await tokenRequest(deps, provider, {
      grant_type: 'refresh_token',
      refresh_token: row.refreshToken!,
      scope: `offline_access ${MAIL_OAUTH.microsoft.calendarScopes}`,
    });
    if (!body.access_token) throw new MailOAuthUnreachable('No access token');
    // Microsoft's refresh tokens are for every resource consented to: a new one serves mail too.
    if (body.refresh_token && body.refresh_token !== row.refreshToken) {
      await deps.db
        .update(mailAccounts)
        .set({ refreshToken: body.refresh_token })
        .where(eq(mailAccounts.id, row.id));
    }
    held.set(key, { token: body.access_token, expiresAt: expiry(deps, body).getTime() });
    return body.access_token;
  })().finally(() => asking.delete(key));
  asking.set(key, refresh);
  return refresh;
}
