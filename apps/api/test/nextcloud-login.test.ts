import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authProvidersSchema, type LoginIdentity, type MeResponse } from '@slider/shared';
import { hasLogin, loadConfig, type Config } from '../src/config';
import { userIdentities } from '../src/db/schema';
import type { FetchLike } from '../src/sources/safe-fetch';
import {
  createTestContext,
  sessionCookieFrom,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

/** "Weiter mit Nextcloud": OAuth 2.0 against the organisation's Nextcloud, faked – no network. */

let ctx: TestContext;
let cleaned: TestContext | null = null;
afterEach(async () => {
  // The config tests at the end create no context of their own.
  if (ctx && ctx !== cleaned) await ctx.cleanup();
  cleaned = ctx;
});

const SERVER = 'https://cloud.firma.de';
const NEXTCLOUD: Config['nextcloud'] = {
  server: SERVER,
  login: {
    clientId: 'nc-client',
    clientSecret: 'nc-secret',
    redirectUri: 'http://localhost:5173/api/auth/nextcloud/callback',
  },
  loginAnyServer: false,
};

interface FakeNextcloud {
  fetch: FetchLike;
  user: { id: string; email: string | null; displayname: string };
  requests: string[];
  /** What the token endpoint says the token belongs to (defaults to `user.id`). */
  tokenUserId?: string;
}

function fakeNextcloud(user: Partial<FakeNextcloud['user']> = {}): FakeNextcloud {
  const nc: FakeNextcloud = {
    user: { id: 'lena', email: 'lena@firma.de', displayname: 'Lena Berg', ...user },
    requests: [],
    fetch: async (input, init) => {
      const url = String(input);
      nc.requests.push(url);
      if (url === `${SERVER}/index.php/apps/oauth2/api/v1/token`) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('client_secret')).toBe('nc-secret');
        expect(body.get('code')).toBe('nc-code');
        expect(body.get('code_verifier')).toMatch(/^[\w-]{43}$/);
        return Response.json({
          access_token: 'nc-access',
          token_type: 'Bearer',
          refresh_token: 'nc-refresh',
          user_id: nc.tokenUserId ?? nc.user.id,
        });
      }
      if (url === `${SERVER}/ocs/v2.php/cloud/user?format=json`) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer nc-access');
        return Response.json({ ocs: { data: nc.user } });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  return nc;
}

const location = (res: Response) => new URL(res.headers.get('location') ?? '');

async function nextcloudLogin(
  { returnTo = '/', cookie = '', intent = '' } = {},
  callback: Record<string, string> = { code: 'nc-code' },
): Promise<Response> {
  const query = new URLSearchParams({ returnTo });
  if (intent) query.set('intent', intent);
  const start = await ctx.request(`/api/auth/nextcloud/login?${query.toString()}`, { cookie });
  expect(start.status).toBe(302);
  const authorize = location(start);
  const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const params = new URLSearchParams({
    state: authorize.searchParams.get('state') ?? '',
    ...callback,
  });
  return ctx.request(`/api/auth/nextcloud/callback?${params.toString()}`, {
    cookie: [stateCookie, cookie].filter(Boolean).join('; '),
  });
}

async function nextcloudContext(nc: FakeNextcloud, auth: Partial<Config['auth']> = {}) {
  ctx = await createTestContext({
    config: {
      auth: { ...testConfig().auth, devLogin: false, signup: 'open', ...auth },
      nextcloud: NEXTCLOUD,
    },
    fetch: nc.fetch,
    instanceAdmin: true,
  });
  // Bootstrapped: the next login is a normal sign-up.
  await ctx.deps.db.insert(userIdentities).values({
    provider: 'oidc',
    subject: 'robert@example.org',
    userId: ctx.ownerId,
    email: 'robert@example.org',
  });
}

describe('Nextcloud login', () => {
  it('is listed when the organisation Nextcloud has an OAuth client', async () => {
    await nextcloudContext(fakeNextcloud());
    const body = authProvidersSchema.parse(await (await ctx.request('/api/auth/providers')).json());
    expect(body.providers.map((p) => [p.id, p.label, p.loginUrl])).toEqual([
      ['nextcloud', 'Weiter mit Nextcloud', '/api/auth/nextcloud/login'],
    ]);
  });

  it('signs up via the Nextcloud authorize page; server + user id are the identity', async () => {
    const nc = fakeNextcloud();
    await nextcloudContext(nc);
    const start = await ctx.request('/api/auth/nextcloud/login?returnTo=%2Fneu');
    const authorize = location(start);
    expect(authorize.origin + authorize.pathname).toBe(`${SERVER}/index.php/apps/oauth2/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe('nc-client');
    expect(authorize.searchParams.get('redirect_uri')).toBe(NEXTCLOUD.login?.redirectUri);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');

    const res = await nextcloudLogin({ returnTo: '/neu' });
    expect(res.headers.get('location')).toBe('http://localhost:5173/neu');
    const cookie = sessionCookieFrom(res) ?? '';
    const me = (await (await ctx.request('/api/me', { cookie })).json()) as MeResponse;
    expect(me.user?.name).toBe('Lena Berg');
    expect(me.user?.email).toBe('lena@firma.de');
    const [identity] = await ctx.deps.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.provider, 'nextcloud'));
    expect(identity?.subject).toBe(`${SERVER}:lena`);

    // Same Nextcloud user, new address: still the same account.
    nc.user.email = 'lena.berg@firma.de';
    const again = sessionCookieFrom(await nextcloudLogin()) ?? '';
    const meAgain = (await (await ctx.request('/api/me', { cookie: again })).json()) as MeResponse;
    expect(meAgain.user?.id).toBe(me.user?.id);
  });

  it('does not count for sign-up by domain: people set their own address in Nextcloud', async () => {
    await nextcloudContext(fakeNextcloud(), { signup: 'domains', signupDomains: ['firma.de'] });
    expect((await nextcloudLogin()).headers.get('location')).toMatch(/error=signup_closed/);
  });

  it('needs an address', async () => {
    await nextcloudContext(fakeNextcloud({ email: null }));
    expect((await nextcloudLogin()).headers.get('location')).toMatch(/error=no_email/);
  });

  it('a denied consent or a wrong state goes back to /login with an error', async () => {
    const nc = fakeNextcloud();
    await nextcloudContext(nc);
    const denied = await nextcloudLogin({}, { error: 'access_denied' });
    expect(denied.headers.get('location')).toMatch(/error=denied/);
    const forged = await ctx.request('/api/auth/nextcloud/callback?state=forged&code=nc-code');
    expect(forged.headers.get('location')).toMatch(/error=failed/);
    expect(nc.requests).toEqual([]);
  });

  it('refuses an answer whose user differs from the token', async () => {
    const nc = fakeNextcloud();
    nc.tokenUserId = 'someone-else';
    await nextcloudContext(nc);
    expect((await nextcloudLogin()).headers.get('location')).toMatch(/error=failed/);
  });

  it('signed in, intent=connect links Nextcloud to the account', async () => {
    await nextcloudContext(fakeNextcloud({ email: 'robert@example.org' }));
    const owner = await signedInUser(ctx, { name: 'Robert', email: 'robert@example.org' });
    const res = await nextcloudLogin({
      returnTo: '/konto',
      cookie: owner.cookie,
      intent: 'connect',
    });
    expect(res.headers.get('location')).toBe('http://localhost:5173/konto');
    expect(sessionCookieFrom(res)).toBeNull();
    const identities = (await (
      await ctx.request('/api/me/identities', { cookie: owner.cookie })
    ).json()) as LoginIdentity[];
    expect(identities.map((i) => i.id)).toContain(`nextcloud:${SERVER}:lena`);

    const cookie = sessionCookieFrom(await nextcloudLogin()) ?? '';
    const me = (await (await ctx.request('/api/me', { cookie })).json()) as MeResponse;
    expect(me.user?.id).toBe(owner.user.id);
  });

  it('is 404 without a Nextcloud OAuth client', async () => {
    ctx = await createTestContext({
      config: { nextcloud: { server: SERVER, login: null, loginAnyServer: false } },
    });
    expect((await ctx.request('/api/auth/nextcloud/login')).status).toBe(404);
  });
});

describe('Nextcloud login config', () => {
  const base = { NODE_ENV: 'test', NEXTCLOUD_URL: 'https://cloud.firma.de/' };

  it('builds the client from NEXTCLOUD_CLIENT_* and counts as a login', () => {
    const config = loadConfig(
      { ...base, NEXTCLOUD_CLIENT_ID: 'id', NEXTCLOUD_CLIENT_SECRET: 'secret' },
      () => {},
    );
    expect(config.nextcloud).toEqual({
      server: 'https://cloud.firma.de',
      login: {
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: 'http://localhost:5173/api/auth/nextcloud/callback',
      },
      loginAnyServer: true,
    });
    expect(hasLogin(config)).toBe(true);
  });

  it('needs both halves and NEXTCLOUD_URL', () => {
    expect(() => loadConfig({ ...base, NEXTCLOUD_CLIENT_ID: 'id' }, () => {})).toThrow(
      /NEXTCLOUD_CLIENT_SECRET/,
    );
    expect(() =>
      loadConfig(
        { NODE_ENV: 'test', NEXTCLOUD_CLIENT_ID: 'id', NEXTCLOUD_CLIENT_SECRET: 's' },
        () => {},
      ),
    ).toThrow(/NEXTCLOUD_URL/);
  });
});
