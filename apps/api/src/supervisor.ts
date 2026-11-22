import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { watchApps } from './desktop-apps';

/**
 * Entry point of the Docker image: runs `server.ts` and starts it again when it exits with
 * {@link RESTART_EXIT_CODE} – which it does after settings were saved on the setup page, since
 * login clients are built once at start. Signals are passed on; any other exit ends the container.
 *
 * On a desktop it is the service the family's apps share (desktop/service.mjs): it ends once no
 * app uses it any more (`SLIDER_APPS_DIR`).
 */

/** Same value as in `server.ts`. */
const RESTART_EXIT_CODE = 75;
const SERVER = fileURLToPath(new URL('./server.ts', import.meta.url));

let child: ChildProcess | null = null;
let stopping = false;

function start(): void {
  child = spawn(process.execPath, [SERVER], {
    stdio: 'inherit',
    env: { ...process.env, SLIDER_SUPERVISED: '1' },
  });
  child.on('exit', (code, signal) => {
    if (!stopping && code === RESTART_EXIT_CODE) {
      console.info('Restarting Slider to apply the new settings…');
      start();
      return;
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
    if (child) child.kill(signal);
    else process.exit(0);
  });
}

function run(): void {
  const appsDir = process.env['SLIDER_APPS_DIR'];
  if (appsDir) {
    watchApps(appsDir, () => {
      console.info('No app uses Slider any more, stopping…');
      stopping = true;
      child?.kill('SIGTERM');
    });
  }
  start();
}

run();
