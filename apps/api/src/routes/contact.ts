import { Hono } from 'hono';
import { contactMessageInputSchema } from '@slider/shared';
import type { AppDeps } from '../deps';
import { rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { sendContactMessage } from '../services/contact';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The website's contact form. The site lives on another host (bertro.dev/slider); its Caddy
 * proxies `/slider/api/contact` here, so the browser posts same-origin – no CORS exception.
 */
export function contactRoutes(deps: AppDeps) {
  const perClient = rateLimit({ limit: 5, windowMs: HOUR_MS, clock: deps.clock });

  return new Hono().post('/contact', perClient, async (c) => {
    await sendContactMessage(deps, await readJson(c, contactMessageInputSchema));
    return c.json({ ok: true }, 202);
  });
}
