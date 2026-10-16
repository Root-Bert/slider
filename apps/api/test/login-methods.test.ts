import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authProvidersSchema,
  passkeySchema,
  type LoginIdentity,
  type MeResponse,
  type Passkey,
} from '@slider/shared';
import { simpleWebAuthn, type WebAuthn } from '../src/auth/passkeys';
import type { Config, OidcConfig } from '../src/config';
import { authChallenges, passkeys, userIdentities, users } from '../src/db/schema';
import type { FetchLike } from '../src/sources/safe-fetch';
import {
  createTestContext,
  fakeJwt,
  MICROSOFT_TEST_CONFIG,
  sessionCookieFrom,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

/**
 * Google and passkeys (BER-131). Providers and authenticators are fakes – no
 * network, no real WebAuthn crypto (that runs end to end in the browser).
 */

let ctx: TestContext;
let cleaned: TestContext | null = null;
afterEach(async () => {
  // Pure unit tests in between create no context of their own.
  if (ctx && ctx !== cleaned) await ctx.cleanup();
  cleaned = ctx;
});

const authConfig = (auth: Partial<Config['auth']> = {}): Partial<Config> => ({
  auth: { ...testConfig().auth, devLogin: false, ...auth },
});

const location = (res: Response) => new URL(res.headers.get('location') ?? '');
const me = async (cookie?: string) => {
  const res = await ctx.request('/api/me', { cookie });
  return { status: res.status, body: (await res.json()) as MeResponse };
};

/** Marks the instance as bootstrapped, so the next login is a normal sign-up. */
async function finishBootstrap() {
  await ctx.deps.db.insert(userIdentities).values({
    provider: 'oidc',
    subject: 'robert@q4-team.de',
    userId: ctx.ownerId,
    email: 'robert@q4-team.de',
  });
}

/** Every `name=value` a response sets (deletions left out), ready to send back as `Cookie`. */
const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((header) => header.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='));
const joinCookies = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('; ');

// ── Google ───────────────────────────────────────────────────────────────────

const GOOGLE: OidcConfig = {
  issuer: 'https://accounts.google.com',
  clientId: 'google-client.apps.googleusercontent.com',
  clientSecret: 'google-secret',
  label: 'Weiter mit Google',
  scopes: 'openid email profile',
  redirectUri: 'http://localhost:5173/api/auth/google/callback',
  issuerAliases: ['accounts.google.com'],
  authorizeParams: { prompt: 'select_account' },
};

interface FakeGoogle {
  fetch: FetchLike;
  claims: Record<string, unknown>;
  nonce: string;
}

function fakeGoogle(claims: Record<string, unknown> = {}): FakeGoogle {
  const idp: FakeGoogle = {
    nonce: '',
    claims: {
      // Google sends either spelling of its issuer.
      iss: 'accounts.google.com',
      aud: GOOGLE.clientId,
      sub: '109876543210',
      email: 'lena.berg@gmail.com',
      email_verified: true,
      name: 'Lena Berg',
      ...claims,
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url === 'https://accounts.google.com/.well-known/openid-configuration') {
        return Response.json({
          issuer: 'https://accounts.google.com',
          authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://oauth2.googleapis.com/token',
        });
      }
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('client_secret')).toBe('google-secret');
        expect(body.get('code_verifier')).toMatch(/^[\w-]{43}$/);
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

async function googleLogin(
  idp: FakeGoogle,
  { returnTo = '/', cookie = '', intent = '' } = {},
): Promise<Response> {
  const query = new URLSearchParams({ returnTo });
  if (intent) query.set('intent', intent);
  const start = await ctx.request(`/api/auth/google/login?${query.toString()}`, { cookie });
  expect(start.status).toBe(302);
  const authorize = location(start);
  idp.nonce = authorize.searchParams.get('nonce') ?? '';
  const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const params = new URLSearchParams({
    state: authorize.searchParams.get('state') ?? '',
    code: 'google-code',
  });
  return ctx.request(`/api/auth/google/callback?${params.toString()}`, {
    cookie: joinCookies(stateCookie, cookie),
  });
}

describe('Google login', () => {
  const googleContext = async (idp: FakeGoogle, auth: Partial<Config['auth']> = {}) => {
    ctx = await createTestContext({
      config: authConfig({ google: GOOGLE, signup: 'open', ...auth }),
      fetch: idp.fetch,
    });
    await finishBootstrap();
  };

  it('is listed after Microsoft and before SSO', async () => {
    ctx = await createTestContext({
      config: {
        ...authConfig({ google: GOOGLE, oidc: { ...GOOGLE, issuer: 'https://sso.example.com' } }),
        microsoft: MICROSOFT_TEST_CONFIG,
      },
    });
    const body = authProvidersSchema.parse(await (await ctx.request('/api/auth/providers')).json());
    expect(body.providers.map((p) => [p.id, p.loginUrl])).toEqual([
      ['microsoft', '/api/auth/microsoft/login'],
      ['google', '/api/auth/google/login'],
      ['oidc', '/api/auth/oidc/login'],
    ]);
    expect(body.providers[1]?.label).toBe('Weiter mit Google');
  });

  it('signs up with code + PKCE + nonce; the Google sub is the identity', async () => {
    const idp = fakeGoogle();
    await googleContext(idp);
    const start = await ctx.request('/api/auth/google/login?returnTo=%2Fneu');
    const authorize = location(start);
    expect(authorize.origin + authorize.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: GOOGLE.clientId,
      response_type: 'code',
      scope: 'openid email profile',
      redirect_uri: GOOGLE.redirectUri,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });

    const res = await googleLogin(idp, { returnTo: '/neu' });
    expect(res.headers.get('location')).toBe('http://localhost:5173/neu');
    const cookie = sessionCookieFrom(res) ?? '';
    const { body } = await me(cookie);
    expect(body.user).toMatchObject({ name: 'Lena Berg', email: 'lena.berg@gmail.com' });
    const [identity] = await ctx.deps.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.provider, 'google'));
    expect(identity).toMatchObject({ subject: '109876543210', userId: body.user?.id });

    // The https issuer works too, and the same sub signs into the same account.
    idp.claims = { ...idp.claims, iss: 'https://accounts.google.com', email: 'neu@gmail.com' };
    const again = sessionCookieFrom(await googleLogin(idp)) ?? '';
    expect((await me(again)).body.user?.id).toBe(body.user?.id);
  });

  it.each([
    ['a missing email_verified', { email_verified: undefined }, 'email_unverified'],
    ['email_verified: false', { email_verified: false }, 'email_unverified'],
    ['another audience', { aud: 'someone-else' }, 'failed'],
    ['another issuer', { iss: 'https://evil.example.com' }, 'failed'],
    ['no e-mail', { email: undefined }, 'no_email'],
  ])('rejects %s', async (_, claims, error) => {
    const idp = fakeGoogle(claims);
    await googleContext(idp);
    const res = await googleLogin(idp);
    expect(res.headers.get('location')).toBe(`http://localhost:5173/login?error=${error}`);
    expect(sessionCookieFrom(res)).toBeNull();
  });

  it('follows the sign-up rules (SIGNUP=invite)', async () => {
    const idp = fakeGoogle();
    await googleContext(idp, { signup: 'invite' });
    expect((await googleLogin(idp)).headers.get('location')).toMatch(/error=signup_closed/);
    expect(
      await ctx.deps.db.select().from(users).where(eq(users.email, 'lena.berg@gmail.com')),
    ).toEqual([]);
  });

  it('can bootstrap the instance', async () => {
    const idp = fakeGoogle({ email: 'robert@q4-team.de' });
    ctx = await createTestContext({
      config: authConfig({ google: GOOGLE, bootstrapEmails: ['robert@q4-team.de'] }),
      fetch: idp.fetch,
    });
    const cookie = sessionCookieFrom(await googleLogin(idp)) ?? '';
    expect((await me(cookie)).body.user).toMatchObject({ id: ctx.ownerId, isInstanceAdmin: true });
  });

  it('signed in, intent=connect links Google to the account (no new session)', async () => {
    const idp = fakeGoogle({ email: 'robert.privat@gmail.com' });
    await googleContext(idp);
    const owner = await signedInUser(ctx, { name: 'Robert', email: 'robert@q4-team.de' });
    const res = await googleLogin(idp, {
      returnTo: '/konto',
      cookie: owner.cookie,
      intent: 'connect',
    });
    expect(res.headers.get('location')).toBe('http://localhost:5173/konto');
    expect(sessionCookieFrom(res)).toBeNull();

    const identities = (await (
      await ctx.request('/api/me/identities', { cookie: owner.cookie })
    ).json()) as LoginIdentity[];
    expect(identities.map((i) => [i.provider, i.email])).toEqual([
      ['oidc', 'robert@q4-team.de'],
      ['google', 'robert.privat@gmail.com'],
    ]);

    // From now on Google signs into this account …
    const cookie = sessionCookieFrom(await googleLogin(idp)) ?? '';
    expect((await me(cookie)).body.user?.id).toBe(owner.user.id);

    // … and cannot be linked to anyone else.
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const taken = await googleLogin(idp, {
      returnTo: '/konto',
      cookie: lena.cookie,
      intent: 'connect',
    });
    expect(taken.headers.get('location')).toBe(
      'http://localhost:5173/konto?linkError=account_exists',
    );
  });

  it('is 404 without GOOGLE_* configured', async () => {
    ctx = await createTestContext({ config: authConfig() });
    expect((await ctx.request('/api/auth/google/login')).status).toBe(404);
  });

  const identitiesOf = async (cookie: string) =>
    (await (await ctx.request('/api/me/identities', { cookie })).json()) as LoginIdentity[];
  const unlink = (cookie: string, id: string) =>
    ctx.request(`/api/me/identities/${encodeURIComponent(id)}`, { method: 'DELETE', cookie });

  it('can be unlinked again; then Google no longer signs into the account', async () => {
    const idp = fakeGoogle({ email: 'robert.privat@gmail.com' });
    await googleContext(idp);
    const owner = await signedInUser(ctx, { name: 'Robert', email: 'robert@q4-team.de' });
    await googleLogin(idp, { returnTo: '/konto', cookie: owner.cookie, intent: 'connect' });
    const google = (await identitiesOf(owner.cookie)).find((i) => i.provider === 'google');
    expect(google?.id).toBe('google:109876543210');

    // Only one's own logins.
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    expect((await unlink(lena.cookie, google?.id ?? '')).status).toBe(404);
    expect((await unlink(owner.cookie, 'nonsense')).status).toBe(404);

    expect((await unlink(owner.cookie, google?.id ?? '')).status).toBe(204);
    expect((await identitiesOf(owner.cookie)).map((i) => i.provider)).toEqual(['oidc']);
    const cookie = sessionCookieFrom(await googleLogin(idp)) ?? '';
    expect((await me(cookie)).body.user?.id).not.toBe(owner.user.id);
  });

  it('never unlinks the last way in – a passkey counts as one', async () => {
    const idp = fakeGoogle();
    await googleContext(idp);
    const lena = sessionCookieFrom(await googleLogin(idp)) ?? '';
    const [google] = await identitiesOf(lena);
    const refused = await unlink(lena, google?.id ?? '');
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('letzte Anmeldung');

    const userId = (await me(lena)).body.user?.id ?? '';
    await ctx.deps.db.insert(passkeys).values({
      id: 'pk-1',
      userId,
      credentialId: 'cred-1',
      publicKey: 'key',
      deviceType: 'singleDevice',
      name: 'YubiKey',
    });
    expect((await unlink(lena, google?.id ?? '')).status).toBe(204);
  });

  it('a passkey-only account is a login: no attaching by e-mail, no second bootstrap', async () => {
    const idp = fakeGoogle();
    ctx = await createTestContext({
      config: authConfig({ google: GOOGLE, signup: 'open' }),
      fetch: idp.fetch,
    });
    // The instance admin went passkey-only: every provider unlinked.
    await ctx.deps.db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, ctx.ownerId));
    await ctx.deps.db.insert(passkeys).values({
      id: 'pk-admin',
      userId: ctx.ownerId,
      credentialId: 'cred-admin',
      publicKey: 'key',
      deviceType: 'singleDevice',
      name: 'YubiKey',
    });
    const { user: lena } = await signedInUser(ctx, { name: 'Lena', email: 'lena.berg@gmail.com' });
    await ctx.deps.db.insert(passkeys).values({
      id: 'pk-lena',
      userId: lena.id,
      credentialId: 'cred-lena',
      publicKey: 'key',
      deviceType: 'singleDevice',
      name: 'iPhone',
    });

    const res = await googleLogin(idp);
    expect(res.headers.get('location')).toBe('http://localhost:5173/login?error=account_exists');
    expect(await ctx.deps.db.select().from(userIdentities)).toEqual([]);

    // Someone else signs up as a normal account, not as a second instance admin.
    idp.claims = { ...idp.claims, sub: '2222', email: 'neu@gmail.com' };
    const cookie = sessionCookieFrom(await googleLogin(idp)) ?? '';
    expect((await me(cookie)).body.user).toMatchObject({
      email: 'neu@gmail.com',
      isInstanceAdmin: false,
    });
    const admins = await ctx.deps.db.select().from(users).where(eq(users.isInstanceAdmin, true));
    expect(admins.map((u) => u.id)).toEqual([ctx.ownerId]);
  });
});

// ── Passkeys ─────────────────────────────────────────────────────────────────

const b64url = (value: string) => Buffer.from(value).toString('base64url');

/**
 * Stands in for the authenticator's cryptography: a "response" carries its challenge in
 * `clientDataJSON` (as real ones do) and a signature counter in `signature`. Options come from
 * the real library.
 */
function fakeWebAuthn(): WebAuthn {
  const challengeOf = (response: { response: { clientDataJSON: string } }) =>
    (
      JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString()) as {
        challenge: string;
      }
    ).challenge;
  return {
    ...simpleWebAuthn,
    verifyRegistrationResponse: async ({ response, expectedChallenge, expectedRPID }) => {
      if (challengeOf(response) !== expectedChallenge) throw new Error('challenge mismatch');
      expect(expectedRPID).toBe('localhost');
      return {
        verified: true,
        registrationInfo: {
          fmt: 'none',
          aaguid: '00000000-0000-0000-0000-000000000000',
          credential: {
            id: response.id,
            publicKey: new Uint8Array([1, 2, 3, 4]),
            counter: 0,
            transports: response.response.transports,
          },
          credentialType: 'public-key',
          attestationObject: new Uint8Array(),
          userVerified: true,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          origin: 'http://localhost:5173',
        },
      };
    },
    verifyAuthenticationResponse: async ({ response, expectedChallenge, credential }) => {
      if (challengeOf(response) !== expectedChallenge) throw new Error('challenge mismatch');
      expect(Buffer.from(credential.publicKey)).toEqual(Buffer.from([1, 2, 3, 4]));
      const counter = Number(response.response.signature);
      if (credential.counter > 0 && counter <= credential.counter) {
        throw new Error('counter went backwards – cloned authenticator?');
      }
      return {
        verified: true,
        authenticationInfo: {
          credentialID: credential.id,
          newCounter: counter,
          userVerified: true,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          origin: 'http://localhost:5173',
          rpID: 'localhost',
        },
      };
    },
  };
}

const registration = (credentialId: string, challenge: string) => ({
  id: credentialId,
  rawId: credentialId,
  type: 'public-key',
  response: {
    clientDataJSON: b64url(JSON.stringify({ type: 'webauthn.create', challenge })),
    attestationObject: b64url('attestation'),
    transports: ['internal', 'hybrid'],
  },
  clientExtensionResults: {},
});

const assertion = (credentialId: string, challenge: string, counter: number) => ({
  id: credentialId,
  rawId: credentialId,
  type: 'public-key',
  response: {
    clientDataJSON: b64url(JSON.stringify({ type: 'webauthn.get', challenge })),
    authenticatorData: b64url('auth-data'),
    signature: String(counter),
    userHandle: b64url('user'),
  },
  clientExtensionResults: {},
});

describe('passkeys', () => {
  const passkeyContext = async () => {
    ctx = await createTestContext({ config: authConfig(), webauthn: fakeWebAuthn() });
  };

  /** options → (authenticator) → verify, like the browser does. */
  async function register(cookie: string, credentialId = 'cred-1', name?: string) {
    const options = await ctx.request('/api/passkeys/register/options', { method: 'POST', cookie });
    expect(options.status).toBe(200);
    const { challenge } = (await options.json()) as { challenge: string };
    return ctx.request('/api/passkeys/register/verify', {
      method: 'POST',
      cookie: joinCookies(cookie, ...cookiesFrom(options)),
      json: { response: registration(credentialId, challenge), name },
    });
  }

  async function startLogin() {
    const options = await ctx.request('/api/auth/passkey/options', { method: 'POST' });
    expect(options.status).toBe(200);
    const body = (await options.json()) as { challenge: string; allowCredentials?: unknown[] };
    return { ...body, cookie: joinCookies(...cookiesFrom(options)) };
  }

  const login = (cookie: string, response: unknown, returnTo?: string) =>
    ctx.request('/api/auth/passkey/verify', {
      method: 'POST',
      cookie,
      json: { response, returnTo },
    });

  it('registers a discoverable passkey for the signed-in account', async () => {
    await passkeyContext();
    const { user, cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const options = await ctx.request('/api/passkeys/register/options', { method: 'POST', cookie });
    const body = (await options.json()) as {
      rp: { id: string; name: string };
      user: { name: string; displayName: string };
      authenticatorSelection: { residentKey: string; userVerification: string };
    };
    expect(body.rp).toEqual({ id: 'localhost', name: 'Slider' });
    expect(body.user).toMatchObject({ name: 'lena@firma.de', displayName: 'Lena' });
    expect(body.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'preferred',
    });
    expect(options.headers.getSetCookie().join()).toMatch(/slider_passkey_register=.*HttpOnly/i);

    const res = await register(cookie, 'cred-1', 'MacBook');
    expect(res.status).toBe(201);
    const created = passkeySchema.parse(await res.json());
    expect(created).toMatchObject({ name: 'MacBook', synced: true, lastUsedAt: null });
    const [row] = await ctx.deps.db.select().from(passkeys);
    expect(row).toMatchObject({
      userId: user.id,
      credentialId: 'cred-1',
      publicKey: Buffer.from([1, 2, 3, 4]).toString('base64url'),
      transports: ['internal', 'hybrid'],
      deviceType: 'multiDevice',
    });

    const list = (await (await ctx.request('/api/passkeys', { cookie })).json()) as Passkey[];
    expect(list.map((p) => p.name)).toEqual(['MacBook']);

    // A second registration excludes the first authenticator.
    const again = await ctx.request('/api/passkeys/register/options', { method: 'POST', cookie });
    expect(
      ((await again.json()) as { excludeCredentials: { id: string }[] }).excludeCredentials,
    ).toEqual([expect.objectContaining({ id: 'cred-1' })]);
  });

  it('names a passkey after the device when no name is given', async () => {
    await passkeyContext();
    const { cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const options = await ctx.request('/api/passkeys/register/options', { method: 'POST', cookie });
    const { challenge } = (await options.json()) as { challenge: string };
    const res = await ctx.request('/api/passkeys/register/verify', {
      method: 'POST',
      cookie: joinCookies(cookie, ...cookiesFrom(options)),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
      },
      json: { response: registration('cred-ua', challenge) },
    });
    expect(((await res.json()) as Passkey).name).toBe('Passkey (iPhone)');
  });

  it('cannot be registered signed out or as a guest', async () => {
    await passkeyContext();
    expect((await ctx.request('/api/passkeys/register/options', { method: 'POST' })).status).toBe(
      401,
    );
    expect(
      (
        await ctx.request('/api/passkeys/register/verify', {
          method: 'POST',
          json: { response: registration('x', 'y') },
        })
      ).status,
    ).toBe(401);
    expect((await ctx.request('/api/passkeys')).status).toBe(401);
  });

  it("a registration challenge is bound to its account and can't be replayed", async () => {
    await passkeyContext();
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    const options = await ctx.request('/api/passkeys/register/options', {
      method: 'POST',
      cookie: lena.cookie,
    });
    const { challenge } = (await options.json()) as { challenge: string };
    const challengeCookie = cookiesFrom(options);
    const verify = (cookie: string) =>
      ctx.request('/api/passkeys/register/verify', {
        method: 'POST',
        cookie: joinCookies(cookie, ...challengeCookie),
        json: { response: registration('cred-x', challenge) },
      });
    // Max with Lena's challenge: refused, and the challenge is gone.
    expect((await verify(max.cookie)).status).toBe(400);
    expect((await verify(lena.cookie)).status).toBe(400);
    expect(await ctx.deps.db.select().from(passkeys)).toEqual([]);
  });

  it('signs in with a discoverable passkey, updates counter and last use', async () => {
    await passkeyContext();
    const { user, cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    await register(cookie);

    const start = await startLogin();
    expect(start.allowCredentials ?? []).toEqual([]);
    const res = await login(start.cookie, assertion('cred-1', start.challenge, 7), '/d/abc');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/d/abc' });
    const session = sessionCookieFrom(res) ?? '';
    expect((await me(session)).body.user?.id).toBe(user.id);

    const [row] = await ctx.deps.db.select().from(passkeys);
    expect(row?.counter).toBe(7);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
    const [listed] = (await (await ctx.request('/api/passkeys', { cookie })).json()) as Passkey[];
    expect(listed?.lastUsedAt).not.toBeNull();
  });

  it('a login challenge works once', async () => {
    await passkeyContext();
    const { cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    await register(cookie);
    const start = await startLogin();
    expect(
      sessionCookieFrom(await login(start.cookie, assertion('cred-1', start.challenge, 1))),
    ).not.toBeNull();
    const replay = await login(start.cookie, assertion('cred-1', start.challenge, 2));
    expect(replay.status).toBe(400);
    expect(sessionCookieFrom(replay)).toBeNull();
    expect(await ctx.deps.db.select().from(authChallenges)).toEqual([]);
  });

  it('refuses expired challenges, foreign challenges, unknown passkeys and counter regressions', async () => {
    await passkeyContext();
    const { cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    await register(cookie);

    let start = await startLogin();
    ctx.clock.advance(6 * 60 * 1000);
    expect((await login(start.cookie, assertion('cred-1', start.challenge, 1))).status).toBe(400);

    start = await startLogin();
    expect((await login(start.cookie, assertion('cred-1', 'another-challenge', 1))).status).toBe(
      400,
    );

    start = await startLogin();
    expect((await login(start.cookie, assertion('unknown', start.challenge, 1))).status).toBe(400);

    start = await startLogin();
    expect((await login('', assertion('cred-1', start.challenge, 1))).status).toBe(400);

    start = await startLogin();
    expect(
      sessionCookieFrom(await login(start.cookie, assertion('cred-1', start.challenge, 5))),
    ).not.toBeNull();
    start = await startLogin();
    const cloned = await login(start.cookie, assertion('cred-1', start.challenge, 3));
    expect(cloned.status).toBe(400);
    expect(sessionCookieFrom(cloned)).toBeNull();
  });

  it("renames and deletes only one's own passkeys", async () => {
    await passkeyContext();
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    const { id } = (await (await register(lena.cookie)).json()) as Passkey;
    await register(lena.cookie, 'cred-2');

    expect(
      (
        await ctx.request(`/api/passkeys/${id}`, {
          method: 'PATCH',
          cookie: max.cookie,
          json: { name: 'Meins' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await ctx.request(`/api/passkeys/${id}`, { method: 'DELETE', cookie: max.cookie })).status,
    ).toBe(404);
    expect(
      ((await (await ctx.request('/api/passkeys', { cookie: max.cookie })).json()) as []).length,
    ).toBe(0);

    const renamed = await ctx.request(`/api/passkeys/${id}`, {
      method: 'PATCH',
      cookie: lena.cookie,
      json: { name: '  YubiKey  ' },
    });
    expect(((await renamed.json()) as Passkey).name).toBe('YubiKey');
    expect(
      (await ctx.request(`/api/passkeys/${id}`, { method: 'DELETE', cookie: lena.cookie })).status,
    ).toBe(204);

    // A deleted passkey no longer signs in.
    const start = await startLogin();
    expect((await login(start.cookie, assertion('cred-1', start.challenge, 9))).status).toBe(400);
  });

  it('never deletes the last way in – under the same rule as unlinking', async () => {
    await passkeyContext();
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const remove = (id: string) =>
      ctx.request(`/api/passkeys/${id}`, { method: 'DELETE', cookie: lena.cookie });
    const first = (await (await register(lena.cookie, 'cred-1')).json()) as Passkey;

    const refused = await remove(first.id);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('letzte Anmeldung');

    const second = (await (await register(lena.cookie, 'cred-2')).json()) as Passkey;
    expect((await remove(first.id)).status).toBe(204);
    expect((await remove(second.id)).status).toBe(400);

    // With a provider login left, the last passkey may go.
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'google',
      subject: '1234',
      userId: lena.user.id,
      email: 'lena@firma.de',
    });
    expect((await remove(second.id)).status).toBe(204);
    expect(await ctx.deps.db.select().from(passkeys)).toEqual([]);
  });

  it('never creates an account – and disappears with its account', async () => {
    await passkeyContext();
    const { user, cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    await register(cookie);
    const usersBefore = (await ctx.deps.db.select().from(users)).length;
    const start = await startLogin();
    await login(start.cookie, assertion('cred-1', start.challenge, 1));
    expect((await ctx.deps.db.select().from(users)).length).toBe(usersBefore);

    await ctx.deps.db.delete(users).where(eq(users.id, user.id));
    expect(await ctx.deps.db.select().from(passkeys)).toEqual([]);
  });
});
