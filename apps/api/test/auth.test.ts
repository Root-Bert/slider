import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authProvidersSchema,
  createdWorkspaceInviteSchema,
  SETUP_TOKEN_HEADER,
  type MeResponse,
} from '@slider/shared';
import { SESSION_MAX_AGE_MS } from '../src/auth/session';
import { decryptToken } from '../src/auth/token-crypto';
import { signInWithIdentity } from '../src/services/accounts';
import type { Config, OidcConfig } from '../src/config';
import { microsoftConnections, sessions, userIdentities, users } from '../src/db/schema';
import { ensureSetupToken } from '../src/services/instance-settings';
import { purgeStaleRows } from '../src/services/retention';
import type { FetchLike } from '../src/sources/safe-fetch';
import {
  createReadyDeck,
  createTestContext,
  fakeJwt,
  MICROSOFT_TEST_CONFIG,
  sessionCookieFrom,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

const SECRET = 'test-secret-test-secret-test-secret!';
const DAY_MS = 24 * 60 * 60 * 1000;
const ISSUER = 'https://sso.example.com/application/o/slider';
const OIDC: OidcConfig = {
  issuer: ISSUER,
  clientId: 'slider',
  clientSecret: 'oidc-secret',
  label: 'Mit Firmen-SSO anmelden',
  scopes: 'openid profile email',
  redirectUri: 'http://localhost:5173/api/auth/oidc/callback',
};
const TENANT = '11111111-2222-3333-4444-555555555555';

let ctx: TestContext;
afterEach(() => ctx.cleanup());

const authConfig = (auth: Partial<Config['auth']> = {}): Partial<Config> => ({
  auth: { ...testConfig().auth, devLogin: false, ...auth },
});

const location = (res: Response) => new URL(res.headers.get('location') ?? '');
const me = async (cookie?: string) => {
  const res = await ctx.request('/api/me', { cookie });
  return { status: res.status, body: (await res.json()) as MeResponse };
};

/** Gives the dev owner a login of its own, so no login can take it over by its address. */
async function finishBootstrap() {
  await ctx.deps.db.insert(userIdentities).values({
    provider: 'google',
    subject: 'robert@example.org',
    userId: ctx.ownerId,
    email: 'robert@example.org',
  });
}

const ownerCookie = async () =>
  (await signedInUser(ctx, { name: 'Robert Hofmann', email: 'robert@example.org' })).cookie;

// ── Fake identity providers (no network) ─────────────────────────────────────

interface FakeIdp {
  fetch: FetchLike;
  /** Claims of the next ID token; `nonce` defaults to the one of the login. */
  claims: Record<string, unknown>;
  nonce: string;
}

function fakeOidc(claims: Record<string, unknown> = {}): FakeIdp {
  const idp: FakeIdp = {
    nonce: '',
    claims: {
      iss: ISSUER,
      aud: 'slider',
      sub: 'oidc-user-1',
      email: 'anna@firma.de',
      email_verified: true,
      name: 'Anna Becker',
      ...claims,
    },
    fetch: async (input) => {
      const url = String(input);
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: 'https://sso.example.com/authorize',
          token_endpoint: 'https://sso.example.com/token',
        });
      }
      if (url === 'https://sso.example.com/token') {
        return Response.json({
          id_token: fakeJwt({
            exp: Math.floor(Date.now() / 1000) + 300,
            nonce: idp.nonce,
            ...idp.claims,
          }),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  return idp;
}

function fakeMicrosoft(claims: Record<string, unknown> = {}): FakeIdp {
  const idp: FakeIdp = {
    nonce: '',
    claims: {
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      aud: MICROSOFT_TEST_CONFIG.clientId,
      sub: 'pairwise-sub',
      tid: TENANT,
      oid: 'oid-robert',
      name: 'Robert Hofmann',
      preferred_username: 'Robert.Hofmann@example.org',
      ...claims,
    },
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/oauth2/v2.0/token')) {
        return Response.json({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          id_token: fakeJwt({
            exp: Math.floor(Date.now() / 1000) + 300,
            nonce: idp.nonce,
            ...idp.claims,
          }),
        });
      }
      if (url.startsWith('https://graph.microsoft.com/v1.0/me')) {
        return Response.json({ mail: 'robert.hofmann@example.org' });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  return idp;
}

/** Runs a redirect login: `/login` → (fake provider) → `/callback`. */
async function redirectLogin(
  provider: 'oidc' | 'microsoft',
  idp: FakeIdp,
  { returnTo = '/', cookie = '', tamper = {} as Record<string, string> } = {},
) {
  const start = await ctx.request(
    `/api/auth/${provider}/login?returnTo=${encodeURIComponent(returnTo)}`,
    { cookie },
  );
  expect(start.status).toBe(302);
  const authorize = location(start);
  idp.nonce = authorize.searchParams.get('nonce') ?? '';
  const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const params = new URLSearchParams({
    state: authorize.searchParams.get('state') ?? '',
    code: 'the-code',
    ...tamper,
  });
  return ctx.request(`/api/auth/${provider}/callback?${params.toString()}`, {
    cookie: [stateCookie, cookie].filter(Boolean).join('; '),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/auth/providers', () => {
  it('lists the configured logins', async () => {
    ctx = await createTestContext({
      config: {
        ...authConfig({ oidc: OIDC, signup: 'domains' }),
        microsoft: MICROSOFT_TEST_CONFIG,
      },
      instanceAdmin: true,
    });
    const body = authProvidersSchema.parse(await (await ctx.request('/api/auth/providers')).json());
    expect(body).toEqual({
      providers: [
        {
          id: 'microsoft',
          label: 'Weiter mit Microsoft',
          kind: 'redirect',
          loginUrl: '/api/auth/microsoft/login',
        },
        {
          id: 'oidc',
          label: 'Mit Firmen-SSO anmelden',
          kind: 'redirect',
          loginUrl: '/api/auth/oidc/login',
        },
      ],
      devLogin: false,
      signup: 'domains',
      needsSetup: false,
      nextcloudAnyServer: false,
      googleDrive: false,
      sso: false,
      // No mail on this instance: no login links (BER-168).
      emailLogin: false,
    });
  });

  it('reports open sign-up while the instance has no admin, then SIGNUP again', async () => {
    ctx = await createTestContext({ config: authConfig({ oidc: OIDC, signup: 'invite' }) });
    const signup = async () =>
      authProvidersSchema.parse(await (await ctx.request('/api/auth/providers')).json()).signup;
    expect(await signup()).toBe('open');
    await ctx.deps.db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, ctx.ownerId));
    expect(await signup()).toBe('invite');
  });
});

describe('sessions', () => {
  it('answers 401 to anonymous callers without dev login, decks included (no guests)', async () => {
    ctx = await createTestContext({ config: authConfig() });
    expect((await me()).status).toBe(401);
    expect(await (await ctx.request('/api/decks')).json()).toMatchObject({
      error: { code: 'unauthorized' },
    });
    const { deckId } = await createReadyDeck(ctx);
    expect((await ctx.request(`/api/decks/${deckId}`)).status).toBe(401);
  });

  it('signs in with the cookie, renews at most daily, expires and logs out', async () => {
    ctx = await createTestContext({ config: authConfig() });
    const { user, cookie } = await signedInUser(ctx, {
      name: 'Robert Hofmann',
      email: 'robert@example.org',
    });
    const first = await ctx.request('/api/me', { cookie });
    expect(first.status).toBe(200);
    expect(sessionCookieFrom(first)).toBeNull(); // fresh: no renewal yet
    const body = (await first.json()) as MeResponse;
    expect(body.viewer).toMatchObject({ kind: 'owner', author: { id: user.id } });
    expect(body.user).toMatchObject({
      email: 'robert@example.org',
      isInstanceAdmin: false,
      microsoftConnected: false,
    });
    expect(body.workspaces).toEqual([
      expect.objectContaining({ name: 'Meine Organisation', role: 'admin', memberCount: 1 }),
    ]);

    // Only the hash is stored.
    const [row] = await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie).not.toContain(row?.tokenHash ?? '-');

    ctx.clock.advance(2 * DAY_MS);
    const renewed = await ctx.request('/api/me', { cookie });
    expect(renewed.status).toBe(200);
    const header = renewed.headers.getSetCookie().find((h) => h.startsWith('slider_session='));
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toMatch(/Max-Age=2592000/);
    const [after] = await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(after!.expiresAt.getTime()).toBeGreaterThan(row!.expiresAt.getTime());
    expect(sessionCookieFrom(await ctx.request('/api/me', { cookie }))).toBeNull();

    const logout = await ctx.request('/api/auth/logout', { method: 'POST', cookie });
    expect(logout.status).toBe(204);
    expect(logout.headers.getSetCookie().join()).toMatch(/slider_session=;/);
    expect(await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual(
      [],
    );
    expect((await me(cookie)).status).toBe(401);
  });

  it('rejects expired sessions', async () => {
    ctx = await createTestContext({ config: authConfig() });
    const { cookie } = await signedInUser(ctx, { name: 'R', email: 'robert@example.org' });
    ctx.clock.advance(31 * DAY_MS);
    expect((await me(cookie)).status).toBe(401);
  });

  it('ends a session 90 days after its login, however often it is used', async () => {
    ctx = await createTestContext({ config: authConfig() });
    const { user, cookie } = await signedInUser(ctx, { name: 'R', email: 'robert@example.org' });
    const [created] = await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, user.id));
    const deadline = created!.createdAt.getTime() + SESSION_MAX_AGE_MS;
    // Used every few days: it slides, but never past its 90 days, the cookie neither.
    for (let day = 5; day < 90; day += 5) {
      ctx.clock.advance(5 * DAY_MS);
      // Read before the request: the test clock keeps running while it is answered.
      const before = ctx.clock.now().getTime();
      const res = await ctx.request('/api/me', { cookie });
      expect(res.status).toBe(200);
      const header = res.headers.getSetCookie().find((h) => h.startsWith('slider_session='));
      const maxAge = Number(/Max-Age=(\d+)/.exec(header ?? '')?.[1]);
      expect(maxAge * 1000).toBeLessThanOrEqual(deadline - before);
      const [row] = await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, user.id));
      expect(row!.expiresAt.getTime()).toBeLessThanOrEqual(deadline);
    }
    // Day 85: still in; day 90 and a bit: out, and the stale cookie goes.
    ctx.clock.advance(5 * DAY_MS + 1000);
    const late = await ctx.request('/api/me', { cookie });
    expect(late.status).toBe(401);
    expect(late.headers.getSetCookie().join()).toMatch(/slider_session=;/);
    await purgeStaleRows(ctx.deps);
    expect(await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual(
      [],
    );
  });

  it('ends sessions from before the cap on time too, and the hourly job deletes them', async () => {
    ctx = await createTestContext({ config: authConfig() });
    const { user, cookie } = await signedInUser(ctx, { name: 'R', email: 'robert@example.org' });
    // Renewed the old way: valid for another 30 days, but its login is 91 days ago.
    const now = ctx.clock.now().getTime();
    await ctx.deps.db
      .update(sessions)
      .set({
        createdAt: new Date(now - 91 * DAY_MS),
        expiresAt: new Date(now + 29 * DAY_MS),
      })
      .where(eq(sessions.userId, user.id));
    expect((await me(cookie)).status).toBe(401);
    await purgeStaleRows(ctx.deps);
    expect(await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual(
      [],
    );
  });

  it('prefers a session over the dev owner', async () => {
    ctx = await createTestContext();
    const { user, cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    expect((await me(cookie)).body.viewer.author.id).toBe(user.id);
    expect((await me()).body.viewer.author.id).toBe(ctx.ownerId);
  });
});

describe('OIDC login', () => {
  const oidcContext = async (idp: FakeIdp, auth: Partial<Config['auth']> = {}) => {
    ctx = await createTestContext({
      config: authConfig({ oidc: OIDC, ...auth }),
      fetch: idp.fetch,
      instanceAdmin: true,
    });
    await finishBootstrap();
  };

  it('signs up (SIGNUP=open) with code + PKCE + nonce and lands on returnTo', async () => {
    const idp = fakeOidc();
    await oidcContext(idp, { signup: 'open' });
    const start = await ctx.request('/api/auth/oidc/login?returnTo=%2Fdecks');
    expect(Object.fromEntries(location(start).searchParams)).toMatchObject({
      client_id: 'slider',
      response_type: 'code',
      scope: 'openid profile email',
      code_challenge_method: 'S256',
      redirect_uri: OIDC.redirectUri,
    });

    const res = await redirectLogin('oidc', idp, { returnTo: '/decks' });
    expect(res.headers.get('location')).toBe('http://localhost:5173/decks');
    const cookie = sessionCookieFrom(res);
    expect(cookie).toBeTruthy();
    const { body } = await me(cookie ?? '');
    expect(body.user).toMatchObject({ name: 'Anna Becker', email: 'anna@firma.de' });
    // An organisation of their own right away, named after the company; they are asked whether
    // it is private or the company's (BER-148).
    expect(body.workspaces).toEqual([
      expect.objectContaining({ name: 'Firma', role: 'admin', audiencePending: true }),
    ]);
    // It is their own one on the limited test instance.
    expect(body.limits).toEqual({ canCreateWorkspace: false, domainJoin: true });

    // The same identity signs into the same account again.
    const again = await redirectLogin('oidc', idp);
    expect((await me(sessionCookieFrom(again) ?? '')).body.user?.id).toBe(body.user?.id);
  });

  it.each([
    ['a forged state', {}, { state: 'forged' }, 'failed'],
    ['another audience', { aud: 'someone-else' }, {}, 'failed'],
    ['another issuer', { iss: 'https://evil.example.com' }, {}, 'failed'],
    ['a replayed nonce', { nonce: 'old-nonce' }, {}, 'failed'],
    ['an expired ID token', { exp: 1_000 }, {}, 'failed'],
    ['an unverified e-mail', { email_verified: false }, {}, 'email_unverified'],
    ['no e-mail', { email: undefined }, {}, 'no_email'],
    ['a provider error', {}, { error: 'access_denied' }, 'denied'],
  ])('rejects %s', async (_, claims, tamper, error) => {
    const idp = fakeOidc(claims);
    await oidcContext(idp, { signup: 'open' });
    const res = await redirectLogin('oidc', idp, { tamper });
    expect(res.headers.get('location')).toBe(`http://localhost:5173/login?error=${error}`);
    expect(sessionCookieFrom(res)).toBeNull();
  });

  it('keeps sign-up closed with SIGNUP=invite', async () => {
    const idp = fakeOidc();
    await oidcContext(idp);
    const res = await redirectLogin('oidc', idp, { returnTo: '/decks' });
    expect(res.headers.get('location')).toBe(
      'http://localhost:5173/login?error=signup_closed&returnTo=%2Fdecks',
    );
    expect(await ctx.deps.db.select().from(users).where(eq(users.email, 'anna@firma.de'))).toEqual(
      [],
    );
  });

  it('SIGNUP=domains admits verified company addresses only', async () => {
    const idp = fakeOidc();
    await oidcContext(idp, { signup: 'domains', signupDomains: ['firma.de'] });
    expect(sessionCookieFrom(await redirectLogin('oidc', idp))).toBeTruthy();

    idp.claims = { ...idp.claims, sub: 'other', email: 'max@gmail.com' };
    expect((await redirectLogin('oidc', idp)).headers.get('location')).toMatch(
      /error=signup_closed/,
    );
  });

  it('lets people with a pending e-mail invite sign up, without a workspace of their own', async () => {
    const idp = fakeOidc();
    await oidcContext(idp);
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
      method: 'POST',
      json: { email: 'Anna@Firma.de', role: 'reviewer' },
      cookie: await ownerCookie(),
    });
    const cookie = sessionCookieFrom(await redirectLogin('oidc', idp)) ?? '';
    const { body } = await me(cookie);
    expect(body.workspaces).toEqual([]);
    expect(body.pendingInvites).toEqual([
      expect.objectContaining({ workspaceName: 'Meine Organisation', role: 'reviewer' }),
    ]);
  });

  it('lets people coming through an invite link (returnTo /join/…) sign up and join', async () => {
    const idp = fakeOidc({ email: 'extern@agentur.de' });
    await oidcContext(idp);
    const created = createdWorkspaceInviteSchema.parse(
      await (
        await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
          method: 'POST',
          json: { role: 'member' },
          cookie: await ownerCookie(),
        })
      ).json(),
    );
    const joinPath = new URL(created.url).pathname;
    const res = await redirectLogin('oidc', idp, { returnTo: joinPath });
    expect(res.headers.get('location')).toBe(`http://localhost:5173${joinPath}`);
    const cookie = sessionCookieFrom(res) ?? '';
    const join = await ctx.request(`/api${joinPath}`, { method: 'POST', cookie });
    expect(join.status).toBe(200);
    expect((await me(cookie)).body.workspaces).toEqual([
      expect.objectContaining({ id: ctx.workspaceId, role: 'member' }),
    ]);
  });

  it('never merges into an account that already signs in another way', async () => {
    const idp = fakeOidc({ email: 'robert@example.org' });
    await oidcContext(idp, { signup: 'open' });
    expect((await redirectLogin('oidc', idp)).headers.get('location')).toMatch(
      /error=account_exists/,
    );
  });
});

describe('Microsoft login', () => {
  const msContext = async (
    idp: FakeIdp,
    config: Partial<Config> = {},
    options: { instanceAdmin?: boolean } = {},
  ) => {
    ctx = await createTestContext({
      config: { ...authConfig(), microsoft: MICROSOFT_TEST_CONFIG, ...config },
      fetch: idp.fetch,
      ...options,
    });
  };

  it('the first login creates a normal account – never instance admin – and stores the Graph token', async () => {
    const idp = fakeMicrosoft();
    await msContext(idp, { auth: { ...authConfig().auth!, signup: 'open' } });
    const { deckId } = await createReadyDeck(ctx);

    const start = await ctx.request('/api/auth/microsoft/login');
    expect(location(start).searchParams.get('scope')).toBe(
      'openid profile email offline_access User.Read Files.Read.All',
    );
    expect(location(start).searchParams.get('nonce')).toMatch(/^[\w-]{43}$/);

    const res = await redirectLogin('microsoft', idp, { returnTo: '/' });
    expect(res.headers.get('location')).toBe('http://localhost:5173/');
    const cookie = sessionCookieFrom(res) ?? '';
    const { body } = await me(cookie);
    expect(body.user).toMatchObject({
      email: 'robert.hofmann@example.org',
      isInstanceAdmin: false,
      microsoftConnected: true,
    });
    expect(body.user?.id).not.toBe(ctx.ownerId);
    expect(body.workspaces).toEqual([expect.objectContaining({ name: 'Example', role: 'admin' })]);
    expect(body.instanceClaimed).toBe(false);
    // Unclaimed: nothing but the setup token before the claim – the dev owner's decks stay put.
    const deck = await ctx.request(`/api/decks/${deckId}`, { cookie });
    expect(deck.status).toBe(403);
    expect(await deck.json()).toMatchObject({ error: { code: 'instance_unclaimed' } });

    const [identity] = await ctx.deps.db.select().from(userIdentities);
    expect(identity).toMatchObject({
      provider: 'microsoft',
      subject: `${TENANT}:oid-robert`,
      userId: body.user?.id,
    });
    const [connection] = await ctx.deps.db
      .select()
      .from(microsoftConnections)
      .where(eq(microsoftConnections.userId, body.user?.id ?? ''));
    expect(await decryptToken(SECRET, connection?.refreshToken ?? '')).toBe('rt-1');
    expect(connection?.identitySubject).toBe(`${TENANT}:oid-robert`);
    expect(await ctx.deps.db.select().from(users).where(eq(users.isInstanceAdmin, true))).toEqual(
      [],
    );
  });

  it('signed in, connects file access and links the login – no new session', async () => {
    const idp = fakeMicrosoft({ oid: 'oid-lena', preferred_username: 'lena@firma.de' });
    await msContext(idp, {}, { instanceAdmin: true });
    await finishBootstrap();
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const res = await redirectLogin('microsoft', idp, { returnTo: '/neu', cookie: lena.cookie });
    expect(res.headers.get('location')).toBe('http://localhost:5173/neu');
    expect(sessionCookieFrom(res)).toBeNull();
    expect((await me(lena.cookie)).body.user).toMatchObject({
      id: lena.user.id,
      microsoftConnected: true,
    });
    const loginsOf = (userId: string) =>
      ctx.deps.db
        .select({ provider: userIdentities.provider })
        .from(userIdentities)
        .where(eq(userIdentities.userId, userId));
    expect(await loginsOf(lena.user.id)).toEqual([{ provider: 'microsoft' }]);

    // Someone else may get files through the same Microsoft account, but not its login.
    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    await redirectLogin('microsoft', idp, { returnTo: '/neu', cookie: max.cookie });
    expect((await me(max.cookie)).body.user?.microsoftConnected).toBe(true);
    expect(await loginsOf(max.user.id)).toEqual([]);
    expect(await loginsOf(lena.user.id)).toEqual([{ provider: 'microsoft' }]);
  });

  it('does not take an unverified e-mail claim for sign-up', async () => {
    const idp = fakeMicrosoft({
      oid: 'oid-x',
      preferred_username: undefined,
      email: 'robert@example.org',
    });
    await msContext(idp, { auth: { ...authConfig().auth!, signup: 'open' } });
    await finishBootstrap();
    expect((await redirectLogin('microsoft', idp)).headers.get('location')).toMatch(
      /error=email_unverified/,
    );
  });
});

describe('first logins of an unclaimed instance', () => {
  const oidcInstance = async (idp: FakeIdp, config: Partial<Config> = {}, auth = {}) => {
    ctx = await createTestContext({
      config: { ...config, ...authConfig({ oidc: OIDC, ...auth }) },
      fetch: idp.fetch,
    });
  };
  const identities = () => ctx.deps.db.select().from(userIdentities);
  const admins = () => ctx.deps.db.select().from(users).where(eq(users.isInstanceAdmin, true));

  it.each([
    ['SIGNUP=open', { signup: 'open' }, 'anna@firma.de'],
    ['SIGNUP=domains', { signup: 'domains', signupDomains: ['firma.de'] }, 'anna@firma.de'],
    // The dev owner's own address takes over the login-less dev owner account – still no admin.
    ['the dev owner address', { signup: 'open' }, 'robert@example.org'],
  ])('signing in never makes anyone instance admin (%s, production)', async (_, auth, email) => {
    const idp = fakeOidc({ email });
    await oidcInstance(idp, { env: 'production' }, auth);
    const cookie = sessionCookieFrom(await redirectLogin('oidc', idp)) ?? '';
    expect((await me(cookie)).body.user).toMatchObject({ email, isInstanceAdmin: false });
    expect(await admins()).toEqual([]);
  });

  it('lets anyone sign up while there is no admin, even under SIGNUP=invite or domains', async () => {
    const idp = fakeOidc({ sub: 'x', email: 'x@gmail.com' });
    await oidcInstance(idp, { env: 'production' });
    expect(sessionCookieFrom(await redirectLogin('oidc', idp))).toBeTruthy();

    await ctx.cleanup();
    await oidcInstance(
      idp,
      { env: 'production' },
      { signup: 'domains', signupDomains: ['firma.de'] },
    );
    expect(sessionCookieFrom(await redirectLogin('oidc', idp))).toBeTruthy();
    expect(await admins()).toEqual([]);
  });

  it('two simultaneous first logins: two normal accounts, no admin', async () => {
    ctx = await createTestContext({ config: authConfig({ signup: 'open' }) });
    const login = (subject: string, email: string) =>
      signInWithIdentity(ctx.deps, {
        provider: 'oidc',
        subject,
        email,
        emailVerified: true,
        name: null,
        inviteToken: null,
      });
    const results = await Promise.all([
      login('anna', 'anna@firma.de'),
      login('bert', 'bert@firma.de'),
    ]);
    const signedIn = results.map((result) => (result.ok ? result.user : null));
    expect(signedIn.every(Boolean)).toBe(true);
    expect(new Set(signedIn.map((user) => user?.id)).size).toBe(2);
    expect(await admins()).toEqual([]);
    expect(await identities()).toHaveLength(2);
  });

  describe('the setup token before anything else (SIGNUP=invite)', () => {
    let dataDir: string;
    let token: string;
    const tokenInstance = async (idp: FakeIdp) => {
      dataDir = await mkdtemp(path.join(tmpdir(), 'slider-auth-setup-'));
      ctx = await createTestContext({
        config: { dataDir, env: 'production', ...authConfig({ oidc: OIDC }) },
        fetch: idp.fetch,
        instance: { env: {}, restart: null },
      });
      token = ensureSetupToken(dataDir);
    };
    afterEach(() => rm(dataDir, { recursive: true, force: true }));

    const claim = (cookie: string, given = token) =>
      ctx.request('/api/setup/claim', {
        method: 'POST',
        cookie,
        headers: { [SETUP_TOKEN_HEADER]: given },
      });
    const blocked = async (res: Response) => {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: 'instance_unclaimed' } });
    };

    it('signed in, every route but login, /me and the setup page is closed until the claim', async () => {
      const idp = fakeOidc();
      await tokenInstance(idp);
      const cookie = sessionCookieFrom(await redirectLogin('oidc', idp)) ?? '';
      expect((await me(cookie)).body).toMatchObject({
        instanceClaimed: false,
        user: { email: 'anna@firma.de', isInstanceAdmin: false },
      });
      await blocked(await ctx.request('/api/decks', { cookie }));
      await blocked(await ctx.request('/api/workspaces', { cookie }));
      await blocked(
        await ctx.request('/api/workspaces', { method: 'POST', json: { name: 'X' }, cookie }),
      );
      await blocked(
        await ctx.request('/api/me', { method: 'PATCH', json: { color: 'blue' }, cookie }),
      );
      expect((await ctx.request('/api/setup', { cookie })).status).toBe(200);
      expect((await ctx.request('/api/auth/providers', { cookie })).status).toBe(200);
      expect((await ctx.request('/api/health')).status).toBe(200);

      // A wrong token changes nothing.
      expect((await claim(cookie, 'wrong')).status).toBe(403);
      await blocked(await ctx.request('/api/decks', { cookie }));

      expect((await claim(cookie)).status).toBe(200);
      expect((await me(cookie)).body).toMatchObject({
        instanceClaimed: true,
        user: { isInstanceAdmin: true },
      });
      expect((await ctx.request('/api/decks', { cookie })).status).toBe(200);
      expect((await ctx.request('/api/workspaces', { cookie })).status).toBe(200);
    });

    it('signed out, or with a stale session: 401 as before, not the claim', async () => {
      const idp = fakeOidc();
      await tokenInstance(idp);
      expect((await ctx.request('/api/decks')).status).toBe(401);
      expect((await ctx.request('/api/decks', { cookie: 'slider_session=stale' })).status).toBe(
        401,
      );
    });

    it('once someone claimed, nobody is asked again – and SIGNUP applies again', async () => {
      const idp = fakeOidc();
      await tokenInstance(idp);
      const anna = sessionCookieFrom(await redirectLogin('oidc', idp)) ?? '';
      idp.claims = { ...idp.claims, sub: 'bert', email: 'bert@firma.de', name: 'Bert' };
      const bert = sessionCookieFrom(await redirectLogin('oidc', idp)) ?? '';
      await blocked(await ctx.request('/api/decks', { cookie: bert }));

      expect((await claim(anna)).status).toBe(200);
      // Bert signed up before the claim: a normal account now, no admin, not asked any more.
      expect((await me(bert)).body).toMatchObject({
        instanceClaimed: true,
        user: { isInstanceAdmin: false },
      });
      expect((await ctx.request('/api/decks', { cookie: bert })).status).toBe(200);
      // The token is used up.
      expect((await claim(bert)).status).toBe(403);

      idp.claims = { ...idp.claims, sub: 'cleo', email: 'cleo@gmail.com', name: 'Cleo' };
      expect((await redirectLogin('oidc', idp)).headers.get('location')).toMatch(
        /error=signup_closed/,
      );
    });
  });

  it('dev login: the dev owner and signed-in accounts are never asked for the token', async () => {
    ctx = await createTestContext();
    expect((await me()).body.instanceClaimed).toBe(true);
    expect((await ctx.request('/api/decks')).status).toBe(200);
    const { cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    expect((await me(cookie)).body.instanceClaimed).toBe(true);
    expect((await ctx.request('/api/decks', { cookie })).status).toBe(200);
    expect(await admins()).toEqual([]);
  });

  it('production on https: __Host- cookies, so a sibling subdomain cannot plant state or sessions', async () => {
    const idp = fakeOidc();
    await oidcInstance(
      idp,
      { env: 'production', webOrigin: 'https://slider.firma.de' },
      { signup: 'open' },
    );
    const start = await ctx.request('/api/auth/oidc/login?returnTo=%2F');
    const stateHeader = start.headers.get('set-cookie') ?? '';
    expect(stateHeader).toMatch(/^__Host-slider_oidc=/);
    expect(stateHeader).toMatch(/Path=\/;/);
    expect(stateHeader).toMatch(/Secure/);
    expect(stateHeader).not.toMatch(/Domain=/i);
    const hostState = stateHeader.split(';')[0] ?? '';
    const authorize = location(start);
    idp.nonce = authorize.searchParams.get('nonce') ?? '';
    const callback = (cookie: string) =>
      ctx.request(
        `/api/auth/oidc/callback?state=${authorize.searchParams.get('state')}&code=the-code`,
        { cookie },
      );

    // A genuinely signed state cookie under the plain name – what `Domain=.firma.de` could plant.
    const planted = await callback(hostState.replace(/^__Host-/, ''));
    expect(planted.headers.get('location')).toMatch(/error=failed/);
    expect(sessionCookieFrom(planted)).toBeNull();

    const res = await callback(hostState);
    const session = sessionCookieFrom(res) ?? '';
    expect(session).toMatch(/^__Host-slider_session=/);
    expect(res.headers.getSetCookie().find((h) => h.startsWith('__Host-slider_session='))).toMatch(
      /Secure/,
    );
    expect((await me(session)).body.user).toMatchObject({ email: 'anna@firma.de' });
    // The same token under the plain name is not a session.
    expect((await me(session.replace(/^__Host-/, ''))).status).toBe(401);
  });
});
