import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import {
  MCP_PATH,
  type AppConnection,
  type AppConnections,
  type AppRequest,
  type CreatedAppToken,
} from '@slider/shared';
import { hashToken, newSecretToken } from '../auth/session';
import {
  appClients,
  appCodes,
  appConnections,
  users,
  workspaces,
  type UserRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { dnsLookup, readBodyCapped, safeFetch } from '../sources/safe-fetch';
import { listWorkspaces } from './workspaces/workspaces';

/*
 * „KI-Apps“: AI apps (Claude, ChatGPT, Claude Code, …) reaching Slider's MCP server
 * (`routes/mcp.ts`) for one person. Two ways in:
 *  - OAuth 2.1 with PKCE, as MCP asks for it: the app finds Slider's authorization server
 *    through the protected resource's metadata, registers itself (dynamic client registration,
 *    or a client id that is the https address of its metadata document), sends its person to
 *    `/api/oauth/authorize` – Slider asks them on `/verbinden` – and swaps the code for a short-
 *    lived access token and a refresh token that is replaced each time it is used;
 *  - a token made on `/konto` for apps that take one (Claude Code, the desktop's local server,
 *    where no app can sign in by itself), valid until removed.
 * Only the tokens' SHA-256 is stored, like sessions. A connection may be held to one workspace.
 */

/** How long an access token lives; the refresh token gets a new one. */
export const ACCESS_TTL_MS = 60 * 60 * 1000;
/** A refresh token not used for this long is dead: the app asks its person again. */
const REFRESH_IDLE_MS = 180 * 24 * 60 * 60 * 1000;
/** How long the app's person has to say yes on `/verbinden`. */
const REQUEST_TTL_MS = 15 * 60 * 1000;
/** How long a code may wait to be swapped for tokens. */
const CODE_TTL_MS = 5 * 60 * 1000;
/** `lastUsedAt` is written at most this often per connection. */
const TOUCH_EVERY_MS = 60 * 1000;
/** Client metadata documents are small; kept this long once fetched. */
const CLIENT_DOCUMENT_BYTES = 64 * 1024;
const CLIENT_DOCUMENT_TTL_MS = 10 * 60 * 1000;

/** Recognisable prefixes – a leaked token is easy to find in a log or a repository. */
const ACCESS_PREFIX = 'slider_at_';
const REFRESH_PREFIX = 'slider_rt_';
const TOKEN_PREFIX = 'slider_pat_';
/** A replaced refresh token given again this soon after its renewal: the app itself, not a thief. */
const REUSE_GRACE_MS = 60 * 1000;
/** Starts a code whose request named its `redirect_uri` – the token request must name it too. */
const REDIRECT_NAMED = 'r.';

/** Where Slider is reached, which apps are told: the web app's origin. */
export const issuerOf = (deps: Pick<AppDeps, 'config'>) => deps.config.webOrigin;
export const mcpUrlOf = (deps: Pick<AppDeps, 'config'>) => `${issuerOf(deps)}${MCP_PATH}`;
/** Apps sign in themselves only where a browser can reach Slider – not the desktop's own server. */
export const oauthOffered = (deps: Pick<AppDeps, 'config'>) => !deps.config.desktop;

/** An error as OAuth answers it (`{ error, error_description }`). */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
  toBody() {
    return { error: this.error, error_description: this.description };
  }
}

// ── Clients ────────────────────────────────────────────────────────────────

export interface AppClient {
  id: string;
  name: string;
  redirectUris: string[];
}

/** Schemes a redirect may never use: they would run or read something in the browser. */
const FORBIDDEN_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'blob:',
  'about:',
  'vbscript:',
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** A redirect an app may name: https, http on this computer (native apps), or an app's scheme. */
function checkRedirectUri(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) throw invalidRedirect();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidRedirect();
  }
  if (url.hash) throw invalidRedirect();
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:') {
    if (LOOPBACK_HOSTS.has(url.hostname)) return value;
    throw invalidRedirect();
  }
  if (FORBIDDEN_SCHEMES.has(url.protocol)) throw invalidRedirect();
  return value;
}

const invalidRedirect = () =>
  new OAuthError(
    'invalid_redirect_uri',
    'Redirect URIs must be https, http on loopback, or an app scheme.',
  );

/**
 * Dynamic client registration (RFC 7591): public clients only (PKCE, no secret). Anyone may
 * register – a registration alone lets nobody in; its person still has to say yes.
 */
export async function registerClient(
  deps: AppDeps,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10)
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris: 1 to 10 addresses.');
  const redirectUris = uris.map(checkRedirectUri);
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== 'none')
    throw new OAuthError(
      'invalid_client_metadata',
      'Only public clients (token_endpoint_auth_method "none", with PKCE).',
    );
  const name =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 80)
      : 'KI-App';
  const id = `slider_client_${newSecretToken().slice(0, 24)}`;
  const now = deps.clock.now();
  await deps.db.insert(appClients).values({ id, name, redirectUris, createdAt: now });
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

const clientDocuments = new Map<string, { client: AppClient; until: number }>();

/**
 * The app behind `clientId`: one registered here, or – a client id that is an https address –
 * the metadata document it names (Client ID Metadata Documents), whose `client_id` must be
 * that very address. `null` when there is none.
 */
export async function findClient(deps: AppDeps, clientId: string): Promise<AppClient | null> {
  if (!clientId || clientId.length > 2000) return null;
  if (clientId.startsWith('https://')) return clientDocument(deps, clientId);
  const [row] = await deps.db.select().from(appClients).where(eq(appClients.id, clientId));
  return row ? { id: row.id, name: row.name, redirectUris: row.redirectUris } : null;
}

async function clientDocument(deps: AppDeps, clientId: string): Promise<AppClient | null> {
  const now = deps.clock.now().getTime();
  const kept = clientDocuments.get(clientId);
  if (kept && kept.until > now) return kept.client;
  const network = deps.ssoNetwork;
  try {
    const http = {
      fetch: network?.fetch ?? globalThis.fetch,
      lookup: network?.lookup ?? dnsLookup,
      maxBytes: CLIENT_DOCUMENT_BYTES,
    };
    const { response } = await safeFetch(new URL(clientId), http, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const text = new TextDecoder().decode(await readBodyCapped(response, CLIENT_DOCUMENT_BYTES));
    const document = JSON.parse(text) as Record<string, unknown>;
    if (document.client_id !== clientId || !Array.isArray(document.redirect_uris)) return null;
    const client: AppClient = {
      id: clientId,
      name:
        typeof document.client_name === 'string' && document.client_name.trim()
          ? document.client_name.trim().slice(0, 80)
          : new URL(clientId).host,
      redirectUris: document.redirect_uris.slice(0, 10).map(checkRedirectUri),
    };
    if (clientDocuments.size > 500) clientDocuments.clear();
    clientDocuments.set(clientId, { client, until: now + CLIENT_DOCUMENT_TTL_MS });
    return client;
  } catch {
    return null;
  }
}

/**
 * Whether `uri` is one of the client's redirects – exactly, but on this computer (http
 * loopback) any port (RFC 8252: native apps pick a free one each time).
 */
export function redirectAllowed(client: AppClient, uri: string): boolean {
  if (client.redirectUris.includes(uri)) return true;
  let given: URL;
  try {
    given = new URL(uri);
  } catch {
    return false;
  }
  if (given.protocol !== 'http:' || !LOOPBACK_HOSTS.has(given.hostname)) return false;
  return client.redirectUris.some((each) => {
    try {
      const known = new URL(each);
      return (
        known.protocol === 'http:' &&
        known.hostname === given.hostname &&
        known.pathname === given.pathname &&
        known.search === given.search
      );
    } catch {
      return false;
    }
  });
}

// ── The request its person sees (`/verbinden`) ────────────────────────────

/** What an app asked for, signed so the consent page cannot change it. */
interface SignedRequest {
  clientId: string;
  redirectUri: string;
  /** The app named `redirectUri` (else it is the client's only one): RFC 6749 4.1.3. */
  redirectNamed?: boolean;
  codeChallenge: string;
  state: string | null;
  /** Until when (ms). */
  until: number;
}

const sign = (deps: AppDeps, payload: string) =>
  createHmac('sha256', deps.config.secret).update(`app-request:${payload}`).digest('base64url');

function encodeRequest(deps: AppDeps, request: SignedRequest): string {
  const payload = Buffer.from(JSON.stringify(request)).toString('base64url');
  return `${payload}.${sign(deps, payload)}`;
}

function decodeRequest(deps: AppDeps, value: string): SignedRequest {
  const [payload, signature] = value.split('.');
  const expected = payload ? sign(deps, payload) : '';
  if (
    !payload ||
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw badRequest('Diese Anfrage ist ungültig. Starte die Verbindung in der App neu.');
  const request = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SignedRequest;
  if (request.until < deps.clock.now().getTime())
    throw badRequest('Diese Anfrage ist abgelaufen. Starte die Verbindung in der App neu.');
  return request;
}

/**
 * `GET /api/oauth/authorize`: checks what the app asks for and sends the browser to the
 * consent page. A wrong client or redirect is shown, never followed (an open redirect); other
 * mistakes go back to the app as OAuth errors.
 */
export async function authorizeRedirect(
  deps: AppDeps,
  query: Record<string, string | undefined>,
): Promise<{ to: string } | { problem: string }> {
  const client = await findClient(deps, query.client_id ?? '');
  if (!client)
    return { problem: 'Diese App ist Slider nicht bekannt. Starte die Verbindung in der App neu.' };
  const redirectUri = query.redirect_uri ?? client.redirectUris[0] ?? '';
  if (!redirectAllowed(client, redirectUri))
    return {
      problem:
        'Die App will nach dem Anmelden an eine Adresse zurück, die sie nicht angemeldet hat.',
    };
  const back = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    if (query.state) url.searchParams.set('state', query.state);
    url.searchParams.set('iss', issuerOf(deps));
    return { to: url.toString() };
  };
  if (query.response_type !== 'code')
    return back('unsupported_response_type', 'Only response_type=code.');
  if (!query.code_challenge || query.code_challenge_method !== 'S256')
    return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(query.code_challenge))
    return back('invalid_request', 'code_challenge is not a base64url SHA-256.');
  const request = encodeRequest(deps, {
    clientId: client.id,
    redirectUri,
    redirectNamed: query.redirect_uri !== undefined,
    codeChallenge: query.code_challenge,
    state: query.state ?? null,
    until: deps.clock.now().getTime() + REQUEST_TTL_MS,
  });
  return { to: `${deps.config.webOrigin}/verbinden?anfrage=${encodeURIComponent(request)}` };
}

/** What the consent page shows of a request. */
export async function describeAppRequest(
  deps: AppDeps,
  user: Pick<UserRow, 'id'>,
  value: string,
): Promise<AppRequest> {
  const request = decodeRequest(deps, value);
  const client = await findClient(deps, request.clientId);
  if (!client) throw notFound('Diese App ist Slider nicht (mehr) bekannt.');
  return {
    clientName: client.name,
    redirectHost: hostOf(request.redirectUri),
    workspaces: (await listWorkspaces(deps, user.id)).map(({ id, name }) => ({ id, name })),
  };
}

const hostOf = (uri: string) => {
  try {
    const url = new URL(uri);
    return url.host || `${url.protocol}//`;
  } catch {
    return uri;
  }
};

/** „Erlauben“: a code for the app, the browser sent back to it. */
export async function approveAppRequest(
  deps: AppDeps,
  user: Pick<UserRow, 'id'>,
  value: string,
  workspaceId: string | null,
): Promise<string> {
  const request = decodeRequest(deps, value);
  if (workspaceId) await requireMember(deps, user.id, workspaceId);
  // Whether the token request must name the redirect travels in the code, which only its hash
  // finds: changing it finds no code.
  const code = (request.redirectNamed ? REDIRECT_NAMED : '') + newSecretToken();
  const now = deps.clock.now();
  // Codes nobody swapped go when the next one is made.
  await deps.db.delete(appCodes).where(lt(appCodes.expiresAt, now));
  await deps.db.insert(appCodes).values({
    codeHash: hashToken(code),
    clientId: request.clientId,
    userId: user.id,
    workspaceId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    createdAt: now,
  });
  const url = new URL(request.redirectUri);
  url.searchParams.set('code', code);
  if (request.state) url.searchParams.set('state', request.state);
  url.searchParams.set('iss', issuerOf(deps));
  return url.toString();
}

/** „Ablehnen“: back to the app with `access_denied`. */
export function denyAppRequest(deps: AppDeps, value: string): string {
  const request = decodeRequest(deps, value);
  const url = new URL(request.redirectUri);
  url.searchParams.set('error', 'access_denied');
  url.searchParams.set('error_description', 'The person declined.');
  if (request.state) url.searchParams.set('state', request.state);
  url.searchParams.set('iss', issuerOf(deps));
  return url.toString();
}

async function requireMember(deps: AppDeps, userId: string, workspaceId: string) {
  const mine = await listWorkspaces(deps, userId);
  if (!mine.some((each) => each.id === workspaceId))
    throw notFound('Diesen Workspace gibt es nicht (mehr).');
}

// ── Tokens ─────────────────────────────────────────────────────────────────

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

const refreshSignature = (deps: AppDeps, body: string) =>
  createHmac('sha256', deps.config.secret).update(`app-refresh:${body}`).digest('base64url');

/**
 * A refresh token names its connection, signed: one replaced before, given again, is told apart
 * from a made-up one – and ends the connection (RFC 9700 4.14.2: a stolen token was used).
 */
function newRefreshToken(deps: AppDeps, connectionId: string): string {
  const body = `${connectionId}.${newSecretToken()}`;
  return `${REFRESH_PREFIX}${body}.${refreshSignature(deps, body)}`;
}

/** The connection a well-signed refresh token was made for; `null` for any other string. */
function refreshTokenConnection(deps: AppDeps, token: string): string | null {
  if (!token.startsWith(REFRESH_PREFIX)) return null;
  const rest = token.slice(REFRESH_PREFIX.length);
  const at = rest.lastIndexOf('.');
  if (at === -1) return null;
  const body = rest.slice(0, at);
  const given = Buffer.from(rest.slice(at + 1));
  const expected = Buffer.from(refreshSignature(deps, body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return body.split('.')[0] ?? null;
}

function tokenAnswer(access: string, refresh: string) {
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope: 'slider',
  };
}

/** `POST /api/oauth/token`: a code (with its PKCE verifier) or a refresh token for new tokens. */
export async function exchangeToken(
  deps: AppDeps,
  form: Record<string, string | undefined>,
): Promise<ReturnType<typeof tokenAnswer>> {
  const now = deps.clock.now();
  if (form.grant_type === 'authorization_code') {
    const { code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri } = form;
    if (!code || !verifier || !clientId)
      throw new OAuthError('invalid_request', 'code, code_verifier and client_id are required.');
    if (code.startsWith(REDIRECT_NAMED) && redirectUri === undefined)
      throw new OAuthError(
        'invalid_request',
        'redirect_uri is required: the authorization request named one.',
      );
    // Swapped once: the row goes whatever follows.
    const [row] = await deps.db
      .delete(appCodes)
      .where(eq(appCodes.codeHash, hashToken(code)))
      .returning();
    if (!row || row.expiresAt < now || row.clientId !== clientId)
      throw new OAuthError('invalid_grant', 'The code is unknown, used or expired.');
    if (redirectUri !== undefined && redirectUri !== row.redirectUri)
      throw new OAuthError('invalid_grant', 'redirect_uri does not match.');
    if (s256(verifier) !== row.codeChallenge)
      throw new OAuthError('invalid_grant', 'code_verifier does not match the code_challenge.');
    const client = await findClient(deps, clientId);
    const id = crypto.randomUUID();
    const access = ACCESS_PREFIX + newSecretToken();
    const refresh = newRefreshToken(deps, id);
    await deps.db.insert(appConnections).values({
      id,
      userId: row.userId,
      kind: 'oauth',
      clientId,
      name: client?.name ?? 'KI-App',
      workspaceId: row.workspaceId,
      accessHash: hashToken(access),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
      refreshHash: hashToken(refresh),
      createdAt: now,
      lastUsedAt: now,
    });
    return tokenAnswer(access, refresh);
  }
  if (form.grant_type === 'refresh_token') {
    const { refresh_token: given, client_id: clientId } = form;
    if (!given || !clientId)
      throw new OAuthError('invalid_request', 'refresh_token and client_id are required.');
    const [row] = await deps.db
      .select()
      .from(appConnections)
      .where(eq(appConnections.refreshHash, hashToken(given)));
    if (!row) {
      // One of ours, replaced since: someone else has used it – the connection ends. Not within
      // a minute of its renewal (the renewal's access token, less its lifetime): that is the app
      // itself, asking twice or again after the answer got lost – refused, but it stays.
      const reused = refreshTokenConnection(deps, given);
      if (reused)
        await deps.db
          .delete(appConnections)
          .where(
            and(
              eq(appConnections.id, reused),
              eq(appConnections.kind, 'oauth'),
              lt(
                appConnections.accessExpiresAt,
                new Date(now.getTime() + ACCESS_TTL_MS - REUSE_GRACE_MS),
              ),
            ),
          );
      throw new OAuthError('invalid_grant', 'The refresh token is unknown or expired.');
    }
    const idleSince = row.lastUsedAt ?? row.createdAt;
    if (row.clientId !== clientId || now.getTime() - idleSince.getTime() > REFRESH_IDLE_MS)
      throw new OAuthError('invalid_grant', 'The refresh token is unknown or expired.');
    const access = ACCESS_PREFIX + newSecretToken();
    const refresh = newRefreshToken(deps, row.id);
    // Replaced only if it is still the one given – two refreshes at once: one wins.
    const [renewed] = await deps.db
      .update(appConnections)
      .set({
        accessHash: hashToken(access),
        accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
        refreshHash: hashToken(refresh),
        lastUsedAt: now,
      })
      .where(and(eq(appConnections.id, row.id), eq(appConnections.refreshHash, hashToken(given))))
      .returning({ id: appConnections.id });
    if (!renewed) throw new OAuthError('invalid_grant', 'The refresh token was just used.');
    return tokenAnswer(access, refresh);
  }
  throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token.');
}

/** Who a bearer token speaks for, and the connection it belongs to; `null`: nobody. */
export async function authenticateAppToken(
  deps: AppDeps,
  token: string,
): Promise<{ user: UserRow; connection: typeof appConnections.$inferSelect } | null> {
  if (!token.startsWith(ACCESS_PREFIX) && !token.startsWith(TOKEN_PREFIX)) return null;
  const now = deps.clock.now();
  const [row] = await deps.db
    .select({ connection: appConnections, user: users })
    .from(appConnections)
    .innerJoin(users, eq(users.id, appConnections.userId))
    .where(and(eq(appConnections.accessHash, hashToken(token)), isNull(users.blockedAt)));
  if (!row) return null;
  const { connection } = row;
  if (connection.accessExpiresAt && connection.accessExpiresAt < now) return null;
  if (!connection.lastUsedAt || now.getTime() - connection.lastUsedAt.getTime() > TOUCH_EVERY_MS)
    await deps.db
      .update(appConnections)
      .set({ lastUsedAt: now })
      .where(eq(appConnections.id, connection.id));
  return row;
}

// ── „KI-Apps“ on `/konto` ─────────────────────────────────────────────────

export async function listAppConnections(
  deps: AppDeps,
  user: Pick<UserRow, 'id'>,
): Promise<AppConnections> {
  const rows = await deps.db
    .select({ connection: appConnections, workspaceName: workspaces.name })
    .from(appConnections)
    .leftJoin(workspaces, eq(workspaces.id, appConnections.workspaceId))
    .where(eq(appConnections.userId, user.id))
    .orderBy(desc(appConnections.createdAt));
  return {
    mcpUrl: mcpUrlOf(deps),
    oauth: oauthOffered(deps),
    connections: rows.map(({ connection, workspaceName }) => toDto(connection, workspaceName)),
  };
}

function toDto(
  row: typeof appConnections.$inferSelect,
  workspaceName: string | null,
): AppConnection {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    workspaceId: row.workspaceId,
    workspaceName,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** „Token erstellen“: shown once, valid until removed. */
export async function createAppToken(
  deps: AppDeps,
  user: Pick<UserRow, 'id'>,
  input: { name: string; workspaceId: string | null },
): Promise<CreatedAppToken> {
  let workspaceName: string | null = null;
  if (input.workspaceId) {
    await requireMember(deps, user.id, input.workspaceId);
    const [workspace] = await deps.db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId));
    workspaceName = workspace?.name ?? null;
  }
  const token = TOKEN_PREFIX + newSecretToken();
  const [row] = await deps.db
    .insert(appConnections)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      kind: 'token',
      clientId: null,
      name: input.name,
      workspaceId: input.workspaceId,
      accessHash: hashToken(token),
      accessExpiresAt: null,
      refreshHash: null,
      createdAt: deps.clock.now(),
      lastUsedAt: null,
    })
    .returning();
  return { connection: toDto(row!, workspaceName), token };
}

/** „Entfernen“: the app's tokens stop working at once. */
export async function removeAppConnection(
  deps: AppDeps,
  user: Pick<UserRow, 'id'>,
  connectionId: string,
): Promise<void> {
  const removed = await deps.db
    .delete(appConnections)
    .where(and(eq(appConnections.id, connectionId), eq(appConnections.userId, user.id)))
    .returning({ id: appConnections.id });
  if (removed.length === 0) throw notFound('Diese Verbindung gibt es nicht (mehr).');
}
