import { Worker } from 'node:worker_threads';
import { PptxError } from '@slider/pptx';
import { ConversionAborted } from './libreoffice';
import {
  PageCountMismatch,
  type CutoutImages,
  type LayerImages,
  type PageImages,
  type PagePicture,
} from './pdf-pages';
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
/**
 * … and those someone waits for on screen (an edited slide, the picture a text is typed over):
 * a line of their own, so a long import never holds them up.
 */
export const MAX_PARALLEL_INTERACTIVE_PDF_JOBS = 2;
/**
 * An interactive job's worker is kept for the next one (pdf.js and its fonts loaded): about a
 * tenth of a second less each. After this many – or any failure – the thread goes.
 */
const JOBS_PER_WARM_WORKER = 50;

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
  | { kind: 'pages'; bytes: Uint8Array; expectedPages?: number; picture?: PagePicture }
  | { kind: 'cutout'; bytes: Uint8Array }
  | { kind: 'layers'; bytes: Uint8Array; background: boolean };

type PdfResult<T extends PdfTask> = T extends { kind: 'deck' }
  ? PdfDeckData
  : T extends { kind: 'cutout' }
    ? CutoutImages
    : T extends { kind: 'layers' }
      ? LayerImages
      : number;

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
  | {
      type: 'run';
      kind: PdfTask['kind'];
      bytes: Uint8Array;
      expectedPages?: number;
      picture?: PagePicture;
      /** Layers: the first page is the slide without its elements. */
      background?: boolean;
    }
  /** The page sent last is stored: draw the next one. */
  | { type: 'next' };

/** Worker → host. */
export type FromPdfWorker =
  /** The PDF is open and has this many pages: the deadline grows by their allowance. */
  | { type: 'opened'; pages: number }
  | { type: 'page'; index: number; image: Uint8Array; thumbnail: Uint8Array }
  | { type: 'done'; result: PdfDeckData | CutoutImages | LayerImages | number }
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
  for (const worker of warm.splice(0)) void worker.terminate();
}

/** Undoes {@link stopPdfJobs} – for tests; a real server never comes back from it. */
export function resumePdfJobs(): void {
  stopping = false;
}

/** Runs work in one of `limit` slots; the rest wait their turn, in order of arrival. */
function slots(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active < limit) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await work();
    } finally {
      // The slot goes straight to the next one waiting, else it is free again.
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

const inPdfSlot = slots(MAX_PARALLEL_PDF_JOBS);
const inInteractiveSlot = slots(MAX_PARALLEL_INTERACTIVE_PDF_JOBS);

/** Interactive jobs' workers waiting for the next one, and how many jobs each has done. */
const warm: Worker[] = [];
const jobsDone = new WeakMap<Worker, number>();

/** A worker kept warm, else a new one. */
function takeWorker(workerUrl: URL, reuse: boolean): Worker {
  if (reuse && workerUrl === DEFAULT_WORKER_URL) {
    const kept = warm.pop();
    if (kept) {
      kept.removeAllListeners();
      kept.ref();
      return kept;
    }
  }
  return new Worker(workerUrl);
}

/** Keeps a worker that finished well for the next interactive job. */
function keepWarm(worker: Worker): boolean {
  const done = (jobsDone.get(worker) ?? 0) + 1;
  if (
    stopping ||
    done >= JOBS_PER_WARM_WORKER ||
    warm.length >= MAX_PARALLEL_INTERACTIVE_PDF_JOBS
  ) {
    return false;
  }
  jobsDone.set(worker, done);
  worker.removeAllListeners();
  // A kept worker does not hold the process open, and one that dies is dropped.
  worker.unref();
  worker.on('error', () => {});
  worker.once('exit', () => {
    const at = warm.indexOf(worker);
    if (at >= 0) warm.splice(at, 1);
  });
  warm.push(worker);
  return true;
}

/** Starts a worker ahead, so the first interactive job finds one warm (server start). */
export function warmPdfWorker(): void {
  if (settings.inProcess || settings.workerUrl !== DEFAULT_WORKER_URL) return;
  if (stopping || warm.length > 0) return;
  const worker = new Worker(settings.workerUrl);
  if (!keepWarm(worker)) void worker.terminate();
}

/**
 * Reads a PDF in a worker: `deck` → its pages as slides ({@link PdfDeckData}), `pages` → every
 * page drawn, each handed to `onPage` before the next is drawn (resolves to the page count).
 * Errors of the PDF come back as what they are ({@link PptxError}, {@link PageCountMismatch});
 * a PDF that takes longer than its deadline (`PDF_TIMEOUT_MS` plus its pages' allowance) ends
 * in {@link PdfTimedOut}.
 */
export function runPdfTask<T extends PdfTask>(
  task: T,
  onPage?: OnPdfPage,
  { interactive = false }: { interactive?: boolean } = {},
): Promise<PdfResult<T>> {
  return (interactive ? inInteractiveSlot : inPdfSlot)(async () => {
    const { inProcess, timeoutMs, workerUrl } = settings;
    if (stopping) throw new ConversionAborted();
    const result = inProcess
      ? await runInProcess(task, onPage)
      : await runInWorker(task, onPage, timeoutMs, workerUrl, interactive);
    return result as PdfResult<T>;
  });
}

async function runInProcess(
  task: PdfTask,
  onPage?: OnPdfPage,
): Promise<PdfDeckData | CutoutImages | LayerImages | number> {
  // Loaded only here: in production pdf.js never comes onto the main thread.
  const { drawCutoutPages, drawLayerPages, drawPdfPages, readPdfDeck } =
    await import('./pdf-render');
  // pdf.js takes ownership of (detaches) the buffer it is given.
  const bytes = task.bytes.slice();
  if (task.kind === 'deck') return readPdfDeck(bytes);
  if (task.kind === 'cutout') return drawCutoutPages(bytes);
  if (task.kind === 'layers') return drawLayerPages(bytes, task.background);
  return drawPdfPages(bytes, onPage ?? (async () => {}), {
    expectedPages: task.expectedPages,
    picture: task.picture,
  });
}

/**
 * One worker per PDF: whatever pdf.js left behind goes with the thread – except interactive jobs
 * that went well, whose worker is kept for the next ({@link JOBS_PER_WARM_WORKER}). The deadline counts the
 * worker's time only – while the caller stores a page (`onPage`), its clock is paused – and
 * grows by {@link PDF_PAGE_ALLOWANCE_MS} per page once the PDF is open.
 */
function runInWorker(
  task: PdfTask,
  onPage: OnPdfPage | undefined,
  timeoutMs: number,
  workerUrl: URL,
  reuse = false,
): Promise<PdfDeckData | CutoutImages | LayerImages | number> {
  return new Promise((resolve, reject) => {
    const worker = takeWorker(workerUrl, reuse);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remaining = timeoutMs;
    let since = Date.now();
    // Settles only once the thread is gone: its slot is not free while it still burns a core.
    const finish = (
      error: Error | null,
      result?: PdfDeckData | CutoutImages | LayerImages | number,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(worker);
      if (!error && reuse && workerUrl === DEFAULT_WORKER_URL && keepWarm(worker)) {
        resolve(result!);
        return;
      }
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
        background: task.kind === 'layers' ? task.background : undefined,
        picture: task.kind === 'pages' ? task.picture : undefined,
      } satisfies ToPdfWorker,
      [bytes.buffer],
    );
    startClock();
  });
}
