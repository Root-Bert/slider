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

/** Runs jobs one at a time, in order. A failing job is logged and never stops the queue. */
export class InProcessQueue<Job> implements JobQueue<Job> {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly handler: JobHandler<Job>,
    private readonly log: Logger,
  ) {}

  enqueue(job: Job): void {
    void this.run(job);
  }

  run(job: Job): Promise<void> {
    const done = this.tail.then(() =>
      this.handler(job).catch((error: unknown) =>
        this.log.error('Background job failed', job, error),
      ),
    );
    this.tail = done;
    return done;
  }

  async idle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.tail;
      await current;
    } while (current !== this.tail);
  }
}

export interface ImportJob {
  deckId: string;
  revisionId: string;
  /**
   * `initial` (default): first import, drives the deck's import overlay.
   * `sync`: a new revision of a deck that stays usable meanwhile (BER-107).
   */
  kind?: 'initial' | 'sync';
}
