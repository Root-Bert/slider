/**
 * ID token checks for code-flow logins (BER-129). The token comes straight from the provider's
 * token endpoint over TLS, authenticated with our client secret, so – per OpenID Connect Core
 * 3.1.3.7 – its signature need not be verified. Issuer, audience, expiry and nonce still are.
 */

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  preferred_username?: string;
  /** Microsoft: object id of the user and tenant id. */
  oid?: string;
  tid?: string;
  [claim: string]: unknown;
}

export class IdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdTokenError';
  }
}

/** Reads the payload of a compact JWT, without verifying anything. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) throw new IdTokenError('Malformed ID token');
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new IdTokenError('Malformed ID token payload');
  }
}

/** Allowed clock difference between us and the provider. */
const CLOCK_SKEW_S = 120;

export function validateIdToken(
  token: string,
  expected: {
    /** Exact issuer, or a check for multi-tenant issuers (Microsoft `common`). */
    issuer: string | ((iss: string, claims: Record<string, unknown>) => boolean);
    clientId: string;
    nonce: string;
    now: Date;
  },
): IdTokenClaims {
  const claims = decodeJwtPayload(token);
  const { iss, sub, aud, exp, nonce } = claims;
  if (typeof iss !== 'string' || typeof sub !== 'string' || !sub) {
    throw new IdTokenError('ID token without iss/sub');
  }
  const issuerOk =
    typeof expected.issuer === 'string'
      ? iss.replace(/\/+$/, '') === expected.issuer.replace(/\/+$/, '')
      : expected.issuer(iss, claims);
  if (!issuerOk) throw new IdTokenError(`Unexpected issuer ${iss}`);
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(expected.clientId)) throw new IdTokenError('ID token for another client');
  if (typeof exp !== 'number' || exp + CLOCK_SKEW_S < expected.now.getTime() / 1000) {
    throw new IdTokenError('ID token expired');
  }
  if (nonce !== expected.nonce) throw new IdTokenError('ID token nonce mismatch');
  return claims as IdTokenClaims;
}

/** `email_verified` arrives as boolean or (some providers) as the string "true"/"false". */
export const emailVerifiedFalse = (claims: IdTokenClaims) =>
  claims.email_verified === false || claims.email_verified === 'false';
