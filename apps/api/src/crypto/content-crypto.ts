import { sodium } from './sodium';
import type { DataKey } from './data-key';
import { isSealedV1, openTextV1 } from './legacy-v1';

/**
 * Encryption of database values (BER-149) with libsodium's
 * `crypto_aead_xchacha20poly1305_ietf` and a random 24-byte nonce per value, stored as
 * `slenc3:<nonce|ciphertext>` (base64url). Synchronous, so Drizzle column types can use it on
 * every read and write.
 *
 * The value's place goes in as additional data: a `context` naming table and column
 * (`decks.title`), so a value copied into another column fails to open instead of showing up
 * there. Not the row – Drizzle's column types never see it – so values can still be swapped
 * between rows of the same column (or put back from an older backup) by someone who can write
 * the database.
 *
 * Blank strings (spaces only) stay as they are: they carry nothing, and SQL keeps telling empty comments apart
 * (`open-comments`). Values without a prefix are read as they are – rows written before
 * encryption – and `slenc1:` values of the first format and `slenc2:` ones sealed without the
 * context are still read, until the backfill (`content-encryption`) has rewritten them all.
 */

export const SEALED_PREFIX = 'slenc3:';
/** The libsodium format before the context was bound in: opened without additional data. */
const UNBOUND_PREFIX = 'slenc2:';

let active: DataKey | null = null;

/** Set once on start (and per test context); every encrypted column uses it. */
export function useDataKey(key: DataKey): void {
  active = key;
}

export function activeDataKey(): DataKey {
  if (!active) throw new Error('No data key set – call useDataKey() on start.');
  return active;
}

/**
 * A keyed hash of the address (trimmed, lower case), base64url: equal for the same address, but
 * without the data key neither readable nor to be guessed by hashing candidates.
 */
export function emailHash(email: string, key: DataKey = activeDataKey()): string {
  const digest = sodium.crypto_generichash(32, email.trim().toLowerCase(), key.emailHashKey);
  return Buffer.from(digest).toString('base64url');
}

/** In the current format. */
export const isSealed = (value: string): boolean => value.startsWith(SEALED_PREFIX);

/** In any format this app can open. */
export const isEncrypted = (value: string): boolean =>
  isSealed(value) || value.startsWith(UNBOUND_PREFIX) || isSealedV1(value);

/** `context` names where the value is stored (`table.column`); opening needs the same one. */
export function sealText(
  plaintext: string,
  context: string,
  key: DataKey = activeDataKey(),
): string {
  // Text that merely looks sealed (a comment typed as "slenc3:…") is sealed too, so reading
  // never tries to open what a person wrote.
  if (isBlank(plaintext)) return plaintext;
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    context,
    null,
    nonce,
    key.fieldKey,
  );
  const sealed = new Uint8Array(nonce.length + ciphertext.length);
  sealed.set(nonce);
  sealed.set(ciphertext, nonce.length);
  return SEALED_PREFIX + Buffer.from(sealed).toString('base64url');
}

/**
 * Exactly what SQL's `btrim(value) = ''` takes for blank (spaces only, not tabs or line breaks):
 * the backfill and `open-comments` test in SQL, and must see what stays plaintext the same way.
 */
const isBlank = (value: string) => /^ *$/.test(value);

/** Throws when the value was tampered with, sealed with another key or for another `context`. */
export function openText(value: string, context: string, key: DataKey = activeDataKey()): string {
  if (isSealed(value)) return open(value.slice(SEALED_PREFIX.length), context, key);
  if (value.startsWith(UNBOUND_PREFIX)) return open(value.slice(UNBOUND_PREFIX.length), null, key);
  if (isSealedV1(value)) return openTextV1(value, key);
  return value;
}

function open(encoded: string, context: string | null, key: DataKey): string {
  const bytes = Buffer.from(encoded, 'base64url');
  const nonceBytes = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    bytes.subarray(nonceBytes),
    context,
    bytes.subarray(0, nonceBytes),
    key.fieldKey,
    'text',
  );
}
