import type { Logger } from '../logger';

/** Background work. In-process for the prototype; pg-boss later, behind the same interface. */
export interface JobQueue<Job> {
  enqueue(job: Job): void;
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
    this.tail = this.tail.then(() =>
      this.handler(job).catch((error: unknown) =>
        this.log.error('Background job failed', job, error),
      ),
    );
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
}
