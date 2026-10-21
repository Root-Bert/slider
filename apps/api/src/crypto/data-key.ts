import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sodium } from './sodium';

/**
 * The key content is encrypted with at rest (BER-149): files in the blob stores and the content
 * columns of the database. Kept apart from `SLIDER_SECRET`, which lives in the data volume and
 * its backups – a key next to the data it locks protects nothing.
 *
 * Sources, first wins: `SLIDER_DATA_KEY` (32 bytes, base64url), `SLIDER_DATA_KEY_FILE`, else
 * `<dataDir>/data-key`, generated on the first start.
 *
 * Subkeys come from libsodium's key derivation (`crypto_kdf`), one per use.
 */
export interface DataKey {
  /** Short public fingerprint: tells keys apart without revealing them. */
  readonly id: string;
  /** Database values (`crypto_aead_xchacha20poly1305_ietf`). */
  readonly fieldKey: Uint8Array;
  /** Files (`crypto_secretstream_xchacha20poly1305`). */
  readonly blobKey: Uint8Array;
  /** Keyed hashes that recognise an e-mail address without keeping it (`crypto_generichash`). */
  readonly emailHashKey: Uint8Array;
  /** The keys of the first format (AES-256-GCM), only to read what it wrote (`legacy-v1`). */
  readonly legacy: { readonly textKey: Buffer; readonly wrapKey: Buffer };
}

export const DATA_KEY_BYTES = 32;
export const DATA_KEY_FILE = 'data-key';
const KDF_CONTEXT = 'sliderdk';
const FIELD_SUBKEY = 1;
const BLOB_SUBKEY = 2;
const EMAIL_HASH_SUBKEY = 3;
/** Like `config.ts`: `.env` lives in the repo root, so a relative `SLIDER_DATA_KEY_FILE` is meant from there. */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Needs libsodium loaded (`loadSodium`). */
export function dataKeyFromBytes(raw: Uint8Array): DataKey {
  if (raw.length !== DATA_KEY_BYTES) {
    throw new Error(`The data key must be ${DATA_KEY_BYTES} bytes (got ${raw.length}).`);
  }
  const legacy = (purpose: string) =>
    Buffer.from(hkdfSync('sha256', raw, 'slider-data-key', purpose, 32));
  return {
    id: createHmac('sha256', raw).update('slider-data-key-id').digest('hex').slice(0, 16),
    fieldKey: sodium.crypto_kdf_derive_from_key(32, FIELD_SUBKEY, KDF_CONTEXT, raw),
    blobKey: sodium.crypto_kdf_derive_from_key(32, BLOB_SUBKEY, KDF_CONTEXT, raw),
    emailHashKey: sodium.crypto_kdf_derive_from_key(32, EMAIL_HASH_SUBKEY, KDF_CONTEXT, raw),
    legacy: { textKey: legacy('db-text'), wrapKey: legacy('blob-wrap') },
  };
}

export function parseDataKey(text: string, source: string): DataKey {
  const raw = Buffer.from(text.trim(), 'base64url');
  if (raw.length !== DATA_KEY_BYTES) {
    throw new Error(
      `${source} holds no usable data key: expected ${DATA_KEY_BYTES} bytes as base64url, e.g. from \`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='\`.`,
    );
  }
  return dataKeyFromBytes(raw);
}

export const generateDataKey = (): string => randomBytes(DATA_KEY_BYTES).toString('base64url');

export interface LoadedDataKey {
  key: DataKey;
  /** Where it came from – a key in the data folder sits next to what it protects. */
  source: 'env' | 'file' | 'data-dir';
  /** The file it was read from or written to, for `file` and `data-dir`. */
  file?: string;
  /** `true` when this start generated it. */
  created: boolean;
}

export function loadDataKey(env: NodeJS.ProcessEnv, dataDir: string): LoadedDataKey {
  const inline = env.SLIDER_DATA_KEY?.trim();
  if (inline)
    return { key: parseDataKey(inline, 'SLIDER_DATA_KEY'), source: 'env', created: false };
  const configured = env.SLIDER_DATA_KEY_FILE?.trim();
  if (configured) {
    const file = path.resolve(REPO_ROOT, configured);
    if (!existsSync(file)) throw new Error(`SLIDER_DATA_KEY_FILE=${configured} does not exist.`);
    return {
      key: parseDataKey(readFileSync(file, 'utf8'), file),
      source: 'file',
      file,
      created: false,
    };
  }
  const file = path.join(dataDir, DATA_KEY_FILE);
  if (existsSync(file)) {
    return {
      key: parseDataKey(readFileSync(file, 'utf8'), file),
      source: 'data-dir',
      file,
      created: false,
    };
  }
  mkdirSync(dataDir, { recursive: true });
  const text = generateDataKey();
  writeFileSync(file, `${text}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return { key: parseDataKey(text, file), source: 'data-dir', file, created: true };
}
