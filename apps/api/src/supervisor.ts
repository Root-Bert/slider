import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Entry point of the Docker image: runs `server.ts` and starts it again when it exits with
 * {@link RESTART_EXIT_CODE} – which it does after settings were saved on the setup page, since
 * login clients are built once at start. Signals are passed on; any other exit ends the container.
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
    child?.kill(signal);
  });
}

start();
