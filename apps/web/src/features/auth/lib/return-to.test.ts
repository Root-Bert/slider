import { describe, expect, it } from 'vitest';
import { isLoginError, loginErrorCopy, signupHintCopy } from './return-to';

describe('signupHintCopy', () => {
  it('explains how accounts come about in each SIGNUP mode', () => {
    expect(signupHintCopy('open')).toBe(
      'Noch kein Konto? Es wird beim ersten Anmelden automatisch erstellt.',
    );
    expect(signupHintCopy('invite')).toMatch(/Einladung/);
    expect(signupHintCopy('domains')).toMatch(/Firmenadresse/);
  });
});

describe('login errors', () => {
  it('recognises known codes only', () => {
    expect(isLoginError('signup_closed')).toBe(true);
    expect(isLoginError('nope')).toBe(false);
    expect(isLoginError(null)).toBe(false);
  });

  it('has German copy for every code', () => {
    expect(loginErrorCopy('signup_closed').title).toBe('Kein Konto gefunden');
  });
});
