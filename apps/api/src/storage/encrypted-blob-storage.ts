import { isSealedBlobV1, openBlobV1 } from '../crypto/legacy-v1';
import type { DataKey } from '../crypto/data-key';
import { sodium } from '../crypto/sodium';
import type { Logger } from '../logger';
import type { BlobStorage } from './blob-storage';

/**
 * Encrypts every blob at rest (BER-149) around another store: callers keep seeing plaintext,
 * the disk only ever holds ciphertext.
 *
 * The format is libsodium's `crypto_secretstream_xchacha20poly1305` – made for exactly this:
 * a file encrypted in chunks, each authenticated, with a random header per file (so one key
 * serves every file), and a final tag that makes a cut-off file fail instead of reading short.
 * On disk: magic `SLS2` | stream header (24 bytes) | chunks of 64 KiB plaintext + 17 bytes.
 *
 * Every chunk carries the blob's key (`decks/…/source.pptx`) as additional data: a file copied
 * or moved to another key does not open there. Nothing in this app moves files between keys –
 * every copy goes through `get` and `put`, which seal anew. Not bound: putting back an older
 * file under the same key (from a backup), and which of the two stores a file lies in.
 *
 * A byte range (recordings, Safari) decrypts from the start and skips up to it – the stream
 * format is sequential; at several hundred MB/s that is cheap for comment recordings.
 *
 * Files without the magic are read as they are (stored before encryption), and files of the
 * first format (`SLB1`, `legacy-v1`) and of `SLS1` (the same stream without the key bound in)
 * are still read – until the backfill (`content-encryption`) has rewritten them all. Once it has
 * (`refusePlaintext`), a file without the magic was not written by Slider – put there by someone
 * with access to the disk, or a sealed file cut short – and reads as missing.
 */

const MAGIC = Buffer.from('SLS2', 'ascii');
/** The stream format before the key was bound in; same layout, opened without additional data. */
const UNBOUND_MAGIC = Buffer.from('SLS1', 'ascii');
export const CHUNK_BYTES = 64 * 1024;
const STREAM_HEADER_BYTES = 24;
const PREFIX_BYTES = MAGIC.length + STREAM_HEADER_BYTES;
const ABYTES = 17;

type Kind = 'sealed' | 'unbound' | 'v1' | 'plain' | 'missing';

export class EncryptedBlobStorage implements BlobStorage {
  /** Set once the backfill sealed everything: plaintext files are refused from then on. */
  private plaintextRefusedBy: Logger | null = null;

  constructor(
    private readonly inner: BlobStorage,
    private readonly key: DataKey,
  ) {}

  /**
   * Called by the backfill once every file stored before encryption is sealed: from now on a
   * file without the magic reads as missing (logged as a warning) instead of as plaintext.
   */
  refusePlaintext(log: Logger): void {
    this.plaintextRefusedBy = log;
  }

  /** `true` (and logged) when a plaintext file is refused. */
  private refused(key: string): boolean {
    if (!this.plaintextRefusedBy) return false;
    this.plaintextRefusedBy.warn(
      `Refused to read ${key}: the file is not encrypted, though everything stored was sealed – it was put there from outside or is damaged.`,
    );
    return true;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.inner.put(key, sealBlob(data, this.key, key));
  }

  async get(key: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const raw = await this.inner.get(key);
    if (!raw) return null;
    if (kindOf(raw) === 'plain' && this.refused(key)) return null;
    return openAny(raw, this.key, key);
  }

  async size(key: string): Promise<number | null> {
    switch (await this.kind(key)) {
      case 'missing':
        return null;
      case 'plain': {
        if (this.refused(key)) return null;
        // The backfill may seal the file around the size read: then that size is no plaintext's.
        // Files only ever turn from plain to sealed, so asking again ends.
        const raw = await this.inner.size(key);
        if (raw === null) return null;
        return (await this.kind(key)) === 'plain' ? raw : this.size(key);
      }
      case 'v1':
        return (await this.get(key))?.length ?? null;
      case 'sealed':
      case 'unbound': {
        const raw = await this.inner.size(key);
        return raw === null ? null : plaintextSize(raw);
      }
    }
  }

  async stream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null> {
    // The format is told from the same stream that is served: with a second read, a file the
    // backfill seals in between would be served as the ciphertext of a "plaintext" file.
    const raw = await this.inner.stream(key);
    if (!raw) return null;
    const { head, rest } = await peek(raw, PREFIX_BYTES + ABYTES);
    const kind = kindOf(head);
    if (kind === 'sealed') return decryptStream(rest, this.key, key, range);
    if (kind === 'unbound') return decryptStream(rest, this.key, null, range);
    if (kind === 'v1') {
      const plain = openBlobV1(await collect(rest), this.key);
      return bytesStream(range ? plain.subarray(range.start, range.end + 1) : plain);
    }
    if (this.refused(key)) {
      await rest.cancel();
      return null;
    }
    // Stored before encryption: a range is read from the start, until the backfill sealed it.
    return range ? sliceStream(rest, range) : rest;
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  deletePrefix(prefix: string): Promise<void> {
    return this.inner.deletePrefix(prefix);
  }

  list(prefix: string): Promise<string[]> {
    return this.inner.list(prefix);
  }

  /**
   * Rewrites a blob stored as plaintext or in an older format, in place (backfill). `false`
   * when it is in the current format already or gone.
   */
  async sealInPlace(key: string): Promise<boolean> {
    // Peek first: on later runs nearly everything is sealed, and recordings are large.
    const kind = await this.kind(key);
    if (kind === 'sealed' || kind === 'missing') return false;
    const seal = (raw: Uint8Array) =>
      kindOf(raw) === 'sealed' ? null : sealBlob(openAny(raw, this.key, key), this.key, key);
    // Only while the file is still there and unchanged: a deck deleted meanwhile stays deleted.
    if (isRewritable(this.inner)) return this.inner.rewrite(key, seal);
    const raw = await this.inner.get(key);
    const sealed = raw && seal(raw);
    if (!sealed || (await this.inner.size(key)) === null) return false;
    await this.inner.put(key, sealed);
    return true;
  }

  private async kind(key: string): Promise<Kind> {
    const stream = await this.inner.stream(key, { start: 0, end: PREFIX_BYTES + ABYTES - 1 });
    if (!stream) return 'missing';
    return kindOf(await collect(stream));
  }
}

/** A store that can replace a blob only while it is unchanged (`FsBlobStorage`). */
type Rewritable = BlobStorage & {
  rewrite(key: string, transform: (data: Uint8Array) => Uint8Array | null): Promise<boolean>;
};

const isRewritable = (store: BlobStorage): store is Rewritable =>
  typeof (store as Partial<Rewritable>).rewrite === 'function';

function kindOf(head: Uint8Array): Exclude<Kind, 'missing'> {
  if (head.length >= PREFIX_BYTES + ABYTES) {
    const magic = head.subarray(0, MAGIC.length);
    if (MAGIC.equals(magic)) return 'sealed';
    if (UNBOUND_MAGIC.equals(magic)) return 'unbound';
  }
  // The first format's magic sits in the first 4 bytes as well.
  if (head.length >= 4 && Buffer.from(head.subarray(0, 4)).toString('ascii') === 'SLB1')
    return 'v1';
  return 'plain';
}

/** The plaintext of a whole blob in any format. */
function openAny<T extends Uint8Array>(
  raw: T,
  key: DataKey,
  blobKey: string,
): T | Uint8Array<ArrayBuffer> {
  switch (kindOf(raw)) {
    case 'sealed':
      return openBlob(raw, key, blobKey);
    case 'unbound':
      return openBlob(raw, key, null);
    case 'v1':
      return isSealedBlobV1(raw) ? openBlobV1(raw, key) : raw;
    case 'plain':
      return raw;
  }
}

/** `blobKey` is the key the file is stored under; only that key opens it again. */
export function sealBlob(data: Uint8Array, key: DataKey, blobKey: string): Uint8Array {
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key.blobKey);
  const parts: Uint8Array[] = [MAGIC, header];
  const count = chunkCount(data.length);
  for (let index = 0; index < count; index++) {
    const chunk = data.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    const tag =
      index === count - 1
        ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
        : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    parts.push(sodium.crypto_secretstream_xchacha20poly1305_push(state, chunk, blobKey, tag));
  }
  return Buffer.concat(parts);
}

/** `blobKey` as sealed with, or `null` for the `SLS1` format. */
export function openBlob(
  raw: Uint8Array,
  key: DataKey,
  blobKey: string | null,
): Uint8Array<ArrayBuffer> {
  const opener = new ChunkOpener(raw.subarray(MAGIC.length, PREFIX_BYTES), key, blobKey);
  const out = new Uint8Array(plaintextSize(raw.length));
  let read = PREFIX_BYTES;
  let written = 0;
  while (read < raw.length) {
    const sealed = raw.subarray(read, read + CHUNK_BYTES + ABYTES);
    const plain = opener.open(sealed, read + sealed.length === raw.length);
    out.set(plain, written);
    written += plain.length;
    read += sealed.length;
  }
  opener.assertFinished();
  return out;
}

/** One stream's decryption state: every chunk in order, the last one tagged final. */
class ChunkOpener {
  private readonly state: ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_pull>;
  private finished = false;

  constructor(
    header: Uint8Array,
    key: DataKey,
    private readonly additionalData: string | null,
  ) {
    this.state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key.blobKey);
  }

  open(sealed: Uint8Array, last: boolean): Uint8Array {
    if (this.finished) throw new Error('Encrypted blob continues after its final chunk.');
    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(
      this.state,
      sealed,
      this.additionalData,
    );
    if (!result) {
      throw new Error(
        'Encrypted blob is damaged, sealed with another data key or stored under another key.',
      );
    }
    this.finished = result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
    if (last && !this.finished) throw new Error('Encrypted blob is truncated.');
    return result.message;
  }

  assertFinished(): void {
    if (!this.finished) throw new Error('Encrypted blob is truncated.');
  }
}

/** Plaintext of the inclusive `range` (or all of it), decrypted as the raw stream comes in. */
function decryptStream(
  raw: ReadableStream<Uint8Array>,
  key: DataKey,
  blobKey: string | null,
  range?: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const reader = raw.getReader();
  const start = range?.start ?? 0;
  const end = range?.end ?? Number.POSITIVE_INFINITY;
  let buffered = Buffer.alloc(0);
  let done = false;
  let opener: ChunkOpener | null = null;
  let position = 0;

  // Fills the buffer to `bytes` (or to the end of the raw stream).
  const fill = async (bytes: number) => {
    while (!done && buffered.length < bytes) {
      const next = await reader.read();
      if (next.done) done = true;
      else buffered = Buffer.concat([buffered, next.value]);
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!opener) {
        await fill(PREFIX_BYTES);
        opener = new ChunkOpener(buffered.subarray(MAGIC.length, PREFIX_BYTES), key, blobKey);
        buffered = buffered.subarray(PREFIX_BYTES);
      }
      for (;;) {
        if (position > end) {
          await reader.cancel();
          controller.close();
          return;
        }
        // One byte past the chunk tells whether it is the last one.
        await fill(CHUNK_BYTES + ABYTES + 1);
        if (buffered.length === 0) {
          opener.assertFinished();
          controller.close();
          return;
        }
        const sealed = buffered.subarray(0, CHUNK_BYTES + ABYTES);
        buffered = buffered.subarray(sealed.length);
        const plain = opener.open(sealed, done && buffered.length === 0);
        const from = Math.max(start - position, 0);
        const to = Math.min(end - position + 1, plain.length);
        position += plain.length;
        if (from < to) {
          controller.enqueue(plain.slice(from, to));
          return;
        }
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

/** Always at least one chunk, so an empty file still carries its final tag. */
const chunkCount = (size: number) => Math.max(1, Math.ceil(size / CHUNK_BYTES));

function plaintextSize(rawSize: number): number {
  const body = rawSize - PREFIX_BYTES;
  return body - Math.max(1, Math.ceil(body / (CHUNK_BYTES + ABYTES))) * ABYTES;
}

/** The first `bytes` of a stream (fewer when it is shorter), and the whole stream again. */
async function peek(
  stream: ReadableStream<Uint8Array>,
  bytes: number,
): Promise<{ head: Buffer; rest: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  let done = false;
  while (length < bytes) {
    const next = await reader.read();
    if (next.done) {
      done = true;
      break;
    }
    parts.push(next.value);
    length += next.value.length;
  }
  const head = Buffer.concat(parts);
  const rest = new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.length > 0) controller.enqueue(head);
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) return;
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { head, rest };
}

/** The inclusive `range` of a plaintext stream. */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  range: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let position = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (position > range.end) {
          await reader.cancel();
          controller.close();
          return;
        }
        const next = await reader.read();
        if (next.done) {
          controller.close();
          return;
        }
        const from = Math.max(range.start - position, 0);
        const to = Math.min(range.end - position + 1, next.value.length);
        position += next.value.length;
        if (from < to) {
          controller.enqueue(next.value.slice(from, to));
          return;
        }
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}

const bytesStream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
