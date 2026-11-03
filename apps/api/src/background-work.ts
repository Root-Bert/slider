import type { AppDeps } from './deps';

/*
 * Work the server does after it answered – a committed step's slides drawn sharper, pictures
 * nothing names any more deleted a while later. Best effort all of it: it logs its own failures
 * and nobody waits for it. Kept count of all the same, so whoever ends the server's life – a
 * test removing its database and files – can wait until none of it still writes there.
 */
export class BackgroundWork {
  private readonly running = new Set<Promise<void>>();
  /** Work waiting for its time, by its timer. */
  private readonly waiting = new Map<ReturnType<typeof setTimeout>, () => Promise<void>>();

  /** Starts `work` now. Its failures are its own to report; one it lets through is dropped. */
  run(work: () => Promise<void>): void {
    const running = work()
      .catch(() => {})
      .finally(() => this.running.delete(running));
    this.running.add(running);
  }

  /** Starts `work` in `ms` – or at once when {@link idle} is waited for; never keeps the process up. */
  later(ms: number, work: () => Promise<void>): void {
    const timer = setTimeout(() => {
      this.waiting.delete(timer);
      this.run(work);
    }, ms);
    timer.unref();
    this.waiting.set(timer, work);
  }

  /**
   * Resolves once nothing runs any more – work started meanwhile included. Work still waiting
   * for its time runs at once (that scheduled by work running meanwhile too): what it would have
   * deleted later – a quick picture after its sharp one – must not stay behind for good, and
   * nothing after this is to touch the stores.
   */
  async idle(): Promise<void> {
    do {
      const waiting = [...this.waiting];
      this.waiting.clear();
      for (const [timer, work] of waiting) {
        clearTimeout(timer);
        this.run(work);
      }
      await Promise.all([...this.running]);
    } while (this.running.size > 0 || this.waiting.size > 0);
  }
}

/** {@link BackgroundWork.run} on the server's background work – untracked without one. */
export function runInBackground(
  deps: Pick<AppDeps, 'background'>,
  work: () => Promise<void>,
): void {
  if (deps.background) deps.background.run(work);
  else void work().catch(() => {});
}

/** {@link BackgroundWork.later} on the server's background work – untracked without one. */
export function runLater(
  deps: Pick<AppDeps, 'background'>,
  ms: number,
  work: () => Promise<void>,
): void {
  if (deps.background) deps.background.later(ms, work);
  else setTimeout(() => void work().catch(() => {}), ms).unref();
}
