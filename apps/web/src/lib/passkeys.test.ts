import type * as SimpleWebAuthn from '@simplewebauthn/browser';
import { WebAuthnError } from '@simplewebauthn/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubBrokenStorage, stubStorage } from '@/test/storage';
import { ApiError } from './api-client';
import {
  dismissPasskeyHint,
  isPasskeyCancel,
  passkeyErrorMessage,
  passkeyHintDismissed,
  signInWithPasskey,
} from './passkeys';

vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof SimpleWebAuthn>()),
  startAuthentication: vi.fn().mockResolvedValue({ id: 'cred' }),
}));

afterEach(() => vi.unstubAllGlobals());

const webAuthnError = (code: ConstructorParameters<typeof WebAuthnError>[0]['code']) =>
  new WebAuthnError({ message: code, code, cause: new Error(code) });

const named = (name: string) => Object.assign(new Error(name), { name });

describe('isPasskeyCancel', () => {
  it('treats a closed dialog or an aborted ceremony as a cancel', () => {
    expect(isPasskeyCancel(named('NotAllowedError'))).toBe(true);
    expect(isPasskeyCancel(named('AbortError'))).toBe(true);
    expect(isPasskeyCancel(webAuthnError('ERROR_CEREMONY_ABORTED'))).toBe(true);
  });

  it('reports everything else', () => {
    expect(isPasskeyCancel(webAuthnError('ERROR_INVALID_DOMAIN'))).toBe(false);
    expect(isPasskeyCancel(named('SecurityError'))).toBe(false);
    expect(isPasskeyCancel('NotAllowedError')).toBe(false);
  });
});

describe('passkeyErrorMessage', () => {
  it('passes API messages through', () => {
    expect(passkeyErrorMessage(new ApiError(400, 'bad_request', 'Passkey ungültig.'))).toBe(
      'Passkey ungültig.',
    );
  });

  it('explains known WebAuthn failures in German', () => {
    expect(passkeyErrorMessage(webAuthnError('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'))).toBe(
      'Auf diesem Gerät ist schon ein Passkey für dein Konto gespeichert.',
    );
    const https = 'Passkeys funktionieren nur über HTTPS (oder localhost).';
    expect(passkeyErrorMessage(webAuthnError('ERROR_INVALID_DOMAIN'))).toBe(https);
    expect(passkeyErrorMessage(webAuthnError('ERROR_INVALID_RP_ID'))).toBe(https);
  });

  it('falls back to a generic message', () => {
    const fallback = 'Der Passkey konnte nicht verwendet werden. Bitte versuche es erneut.';
    expect(passkeyErrorMessage(new Error('x'))).toBe(fallback);
    expect(passkeyErrorMessage(webAuthnError('ERROR_CEREMONY_ABORTED'))).toBe(fallback);
  });
});

describe('passkey hint', () => {
  it('is remembered per browser', () => {
    const { values } = stubStorage();
    expect(passkeyHintDismissed()).toBe(false);
    dismissPasskeyHint();
    expect(values.get('slider.passkeyHintDismissed')).toBe('1');
    expect(passkeyHintDismissed()).toBe(true);
  });

  it('comes back when storage is unavailable', () => {
    stubBrokenStorage();
    expect(() => dismissPasskeyHint()).not.toThrow();
    expect(passkeyHintDismissed()).toBe(false);
  });
});

describe('signInWithPasskey', () => {
  it('fetches options, runs the ceremony and verifies it with the return target', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ challenge: 'c' }))
      .mockResolvedValueOnce(Response.json({ redirectTo: '/d/1' }));
    vi.stubGlobal('fetch', fetch);
    await expect(signInWithPasskey('/d/1')).resolves.toEqual({ redirectTo: '/d/1' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/auth/passkey/options',
      '/api/auth/passkey/verify',
    ]);
    expect(JSON.parse((fetch.mock.calls[1]![1] as RequestInit).body as string)).toEqual({
      response: { id: 'cred' },
      returnTo: '/d/1',
    });
  });
});
