import { describe, expect, it } from 'vitest';
import { importJobPriority, InProcessQueue, type ImportJob } from '../src/import/queue';
import { silentLogger } from '../src/logger';

const job = (deckId: string, kind?: ImportJob['kind']): ImportJob => ({
  deckId,
  revisionId: `${deckId}-r`,
  kind,
});

describe('InProcessQueue', () => {
  it('runs one job at a time; a fresh upload overtakes waiting syncs and re-renders', async () => {
    const order: string[] = [];
    let active = 0;
    let release: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new InProcessQueue<ImportJob>(
      async ({ deckId }) => {
        active += 1;
        expect(active).toBe(1);
        if (deckId === 'busy') await first;
        order.push(deckId);
        active -= 1;
      },
      silentLogger,
      importJobPriority,
    );
    queue.enqueue(job('busy', 'sync'));
    await Promise.resolve();
    queue.enqueue(job('rerender-a', 'rerender'));
    queue.enqueue(job('sync-a', 'sync'));
    queue.enqueue(job('sync-b', 'sync'));
    const upload = queue.run(job('upload'));
    release();
    await upload;
    await queue.idle();
    expect(order).toEqual(['busy', 'upload', 'sync-a', 'sync-b', 'rerender-a']);
  });

  it('keeps going after a failing job; idle waits for jobs added meanwhile', async () => {
    const ran: string[] = [];
    const queue = new InProcessQueue<ImportJob>(async ({ deckId }) => {
      if (deckId === 'broken') throw new Error('boom');
      ran.push(deckId);
      if (deckId === 'a') queue.enqueue(job('c'));
    }, silentLogger);
    queue.enqueue(job('broken'));
    queue.enqueue(job('a'));
    await expect(queue.run(job('b'))).resolves.toBeUndefined();
    await queue.idle();
    expect(ran).toEqual(['a', 'b', 'c']);
    await expect(queue.idle()).resolves.toBeUndefined();
  });
});
