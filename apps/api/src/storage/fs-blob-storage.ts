import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { assertValidKey, type BlobStorage } from './blob-storage';

export class FsBlobStorage implements BlobStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async size(key: string): Promise<number | null> {
    try {
      const info = await stat(this.resolve(key));
      return info.isFile() ? info.size : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async stream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null> {
    if ((await this.size(key)) === null) return null;
    const nodeStream = createReadStream(this.resolve(key), range ? { ...range } : {});
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix.endsWith('/')) throw new Error(`Prefix must end with "/": ${prefix}`);
    await rm(this.resolve(prefix.slice(0, -1)), { recursive: true, force: true });
  }

  /** Maps a key to a path inside the root; the second check is defence in depth. */
  private resolve(key: string): string {
    assertValidKey(key);
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Key escapes storage root: ${key}`);
    return file;
  }
}

const isNotFound = (error: unknown) =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EISDIR');
