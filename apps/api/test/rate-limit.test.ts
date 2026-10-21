import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../src/clock';
import { fixedWindow, rateLimit } from '../src/http/rate-limit';

/** A clock that only moves when told to. */
class FakeClock implements Clock {
  constructor(private ms = Date.UTC(2026, 9, 16, 12)) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

describe('fixedWindow', () => {
  it('allows `limit` hits per window and tells how long to wait after that', () => {
    const clock = new FakeClock();
    const counter = fixedWindow({ limit: 2, windowMs: 60_000, clock });
    expect(counter.hit('a')).toEqual({ allowed: true, retryAfterS: 60 });
    clock.advance(10_500);
    expect(counter.hit('a')).toEqual({ allowed: true, retryAfterS: 50 });
    expect(counter.hit('a')).toEqual({ allowed: false, retryAfterS: 50 });
    clock.advance(49_000);
    // 500 ms left: rounded up to a whole second.
    expect(counter.hit('a')).toEqual({ allowed: false, retryAfterS: 1 });
  });

  it('starts a fresh window once windowMs has passed', () => {
    const clock = new FakeClock();
    const counter = fixedWindow({ limit: 1, windowMs: 1_000, clock });
    expect(counter.hit('a').allowed).toBe(true);
    expect(counter.hit('a').allowed).toBe(false);
    clock.advance(1_000);
    expect(counter.hit('a')).toEqual({ allowed: true, retryAfterS: 1 });
  });

  it('counts every key on its own', () => {
    const clock = new FakeClock();
    const counter = fixedWindow({ limit: 1, windowMs: 1_000, clock });
    expect(counter.hit('a').allowed).toBe(true);
    expect(counter.hit('b').allowed).toBe(true);
    expect(counter.hit('a').allowed).toBe(false);
    expect(counter.hit('b').allowed).toBe(false);
  });

  it('keeps counting correctly when many keys force a prune', () => {
    const clock = new FakeClock();
    const counter = fixedWindow({ limit: 1, windowMs: 1_000, clock });
    for (let i = 0; i <= 10_001; i++) counter.hit(`old-${i}`);
    expect(counter.hit('old-0').allowed).toBe(false);
    clock.advance(1_000);
    expect(counter.hit('new').allowed).toBe(true);
    expect(counter.hit('old-1').allowed).toBe(true);
    expect(counter.hit('old-1').allowed).toBe(false);
  });
});

describe('rateLimit middleware', () => {
  const appWith = (
    clock: Clock,
    key?: (c: { req: { header(name: string): string | undefined } }) => string,
  ) =>
    new Hono()
      .use(rateLimit({ limit: 2, windowMs: 30_000, clock, key }))
      .get('/', (c) => c.text('ok'));

  it('answers 429 with Retry-After once the limit is spent', async () => {
    const clock = new FakeClock();
    const app = appWith(clock);
    expect((await app.request('/')).status).toBe(200);
    expect((await app.request('/')).status).toBe(200);
    clock.advance(10_000);
    const limited = await app.request('/');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('20');
    expect(await limited.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.',
      },
    });
    clock.advance(20_000);
    expect((await app.request('/')).status).toBe(200);
  });

  it('buckets by the key function', async () => {
    const clock = new FakeClock();
    const app = appWith(clock, (c) => c.req.header('x-who') ?? 'nobody');
    const as = (who: string) => app.request('/', { headers: { 'x-who': who } });
    await as('anna');
    await as('anna');
    expect((await as('anna')).status).toBe(429);
    expect((await as('ben')).status).toBe(200);
  });
});
