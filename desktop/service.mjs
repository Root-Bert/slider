// The local service – the API with its LibreOffices – runs once per computer, whichever apps are
// open: every app carries it and can start it, the first one does, the others use the one that
// runs. What they share lies in one folder (`sharedFolder`): data, LibreOffice, logs, the port.
//
//   service/apps/<pid>   an app using the service: its process id, and in it when that process
//                        started – a crashed app counts for nothing, nor does another program
//                        that got its id after a restart of the computer
//   service/state.json   the service that runs: its process, port and version
//   service/newest       the newest version that ever ran on this data
//   service/lock         held while one app starts or stops the service
//
// The newer service wins: an app that finds an older one running ends it and starts its own; the
// other apps find the new one on the same port. The last app to go ends the service, and the
// service ends itself when no app is left (apps/api/src/desktop-apps.ts) – after a crash.
//
// The database bears one process only. The lock keeps apps from starting two services, and
// should it ever fail the service itself refuses: the server holds a port of its own for as long
// as it has the data open (`SLIDER_GUARD_PORT`, apps/api/src/desktop-apps.ts) – a second one
// ends before it opens anything.
// No Electron in here: the check (scripts/check-service.mjs) runs it with plain Node.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const FIRST_PORT = 47821;
/** The port a running service holds besides its own, so that no second one opens the data. */
const guardPortOf = (port) => port + 1000;
/** What the service is started as – also how a process id is told to be one (`isService`). */
const ENTRY = 'apps/api/src/supervisor.ts';
const START_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;
/**
 * A lock older than this was left by a start that hung – longer than one may honestly take:
 * waiting for a service that hangs, ending it, and starting anew.
 */
const LOCK_STALE_MS = 300_000;
/** Another service on this data (apps/api/src/desktop-apps.ts, `GUARDED_EXIT_CODE`). */
const GUARDED_EXIT = 76;
/** How long a service that runs may take to answer before it counts as hung. */
const HUNG_AFTER_MS = 60_000;

/**
 * The folder every app of the family shares, under the system's app data: Slider's own, where
 * its data has always been – nothing moves, and the port (the page's origin, with its offline
 * outbox) stays.
 */
export const sharedFolder = (appData) => path.join(appData, 'Slider');

export function servicePaths(root) {
  const service = path.join(root, 'service');
  return {
    root,
    dataDir: path.join(root, 'data'),
    logDir: path.join(root, 'logs'),
    portFile: path.join(root, 'port'),
    stateFile: path.join(service, 'state.json'),
    newestFile: path.join(service, 'newest'),
    lockFile: path.join(service, 'lock'),
    appsDir: path.join(service, 'apps'),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** What `ps` says of this process – `''`: none runs, `null`: it could not be asked. */
function ps(pid, column) {
  try {
    return execFileSync('ps', ['-o', `${column}=`, '-p', String(pid)], {
      encoding: 'utf8',
      // The same words whatever language and time zone the asking process runs in.
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    // It ran and found no such process – anything else (no process to spare) says nothing.
    return error.status === 1 ? '' : null;
  }
}

/**
 * When the process with this id started – `''`: none runs, `null`: it could not be found out.
 * Id and start together name one process for good; the id alone is given out again, after a
 * restart of the computer to any program. The same words as apps/api/src/desktop-apps.ts.
 *
 * Linux: the kernel's own count since this start of the computer (`/proc/<pid>/stat`, field 22)
 * with the id of that start – what `ps` prints there is worked out from the clock and may read
 * a second apart, or move when the clock is set. macOS keeps the time itself.
 */
export function startedAt(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  if (process.platform !== 'linux') return ps(pid, 'lstart');
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The name before may hold blanks and brackets: the fields count from the last bracket.
    const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return ticks ? `${boot} ${ticks}` : null;
  } catch (error) {
    return error.code === 'ENOENT' || error.code === 'ESRCH' ? '' : null;
  }
}

/**
 * Whether the process that wrote `{ pid, started }` still runs. In doubt it does: a look that
 * failed must not clear away a live app's marker.
 */
function runs(mark) {
  if (!mark?.started) return false;
  const started = startedAt(mark.pid);
  return started === null || started === mark.started;
}

/** This process's start, asked again when the first look fails. */
function ownStart() {
  for (let tries = 0; tries < 5; tries++) {
    const started = startedAt(process.pid);
    if (started) return started;
  }
  throw new Error('Die Prozessliste des Systems ist nicht lesbar.');
}

/** What this process was started as – `''`: none runs, or it could not be found out. */
function commandOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  if (process.platform !== 'linux') return ps(pid, 'command') ?? '';
  try {
    // The kernel's own, as for the start: no `ps` needed there.
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
  } catch {
    return '';
  }
}

/** Whether this process is a service – a signal must never hit another program. */
const isService = (pid) => commandOf(pid).includes(ENTRY);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readState(paths) {
  const state = readJson(paths.stateFile);
  return state && Number.isInteger(state.pid) && Number.isInteger(state.port) ? state : null;
}

/** The service that runs, as its state names it – `null`: none. */
function runningService(paths) {
  const state = readState(paths);
  return state && isService(state.pid) ? state : null;
}

/** Whether a service runs (answering or not). */
export const serviceRuns = (paths) => runningService(paths) !== null;

const numbers = (version) =>
  String(version ?? '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

function compare(a, b) {
  const [left, right] = [numbers(a), numbers(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Whether `own` is newer than the service `running`: by version, and for the same version (two
 * starts from the repo) by when it was built.
 */
export const newer = (own, running) =>
  (compare(own.version, running.version) || (own.built ?? 0) - (running.built ?? 0)) > 0;

async function answers(port, withinMs = 0, giveUp = () => false) {
  const until = Date.now() + withinMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return true;
    } catch {
      // not listening (yet)
    }
    if (Date.now() >= until || giveUp()) return false;
    await sleep(250);
  }
}

/** Whether the service this app uses answers. */
export const serviceAnswers = (port) => answers(port);

// ── The apps using the service ────────────────────────────────────────────────────────────────

/** This app uses the service from now on. */
function join(paths, own) {
  mkdirSync(paths.appsDir, { recursive: true });
  // Whole at once (written beside, then moved in): read half-written it would count as left behind.
  const written = `${paths.appsDir}.${process.pid}`;
  writeFileSync(
    written,
    JSON.stringify({ app: own.app, version: own.version, started: ownStart() }),
  );
  renameSync(written, path.join(paths.appsDir, String(process.pid)));
}

/** The other apps using the service; what a gone app left is cleared away. */
function otherApps(paths) {
  if (!existsSync(paths.appsDir)) return [];
  const others = [];
  for (const name of readdirSync(paths.appsDir)) {
    const pid = Number(name);
    if (pid === process.pid) continue;
    const file = path.join(paths.appsDir, name);
    if (runs({ pid, started: readJson(file)?.started })) others.push(pid);
    else rmSync(file, { force: true });
  }
  return others;
}

// ── One app at a time starts or stops it ──────────────────────────────────────────────────────

/** The lock as it lies there: who holds it, and its age – `null`: free. */
function heldBy(paths) {
  try {
    return {
      ...JSON.parse(readFileSync(paths.lockFile, 'utf8')),
      age: Date.now() - statSync(paths.lockFile).mtimeMs,
    };
  } catch (error) {
    // Unreadable can only be a file that is not ours: it comes whole or not at all (`take`).
    return error.code === 'ENOENT' ? null : { token: null, age: Infinity };
  }
}

/**
 * Resolves to the release. `withinMs`: how long to wait for another app that holds it.
 * The file appears whole (a hard link to one written before) and only the process that holds it
 * takes it away; one left by a process that is gone is moved aside by exactly one of those
 * waiting, which checks that it moved that very one.
 */
async function lock(paths, withinMs = LOCK_STALE_MS) {
  mkdirSync(path.dirname(paths.lockFile), { recursive: true });
  const token = randomBytes(12).toString('hex');
  const mine = `${paths.lockFile}.${process.pid}.${token}`;
  const until = Date.now() + withinMs;
  const take = () => {
    const mark = JSON.stringify({ pid: process.pid, started: ownStart(), token });
    writeFileSync(mine, mark);
    try {
      linkSync(mine, paths.lockFile);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
    } finally {
      rmSync(mine, { force: true });
    }
    // A disk without hard links (exFAT, some network folders): made in one go instead – another
    // app may read it before it is written, which the service's own port makes up for.
    try {
      writeFileSync(paths.lockFile, mark, { flag: 'wx' });
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return false;
    }
  };
  const release = () => {
    if (heldBy(paths)?.token === token) rmSync(paths.lockFile, { force: true });
  };
  for (;;) {
    if (take()) return release;
    const held = heldBy(paths);
    if (!held) continue; // released just now
    if (!runs(held) || held.age > LOCK_STALE_MS) {
      const aside = `${mine}.left`;
      try {
        renameSync(paths.lockFile, aside);
      } catch {
        continue; // another one waiting moved it
      }
      // Moved a lock taken in between instead of the one seen: it goes back to its holder.
      if (readJson(aside)?.token !== held.token) {
        try {
          linkSync(aside, paths.lockFile);
        } catch {
          // the place is taken again; the service's own port keeps the data safe
        }
      }
      rmSync(aside, { force: true });
      continue;
    }
    if (Date.now() > until) {
      throw new Error('Eine andere App startet den lokalen Dienst gerade und wird nicht fertig.');
    }
    await sleep(200);
  }
}

async function gone(pid, withinMs) {
  const until = Date.now() + withinMs;
  while (startedAt(pid) !== '') {
    if (Date.now() >= until) return false;
    await sleep(100);
  }
  return true;
}

/** Ends the service: asked first (it closes its database), then with its whole process group. */
async function stop(pid) {
  if (!isService(pid)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  if (await gone(pid, STOP_TIMEOUT_MS)) return;
  // Still the service, not another program that got its id meanwhile.
  if (!isService(pid)) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // gone meanwhile
  }
  await gone(pid, 2_000);
}

// ── Port ──────────────────────────────────────────────────────────────────────────────────────

const portFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });

const savedPort = (paths) =>
  existsSync(paths.portFile) ? Number(readFileSync(paths.portFile, 'utf8')) : null;

/** The port stays the same from start to start: the page's origin – and its offline outbox – hang on it. */
async function choosePort(paths) {
  const saved = savedPort(paths);
  if (saved) {
    // A service ending just now holds it a while longer – its server may take up to 13 s to
    // go when its supervisor was killed alone.
    for (let tries = 0; tries < 80; tries++) {
      if (await portFree(saved)) return saved;
      await sleep(250);
    }
    throw new Error(`Port ${saved} ist belegt – läuft ein anderes Programm auf diesem Port?`);
  }
  for (let port = FIRST_PORT; port < FIRST_PORT + 100; port++) {
    if ((await portFree(port)) && (await portFree(guardPortOf(port)))) {
      writeFileSync(paths.portFile, String(port));
      return port;
    }
  }
  throw new Error('Kein freier Port für Office gefunden.');
}

// ── Start, use, leave ─────────────────────────────────────────────────────────────────────────

/**
 * Whether the running service is to make way for this app's: it is older, or it runs without
 * LibreOffice and this app has one (loaded meanwhile).
 */
const replaces = (own, running) =>
  newer(own, running) || (!newer(running, own) && Boolean(own.libreoffice) && !running.libreoffice);

/**
 * Data a newer release has worked on is not opened by an older one: it would not know what
 * changed there. Starts from the repo are the developer's own business.
 */
function refuseOlder(paths, own) {
  const newest = readJson(paths.newestFile);
  if (!own.packaged || !newest || compare(newest.version, own.version) <= 0) return;
  throw new Error(
    `Diese Daten wurden schon mit ${newest.app} ${newest.version} geöffnet – ${own.app} ${own.version} ist älter und öffnet sie nicht. Bitte ${own.app} aktualisieren.`,
  );
}

/** Releases only: what a start from the repo ran on says nothing about the data's age. */
function noteNewest(paths, own) {
  if (!own.packaged) return;
  const newest = readJson(paths.newestFile);
  if (newest && compare(own.version, newest.version) <= 0) return;
  writeFileSync(paths.newestFile, JSON.stringify({ app: own.app, version: own.version }));
}

/**
 * The service for this app: the one that runs if it is as new as this app's, else this app's own
 * – started in place of an older one. Resolves to `{ port, started }` once it answers.
 *
 * `own`: `app` (its name), `version`, `built` (ms, 0 when packaged), `packaged`, `libreoffice`
 * (its `soffice`, if any), `appRoot` and `bun` – the service this app carries. `env(port)`: the
 * environment its service starts in. `hungAfterMs`: how long a service that runs may stay
 * without an answer before this app's takes its place.
 */
export async function useService({ paths, own, env, hungAfterMs = HUNG_AFTER_MS }) {
  mkdirSync(paths.root, { recursive: true });
  join(paths, own);
  const release = await lock(paths);
  try {
    const running = runningService(paths);
    if (running) {
      // It may be ending itself right now (no app was left): then it is not waited for.
      const ending = () => !isService(running.pid);
      if (!replaces(own, running) && (await answers(running.port, hungAfterMs, ending))) {
        return { port: running.port, started: false };
      }
      await stop(running.pid);
    }
    refuseOlder(paths, own);
    const port = await choosePort(paths);
    mkdirSync(paths.dataDir, { recursive: true });
    mkdirSync(paths.logDir, { recursive: true });
    // A server on its way out still holds the data for a moment: its place is tried again.
    for (let tries = 1; ; tries++) {
      const ended = await start(paths, own, env, port);
      if (ended === null) break;
      if (ended !== `exit ${GUARDED_EXIT}`) {
        throw new Error(`Der lokale Dienst ist beim Start abgebrochen (${ended}).`);
      }
      if (tries === 4) {
        throw new Error(
          `Port ${guardPortOf(port)} ist belegt – läuft Office auf diesen Daten schon, oder ein anderes Programm auf diesem Port?`,
        );
      }
      await sleep(5_000);
    }
    noteNewest(paths, own);
    return { port, started: true };
  } finally {
    release();
  }
}

/** Starts this app's service on `port`; resolves to `null` once it answers, else to how it ended. */
async function start(paths, own, env, port) {
  const logFile = path.join(paths.logDir, 'api.log');
  const log = openSync(logFile, 'a');
  writeSync(
    log,
    `\n── ${new Date().toISOString()} start on port ${port} (${own.app} ${own.version}) ──\n`,
  );
  let ended = null;
  // Its own process group and no pipes to this app: it outlives the app that started it.
  const child = spawn(own.bun, [ENTRY], {
    cwd: own.appRoot,
    env: {
      ...env(port),
      SLIDER_APPS_DIR: paths.appsDir,
      SLIDER_GUARD_PORT: String(guardPortOf(port)),
    },
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.on('error', (error) => {
    ended = error.message;
  });
  // Only heard while this app runs; else the next start's line tells that it went.
  child.on('exit', (code, signal) => {
    ended = `exit ${code ?? signal}`;
    try {
      appendFileSync(logFile, `── ${new Date().toISOString()} ${ended} ──\n`);
    } catch {
      // the log is not worth failing for
    }
  });
  child.unref();
  closeSync(log);
  // What the state said before: should another service turn out to have the data (the lock
  // failed), it is that one's, and goes back.
  const before = readState(paths);
  writeFileSync(
    paths.stateFile,
    JSON.stringify({
      pid: child.pid,
      port,
      app: own.app,
      version: own.version,
      built: own.built ?? 0,
      libreoffice: own.libreoffice ?? null,
    }),
  );
  const until = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const answered = await answers(port);
    if (!ended && !answered && Date.now() > until) {
      await stop(child.pid);
      ended = 'er antwortet nicht';
    }
    // Asked before the answer is trusted: it may be another service's, with this one gone.
    if (ended) {
      if (readState(paths)?.pid === child.pid) {
        if (before && ended === `exit ${GUARDED_EXIT}`) {
          writeFileSync(paths.stateFile, JSON.stringify(before));
        } else {
          rmSync(paths.stateFile, { force: true });
        }
      }
      return ended;
    }
    if (answered) return null;
    await sleep(250);
  }
}

/** This app is done with the service; the last one to go ends it. */
export async function leaveService(paths) {
  rmSync(path.join(paths.appsDir, String(process.pid)), { force: true });
  let release;
  try {
    // Quitting does not wait out another app's start: that app is there, and uses the service.
    release = await lock(paths, 5_000);
  } catch {
    return;
  }
  try {
    if (otherApps(paths).length > 0) return;
    const running = readState(paths);
    if (running) await stop(running.pid);
    rmSync(paths.stateFile, { force: true });
  } finally {
    release();
  }
}
