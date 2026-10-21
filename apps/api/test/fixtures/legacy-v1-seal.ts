import { createCipheriv, randomBytes } from 'node:crypto';
import type { DataKey } from '../../src/crypto/data-key';

/**
 * The writer of the first at-rest format (AES-256-GCM), kept for tests only: data an instance
 * stored with it must still open and be rewritten by the backfill (`legacy-v1`).
 */

export function sealTextV1(plaintext: string, key: DataKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.legacy.textKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return 'slenc1:' + Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url');
}

export function sealBlobV1(data: Uint8Array, key: DataKey, chunkBytes = 64 * 1024): Uint8Array {
  const fileKey = randomBytes(32);
  const noncePrefix = randomBytes(8);
  const aad = Buffer.alloc(24);
  Buffer.from('SLB1', 'ascii').copy(aad, 0);
  aad.writeUInt32BE(chunkBytes, 4);
  aad.writeBigUInt64BE(BigInt(data.length), 8);
  noncePrefix.copy(aad, 16);
  const wrapIv = randomBytes(12);
  const wrap = createCipheriv('aes-256-gcm', key.legacy.wrapKey, wrapIv);
  wrap.setAAD(aad);
  const wrapped = Buffer.concat([wrap.update(fileKey), wrap.final()]);
  const parts: Buffer[] = [aad, wrapIv, wrapped, wrap.getAuthTag()];
  const count = Math.max(1, Math.ceil(data.length / chunkBytes));
  for (let index = 0; index < count; index++) {
    const nonce = Buffer.alloc(12);
    noncePrefix.copy(nonce, 0);
    nonce.writeUInt32BE(index, 8);
    const chunkAad = Buffer.alloc(5);
    chunkAad.writeUInt32BE(index, 0);
    chunkAad[4] = index === count - 1 ? 1 : 0;
    const cipher = createCipheriv('aes-256-gcm', fileKey, nonce);
    cipher.setAAD(chunkAad);
    const plain = data.subarray(
      index * chunkBytes,
      Math.min((index + 1) * chunkBytes, data.length),
    );
    parts.push(cipher.update(plain), cipher.final(), cipher.getAuthTag());
  }
  return Buffer.concat(parts);
}
