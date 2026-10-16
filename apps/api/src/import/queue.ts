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

/**
 * Runs jobs one at a time (rendering is CPU-bound; one LibreOffice at a time). The next job is
 * the waiting one with the lowest `priority`, in order of arrival among equals. A failing job is
 * logged and never stops the queue.
 */
export class InProcessQueue<Job> implements JobQueue<Job> {
  private readonly waiting: { job: Job; done: () => void }[] = [];
  private running = false;
  private drained: (() => void)[] = [];

  constructor(
    private readonly handler: JobHandler<Job>,
    private readonly log: Logger,
    private readonly priority: (job: Job) => number = () => 0,
  ) {}

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
    if (!this.running && this.waiting.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.drained.push(resolve));
  }

  private next(): void {
    if (this.running) return;
    let index = -1;
    let best = Infinity;
    for (const [i, entry] of this.waiting.entries()) {
      const rank = this.priority(entry.job);
      if (rank < best) {
        best = rank;
        index = i;
      }
    }
    const [entry] = index === -1 ? [] : this.waiting.splice(index, 1);
    if (!entry) {
      for (const resolve of this.drained.splice(0)) resolve();
      return;
    }
    this.running = true;
    void this.handler(entry.job)
      .catch((error: unknown) => this.log.error('Background job failed', entry.job, error))
      .finally(() => {
        this.running = false;
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
