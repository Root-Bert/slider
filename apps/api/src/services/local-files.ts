import { execFile } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync, watch, type FSWatcher } from 'node:fs';
import { chmod, lstat, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import type { LocalFiles } from '@slider/shared';
import { decks, revisions } from '../db/schema';
import type { AppDeps } from '../deps';
import { sha256Hex } from '../import/common';
import { isOdpKey } from '../import/odp-deck';
import { readJsonFile, writeJsonFile } from './desktop-json';

/*
 * The desktop's files (BER-201): a presentation opened from an ODP on this computer keeps that
 * file as the truth, like Keynote.
 *
 *  - A change made to the file elsewhere (LibreOffice, a sync folder) comes in as a new version,
 *    its slides matched and comments kept. The system tells (a watch on the file's folder) – no
 *    looking every few seconds; a slow look every half minute only catches what a watch misses
 *    (network drives).
 *  - A new step in Slider is written to the file once editing rests a moment (`SETTLE_MS`), not
 *    on every keystroke – at once when asked (`run({ flush: true })`: the window leaves the front,
 *    the app quits, tests). Written atomically: a temporary file renamed over it, with the old
 *    file's mode and extended attributes (Finder tags, comments) carried over.
 *  - Renamed in its folder, it is found again by its inode. Moved elsewhere or deleted, it is
 *    left alone (`missing`) until it is opened again; deleting the presentation leaves the file.
 *
 * Links in `<dataDir>/local-files.json`.
 */

/** How often the decks' current revisions are looked at (a database read, no file). */
const DECKS_EVERY_MS = 1_000;
/** How often the files are looked at without the system telling. */
const FILES_EVERY_MS = 30_000;
/** A step is written once no other followed for this long. */
const SETTLE_MS = 1_500;

interface FileLink {
  path: string;
  /** The revision file last written to or read from the file. */
  key: string | null;
  /** The file's bytes, mtime and size as last written or read. */
  sha: string | null;
  mtimeMs: number;
  size: number;
  /** The file's identity on its disk: found again after a rename in its folder. */
  ino?: number;
  missing?: boolean;
  /** The last change made elsewhere taken in (ISO). */
  changedAt?: string;
}

type Links = Record<string, FileLink>;

interface RunOptions {
  /** Write a step now, rested or not. */
  flush?: boolean;
}

export class LocalFilesSync {
  private readonly file: string;
  private running: Promise<void> | null = null;
  private again: RunOptions | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private watchers = new Map<string, FSWatcher>();
  /** Files to look at in the next pass (the system told, or the slow look). */
  private filesDue = true;
  /** A revision first seen: when, to write it only once editing rested. */
  private seen = new Map<string, { key: string; at: number }>();
  private soon: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: AppDeps) {
    this.file = path.join(deps.config.dataDir, 'local-files.json');
  }

  /** Watches and passes (not under test: there they are asked for). */
  start(): void {
    if (this.timers.length > 0 || this.deps.config.env === 'test') return;
    this.timers.push(
      setInterval(() => void this.run(), DECKS_EVERY_MS),
      setInterval(() => {
        this.filesDue = true;
        void this.run();
      }, FILES_EVERY_MS),
    );
    for (const timer of this.timers) timer.unref?.();
    this.watchFolders(this.read());
  }

  list(): LocalFiles {
    const files: LocalFiles = {};
    for (const [deckId, link] of Object.entries(this.read())) {
      files[deckId] = {
        path: link.path,
        missing: link.missing === true,
        changedAt: link.changedAt ?? null,
      };
    }
    return files;
  }

  /** The deck already linked to this file, if any. */
  deckOf(filePath: string): string | null {
    const wanted = fileItself(filePath);
    return Object.entries(this.read()).find(([, link]) => link.path === wanted)?.[0] ?? null;
  }

  /**
   * The deck is this file from now on. `written`: the file holds the deck's current revision
   * (just opened from it); otherwise the next pass writes it.
   */
  async link(deckId: string, filePath: string, written: boolean): Promise<void> {
    const resolved = fileItself(filePath);
    let sha: string | null = null;
    let mtimeMs = 0;
    let size = 0;
    let ino: number | undefined;
    let key: string | null = null;
    if (written) {
      const bytes = await readFile(resolved);
      const info = await stat(resolved);
      sha = sha256Hex(bytes);
      mtimeMs = info.mtimeMs;
      size = info.size;
      ino = info.ino;
      key = (await this.states([deckId])).get(deckId)?.key ?? null;
    }
    // Read only now, written at once: another link or a pass meanwhile is not lost.
    const links = this.read();
    // One file, one presentation.
    for (const [other, link] of Object.entries(links)) {
      if (link.path === resolved && other !== deckId) delete links[other];
    }
    links[deckId] = { path: resolved, key, sha, mtimeMs, size, ino };
    this.write(links);
    this.watchFolders(links);
  }

  /** „Im Finder zeigen“: the file to show (Electron shows it), `null` when there is none. */
  revealed(deckId: string): string | null {
    const link = this.read()[deckId];
    return link && !link.missing ? link.path : null;
  }

  /** One pass; asked for while one runs, another follows it. Asked for, the files are looked at. */
  run(options: RunOptions = {}): Promise<void> {
    if (options.flush) this.filesDue = true;
    if (this.running) {
      this.again = { flush: Boolean(this.again?.flush || options.flush) };
      return this.running;
    }
    this.running = (async () => {
      try {
        let next: RunOptions | null = options;
        while (next) {
          this.again = null;
          // Never a rejection: the timers start passes without waiting for them.
          await this.pass(next).catch((error: unknown) =>
            this.deps.log.warn('desktop files: pass failed', error),
          );
          next = this.again;
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** The folders of the linked files watched: a change there starts a pass. */
  private watchFolders(links: Links): void {
    if (this.timers.length === 0) return;
    const folders = new Set(Object.values(links).map((link) => path.dirname(link.path)));
    for (const [folder, watcher] of this.watchers) {
      if (folders.has(folder)) continue;
      watcher.close();
      this.watchers.delete(folder);
    }
    for (const folder of folders) {
      if (this.watchers.has(folder) || !existsSync(folder)) continue;
      try {
        const watcher = watch(folder, { persistent: false }, (_event, name) => {
          // Our own temporary file coming and going is no change.
          if (name?.toString().endsWith('.slider')) return;
          this.filesDue = true;
          // A save is several events in a row: one pass after them.
          if (this.soon) clearTimeout(this.soon);
          this.soon = setTimeout(() => void this.run(), 200);
        });
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(folder);
        });
        this.watchers.set(folder, watcher);
      } catch (error) {
        this.deps.log.warn(`desktop files: no watch on ${folder}`, error);
      }
    }
  }

  private async pass(options: RunOptions): Promise<void> {
    const links = this.read();
    const ids = Object.keys(links);
    if (ids.length === 0) return;
    const lookAtFiles = this.filesDue;
    this.filesDue = false;
    const pathAtStart = new Map(ids.map((id) => [id, links[id]!.path]));
    const states = await this.states(ids);
    let changed = false;
    for (const [deckId, link] of Object.entries(links)) {
      const state = states.get(deckId);
      if (!state) {
        // The presentation was deleted: the file stays as it is.
        delete links[deckId];
        this.seen.delete(deckId);
        changed = true;
        continue;
      }
      if (!state.ready || state.pending) continue;
      try {
        changed =
          (await this.bringTogether(deckId, link, state.key, lookAtFiles, options)) || changed;
      } catch (error) {
        this.deps.log.warn(`desktop file ${link.path}`, error);
      }
    }
    if (!changed) return;
    // Linked meanwhile (`link`) stays: only what this pass looked at is written over.
    const fresh = this.read();
    for (const deckId of ids) {
      if (fresh[deckId]?.path !== pathAtStart.get(deckId)) continue;
      if (links[deckId]) fresh[deckId] = links[deckId];
      else delete fresh[deckId];
    }
    this.write(fresh);
    this.watchFolders(fresh);
  }

  /** Takes a change made to the file in, else writes a new step out. Whether `link` changed. */
  private async bringTogether(
    deckId: string,
    link: FileLink,
    key: string | null,
    lookAtFile: boolean,
    { flush = false }: RunOptions,
  ): Promise<boolean> {
    let changed = false;
    // Never written yet („Als Datei sichern …“ to a new file): nothing there to miss or take in.
    if (link.sha !== null && (lookAtFile || link.missing)) {
      let info = await stat(link.path).catch(() => null);
      if (!info) {
        const renamed = await this.renamedTo(link);
        if (renamed) {
          link.path = renamed;
          info = await stat(renamed);
          changed = true;
        }
      }
      if (!info) {
        if (link.missing) return changed;
        link.missing = true;
        return true;
      }
      if (link.missing) {
        // Back where it was: written again only after it was read (below).
        delete link.missing;
        link.mtimeMs = -1;
        changed = true;
      }
      if (info.mtimeMs !== link.mtimeMs || info.size !== link.size) {
        const bytes = new Uint8Array(await readFile(link.path));
        const sha = sha256Hex(bytes);
        link.mtimeMs = info.mtimeMs;
        link.size = info.size;
        link.ino = info.ino;
        changed = true;
        if (sha !== link.sha) {
          // Changed elsewhere: a new version of the presentation.
          link.sha = sha;
          link.changedAt = this.deps.clock.now().toISOString();
          this.seen.delete(deckId);
          await this.deps.sync.importUpload(deckId, bytes);
          return true;
        }
      }
    }
    if (link.missing || !key || key === link.key) return changed;
    // Only an ODP is written back: its own format, nothing lost.
    if (!isOdpKey(key)) return changed;
    // Written once editing rested – or at once when asked.
    const now = this.deps.clock.now().getTime();
    const first = this.seen.get(deckId);
    if (first?.key !== key) this.seen.set(deckId, { key, at: now });
    if (!flush && now - (first?.key === key ? first.at : now) < SETTLE_MS) return changed;
    this.seen.delete(deckId);
    const bytes = await this.deps.storage.get(key);
    if (!bytes) return changed;
    const sha = sha256Hex(bytes);
    if (sha !== link.sha && !lookAtFile) {
      // Changed elsewhere and not looked at yet (a watch that missed it, a network drive): that
      // change comes in first, in the next pass – never written over.
      const info = await stat(link.path).catch(() => null);
      if (!info || info.mtimeMs !== link.mtimeMs || info.size !== link.size) {
        this.filesDue = true;
        return changed;
      }
    }
    link.key = key;
    if (sha !== link.sha) {
      await this.writeOver(link.path, bytes);
      const written = await stat(link.path);
      link.sha = sha;
      link.mtimeMs = written.mtimeMs;
      link.size = written.size;
      link.ino = written.ino;
    }
    return true;
  }

  /**
   * The bytes into the file, atomically: a temporary file beside it, the old file's mode and
   * extended attributes (Finder tags, comments, colour labels) carried over, renamed over it.
   */
  private async writeOver(filePath: string, bytes: Uint8Array): Promise<void> {
    const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.slider`);
    await writeFile(temporary, bytes);
    const before = await stat(filePath).catch(() => null);
    if (before) await chmod(temporary, before.mode & 0o7777).catch(() => {});
    if (before && process.platform === 'darwin') await copyAttributes(filePath, temporary);
    await rename(temporary, filePath);
  }

  /** A file renamed in its folder: the one there with the same inode, if any. */
  private async renamedTo(link: FileLink): Promise<string | null> {
    if (link.ino === undefined) return null;
    const folder = path.dirname(link.path);
    const names = await readdir(folder).catch(() => [] as string[]);
    for (const name of names) {
      if (name.startsWith('.') || !/\.(odp|otp)$/i.test(name)) continue;
      const candidate = path.join(folder, name);
      // Not a symlink to it: that is another name, written over it would no longer point there.
      const info = await lstat(candidate).catch(() => null);
      if (info?.ino === link.ino) return candidate;
    }
    return null;
  }

  /** Each deck's current revision file, whether it is imported and whether a version is coming. */
  private async states(ids: string[]) {
    const rows = await this.deps.db
      .select({
        id: decks.id,
        importState: decks.importState,
        key: revisions.pptxKey,
      })
      .from(decks)
      .leftJoin(revisions, eq(revisions.id, decks.currentRevisionId))
      .where(inArray(decks.id, ids));
    const pending = new Set(
      (
        await this.deps.db
          .select({ deckId: revisions.deckId })
          .from(revisions)
          .where(and(inArray(revisions.deckId, ids), eq(revisions.status, 'pending')))
      ).map((row) => row.deckId),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          key: row.key ?? null,
          ready: row.importState.status === 'ready',
          pending: pending.has(row.id),
        },
      ]),
    );
  }

  private read(): Links {
    return readJsonFile<Links>(this.file) ?? {};
  }

  private write(links: Links): void {
    writeJsonFile(this.file, links);
  }
}

const execFileAsync = promisify(execFile);

/**
 * The file a path names – through a symlink the one it points to: written over (temporary file +
 * rename), the symlink would become a copy and the file itself stay as it was.
 */
function fileItself(filePath: string): string {
  let current = path.resolve(filePath);
  // Link by link (not `realpath`): the folders stay as named, as for a file opened directly.
  for (let hops = 0; hops < 8; hops++) {
    try {
      if (!lstatSync(current).isSymbolicLink()) return current;
      current = path.resolve(path.dirname(current), readlinkSync(current));
    } catch {
      return current;
    }
  }
  return current;
}

/**
 * macOS: the extended attributes of `from` onto `to` (`xattr`; none lost if it fails). Not
 * blocking: the API answers the pages meanwhile.
 */
async function copyAttributes(from: string, to: string): Promise<void> {
  const xattr = (args: string[]) =>
    execFileAsync('/usr/bin/xattr', args, { encoding: 'utf8' }).then(
      ({ stdout }) => stdout,
      () => null,
    );
  const names = await xattr([from]);
  if (names === null) return;
  for (const name of names.split('\n').filter(Boolean)) {
    // Where it was downloaded from belongs to that download, not to what Slider wrote.
    if (name === 'com.apple.quarantine') continue;
    const value = await xattr(['-px', name, from]);
    if (value === null) continue;
    await xattr(['-wx', name, value.replace(/\s+/g, ''), to]);
  }
}
