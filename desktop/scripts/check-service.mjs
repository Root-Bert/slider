// Checks the shared service (service.mjs) with real processes: every „app“ is a Node process of
// its own that uses the service like the desktop apps do, on a data folder made for the check.
// The API is the repo's (`bun apps/api/src/supervisor.ts`), without LibreOffice.
//   bun run --cwd desktop check:service      (~2 min; needs apps/web/dist – `bun run build`)
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { leaveService, newer, servicePaths, startedAt, useService } from '../service.mjs';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), '../..');

const serviceEnv = (paths, port, [secret, dataKey]) => ({
  HOME: os.homedir(),
  USER: os.userInfo().username,
  TMPDIR: os.tmpdir(),
  // Bun, and no LibreOffice: the check is about the service's life, not its drawing.
  PATH: [path.dirname(process.env.BUN ?? ''), '/usr/bin', '/bin'].join(':'),
  NODE_ENV: 'production',
  SLIDER_DESKTOP: 'true',
  HOST: '127.0.0.1',
  PORT: String(port),
  SLIDER_URL: `http://127.0.0.1:${port}`,
  DATA_DIR: paths.dataDir,
  WEB_DIST_DIR: path.join(repo, 'apps/web/dist'),
  SLIDER_SECRET: secret,
  SLIDER_DATA_KEY: dataKey,
  DEV_OWNER_NAME: 'Check',
  DEV_OWNER_EMAIL: 'ich@slider.desktop',
});

// ── An app: uses the service, says so, uses it again or leaves when told ──────────────────────
if (process.argv[2] === 'app') {
  const [root, name, version, libreoffice, ...keys] = process.argv.slice(3);
  const paths = servicePaths(root);
  const use = () =>
    useService({
      paths,
      own: {
        app: name,
        version,
        built: 0,
        packaged: true,
        libreoffice: libreoffice || null,
        appRoot: repo,
        bun: process.env.BUN,
      },
      env: (port) => serviceEnv(paths, port, keys),
    }).then(
      (used) => console.info(JSON.stringify(used)),
      (error) => console.info(JSON.stringify({ error: error.message })),
    );
  await use();
  for await (const line of createInterface({ input: process.stdin })) {
    if (line === 'use') await use();
    if (line !== 'leave') continue;
    await leaveService(paths);
    console.info('"left"');
    process.exit(0);
  }
  process.exit(0);
}

// ── The check ─────────────────────────────────────────────────────────────────────────────────
const root = mkdtempSync(path.join(os.tmpdir(), 'check-service-'));
const paths = servicePaths(root);
const keys = [randomBytes(48).toString('base64url'), randomBytes(32).toString('base64url')];
const bun = (() => {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    try {
      readFileSync(path.join(dir, 'bun'));
      return path.join(dir, 'bun');
    } catch {
      // not here
    }
  }
  throw new Error('bun not found in PATH');
})();

const apps = new Set();
/**
 * Starts an app; resolves once it has the service (or was refused): `{ port, started }` or
 * `{ error }`, with `again()`, `leave()` and `kill()`.
 */
async function startApp(name, version, { libreoffice = '' } = {}) {
  const child = spawn(process.execPath, [self, 'app', root, name, version, libreoffice, ...keys], {
    env: { ...process.env, BUN: bun },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  apps.add(child);
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const next = async () => {
    const { value, done } = await lines.next();
    if (done) throw new Error(`${name} ${version} went without a word`);
    return JSON.parse(value);
  };
  return {
    ...(await next()),
    pid: child.pid,
    again: () => {
      child.stdin.write('use\n');
      return next();
    },
    leave: async () => {
      child.stdin.write('leave\n');
      await exited;
    },
    kill: async () => {
      child.kill('SIGKILL');
      await exited;
    },
  };
}

const state = () => JSON.parse(readFileSync(paths.stateFile, 'utf8'));
const alive = (pid) => startedAt(pid) !== '';
const health = (port) =>
  fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) })
    .then((response) => response.ok)
    .catch(() => false);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function within(ms, test) {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) return false;
    await sleep(250);
  }
  return true;
}
/** The environment a process runs in, as far as it can be read. */
function environmentOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/environ`, 'utf8');
  } catch {
    try {
      return execFileSync('ps', ['-Eo', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    } catch {
      return '';
    }
  }
}
/** The servers that run on this check's data, by process id. */
const servers = () =>
  execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes('apps/api/src/server.ts'))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
    .filter((pid) => environmentOf(pid).includes(root));

let failed = 0;
function expect(what, ok) {
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failed += 1;
}

try {
  expect(
    'newer: by version, then by build; equal is not newer',
    newer({ version: '1.10.0' }, { version: '1.9.3' }) &&
      !newer({ version: '1.2.0' }, { version: '1.2.0' }) &&
      !newer({ version: '1.2.0' }, { version: '1.3.0' }) &&
      newer({ version: '0.1.0', built: 2 }, { version: '0.1.0', built: 1 }),
  );

  // A lock left by a process that is gone, and two apps starting at the same moment with no
  // service there: one starts it, the other uses it – never two.
  mkdirSync(path.dirname(paths.lockFile), { recursive: true });
  writeFileSync(
    paths.lockFile,
    JSON.stringify({ pid: 999_999, started: 'Thu Jan  1 00:00:00 1970', token: 'left' }),
  );
  const [a, b] = await Promise.all([startApp('Slider', '1.0.0'), startApp('Writer', '1.0.0')]);
  const first = state();
  expect(
    'two apps starting at once over a lock left behind: one starts the service, both use it',
    a.started !== b.started && a.port === b.port && (await health(a.port)),
  );
  expect('exactly one server runs on the data', servers().length === 1);

  // The service itself refuses a second one on the same data, whoever starts it.
  const second = spawn(bun, ['apps/api/src/supervisor.ts'], {
    cwd: repo,
    env: {
      ...serviceEnv(paths, a.port + 1, keys),
      SLIDER_APPS_DIR: paths.appsDir,
      SLIDER_GUARD_PORT: String(a.port + 1000),
    },
    stdio: 'ignore',
  });
  const code = await new Promise((resolve) => second.once('exit', resolve));
  expect(
    'a second service on the same data ends before it opens anything (exit 76)',
    code === 76 && servers().length === 1 && (await health(a.port)),
  );

  await a.leave();
  expect('one app leaves, the other is still served', alive(first.pid) && (await health(b.port)));

  const c = await startApp('Cloud', '1.1.0');
  const newerOne = state();
  expect(
    'a newer app puts its service in place of the older one, on the same port',
    c.started && c.port === b.port && newerOne.pid !== first.pid && !alive(first.pid),
  );
  expect('the app that was there before is served by the new one', await health(b.port));

  const d = await startApp('Slider', '1.0.0', { libreoffice: '/somewhere/soffice' });
  expect(
    'an older app uses the newer service – also when it has LibreOffice and that one has none',
    !d.started && state().pid === newerOne.pid && state().version === '1.1.0',
  );

  // Killed with its server: an app that uses it takes it up again.
  const [server] = servers();
  process.kill(newerOne.pid, 'SIGKILL');
  process.kill(server, 'SIGKILL');
  await within(5_000, () => !alive(newerOne.pid) && !alive(server));
  const taken = await c.again();
  expect(
    'the service killed: an app using it starts it anew on the same port',
    taken.started && taken.port === c.port && (await health(c.port)),
  );
  const joined = await d.again();
  expect('the older app uses that one', joined.started === false && joined.port === c.port);

  // The supervisor killed alone: its server must not stay behind holding port and data.
  const lone = state();
  const [orphan] = servers();
  process.kill(lone.pid, 'SIGKILL');
  expect(
    'the supervisor killed alone: its server ends itself',
    await within(20_000, () => !alive(orphan)),
  );
  const older = await d.again();
  expect(
    'no service left: the older release does not open data a newer one has worked on',
    typeof older.error === 'string' && older.error.includes('1.1.0') && servers().length === 0,
  );
  const back = await c.again();
  expect('the newer one starts it again', back.started && (await health(c.port)));

  // An app with LibreOffice finds the service running without: it starts its own.
  const withOffice = await startApp('Slider', '1.1.0', { libreoffice: '/somewhere/soffice' });
  expect(
    'an app that has LibreOffice replaces a service of its version that runs without',
    withOffice.started && state().libreoffice === '/somewhere/soffice',
  );

  const last = state();
  await b.leave();
  await d.leave();
  await c.leave();
  await withOffice.leave();
  expect(
    'the last app to go ends the service and frees the port',
    !alive(last.pid) && !(await health(c.port)) && servers().length === 0,
  );

  // What a restart of the computer leaves: an app's file whose id now belongs to another
  // program. It must not count as an app – else the service would never end.
  const bystander = spawn('sleep', ['300']);
  const e = await startApp('Slider', '1.1.0');
  const third = state();
  writeFileSync(
    path.join(paths.appsDir, String(bystander.pid)),
    JSON.stringify({ app: 'Writer', version: '1.1.0', started: 'Thu Jan  1 00:00:00 1970' }),
  );
  await e.kill();
  expect(
    'an app killed, a file left naming another program: the service ends itself',
    (await within(40_000, () => !alive(third.pid))) && alive(bystander.pid),
  );
  expect('what the gone apps left is cleared away', readdirSync(paths.appsDir).length === 0);

  // A process id used again by another program must never be signalled.
  writeFileSync(paths.stateFile, JSON.stringify({ ...third, pid: bystander.pid }));
  const f = await startApp('Slider', '2.0.0');
  expect(
    'a state naming another program: that one is left alone, the service starts',
    f.started && alive(bystander.pid) && state().pid !== bystander.pid,
  );
  bystander.kill();

  const [g, h] = await Promise.all([startApp('Writer', '2.0.0'), startApp('Cloud', '2.0.0')]);
  expect(
    'two apps starting at once with one running: both use it',
    !g.started && !h.started && g.port === f.port && h.port === f.port,
  );
  const fourth = state();
  await Promise.all([f.leave(), g.leave(), h.leave()]);
  expect(
    'all leaving at once: the service ended, no lock left',
    !alive(fourth.pid) && !readdirSync(path.dirname(paths.lockFile)).includes('lock'),
  );
} catch (error) {
  console.info(`FAIL  ${error.stack}`);
  failed += 1;
} finally {
  for (const child of apps) child.kill('SIGKILL');
  try {
    const { pid } = state();
    if (alive(pid)) process.kill(pid, 'SIGTERM');
  } catch {
    // no service left
  }
  await sleep(1_000);
  rmSync(root, { recursive: true, force: true });
}
console.info(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
