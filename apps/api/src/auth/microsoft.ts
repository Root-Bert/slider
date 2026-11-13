import type { Clock } from '../clock';
import type { MicrosoftConfig } from '../config';
import { ApiError } from '../http/errors';
import type { Logger } from '../logger';
import { sourceUnreachable } from '../sources/errors';
import { validateIdToken, type IdTokenClaims } from './id-token';
import { toBase64Url } from './token-crypto';

/**
 * Microsoft sign-in (BER-129): OAuth 2.0 authorization code flow with PKCE plus the client
 * secret, against the Microsoft identity platform v2. Only the identity (ID token: `tid` + `oid`)
 * is asked for – Slider reads no files at Microsoft, so it keeps no tokens. Plain `fetch`, no
 * MSAL – Slider needs only "code → ID token".
 */

export const MICROSOFT_SCOPES = 'openid profile email';

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const authority = (config: MicrosoftConfig) =>
  `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0`;

/** What went wrong at Microsoft, as far as the web app needs to know. */
export type MicrosoftErrorKind = 'admin_consent' | 'denied' | 'failed';

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

export const microsoftNotConfigured = () =>
  new ApiError(
    401,
    'microsoft_not_configured',
    'Die Microsoft-Anmeldung ist auf diesem Server nicht eingerichtet. Trage MS_CLIENT_ID und MS_CLIENT_SECRET (und optional MS_TENANT) in die .env im Projektordner ein und starte die API neu.',
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

export function buildAuthorizeUrl(config: MicrosoftConfig, pkce: Pkce): string {
  const url = new URL(`${authority(config)}/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

interface TokenResponse {
  id_token?: string;
}

async function exchangeCode(
  config: MicrosoftConfig,
  fetch: Fetch,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const response = await fetch(`${authority(config)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: MICROSOFT_SCOPES,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    throw sourceUnreachable(
      'Microsoft ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
    );
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    const error = body.error ?? `http_${response.status}`;
    throw new MicrosoftAuthError(
      mapMicrosoftError(error, body.error_description),
      error,
      body.error_description,
      response.status,
    );
  }
  return { id_token: body.id_token };
}

export interface MicrosoftLoginDeps {
  /** `null` when no app registration is configured – then nobody signs in with Microsoft. */
  config: MicrosoftConfig | null;
  clock: Clock;
  log: Logger;
  fetch?: Fetch;
}

/** "Weiter mit Microsoft": trades the code for the validated identity, nothing else is kept. */
export class MicrosoftLogin {
  private readonly fetch: Fetch;

  constructor(private readonly deps: MicrosoftLoginDeps) {
    this.fetch = deps.fetch ?? globalThis.fetch;
  }

  get configured(): boolean {
    return this.deps.config !== null;
  }

  async exchangeLogin(code: string, verifier: string, nonce: string): Promise<IdTokenClaims> {
    const config = this.requireConfig();
    const tokens = await exchangeCode(config, this.fetch, code, verifier);
    if (!tokens.id_token) {
      throw new MicrosoftAuthError('failed', 'no_id_token', 'openid was not granted');
    }
    return validateIdToken(tokens.id_token, {
      // Multi-tenant (`common`): the issuer names the tenant of the account.
      issuer: (iss, all) =>
        typeof all['tid'] === 'string' &&
        iss === `https://login.microsoftonline.com/${all['tid']}/v2.0`,
      clientId: config.clientId,
      nonce,
      now: this.deps.clock.now(),
    });
  }

  private requireConfig(): MicrosoftConfig {
    if (!this.deps.config) throw new Error('Microsoft login is not configured');
    return this.deps.config;
  }
}
