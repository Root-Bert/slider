import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  startEmailLoginInputSchema,
  verifyEmailCodeInputSchema,
  type AuthProviders,
  type LoginError,
  type LoginProvider,
  type LoginResult,
} from '@slider/shared';
import { emailVerifiedFalse, type IdTokenClaims } from '../auth/id-token';
import {
  buildAuthorizeUrl,
  createPkce,
  mapMicrosoftError,
  MicrosoftAuthError,
  type MicrosoftErrorKind,
} from '../auth/microsoft';
import { endSession, hashToken, newSecretToken, startSession } from '../auth/session';
import { clearGuestCookie, optionalViewerMiddleware, type OptionalViewerEnv } from '../auth/viewer';
import { loginTokens } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { clientAddress, fixedWindow, rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { hasLogin } from '../config';
import { DevMailer, loginMail } from '../mail/mailer';
import {
  inviteTokenFromPath,
  linkIdentity,
  mayReceiveLoginLink,
  normalizeEmail,
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
const DEFAULT_LOGIN_RETURN_TO = '/';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Wrong codes per mail before it is burned (a 6-digit code: 5 in a million per mail). */
export const MAX_CODE_ATTEMPTS = 5;
/** `newSecretToken()`: 32 bytes base64url. Anything else is not looked up (nor echoed). */
const TOKEN_PATTERN = /^[\w-]{43}$/;
type LoginTokenRow = typeof loginTokens.$inferSelect;

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
  access: z.enum(['read', 'write', 'picker']).optional(),
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
 *   in one go); signed in it only connects file access to the current account.
 * - Google and OIDC: the same for Google and the configured SSO provider; signed in with
 *   `intent=connect` they link the provider to the account instead.
 * - E-mail: `/email/start` mails a one-time link to `/email/verify` and a 6-digit code for
 *   `/email/code`.
 * Every login ends in a session cookie and a redirect to `returnTo`; failures go to
 * `/login?error=<LoginError>`.
 */
export function authRoutes(deps: AppDeps) {
  const viewer = optionalViewerMiddleware(deps);
  const { config } = deps;
  const emailStartIpLimit = rateLimit({ limit: 10, windowMs: 15 * 60_000, clock: deps.clock });
  const emailStartPerAddress = fixedWindow({ limit: 3, windowMs: 15 * 60_000, clock: deps.clock });
  const verifyLimit = rateLimit({ limit: 30, windowMs: 60_000, clock: deps.clock });
  /** Codes per IP; the per-mail attempt limit is the real guard. */
  const codeLimit = rateLimit({ limit: 30, windowMs: 15 * 60_000, clock: deps.clock });

  /** 303 after a POST, so the browser follows with a GET. */
  const toWeb = (c: Context, path: string, status: 302 | 303 = 302) => {
    const url = new URL(path, config.webOrigin);
    // Belt and braces against open redirects: never leave the web app's origin.
    const target = url.origin === new URL(config.webOrigin).origin ? url : new URL('/', url.origin);
    return c.redirect(target.toString(), status);
  };

  /**
   * Back to the start page with the link prefilled and the reason, so A3 can explain it. A write
   * login started in a deck (BER-128) goes back to that deck instead – without `insertAfter`, so
   * nothing is inserted – and the viewer explains it.
   */
  const connectFailed = (c: Context, returnTo: string, kind: MicrosoftErrorKind) => {
    const back = new URL(returnTo, config.webOrigin);
    if (back.pathname.startsWith('/d/')) {
      back.searchParams.delete('insertAfter');
      back.searchParams.set('msError', kind);
      return toWeb(c, back.pathname + back.search);
    }
    const target = new URL(DEFAULT_RETURN_TO, config.webOrigin);
    const link = back.searchParams.get('link');
    if (link) target.searchParams.set('link', link);
    target.searchParams.set('msError', kind);
    return toWeb(c, target.pathname + target.search);
  };

  const loginFailed = (c: Context, error: LoginError, returnTo?: string, status: 302 | 303 = 302) =>
    toWeb(c, loginErrorPath(error, returnTo), status);

  /** Signs the account in on this browser and leaves any guest session. */
  const loggedIn = async (
    c: Context,
    userId: string,
    returnTo: string,
    status: 302 | 303 = 302,
  ) => {
    clearGuestCookie(c);
    await startSession(c, deps, userId);
    return toWeb(c, returnTo, status);
  };

  /** JSON logins (code, passkey): the session cookie plus where the web app navigates next. */
  const loggedInJson = async (c: Context, userId: string, returnTo: string) => {
    clearGuestCookie(c);
    await startSession(c, deps, userId);
    return c.json<LoginResult>({ redirectTo: safeReturnTo(returnTo, DEFAULT_LOGIN_RETURN_TO) });
  };

  /** A magic-link token that is still usable – without using it up. */
  const findLoginToken = async (
    token: string,
  ): Promise<
    | { ok: true; row: LoginTokenRow }
    | { ok: false; error: 'link_invalid' | 'link_expired'; returnTo?: string }
  > => {
    const [row] = TOKEN_PATTERN.test(token)
      ? await deps.db
          .select()
          .from(loginTokens)
          .where(eq(loginTokens.tokenHash, hashToken(token)))
      : [];
    if (!row || row.usedAt) return { ok: false, error: 'link_invalid' };
    if (row.expiresAt.getTime() <= deps.clock.now().getTime()) {
      return { ok: false, error: 'link_expired', returnTo: row.returnTo };
    }
    return { ok: true, row };
  };

  /**
   * The confirm form posts from our own origin. `Sec-Fetch-Site` is authoritative where sent;
   * `Origin` may be `null` (the page sets `Referrer-Policy: no-referrer`) but never foreign.
   */
  const sameOriginPost = (c: Context) => {
    const site = c.req.header('sec-fetch-site');
    if (site && site !== 'same-origin') return false;
    const origin = c.req.header('origin');
    return (
      !origin ||
      origin === 'null' ||
      origin === new URL(config.webOrigin).origin ||
      origin === new URL(c.req.url).origin
    );
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

  /** Only in development without SMTP. */
  const devMailbox = () =>
    config.env === 'development' && deps.mailer instanceof DevMailer ? deps.mailer : null;

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
          magicLink: deps.mailer.configured,
          devMailbox: devMailbox() !== null,
          devLogin: config.auth.devLogin,
          signup: config.auth.signup,
          needsSetup: !config.auth.devLogin && !hasLogin(config),
        });
      })

      .post('/auth/logout', async (c) => {
        await endSession(c, deps);
        clearGuestCookie(c);
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
        const access =
          requested === 'write' ? 'write' : requested === 'picker' && signedIn ? 'picker' : 'read';
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
              await deps.microsoft.completeLogin(current.author.id, code, saved.verifier);
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

      // ── Magic link ───────────────────────────────────────────────────────
      /** Always 204, whether or not a mail went out – nobody learns which addresses have accounts. */
      .post('/auth/email/start', emailStartIpLimit, async (c) => {
        if (!deps.mailer.configured) {
          throw notFound('Die Anmeldung per E-Mail ist nicht eingerichtet.');
        }
        const input = await readJson(c, startEmailLoginInputSchema);
        const email = normalizeEmail(input.email);
        const returnTo = safeReturnTo(input.returnTo, DEFAULT_LOGIN_RETURN_TO);
        if (!emailStartPerAddress.hit(email).allowed) {
          deps.log.warn(`Magic link for ${email} rate limited (${clientAddress(c)})`);
          return c.body(null, 204);
        }
        if (!(await mayReceiveLoginLink(deps, email, inviteTokenFromPath(returnTo)))) {
          deps.log.info(`Magic link for ${email} not sent: no account and no invitation`);
          return c.body(null, 204);
        }
        const token = newSecretToken();
        const code = newLoginCode();
        const id = crypto.randomUUID();
        const now = deps.clock.now();
        await deps.db.insert(loginTokens).values({
          id,
          email,
          tokenHash: hashToken(token),
          codeHash: codeHash(config.secret, id, code),
          returnTo,
          createdAt: now,
          expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
        });
        const url = new URL('/api/auth/email/verify', config.webOrigin);
        url.searchParams.set('token', token);
        try {
          await deps.mailer.send(loginMail({ to: email, code, url: url.toString() }));
        } catch (error) {
          deps.log.warn(`Magic link mail to ${email} failed`, error);
        }
        return c.body(null, 204);
      })

      /**
       * The link from the mail. Mail scanners (Outlook Safe Links & co.) open every link, so this
       * only shows a confirm page; the button POSTs the token and only that signs in.
       */
      .get('/auth/email/verify', verifyLimit, async (c) => {
        const token = c.req.query('token') ?? '';
        const found = await findLoginToken(token);
        if (!found.ok) return loginFailed(c, found.error, found.returnTo);
        return confirmPage(c, token, found.row.email);
      })

      .post('/auth/email/verify', verifyLimit, async (c) => {
        // Login CSRF: only our own confirm page may submit (the token is the secret, but a
        // foreign page could otherwise sign a victim into the attacker's account).
        if (!sameOriginPost(c)) return loginFailed(c, 'link_invalid', undefined, 303);
        const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
        const token = typeof body['token'] === 'string' ? body['token'] : '';
        const found = await findLoginToken(token);
        if (!found.ok) return loginFailed(c, found.error, found.returnTo, 303);
        const { row } = found;
        // Single use, even when two clicks race.
        const [claimed] = await deps.db
          .update(loginTokens)
          .set({ usedAt: deps.clock.now() })
          .where(and(eq(loginTokens.id, row.id), isNull(loginTokens.usedAt)))
          .returning({ id: loginTokens.id });
        if (!claimed) return loginFailed(c, 'link_invalid', undefined, 303);

        const signIn = await signInWithIdentity(deps, {
          provider: 'email',
          subject: row.email,
          email: row.email,
          emailVerified: true,
          name: null,
          inviteToken: inviteTokenFromPath(row.returnTo),
        });
        if (!signIn.ok) return loginFailed(c, signIn.error, row.returnTo, 303);
        return loggedIn(
          c,
          signIn.user.id,
          safeReturnTo(row.returnTo, DEFAULT_LOGIN_RETURN_TO),
          303,
        );
      })

      /**
       * The 6-digit code from the same mail, typed into the login page. Any open mail of the
       * address counts; every wrong code counts against all of them, and after
       * {@link MAX_CODE_ATTEMPTS} they are burned.
       */
      .post('/auth/email/code', codeLimit, async (c) => {
        if (!sameOriginPost(c)) throw badRequest('Ungültige Anfrage.');
        const input = await readJson(c, verifyEmailCodeInputSchema);
        const email = normalizeEmail(input.email);
        const now = deps.clock.now();
        // Count the attempt before comparing, in one statement: concurrent guesses each take a
        // slot under the row lock, so no more than MAX_CODE_ATTEMPTS codes are ever compared.
        const open = await deps.db
          .update(loginTokens)
          .set({ codeAttempts: sql`${loginTokens.codeAttempts} + 1` })
          .where(
            and(
              eq(loginTokens.email, email),
              isNull(loginTokens.usedAt),
              isNotNull(loginTokens.codeHash),
              gt(loginTokens.expiresAt, now),
              lt(loginTokens.codeAttempts, MAX_CODE_ATTEMPTS),
            ),
          )
          .returning();
        const match = open.find((row) =>
          sameHash(row.codeHash ?? '', codeHash(config.secret, row.id, input.code)),
        );
        if (!match) {
          if (open.length > 0) {
            const burned = await deps.db
              .update(loginTokens)
              .set({ usedAt: now })
              .where(
                and(
                  inArray(
                    loginTokens.id,
                    open.map((row) => row.id),
                  ),
                  isNull(loginTokens.usedAt),
                  gte(loginTokens.codeAttempts, MAX_CODE_ATTEMPTS),
                ),
              )
              .returning({ id: loginTokens.id });
            if (burned.length === open.length) {
              deps.log.warn(`Login codes for ${email} burned after too many attempts`);
              throw badRequest('Zu viele falsche Versuche. Fordere bitte einen neuen Code an.');
            }
          }
          throw badRequest('Der Code stimmt nicht oder ist abgelaufen.');
        }
        // Single use, even when the link and the code race.
        const [claimed] = await deps.db
          .update(loginTokens)
          .set({ usedAt: now })
          .where(and(eq(loginTokens.id, match.id), isNull(loginTokens.usedAt)))
          .returning({ id: loginTokens.id });
        if (!claimed) throw badRequest('Der Code stimmt nicht oder ist abgelaufen.');

        const signIn = await signInWithIdentity(deps, {
          provider: 'email',
          subject: match.email,
          email: match.email,
          emailVerified: true,
          name: null,
          inviteToken: inviteTokenFromPath(match.returnTo),
        });
        if (!signIn.ok) {
          return c.json<LoginResult>({ redirectTo: loginErrorPath(signIn.error, match.returnTo) });
        }
        return loggedInJson(c, signIn.user.id, match.returnTo);
      })

      // ── Development mailbox ──────────────────────────────────────────────
      /** Development without SMTP only: the last mails (links and codes), newest first. */
      .get('/dev/mails', (c) => {
        const mailbox = devMailbox();
        if (!mailbox) throw notFound();
        c.header('Cache-Control', 'no-store');
        return c.json(mailbox.list());
      })
  );
}

type OidcProviderId = 'google' | 'oidc';

/** `/login?error=…` (with `returnTo` unless it is the default). */
export function loginErrorPath(error: LoginError, returnTo?: string): string {
  const target = new URLSearchParams({ error });
  if (returnTo && returnTo !== DEFAULT_LOGIN_RETURN_TO) target.set('returnTo', returnTo);
  return `/login?${target.toString()}`;
}

/** A uniformly random 6-digit code, leading zeros included. */
const newLoginCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');

/**
 * Keyed with SLIDER_SECRET and bound to the row: a leaked database does not give the codes away
 * (a plain hash of a 6-digit number would be reversed instantly).
 */
const codeHash = (secret: string, id: string, code: string) =>
  createHmac('sha256', secret).update(`login-code:${id}:${code}`).digest('hex');

const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

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

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

/**
 * Self-contained confirm page for a magic link: one button that POSTs the token. No script, no
 * external resources; not cached, not framed, no referrer (the URL carries the token).
 */
function confirmPage(c: Context, token: string, email: string) {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  return c.html(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Bei Slider anmelden</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f4; --card: #fff; --text: #1b1b1a; --muted: #6b6b66; --accent: #1b1b1a; --on-accent: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141413; --card: #1f1f1e; --text: #f0efea; --muted: #a3a29c; --accent: #f0efea; --on-accent: #141413; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 380px; background: var(--card); border-radius: 12px; padding: 32px 24px; text-align: center; box-shadow: 0 1px 3px rgb(0 0 0 / 0.08); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 24px; color: var(--muted); overflow-wrap: anywhere; }
  button { width: 100%; padding: 12px 16px; border: 0; border-radius: 8px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Bei Slider anmelden</h1>
  <p>als ${escapeHtml(email)}</p>
  <form method="post" action="/api/auth/email/verify">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <button type="submit">Anmelden</button>
  </form>
</main>
</body>
</html>`);
}

function parseState(raw: string): OAuthState | null {
  try {
    const parsed = oauthStateSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
    return parsed.success ? { ...parsed.data, returnTo: safeReturnTo(parsed.data.returnTo) } : null;
  } catch {
    return null;
  }
}
