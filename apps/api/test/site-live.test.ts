import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiteLiveEvent } from '@slider/shared';
import { SITE_MAX_PER_ADDRESS, SITE_STALE_MS, SiteLive } from '../src/realtime/site-live';

afterEach(() => vi.useRealTimers());

describe('website live comments', () => {
  it('shares pointers and comments per page, keeps a touched comment 30 s and bounds everything', () => {
    vi.useFakeTimers();
    const site = new SiteLive(() => Date.now());
    const seen = {
      a: [] as SiteLiveEvent[],
      b: [] as SiteLiveEvent[],
      other: [] as SiteLiveEvent[],
    };
    const a = site.join(
      '/',
      '1.1.1.1',
      { name: 'Ada' },
      (e) => seen.a.push(e),
      () => {},
    );
    const b = site.join(
      '/',
      '2.2.2.2',
      {},
      (e) => seen.b.push(e),
      () => {},
    );
    const other = site.join(
      '/pricing',
      '3.3.3.3',
      {},
      (e) => seen.other.push(e),
      () => {},
    );
    if (!a.ok || !b.ok || !other.ok) throw new Error('join failed');
    expect(seen.a[0]).toMatchObject({ type: 'hello', you: { name: 'Ada' }, visitors: [] });
    expect(seen.a.at(-1)).toMatchObject({ type: 'join' });

    // Pointers go to the others on the same page only, not back to the sender.
    site.post(a.key, { type: 'move', a: 'hero', x: 0.5, y: 0.2 });
    expect(seen.b.at(-1)).toMatchObject({ type: 'move', pointer: { a: 'hero', x: 0.5 } });
    expect(seen.a.some((e) => e.type === 'move')).toBe(false);
    expect(seen.other.some((e) => e.type === 'move')).toBe(false);

    // A comment lives 30 s; a touch or reply restarts that, then it goes for everyone.
    site.post(a.key, { type: 'comment', a: 'hero', x: 0.1, y: 0.1, w: 0.2, h: 0.1, text: 'Nice' });
    const added = seen.b.at(-1);
    if (added?.type !== 'comment') throw new Error('no comment');
    expect(added.comment).toMatchObject({
      text: 'Nice',
      w: 0.2,
      h: 0.1,
      by: { name: 'Ada' },
      left: 30_000,
    });
    vi.advanceTimersByTime(25_000);
    site.post(b.key, { type: 'touch', id: added.comment.id });
    vi.advanceTimersByTime(25_000);
    site.post(b.key, { type: 'reply', id: added.comment.id, text: 'Agreed' });
    expect(seen.a.at(-1)).toMatchObject({ type: 'reply', reply: { text: 'Agreed' } });
    vi.advanceTimersByTime(29_000);
    expect(seen.a.some((e) => e.type === 'gone')).toBe(false);
    // A newcomer gets the comment with the time it has left.
    const late: SiteLiveEvent[] = [];
    const c = site.join(
      '/',
      '4.4.4.4',
      {},
      (e) => late.push(e),
      () => {},
    );
    expect(late[0]).toMatchObject({ type: 'hello', comments: [{ text: 'Nice', left: 1_000 }] });
    vi.advanceTimersByTime(1_000);
    expect(seen.a.at(-1)).toMatchObject({ type: 'gone', id: added.comment.id });
    expect(seen.other.some((e) => e.type === 'comment' || e.type === 'gone')).toBe(false);

    // Writes are rate limited per stream; unknown keys are refused; leaving is announced.
    for (let i = 0; i < 20; i += 1)
      site.post(a.key, { type: 'comment', a: 'x', x: 0, y: 0, text: `${i}` });
    expect(seen.b.filter((e) => e.type === 'comment').length).toBe(1 + 8);
    expect(site.post('nope', { type: 'bye' })).toBe(false);
    if (c.ok) site.leave(c.key);
    expect(seen.a.at(-1)).toMatchObject({ type: 'leave' });

    // One address can't open endless streams.
    const joins = Array.from({ length: SITE_MAX_PER_ADDRESS + 1 }, () =>
      site.join(
        '/',
        '9.9.9.9',
        {},
        () => {},
        () => {},
      ),
    );
    expect(joins.at(-1)).toEqual({ ok: false, reason: 'busy' });
    // A stream that never says it is still there is dropped (Bun doesn't report closed ones).
    expect(site.alive(b.key)).toBe(true);
    vi.advanceTimersByTime(SITE_STALE_MS + 1);
    expect(site.alive(b.key)).toBe(false);
    site.closeAll();
    expect(site.count('/')).toBe(0);
  });
});
