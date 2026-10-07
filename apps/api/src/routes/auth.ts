import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import { requireOwner } from '../auth/access';
import {
  buildAuthorizeUrl,
  createPkce,
  mapMicrosoftError,
  MicrosoftAuthError,
  type MicrosoftErrorKind,
} from '../auth/microsoft';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { microsoftNotConfigured } from '../sources/errors';

/** Short-lived cookie that carries PKCE state from `/login` to `/callback`. */
export const MS_OAUTH_COOKIE = 'slider_ms_oauth';
const COOKIE_PATH = '/api/auth/microsoft';
const COOKIE_MAX_AGE = 10 * 60;
const DEFAULT_RETURN_TO = '/neu';

const oauthStateSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  returnTo: z.string(),
});

/** Only same-origin paths – `//evil.com` or absolute URLs would make this an open redirect. */
export const safeReturnTo = (value: string | undefined): string =>
  value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : DEFAULT_RETURN_TO;

/**
 * Microsoft sign-in (BER-92): `/login` sends the browser to Microsoft, `/callback` stores the
 * tokens and returns to `returnTo` – usually `/neu?link=…`, which retries the import.
 */
export function authRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const { config } = deps;

  const toWeb = (c: Context, path: string) =>
    c.redirect(new URL(path, config.webOrigin).toString(), 302);

  /** Back to the start page with the link prefilled and the reason, so A3 can explain it. */
  const failed = (c: Context, returnTo: string, kind: MicrosoftErrorKind) => {
    const back = new URL(returnTo, config.webOrigin);
    const target = new URL(DEFAULT_RETURN_TO, config.webOrigin);
    const link = back.searchParams.get('link');
    if (link) target.searchParams.set('link', link);
    target.searchParams.set('msError', kind);
    return toWeb(c, target.pathname + target.search);
  };

  return new Hono<ViewerEnv>()
    .get('/auth/microsoft/login', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const microsoft = config.microsoft;
      if (!microsoft) {
        const error = microsoftNotConfigured();
        return c.json(error.toBody(), 503);
      }
      const pkce = await createPkce();
      const payload = {
        state: pkce.state,
        verifier: pkce.verifier,
        returnTo: safeReturnTo(c.req.query('returnTo')),
      };
      await setSignedCookie(
        c,
        MS_OAUTH_COOKIE,
        Buffer.from(JSON.stringify(payload)).toString('base64url'),
        config.secret,
        {
          path: COOKIE_PATH,
          httpOnly: true,
          sameSite: 'Lax',
          secure: config.env === 'production',
          maxAge: COOKIE_MAX_AGE,
        },
      );
      return c.redirect(buildAuthorizeUrl(microsoft, pkce), 302);
    })

    .get('/auth/microsoft/callback', viewer, async (c) => {
      const raw = await getSignedCookie(c, config.secret, MS_OAUTH_COOKIE);
      deleteCookie(c, MS_OAUTH_COOKIE, { path: COOKIE_PATH });
      const saved = raw ? parseState(raw) : null;
      const returnTo = saved?.returnTo ?? DEFAULT_RETURN_TO;
      const query = c.req.query();

      if (!saved || !query['state'] || query['state'] !== saved.state) {
        return failed(c, returnTo, 'failed');
      }
      if (query['error']) {
        deps.log.warn(
          `Microsoft login failed: ${query['error']} ${query['error_description'] ?? ''}`,
        );
        return failed(c, returnTo, mapMicrosoftError(query['error'], query['error_description']));
      }
      const code = query['code'];
      if (!code || c.var.viewer.kind !== 'owner' || !deps.microsoft.configured) {
        return failed(c, returnTo, 'failed');
      }

      try {
        await deps.microsoft.completeLogin(c.var.viewer.author.id, code, saved.verifier);
      } catch (error) {
        deps.log.warn('Microsoft token exchange failed', error);
        return failed(c, returnTo, error instanceof MicrosoftAuthError ? error.kind : 'failed');
      }
      return toWeb(c, returnTo);
    });
}

function parseState(raw: string): z.infer<typeof oauthStateSchema> | null {
  try {
    const parsed = oauthStateSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
    return parsed.success ? { ...parsed.data, returnTo: safeReturnTo(parsed.data.returnTo) } : null;
  } catch {
    return null;
  }
}
