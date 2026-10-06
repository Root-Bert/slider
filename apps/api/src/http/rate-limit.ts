import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Clock } from '../clock';

export interface RateLimitOptions {
  /** Requests allowed per window and client. */
  limit: number;
  windowMs: number;
  clock: Clock;
  key?: (c: Context) => string;
}

/** Remote address from `@hono/node-server`; falls back to one shared bucket elsewhere (tests). */
export function clientAddress(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'local';
}

/**
 * Fixed-window, in-memory rate limit. Good enough for a single process; a shared store
 * (Postgres/Redis) replaces it once the API runs on more than one instance.
 */
export function rateLimit({ limit, windowMs, clock, key = clientAddress }: RateLimitOptions) {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return createMiddleware(async (c, next) => {
    const now = clock.now().getTime();
    const client = key(c);
    let window = windows.get(client);
    if (!window || now - window.startedAt >= windowMs) {
      if (windows.size > 10_000) prune(windows, now, windowMs);
      window = { startedAt: now, count: 0 };
      windows.set(client, window);
    }
    window.count += 1;
    if (window.count > limit) {
      const retryAfter = Math.ceil((window.startedAt + windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: {
            code: 'rate_limited',
            message: 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.',
          },
        },
        429,
      );
    }
    await next();
  });
}

function prune(windows: Map<string, { startedAt: number }>, now: number, windowMs: number): void {
  for (const [client, window] of windows) {
    if (now - window.startedAt >= windowMs) windows.delete(client);
  }
}
