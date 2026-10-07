import { eq } from 'drizzle-orm';
import type { Clock } from '../clock';
import type { MicrosoftConfig } from '../config';
import type { Executor } from '../db/client';
import { users } from '../db/schema';
import type { Logger } from '../logger';
import { microsoftConsentRequired, sourceUnreachable } from '../sources/errors';
import { decryptToken, encryptToken, toBase64Url } from './token-crypto';

/**
 * Microsoft sign-in for OneDrive/SharePoint links (BER-92): OAuth 2.0 authorization code flow
 * with PKCE plus the client secret, against the Microsoft identity platform v2. Plain `fetch`,
 * no MSAL – Slider needs only "code → tokens" and "refresh token → access token".
 */

export const MICROSOFT_SCOPES = 'Files.Read.All offline_access User.Read';
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
}

const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

export async function createPkce(): Promise<Pkce> {
  const verifier = randomToken();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { state: randomToken(), verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

export function buildAuthorizeUrl(config: MicrosoftConfig, pkce: Pkce): string {
  const url = new URL(`${authority(config)}/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function requestToken(
  config: MicrosoftConfig,
  fetch: Fetch,
  grant: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(`${authority(config)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: MICROSOFT_SCOPES,
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

export const refreshAccessToken = (config: MicrosoftConfig, fetch: Fetch, refreshToken: string) =>
  requestToken(config, fetch, { grant_type: 'refresh_token', refresh_token: refreshToken });

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

  /** Finishes the login: trades the code for tokens and stores them for `userId`. */
  async completeLogin(userId: string, code: string, verifier: string): Promise<void> {
    const config = this.requireConfig();
    const tokens = await exchangeCode(config, this.fetch, code, verifier);
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
    this.remember(userId, tokens);
  }

  /**
   * A valid access token for `userId`, refreshed when needed; `null` when the person has never
   * signed in (or their sign-in was revoked). `forceRefresh` after Graph answered 401.
   */
  async getAccessToken(userId: string, { forceRefresh = false } = {}): Promise<string | null> {
    const config = this.deps.config;
    if (!config) return null;
    const cached = this.cache.get(userId);
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

    try {
      const tokens = await refreshAccessToken(config, this.fetch, refreshToken);
      if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
        await this.deps.db
          .update(users)
          .set({ msRefreshToken: await encryptToken(this.deps.secret, tokens.refresh_token) })
          .where(eq(users.id, userId));
      }
      return this.remember(userId, tokens);
    } catch (error) {
      if (!(error instanceof MicrosoftAuthError)) throw error;
      if (error.kind === 'admin_consent') throw microsoftConsentRequired();
      this.deps.log.warn(`Microsoft token refresh failed for user ${userId}: ${error.message}`);
      // invalid_grant (revoked, expired, password changed) and friends: sign in again.
      await this.forget(userId);
      return null;
    }
  }

  async forget(userId: string): Promise<void> {
    this.cache.delete(userId);
    await this.deps.db
      .update(users)
      .set({ msRefreshToken: null, msAccount: null })
      .where(eq(users.id, userId));
  }

  private remember(userId: string, tokens: TokenResponse): string {
    this.cache.set(userId, {
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
