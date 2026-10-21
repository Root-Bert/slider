import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { ACCOUNT_LIMIT_MESSAGE } from '@/features/auth';
import {
  connectErrorFrom,
  CONSENT_MESSAGE,
  EMPTY_LINK_MESSAGE,
  googleConnectErrorMessage,
  INVALID_LINK_MESSAGE,
  invalidLinkMessage,
  LOGIN_DENIED_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  loginUrlFor,
  noAccessFromError,
  noAccessFromLoginError,
  parseImportLink,
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
  it("asks to pick a Google file in Google's picker (BER-119)", () => {
    const error = new ApiError(
      401,
      'google_login_required',
      'Auswählen',
      '/api/auth/google/drive?returnTo=%2Fneu',
      undefined,
      '1AbCdEfGhIjKlMn',
    );
    const link = 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit';
    expect(parseImportLink(link)?.kind).toBe('google');
    expect(noAccessFromError(error, 'docs.google.com', link)).toEqual({
      host: 'docs.google.com',
      kind: 'google',
      message: 'Auswählen',
      googleFileId: '1AbCdEfGhIjKlMn',
    });
  });

  it('asks to connect the Nextcloud of a file there (BER-135)', () => {
    const error = new ApiError(
      401,
      'nextcloud_login_required',
      'Verbinden',
      undefined,
      'https://cloud.example.de',
    );
    expect(noAccessFromError(error, 'cloud.example.de', 'https://cloud.example.de/f/1')).toEqual({
      host: 'cloud.example.de',
      kind: 'nextcloud',
      message: 'Verbinden',
      nextcloudServer: 'https://cloud.example.de',
    });
    // A refusing Nextcloud link has no Microsoft account to try.
    const forbidden = new ApiError(403, 'source_forbidden', 'Passwortgeschützt');
    expect(
      noAccessFromError(forbidden, 'cloud.example.de', 'https://cloud.example.de/s/Abc123'),
    ).toBeNull();
  });

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

  it('offers another Microsoft account when none of mine may open a OneDrive/SharePoint file', () => {
    const forbidden = new ApiError(403, 'source_forbidden', 'Kein Zugriff');
    expect(noAccessFromError(forbidden, HOST, LINK)).toEqual({
      host: HOST,
      kind: 'forbidden',
      message: 'Kein Zugriff',
      loginUrl: FALLBACK_LOGIN,
    });
    // A plain web link has no account to sign in with.
    expect(noAccessFromError(forbidden, 'example.com', 'https://example.com/a.pptx')).toBeNull();
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

describe('parseImportLink', () => {
  it('lets plain http Nextcloud links through to the API, which knows the trusted server', () => {
    expect(parseImportLink('http://cloud.intranet/s/Ab3dEf9GhJkLmNo')?.kind).toBe('nextcloud');
    expect(parseImportLink('http://example.com/deck.pptx')).toBeNull();
    expect(parseImportLink('https://example.com/deck.pptx')?.kind).toBe('url');
  });
});

describe('invalidLinkMessage', () => {
  it('says why a link is refused – credentials in it get their own message', () => {
    const withPassword = 'https://robert:geheim@example.com/deck.pptx';
    expect(parseImportLink(withPassword)).toBeNull();
    expect(invalidLinkMessage(withPassword)).toMatch(/Benutzername oder Passwort/);
    expect(invalidLinkMessage('https://example.com/page.html')).toBe(INVALID_LINK_MESSAGE);
    expect(invalidLinkMessage('  ')).toBe(EMPTY_LINK_MESSAGE);
  });
});

describe('googleConnectErrorMessage', () => {
  it('explains an unticked Drive box, a cancel and anything else', () => {
    expect(googleConnectErrorMessage(null)).toBeNull();
    expect(googleConnectErrorMessage('scope')).toMatch(/Haken für Google Drive/);
    expect(googleConnectErrorMessage('denied')).toMatch(/abgebrochen/);
    expect(googleConnectErrorMessage('account')).toMatch(/nicht mit Slider verbunden/);
    expect(googleConnectErrorMessage('failed')).toMatch(/nicht geklappt/);
  });
});
