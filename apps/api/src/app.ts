import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX } from '@slider/shared';
import { InstanceGate } from './auth/instance-gate';
import type { AppDeps } from './deps';
import { CSP_REPORT_PATH } from './http/csp';
import { errorHandler, notFoundHandler } from './http/errors';
import { healthCheck, trustProxy } from './http/hosting';
import { LiveHub } from './realtime/live-hub';
import { sameOriginWrites } from './http/same-origin';
import { serveWebApp } from './http/static';
import { authRoutes } from './routes/auth';
import { billingRoutes } from './routes/billing';
import { commentsRoutes } from './routes/comments';
import { decksRoutes } from './routes/decks';
import { filePickerRoutes } from './routes/file-picker';
import { nextcloudRoutes } from './routes/nextcloud';
import { filesRoutes } from './routes/files';
import { liveRoutes } from './routes/live';
import { mediaRoutes } from './routes/media';
import { dataRequestsRoutes } from './routes/data-requests';
import { contactRoutes } from './routes/contact';
import { cspReportRoutes } from './routes/csp-report';
import { instanceAdminRoutes } from './routes/instance-admin';
import { legalRoutes } from './routes/legal';
import { meRoutes } from './routes/me';
import { passkeysRoutes } from './routes/passkeys';
import { setupRoutes } from './routes/setup';
import { storageRoutes } from './routes/storage';
import { syncRoutes } from './routes/sync';
import { workspacesRoutes } from './routes/workspaces';
import { foldersRoutes } from './routes/folders';
import { configureFileUrls } from './storage/file-urls';

export function createApp(appDeps: AppDeps) {
  configureFileUrls(appDeps.config.secret);
  const live = appDeps.live ?? new LiveHub();
  const deps: AppDeps = { ...appDeps, live };
  const app = new Hono();

  if (deps.config.env === 'development') {
    // Live presence posts come many times a second while a pointer moves – not worth a log line.
    const log = logger();
    const livePosts = `${API_PREFIX}/live/`;
    app.use((c, next) => (c.req.path.startsWith(livePosts) ? next() : log(c, next)));
  }
  // gzip for the web app, the API's JSON and SVG slides – also behind a proxy that doesn't
  // compress (nginx's and Traefik's defaults). Skips the live stream (text/event-stream, it would
  // be buffered), ranges and what is compressed already (WebP, audio, video).
  app.use(compress());
  // `same-site`: the web dev server (another port on localhost) may embed slide images.
  // `same-origin-allow-popups`: the OneDrive file picker is a Microsoft popup that talks back to
  // the page through `window.opener` – plain `same-origin` would cut that link.
  app.use(
    secureHeaders({
      crossOriginResourcePolicy: 'same-site',
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
    }),
  );
  app.use(cors({ origin: deps.config.webOrigin, credentials: true }));
  // Browsers post CSP reports on their own (Origin missing or `null`); a report changes nothing.
  app.use(sameOriginWrites(deps.config.webOrigin, [CSP_REPORT_PATH]));
  if (deps.config.hosting?.trustProxy) app.use(trustProxy());
  // Before the instance gate: reports come from any page, also before the instance is claimed.
  app.route(API_PREFIX, cspReportRoutes(deps));
  // No instance admin yet: signed-in accounts enter the setup token before anything else.
  const gate = new InstanceGate(deps);
  app.use(`${API_PREFIX}/*`, gate.middleware);

  const api = new Hono()
    .route('/', meRoutes(deps, gate))
    .route('/', dataRequestsRoutes(deps))
    .route('/', contactRoutes(deps))
    .route('/', legalRoutes(deps))
    .route('/', instanceAdminRoutes(deps))
    .route('/', decksRoutes(deps))
    .route('/', filePickerRoutes(deps))
    .route('/', nextcloudRoutes(deps))
    .route('/', syncRoutes(deps))
    .route('/', storageRoutes(deps))
    .route('/', commentsRoutes(deps))
    .route('/', liveRoutes(deps, live))
    .route('/', mediaRoutes(deps))
    .route('/', workspacesRoutes(deps))
    .route('/', billingRoutes(deps))
    .route('/', foldersRoutes(deps))
    .route('/', authRoutes(deps, gate))
    .route('/', passkeysRoutes(deps))
    .route('/', setupRoutes(deps));

  // Self-hosting: health check for Docker and uptime monitors, before any auth middleware.
  app.get(`${API_PREFIX}/health`, healthCheck(deps));
  app.route(API_PREFIX, api);
  app.route('/files', filesRoutes(deps));

  // Self-hosting: the built web app from the same origin as the API.
  const webDist = deps.config.hosting?.webDistDir;
  if (webDist) app.use(serveWebApp(webDist, [API_PREFIX, '/files'], deps.log));

  app.onError(errorHandler(deps.log));
  app.notFound(notFoundHandler);
  return app;
}

export type App = ReturnType<typeof createApp>;
