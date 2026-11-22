import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

/**
 * On a desktop the service runs once for every app of the family (desktop/service.mjs): each app
 * using it lays a file named by its process id into `SLIDER_APPS_DIR` – in it when that process
 * started – and takes it away when it goes. The last app to go ends the service itself; this is
 * for the app that could not – it crashed, or was killed: with no app left, the service ends.
 */

/**
 * When the process with this id started – `''`: none runs, `null`: it could not be found out.
 * Id and start together name one process for good: the id alone is given out again, after a
 * restart of the computer to any program. The same words as desktop/service.mjs (`startedAt`).
 *
 * Linux: the kernel's own count since this start of the computer (`/proc/<pid>/stat`, field 22)
 * with the id of that start – what `ps` prints there is worked out from the clock and may read
 * a second apart, or move when the clock is set. macOS keeps the time itself.
 */
export function processStarted(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  if (process.platform !== 'linux') {
    try {
      return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        // The same words whatever language and time zone the asking process runs in.
        env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' },
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (error) {
      // It ran and found no such process – anything else (no process to spare) says nothing.
      return (error as { status?: number }).status === 1 ? '' : null;
    }
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The name before may hold blanks and brackets: the fields count from the last bracket.
    const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return ticks ? `${boot} ${ticks}` : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ESRCH' ? '' : null;
  }
}

function startOf(file: string): string {
  try {
    const { started } = JSON.parse(readFileSync(file, 'utf8')) as { started?: unknown };
    return typeof started === 'string' ? started : '';
  } catch {
    return '';
  }
}

/** The apps using the service; what a gone app left is cleared away. No folder: none. */
export function liveApps(
  dir: string,
  startedAt: (pid: number) => string | null = processStarted,
): number[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const apps: number[] = [];
  for (const name of names) {
    const pid = Number(name);
    const file = path.join(dir, name);
    const started = startOf(file);
    const now = started === '' ? '' : startedAt(pid);
    // In doubt it runs: a look that failed must not clear away a live app's marker.
    if (started !== '' && (now === null || now === started)) apps.push(pid);
    else rmSync(file, { force: true });
  }
  return apps;
}

export interface WatchAppsOptions {
  /** How often to look. */
  everyMs?: number;
  /** Looks in a row without an app before the service ends: an app starting is not missed. */
  misses?: number;
  startedAt?: (pid: number) => string | null;
}

/** Calls `onNone` once when no app has used the service for `misses` looks; returns the stop. */
export function watchApps(
  dir: string,
  onNone: () => void,
  { everyMs = 5_000, misses = 3, startedAt = processStarted }: WatchAppsOptions = {},
): () => void {
  let missed = 0;
  const timer = setInterval(() => {
    missed = liveApps(dir, startedAt).length > 0 ? 0 : missed + 1;
    if (missed < misses) return;
    clearInterval(timer);
    onNone();
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** The exit of a service that found another one on its data (desktop/service.mjs, `GUARDED_EXIT`). */
export const GUARDED_EXIT_CODE = 76;

/**
 * Takes the port that stands for the data folder (`SLIDER_GUARD_PORT`); resolves to whether this
 * process has it. Held until the process is gone, whatever way it goes – nothing to clean up,
 * nothing left behind. The database bears one process only: who holds this may open it.
 */
export function holdData(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const guard = createServer((socket) => socket.destroy());
    guard.once('error', () => resolve(false));
    // Exclusive: never shared with another process, whatever the runtime's default.
    guard.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      // It keeps nothing alive: the server itself does.
      guard.unref();
      resolve(true);
    });
  });
}
