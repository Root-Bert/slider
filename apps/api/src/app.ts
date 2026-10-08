import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX } from '@slider/shared';
import type { AppDeps } from './deps';
import { errorHandler, notFoundHandler } from './http/errors';
import { healthCheck, trustProxy } from './http/hosting';
import { serveWebApp } from './http/static';
import { authRoutes } from './routes/auth';
import { commentsRoutes } from './routes/comments';
import { decksRoutes } from './routes/decks';
import { filePickerRoutes } from './routes/file-picker';
import { filesRoutes } from './routes/files';
import { invitesRoutes } from './routes/invites';
import { mediaRoutes } from './routes/media';
import { meRoutes } from './routes/me';
import { passkeysRoutes } from './routes/passkeys';
import { reviewLinksRoutes } from './routes/review-links';
import { setupRoutes } from './routes/setup';
import { syncRoutes } from './routes/sync';
import { workspacesRoutes } from './routes/workspaces';

export function createApp(deps: AppDeps) {
  const app = new Hono();

  if (deps.config.env === 'development') app.use(logger());
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
    .route('/', mediaRoutes(deps))
    .route('/', reviewLinksRoutes(deps))
    .route('/', invitesRoutes(deps))
    .route('/', workspacesRoutes(deps))
    .route('/', authRoutes(deps))
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
