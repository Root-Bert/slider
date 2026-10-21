import { and, asc, count, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Clock } from '../clock';
import type { MicrosoftConfig } from '../config';
import { advisoryXactLock, type Executor } from '../db/client';
import { microsoftConnections } from '../db/schema';
import type { Logger } from '../logger';
import { ApiError } from '../http/errors';
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
 * The OneDrive file picker for personal accounts takes `OneDrive.ReadOnly` tokens – a scope only
 * the `consumers` authority knows, and one a person has to grant once (BER-131).
 */
export const PICKER_CONSUMER_SCOPE = 'OneDrive.ReadOnly';
export const CONSUMERS_TENANT = 'consumers';
const PICKER_CONSENT_SCOPES = `openid offline_access ${PICKER_CONSUMER_SCOPE}`;

const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName';

/** One Microsoft account connects to at most this many Slider accounts – no endless sign-ups. */
export const MAX_ACCOUNTS_PER_MICROSOFT = 2;
/** Refresh a little early so a token never expires between check and use. */
const EXPIRY_SKEW_MS = 60_000;

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** `tenant` overrides the configured one, e.g. `consumers` for personal-account-only scopes. */
export const authority = (config: MicrosoftConfig, tenant = config.tenant) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;

/** What went wrong at Microsoft, as far as the web app needs to know (`?msError=`). */
export type MicrosoftErrorKind = 'admin_consent' | 'denied' | 'failed' | 'account_limit';

/** Thrown for error responses of the authorize and token endpoints. */
export class MicrosoftAuthError extends Error {
  constructor(
    readonly kind: MicrosoftErrorKind,
    /** `error` code from Microsoft, e.g. `invalid_grant`. */
    readonly error: string,
    description = '',
    /** HTTP status of the token endpoint's answer, when there was one. */
    readonly status?: number,
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

/** Microsoft is down or throttling: try again later, the grant itself is fine. */
const TRANSIENT_TOKEN_ERRORS = new Set(['temporarily_unavailable', 'server_error']);
/**
 * The app registration itself is refused (e.g. MS_CLIENT_SECRET expired or wrong): every user's
 * grant is still valid and works again once the admin fixes the registration.
 */
const APP_TOKEN_ERRORS = new Set(['invalid_client', 'unauthorized_client']);

/**
 * What a failed refresh means for the stored refresh token: `transient` and `app` keep it,
 * `grant` (revoked, expired, password changed, interaction required …) drops it.
 */
export function refreshFailure(error: MicrosoftAuthError): 'transient' | 'app' | 'grant' {
  if (
    TRANSIENT_TOKEN_ERRORS.has(error.error) ||
    error.status === 429 ||
    (error.status !== undefined && error.status >= 500)
  ) {
    return 'transient';
  }
  if (APP_TOKEN_ERRORS.has(error.error)) return 'app';
  return 'grant';
}

export const microsoftAppRejected = () =>
  new ApiError(
    401,
    'microsoft_not_configured',
    'Microsoft lehnt die Anmeldung dieses Servers ab – vermutlich ist MS_CLIENT_SECRET abgelaufen oder falsch. Trage ein gültiges Secret in die .env ein und starte Slider neu; die Verbindungen der Nutzer bleiben erhalten.',
  );

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

/**
 * `picker`: the one-time consent to the personal-account file picker (`consumers`).
 * `loginHint`: the account to preselect – renewing a connection whose token expired.
 */
export function buildAuthorizeUrl(
  config: MicrosoftConfig,
  pkce: Pkce,
  access: 'read' | 'picker' = 'read',
  loginHint?: string | null,
): string {
  const picker = access === 'picker';
  const url = new URL(`${authority(config, picker ? CONSUMERS_TENANT : undefined)}/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: picker ? PICKER_CONSENT_SCOPES : MICROSOFT_SCOPES,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    ...(loginHint ? { login_hint: loginHint } : {}),
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
  tenant?: string,
): Promise<TokenResponse> {
  const response = await fetch(`${authority(config, tenant)}/token`, {
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
      response.status,
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
  { scope, tenant }: { scope?: string; tenant?: string } = {},
) =>
  requestToken(
    config,
    fetch,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    },
    scope,
    tenant,
  );

export const refreshAccessToken = (config: MicrosoftConfig, fetch: Fetch, refreshToken: string) =>
  refreshForScope(config, fetch, refreshToken, MICROSOFT_SCOPES);

/** Trades the refresh token for a token of another resource, e.g. SharePoint for the file picker. */
export const refreshForScope = (
  config: MicrosoftConfig,
  fetch: Fetch,
  refreshToken: string,
  scope: string,
  tenant?: string,
) =>
  requestToken(
    config,
    fetch,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    scope,
    tenant,
  );

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

/** Prefix of the `subject` of connections from before the Graph id was recorded. */
const LEGACY_SUBJECT_PREFIX = 'legacy:';

/** `<tid>:<oid>` of a validated ID token – the `user_identities.subject` of the account. */
const identityOf = (claims: IdTokenClaims | null | undefined) =>
  claims && typeof claims.tid === 'string' && typeof claims.oid === 'string'
    ? { tenantId: claims.tid, identitySubject: `${claims.tid}:${claims.oid}` }
    : null;

/**
 * Delegated Microsoft tokens per connected Microsoft account (`microsoft_connections`, several
 * per Slider account). Refresh tokens live encrypted on the connection row, access tokens (~1 h)
 * only in memory, keyed by connection.
 */
export class MicrosoftTokens {
  private readonly cache = new Map<string, { accessToken: string; expiresAt: number }>();
  /** Refreshes under way, by cache key: parallel requests for one token trade it in once. */
  private readonly refreshing = new Map<string, Promise<string | null>>();
  private readonly fetch: Fetch;

  constructor(private readonly deps: MicrosoftTokensDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch;
  }

  get configured(): boolean {
    return this.deps.config !== null;
  }

  /**
   * "Connect for file access" of a signed-in account: trades the code and stores the tokens as
   * a connection – a new one, or the existing one of the same Microsoft account refreshed.
   */
  async completeLogin(
    userId: string,
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<{ claims: IdTokenClaims | null; connectionId: string }> {
    const config = this.requireConfig();
    const tokens = await exchangeCode(config, this.fetch, code, verifier);
    let claims: IdTokenClaims | null = null;
    if (tokens.id_token) {
      try {
        claims = this.validateLoginToken(config, tokens.id_token, nonce);
      } catch (error) {
        // File access stands on its own; only the login link is skipped.
        this.deps.log.warn('Microsoft ID token on connect not valid', error);
      }
    }
    const connectionId = await this.saveTokens(userId, tokens, claims);
    return { claims, connectionId };
  }

  /**
   * After the one-time picker consent (BER-131) for `connectionId`: the new refresh token
   * carries the grant. It replaces the stored one only if it still yields Graph tokens for the
   * same Microsoft account; then the picker token is cached too, so the picker opens right away.
   */
  async completePickerConsent(
    userId: string,
    connectionId: string | undefined,
    code: string,
    verifier: string,
  ): Promise<void> {
    const config = this.requireConfig();
    // Cookies from before several connections: the most recently used one.
    const id = connectionId ?? (await this.connectionIds(userId))[0];
    const connection = id ? await this.findConnection(userId, id) : null;
    if (!connection) throw new MicrosoftAuthError('failed', 'no_connection', 'not connected');
    const tokens = await exchangeCode(config, this.fetch, code, verifier, {
      scope: PICKER_CONSENT_SCOPES,
      tenant: CONSUMERS_TENANT,
    });
    if (!tokens.refresh_token) {
      this.remember(`${connection.id}:${CONSUMERS_TENANT}:${PICKER_CONSUMER_SCOPE}`, tokens);
      return;
    }
    let graph: TokenResponse;
    try {
      graph = await refreshForScope(config, this.fetch, tokens.refresh_token, MICROSOFT_SCOPES);
    } catch (error) {
      this.deps.log.warn(
        `Picker consent for connection ${connection.id}: new refresh token not usable for Graph, keeping the old one (${String(error)})`,
      );
      this.remember(`${connection.id}:${CONSUMERS_TENANT}:${PICKER_CONSUMER_SCOPE}`, tokens);
      return;
    }
    const account = await this.fetchAccount(graph.access_token);
    if (
      account?.id &&
      account.id !== connection.subject &&
      !connection.subject.startsWith(LEGACY_SUBJECT_PREFIX)
    ) {
      // Another account was picked at Microsoft: its grant is not this connection's.
      this.deps.log.warn(
        `Picker consent for connection ${connection.id} came back for another Microsoft account; ignored`,
      );
      return;
    }
    await this.deps.db
      .update(microsoftConnections)
      .set({
        refreshToken: await encryptToken(this.deps.secret, tokens.refresh_token),
        ...(account?.id ? { subject: account.id } : {}),
      })
      .where(eq(microsoftConnections.id, connection.id));
    this.remember(`${connection.id}:${CONSUMERS_TENANT}:${PICKER_CONSUMER_SCOPE}`, tokens);
    this.remember(`${connection.id}:read`, graph);
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
    return { claims: this.validateLoginToken(config, tokens.id_token, nonce), tokens };
  }

  private validateLoginToken(config: MicrosoftConfig, idToken: string, nonce: string) {
    return validateIdToken(idToken, {
      // Multi-tenant (`common`): the issuer names the tenant of the account.
      issuer: (iss, all) =>
        typeof all['tid'] === 'string' &&
        iss === `https://login.microsoftonline.com/${all['tid']}/v2.0`,
      clientId: config.clientId,
      nonce,
      now: this.deps.clock.now(),
    });
  }

  /**
   * Stores the refresh token (encrypted) as a connection of `userId` and caches the access
   * token. The same Microsoft account again only refreshes its connection; a new one is
   * refused once {@link MAX_ACCOUNTS_PER_MICROSOFT} other Slider accounts have it.
   */
  async saveTokens(
    userId: string,
    tokens: TokenResponse,
    claims?: IdTokenClaims | null,
  ): Promise<string> {
    if (!tokens.refresh_token) {
      throw new MicrosoftAuthError('failed', 'no_refresh_token', 'offline_access was not granted');
    }
    const account = await this.fetchAccount(tokens.access_token);
    const identity = identityOf(claims);
    // Graph did not name the account: kept like a connection from before subjects were
    // recorded, which the next connect takes over.
    const subject =
      account?.id ??
      (claims && typeof claims.oid === 'string' ? claims.oid : null) ??
      `${LEGACY_SUBJECT_PREFIX}${userId}`;
    const refreshToken = await encryptToken(this.deps.secret, tokens.refresh_token);
    const now = this.deps.clock.now();
    const connectionId = await this.deps.db.transaction(async (tx) => {
      // Two connects of the same Microsoft account at once must not both pass the count.
      await advisoryXactLock(tx, `ms-subject:${subject}`);
      const [others] = await tx
        .select({ n: count() })
        .from(microsoftConnections)
        .where(
          and(eq(microsoftConnections.subject, subject), ne(microsoftConnections.userId, userId)),
        );
      if ((others?.n ?? 0) >= MAX_ACCOUNTS_PER_MICROSOFT) {
        throw new MicrosoftAuthError(
          'account_limit',
          'account_limit',
          `already connected to ${MAX_ACCOUNTS_PER_MICROSOFT} accounts`,
        );
      }
      const fields = {
        refreshToken,
        account: account?.name ?? null,
        ...(identity ?? {}),
        lastUsedAt: now,
      };
      const [existing] = await tx
        .select({ id: microsoftConnections.id })
        .from(microsoftConnections)
        .where(
          and(eq(microsoftConnections.userId, userId), eq(microsoftConnections.subject, subject)),
        );
      // A connection from before the Graph id was recorded is taken over by the next connect.
      const [legacy] = existing
        ? []
        : await tx
            .select({ id: microsoftConnections.id })
            .from(microsoftConnections)
            .where(
              and(
                eq(microsoftConnections.userId, userId),
                eq(microsoftConnections.subject, `${LEGACY_SUBJECT_PREFIX}${userId}`),
              ),
            );
      const target = existing ?? legacy;
      if (target) {
        await tx
          .update(microsoftConnections)
          .set({ ...fields, subject })
          .where(eq(microsoftConnections.id, target.id));
        return target.id;
      }
      const id = crypto.randomUUID();
      await tx
        .insert(microsoftConnections)
        .values({ id, userId, subject, createdAt: now, ...fields });
      return id;
    });
    this.dropCache(connectionId);
    this.remember(`${connectionId}:read`, tokens);
    return connectionId;
  }

  /** The user's connections that still have a token, most recently used first. */
  async connectionIds(userId: string): Promise<string[]> {
    const rows = await this.deps.db
      .select({ id: microsoftConnections.id })
      .from(microsoftConnections)
      .where(
        and(eq(microsoftConnections.userId, userId), isNotNull(microsoftConnections.refreshToken)),
      )
      .orderBy(
        sql`${microsoftConnections.lastUsedAt} desc nulls last`,
        desc(microsoftConnections.createdAt),
        asc(microsoftConnections.id),
      );
    return rows.map((row) => row.id);
  }

  /** One of the user's own connections – `null` for anyone else's. */
  async findConnection(userId: string, connectionId: string) {
    const [row] = await this.deps.db
      .select()
      .from(microsoftConnections)
      .where(
        and(eq(microsoftConnections.id, connectionId), eq(microsoftConnections.userId, userId)),
      );
    return row ?? null;
  }

  /** Remembers that the connection just worked (orders {@link connectionIds}). */
  async markUsed(connectionId: string): Promise<void> {
    await this.deps.db
      .update(microsoftConnections)
      .set({ lastUsedAt: this.deps.clock.now() })
      .where(eq(microsoftConnections.id, connectionId));
  }

  /**
   * A valid access token of the connection, refreshed when needed; `null` when there is none (or
   * Microsoft revoked it). `forceRefresh` after Graph answered 401.
   */
  async getAccessToken(
    connectionId: string,
    { forceRefresh = false }: { forceRefresh?: boolean } = {},
  ): Promise<string | null> {
    try {
      return await this.refreshed(
        connectionId,
        `${connectionId}:read`,
        MICROSOFT_SCOPES,
        forceRefresh,
      );
    } catch (error) {
      if (!(error instanceof MicrosoftAuthError)) throw error;
      if (error.kind === 'admin_consent') throw microsoftConsentRequired();
      this.deps.log.warn(
        `Microsoft token refresh failed for connection ${connectionId}: ${error.message}`,
      );
      switch (refreshFailure(error)) {
        case 'transient':
          // An outage or throttling must not cost anyone their connection.
          throw sourceUnreachable(
            'Microsoft ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
          );
        case 'app':
          throw microsoftAppRejected();
        case 'grant':
          // invalid_grant (revoked, expired, password changed) and friends: sign in again.
          await this.forgetToken(connectionId);
          return null;
      }
    }
  }

  /**
   * A token for another resource than Graph, from the same refresh token – the OneDrive file
   * picker needs SharePoint (`https://{host}/.default`) or `OneDrive.ReadOnly` tokens. `null`
   * without a token; a refusal (e.g. the app registration lacks the SharePoint permissions)
   * throws {@link MicrosoftAuthError} and leaves the connection alone.
   */
  getScopedToken(
    connectionId: string,
    scope: string,
    { tenant }: { tenant?: string } = {},
  ): Promise<string | null> {
    return this.refreshed(
      connectionId,
      `${connectionId}:${tenant ?? ''}:${scope}`,
      scope,
      false,
      tenant,
    );
  }

  /** Cached access token for `scope`, else one traded for the stored refresh token. */
  private async refreshed(
    connectionId: string,
    cacheKey: string,
    scope: string,
    forceRefresh: boolean,
    tenant?: string,
  ): Promise<string | null> {
    const config = this.deps.config;
    if (!config) return null;
    const cached = this.cache.get(cacheKey);
    if (cached && !forceRefresh && cached.expiresAt > this.deps.clock.now().getTime()) {
      return cached.accessToken;
    }
    let running = this.refreshing.get(cacheKey);
    if (!running) {
      running = this.refresh(config, connectionId, cacheKey, scope, tenant).finally(() =>
        this.refreshing.delete(cacheKey),
      );
      this.refreshing.set(cacheKey, running);
    }
    return running;
  }

  private async refresh(
    config: MicrosoftConfig,
    connectionId: string,
    cacheKey: string,
    scope: string,
    tenant?: string,
  ): Promise<string | null> {
    const [row] = await this.deps.db
      .select({ token: microsoftConnections.refreshToken })
      .from(microsoftConnections)
      .where(eq(microsoftConnections.id, connectionId));
    if (!row?.token) return null;

    let refreshToken: string;
    try {
      refreshToken = await decryptToken(this.deps.secret, row.token);
    } catch {
      // Encrypted with another SLIDER_SECRET: unusable, ask for a new login.
      await this.forgetToken(connectionId);
      return null;
    }

    const tokens = await refreshForScope(config, this.fetch, refreshToken, scope, tenant);
    await this.deps.db
      .update(microsoftConnections)
      .set({
        lastUsedAt: this.deps.clock.now(),
        ...(tokens.refresh_token && tokens.refresh_token !== refreshToken
          ? { refreshToken: await encryptToken(this.deps.secret, tokens.refresh_token) }
          : {}),
      })
      .where(eq(microsoftConnections.id, connectionId));
    return this.remember(cacheKey, tokens);
  }

  /** Microsoft refused the refresh token: the connection stays, but needs a new sign-in. */
  async forgetToken(connectionId: string): Promise<void> {
    this.dropCache(connectionId);
    await this.deps.db
      .update(microsoftConnections)
      .set({ refreshToken: null })
      .where(eq(microsoftConnections.id, connectionId));
  }

  /** Drops the access tokens of a connection (it was disconnected or replaced). */
  dropCache(connectionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${connectionId}:`)) this.cache.delete(key);
    }
  }

  private remember(cacheKey: string, tokens: TokenResponse): string {
    this.cache.set(cacheKey, {
      accessToken: tokens.access_token,
      expiresAt: this.deps.clock.now().getTime() + tokens.expires_in * 1000 - EXPIRY_SKEW_MS,
    });
    return tokens.access_token;
  }

  /** The Microsoft account behind a token: Graph id and mail/UPN for display. */
  private async fetchAccount(
    accessToken: string,
  ): Promise<{ id: string | null; name: string | null } | null> {
    try {
      const response = await this.fetch(GRAPH_ME_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const me = (await response.json()) as {
        id?: string;
        mail?: string | null;
        userPrincipalName?: string;
      };
      return { id: me.id || null, name: me.mail ?? me.userPrincipalName ?? null };
    } catch {
      return null;
    }
  }

  private requireConfig(): MicrosoftConfig {
    if (!this.deps.config) throw new Error('Microsoft login is not configured');
    return this.deps.config;
  }
}
