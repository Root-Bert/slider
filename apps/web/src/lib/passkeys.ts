import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { LoginResult, Passkey } from '@slider/shared';
import { api, ApiError } from './api-client';
import { readString, writeString } from './storage';

/** Passkeys (WebAuthn) in the browser: sign in, register, and what to say when it fails. */

export const passkeysSupported = () => browserSupportsWebAuthn();

/** The whole sign-in ceremony. */
export async function signInWithPasskey(returnTo: string): Promise<LoginResult> {
  const optionsJSON =
    await api.post<PublicKeyCredentialRequestOptionsJSON>('/auth/passkey/options');
  const response = await startAuthentication({ optionsJSON });
  return api.post<LoginResult>('/auth/passkey/verify', {
    response: response as unknown as Record<string, unknown>,
    returnTo,
  });
}

export async function registerPasskey(): Promise<Passkey> {
  const optionsJSON = await api.post<PublicKeyCredentialCreationOptionsJSON>(
    '/passkeys/register/options',
  );
  const response = await startRegistration({ optionsJSON });
  return api.post<Passkey>('/passkeys/register/verify', {
    response: response as unknown as Record<string, unknown>,
  });
}

/** The person closed the browser dialog (or another ceremony took over): nothing to report. */
export function isPasskeyCancel(error: unknown): boolean {
  if (error instanceof WebAuthnError) return error.code === 'ERROR_CEREMONY_ABORTED';
  return (
    error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}

/** German copy for a failed ceremony; API errors bring their own message. */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof WebAuthnError) {
    if (error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return 'Auf diesem Gerät ist schon ein Passkey für dein Konto gespeichert.';
    }
    if (error.code === 'ERROR_INVALID_DOMAIN' || error.code === 'ERROR_INVALID_RP_ID') {
      return 'Passkeys funktionieren nur über HTTPS (oder localhost).';
    }
  }
  return 'Der Passkey konnte nicht verwendet werden. Bitte versuche es erneut.';
}

/** Hint "Schneller anmelden: Passkey hinzufügen" – dismissed per browser. */
const HINT_KEY = 'slider.passkeyHintDismissed';
export const passkeyHintDismissed = (): boolean => readString(HINT_KEY) === '1';
/** Private mode & co.: the hint simply comes back next time. */
export const dismissPasskeyHint = (): void => writeString(HINT_KEY, '1');
