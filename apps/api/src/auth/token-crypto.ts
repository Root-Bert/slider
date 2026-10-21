/**
 * Encrypts Microsoft refresh tokens and stored settings at rest (AES-256-GCM, key derived from
 * SLIDER_SECRET; one key per `purpose`).
 * Format: `v1.<iv>.<ciphertext+tag>`, both base64url. Changing SLIDER_SECRET makes stored
 * tokens unreadable – people simply sign in again.
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

export const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(text, 'base64url'));

const MICROSOFT_PURPOSE = 'microsoft-refresh-token';

function deriveKey(secret: string, purpose: string): Promise<CryptoKey> {
  const cacheKey = `${purpose}\0${secret}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = crypto.subtle
      .importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
      .then((material) =>
        crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: encoder.encode('slider'),
            info: encoder.encode(purpose),
          },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    keys.set(cacheKey, key);
  }
  return key;
}

export async function encryptToken(
  secret: string,
  plaintext: string,
  purpose = MICROSOFT_PURPOSE,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await deriveKey(secret, purpose),
    encoder.encode(plaintext),
  );
  return [VERSION, toBase64Url(iv), toBase64Url(new Uint8Array(ciphertext))].join('.');
}

/** Throws when the payload was tampered with or encrypted with another secret. */
export async function decryptToken(
  secret: string,
  payload: string,
  purpose = MICROSOFT_PURPOSE,
): Promise<string> {
  const [version, iv, ciphertext] = payload.split('.');
  if (version !== VERSION || !iv || !ciphertext) throw new Error('Unknown token format');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    await deriveKey(secret, purpose),
    fromBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
