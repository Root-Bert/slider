import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AuthProviders, LoginError, LoginProvider } from '@slider/shared';
import { emailVerifiedFalse, type IdTokenClaims } from '../auth/id-token';
import {
  buildAuthorizeUrl,
  createPkce,
  mapMicrosoftError,
  MicrosoftAuthError,
  type MicrosoftErrorKind,
} from '../auth/microsoft';
import { endSession, startSession } from '../auth/session';
import { optionalViewerMiddleware, type OptionalViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { notFound } from '../http/errors';
import { hasLogin } from '../config';
import {
  inviteTokenFromPath,
  linkIdentity,
  signInWithIdentity,
  type IdentityInput,
} from '../services/accounts';
import { microsoftNotConfigured } from '../sources/errors';

/** Short-lived cookies that carry PKCE state, nonce and `returnTo` from `/login` to `/callback`. */
export const MS_OAUTH_COOKIE = 'slider_ms_oauth';
const MS_COOKIE_PATH = '/api/auth/microsoft';
export const OIDC_COOKIE = 'slider_oidc';
export const GOOGLE_COOKIE = 'slider_google';
const COOKIE_MAX_AGE = 10 * 60;
/** Where "connect Microsoft for file access" returns to by default: the import page. */
const DEFAULT_RETURN_TO = '/neu';
/** The account page (`/konto`): shows `?linkError=` after a failed "Verbinden". */
const ACCOUNT_PATH = '/konto';
const DEFAULT_LOGIN_RETURN_TO = '/';

const oauthStateSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  nonce: z.string().optional(),
  returnTo: z.string(),
  /**
   * `login` signs someone in (BER-129); `connect` only stores Microsoft file access for the
   * account that is already signed in (`userId`). Cookies from before BER-129 are `connect`.
   */
  mode: z.enum(['login', 'connect']).default('connect'),
  userId: z.string().optional(),
  /** `picker`: the one-time consent to the personal-account file picker (BER-131). */
  access: z.enum(['read', 'picker']).optional(),
});
type OAuthState = z.infer<typeof oauthStateSchema>;

/**
 * Only same-origin paths – `//evil.com` or absolute URLs would make this an open redirect. URL
 * parsing drops tabs and newlines (`/\t/evil.com` → `//evil.com`), so control characters are out.
 */
export const safeReturnTo = (value: string | undefined, fallback = DEFAULT_RETURN_TO): string =>
  value &&
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !value.includes('\\') &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : fallback;

/** `email` claim or UPN; only the UPN is vouched for by the directory (its domain is verified). */
function microsoftIdentity(
  claims: IdTokenClaims,
  inviteToken: string | null,
): IdentityInput | null {
  if (typeof claims.tid !== 'string' || typeof claims.oid !== 'string') return null;
  const upn =
    typeof claims.preferred_username === 'string' && claims.preferred_username.includes('@')
      ? claims.preferred_username
      : null;
  const email = upn ?? (typeof claims.email === 'string' ? claims.email : null);
  return {
    provider: 'microsoft',
    subject: `${claims.tid}:${claims.oid}`,
    email,
    emailVerified: upn !== null,
    name: typeof claims.name === 'string' ? claims.name : null,
    inviteToken,
  };
}

/**
 * Login (BER-129) and Microsoft file access (BER-92).
 * - Microsoft: `/login` → Microsoft → `/callback`. Signed out it signs in (identity + Graph token
 *   in one go); signed in it connects file access and links the login to the current account.
 * - Google and OIDC: the same for Google and the configured SSO provider; signed in with
 *   `intent=connect` they link the provider to the account instead.
 * Every login ends in a session cookie and a redirect to `returnTo`; failures go to
 * `/login?error=<LoginError>`.
 */
export function authRoutes(deps: AppDeps) {
  const viewer = optionalViewerMiddleware(deps);
  const { config } = deps;

  const toWeb = (c: Context, path: string) => {
    const url = new URL(path, config.webOrigin);
    // Belt and braces against open redirects: never leave the web app's origin.
    const target = url.origin === new URL(config.webOrigin).origin ? url : new URL('/', url.origin);
    return c.redirect(target.toString(), 302);
  };

  /**
   * Back to the start page with the link prefilled and the reason, so A3 can explain it. A login
   * started in a deck (the sync banner's "sign in again") goes back to that deck instead; one
   * started anywhere else ("Verbinden" in /konto, the account menu) goes to /konto with
   * `?linkError=`, like the Google and SSO connects – the only page that explains it for everyone.
   */
  const connectFailed = (c: Context, returnTo: string, kind: MicrosoftErrorKind) => {
    const back = new URL(returnTo, config.webOrigin);
    if (back.pathname.startsWith('/d/')) {
      back.searchParams.set('msError', kind);
      return toWeb(c, back.pathname + back.search);
    }
    if (back.pathname !== DEFAULT_RETURN_TO) {
      return linkFailed(c, back.pathname === ACCOUNT_PATH ? returnTo : ACCOUNT_PATH, kind);
    }
    const target = new URL(DEFAULT_RETURN_TO, config.webOrigin);
    const link = back.searchParams.get('link');
    if (link) target.searchParams.set('link', link);
    target.searchParams.set('msError', kind);
    return toWeb(c, target.pathname + target.search);
  };

  const loginFailed = (c: Context, error: LoginError, returnTo?: string) =>
    toWeb(c, loginErrorPath(error, returnTo));

  /** Signs the account in on this browser. */
  const loggedIn = async (c: Context, userId: string, returnTo: string) => {
    await startSession(c, deps, userId);
    return toWeb(c, returnTo);
  };

  const writeState = (c: Context, name: string, path: string, payload: OAuthState) =>
    setSignedCookie(
      c,
      name,
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
      config.secret,
      {
        path,
        httpOnly: true,
        sameSite: 'Lax',
        secure: config.env === 'production',
        maxAge: COOKIE_MAX_AGE,
      },
    );

  const readState = async (c: Context, name: string, path: string) => {
    const raw = await getSignedCookie(c, config.secret, name);
    deleteCookie(c, name, { path });
    return raw ? parseState(raw) : null;
  };

  const OIDC_PROVIDERS = {
    google: {
      client: () => deps.google,
      cookie: GOOGLE_COOKIE,
      path: '/api/auth/google',
      notConfigured: 'Die Anmeldung mit Google ist nicht eingerichtet.',
    },
    oidc: {
      client: () => deps.oidc,
      cookie: OIDC_COOKIE,
      path: '/api/auth/oidc',
      notConfigured: 'Die Anmeldung per SSO ist nicht eingerichtet.',
    },
  } satisfies Record<OidcProviderId, unknown>;

  /**
   * `/login` of an OIDC provider. Signed out it signs in; signed in with `intent=connect` it links
   * the provider to the current account (/konto).
   */
  const oidcLogin = (id: OidcProviderId) => async (c: Context<OptionalViewerEnv>) => {
    const provider = OIDC_PROVIDERS[id];
    const client = provider.client();
    if (!client) throw notFound(provider.notConfigured);
    const current = c.var.viewer;
    const connect = c.req.query('intent') === 'connect' && current?.kind === 'owner';
    const returnTo = safeReturnTo(c.req.query('returnTo'), DEFAULT_LOGIN_RETURN_TO);
    const pkce = await createPkce();
    let url: string;
    try {
      url = await client.authorizeUrl(pkce);
    } catch (error) {
      deps.log.warn(`${id} discovery failed`, error);
      return connect ? linkFailed(c, returnTo, 'failed') : loginFailed(c, 'failed', returnTo);
    }
    await writeState(c, provider.cookie, provider.path, {
      state: pkce.state,
      verifier: pkce.verifier,
      nonce: pkce.nonce,
      returnTo,
      mode: connect ? 'connect' : 'login',
      userId: connect ? current.author.id : undefined,
    });
    return c.redirect(url, 302);
  };

  const oidcCallback = (id: OidcProviderId) => async (c: Context<OptionalViewerEnv>) => {
    const provider = OIDC_PROVIDERS[id];
    const client = provider.client();
    const saved = await readState(c, provider.cookie, provider.path);
    const query = c.req.query();
    const returnTo = saved?.returnTo ?? DEFAULT_LOGIN_RETURN_TO;
    const connect = saved?.mode === 'connect';
    const fail = (error: LoginError) =>
      connect ? linkFailed(c, returnTo, error) : loginFailed(c, error, returnTo);
    if (!client || !saved?.nonce || !query['state'] || query['state'] !== saved.state) {
      return fail('failed');
    }
    if (query['error']) {
      deps.log.warn(`${id} login failed: ${query['error']} ${query['error_description'] ?? ''}`);
      return fail(query['error'] === 'access_denied' ? 'denied' : 'failed');
    }
    if (!query['code']) return fail('failed');

    let claims: IdTokenClaims;
    try {
      claims = await client.exchangeCode(query['code'], saved.verifier, saved.nonce);
    } catch (error) {
      deps.log.warn(`${id} token exchange failed`, error);
      return fail('failed');
    }
    const identity = oidcIdentity(id, claims, inviteTokenFromPath(returnTo));
    if (!identity.ok) return fail(identity.error);

    if (connect) {
      const current = c.var.viewer;
      if (current?.kind !== 'owner' || current.author.id !== saved.userId) return fail('failed');
      const linked = await linkIdentity(deps, current.author.id, identity.value);
      if (!linked.ok) return fail(linked.error);
      return toWeb(c, returnTo);
    }
    const signIn = await signInWithIdentity(deps, identity.value);
    if (!signIn.ok) return loginFailed(c, signIn.error, returnTo);
    return loggedIn(c, signIn.user.id, returnTo);
  };

  /** Linking from /konto failed: back there with `?linkError=`. */
  const linkFailed = (c: Context, returnTo: string, error: LoginError) => {
    const back = new URL(returnTo, config.webOrigin);
    back.searchParams.set('linkError', error);
    return toWeb(c, back.pathname + back.search);
  };

  return (
    new Hono<OptionalViewerEnv>()
      .get('/auth/providers', (c) => {
        const providers: LoginProvider[] = [];
        if (config.microsoft) {
          providers.push({
            id: 'microsoft',
            label: 'Weiter mit Microsoft',
            kind: 'redirect',
            loginUrl: '/api/auth/microsoft/login',
          });
        }
        if (deps.google) {
          providers.push({
            id: 'google',
            label: 'Weiter mit Google',
            kind: 'redirect',
            loginUrl: '/api/auth/google/login',
          });
        }
        if (deps.oidc) {
          providers.push({
            id: 'oidc',
            label: deps.oidc.config.label,
            kind: 'redirect',
            loginUrl: '/api/auth/oidc/login',
          });
        }
        return c.json<AuthProviders>({
          providers,
          devLogin: config.auth.devLogin,
          signup: config.auth.signup,
          needsSetup: !config.auth.devLogin && !hasLogin(config),
        });
      })

      .post('/auth/logout', async (c) => {
        await endSession(c, deps);
        return c.body(null, 204);
      })

      // ── Microsoft ────────────────────────────────────────────────────────
      .get('/auth/microsoft/login', viewer, async (c) => {
        const microsoft = config.microsoft;
        if (!microsoft) {
          const error = microsoftNotConfigured();
          return c.json(error.toBody(), 503);
        }
        const current = c.var.viewer;
        const signedIn = current?.kind === 'owner' && c.req.query('intent') !== 'login';
        const pkce = await createPkce();
        const requested = c.req.query('access');
        // The picker consent only adds to a signed-in account's Microsoft connection.
        const access = requested === 'picker' && signedIn ? 'picker' : 'read';
        await writeState(c, MS_OAUTH_COOKIE, MS_COOKIE_PATH, {
          state: pkce.state,
          verifier: pkce.verifier,
          nonce: pkce.nonce,
          returnTo: safeReturnTo(
            c.req.query('returnTo'),
            signedIn ? DEFAULT_RETURN_TO : DEFAULT_LOGIN_RETURN_TO,
          ),
          mode: signedIn ? 'connect' : 'login',
          userId: signedIn ? current.author.id : undefined,
          access,
        });
        return c.redirect(buildAuthorizeUrl(microsoft, pkce, access), 302);
      })

      .get('/auth/microsoft/callback', viewer, async (c) => {
        const saved = await readState(c, MS_OAUTH_COOKIE, MS_COOKIE_PATH);
        const query = c.req.query();
        const mode = saved?.mode ?? 'connect';
        const returnTo = saved?.returnTo ?? DEFAULT_RETURN_TO;
        const fail = (kind: MicrosoftErrorKind) =>
          mode === 'login' ? loginFailed(c, kind, returnTo) : connectFailed(c, returnTo, kind);

        if (!saved || !query['state'] || query['state'] !== saved.state) return fail('failed');
        if (query['error']) {
          deps.log.warn(
            `Microsoft login failed: ${query['error']} ${query['error_description'] ?? ''}`,
          );
          return fail(mapMicrosoftError(query['error'], query['error_description']));
        }
        const code = query['code'];
        if (!code || !deps.microsoft.configured) return fail('failed');

        if (mode === 'connect') {
          const current = c.var.viewer;
          if (current?.kind !== 'owner' || (saved.userId && saved.userId !== current.author.id)) {
            return fail('failed');
          }
          try {
            if (saved.access === 'picker') {
              await deps.microsoft.completePickerConsent(current.author.id, code, saved.verifier);
            } else {
              const claims = await deps.microsoft.completeLogin(
                current.author.id,
                code,
                saved.verifier,
                saved.nonce ?? '',
              );
              // Also a login from now on – unless it already signs into another account (one
              // Microsoft account may give files to two accounts, but logs into only one).
              const identity = claims && microsoftIdentity(claims, null);
              if (identity) await linkIdentity(deps, current.author.id, identity);
            }
          } catch (error) {
            deps.log.warn('Microsoft token exchange failed', error);
            return fail(error instanceof MicrosoftAuthError ? error.kind : 'failed');
          }
          return toWeb(c, returnTo);
        }

        let result: Awaited<ReturnType<typeof deps.microsoft.exchangeLogin>>;
        try {
          result = await deps.microsoft.exchangeLogin(code, saved.verifier, saved.nonce ?? '');
        } catch (error) {
          deps.log.warn('Microsoft login failed', error);
          return fail(error instanceof MicrosoftAuthError ? error.kind : 'failed');
        }
        const identity = microsoftIdentity(result.claims, inviteTokenFromPath(returnTo));
        if (!identity) return loginFailed(c, 'failed', returnTo);
        const signIn = await signInWithIdentity(deps, identity);
        if (!signIn.ok) return loginFailed(c, signIn.error, returnTo);
        try {
          await deps.microsoft.saveTokens(signIn.user.id, result.tokens);
        } catch (error) {
          // Login works without file access; OneDrive imports will ask again.
          deps.log.warn('Could not store the Microsoft token after login', error);
        }
        return loggedIn(c, signIn.user.id, returnTo);
      })

      // ── Google and generic OpenID Connect ────────────────────────────────
      .get('/auth/google/login', viewer, oidcLogin('google'))
      .get('/auth/google/callback', viewer, oidcCallback('google'))
      .get('/auth/oidc/login', viewer, oidcLogin('oidc'))
      .get('/auth/oidc/callback', viewer, oidcCallback('oidc'))
  );
}

type OidcProviderId = 'google' | 'oidc';

/** `/login?error=…` (with `returnTo` unless it is the default). */
export function loginErrorPath(error: LoginError, returnTo?: string): string {
  const target = new URLSearchParams({ error });
  if (returnTo && returnTo !== DEFAULT_LOGIN_RETURN_TO) target.set('returnTo', returnTo);
  return `/login?${target.toString()}`;
}

/**
 * The identity of an OIDC login. Google: subject = `sub`, the address must be verified
 * (`email_verified === true`); the Workspace domain (`hd`) is not required. Generic OIDC: only
 * an explicit `email_verified: false` is refused, as some providers leave the claim out.
 */
function oidcIdentity(
  id: OidcProviderId,
  claims: IdTokenClaims,
  inviteToken: string | null,
): { ok: true; value: IdentityInput } | { ok: false; error: LoginError } {
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) {
    return { ok: false, error: 'no_email' };
  }
  const verified = id === 'google' ? claims.email_verified === true : !emailVerifiedFalse(claims);
  if (!verified) return { ok: false, error: 'email_unverified' };
  return {
    ok: true,
    value: {
      provider: id,
      subject: claims.sub,
      email: claims.email,
      emailVerified: true,
      name:
        typeof claims.name === 'string'
          ? claims.name
          : typeof claims.preferred_username === 'string'
            ? claims.preferred_username
            : null,
      inviteToken,
    },
  };
}

function parseState(raw: string): OAuthState | null {
  try {
    const parsed = oauthStateSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
    return parsed.success ? { ...parsed.data, returnTo: safeReturnTo(parsed.data.returnTo) } : null;
  } catch {
    return null;
  }
}
