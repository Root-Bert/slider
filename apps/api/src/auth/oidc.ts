import type { Clock } from '../clock';
import type { OidcConfig } from '../config';
import { validateIdToken, type IdTokenClaims } from './id-token';

/**
 * Generic OpenID Connect login (BER-129) – Authentik, Keycloak, Zitadel, … – and the built-in
 * Google login, which is the same flow against `https://accounts.google.com`.
 * Authorization code flow with PKCE, state and nonce; the endpoints come from discovery.
 */

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
}

/** Discovery documents rarely change; re-read them after this long. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export class OidcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

export class OidcClient {
  private discovery: { value: Discovery; at: number } | null = null;
  private readonly fetch: Fetch;

  constructor(
    readonly config: OidcConfig,
    private readonly clock: Clock,
    fetch?: Fetch,
  ) {
    this.fetch = fetch ?? globalThis.fetch;
  }

  private async discover(): Promise<Discovery> {
    const now = this.clock.now().getTime();
    if (this.discovery && now - this.discovery.at < DISCOVERY_TTL_MS) return this.discovery.value;
    const url = `${this.config.issuer}/.well-known/openid-configuration`;
    const response = await this.fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new OidcError(`OIDC discovery at ${url} is unreachable`);
    });
    if (!response.ok) throw new OidcError(`OIDC discovery failed: HTTP ${response.status}`);
    const doc = (await response.json().catch(() => ({}))) as Partial<Discovery>;
    if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint) {
      throw new OidcError('OIDC discovery document is incomplete');
    }
    if (doc.issuer.replace(/\/+$/, '') !== this.config.issuer) {
      throw new OidcError(`OIDC issuer mismatch: ${doc.issuer} ≠ ${this.config.issuer}`);
    }
    const value = {
      issuer: doc.issuer,
      authorization_endpoint: doc.authorization_endpoint,
      token_endpoint: doc.token_endpoint,
    };
    this.discovery = { value, at: now };
    return value;
  }

  async authorizeUrl(input: { state: string; challenge: string; nonce: string }): Promise<string> {
    const { authorization_endpoint } = await this.discover();
    const url = new URL(authorization_endpoint);
    for (const [key, value] of Object.entries({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.challenge,
      code_challenge_method: 'S256',
      ...this.config.authorizeParams,
    })) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /** Trades the code for tokens and returns the validated ID token claims. */
  async exchangeCode(code: string, verifier: string, nonce: string): Promise<IdTokenClaims> {
    const discovery = await this.discover();
    const response = await this.fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: verifier,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new OidcError('OIDC token endpoint is unreachable');
    });
    const body = (await response.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.id_token) {
      throw new OidcError(
        `OIDC token exchange failed: ${body.error ?? `HTTP ${response.status}`} ${body.error_description ?? ''}`,
      );
    }
    const aliases = this.config.issuerAliases ?? [];
    return validateIdToken(body.id_token, {
      issuer: aliases.length
        ? (iss) => [discovery.issuer, ...aliases].some((known) => sameIssuer(iss, known))
        : discovery.issuer,
      clientId: this.config.clientId,
      nonce,
      now: this.clock.now(),
    });
  }
}

const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
