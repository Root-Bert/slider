import { eq } from 'drizzle-orm';
import type { Clock } from '../clock';
import type { MicrosoftConfig } from '../config';
import type { Executor } from '../db/client';
import { users } from '../db/schema';
import type { Logger } from '../logger';
import { microsoftConsentRequired, sourceUnreachable } from '../sources/errors';
import { validateIdToken, type IdTokenClaims } from './id-token';
import { decryptToken, encryptToken, toBase64Url } from './token-crypto';

/**
 * Microsoft sign-in (BER-92, BER-129): OAuth 2.0 authorization code flow with PKCE plus the
 * client secret, against the Microsoft identity platform v2. One login yields both the identity
 * (ID token: `tid` + `oid`) and the Graph refresh token for OneDrive/SharePoint links. Plain
 * `fetch`, no MSAL – Slider needs only "code → tokens" and "refresh token → access token".
 */

export const MICROSOFT_SCOPES = 'openid profile email offline_access User.Read Files.Read.All';
/**
 * Asked for only when the owner first edits a linked PowerPoint (BER-128): reading never needs
 * more, and a write consent is a bigger ask (in companies often one for an admin).
 */
export const MICROSOFT_WRITE_SCOPES =
  'openid profile email offline_access User.Read Files.ReadWrite.All';

/** `read` for importing and syncing, `write` for changing the PowerPoint itself. */
export type MicrosoftAccess = 'read' | 'write';
const scopesFor = (access: MicrosoftAccess) =>
  access === 'write' ? MICROSOFT_WRITE_SCOPES : MICROSOFT_SCOPES;
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName';
/** Refresh a little early so a token never expires between check and use. */
const EXPIRY_SKEW_MS = 60_000;

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const authority = (config: MicrosoftConfig) =>
  `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0`;

/** What went wrong at Microsoft, as far as the web app needs to know (`?msError=`). */
export type MicrosoftErrorKind = 'admin_consent' | 'denied' | 'failed';

/** Thrown for error responses of the authorize and token endpoints. */
export class MicrosoftAuthError extends Error {
  constructor(
    readonly kind: MicrosoftErrorKind,
    /** `error` code from Microsoft, e.g. `invalid_grant`. */
    readonly error: string,
    description = '',
  ) {
    super(`${error}: ${description}`);
    this.name = 'MicrosoftAuthError';
  }
}

const ADMIN_CONSENT_CODES = /AADSTS(65001|90094|90095)\b/;

/**
 * AADSTS65001 (no consent), 90094/90095 (admin approval required) and similar descriptions
 * mean an admin has to approve Slider once; `access_denied` alone means the person cancelled.
 */
export function mapMicrosoftError(error: string, description = ''): MicrosoftErrorKind {
  const text = `${error} ${description}`;
  if (
    ADMIN_CONSENT_CODES.test(text) ||
    error === 'consent_required' ||
    /admin (approval|consent)/i.test(text)
  ) {
    return 'admin_consent';
  }
  if (error === 'access_denied') return 'denied';
  return 'failed';
}

export interface Pkce {
  state: string;
  verifier: string;
  challenge: string;
  /** Echoed in the ID token; binds it to this browser's login attempt. */
  nonce: string;
}

const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

export async function createPkce(): Promise<Pkce> {
  const verifier = randomToken();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return {
    state: randomToken(),
    verifier,
    challenge: toBase64Url(new Uint8Array(digest)),
    nonce: randomToken(),
  };
}

export function buildAuthorizeUrl(
  config: MicrosoftConfig,
  pkce: Pkce,
  access: MicrosoftAccess = 'read',
): string {
  const url = new URL(`${authority(config)}/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: scopesFor(access),
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

async function requestToken(
  config: MicrosoftConfig,
  fetch: Fetch,
  grant: Record<string, string>,
  scope: string = MICROSOFT_SCOPES,
): Promise<TokenResponse> {
  const response = await fetch(`${authority(config)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope,
      ...grant,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    throw sourceUnreachable(
      'Microsoft ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
    );
  });
  const body = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    const error = body.error ?? `http_${response.status}`;
    throw new MicrosoftAuthError(
      mapMicrosoftError(error, body.error_description),
      error,
      body.error_description,
    );
  }
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    id_token: body.id_token,
    expires_in: body.expires_in ?? 3600,
  };
}

export const exchangeCode = (
  config: MicrosoftConfig,
  fetch: Fetch,
  code: string,
  verifier: string,
) =>
  requestToken(config, fetch, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });

export const refreshAccessToken = (
  config: MicrosoftConfig,
  fetch: Fetch,
  refreshToken: string,
  access: MicrosoftAccess = 'read',
) => refreshForScope(config, fetch, refreshToken, scopesFor(access));

/** Trades the refresh token for a token of another resource, e.g. SharePoint for the file picker. */
export const refreshForScope = (
  config: MicrosoftConfig,
  fetch: Fetch,
  refreshToken: string,
  scope: string,
) =>
  requestToken(config, fetch, { grant_type: 'refresh_token', refresh_token: refreshToken }, scope);

export interface MicrosoftTokensDeps {
  /** `null` when no app registration is configured – then nobody has tokens. */
  config: MicrosoftConfig | null;
  /** Encrypts refresh tokens at rest. */
  secret: string;
  db: Executor;
  clock: Clock;
  log: Logger;
  fetch?: Fetch;
}

/**
 * Delegated Microsoft tokens per Slider user. Refresh tokens live encrypted on the `users` row,
 * access tokens (~1 h) only in memory.
 */
export class MicrosoftTokens {
  private readonly cache = new Map<string, { accessToken: string; expiresAt: number }>();
  private readonly fetch: Fetch;

  constructor(private readonly deps: MicrosoftTokensDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch;
  }

  get configured(): boolean {
    return this.deps.config !== null;
  }

  /** "Connect for file access" of a signed-in account: trades the code and stores the tokens. */
  async completeLogin(userId: string, code: string, verifier: string): Promise<void> {
    const tokens = await exchangeCode(this.requireConfig(), this.fetch, code, verifier);
    await this.saveTokens(userId, tokens);
  }

  /**
   * Login with Microsoft: trades the code and returns the validated identity plus the tokens,
   * which the caller stores with {@link saveTokens} once it knows the account.
   */
  async exchangeLogin(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<{ claims: IdTokenClaims; tokens: TokenResponse }> {
    const config = this.requireConfig();
    const tokens = await exchangeCode(config, this.fetch, code, verifier);
    if (!tokens.id_token) {
      throw new MicrosoftAuthError('failed', 'no_id_token', 'openid was not granted');
    }
    const claims = validateIdToken(tokens.id_token, {
      // Multi-tenant (`common`): the issuer names the tenant of the account.
      issuer: (iss, all) =>
        typeof all['tid'] === 'string' &&
        iss === `https://login.microsoftonline.com/${all['tid']}/v2.0`,
      clientId: config.clientId,
      nonce,
      now: this.deps.clock.now(),
    });
    return { claims, tokens };
  }

  /** Stores the refresh token (encrypted) for `userId` and caches the access token. */
  async saveTokens(userId: string, tokens: TokenResponse): Promise<void> {
    if (!tokens.refresh_token) {
      throw new MicrosoftAuthError('failed', 'no_refresh_token', 'offline_access was not granted');
    }
    const account = await this.fetchAccount(tokens.access_token);
    await this.deps.db
      .update(users)
      .set({
        msRefreshToken: await encryptToken(this.deps.secret, tokens.refresh_token),
        msAccount: account,
      })
      .where(eq(users.id, userId));
    this.remember(`${userId}:read`, tokens);
  }

  /**
   * A valid access token for `userId`, refreshed when needed; `null` when the person has never
   * signed in (or their sign-in was revoked). `forceRefresh` after Graph answered 401.
   *
   * `access: 'write'` trades the same refresh token for a token with write scopes. Without that
   * consent yet it returns `null` (the caller asks for a write login) and keeps the sign-in, so
   * reading goes on working.
   */
  async getAccessToken(
    userId: string,
    {
      forceRefresh = false,
      access = 'read',
    }: { forceRefresh?: boolean; access?: MicrosoftAccess } = {},
  ): Promise<string | null> {
    const cacheKey = `${userId}:${access}`;
    try {
      return await this.refreshed(userId, cacheKey, scopesFor(access), forceRefresh);
    } catch (error) {
      if (!(error instanceof MicrosoftAuthError)) throw error;
      if (access === 'write') {
        // Most likely no write consent yet (AADSTS65001): a write login fixes it.
        this.deps.log.warn(`Microsoft write token refused for user ${userId}: ${error.message}`);
        return null;
      }
      if (error.kind === 'admin_consent') throw microsoftConsentRequired();
      this.deps.log.warn(`Microsoft token refresh failed for user ${userId}: ${error.message}`);
      // invalid_grant (revoked, expired, password changed) and friends: sign in again.
      await this.forget(userId);
      return null;
    }
  }

  /**
   * A token for another resource than Graph, from the same refresh token – the OneDrive file
   * picker needs SharePoint (`https://{host}/.default`) or `OneDrive.ReadOnly` tokens. `null`
   * without a sign-in; a refusal (e.g. the app registration lacks the SharePoint permissions)
   * throws {@link MicrosoftAuthError} and leaves the sign-in alone.
   */
  getScopedToken(userId: string, scope: string): Promise<string | null> {
    return this.refreshed(userId, `${userId}:${scope}`, scope, false);
  }

  /** Cached access token for `scope`, else one traded for the stored refresh token. */
  private async refreshed(
    userId: string,
    cacheKey: string,
    scope: string,
    forceRefresh: boolean,
  ): Promise<string | null> {
    const config = this.deps.config;
    if (!config) return null;
    const cached = this.cache.get(cacheKey);
    if (cached && !forceRefresh && cached.expiresAt > this.deps.clock.now().getTime()) {
      return cached.accessToken;
    }

    const [row] = await this.deps.db
      .select({ token: users.msRefreshToken })
      .from(users)
      .where(eq(users.id, userId));
    if (!row?.token) return null;

    let refreshToken: string;
    try {
      refreshToken = await decryptToken(this.deps.secret, row.token);
    } catch {
      // Encrypted with another SLIDER_SECRET: unusable, ask for a new login.
      await this.forget(userId);
      return null;
    }

    const tokens = await refreshForScope(config, this.fetch, refreshToken, scope);
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      await this.deps.db
        .update(users)
        .set({ msRefreshToken: await encryptToken(this.deps.secret, tokens.refresh_token) })
        .where(eq(users.id, userId));
    }
    return this.remember(cacheKey, tokens);
  }

  async forget(userId: string): Promise<void> {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) this.cache.delete(key);
    }
    await this.deps.db
      .update(users)
      .set({ msRefreshToken: null, msAccount: null })
      .where(eq(users.id, userId));
  }

  private remember(cacheKey: string, tokens: TokenResponse): string {
    this.cache.set(cacheKey, {
      accessToken: tokens.access_token,
      expiresAt: this.deps.clock.now().getTime() + tokens.expires_in * 1000 - EXPIRY_SKEW_MS,
    });
    return tokens.access_token;
  }

  /** The signed-in account's address, for display; `null` if Graph does not tell. */
  private async fetchAccount(accessToken: string): Promise<string | null> {
    try {
      const response = await this.fetch(GRAPH_ME_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const me = (await response.json()) as { mail?: string | null; userPrincipalName?: string };
      return me.mail ?? me.userPrincipalName ?? null;
    } catch {
      return null;
    }
  }

  private requireConfig(): MicrosoftConfig {
    if (!this.deps.config) throw new Error('Microsoft login is not configured');
    return this.deps.config;
  }
}
