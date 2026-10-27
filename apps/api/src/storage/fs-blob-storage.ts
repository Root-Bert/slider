import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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
    await locks.hold(file, async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeInPlace(file, data);
    });
  }

  /**
   * Replaces a blob with `transform` of its content – only while it is still the same file: one
   * deleted (or written anew) meanwhile is left alone, never brought back. `false` then, and when
   * `transform` returns `null`. For the encryption backfill (BER-149), which runs next to requests:
   * it holds the key's lock, so a `put`, `delete` or `deletePrefix` of it waits until the sealed
   * file is in place (and then overwrites or removes it).
   */
  async rewrite(key: string, transform: (data: Uint8Array) => Uint8Array | null): Promise<boolean> {
    const file = this.resolve(key);
    return locks.hold(file, () => this.rewriteLocked(key, file, transform));
  }

  private async rewriteLocked(
    key: string,
    file: string,
    transform: (data: Uint8Array) => Uint8Array | null,
  ): Promise<boolean> {
    // Checked anyway: the lock covers this process only, not a hand on the data folder.
    const before = await statFile(file);
    if (!before) return false;
    const data = await this.get(key);
    if (!data) return false;
    const next = transform(data);
    if (!next) return false;
    // No `mkdir`: a folder removed by `deletePrefix` stays removed – the write just fails.
    return writeInPlace(file, next, async () => {
      const now = await statFile(file);
      return (
        now !== null &&
        now.ino === before.ino &&
        now.size === before.size &&
        now.mtimeMs === before.mtimeMs
      );
    });
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

  async modifiedAt(key: string): Promise<Date | null> {
    try {
      const info = await stat(this.resolve(key));
      return info.isFile() ? info.mtime : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async stream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null> {
    // One open file for the whole stream: a file replaced meanwhile (the encryption backfill
    // renames sealed files into place) is read as it was when opened, never half of each.
    let handle;
    try {
      handle = await open(this.resolve(key), 'r');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    try {
      if (!(await handle.stat()).isFile()) {
        await handle.close();
        return null;
      }
      // From here the stream owns the handle (`autoClose`).
      const nodeStream = handle.createReadStream(range ? { ...range } : {});
      return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await locks.hold(file, () => rm(file, { force: true }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix.endsWith('/')) throw new Error(`Prefix must end with "/": ${prefix}`);
    const folder = this.resolve(prefix.slice(0, -1));
    // Waits for every write below it: a `.partial` file appearing mid-delete fails it (ENOTEMPTY).
    await locks.hold(folder + path.sep, () => rm(folder, { recursive: true, force: true }));
  }

  async list(prefix: string): Promise<string[]> {
    if (!prefix.endsWith('/')) throw new Error(`Prefix must end with "/": ${prefix}`);
    let entries;
    try {
      entries = await readdir(this.resolve(prefix.slice(0, -1)), {
        recursive: true,
        withFileTypes: true,
      });
    } catch (error) {
      if (
        isNotFound(error) ||
        (error instanceof Error && 'code' in error && error.code === 'ENOTDIR')
      )
        return [];
      throw error;
    }
    return (
      entries
        // Leftovers of a write cut short by a crash are no blobs.
        .filter((entry) => entry.isFile() && !entry.name.endsWith('.partial'))
        .map((entry) => path.relative(this.root, path.join(entry.parentPath, entry.name)))
        .map((relative) => relative.split(path.sep).join('/'))
    );
  }

  /** Maps a key to a path inside the root; the second check is defence in depth. */
  private resolve(key: string): string {
    assertValidKey(key);
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Key escapes storage root: ${key}`);
    return file;
  }
}

/**
 * Writes, rewrites and deletes of one path run one after another, and a folder's delete waits
 * for (and holds off) everything below it. Without it the encryption backfill's rewrite could
 * rename a sealed copy into place right after a `delete` (bringing the file back), or leave a
 * `.partial` file in a folder `deletePrefix` is removing. In-process only: Slider runs as one
 * process per data folder. Reads take no lock – they hold their file open (`stream`).
 */
class PathLocks {
  /** Held paths; a folder ends in the path separator. */
  private readonly held = new Map<string, Promise<void>>();

  async hold<T>(scope: string, run: () => Promise<T>): Promise<T> {
    for (;;) {
      const blocking = [...this.held].filter(([held]) => overlaps(held, scope));
      if (blocking.length === 0) break;
      await Promise.all(blocking.map(([, done]) => done));
    }
    // Taken right after the check, with no `await` between: nothing else can slip in.
    let release!: () => void;
    this.held.set(scope, new Promise((resolve) => (release = resolve)));
    try {
      return await run();
    } finally {
      this.held.delete(scope);
      release();
    }
  }
}

const overlaps = (a: string, b: string) =>
  a === b || (a.endsWith(path.sep) && b.startsWith(a)) || (b.endsWith(path.sep) && a.startsWith(b));

/** Shared by every store: two stores on the same folder must not miss each other's locks. */
const locks = new PathLocks();

/**
 * Written next to the file and renamed into place: a crash mid-write leaves the old file whole –
 * the encryption backfill overwrites files in place (BER-149). `stillWanted` is asked right
 * before the rename; `false` (or a folder gone meanwhile) drops the write.
 */
async function writeInPlace(
  file: string,
  data: Uint8Array,
  stillWanted?: () => Promise<boolean>,
): Promise<boolean> {
  const partial = `${file}.${crypto.randomUUID()}.partial`;
  try {
    await writeFile(partial, data);
    if (stillWanted && !(await stillWanted())) {
      await rm(partial, { force: true });
      return false;
    }
    await rename(partial, file);
    return true;
  } catch (error) {
    await rm(partial, { force: true });
    if (stillWanted && isNotFound(error)) return false;
    throw error;
  }
}

async function statFile(file: string) {
  try {
    const info = await stat(file);
    return info.isFile() ? info : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

const isNotFound = (error: unknown) =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EISDIR');
