import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { siteLiveInputSchema, siteLiveQuerySchema } from '@slider/shared';
import { badRequest, notFound } from '../http/errors';
import { clientAddress } from '../http/rate-limit';
import { readJson } from '../http/validate';
import type { SiteLive } from '../realtime/site-live';

const gone = () => notFound('Diese Live-Verbindung gibt es nicht mehr.');

/**
 * Live comments on the product website (`realtime/site-live.ts`). No login: anyone on the site
 * joins a page's room. The site's Caddy passes `/slider/api/site-live…` here, so the browser
 * stays on its own origin. Posts are signed by the stream's secret key from `hello`.
 */
export function siteLiveRoutes(site: SiteLive) {
  return new Hono()
    .get('/site-live', (c) => {
      const query = siteLiveQuerySchema.safeParse({
        page: c.req.query('page'),
        name: c.req.query('name') || undefined,
        color: c.req.query('color') || undefined,
      });
      if (!query.success) throw badRequest('Ungültige Seite.');
      const { page, ...wish } = query.data;
      const address = clientAddress(c);

      return streamSSE(c, async (stream) => {
        const send = (event: unknown) => {
          if (stream.aborted || stream.closed) return;
          stream.writeSSE({ data: JSON.stringify(event) }).catch(() => close());
        };
        let key: string | null = null;
        const close = () => {
          if (key) site.leave(key);
          void stream.close().catch(() => {});
        };
        const joined = site.join(page, address, wish, send, close);
        if (!joined.ok) {
          // The browser stops retrying on this event and shows the page without live comments.
          await stream.writeSSE({ event: 'refused', data: joined.reason });
          return;
        }
        key = joined.key;
        stream.onAbort(() => site.leave(joined.key));
        try {
          // Comment lines keep the stream open through proxies and Bun's idle timeout.
          while (!stream.aborted && !stream.closed && site.alive(joined.key)) {
            await stream.sleep(site.heartbeatMs);
            if (!site.alive(joined.key)) break;
            await stream.write(': ping\n\n');
          }
        } finally {
          site.leave(joined.key);
        }
      });
    })
    .post('/site-live/:key', async (c) => {
      const key = c.req.param('key');
      if (!site.has(key)) throw gone();
      const input = await readJson(c, siteLiveInputSchema);
      if (!site.post(key, input)) throw gone();
      return c.body(null, 204);
    });
}
