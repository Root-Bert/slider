import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Clock } from '../clock';
import { FORWARDED_CLIENT } from './hosting';

export interface RateLimitOptions {
  /** Requests allowed per window and client. */
  limit: number;
  windowMs: number;
  clock: Clock;
  key?: (c: Context) => string;
}

/**
 * The client's address: from `X-Forwarded-For` behind a trusted proxy (`TRUST_PROXY`), else the
 * remote address from `@hono/node-server`; falls back to one shared bucket elsewhere (tests).
 */
export function clientAddress(c: Context): string {
  const forwarded: unknown = c.get(FORWARDED_CLIENT);
  if (typeof forwarded === 'string') return forwarded;
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'local';
}

/**
 * Fixed-window, in-memory counter per key: `hit(key)` counts one request and tells whether it is
 * within the limit. For limits whose key is only known inside the handler (e.g. an e-mail address).
 */
export function fixedWindow({ limit, windowMs, clock }: Omit<RateLimitOptions, 'key'>) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    hit(key: string): { allowed: boolean; retryAfterS: number } {
      const now = clock.now().getTime();
      let window = windows.get(key);
      if (!window || now - window.startedAt >= windowMs) {
        if (windows.size > 10_000) prune(windows, now, windowMs);
        window = { startedAt: now, count: 0 };
        windows.set(key, window);
      }
      window.count += 1;
      return {
        allowed: window.count <= limit,
        retryAfterS: Math.ceil((window.startedAt + windowMs - now) / 1000),
      };
    },
  };
}

/**
 * Fixed-window, in-memory rate limit. Good enough for a single process; a shared store
 * (Postgres/Redis) replaces it once the API runs on more than one instance.
 */
export function rateLimit({ limit, windowMs, clock, key = clientAddress }: RateLimitOptions) {
  const counter = fixedWindow({ limit, windowMs, clock });

  return createMiddleware(async (c, next) => {
    const { allowed, retryAfterS: retryAfter } = counter.hit(key(c));
    if (!allowed) {
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
