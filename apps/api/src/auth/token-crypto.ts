/**
 * Encrypts Microsoft refresh tokens at rest (AES-256-GCM, key derived from SLIDER_SECRET).
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

function deriveKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
      .then((material) =>
        crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: encoder.encode('slider'),
            info: encoder.encode('microsoft-refresh-token'),
          },
          material,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt'],
        ),
      );
    keys.set(secret, key);
  }
  return key;
}

export async function encryptToken(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await deriveKey(secret),
    encoder.encode(plaintext),
  );
  return [VERSION, toBase64Url(iv), toBase64Url(new Uint8Array(ciphertext))].join('.');
}

/** Throws when the payload was tampered with or encrypted with another secret. */
export async function decryptToken(secret: string, payload: string): Promise<string> {
  const [version, iv, ciphertext] = payload.split('.');
  if (version !== VERSION || !iv || !ciphertext) throw new Error('Unknown token format');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv) },
    await deriveKey(secret),
    fromBase64Url(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
