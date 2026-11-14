import { showRunRoutes } from './routes/show-runs';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX, MCP_PATH } from '@slider/shared';
import { InstanceGate } from './auth/instance-gate';
import type { AppDeps } from './deps';
import { CSP_REPORT_PATH } from './http/csp';
import { errorHandler, notFoundHandler } from './http/errors';
import { healthCheck, trustProxy } from './http/hosting';
import { LiveHub } from './realtime/live-hub';
import { LiveTexts } from './realtime/live-texts';
import { WorkspacePresence } from './realtime/workspace-presence';
import { sameOriginWrites } from './http/same-origin';
import { desktopGuard } from './http/desktop-guard';
import {
  appConnectionsRoutes,
  isOpenPath,
  OPEN_PATHS,
  wellKnownRoutes,
} from './routes/app-connections';
import { serveWebApp } from './http/static';
import { authRoutes } from './routes/auth';
import { desktopCloudRoutes } from './routes/desktop-cloud';
import { desktopFilesRoutes } from './routes/desktop-files';
import { desktopLoginRoutes } from './routes/desktop-login';
import { billingRoutes } from './routes/billing';
import { materialsRoutes } from './routes/materials';
import { materialChatRoutes } from './routes/material-chat';
import { materialQuestionsRoutes } from './routes/material-questions';
import { deckCreationRoutes } from './routes/deck-creation';
import { commentsRoutes } from './routes/comments';
import { decksRoutes } from './routes/decks';
import { deckTusRoutes } from './routes/deck-tus';
import { nextcloudRoutes } from './routes/nextcloud';
import { filesRoutes } from './routes/files';
import { liveRoutes } from './routes/live';
import { siteLiveRoutes } from './routes/site-live';
import { SiteLive } from './realtime/site-live';
import { mediaRoutes } from './routes/media';
import { voiceRoutes } from './routes/voice';
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
import { editsRoutes } from './routes/edits';
import { integrationsRoutes } from './routes/integrations';
import { workspacesRoutes } from './routes/workspaces';
import { foldersRoutes } from './routes/folders';
import { configureFileUrls } from './storage/file-urls';

export function createApp(appDeps: AppDeps) {
  configureFileUrls(appDeps.config.secret);
  const live = appDeps.live ?? new LiveHub();
  const presence = appDeps.presence ?? new WorkspacePresence(() => appDeps.clock.now().getTime());
  const texts = appDeps.liveTexts ?? new LiveTexts(live);
  // Live comments on the product website – in memory, apart from decks and accounts.
  const site = new SiteLive();
  const deps: AppDeps = { ...appDeps, live, presence, liveTexts: texts };
  const app = new Hono();

  if (deps.config.env === 'development') {
    // Live presence posts come many times a second while a pointer moves – not worth a log line.
    const log = logger();
    const livePosts = [`${API_PREFIX}/live/`, `${API_PREFIX}/site-live/`];
    app.use((c, next) => (livePosts.some((p) => c.req.path.startsWith(p)) ? next() : log(c, next)));
  }
  // gzip for the web app, the API's JSON and SVG slides – also behind a proxy that doesn't
  // compress (nginx's and Traefik's defaults). Skips the live stream (text/event-stream, it would
  // be buffered), ranges and what is compressed already (WebP, audio, video).
  app.use(compress());
  // The desktop's local server: this machine and the app only (DNS rebinding, other browsers).
  if (deps.config.desktop) {
    app.use(desktopGuard(deps.config.secret, [`${API_PREFIX}/health`], [MCP_PATH]));
  }
  // `same-site`: the web dev server (another port on localhost) may embed slide images.
  // `same-origin-allow-popups`: the Nextcloud login is a popup the page keeps steering and closes
  // after it went to the Nextcloud – plain `same-origin` would cut the page's handle on it.
  app.use(
    secureHeaders({
      crossOriginResourcePolicy: 'same-site',
      crossOriginOpenerPolicy: 'same-origin-allow-popups',
    }),
  );
  // AI apps (MCP, OAuth, discovery) are read from any origin, without cookies; the rest is the
  // web app's own.
  const appCors = cors({ origin: deps.config.webOrigin, credentials: true });
  const openCors = cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      'Mcp-Session-Id',
      'Mcp-Protocol-Version',
      'Last-Event-ID',
    ],
    exposeHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
  });
  app.use((c, next) => (isOpenPath(c.req.path) ? openCors(c, next) : appCors(c, next)));
  // Browsers post CSP reports on their own (Origin missing or `null`); a report changes nothing.
  // AI apps call with a bearer token, never the session cookie: no CSRF there.
  app.use(sameOriginWrites(deps.config.webOrigin, [CSP_REPORT_PATH, ...OPEN_PATHS]));
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
    .route('/', siteLiveRoutes(site))
    .route('/', legalRoutes(deps))
    .route('/', instanceAdminRoutes(deps))
    .route('/', deckTusRoutes(deps))
    .route('/', decksRoutes(deps))
    .route('/', nextcloudRoutes(deps))
    .route('/', syncRoutes(deps))
    .route('/', editsRoutes(deps))
    .route('/', integrationsRoutes(deps))
    .route('/', storageRoutes(deps))
    .route('/', commentsRoutes(deps))
    .route('/', materialsRoutes(deps))
    .route('/', materialQuestionsRoutes(deps))
    .route('/', materialChatRoutes(deps))
    .route('/', appConnectionsRoutes(deps))
    .route('/', deckCreationRoutes(deps))
    .route('/', showRunRoutes(deps))
    .route('/', liveRoutes(deps, live, presence, texts))
    .route('/', mediaRoutes(deps))
    .route('/', voiceRoutes(deps))
    .route('/', workspacesRoutes(deps, presence))
    .route('/', billingRoutes(deps))
    .route('/', foldersRoutes(deps))
    .route('/', authRoutes(deps, gate))
    .route('/', desktopLoginRoutes(deps))
    .route('/', desktopCloudRoutes(deps))
    .route('/', desktopFilesRoutes(deps))
    .route('/', passkeysRoutes(deps))
    .route('/', setupRoutes(deps));

  // Self-hosting: health check for Docker and uptime monitors, before any auth middleware.
  app.get(`${API_PREFIX}/health`, healthCheck(deps));
  app.route(API_PREFIX, api);
  app.route('/', wellKnownRoutes(deps));
  app.route('/files', filesRoutes(deps));

  // Self-hosting: the built web app from the same origin as the API.
  const webDist = deps.config.hosting?.webDistDir;
  if (webDist) app.use(serveWebApp(webDist, [API_PREFIX, '/files'], deps.log));

  app.onError(errorHandler(deps.log));
  app.notFound(notFoundHandler);
  return app;
}

export type App = ReturnType<typeof createApp>;
