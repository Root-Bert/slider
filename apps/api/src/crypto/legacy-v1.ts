import { createDecipheriv } from 'node:crypto';
import type { DataKey } from './data-key';

/**
 * Reading the first at-rest format (AES-256-GCM, written for a short while in BER-149) – only so
 * the backfill can rewrite it into the libsodium format. Nothing writes it any more. Remove once
 * every instance has run backfill `v3` (`content-encryption`).
 */

const TEXT_PREFIX = 'slenc1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const isSealedV1 = (value: string): boolean => value.startsWith(TEXT_PREFIX);

export function openTextV1(value: string, key: DataKey): string {
  const bytes = Buffer.from(value.slice(TEXT_PREFIX.length), 'base64url');
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error('Sealed value is truncated.');
  return Buffer.from(
    decrypt(
      key.legacy.textKey,
      bytes.subarray(0, IV_BYTES),
      bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES),
      bytes.subarray(bytes.length - TAG_BYTES),
    ),
  ).toString('utf8');
}

// Blob: magic `SLB1` | chunk size u32 | plaintext size u64 | nonce prefix (8) | wrap IV (12) |
// wrapped file key (32) | wrap tag (16), then chunks of ciphertext + tag.
const MAGIC = Buffer.from('SLB1', 'ascii');
const AAD_BYTES = MAGIC.length + 4 + 8 + 8;
const HEADER_BYTES = AAD_BYTES + IV_BYTES + 32 + TAG_BYTES;

export const isSealedBlobV1 = (bytes: Uint8Array): boolean =>
  bytes.length >= HEADER_BYTES && MAGIC.equals(bytes.subarray(0, MAGIC.length));

export function openBlobV1(raw: Uint8Array, key: DataKey): Uint8Array<ArrayBuffer> {
  const buffer = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const aad = buffer.subarray(0, AAD_BYTES);
  const chunkBytes = aad.readUInt32BE(4);
  const size = Number(aad.readBigUInt64BE(8));
  const noncePrefix = aad.subarray(16, AAD_BYTES);
  const fileKey = decrypt(
    key.legacy.wrapKey,
    buffer.subarray(AAD_BYTES, AAD_BYTES + IV_BYTES),
    buffer.subarray(AAD_BYTES + IV_BYTES, AAD_BYTES + IV_BYTES + 32),
    buffer.subarray(AAD_BYTES + IV_BYTES + 32, HEADER_BYTES),
    aad,
  );
  if (chunkBytes <= 0 || !Number.isSafeInteger(size)) throw new Error('Invalid blob header.');
  const count = Math.max(1, Math.ceil(size / chunkBytes));
  const out = new Uint8Array(size);
  let offset = HEADER_BYTES;
  for (let index = 0; index < count; index++) {
    const length = Math.min(chunkBytes, Math.max(size - index * chunkBytes, 0));
    const nonce = Buffer.alloc(IV_BYTES);
    noncePrefix.copy(nonce, 0);
    nonce.writeUInt32BE(index, 8);
    const chunkAad = Buffer.alloc(5);
    chunkAad.writeUInt32BE(index, 0);
    chunkAad[4] = index === count - 1 ? 1 : 0;
    const plain = decrypt(
      fileKey,
      nonce,
      buffer.subarray(offset, offset + length),
      buffer.subarray(offset + length, offset + length + TAG_BYTES),
      chunkAad,
    );
    out.set(plain, index * chunkBytes);
    offset += length + TAG_BYTES;
  }
  if (offset !== buffer.length) throw new Error('Encrypted blob has the wrong length.');
  return out;
}

function decrypt(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer, aad?: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
