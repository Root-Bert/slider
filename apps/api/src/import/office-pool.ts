import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Logger } from '../logger';
import { isPdfBytes } from '../sources/safe-fetch';
import {
  ConversionAborted,
  ConversionFailed,
  ConversionTimedOut,
  hardenedProfile,
} from './libreoffice';

/*
 * LibreOffice kept running for the editor (BER-181): starting `soffice` for every drawing costs
 * about two seconds, a running one draws a slide in about a tenth of that. Each worker is one
 * `soffice` running Slider's script (`office-worker.py`) inside it, which takes jobs over a Unix
 * socket of its own. Jobs wait in two lines – what someone waits for on screen before what is
 * drawn ahead – and go to the next free worker. A job that hangs takes its worker down (the whole
 * process group) and a new one starts; so does a worker that died, and one that has drawn
 * {@link MAX_JOBS_PER_WORKER} files, before LibreOffice's memory grows.
 *
 * Only Slider's own files are drawn here – a deck's edits, written by `@slider/odp`, without
 * external links. Uploaded files are converted by a LibreOffice of their own (`libreoffice.ts`).
 */

/** How long one drawing may take before its worker is replaced. */
export const POOL_JOB_TIMEOUT_MS = 60_000;
/** How long a new worker may take to start. */
const START_TIMEOUT_MS = 60_000;
/** Drawings before a worker is replaced by a fresh one. */
export const MAX_JOBS_PER_WORKER = 200;
/** Wait before starting again after a worker failed to start, doubling up to the maximum. */
const RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 30_000;

/** The script, next to this file; copied into each worker's profile. */
const WORKER_SCRIPT = fileURLToPath(new URL('./office-worker.py', import.meta.url));
const SCRIPT_URL = 'vnd.sun.star.script:office-worker.py$serve?language=Python&location=user';

export type PoolPriority = 'interactive' | 'background';

export interface PoolJob {
  /** File extension LibreOffice reads, e.g. `odp`. */
  extension: string;
  /** The one import filter, e.g. `impress8`. */
  importFilter: string;
  /** Export filter, e.g. `impress_pdf_Export`. */
  exportFilter: string;
  /** PDF page range, e.g. `3,5` – 1-based, hidden slides counted. */
  pageRange?: string;
  priority?: PoolPriority;
  /** Names the job for {@link OfficePool.promote}. */
  key?: string;
}

export interface OfficePool {
  /** Draws a file to a PDF in the next free worker. */
  convert(bytes: Uint8Array, job: PoolJob): Promise<Uint8Array>;
  /** Someone now waits for a job drawn ahead: it moves to the line of those waited for. */
  promote(key: string): void;
  /** Takes every worker down; waiting and later jobs end in {@link ConversionAborted}. */
  close(): void;
}

type Spawn = (
  command: string,
  args: string[],
  options: { detached: boolean; env: NodeJS.ProcessEnv; stdio: ['ignore', 'ignore', 'pipe'] },
) => ChildProcess;

export interface OfficePoolOptions {
  /** Path of `soffice`. */
  binary: string;
  /** Workers running side by side: each a LibreOffice (a few hundred MB) busy on one core. */
  size: number;
  log: Logger;
  jobTimeoutMs?: number;
  maxJobsPerWorker?: number;
  /** First wait before starting again after a failed start (doubling); tests shorten it. */
  restartDelayMs?: number;
  /** Injected for tests. */
  spawn?: Spawn;
}

interface Waiting {
  bytes: Uint8Array;
  job: PoolJob;
  /** Tried once on a worker that died under it. */
  retried?: boolean;
  resolve: (pdf: Uint8Array) => void;
  reject: (error: Error) => void;
}

interface Answer {
  id?: number;
  ok?: boolean;
  error?: string;
  ready?: boolean;
  /** Not LibreOffice's answer: the worker went while the job ran. */
  stopped?: boolean;
}

/**
 * The pool has no LibreOffice to draw with – its workers keep failing to start (no Python script
 * provider, a broken install). The caller draws the file the old way, with a LibreOffice of its own.
 */
export class PoolUnavailable extends Error {
  constructor() {
    super('No LibreOffice of the render pool is running');
    this.name = 'PoolUnavailable';
  }
}

/**
 * Too many drawings asked for ahead are waiting already (`background`): this one is not drawn –
 * nobody waits for it, and the line would only grow while someone looks around.
 */
export class PoolBusy extends Error {
  constructor() {
    super('The LibreOffice render pool is busy');
    this.name = 'PoolBusy';
  }
}

/** Drawings asked for ahead that may wait at once. */
export const MAX_WAITING_BACKGROUND = 32;

/** Failed starts in a row, with no worker running, after which the pool counts as unavailable. */
const STARTS_BEFORE_UNAVAILABLE = 3;

/** The worker died under a job – not the file's fault: the job is tried once more elsewhere. */
class WorkerStopped extends Error {
  constructor() {
    super('LibreOffice worker stopped');
    this.name = 'WorkerStopped';
  }
}

/**
 * Starts a pool of {@link OfficePoolOptions.size} workers; they start in the background, jobs
 * wait for the first ready one.
 */
export async function createOfficePool({
  binary,
  size,
  log,
  jobTimeoutMs = POOL_JOB_TIMEOUT_MS,
  maxJobsPerWorker = MAX_JOBS_PER_WORKER,
  restartDelayMs = RESTART_DELAY_MS,
  spawn = nodeSpawn as unknown as Spawn,
}: OfficePoolOptions): Promise<OfficePool> {
  // Short: a Unix socket path may not be longer than about 100 bytes (macOS).
  const base = tmpdir().length > 60 ? '/tmp' : tmpdir();
  await sweepLeftovers(base, log);
  const root = await mkdtemp(path.join(base, ROOT_PREFIX));
  await writeFile(path.join(root, 'pid'), String(process.pid));
  const lines: Record<PoolPriority, Waiting[]> = { interactive: [], background: [] };
  const idle: Worker[] = [];
  const workers = new Set<Worker>();
  let closed = false;
  let nextJobId = 1;

  class Worker {
    private child: ChildProcess | null = null;
    private server: Server | null = null;
    private socket: Socket | null = null;
    private buffered = '';
    private answer: ((answer: Answer) => void) | null = null;
    private jobs = 0;
    private dead = false;
    private ready = false;
    /** Rejects the start when LibreOffice goes before it is ready. */
    private failStart: ((error: Error) => void) | null = null;
    private stderr = '';

    constructor(
      readonly name: string,
      private readonly dir: string,
    ) {}

    /** Starts `soffice` with the script and waits for its `ready`. */
    async start(): Promise<void> {
      const profile = path.join(this.dir, 'profile');
      const scripts = path.join(profile, 'user', 'Scripts', 'python');
      await rm(this.dir, { recursive: true, force: true });
      await mkdir(scripts, { recursive: true });
      await writeFile(
        path.join(profile, 'user', 'registrymodifications.xcu'),
        hardenedProfile([], { poolScript: true, replacements: false }),
      );
      await copyFile(WORKER_SCRIPT, path.join(scripts, 'office-worker.py'));
      const socketPath = path.join(this.dir, 's');
      const failed = new Promise<never>((_, reject) => {
        this.failStart = reject;
      });
      const connected = new Promise<Socket>((resolve, reject) => {
        const server = createServer((socket) => resolve(socket));
        server.on('error', reject);
        server.listen(socketPath);
        this.server = server;
      });
      const child = spawn(
        binary,
        [
          `-env:UserInstallation=${pathToFileURL(profile).href}`,
          '--headless',
          '--invisible',
          '--norestore',
          '--nolockcheck',
          '--nologo',
          '--nodefault',
          SCRIPT_URL,
        ],
        {
          // Own process group: a hang takes `soffice` and `soffice.bin` down together.
          detached: true,
          env: { ...process.env, SLIDER_OFFICE_SOCKET: socketPath },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      this.child = child;
      child.stderr?.on('data', (chunk: Buffer) => {
        this.stderr = (this.stderr + chunk.toString()).slice(-2000);
      });
      child.on('exit', () => this.died('LibreOffice exited'));
      child.on('error', (error) => this.died(error.message));
      const socket = await withTimeout(Promise.race([connected, failed]), START_TIMEOUT_MS, () => {
        this.kill();
        return new ConversionFailed(`LibreOffice worker ${this.name} did not start`);
      });
      this.socket = socket;
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => this.read(chunk));
      socket.on('close', () => this.died('LibreOffice closed the connection'));
      const ready = await withTimeout(Promise.race([this.next(), failed]), START_TIMEOUT_MS, () => {
        this.kill();
        return new ConversionFailed(`LibreOffice worker ${this.name} did not get ready`);
      });
      if (!ready.ready) throw new ConversionFailed(`LibreOffice worker ${this.name} did not start`);
      this.ready = true;
      this.failStart = null;
    }

    /** Draws one file. Rejects with what went wrong; a hang kills the worker. */
    async run({ bytes, job }: Waiting): Promise<Uint8Array> {
      const id = nextJobId++;
      const input = path.join(this.dir, `in-${id}.${job.extension}`);
      const output = path.join(this.dir, `out-${id}.pdf`);
      await writeFile(input, bytes);
      try {
        this.jobs += 1;
        this.socket!.write(
          `${JSON.stringify({
            id,
            input: pathToFileURL(input).href,
            output: pathToFileURL(output).href,
            import: job.importFilter,
            export: job.exportFilter,
            pageRange: job.pageRange,
          })}\n`,
        );
        const answer = await withTimeout(this.next(), jobTimeoutMs, () => {
          this.kill();
          return new ConversionTimedOut(jobTimeoutMs);
        });
        if (answer.stopped) throw new WorkerStopped();
        if (answer.id !== id || !answer.ok) {
          throw new ConversionFailed(answer.error ?? 'LibreOffice could not draw the file');
        }
        let pdf: Uint8Array;
        try {
          pdf = new Uint8Array(await readFile(output));
        } catch {
          throw new ConversionFailed('LibreOffice wrote no PDF');
        }
        if (!isPdfBytes(pdf)) throw new ConversionFailed('LibreOffice wrote no valid PDF');
        return pdf;
      } finally {
        await Promise.all([rm(input, { force: true }), rm(output, { force: true })]);
      }
    }

    get alive(): boolean {
      return !this.dead;
    }

    get isReady(): boolean {
      return this.ready && !this.dead;
    }

    get worn(): boolean {
      return this.jobs >= maxJobsPerWorker;
    }

    /** Lets LibreOffice quit on its own (the script ends with its socket), else kills it. */
    retire(): void {
      if (this.dead) return;
      this.dead = true;
      this.socket?.end();
      const child = this.child;
      setTimeout(() => killGroup(child), 10_000).unref();
      this.cleanUp();
    }

    kill(): void {
      if (this.dead) return;
      this.dead = true;
      killGroup(this.child);
      this.socket?.destroy();
      this.cleanUp();
    }

    private cleanUp(): void {
      this.server?.close();
      this.answer?.({ ok: false, stopped: true });
      this.answer = null;
      void rm(this.dir, { recursive: true, force: true }).catch(() => {});
    }

    private died(why: string): void {
      if (this.dead) return;
      if (!this.ready) {
        // Still starting: the start fails, and `startWorker` tries again after a pause.
        this.kill();
        this.failStart?.(
          new ConversionFailed(`${why}${this.stderr ? `: ${this.stderr.trim()}` : ''}`),
        );
        return;
      }
      if (!closed) {
        log.warn(`LibreOffice worker ${this.name}: ${why}`, this.stderr.trim() || undefined);
      }
      this.kill();
      workerGone(this);
    }

    private next(): Promise<Answer> {
      return new Promise((resolve) => {
        this.answer = resolve;
      });
    }

    private read(chunk: string): void {
      this.buffered += chunk;
      let end: number;
      while ((end = this.buffered.indexOf('\n')) >= 0) {
        const line = this.buffered.slice(0, end);
        this.buffered = this.buffered.slice(end + 1);
        let answer: Answer;
        try {
          answer = JSON.parse(line) as Answer;
        } catch {
          continue;
        }
        const waiting = this.answer;
        this.answer = null;
        waiting?.(answer);
      }
    }
  }

  let restartDelay = restartDelayMs;
  let started = 0;
  let failedStarts = 0;
  let unavailable = false;

  /** Gives every waiting job back to its caller, to be drawn without the pool. */
  function giveUp(): void {
    if (unavailable) return;
    unavailable = true;
    log.error(
      'The LibreOffice render pool could not start – edited slides are drawn by a LibreOffice of their own each (slower) until it does.',
    );
    for (const waiting of [...lines.interactive, ...lines.background]) {
      waiting.reject(new PoolUnavailable());
    }
    lines.interactive.length = 0;
    lines.background.length = 0;
  }

  /** Starts a worker in a free place, again after a pause when it fails. */
  function startWorker(): void {
    if (closed) return;
    const worker = new Worker(`#${++started}`, path.join(root, String(started)));
    workers.add(worker);
    worker.start().then(
      () => {
        if (closed) return worker.kill();
        restartDelay = restartDelayMs;
        failedStarts = 0;
        if (unavailable) log.info('The LibreOffice render pool is running again.');
        unavailable = false;
        becameIdle(worker);
      },
      (error: unknown) => {
        worker.kill();
        workers.delete(worker);
        if (closed) return;
        log.warn(`LibreOffice worker ${worker.name} failed to start`, error);
        failedStarts += 1;
        if (failedStarts >= STARTS_BEFORE_UNAVAILABLE && idle.length === 0 && !anyRunning()) {
          giveUp();
        }
        setTimeout(startWorker, restartDelay).unref();
        restartDelay = Math.min(MAX_RESTART_DELAY_MS, restartDelay * 2);
      },
    );
  }

  /** A worker that died or was retired: its place gets a new one. */
  function workerGone(worker: Worker): void {
    if (!workers.delete(worker)) return;
    const at = idle.indexOf(worker);
    if (at >= 0) idle.splice(at, 1);
    startWorker();
  }

  /** Some worker is up – idle or drawing. */
  const anyRunning = () => [...workers].some((worker) => worker.isReady);

  function becameIdle(worker: Worker): void {
    if (!worker.alive) return;
    if (worker.worn) {
      worker.retire();
      workerGone(worker);
      return;
    }
    const waiting = lines.interactive.shift() ?? lines.background.shift();
    if (!waiting) {
      idle.push(worker);
      return;
    }
    worker.run(waiting).then(
      (pdf) => {
        waiting.resolve(pdf);
        becameIdle(worker);
      },
      (error: unknown) => {
        if (closed) waiting.reject(new ConversionAborted());
        else if (error instanceof WorkerStopped && !waiting.retried) {
          // First in its line again, for the next worker.
          waiting.retried = true;
          lines[waiting.job.priority ?? 'interactive'].unshift(waiting);
        } else {
          waiting.reject(
            error instanceof WorkerStopped ? new ConversionFailed(error.message) : asError(error),
          );
        }
        if (worker.alive) becameIdle(worker);
        else {
          workerGone(worker);
          const free = idle.shift();
          if (free) becameIdle(free);
        }
      },
    );
  }

  for (let i = 0; i < Math.max(1, size); i++) startWorker();

  return {
    convert(bytes, job) {
      if (closed) return Promise.reject(new ConversionAborted());
      if (unavailable) return Promise.reject(new PoolUnavailable());
      if (job.priority === 'background' && lines.background.length >= MAX_WAITING_BACKGROUND) {
        return Promise.reject(new PoolBusy());
      }
      return new Promise((resolve, reject) => {
        lines[job.priority ?? 'interactive'].push({ bytes, job, resolve, reject });
        const worker = idle.shift();
        if (worker) becameIdle(worker);
      });
    },
    promote(key) {
      const at = lines.background.findIndex((waiting) => waiting.job.key === key);
      if (at < 0) return;
      const [waiting] = lines.background.splice(at, 1);
      waiting!.job = { ...waiting!.job, priority: 'interactive' };
      lines.interactive.push(waiting!);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const waiting of [...lines.interactive, ...lines.background]) {
        waiting.reject(new ConversionAborted());
      }
      lines.interactive.length = 0;
      lines.background.length = 0;
      for (const worker of workers) worker.kill();
      workers.clear();
      idle.length = 0;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const ROOT_PREFIX = 'slider-lo-';

/**
 * Removes the folders of pools whose server is gone – one killed without shutting down (a crash,
 * a restart in development) leaves its folder; its LibreOffices quit with their socket.
 */
async function sweepLeftovers(base: string, log: Logger): Promise<void> {
  let names: string[];
  try {
    names = (await readdir(base)).filter((name) => name.startsWith(ROOT_PREFIX));
  } catch {
    return;
  }
  for (const name of names) {
    const dir = path.join(base, name);
    const pid = Number(await readFile(path.join(dir, 'pid'), 'utf8').catch(() => ''));
    if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue;
    // A folder without a pid file is one being made right now – or an old one: old ones go.
    if (!pid) {
      const made = await stat(dir).then(
        (info) => info.mtimeMs,
        () => 0,
      );
      if (Date.now() - made < 60_000) continue;
    }
    await rm(dir, { recursive: true, force: true }).catch((error: unknown) =>
      log.warn(`Could not remove ${dir}`, error),
    );
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Another user's process: it exists.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(asError(error));
      },
    );
  });
}

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

function killGroup(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}
