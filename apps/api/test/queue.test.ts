import { describe, expect, it } from 'vitest';
import {
  importJobKey,
  importJobPriority,
  InProcessQueue,
  type ImportJob,
} from '../src/import/queue';
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
      { priority: importJobPriority },
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

  it('runs up to `concurrency` jobs side by side, but never two of the same deck', async () => {
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    const queue = new InProcessQueue<ImportJob>(
      async ({ revisionId }) => {
        started.push(revisionId);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => gates.set(revisionId, resolve));
        active -= 1;
      },
      silentLogger,
      { priority: importJobPriority, key: importJobKey, concurrency: 2 },
    );
    const open = (revisionId: string) => gates.get(revisionId)?.();
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    queue.enqueue({ deckId: 'a', revisionId: 'a1' });
    queue.enqueue({ deckId: 'a', revisionId: 'a2', kind: 'sync' });
    queue.enqueue({ deckId: 'b', revisionId: 'b1' });
    queue.enqueue({ deckId: 'c', revisionId: 'c1' });
    await tick();
    // a2 waits for a1 (same deck); b1 takes the second slot.
    expect(started).toEqual(['a1', 'b1']);
    open('a1');
    await tick();
    // c1 is a fresh upload: it goes before the sync a2.
    expect(started).toEqual(['a1', 'b1', 'c1']);
    open('b1');
    await tick();
    expect(started).toEqual(['a1', 'b1', 'c1', 'a2']);
    open('c1');
    open('a2');
    await queue.idle();
    expect(peak).toBe(2);
  });
});
