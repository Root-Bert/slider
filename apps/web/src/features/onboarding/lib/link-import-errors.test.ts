import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { ACCOUNT_LIMIT_MESSAGE } from '@/features/auth';
import {
  connectErrorFrom,
  CONSENT_MESSAGE,
  LOGIN_DENIED_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  loginUrlFor,
  noAccessFromError,
  noAccessFromLoginError,
} from './link-import-errors';

const LINK = 'https://contoso.sharepoint.com/x?a=1';
const HOST = 'contoso.sharepoint.com';
const FALLBACK_LOGIN =
  '/api/auth/microsoft/login?returnTo=%2Fneu%3Flink%3Dhttps%253A%252F%252Fcontoso.sharepoint.com%252Fx%253Fa%253D1';

describe('loginUrlFor', () => {
  it('returns to /neu with the link after the Microsoft login', () => {
    expect(loginUrlFor(LINK)).toBe(FALLBACK_LOGIN);
  });
});

describe('noAccessFromError', () => {
  it('asks for a Microsoft login, preferring the API login URL', () => {
    const withUrl = new ApiError(403, 'microsoft_login_required', 'Anmelden', '/api/login');
    expect(noAccessFromError(withUrl, HOST, LINK)).toEqual({
      host: HOST,
      kind: 'login',
      message: 'Anmelden',
      loginUrl: '/api/login',
    });
    const without = new ApiError(403, 'microsoft_login_required', 'Anmelden');
    expect(noAccessFromError(without, HOST, LINK)?.loginUrl).toBe(FALLBACK_LOGIN);
  });

  it('has no login for a server without Microsoft, and asks for consent', () => {
    expect(
      noAccessFromError(new ApiError(501, 'microsoft_not_configured', 'Nicht da'), HOST, LINK),
    ).toEqual({ host: HOST, kind: 'not_configured', message: 'Nicht da' });
    expect(
      noAccessFromError(new ApiError(403, 'microsoft_consent_required', 'Freigabe'), HOST, LINK),
    ).toEqual({ host: HOST, kind: 'consent', message: 'Freigabe', loginUrl: FALLBACK_LOGIN });
  });

  it('is null for other errors', () => {
    expect(noAccessFromError(new ApiError(500, 'internal', 'x'), HOST, LINK)).toBeNull();
  });
});

describe('noAccessFromLoginError', () => {
  it.each([
    ['admin_consent', 'consent', CONSENT_MESSAGE],
    ['denied', 'denied', LOGIN_DENIED_MESSAGE],
    ['account_limit', 'denied', ACCOUNT_LIMIT_MESSAGE],
    ['whatever', 'denied', LOGIN_FAILED_MESSAGE],
  ])('maps ?msError=%s', (code, kind, message) => {
    expect(noAccessFromLoginError(code, HOST, LINK)).toEqual({
      host: HOST,
      kind,
      message,
      loginUrl: FALLBACK_LOGIN,
    });
  });
});

describe('connectErrorFrom', () => {
  const at = (search: string) => connectErrorFrom(new URLSearchParams(search));

  it('explains every failed Microsoft connect, not only the account limit', () => {
    expect(at('msError=denied')).toBe('denied');
    expect(at('msError=admin_consent')).toBe('admin_consent');
    expect(at('msError=failed')).toBe('failed');
    expect(at('msError=account_limit')).toBe('account_limit');
  });

  it('leaves a link import to the link form, and ignores unknown kinds', () => {
    expect(at('msError=denied&link=https%3A%2F%2Fx.sharepoint.com%2Fa')).toBeNull();
    expect(at('msError=nope')).toBeNull();
    expect(at('')).toBeNull();
  });
});
