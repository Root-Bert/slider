import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppDeps } from '../deps';
import { CSP_REPORT_TYPES, describeCspReports } from '../http/csp';
import { badRequest } from '../http/errors';
import { rateLimit } from '../http/rate-limit';

/** A report is ~1 KB; the Reporting API batches a few. */
const MAX_REPORT_BYTES = 16 * 1024;

/**
 * Browsers report Content Security Policy violations of the web app here (`http/csp`); each one
 * becomes a warning in the server log. No session, no Origin check: browsers send reports without
 * the app's headers, and a forged report only adds a log line – rate limited per client.
 */
export function cspReportRoutes(deps: AppDeps) {
  const perClient = rateLimit({ limit: 30, windowMs: 60_000, clock: deps.clock });

  return new Hono().post(
    '/csp-report',
    perClient,
    bodyLimit({
      maxSize: MAX_REPORT_BYTES,
      onError: (c) => c.json(badRequest('Zu groß.').toBody(), 413),
    }),
    async (c) => {
      const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!CSP_REPORT_TYPES.includes(type)) throw badRequest('Kein CSP-Bericht.');
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        throw badRequest('Kein CSP-Bericht.');
      }
      for (const line of describeCspReports(body)) deps.log.warn(`CSP: ${line}`);
      return c.body(null, 204);
    },
  );
}
