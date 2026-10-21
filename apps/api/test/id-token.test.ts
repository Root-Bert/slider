import { describe, expect, it } from 'vitest';
import {
  decodeJwtPayload,
  emailVerifiedFalse,
  IdTokenError,
  validateIdToken,
  type IdTokenClaims,
} from '../src/auth/id-token';
import { fakeJwt } from './helpers';

const NOW = new Date(Date.UTC(2026, 9, 16, 12));
const nowS = NOW.getTime() / 1000;

const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: 'https://login.example.com/',
  sub: 'user-1',
  aud: 'client-id',
  exp: nowS + 300,
  nonce: 'nonce-1',
  ...overrides,
});

const expected = (overrides: Partial<Parameters<typeof validateIdToken>[1]> = {}) => ({
  issuer: 'https://login.example.com/',
  clientId: 'client-id',
  nonce: 'nonce-1',
  now: NOW,
  ...overrides,
});

const rejects = (token: string, message: string | RegExp, options = expected()) => {
  const run = () => validateIdToken(token, options);
  expect(run).toThrow(IdTokenError);
  expect(run).toThrow(message);
};

describe('decodeJwtPayload', () => {
  it('reads the payload without checking anything', () => {
    expect(decodeJwtPayload(fakeJwt({ sub: 'x' }))).toEqual({ sub: 'x' });
  });

  it('rejects tokens without a payload part', () => {
    expect(() => decodeJwtPayload('')).toThrow('Malformed ID token');
    expect(() => decodeJwtPayload('header-only')).toThrow(IdTokenError);
  });

  it('rejects payloads that are not a JSON object', () => {
    const part = (value: string) => `x.${Buffer.from(value).toString('base64url')}.y`;
    for (const payload of ['not json', '42', 'null', '"text"']) {
      expect(() => decodeJwtPayload(part(payload))).toThrow('Malformed ID token payload');
    }
  });
});

describe('validateIdToken', () => {
  it('returns the claims of a valid token', () => {
    const token = fakeJwt(claims({ email: 'a@b.de' }));
    expect(validateIdToken(token, expected())).toMatchObject({ sub: 'user-1', email: 'a@b.de' });
  });

  it('requires iss and a non-empty sub', () => {
    rejects(fakeJwt(claims({ iss: undefined })), 'ID token without iss/sub');
    rejects(fakeJwt(claims({ sub: '' })), 'ID token without iss/sub');
    rejects(fakeJwt(claims({ sub: 7 })), 'ID token without iss/sub');
  });

  it('treats issuers with and without trailing slashes as equal', () => {
    expect(() =>
      validateIdToken(fakeJwt(claims({ iss: 'https://login.example.com' })), expected()),
    ).not.toThrow();
    expect(() =>
      validateIdToken(fakeJwt(claims()), expected({ issuer: 'https://login.example.com//' })),
    ).not.toThrow();
    rejects(fakeJwt(claims({ iss: 'https://evil.example.com/' })), /Unexpected issuer/);
  });

  it('accepts an issuer check function, which sees the claims', () => {
    const issuer = (iss: string, all: Record<string, unknown>) =>
      iss === `https://login.example.com/${String(all.tid)}/v2.0`;
    const token = fakeJwt(claims({ iss: 'https://login.example.com/t-1/v2.0', tid: 't-1' }));
    expect(() => validateIdToken(token, expected({ issuer }))).not.toThrow();
    rejects(fakeJwt(claims({ tid: 't-1' })), /Unexpected issuer/, expected({ issuer }));
  });

  it('checks the audience as a string or an array', () => {
    expect(() =>
      validateIdToken(fakeJwt(claims({ aud: ['other', 'client-id'] })), expected()),
    ).not.toThrow();
    rejects(fakeJwt(claims({ aud: 'other' })), 'ID token for another client');
    rejects(fakeJwt(claims({ aud: ['other'] })), 'ID token for another client');
    rejects(fakeJwt(claims({ aud: undefined })), 'ID token for another client');
  });

  it('allows 120 s of clock skew on expiry, no more', () => {
    expect(() => validateIdToken(fakeJwt(claims({ exp: nowS - 120 })), expected())).not.toThrow();
    rejects(fakeJwt(claims({ exp: nowS - 121 })), 'ID token expired');
    rejects(fakeJwt(claims({ exp: String(nowS + 300) })), 'ID token expired');
    rejects(fakeJwt(claims({ exp: undefined })), 'ID token expired');
  });

  it('requires the nonce of the login', () => {
    rejects(fakeJwt(claims({ nonce: 'other' })), 'ID token nonce mismatch');
    rejects(fakeJwt(claims({ nonce: undefined })), 'ID token nonce mismatch');
  });
});

describe('emailVerifiedFalse', () => {
  const of = (email_verified: unknown) => ({ ...claims(), email_verified }) as IdTokenClaims;

  it('is true only for an explicit false (boolean or string)', () => {
    expect(emailVerifiedFalse(of(false))).toBe(true);
    expect(emailVerifiedFalse(of('false'))).toBe(true);
    expect(emailVerifiedFalse(of(true))).toBe(false);
    expect(emailVerifiedFalse(of('true'))).toBe(false);
    expect(emailVerifiedFalse(of(undefined))).toBe(false);
  });
});
