import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  SETUP_KEYS,
  SETUP_TOKEN_HEADER,
  saveSetupInputSchema,
  type SaveSetupResult,
  type SetupField,
  type SetupKey,
  type SetupStatus,
} from '@slider/shared';
import { optionalViewerMiddleware, type OptionalViewerEnv } from '../auth/viewer';
import {
  GOOGLE_CALLBACK_PATH,
  MICROSOFT_CALLBACK_PATH,
  OIDC_CALLBACK_PATH,
  hasLogin,
  loadConfig,
  stripEmpty,
  withStoredSettings,
} from '../config';
import { users } from '../db/schema';
import type { AppDeps, InstanceControl } from '../deps';
import { badRequest, forbidden, notFound } from '../http/errors';
import { rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  instanceClaimed,
  isSecretSetting,
  readStoredSettings,
  saveStoredSettings,
  setupTokenMatches,
} from '../services/instance-settings';

/**
 * Setup page (`/einrichtung`): logins, mail and sign-up stored in the database, so a self-hosted
 * Slider starts with nothing but `SLIDER_URL`. Before the first account exists, the one-time token
 * from the server log opens it; afterwards the instance admin. Saving restarts the server (under
 * the supervisor in the Docker image), because login clients are built once at start.
 */
export function setupRoutes(deps: AppDeps) {
  const viewer = optionalViewerMiddleware(deps);
  const limit = rateLimit({ limit: 30, windowMs: 60_000, clock: deps.clock });

  const instance = (): InstanceControl => {
    if (!deps.instance) throw notFound();
    return deps.instance;
  };

  /** Token before the first account, instance admin afterwards. */
  const authorized = async (c: Context<OptionalViewerEnv>, claimed: boolean) => {
    if (!claimed) return setupTokenMatches(deps.config.dataDir, c.req.header(SETUP_TOKEN_HEADER));
    const current = c.var.viewer;
    if (current?.kind !== 'owner') return false;
    const [user] = await deps.db
      .select({ admin: users.isInstanceAdmin })
      .from(users)
      .where(eq(users.id, current.author.id));
    return user?.admin === true;
  };

  const restartMode = () => (instance().restart ? 'automatic' : 'manual');

  return new Hono<OptionalViewerEnv>()
    .get('/setup', limit, viewer, async (c) => {
      const { env } = instance();
      const claimed = await instanceClaimed(deps.db);
      const status: SetupStatus = {
        authorized: await authorized(c, claimed),
        hasAccount: claimed,
        loginConfigured: hasLogin(deps.config),
      };
      c.header('Cache-Control', 'no-store');
      if (!status.authorized) return c.json(status);

      const stored = await readStoredSettings(deps.db, deps.config.secret, deps.log);
      const fromEnv = stripEmpty(env);
      const fields = Object.fromEntries(
        SETUP_KEYS.map((key): [SetupKey, SetupField] => {
          const value = fromEnv[key] ?? stored[key] ?? null;
          return [
            key,
            {
              source:
                fromEnv[key] !== undefined ? 'env' : stored[key] !== undefined ? 'stored' : null,
              value: isSecretSetting(key) ? null : value,
              set: value !== null,
            },
          ];
        }),
      ) as Record<SetupKey, SetupField>;
      const url = deps.config.webOrigin;
      return c.json<SetupStatus>({
        ...status,
        settings: {
          url,
          restart: restartMode(),
          redirectUris: {
            microsoft: new URL(MICROSOFT_CALLBACK_PATH, url).toString(),
            google: new URL(GOOGLE_CALLBACK_PATH, url).toString(),
            oidc: new URL(OIDC_CALLBACK_PATH, url).toString(),
          },
          fields,
        },
      });
    })

    .put('/setup', limit, viewer, async (c) => {
      const control = instance();
      const claimed = await instanceClaimed(deps.db);
      if (!(await authorized(c, claimed))) {
        throw forbidden(
          claimed
            ? 'Nur der Admin dieser Slider-Instanz kann die Einrichtung ändern.'
            : 'Der Einrichtungslink ist ungültig. Den aktuellen Link findest du im Server-Log.',
        );
      }
      const { values } = await readJson(c, saveSetupInputSchema);
      const fromEnv = stripEmpty(control.env);
      const locked = Object.keys(values).filter((key) => fromEnv[key] !== undefined);
      if (locked.length > 0) {
        throw badRequest(`Wird per Umgebungsvariable gesetzt: ${locked.join(', ')}`);
      }

      const stored = await readStoredSettings(deps.db, deps.config.secret, deps.log);
      const next: Partial<Record<SetupKey, string>> = { ...stored };
      for (const [key, value] of Object.entries(values) as [SetupKey, string | null][]) {
        if (value) next[key] = value;
        else delete next[key];
      }
      let candidate: ReturnType<typeof loadConfig>;
      try {
        candidate = loadConfig(withStoredSettings(control.env, next), () => {});
      } catch (error) {
        throw badRequest(describeConfigError(error));
      }
      if (!claimed) {
        if (!hasLogin(candidate)) {
          throw badRequest(
            'Richte mindestens einen Anmeldeweg ein (E-Mail, Microsoft, Google oder SSO).',
          );
        }
        if (candidate.env === 'production' && candidate.auth.bootstrapEmails.length === 0) {
          throw badRequest('Gib deine E-Mail-Adresse an – mit ihr wirst du Admin dieser Instanz.');
        }
      }

      await saveStoredSettings(deps.db, deps.config.secret, values, deps.clock.now());
      deps.log.info(`Setup saved: ${Object.keys(values).join(', ') || 'nothing changed'}`);
      const result: SaveSetupResult = { restart: restartMode() };
      // After the response has gone out.
      if (control.restart) setTimeout(control.restart, 300);
      return c.json(result);
    });
}

/** Config errors are English for the server log; the zod ones carry the German message. */
function describeConfigError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    const [issue] = error.issues as { path?: unknown[]; message?: string }[];
    if (issue) return `${issue.path?.join('.') ?? ''}: ${issue.message ?? ''}`.replace(/^: /, '');
  }
  return error instanceof Error ? error.message : 'Die Einstellungen sind ungültig.';
}
