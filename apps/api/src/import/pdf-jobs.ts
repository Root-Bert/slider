import { Worker } from 'node:worker_threads';
import { PptxError } from '@slider/pptx';
import { ConversionAborted } from './libreoffice';
import { PageCountMismatch, type PageImages } from './pdf-pages';
import type { PdfDeckData } from './pdf-render';

/*
 * Untrusted PDFs – uploaded, linked, or made by a conversion – are parsed and drawn by pdf.js,
 * which works synchronously for long stretches: on the main thread a crafted PDF would stall
 * every request for minutes. So each PDF is read in a worker thread of its own (`pdf-worker.ts`),
 * with a deadline: a PDF that takes longer is cut off (the thread is terminated) and fails with
 * {@link PdfTimedOut}. The bytes are copied once and transferred, not cloned again.
 */

/**
 * How long reading or drawing one PDF may take before it is cut off – plus
 * {@link PDF_PAGE_ALLOWANCE_MS} for each of its pages, once the worker knows how many there are:
 * drawing a long deck honestly takes a while (about 0.2 s a page at full size on a laptop).
 */
export const PDF_TIMEOUT_MS = 120_000;
/** Time added to the deadline per page of the PDF. */
export const PDF_PAGE_ALLOWANCE_MS = 1_000;

/**
 * PDFs read at once, across imports, syncs and re-renders: each is a thread busy on a CPU core
 * with a page's canvas in memory. The rest wait their turn, in order of arrival; the deadline
 * starts with the run, not the wait.
 */
export const MAX_PARALLEL_PDF_JOBS = 2;

/** A PDF that was cut off after its deadline – a pathological file or a very busy server. */
export class PdfTimedOut extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Reading the PDF timed out after ${timeoutMs} ms`);
    this.name = 'PdfTimedOut';
  }
}

/** What a worker is asked to do. */
export type PdfTask =
  | { kind: 'deck'; bytes: Uint8Array }
  | { kind: 'pages'; bytes: Uint8Array; expectedPages?: number };

type PdfResult<T extends PdfTask> = T extends { kind: 'deck' } ? PdfDeckData : number;

export type OnPdfPage = (page: PageImages, index: number) => Promise<void>;

/** An error as it crosses the thread boundary: classes do not survive structured cloning. */
export interface WorkerError {
  name: string;
  message: string;
  code?: PptxError['code'];
  pages?: number;
  expected?: number;
}

/** Host → worker. */
export type ToPdfWorker =
  | { type: 'run'; kind: PdfTask['kind']; bytes: Uint8Array; expectedPages?: number }
  /** The page sent last is stored: draw the next one. */
  | { type: 'next' };

/** Worker → host. */
export type FromPdfWorker =
  /** The PDF is open and has this many pages: the deadline grows by their allowance. */
  | { type: 'opened'; pages: number }
  | { type: 'page'; index: number; image: Uint8Array; thumbnail: Uint8Array }
  | { type: 'done'; result: PdfDeckData | number }
  | { type: 'error'; error: WorkerError };

export const toWorkerError = (error: unknown): WorkerError => {
  if (error instanceof PptxError)
    return { name: error.name, message: error.message, code: error.code };
  if (error instanceof PageCountMismatch) {
    return {
      name: error.name,
      message: error.message,
      pages: error.pages,
      expected: error.expected,
    };
  }
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
};

function fromWorkerError(error: WorkerError): Error {
  if (error.name === 'PptxError' && error.code) return new PptxError(error.code, error.message);
  if (error.name === 'PageCountMismatch' && error.pages !== undefined) {
    return new PageCountMismatch(error.pages, error.expected ?? 0);
  }
  const revived = new Error(error.message);
  revived.name = error.name;
  return revived;
}

interface PdfJobSettings {
  /** `PDF_TIMEOUT_MS`. */
  timeoutMs: number;
  /**
   * Tests only: read the PDF on the calling thread, without worker or deadline – Vitest runs on
   * Node, which cannot start the TypeScript worker. Bun (dev, production) always uses the worker.
   */
  inProcess: boolean;
  /** The worker's entry; tests point it at a stand-in that hangs. */
  workerUrl: URL;
}

const DEFAULT_WORKER_URL = new URL('./pdf-worker.ts', import.meta.url);
let settings: PdfJobSettings = {
  timeoutMs: PDF_TIMEOUT_MS,
  inProcess: false,
  workerUrl: DEFAULT_WORKER_URL,
};

/** Sets how PDFs are read (server start, tests); returns the settings before, to restore them. */
export function configurePdfJobs(options: Partial<PdfJobSettings>): PdfJobSettings {
  const before = settings;
  settings = { ...settings, ...options };
  return before;
}

/** Workers running now, with how to cut each off on shutdown. */
const running = new Map<Worker, () => void>();
/** Set by {@link stopPdfJobs}: the process is going down. */
let stopping = false;

/** PDF workers running at this moment – for tests. */
export const runningPdfJobs = (): number => running.size;

/**
 * Terminates every running PDF worker – for shutdown and the restart after `/einrichtung`. They
 * and any PDF started afterwards end in {@link ConversionAborted}, like a LibreOffice run, so
 * imports and re-renders resume on the next start instead of failing.
 */
export function stopPdfJobs(): void {
  stopping = true;
  for (const abort of running.values()) abort();
}

/** Undoes {@link stopPdfJobs} – for tests; a real server never comes back from it. */
export function resumePdfJobs(): void {
  stopping = false;
}

let activeJobs = 0;
const waitingJobs: (() => void)[] = [];

async function inPdfSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeJobs < MAX_PARALLEL_PDF_JOBS) activeJobs += 1;
  else await new Promise<void>((resolve) => waitingJobs.push(resolve));
  try {
    return await work();
  } finally {
    // The slot goes straight to the next one waiting, else it is free again.
    const next = waitingJobs.shift();
    if (next) next();
    else activeJobs -= 1;
  }
}

/**
 * Reads a PDF in a worker: `deck` → its pages as slides ({@link PdfDeckData}), `pages` → every
 * page drawn, each handed to `onPage` before the next is drawn (resolves to the page count).
 * Errors of the PDF come back as what they are ({@link PptxError}, {@link PageCountMismatch});
 * a PDF that takes longer than its deadline (`PDF_TIMEOUT_MS` plus its pages' allowance) ends
 * in {@link PdfTimedOut}.
 */
export function runPdfTask<T extends PdfTask>(task: T, onPage?: OnPdfPage): Promise<PdfResult<T>> {
  return inPdfSlot(async () => {
    const { inProcess, timeoutMs, workerUrl } = settings;
    if (stopping) throw new ConversionAborted();
    const result = inProcess
      ? await runInProcess(task, onPage)
      : await runInWorker(task, onPage, timeoutMs, workerUrl);
    return result as PdfResult<T>;
  });
}

async function runInProcess(task: PdfTask, onPage?: OnPdfPage): Promise<PdfDeckData | number> {
  // Loaded only here: in production pdf.js never comes onto the main thread.
  const { drawPdfPages, readPdfDeck } = await import('./pdf-render');
  // pdf.js takes ownership of (detaches) the buffer it is given.
  const bytes = task.bytes.slice();
  return task.kind === 'deck'
    ? readPdfDeck(bytes)
    : drawPdfPages(bytes, onPage ?? (async () => {}), { expectedPages: task.expectedPages });
}

/**
 * One worker per PDF: whatever pdf.js left behind goes with the thread. The deadline counts the
 * worker's time only – while the caller stores a page (`onPage`), its clock is paused – and
 * grows by {@link PDF_PAGE_ALLOWANCE_MS} per page once the PDF is open.
 */
function runInWorker(
  task: PdfTask,
  onPage: OnPdfPage | undefined,
  timeoutMs: number,
  workerUrl: URL,
): Promise<PdfDeckData | number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = timeoutMs;
    let since = Date.now();
    // Settles only once the thread is gone: its slot is not free while it still burns a core.
    const finish = (error: Error | null, result?: PdfDeckData | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(worker);
      void worker
        .terminate()
        .catch(() => {})
        .then(() => (error ? reject(error) : resolve(result!)));
    };
    const startClock = () => {
      since = Date.now();
      timer = setTimeout(() => finish(new PdfTimedOut(timeoutMs)), Math.max(0, remaining));
    };
    const pauseClock = () => {
      clearTimeout(timer);
      remaining -= Date.now() - since;
    };
    running.set(worker, () => finish(new ConversionAborted()));

    worker.on('message', (message: FromPdfWorker) => {
      if (message.type === 'opened') {
        pauseClock();
        remaining += message.pages * PDF_PAGE_ALLOWANCE_MS;
        startClock();
      } else if (message.type === 'done') finish(null, message.result);
      else if (message.type === 'error') finish(fromWorkerError(message.error));
      else if (message.type === 'page') {
        pauseClock();
        const store = onPage ?? (async () => {});
        store({ image: message.image, thumbnail: message.thumbnail }, message.index).then(
          () => {
            if (settled) return;
            startClock();
            worker.postMessage({ type: 'next' } satisfies ToPdfWorker);
          },
          (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))),
        );
      }
    });
    worker.on('error', (error: unknown) =>
      finish(
        stopping
          ? new ConversionAborted()
          : error instanceof Error
            ? error
            : new Error(String(error)),
      ),
    );
    worker.on('exit', (code) =>
      finish(stopping ? new ConversionAborted() : new Error(`PDF worker exited with ${code}`)),
    );

    // The worker's own copy, moved over without another copy; pdf.js consumes it there.
    const bytes = task.bytes.slice();
    worker.postMessage(
      {
        type: 'run',
        kind: task.kind,
        bytes,
        expectedPages: task.kind === 'pages' ? task.expectedPages : undefined,
      } satisfies ToPdfWorker,
      [bytes.buffer],
    );
    startClock();
  });
}
