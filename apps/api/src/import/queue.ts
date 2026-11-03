import type { Logger } from '../logger';

/** Background work. In-process for the prototype; pg-boss later, behind the same interface. */
export interface JobQueue<Job> {
  enqueue(job: Job): void;
  /** Like {@link enqueue}, but resolves once this job has run (it never rejects). */
  run(job: Job): Promise<void>;
  /** Resolves once the queue has run dry, including jobs enqueued while waiting. */
  idle(): Promise<void>;
}

export type JobHandler<Job> = (job: Job) => Promise<void>;

export interface QueueOptions<Job> {
  /** Lower runs first; equals run in order of arrival. */
  priority?: (job: Job) => number;
  /** How many jobs run side by side (`IMPORT_WORKERS`). Default 1. */
  concurrency?: number;
  /** Jobs with the same key never run side by side, e.g. two imports of one deck. */
  key?: (job: Job) => string;
  /**
   * Jobs someone waits for: they have `concurrency` slots of their own, so they never wait for
   * the other jobs – only for each other.
   */
  urgent?: (job: Job) => boolean;
}

/**
 * Runs up to `concurrency` jobs side by side (rendering is CPU-bound: each running job may hold
 * one LibreOffice), plus as many `urgent` ones. The next job is the waiting one with the lowest
 * `priority`, in order of arrival among equals, whose `key` is not running yet and that has a
 * free slot. A failing job is logged and never stops the queue.
 */
export class InProcessQueue<Job> implements JobQueue<Job> {
  private readonly waiting: { job: Job; done: () => void }[] = [];
  private readonly runningKeys = new Set<string>();
  /** Running jobs: urgent ones, the others. */
  private readonly running = { urgent: 0, other: 0 };
  private drained: (() => void)[] = [];
  private readonly priority: (job: Job) => number;
  private readonly concurrency: number;
  private readonly key: ((job: Job) => string) | undefined;
  private readonly urgent: (job: Job) => boolean;

  constructor(
    private readonly handler: JobHandler<Job>,
    private readonly log: Logger,
    { priority = () => 0, concurrency = 1, key, urgent = () => false }: QueueOptions<Job> = {},
  ) {
    this.priority = priority;
    this.concurrency = Math.max(1, Math.floor(concurrency));
    this.key = key;
    this.urgent = urgent;
  }

  enqueue(job: Job): void {
    void this.run(job);
  }

  run(job: Job): Promise<void> {
    return new Promise<void>((done) => {
      this.waiting.push({ job, done });
      // Like before: a job never starts synchronously inside `run`.
      queueMicrotask(() => this.next());
    });
  }

  idle(): Promise<void> {
    if (this.runningCount() === 0 && this.waiting.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.drained.push(resolve));
  }

  private runningCount(): number {
    return this.running.urgent + this.running.other;
  }

  private lane(job: Job): 'urgent' | 'other' {
    return this.urgent(job) ? 'urgent' : 'other';
  }

  private next(): void {
    for (let entry = this.take(); entry; entry = this.take()) this.start(entry);
    if (this.runningCount() === 0 && this.waiting.length === 0) {
      for (const resolve of this.drained.splice(0)) resolve();
    }
  }

  /** Removes and returns the next job allowed to start, if any. */
  private take(): { job: Job; done: () => void } | undefined {
    let index = -1;
    let best = Infinity;
    for (const [i, entry] of this.waiting.entries()) {
      if (this.running[this.lane(entry.job)] >= this.concurrency) continue;
      if (this.key && this.runningKeys.has(this.key(entry.job))) continue;
      const rank = this.priority(entry.job);
      if (rank < best) {
        best = rank;
        index = i;
      }
    }
    return index === -1 ? undefined : this.waiting.splice(index, 1)[0];
  }

  private start(entry: { job: Job; done: () => void }): void {
    const key = this.key?.(entry.job);
    const lane = this.lane(entry.job);
    this.running[lane] += 1;
    if (key !== undefined) this.runningKeys.add(key);
    void this.handler(entry.job)
      .catch((error: unknown) => this.log.error('Background job failed', entry.job, error))
      .finally(() => {
        this.running[lane] -= 1;
        if (key !== undefined) this.runningKeys.delete(key);
        entry.done();
        this.next();
      });
  }
}

export interface ImportJob {
  deckId: string;
  revisionId: string;
  /**
   * `initial` (default): first import, drives the deck's import overlay.
   * `sync`: a new revision of a deck that stays usable meanwhile (BER-107).
   * `rerender`: new slide images for a finished revision, e.g. by Office or LibreOffice (BER-94).
   */
  kind?: 'initial' | 'sync' | 'rerender';
}

/**
 * A fresh upload goes first – someone is waiting at the import screen. New versions of linked
 * decks follow (viewers keep the current one meanwhile), background re-renders come last.
 */
export const importJobPriority = (job: ImportJob): number =>
  job.kind === 'rerender' ? 2 : job.kind === 'sync' ? 1 : 0;

/** A first import never waits for syncs or re-renders already running (`QueueOptions.urgent`). */
export const isUrgentImportJob = (job: ImportJob): boolean => (job.kind ?? 'initial') === 'initial';

/** One deck's imports never overlap: they replace the same slides and progress. */
export const importJobKey = (job: ImportJob): string => job.deckId;
