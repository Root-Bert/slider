import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import {
  SETUP_KEYS,
  SETUP_TOKEN_HEADER,
  saveSetupInputSchema,
  type ClaimSetupResult,
  type SaveSetupResult,
  type SetupField,
  type SetupKey,
  type SetupStatus,
} from '@slider/shared';
import { optionalViewerMiddleware, unauthorized, type OptionalViewerEnv } from '../auth/viewer';
import {
  GOOGLE_CALLBACK_PATH,
  MICROSOFT_CALLBACK_PATH,
  NEXTCLOUD_CALLBACK_PATH,
  OIDC_CALLBACK_PATH,
  hasLogin,
  loadConfig,
  stripEmpty,
  withStoredSettings,
} from '../config';
import { passkeys } from '../db/schema';
import type { AppDeps, InstanceControl } from '../deps';
import { ApiError, badRequest, forbidden, notFound } from '../http/errors';
import { clientAddress, rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import type { Clock } from '../clock';
import { claimInstance } from '../services/accounts';
import { isInstanceAdmin } from '../services/instance-admin';
import {
  instanceClaimed,
  keepSmtpPassword,
  readStoredSettings,
  saveStoredSettings,
  setupTokenMatches,
  visibleSetting,
} from '../services/instance-settings';

/**
 * Setup page (`/einrichtung`): logins, mail and sign-up stored in the database, so a self-hosted
 * Slider starts with nothing but `SLIDER_URL`. Until an instance admin exists, the one-time token
 * from the server log opens it – typed in on the page, sent as a header, never in a URL. A
 * signed-in account instead claims the instance with that token (`POST /setup/claim`) and is
 * admin from then on; signing in alone makes nobody admin. Until then signed-in accounts can do
 * nothing else (`auth/instance-gate`). Saving restarts the server (under the
 * supervisor in the Docker image), because login clients are built once at start.
 */
export function setupRoutes(deps: AppDeps) {
  const viewer = optionalViewerMiddleware(deps);
  const limit = rateLimit({ limit: 30, windowMs: 60_000, clock: deps.clock });
  const failures = tokenFailures(deps.clock);

  const instance = (): InstanceControl => {
    if (!deps.instance) throw notFound();
    return deps.instance;
  };

  /**
   * The setup token from the header. Wrong tokens count per client address: after
   * {@link MAX_TOKEN_FAILURES} the address gets 429 for a while, right token or not.
   */
  const tokenGiven = (c: Context<OptionalViewerEnv>): boolean => {
    const given = c.req.header(SETUP_TOKEN_HEADER);
    if (!given) return false;
    const client = clientAddress(c);
    const retryAfterS = failures.blockedFor(client);
    if (retryAfterS > 0) {
      c.header('Retry-After', String(retryAfterS));
      throw tooManyAttempts();
    }
    if (setupTokenMatches(deps.config.dataDir, given)) return true;
    failures.add(client);
    deps.log.warn(`Wrong setup token from ${client}`);
    return false;
  };

  /**
   * The account a signed-in caller can claim the instance for – not the dev owner of the dev
   * login, who acts without signing in (development keeps using the token as before).
   */
  const claimant = (c: Context<OptionalViewerEnv>): string | null => {
    const current = c.var.viewer;
    if (current?.kind !== 'owner') return null;
    if (deps.config.auth.devLogin && current.author.id === deps.ownerId) return null;
    return current.author.id;
  };

  /**
   * Instance admin once claimed. Before: the token – but not for a signed-in account, which
   * claims the instance with it instead.
   */
  const authorized = async (c: Context<OptionalViewerEnv>, claimed: boolean) => {
    if (!claimed) return claimant(c) === null && tokenGiven(c);
    return isInstanceAdmin(deps.db, c.var.viewer);
  };

  /** Whether the settings as stored now (before this save) offer a login. */
  const hadLogin = (env: NodeJS.ProcessEnv, stored: Partial<Record<SetupKey, string>>) => {
    try {
      return hasLogin(loadConfig(withStoredSettings(env, stored), () => {}));
    } catch {
      return hasLogin(deps.config);
    }
  };

  const adminHasPasskey = async (c: Context<OptionalViewerEnv>) => {
    const current = c.var.viewer;
    if (current?.kind !== 'owner') return false;
    const [row] = await deps.db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, current.author.id))
      .limit(1);
    return row !== undefined;
  };

  const restartMode = () => (instance().restart ? 'automatic' : 'manual');

  return (
    new Hono<OptionalViewerEnv>()
      .get('/setup', limit, viewer, async (c) => {
        const { env } = instance();
        const claimed = await instanceClaimed(deps.db);
        const status: SetupStatus = {
          authorized: await authorized(c, claimed),
          claimed,
          claimable: !claimed && claimant(c) !== null,
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
                value: visibleSetting(key, value),
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
              nextcloud: new URL(NEXTCLOUD_CALLBACK_PATH, url).toString(),
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
              : claimant(c)
                ? 'Gib zuerst den Setup-Token ein – damit wirst du Admin dieser Instanz.'
                : WRONG_TOKEN,
          );
        }
        const { values } = await readJson(c, saveSetupInputSchema);
        const fromEnv = stripEmpty(control.env);
        const locked = Object.keys(values).filter((key) => fromEnv[key] !== undefined);
        if (locked.length > 0) {
          throw badRequest(`Wird per Umgebungsvariable gesetzt: ${locked.join(', ')}`);
        }

        const stored = await readStoredSettings(deps.db, deps.config.secret, deps.log);
        if (values.SMTP_URL) values.SMTP_URL = keepSmtpPassword(values.SMTP_URL, stored.SMTP_URL);
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
              'Richte mindestens einen Anmeldeweg ein (Microsoft, Google, Nextcloud oder SSO).',
            );
          }
        } else if (
          !hasLogin(candidate) &&
          hadLogin(control.env, stored) &&
          !(await adminHasPasskey(c))
        ) {
          // Without Microsoft or SSO only passkeys still sign in: removing the last login
          // without one would lock the admin (and everyone else) out once the session ends.
          throw badRequest(
            'Ohne Microsoft, Google, Nextcloud oder SSO kannst du dich nur noch mit einem Passkey anmelden. Lege zuerst unter Konto einen Passkey an oder behalte einen Anmeldeweg.',
          );
        }

        await saveStoredSettings(deps.db, deps.config.secret, values, deps.clock.now());
        deps.log.info(`Setup saved: ${Object.keys(values).join(', ') || 'nothing changed'}`);
        const result: SaveSetupResult = { restart: restartMode() };
        // After the response has gone out.
        if (control.restart) setTimeout(control.restart, 300);
        return c.json(result);
      })

      // Signed in, no instance admin yet: the setup token makes this account admin (single use).
      .post('/setup/claim', limit, viewer, async (c) => {
        const userId = claimant(c);
        if (!userId) throw unauthorized();
        if (await instanceClaimed(deps.db)) throw forbidden(ALREADY_CLAIMED);
        if (!tokenGiven(c)) throw forbidden(WRONG_TOKEN);
        const result = await claimInstance(deps, userId, c.req.header(SETUP_TOKEN_HEADER));
        if (!result.ok) {
          throw forbidden(result.error === 'claimed' ? ALREADY_CLAIMED : WRONG_TOKEN);
        }
        c.header('Cache-Control', 'no-store');
        return c.json<ClaimSetupResult>({ claimed: true });
      })
  );
}

const WRONG_TOKEN = 'Der Setup-Token stimmt nicht. Den aktuellen findest du im Server-Log.';
const ALREADY_CLAIMED = 'Diese Slider-Instanz hat schon einen Admin.';

/** Wrong setup tokens per client address before it has to wait. */
export const MAX_TOKEN_FAILURES = 10;
const TOKEN_FAILURE_WINDOW_MS = 15 * 60_000;

const tooManyAttempts = () =>
  new ApiError(
    429,
    'rate_limited',
    'Zu viele falsche Setup-Tokens. Warte ein paar Minuten und versuch es dann erneut.',
  );

/** Fixed window of failed attempts per key; only failures count, so using the token never locks. */
function tokenFailures(clock: Clock) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  const current = (key: string, now: number) => {
    const window = windows.get(key);
    return window && now - window.startedAt < TOKEN_FAILURE_WINDOW_MS ? window : null;
  };
  return {
    /** Seconds until the key may try again; `0` = now. */
    blockedFor(key: string): number {
      const now = clock.now().getTime();
      const window = current(key, now);
      if (!window || window.count < MAX_TOKEN_FAILURES) return 0;
      return Math.ceil((window.startedAt + TOKEN_FAILURE_WINDOW_MS - now) / 1000);
    },
    add(key: string): void {
      const now = clock.now().getTime();
      const window = current(key, now);
      if (window) {
        window.count += 1;
        return;
      }
      if (windows.size > 10_000) {
        // Only expired windows go: clearing everything would also lift running blocks.
        for (const [other, entry] of windows) {
          if (now - entry.startedAt >= TOKEN_FAILURE_WINDOW_MS) windows.delete(other);
        }
      }
      windows.set(key, { startedAt: now, count: 1 });
    },
  };
}

/** Config errors are English for the server log; the zod ones carry the German message. */
function describeConfigError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
    const [issue] = error.issues as { path?: unknown[]; message?: string }[];
    if (issue) return `${issue.path?.join('.') ?? ''}: ${issue.message ?? ''}`.replace(/^: /, '');
  }
  return error instanceof Error ? error.message : 'Die Einstellungen sind ungültig.';
}
