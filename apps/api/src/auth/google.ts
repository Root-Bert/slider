import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Clock } from '../clock';
import type { GoogleDriveConfig } from '../config';
import type { Executor } from '../db/client';
import { googleConnections, type GoogleConnectionRow } from '../db/schema';
import { ApiError } from '../http/errors';
import type { Logger } from '../logger';
import { sourceUnreachable } from '../sources/errors';
import { validateIdToken, type IdTokenClaims } from './id-token';
import type { Pkce } from './microsoft';
import { decryptToken, encryptToken } from './token-crypto';

/**
 * Google Drive file access (BER-119): OAuth 2.0 authorization code flow with PKCE against Google,
 * through the same client and callback as "Weiter mit Google". Slider asks for `drive.file` only
 * – a non-sensitive scope: it reaches the files a person picks in Google's picker, nothing else
 * of their Drive. The picker is Google's own page (BER-158), opened as an authorization
 * (`trigger_onepick`). Refresh tokens live encrypted on the connection row, access tokens (~1 h)
 * only in memory.
 */

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_DRIVE_SCOPES = `openid email profile ${GOOGLE_DRIVE_SCOPE}`;

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const TOKEN_PURPOSE = 'google-refresh-token';
/** Refresh a little early so a token never expires between check and use. */
const EXPIRY_SKEW_MS = 60_000;

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * What went wrong at Google, as far as the web app needs to know (`?googleError=`). `account`:
 * picked with a Google account that is not connected to Slider.
 */
export type GoogleErrorKind = 'denied' | 'scope' | 'account' | 'failed';

export class GoogleAuthError extends Error {
  constructor(
    readonly kind: GoogleErrorKind,
    /** `error` code from Google, e.g. `invalid_grant`. */
    readonly error: string,
    description = '',
    /** HTTP status of the token endpoint's answer, when there was one. */
    readonly status?: number,
  ) {
    super(`${error}: ${description}`);
    this.name = 'GoogleAuthError';
  }
}

export const GOOGLE_LOGIN_MESSAGE =
  'Die Präsentation liegt in Google Drive. Wähle sie einmal in Google aus, damit Slider sie lesen darf – oder lade die Datei hoch.';

/**
 * The file needs a Google account that may read it. Slider only sees files picked in Google's
 * picker, so the web app opens it on `googleFileId`; `loginUrl` connects an account first.
 */
export const googleLoginRequired = (returnTo: string, fileId?: string) =>
  new ApiError(401, 'google_login_required', GOOGLE_LOGIN_MESSAGE, {
    loginUrl: googleDriveConnectUrl(returnTo),
    ...(fileId ? { googleFileId: fileId } : {}),
  });

export const googleNotConfigured = () =>
  new ApiError(
    503,
    'google_not_configured',
    'Google Drive ist auf diesem Server nicht eingerichtet. Trage GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET ein – oder lade die Datei hoch.',
  );

export const googleAppRejected = () =>
  new ApiError(
    503,
    'google_not_configured',
    'Google lehnt die Anmeldung dieses Servers ab – vermutlich ist GOOGLE_CLIENT_SECRET falsch. Trage ein gültiges Secret ein und starte Slider neu; die Verbindungen der Nutzer bleiben erhalten.',
  );

/** Where the browser connects Google Drive; comes back to `returnTo`. */
export const googleDriveConnectUrl = (returnTo: string, connectionId?: string | null) =>
  `/api/auth/google/drive?returnTo=${encodeURIComponent(returnTo)}${
    connectionId ? `&connection=${encodeURIComponent(connectionId)}` : ''
  }`;

/**
 * `prompt=consent` with `access_type=offline`: Google hands out a refresh token only on consent.
 * `loginHint` preselects the account when a connection is renewed.
 */
export function googleDriveAuthorizeUrl(
  config: GoogleDriveConfig,
  pkce: Pkce,
  loginHint?: string | null,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: GOOGLE_DRIVE_SCOPES,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

/**
 * Google's file picker as its own page (BER-158): an authorization that shows the picker
 * (`trigger_onepick`) and comes back with `picked_file_ids`. Google allows `drive.file` alone
 * here, so the account is told apart afterwards (`completePick`); `loginHint` preselects the
 * connected one. `fileId`: only that file, for a pasted link Slider may not read yet.
 */
export function googlePickAuthorizeUrl(
  config: GoogleDriveConfig,
  pkce: Pkce,
  { loginHint, fileId }: { loginHint?: string | null; fileId?: string | null } = {},
): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: GOOGLE_DRIVE_SCOPE,
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    trigger_onepick: 'true',
    // No `mimetypes`: the picker shows every file.
    ...(fileId ? { file_ids: fileId } : {}),
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  /** Space-separated; Google's consent screen lets people untick Drive. */
  scope?: string;
}

/** Google is down or throttling: try again later, the grant itself is fine. */
const isTransient = (error: GoogleAuthError) =>
  error.error === 'temporarily_unavailable' ||
  error.status === 429 ||
  (error.status !== undefined && error.status >= 500);
/** The client itself is refused (wrong secret): every grant is still valid. */
const isAppRejected = (error: GoogleAuthError) =>
  error.error === 'invalid_client' || error.error === 'unauthorized_client';

export interface GoogleTokensDeps {
  /** `null` without Google Drive set up – then nobody has tokens. */
  config: GoogleDriveConfig | null;
  secret: string;
  db: Executor;
  clock: Clock;
  log: Logger;
  fetch?: Fetch;
}

/** Delegated Google tokens per connected Google account (`google_connections`). */
export class GoogleTokens {
  private readonly cache = new Map<string, { accessToken: string; expiresAt: number }>();
  /** Refreshes under way: parallel requests for one token trade it in once. */
  private readonly refreshing = new Map<string, Promise<string | null>>();
  private readonly fetch: Fetch;

  constructor(private readonly deps: GoogleTokensDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch;
  }

  get config(): GoogleDriveConfig | null {
    return this.deps.config;
  }

  /**
   * "Connect Google Drive": trades the code and stores the tokens as a connection of `userId` – a
   * new one, or the existing one of the same Google account refreshed.
   */
  async completeConnect(
    userId: string,
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<{ claims: IdTokenClaims; connectionId: string }> {
    const config = this.requireConfig();
    const tokens = await this.requestToken(config, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    if (!tokens.id_token) throw new GoogleAuthError('failed', 'no_id_token', 'openid not granted');
    const claims = validateIdToken(tokens.id_token, {
      issuer: (iss) => GOOGLE_ISSUERS.includes(iss),
      clientId: config.clientId,
      nonce,
      now: this.deps.clock.now(),
    });
    if (!(tokens.scope ?? '').split(' ').includes(GOOGLE_DRIVE_SCOPE)) {
      throw new GoogleAuthError('scope', 'scope_missing', 'drive.file was not granted');
    }
    if (!tokens.refresh_token) {
      throw new GoogleAuthError('failed', 'no_refresh_token', 'offline access was not granted');
    }
    const refreshToken = await encryptToken(this.deps.secret, tokens.refresh_token, TOKEN_PURPOSE);
    const account = typeof claims.email === 'string' ? claims.email : null;
    const now = this.deps.clock.now();
    const [row] = await this.deps.db
      .insert(googleConnections)
      .values({
        id: crypto.randomUUID(),
        userId,
        subject: claims.sub,
        account,
        refreshToken,
        createdAt: now,
        lastUsedAt: now,
      })
      .onConflictDoUpdate({
        target: [googleConnections.userId, googleConnections.subject],
        set: { account, refreshToken, lastUsedAt: now },
      })
      .returning({ id: googleConnections.id });
    if (!row) throw new Error('Google connection was not stored');
    this.dropCache(row.id);
    this.remember(row.id, tokens);
    return { claims, connectionId: row.id };
  }

  /**
   * Back from Google's picker: trades the code and finds which of the user's connections picked
   * – by the Drive account's address, since the picker grants `drive.file` without an ID token.
   * Its refresh token is renewed (the old one keeps working too: the grant is the app's).
   */
  async completePick(userId: string, code: string, verifier: string): Promise<string> {
    const config = this.requireConfig();
    const tokens = await this.requestToken(config, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    if (!(tokens.scope ?? '').split(' ').includes(GOOGLE_DRIVE_SCOPE)) {
      throw new GoogleAuthError('scope', 'scope_missing', 'drive.file was not granted');
    }
    const email = (await this.driveAccount(tokens.access_token))?.toLowerCase();
    const rows = await this.deps.db
      .select({ id: googleConnections.id, account: googleConnections.account })
      .from(googleConnections)
      .where(eq(googleConnections.userId, userId));
    const row = email ? rows.find((r) => r.account?.toLowerCase() === email) : undefined;
    if (!row) throw new GoogleAuthError('account', 'account_not_connected', email ?? '');
    await this.deps.db
      .update(googleConnections)
      .set({
        lastUsedAt: this.deps.clock.now(),
        ...(tokens.refresh_token
          ? {
              refreshToken: await encryptToken(
                this.deps.secret,
                tokens.refresh_token,
                TOKEN_PURPOSE,
              ),
            }
          : {}),
      })
      .where(eq(googleConnections.id, row.id));
    this.dropCache(row.id);
    this.remember(row.id, tokens);
    return row.id;
  }

  /** The address of the Drive the token belongs to. */
  private async driveAccount(accessToken: string): Promise<string | null> {
    const response = await this.fetch(ABOUT_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw sourceUnreachable(
        'Google ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
      );
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GoogleAuthError('failed', `http_${response.status}`, 'about.get', response.status);
    }
    const body = (await response.json().catch(() => ({}))) as {
      user?: { emailAddress?: unknown };
    };
    return typeof body.user?.emailAddress === 'string' ? body.user.emailAddress : null;
  }

  /** The user's connections that still have a token, most recently used first. */
  async connectionIds(userId: string): Promise<string[]> {
    const rows = await this.deps.db
      .select({ id: googleConnections.id })
      .from(googleConnections)
      .where(and(eq(googleConnections.userId, userId), isNotNull(googleConnections.refreshToken)))
      .orderBy(
        sql`${googleConnections.lastUsedAt} desc nulls last`,
        desc(googleConnections.createdAt),
        asc(googleConnections.id),
      );
    return rows.map((row) => row.id);
  }

  /** One of the user's own connections – `null` for anyone else's. */
  async findConnection(userId: string, connectionId: string): Promise<GoogleConnectionRow | null> {
    const [row] = await this.deps.db
      .select()
      .from(googleConnections)
      .where(and(eq(googleConnections.id, connectionId), eq(googleConnections.userId, userId)));
    return row ?? null;
  }

  async markUsed(connectionId: string): Promise<void> {
    await this.deps.db
      .update(googleConnections)
      .set({ lastUsedAt: this.deps.clock.now() })
      .where(eq(googleConnections.id, connectionId));
  }

  /**
   * A valid access token of the connection, refreshed when needed; `null` when there is none
   * (Google revoked it, or Drive is not set up). `forceRefresh` after Google answered 401.
   */
  async getAccessToken(
    connectionId: string,
    { forceRefresh = false }: { forceRefresh?: boolean } = {},
  ): Promise<string | null> {
    const config = this.deps.config;
    if (!config) return null;
    const cached = this.cache.get(connectionId);
    if (cached && !forceRefresh && cached.expiresAt > this.deps.clock.now().getTime()) {
      return cached.accessToken;
    }
    let running = this.refreshing.get(connectionId);
    if (!running) {
      running = this.refresh(config, connectionId).finally(() =>
        this.refreshing.delete(connectionId),
      );
      this.refreshing.set(connectionId, running);
    }
    return running;
  }

  private async refresh(config: GoogleDriveConfig, connectionId: string): Promise<string | null> {
    const [row] = await this.deps.db
      .select({ token: googleConnections.refreshToken })
      .from(googleConnections)
      .where(eq(googleConnections.id, connectionId));
    if (!row?.token) return null;
    let refreshToken: string;
    try {
      refreshToken = await decryptToken(this.deps.secret, row.token, TOKEN_PURPOSE);
    } catch {
      // Encrypted with another SLIDER_SECRET: unusable, ask to connect again.
      await this.forgetToken(connectionId);
      return null;
    }
    let tokens: TokenResponse;
    try {
      tokens = await this.requestToken(config, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
    } catch (error) {
      if (!(error instanceof GoogleAuthError)) throw error;
      this.deps.log.warn(
        `Google token refresh failed for connection ${connectionId}: ${error.message}`,
      );
      if (isTransient(error)) {
        throw sourceUnreachable(
          'Google ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
        );
      }
      if (isAppRejected(error)) throw googleAppRejected();
      // invalid_grant: access removed in the Google account, or expired.
      await this.forgetToken(connectionId);
      return null;
    }
    await this.deps.db
      .update(googleConnections)
      .set({ lastUsedAt: this.deps.clock.now() })
      .where(eq(googleConnections.id, connectionId));
    return this.remember(connectionId, tokens);
  }

  /** Google refused the refresh token: the connection stays, but needs a new connect. */
  async forgetToken(connectionId: string): Promise<void> {
    this.dropCache(connectionId);
    await this.deps.db
      .update(googleConnections)
      .set({ refreshToken: null })
      .where(eq(googleConnections.id, connectionId));
  }

  dropCache(connectionId: string): void {
    this.cache.delete(connectionId);
  }

  /**
   * Revokes the grant at Google, so the account's "Third-party access" no longer lists Slider.
   * `false` when Google could not be asked – the person can remove it there.
   */
  async revoke(row: Pick<GoogleConnectionRow, 'id' | 'refreshToken'>): Promise<boolean> {
    this.dropCache(row.id);
    if (!row.refreshToken) return true;
    let token: string;
    try {
      token = await decryptToken(this.deps.secret, row.refreshToken, TOKEN_PURPOSE);
    } catch {
      return false;
    }
    try {
      const response = await this.fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      // 400 `invalid_token`: already revoked at Google.
      return response.ok || response.status === 400;
    } catch (error) {
      this.deps.log.warn(`Could not revoke a Google grant (connection ${row.id})`, error);
      return false;
    }
  }

  private async requestToken(
    config: GoogleDriveConfig,
    grant: Record<string, string>,
  ): Promise<TokenResponse> {
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...grant,
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw sourceUnreachable(
        'Google ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
      );
    });
    const body = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      const error = body.error ?? `http_${response.status}`;
      throw new GoogleAuthError(
        error === 'access_denied' ? 'denied' : 'failed',
        error,
        body.error_description,
        response.status,
      );
    }
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      id_token: body.id_token,
      expires_in: body.expires_in ?? 3600,
      scope: body.scope,
    };
  }

  private remember(connectionId: string, tokens: TokenResponse): string {
    this.cache.set(connectionId, {
      accessToken: tokens.access_token,
      expiresAt: this.deps.clock.now().getTime() + tokens.expires_in * 1000 - EXPIRY_SKEW_MS,
    });
    return tokens.access_token;
  }

  private requireConfig(): GoogleDriveConfig {
    if (!this.deps.config) throw new Error('Google Drive is not configured');
    return this.deps.config;
  }
}
