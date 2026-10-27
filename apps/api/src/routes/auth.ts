import { randomInt } from 'node:crypto';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  confirmEmailLoginInputSchema,
  confirmNextcloudSignUpInputSchema,
  discoverSsoInputSchema,
  startEmailLoginInputSchema,
  startNextcloudSignInInputSchema,
  type AuthProviders,
  type EmailLoginResult,
  type LoginError,
  type LoginProvider,
  type LoginResult,
  type NextcloudLoginStart,
  type NextcloudSignInPoll,
  type SsoLogin,
} from '@slider/shared';
import {
  GoogleAuthError,
  googleDriveAuthorizeUrl,
  googleDriveConnectUrl,
  googleNotConfigured,
  googlePickAuthorizeUrl,
} from '../auth/google';
import { emailVerifiedFalse, type IdTokenClaims } from '../auth/id-token';
import type { InstanceGate } from '../auth/instance-gate';
import {
  buildAuthorizeUrl,
  createPkce,
  mapMicrosoftError,
  MicrosoftAuthError,
  type MicrosoftErrorKind,
} from '../auth/microsoft';
import { browserKey, readSignedCookie, removeCookie, writeSignedCookie } from '../auth/cookies';
import {
  DEFAULT_LOGIN_RETURN_TO,
  loginErrorPath,
  loginPath,
  nextcloudConfirmPath,
} from '../auth/login-paths';
import {
  exchangeNextcloudCode,
  nextcloudAuthorizeUrl,
  type NextcloudUser,
} from '../auth/nextcloud-login';
import { endSession, startSession } from '../auth/session';
import { optionalViewerMiddleware, type OptionalViewerEnv } from '../auth/viewer';
import { workspaceSsoClient } from '../auth/workspace-sso';
import type { AppDeps } from '../deps';
import { ApiError, notFound } from '../http/errors';
import { assertWithinLimit, clientAddress, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { hasLogin } from '../config';
import {
  inviteTokenFromPath,
  linkIdentity,
  normalizeEmail,
  signInWithCompanySso,
  signInWithIdentity,
  signUpBlocked,
  type IdentityInput,
} from '../services/accounts';
import {
  EMAIL_LOGIN_TTL_MS,
  emailIdentity,
  redeemEmailLogin,
  sendEmailLogin,
} from '../services/email-login';
import {
  NEXTCLOUD_SIGNUP_TTL_MS,
  resolveNextcloudSignup,
  sendNextcloudSignupMail,
} from '../services/nextcloud-signup';
import { userEmail } from '../services/users';
import {
  anyWorkspaceSso,
  findSsoForEmail,
  findSsoForWorkspace,
  getRole,
  joinByDomain,
} from '../services/workspaces';
import { microsoftNotConfigured } from '../sources/errors';

/**
 * Short-lived cookies that carry PKCE state, nonce and `returnTo` from `/login` to `/callback`.
 * `Path=/` and told apart by name only, so production can use `__Host-` names (../auth/cookies).
 */
export const MS_OAUTH_COOKIE = 'slider_ms_oauth';
export const OIDC_COOKIE = 'slider_oidc';
export const GOOGLE_COOKIE = 'slider_google';
/** "Connect Google Drive" (BER-119): the same callback as the login, told apart by this cookie. */
export const GOOGLE_DRIVE_COOKIE = 'slider_google_drive';
export const NEXTCLOUD_COOKIE = 'slider_nextcloud';
/** A workspace's company login (BER-162); the workspace is in the cookie. */
export const SSO_COOKIE = 'slider_sso';
/** This browser's key for Login Flow v2 sign-ins: only the browser that started one picks it up. */
export const NEXTCLOUD_FLOW_COOKIE = 'slider_nc_flow';
/**
 * This browser's key for confirming a new account through any Nextcloud: the mailed link only
 * works where the sign-in started (`services/nextcloud-signup`). Lives as long as a link can.
 */
export const NEXTCLOUD_SIGNUP_COOKIE = 'slider_nc_signup';
/**
 * A sign-in is picked up for 5 minutes only (Nextcloud keeps its link open for 20): a grant link
 * someone was talked into confirming later signs nobody in.
 */
export const NEXTCLOUD_FLOW_TTL_MS = 5 * 60 * 1000;
/** Sign-in flows per client address and hour: each makes the server call an address it was given. */
const NEXTCLOUD_FLOWS_PER_HOUR = 20;
/**
 * Company-login lookups per client address and hour: each says whether a domain has one. A whole
 * company behind one NAT may sign in at once when it rolls its login out.
 */
export const SSO_DISCOVERIES_PER_HOUR = 600;
/** Company-login starts per client address and hour: each fetches the workspace's discovery. */
export const SSO_LOGINS_PER_HOUR = 600;
/**
 * Confirmation mails per address and hour: whoever runs a Nextcloud can give it any address, so
 * without this a Nextcloud's owner could fill a stranger's mailbox from Slider.
 */
const NEXTCLOUD_SIGNUP_MAILS_PER_ADDRESS = 3;
/**
 * This browser's key for login links by mail (BER-168): a link only works where it was asked
 * for (`services/email-login`).
 */
export const EMAIL_LOGIN_COOKIE = 'slider_email_login';
/** Login links per address and hour: anyone can type a stranger's address. */
const EMAIL_LOGIN_MAILS_PER_ADDRESS = 5;
/** Login links per client address and hour; a company behind one NAT signs in now and then. */
const EMAIL_LOGIN_MAILS_PER_CLIENT = 30;
const COOKIE_MAX_AGE = 10 * 60;
/** Where "connect Microsoft for file access" returns to by default: the import page. */
const DEFAULT_RETURN_TO = '/neu';
/** The account page (`/konto`): shows `?linkError=` after a failed "Verbinden". */
const ACCOUNT_PATH = '/konto';

const oauthStateSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  nonce: z.string().optional(),
  returnTo: z.string(),
  /**
   * `login` signs someone in (BER-129); `connect` only stores Microsoft file access for the
   * account that is already signed in (`userId`). Cookies from before BER-129 are `connect`.
   * `pick`: back from Google's picker page with the files picked (BER-158).
   */
  mode: z.enum(['login', 'connect', 'pick']).default('connect'),
  userId: z.string().optional(),
  /** `picker`: the one-time consent to the personal-account file picker (BER-131). */
  access: z.enum(['read', 'picker']).optional(),
  /** The Microsoft connection being renewed (`?connection=`): the picker consent is for it. */
  connectionId: z.string().optional(),
  /** Company login (BER-162): whose. */
  workspaceId: z.string().optional(),
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

/**
 * `email` claim or UPN; only the UPN is vouched for by the directory (its domain is verified).
 * In the personal-accounts tenant it is only the address the account was registered with: it
 * signs in, but its domain counts for no company workspace (`vouchesForDomain`).
 */
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
export function authRoutes(deps: AppDeps, gate: InstanceGate) {
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

  const writeState = (c: Context, name: string, payload: OAuthState) =>
    writeSignedCookie(c, config, name, Buffer.from(JSON.stringify(payload)).toString('base64url'), {
      sameSite: 'Lax',
      maxAge: COOKIE_MAX_AGE,
    });

  const readState = async (c: Context, name: string) => {
    const raw = await readSignedCookie(c, config, name);
    removeCookie(c, config, name);
    return raw ? parseState(raw) : null;
  };

  const OIDC_PROVIDERS = {
    google: {
      client: () => deps.google,
      cookie: GOOGLE_COOKIE,
      notConfigured: 'Die Anmeldung mit Google ist nicht eingerichtet.',
    },
    oidc: {
      client: () => deps.oidc,
      cookie: OIDC_COOKIE,
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
    await writeState(c, provider.cookie, {
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
    const saved = await readState(c, provider.cookie);
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

  /** Login Flow v2 sign-ins in progress: where they return to, and for a link whose account. */
  const nextcloudFlows = new Map<
    string,
    { returnTo: string; linkTo: string | null; expiresAt: number }
  >();
  const nextcloudFlowLimit = fixedWindow({
    limit: NEXTCLOUD_FLOWS_PER_HOUR,
    windowMs: 60 * 60_000,
    clock: deps.clock,
  });
  const ssoDiscoveryLimit = fixedWindow({
    limit: SSO_DISCOVERIES_PER_HOUR,
    windowMs: 60 * 60_000,
    clock: deps.clock,
  });
  const ssoLoginLimit = fixedWindow({
    limit: SSO_LOGINS_PER_HOUR,
    windowMs: 60 * 60_000,
    clock: deps.clock,
  });
  const nextcloudSignupMailLimit = fixedWindow({
    limit: NEXTCLOUD_SIGNUP_MAILS_PER_ADDRESS,
    windowMs: 60 * 60_000,
    clock: deps.clock,
  });

  /**
   * A new account through a Nextcloud: its mailbox confirms the address first
   * (`services/nextcloud-signup`). `null`: mailed – or over the limit, where nothing is sent and
   * the answer stays the same, as the links mailed before still work. Else why not.
   */
  const mailNextcloudSignup = async (
    c: Context,
    identity: IdentityInput,
    returnTo: string,
    server: string,
  ): Promise<LoginError | null> => {
    const blocked = await signUpBlocked(deps, identity);
    if (blocked) return blocked;
    if (!deps.mailer.configured) return 'mail_unavailable';
    const browser = await readSignedCookie(c, config, NEXTCLOUD_SIGNUP_COOKIE);
    if (!identity.email || !browser) return 'failed';
    if (nextcloudSignupMailLimit.hit(normalizeEmail(identity.email)).allowed) {
      const sent = await sendNextcloudSignupMail(deps, { identity, returnTo, server, browser });
      if (!sent) return 'failed';
    }
    return null;
  };
  const emailLoginAddressLimit = fixedWindow({
    limit: EMAIL_LOGIN_MAILS_PER_ADDRESS,
    windowMs: 60 * 60_000,
    clock: deps.clock,
  });
  const emailLoginClientLimit = fixedWindow({
    limit: EMAIL_LOGIN_MAILS_PER_CLIENT,
    windowMs: 60 * 60_000,
    clock: deps.clock,
  });
  const linkErrorPath = (returnTo: string, error: LoginError) => {
    const back = new URL(returnTo, config.webOrigin);
    back.searchParams.set('linkError', error);
    return back.pathname + back.search;
  };

  return (
    new Hono<OptionalViewerEnv>()
      .get('/auth/providers', async (c) => {
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
        if (config.nextcloud.server && config.nextcloud.login) {
          providers.push({
            id: 'nextcloud',
            label: 'Weiter mit Nextcloud',
            kind: 'redirect',
            loginUrl: '/api/auth/nextcloud/login',
          });
        }
        return c.json<AuthProviders>({
          providers,
          devLogin: config.auth.devLogin,
          // No instance admin yet: whoever typed in the setup token signs up, to claim it.
          signup: config.auth.devLogin || (await gate.claimed()) ? config.auth.signup : 'open',
          needsSetup: !config.auth.devLogin && !hasLogin(config),
          setupPending: await gate.setupPending(c),
          nextcloudAnyServer: config.nextcloud.loginAnyServer,
          googleDrive: config.googleDrive !== null,
          sso: await anyWorkspaceSso(deps),
          emailLogin: deps.mailer.configured,
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
        // Renewing one of my connections: Microsoft preselects that account. Anyone else's
        // connection id is ignored.
        const connectionParam = c.req.query('connection');
        const connection =
          signedIn && connectionParam
            ? await deps.microsoft.findConnection(current.author.id, connectionParam)
            : null;
        await writeState(c, MS_OAUTH_COOKIE, {
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
          connectionId: connection?.id,
        });
        return c.redirect(buildAuthorizeUrl(microsoft, pkce, access, connection?.account), 302);
      })

      .get('/auth/microsoft/callback', viewer, async (c) => {
        const saved = await readState(c, MS_OAUTH_COOKIE);
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
              await deps.microsoft.completePickerConsent(
                current.author.id,
                saved.connectionId,
                code,
                saved.verifier,
              );
            } else {
              // A new connection, or the one of the same Microsoft account refreshed.
              const { claims } = await deps.microsoft.completeLogin(
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
          await deps.microsoft.saveTokens(signIn.user.id, result.tokens, result.claims);
        } catch (error) {
          // Login works without file access; OneDrive imports will ask again.
          deps.log.warn('Could not store the Microsoft token after login', error);
        }
        return loggedIn(c, signIn.user.id, returnTo);
      })

      // ── Google and generic OpenID Connect ────────────────────────────────
      .get('/auth/google/login', viewer, oidcLogin('google'))
      // Google Drive (BER-119): signed in only; `drive.file` and a refresh token for the files
      // the person picks. Comes back through the login's callback.
      .get('/auth/google/drive', viewer, async (c) => {
        const drive = config.googleDrive;
        if (!drive) throw googleNotConfigured();
        const current = c.var.viewer;
        const returnTo = safeReturnTo(c.req.query('returnTo'));
        if (current?.kind !== 'owner') {
          return toWeb(c, loginPath(returnTo));
        }
        // Renewing one of my connections: Google preselects that account.
        const connectionParam = c.req.query('connection');
        const connection = connectionParam
          ? await deps.googleDrive.findConnection(current.author.id, connectionParam)
          : null;
        const pkce = await createPkce();
        await writeState(c, GOOGLE_DRIVE_COOKIE, {
          state: pkce.state,
          verifier: pkce.verifier,
          nonce: pkce.nonce,
          returnTo,
          mode: 'connect',
          userId: current.author.id,
        });
        return c.redirect(googleDriveAuthorizeUrl(drive, pkce, connection?.account), 302);
      })
      // Google's file picker as its own page (BER-158), for a connected account: back through the
      // login's callback to `returnTo` with `googlePicked` and `googleConnection`. `fileId`: only
      // that file (a pasted link). Without a connection, connecting comes first; `?google=pick`
      // brings the person here again afterwards.
      .get('/auth/google/pick', viewer, async (c) => {
        const drive = config.googleDrive;
        if (!drive) throw googleNotConfigured();
        const current = c.var.viewer;
        const returnTo = safeReturnTo(c.req.query('returnTo'), '/neu');
        if (current?.kind !== 'owner') {
          return toWeb(c, loginPath(returnTo));
        }
        const fileParam = c.req.query('fileId');
        const fileId = fileParam && /^[A-Za-z0-9_-]{1,200}$/.test(fileParam) ? fileParam : null;
        const userId = current.author.id;
        const requested = c.req.query('connection');
        const connectionId = requested ?? (await deps.googleDrive.connectionIds(userId))[0];
        const connection = connectionId
          ? await deps.googleDrive.findConnection(userId, connectionId)
          : null;
        if (!connection?.refreshToken) {
          const again = new URL(returnTo, config.webOrigin);
          again.searchParams.set('google', 'pick');
          if (fileId) again.searchParams.set('googleFile', fileId);
          return c.redirect(
            googleDriveConnectUrl(again.pathname + again.search, connection?.id),
            302,
          );
        }
        const pkce = await createPkce();
        await writeState(c, GOOGLE_DRIVE_COOKIE, {
          state: pkce.state,
          verifier: pkce.verifier,
          returnTo,
          mode: 'pick',
          userId,
        });
        return c.redirect(
          googlePickAuthorizeUrl(drive, pkce, { loginHint: connection.account, fileId }),
          302,
        );
      })
      .get('/auth/google/callback', viewer, async (c) => {
        const query = c.req.query();
        const drive = await readSignedCookie(c, config, GOOGLE_DRIVE_COOKIE);
        const saved = drive ? parseState(drive) : null;
        if (!saved || !query['state'] || query['state'] !== saved.state) {
          return oidcCallback('google')(c);
        }
        removeCookie(c, config, GOOGLE_DRIVE_COOKIE);
        const fail = (kind: string) => {
          const back = new URL(saved.returnTo, config.webOrigin);
          back.searchParams.set('googleError', kind);
          return toWeb(c, back.pathname + back.search);
        };
        if (query['error']) {
          // Closing Google's picker (or its consent) just leads back.
          if (saved.mode === 'pick' && query['error'] === 'access_denied') {
            return toWeb(c, saved.returnTo);
          }
          deps.log.warn(`Google Drive connect failed: ${query['error']}`);
          return fail(query['error'] === 'access_denied' ? 'denied' : 'failed');
        }
        const current = c.var.viewer;
        if (!query['code'] || current?.kind !== 'owner' || current.author.id !== saved.userId) {
          return fail('failed');
        }
        if (saved.mode === 'pick') {
          const [fileId] = (query['picked_file_ids'] ?? '').split(',');
          if (!fileId || !/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) return toWeb(c, saved.returnTo);
          let connectionId: string;
          try {
            connectionId = await deps.googleDrive.completePick(
              current.author.id,
              query['code'],
              saved.verifier,
            );
          } catch (error) {
            deps.log.warn('Google Drive pick failed', error);
            return fail(error instanceof GoogleAuthError ? error.kind : 'failed');
          }
          const back = new URL(saved.returnTo, config.webOrigin);
          back.searchParams.set('googlePicked', fileId);
          back.searchParams.set('googleConnection', connectionId);
          return toWeb(c, back.pathname + back.search);
        }
        try {
          const { claims } = await deps.googleDrive.completeConnect(
            current.author.id,
            query['code'],
            saved.verifier,
            saved.nonce ?? '',
          );
          // Also a login from now on – unless it already signs into another account.
          const identity = oidcIdentity('google', claims, null);
          if (identity.ok) await linkIdentity(deps, current.author.id, identity.value);
        } catch (error) {
          deps.log.warn('Google Drive connect failed', error);
          return fail(error instanceof GoogleAuthError ? error.kind : 'failed');
        }
        return toWeb(c, saved.returnTo);
      })
      .get('/auth/oidc/login', viewer, oidcLogin('oidc'))
      .get('/auth/oidc/callback', viewer, oidcCallback('oidc'))

      // ── Company login of a workspace (BER-162) ───────────────────────────
      /** The address typed on the login page → its workspace's company login, if any. */
      .post('/auth/sso/discover', async (c) => {
        assertWithinLimit(
          c,
          ssoDiscoveryLimit.hit(clientAddress(c)),
          'Zu viele Anmeldeversuche. Bitte versuch es später noch einmal.',
        );
        const { email } = await readJson(c, discoverSsoInputSchema);
        const found = await findSsoForEmail(deps, email);
        if (!found) {
          throw notFound('Für diese Adresse gibt es keinen Firmen-Login. Melde dich anders an.');
        }
        const loginUrl = `/api/auth/sso/login?${new URLSearchParams({ workspace: found.workspace.id })}`;
        return c.json<SsoLogin>({ loginUrl });
      })
      .get('/auth/sso/login', async (c) => {
        const returnTo = safeReturnTo(c.req.query('returnTo'), DEFAULT_LOGIN_RETURN_TO);
        // A browser navigation: back to the login page rather than a bare 429.
        const hit = ssoLoginLimit.hit(clientAddress(c));
        if (!hit.allowed) {
          c.header('Retry-After', String(hit.retryAfterS));
          return loginFailed(c, 'rate_limited', returnTo);
        }
        const found = await findSsoForWorkspace(
          deps,
          // `organisation`: links from before the rename to Workspace.
          c.req.query('workspace') ?? c.req.query('organisation') ?? '',
        );
        if (!found) return loginFailed(c, 'sso_unavailable', returnTo);
        const pkce = await createPkce();
        let url: string;
        try {
          url = await workspaceSsoClient(
            config,
            found.sso,
            deps.clock,
            deps.ssoNetwork,
          ).authorizeUrl(pkce);
        } catch (error) {
          deps.log.warn(`SSO discovery of workspace ${found.workspace.id} failed`, error);
          return loginFailed(c, 'failed', returnTo);
        }
        await writeState(c, SSO_COOKIE, {
          state: pkce.state,
          verifier: pkce.verifier,
          nonce: pkce.nonce,
          returnTo,
          mode: 'login',
          workspaceId: found.workspace.id,
        });
        return c.redirect(url, 302);
      })
      .get('/auth/sso/callback', async (c) => {
        const saved = await readState(c, SSO_COOKIE);
        const query = c.req.query();
        const returnTo = saved?.returnTo ?? DEFAULT_LOGIN_RETURN_TO;
        if (
          !saved?.nonce ||
          !saved.workspaceId ||
          !query['state'] ||
          query['state'] !== saved.state
        ) {
          return loginFailed(c, 'failed', returnTo);
        }
        if (query['error']) {
          deps.log.warn(`SSO login failed: ${query['error']} ${query['error_description'] ?? ''}`);
          return loginFailed(c, query['error'] === 'access_denied' ? 'denied' : 'failed', returnTo);
        }
        // Checked again: the domain or the plan may have changed since the login started.
        const found = await findSsoForWorkspace(deps, saved.workspaceId);
        if (!found?.workspace.joinDomain) return loginFailed(c, 'sso_unavailable', returnTo);
        if (!query['code']) return loginFailed(c, 'failed', returnTo);

        let claims: IdTokenClaims;
        try {
          claims = await workspaceSsoClient(
            config,
            found.sso,
            deps.clock,
            deps.ssoNetwork,
          ).exchangeCode(query['code'], saved.verifier, saved.nonce);
        } catch (error) {
          deps.log.warn(`SSO token exchange of workspace ${found.workspace.id} failed`, error);
          return loginFailed(c, 'failed', returnTo);
        }
        const identity = oidcIdentity('oidc', claims, inviteTokenFromPath(returnTo));
        if (!identity.ok) return loginFailed(c, identity.error, returnTo);
        const signIn = await signInWithCompanySso(
          deps,
          { ...identity.value, provider: 'sso', subject: `${found.workspace.id}:${claims.sub}` },
          found.workspace.joinDomain,
        );
        if (!signIn.ok) return loginFailed(c, signIn.error, returnTo);
        // Into the workspace right away – unless an admin removed them (then it needs an
        // invitation) or it is full: they are signed in all the same.
        if (!(await getRole(deps.db, found.workspace.id, signIn.user.id))) {
          await joinByDomain(deps, signIn.user, found.workspace.id).catch((error: unknown) => {
            deps.log.info(`SSO sign-in did not join workspace ${found.workspace.id}`, error);
          });
        }
        return loggedIn(c, signIn.user.id, returnTo);
      })

      // ── Nextcloud (the organisation's, OAuth 2.0) ────────────────────────
      .get('/auth/nextcloud/login', viewer, async (c) => {
        const { server, login } = config.nextcloud;
        if (!server || !login)
          throw notFound('Die Anmeldung mit Nextcloud ist nicht eingerichtet.');
        const current = c.var.viewer;
        const connect = c.req.query('intent') === 'connect' && current?.kind === 'owner';
        const pkce = await createPkce();
        await writeState(c, NEXTCLOUD_COOKIE, {
          state: pkce.state,
          verifier: pkce.verifier,
          returnTo: safeReturnTo(c.req.query('returnTo'), DEFAULT_LOGIN_RETURN_TO),
          mode: connect ? 'connect' : 'login',
          userId: connect ? current.author.id : undefined,
        });
        // A new account confirms its address by mail, in this browser only.
        if (!connect) {
          await browserKey(
            c,
            config,
            NEXTCLOUD_SIGNUP_COOKIE,
            NEXTCLOUD_SIGNUP_TTL_MS / 1000 + 3600,
          );
        }
        return c.redirect(nextcloudAuthorizeUrl(server, login, pkce), 302);
      })

      .get('/auth/nextcloud/callback', viewer, async (c) => {
        const { server, login } = config.nextcloud;
        const saved = await readState(c, NEXTCLOUD_COOKIE);
        const query = c.req.query();
        const returnTo = saved?.returnTo ?? DEFAULT_LOGIN_RETURN_TO;
        const connect = saved?.mode === 'connect';
        const fail = (error: LoginError) =>
          connect ? linkFailed(c, returnTo, error) : loginFailed(c, error, returnTo);
        if (!server || !login || !saved || !query['state'] || query['state'] !== saved.state) {
          return fail('failed');
        }
        if (query['error']) {
          deps.log.warn(`Nextcloud login failed: ${query['error']}`);
          return fail(query['error'] === 'access_denied' ? 'denied' : 'failed');
        }
        if (!query['code']) return fail('failed');

        let user: NextcloudUser;
        try {
          user = await exchangeNextcloudCode(
            deps.nextcloud.http,
            server,
            login,
            query['code'],
            saved.verifier,
          );
        } catch (error) {
          deps.log.warn('Nextcloud login failed', error);
          return fail('failed');
        }
        const identity = nextcloudIdentity(server, user, inviteTokenFromPath(returnTo));
        if (connect) {
          const current = c.var.viewer;
          if (current?.kind !== 'owner' || current.author.id !== saved.userId)
            return fail('failed');
          const linked = await linkIdentity(deps, current.author.id, identity);
          if (!linked.ok) return fail(linked.error);
          return toWeb(c, returnTo);
        }
        const signIn = await signInWithIdentity(deps, identity);
        if (signIn.ok) return loggedIn(c, signIn.user.id, returnTo);
        if (signIn.error !== 'email_unverified') return loginFailed(c, signIn.error, returnTo);
        const unsent = await mailNextcloudSignup(c, identity, returnTo, server);
        if (unsent) return loginFailed(c, unsent, returnTo);
        return toWeb(c, nextcloudConfirmPath(returnTo));
      })

      // ── Nextcloud (any one, Login Flow v2) ───────────────────────────────
      // Nextcloud's login opens in a popup, the page polls. A known identity signs in; a new one
      // first confirms its address by mail (`services/nextcloud-signup`). The app password from
      // the grant becomes the account's file connection – else it goes back to Nextcloud.
      .post('/auth/nextcloud/flow', viewer, async (c) => {
        if (!config.nextcloud.loginAnyServer) {
          throw notFound('Die Anmeldung mit Nextcloud ist nicht eingerichtet.');
        }
        const input = await readJson(c, startNextcloudSignInInputSchema);
        assertWithinLimit(
          c,
          nextcloudFlowLimit.hit(clientAddress(c)),
          'Zu viele Anmeldeversuche bei Nextcloud. Bitte versuch es später noch einmal.',
        );
        const current = c.var.viewer;
        const link = input.intent === 'connect' && current?.kind === 'owner';
        const key = await browserKey(
          c,
          config,
          NEXTCLOUD_FLOW_COOKIE,
          NEXTCLOUD_FLOW_TTL_MS / 1000,
        );
        if (!link) {
          // Kept across sign-ins, so a link mailed earlier still works here.
          await browserKey(
            c,
            config,
            NEXTCLOUD_SIGNUP_COOKIE,
            (NEXTCLOUD_FLOW_TTL_MS + NEXTCLOUD_SIGNUP_TTL_MS) / 1000,
          );
        }
        // Who asks, on Nextcloud's grant page: the account when linking, else a code that only
        // the window that asked shows – a forwarded request has nothing to compare it with.
        const email = link ? await userEmail(deps.db, current.author.id) : null;
        const code = link ? undefined : String(randomInt(1000, 10_000));
        const start = await deps.nextcloud.startLogin(`signin:${key}`, input.server, {
          anyServer: true,
          ttlMs: NEXTCLOUD_FLOW_TTL_MS,
          requester: code ? `| Code ${code}` : email ? `für ${email}` : undefined,
        });
        const now = deps.clock.now().getTime();
        for (const [id, flow] of nextcloudFlows)
          if (flow.expiresAt <= now) nextcloudFlows.delete(id);
        nextcloudFlows.set(start.id, {
          returnTo: safeReturnTo(input.returnTo, link ? ACCOUNT_PATH : DEFAULT_LOGIN_RETURN_TO),
          linkTo: link ? current.author.id : null,
          expiresAt: now + NEXTCLOUD_FLOW_TTL_MS,
        });
        return c.json<NextcloudLoginStart>({ ...start, ...(code ? { code } : {}) });
      })

      .post('/auth/nextcloud/flow/:id/poll', viewer, async (c) => {
        const id = c.req.param('id');
        const key = await readSignedCookie(c, config, NEXTCLOUD_FLOW_COOKIE);
        const flow = nextcloudFlows.get(id);
        if (!key || !flow) return c.json<NextcloudSignInPoll>({ status: 'expired' });
        const result = await deps.nextcloud.pollGrant(`signin:${key}`, id);
        if (result.status !== 'granted') {
          if (result.status === 'expired') nextcloudFlows.delete(id);
          return c.json<NextcloudSignInPoll>(result);
        }
        nextcloudFlows.delete(id);
        const { granted } = result;
        const done = (redirectTo: string) =>
          c.json<NextcloudSignInPoll>({ status: 'done', redirectTo });
        let user: NextcloudUser;
        try {
          user = await deps.nextcloud.identify(granted);
        } catch (error) {
          await deps.nextcloud.discard(granted);
          throw error;
        }
        const identity = nextcloudIdentity(
          granted.server,
          user,
          inviteTokenFromPath(flow.returnTo),
        );
        /** The grant becomes the account's file connection (the password goes back on failure). */
        const keepAccess = async (userId: string) => {
          try {
            await deps.nextcloud.connect(userId, granted, user.id);
          } catch (error) {
            deps.log.warn('Could not keep the Nextcloud access of a sign-in', error);
            await deps.nextcloud.discard(granted);
          }
        };

        if (flow.linkTo) {
          const current = c.var.viewer;
          if (current?.kind !== 'owner' || current.author.id !== flow.linkTo) {
            await deps.nextcloud.discard(granted);
            return done(linkErrorPath(flow.returnTo, 'failed'));
          }
          const linked = await linkIdentity(deps, current.author.id, identity);
          if (!linked.ok) {
            await deps.nextcloud.discard(granted);
            return done(linkErrorPath(flow.returnTo, linked.error));
          }
          await keepAccess(current.author.id);
          return done(flow.returnTo);
        }

        const signIn = await signInWithIdentity(deps, identity);
        if (signIn.ok) {
          await keepAccess(signIn.user.id);
          await startSession(c, deps, signIn.user.id);
          return done(flow.returnTo);
        }
        await deps.nextcloud.discard(granted);
        if (signIn.error !== 'email_unverified') {
          return done(loginErrorPath(signIn.error, flow.returnTo));
        }
        // A new account: only once the mailbox confirms the address.
        const unsent = await mailNextcloudSignup(c, identity, flow.returnTo, granted.server);
        if (unsent) return done(loginErrorPath(unsent, flow.returnTo));
        return c.json<NextcloudSignInPoll>({ status: 'confirm', email: identity.email ?? '' });
      })

      .post('/auth/nextcloud/confirm', async (c) => {
        const { token } = await readJson(c, confirmNextcloudSignUpInputSchema);
        const { identity, returnTo } = await resolveNextcloudSignup(
          deps,
          token,
          await readSignedCookie(c, config, NEXTCLOUD_SIGNUP_COOKIE),
        );
        const target = safeReturnTo(returnTo, DEFAULT_LOGIN_RETURN_TO);
        const signIn = await signInWithIdentity(deps, identity);
        if (!signIn.ok) {
          return c.json<LoginResult>({ redirectTo: loginErrorPath(signIn.error, target) });
        }
        removeCookie(c, config, NEXTCLOUD_SIGNUP_COOKIE);
        await startSession(c, deps, signIn.user.id);
        return c.json<LoginResult>({ redirectTo: target });
      })

      // ── E-Mail (login link, BER-168) ─────────────────────────────────────
      // The same answer whether the address has an account: only its mailbox learns that.
      .post('/auth/email/start', async (c) => {
        if (!deps.mailer.configured) {
          throw notFound('Die Anmeldung per E-Mail ist auf diesem Server nicht eingerichtet.');
        }
        const input = await readJson(c, startEmailLoginInputSchema);
        assertWithinLimit(
          c,
          emailLoginClientLimit.hit(clientAddress(c)),
          'Zu viele Anmeldelinks angefordert. Bitte versuch es später noch einmal.',
        );
        // Kept across requests, so a link mailed earlier still works here.
        const browser = await browserKey(c, config, EMAIL_LOGIN_COOKIE, EMAIL_LOGIN_TTL_MS / 1000);
        const returnTo = safeReturnTo(input.returnTo, DEFAULT_LOGIN_RETURN_TO);
        // Over the address's limit nothing is sent and the answer stays the same: the links
        // already mailed still work.
        if (emailLoginAddressLimit.hit(normalizeEmail(input.email)).allowed) {
          const sent = await sendEmailLogin(deps, {
            email: input.email,
            returnTo,
            inviteToken: inviteTokenFromPath(returnTo),
            browser,
          });
          if (!sent) {
            throw new ApiError(
              503,
              'mail_failed',
              'Die Mail konnte gerade nicht verschickt werden. Bitte versuch es gleich noch einmal.',
            );
          }
        }
        return c.body(null, 204);
      })

      .post('/auth/email/confirm', async (c) => {
        const { token } = await readJson(c, confirmEmailLoginInputSchema);
        const link = await redeemEmailLogin(
          deps,
          token,
          await readSignedCookie(c, config, EMAIL_LOGIN_COOKIE),
        );
        const target = safeReturnTo(link.returnTo, DEFAULT_LOGIN_RETURN_TO);
        const signIn = await signInWithIdentity(deps, emailIdentity(link.email, link.inviteToken));
        if (!signIn.ok) {
          return c.json<EmailLoginResult>({
            redirectTo: loginErrorPath(signIn.error, target),
            newAccount: false,
          });
        }
        await startSession(c, deps, signIn.user.id);
        return c.json<EmailLoginResult>({ redirectTo: target, newAccount: signIn.created });
      })
  );
}

/**
 * The identity of a Nextcloud login: subject = `<server>:<Nextcloud user id>`. The address is not
 * confirmed – people may change it in their Nextcloud settings, also on the organisation's – so a
 * new account confirms it by mail first (`services/nextcloud-signup`). A known identity signs in.
 */
function nextcloudIdentity(
  server: string,
  user: NextcloudUser,
  inviteToken: string | null,
): IdentityInput {
  return {
    provider: 'nextcloud',
    subject: `${server}:${user.id}`,
    email: user.email,
    emailVerified: false,
    name: user.displayName ?? user.id,
    inviteToken,
  };
}

type OidcProviderId = 'google' | 'oidc';

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
