import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX } from '@slider/shared';
import type { AppDeps } from './deps';
import { errorHandler, notFoundHandler } from './http/errors';
import { healthCheck, trustProxy } from './http/hosting';
import { LiveHub } from './realtime/live-hub';
import { MAIL_LOGO_PATH, mailLogoResponse } from './mail/mailer';
import { serveWebApp } from './http/static';
import { authRoutes } from './routes/auth';
import { commentsRoutes } from './routes/comments';
import { decksRoutes } from './routes/decks';
import { filePickerRoutes } from './routes/file-picker';
import { filesRoutes } from './routes/files';
import { liveRoutes } from './routes/live';
import { mediaRoutes } from './routes/media';
import { meRoutes } from './routes/me';
import { passkeysRoutes } from './routes/passkeys';
import { setupRoutes } from './routes/setup';
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
  if (deps.config.hosting?.trustProxy) app.use(trustProxy());

  const api = new Hono()
    .route('/', meRoutes(deps))
    .route('/', decksRoutes(deps))
    .route('/', filePickerRoutes(deps))
    .route('/', syncRoutes(deps))
    .route('/', commentsRoutes(deps))
    .route('/', liveRoutes(deps, live))
    .route('/', mediaRoutes(deps))
    .route('/', workspacesRoutes(deps))
    .route('/', foldersRoutes(deps))
    .route('/', authRoutes(deps))
    .route('/', passkeysRoutes(deps))
    .route('/', setupRoutes(deps));

  // Self-hosting: health check for Docker and uptime monitors, before any auth middleware.
  app.get(`${API_PREFIX}/health`, healthCheck(deps));
  // The mark in invitation mails – public, Gmail's image proxy fetches it without a session.
  app.get(MAIL_LOGO_PATH, () => mailLogoResponse());
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
