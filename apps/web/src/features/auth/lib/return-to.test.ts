import { describe, expect, it } from 'vitest';
import {
  isLoginError,
  loginErrorCopy,
  loginPath,
  providerLoginUrl,
  safeReturnTo,
  signupHintCopy,
} from './return-to';

describe('safeReturnTo', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(safeReturnTo('/join/abc')).toBe('/join/abc');
    expect(safeReturnTo('/d/1?slide=s2#x')).toBe('/d/1?slide=s2#x');
  });

  it('falls back to / for missing, absolute or protocol-relative targets', () => {
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo('')).toBe('/');
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('//evil.com/x')).toBe('/');
    expect(safeReturnTo('/\\evil.com')).toBe('/');
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
  });

  it('never returns to the login page itself', () => {
    expect(safeReturnTo('/login')).toBe('/');
    expect(safeReturnTo('/login?returnTo=/x')).toBe('/');
    expect(safeReturnTo('/loginx')).toBe('/loginx');
    expect(safeReturnTo('/registrieren')).toBe('/');
  });
});

describe('signupHintCopy', () => {
  it('explains how accounts come about in each SIGNUP mode', () => {
    expect(signupHintCopy('open')).toBe(
      'Noch kein Konto? Es wird beim ersten Anmelden automatisch erstellt.',
    );
    expect(signupHintCopy('invite')).toMatch(/Einladung/);
    expect(signupHintCopy('domains')).toMatch(/Firmenadresse/);
  });
});

describe('loginPath', () => {
  it('omits the default target', () => {
    expect(loginPath('/')).toBe('/login');
    expect(loginPath(undefined)).toBe('/login');
  });

  it('encodes the target', () => {
    expect(loginPath('/d/1?slide=s2')).toBe('/login?returnTo=%2Fd%2F1%3Fslide%3Ds2');
  });
});

describe('providerLoginUrl', () => {
  it('appends returnTo', () => {
    expect(providerLoginUrl('/api/auth/oidc/login', '/join/t')).toBe(
      '/api/auth/oidc/login?returnTo=%2Fjoin%2Ft',
    );
    expect(providerLoginUrl('/api/x?a=1', null)).toBe('/api/x?a=1&returnTo=%2F');
  });

  it('sanitises the target', () => {
    expect(providerLoginUrl('/api/auth/microsoft/login', '//evil.com')).toBe(
      '/api/auth/microsoft/login?returnTo=%2F',
    );
  });
});

describe('login errors', () => {
  it('recognises known codes only', () => {
    expect(isLoginError('signup_closed')).toBe(true);
    expect(isLoginError('nope')).toBe(false);
    expect(isLoginError(null)).toBe(false);
  });

  it('has German copy for every code', () => {
    expect(loginErrorCopy('link_expired').title).toBe('Link abgelaufen');
  });
});
