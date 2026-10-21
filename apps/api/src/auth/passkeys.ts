import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Config } from '../config';

/**
 * Passkeys (WebAuthn) with `@simplewebauthn/server`. The relying party is the web app's origin:
 * RP ID = its host name, so passkeys stay valid across ports in development but not across
 * domains – moving Slider to another domain invalidates every passkey.
 *
 * The four library calls sit behind {@link WebAuthn} so tests can replace the cryptographic
 * verification (a real attestation needs a real authenticator).
 */
export interface WebAuthn {
  generateRegistrationOptions: typeof generateRegistrationOptions;
  verifyRegistrationResponse: typeof verifyRegistrationResponse;
  generateAuthenticationOptions: typeof generateAuthenticationOptions;
  verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
}

export const simpleWebAuthn: WebAuthn = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};

export const RP_NAME = 'Slider';
/** A ceremony (options → browser → verify) must finish within this. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export const relyingParty = (config: Pick<Config, 'webOrigin'>) => {
  const origin = new URL(config.webOrigin);
  return { rpID: origin.hostname, origin: origin.origin };
};

/** "Passkey (Mac)" & co. – a default name from the browser's user agent. */
export function defaultPasskeyName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux|CrOS/.test(ua)
              ? 'Linux'
              : null;
  return device ? `Passkey (${device})` : 'Passkey';
}
