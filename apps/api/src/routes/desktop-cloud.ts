import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import {
  cloudFinishInputSchema,
  cloudKeepInputSchema,
  cloudStartInputSchema,
  desktopTokenSchema,
  type CloudSession,
  type CloudSignInStart,
  type CloudStatus,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { electronOnly } from '../http/desktop-guard';
import { ApiError, badRequest, notFound } from '../http/errors';
import { readJson } from '../http/validate';
import { CloudSync } from '../services/cloud-sync';

/*
 * The desktop's local server signs in to a Slider server for its one person (BER-201, see
 * `@slider/shared` desktop.ts and routes/desktop-login.ts on the server's side). The session
 * token is kept sealed with the data key in `<dataDir>/cloud.json`; the web app never sees it.
 * Signed in, the account's holdings are kept here as copies (`services/cloud-sync`).
 */

/** A sign-in started and not finished is forgotten after this. */
const PENDING_TTL_MS = 15 * 60_000;

/** Plain http only on this machine (a Slider in development); elsewhere its cookies are Secure. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** `slider.firma.de/irgendwas` → `https://slider.firma.de`: a Slider lives at its origin. */
export function cloudServerOrigin(typed: string): string {
  const trimmed = typed.trim();
  if (!trimmed) throw badRequest('Gib die Adresse des Slider-Servers ein.');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw badRequest('Das ist keine gültige Adresse.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw badRequest('Der Slider-Server muss über https:// erreichbar sein.');
  }
  return url.origin;
}

export function desktopCloudRoutes(deps: AppDeps) {
  if (!deps.config.desktop || !deps.config.cloudUrl) return new Hono<ViewerEnv>();
  const sync = new CloudSync(deps);
  sync.start();
  /** state → verifier, and the server it was started for. */
  const pending = new Map<string, { verifier: string; expires: number; server: string }>();
  const status = (): CloudStatus => ({
    server: sync.server,
    account: sync.stored()?.account ?? null,
    sync: sync.syncStatus(),
    cloudDecks: sync.cloudDecks(),
  });

  const call = (server: string, route: string, body: unknown) =>
    (deps.cloudFetch ?? fetch)(`${server}/api${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

  const unreachable = (server: string) =>
    new ApiError(502, 'cloud_unreachable', `${new URL(server).host} ist nicht erreichbar.`);

  /** Another server than the last one: it has to answer like a Slider before the browser opens. */
  const checkSlider = async (server: string) => {
    let answer: unknown;
    try {
      const response = await (deps.cloudFetch ?? fetch)(`${server}/api/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      answer = response.ok ? await response.json().catch(() => null) : null;
    } catch (error) {
      deps.log.warn('desktop sign-in: server unreachable', error);
      throw unreachable(server);
    }
    if (!answer || typeof answer !== 'object' || !('ok' in answer) || answer.ok !== true) {
      throw badRequest(`Unter ${new URL(server).host} läuft kein Slider.`);
    }
  };

  // The desktop's one person (its dev login); nobody else reaches 127.0.0.1's API.
  return (
    new Hono<ViewerEnv>()
      .use('/desktop/cloud', viewerMiddleware(deps))
      .use('/desktop/cloud/*', viewerMiddleware(deps))
      .get('/desktop/cloud', (c) => c.json<CloudStatus>(status()))
      /** A pass now (the account menu, tests); answers once it is done. */
      .post('/desktop/cloud/sync', async (c) => {
        await sync.run();
        return c.json<CloudStatus>(status());
      })
      /** „Auf diesem Gerät behalten“ for one of the account's decks brought here. */
      .put('/desktop/cloud/decks/:deckId/keep', async (c) => {
        const { keep } = await readJson(c, cloudKeepInputSchema);
        sync.setKeep(c.req.param('deckId'), keep);
        return c.json<CloudStatus>(status());
      })
      .post('/desktop/cloud/start', async (c) => {
        const input = await readJson(c, cloudStartInputSchema, undefined, { allowEmpty: true });
        const server = input.server ? cloudServerOrigin(input.server) : sync.server;
        if (server !== sync.server) {
          if (sync.stored()) {
            throw new ApiError(409, 'bad_request', 'Erst abmelden, dann woanders anmelden.');
          }
          await checkSlider(server);
        }
        const now = deps.clock.now().getTime();
        for (const [state, entry] of pending) if (entry.expires < now) pending.delete(state);
        const verifier = randomBytes(32).toString('base64url');
        const state = randomBytes(16).toString('base64url');
        pending.set(state, { verifier, expires: now + PENDING_TTL_MS, server });
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const query = new URLSearchParams({ challenge, state });
        return c.json<CloudSignInStart>({ url: `${server}/desktop-anmelden?${query.toString()}` });
      })
      .post('/desktop/cloud/finish', async (c) => {
        const { code, state } = await readJson(c, cloudFinishInputSchema);
        const entry = pending.get(state);
        if (!entry || entry.expires < deps.clock.now().getTime()) throw notFound();
        pending.delete(state);
        let response: Response;
        try {
          response = await call(entry.server, '/auth/desktop/token', {
            code,
            verifier: entry.verifier,
          });
        } catch (error) {
          deps.log.warn('desktop sign-in: server unreachable', error);
          throw unreachable(entry.server);
        }
        if (!response.ok) {
          throw new ApiError(
            400,
            'cloud_refused',
            'Die Anmeldung hat nicht geklappt – bitte neu starten.',
          );
        }
        const { token, account } = desktopTokenSchema.parse(await response.json());
        // Two sign-ins started for different servers: the one finished first stays, the other's
        // fresh session ends there (checked after the exchange – both may have been under way).
        if (entry.server !== sync.server && sync.stored()) {
          await call(entry.server, '/auth/desktop/logout', { token }).catch(() => undefined);
          throw new ApiError(409, 'bad_request', 'Erst abmelden, dann woanders anmelden.');
        }
        sync.signedIn(entry.server, token, account, c.var.viewer.author.id);
        return c.json<CloudStatus>(status());
      })
      /** For Electron only (the app's secret): the token, to open the server's pages signed in. */
      .get('/desktop/cloud/session', electronOnly(deps.config.secret), (c) =>
        c.json<CloudSession>({ server: sync.server, token: sync.token(), ...sync.ids() }),
      )
      .delete('/desktop/cloud', async (c) => {
        const token = await sync.signOut();
        // Offline the session stays on the server until it expires; here it is gone either way.
        if (token) {
          await call(sync.server, '/auth/desktop/logout', { token }).catch((error: unknown) =>
            deps.log.warn('desktop sign-out: server unreachable', error),
          );
        }
        return c.json<CloudStatus>(status());
      })
  );
}
