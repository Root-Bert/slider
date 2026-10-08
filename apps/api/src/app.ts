import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { API_PREFIX } from '@slider/shared';
import type { AppDeps } from './deps';
import { errorHandler, notFoundHandler } from './http/errors';
import { authRoutes } from './routes/auth';
import { commentsRoutes } from './routes/comments';
import { decksRoutes } from './routes/decks';
import { filesRoutes } from './routes/files';
import { invitesRoutes } from './routes/invites';
import { mediaRoutes } from './routes/media';
import { meRoutes } from './routes/me';
import { reviewLinksRoutes } from './routes/review-links';
import { syncRoutes } from './routes/sync';

export function createApp(deps: AppDeps) {
  const app = new Hono();

  if (deps.config.env === 'development') app.use(logger());
  // `same-site`: the web dev server (another port on localhost) may embed slide images.
  app.use(secureHeaders({ crossOriginResourcePolicy: 'same-site' }));
  app.use(cors({ origin: deps.config.webOrigin, credentials: true }));

  const api = new Hono()
    .route('/', meRoutes(deps))
    .route('/', decksRoutes(deps))
    .route('/', syncRoutes(deps))
    .route('/', commentsRoutes(deps))
    .route('/', mediaRoutes(deps))
    .route('/', reviewLinksRoutes(deps))
    .route('/', invitesRoutes(deps))
    .route('/', authRoutes(deps));

  app.route(API_PREFIX, api);
  app.route('/files', filesRoutes(deps));

  app.onError(errorHandler(deps.log));
  app.notFound(notFoundHandler);
  return app;
}

export type App = ReturnType<typeof createApp>;
