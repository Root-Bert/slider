import { sql } from 'drizzle-orm';
import type { Handler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Database } from '../db/client';
import type { Logger } from '../logger';

/** Context key for the client address behind a reverse proxy; read by `clientAddress`. */
export const FORWARDED_CLIENT = 'forwardedClient';

/**
 * Behind Caddy every request comes from the proxy's address, so per-client rate limits would
 * share one bucket. Caddy replaces any `X-Forwarded-For` it does not trust with the real client
 * address, so the right-most entry is the one the nearest proxy saw. Only enable this
 * (`TRUST_PROXY=1`) when the API is not reachable directly.
 */
export function trustProxy() {
  return createMiddleware(async (c, next) => {
    const forwarded = c.req.header('x-forwarded-for');
    const client = forwarded?.split(',').at(-1)?.trim();
    if (client) c.set(FORWARDED_CLIENT, client);
    await next();
  });
}

/** `GET /api/health` for Docker and uptime checks: 200 when the database answers, else 503. */
export function healthCheck(deps: { db: Database; log: Logger }): Handler {
  return async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ ok: true });
    } catch (error) {
      deps.log.error('Health check: database unreachable', error);
      return c.json({ ok: false }, 503);
    }
  };
}
