import { afterEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  authProvidersSchema,
  ssoLoginSchema,
  workspaceSsoSchema,
  type MeResponse,
  type WorkspaceSso,
} from '@slider/shared';
import type { Config } from '../src/config';
import { SSO_LOGINS_PER_HOUR } from '../src/routes/auth';
import { userIdentities, workspaceMembers, workspaces, workspaceSso } from '../src/db/schema';
import type { FetchLike } from '../src/sources/safe-fetch';
import {
  createTestContext,
  fakeJwt,
  sessionCookieFrom,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

const ISSUER = 'https://login.firma.de/realms/firma';
const REDIRECT_URI = 'http://localhost:5173/api/auth/sso/callback';

let ctx: TestContext;
afterEach(() => ctx.cleanup());

interface FakeIdp {
  fetch: FetchLike;
  claims: Record<string, unknown>;
  nonce: string;
  requests: string[];
}

/** The workspace's provider (no network). */
function fakeIdp(claims: Record<string, unknown> = {}): FakeIdp {
  const idp: FakeIdp = {
    nonce: '',
    requests: [],
    claims: {
      iss: ISSUER,
      aud: 'slider-client',
      sub: 'kc-ben',
      email: 'ben@firma.de',
      email_verified: true,
      name: 'Ben Krause',
      ...claims,
    },
    fetch: async (input) => {
      const url = String(input);
      idp.requests.push(url);
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
          token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        });
      }
      if (url === `${ISSUER}/protocol/openid-connect/token`) {
        return Response.json({
          id_token: fakeJwt({
            exp: Math.floor(Date.now() / 1000) + 300,
            nonce: idp.nonce,
            ...idp.claims,
          }),
        });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return idp;
}

/** TXT records the fake DNS answers with, per name. */
let txt: Record<string, string[][]> = {};

async function context(idp: FakeIdp, auth: Partial<Config['auth']> = {}) {
  txt = {};
  ctx = await createTestContext({
    config: { auth: { ...testConfig().auth, devLogin: false, signup: 'company', ...auth } },
    fetch: idp.fetch,
    resolveTxt: async (name) => txt[name] ?? [],
    instanceAdmin: true,
  });
}

/** Anna, admin of a paid workspace opened to firma.de. */
async function companyAdmin(plan = 'paid') {
  const { user, cookie } = await signedInUser(ctx, { name: 'Anna Becker', email: 'anna@firma.de' });
  const res = await ctx.request('/api/workspaces', {
    method: 'POST',
    cookie,
    json: { name: 'Firma' },
  });
  const { id } = (await res.json()) as { id: string };
  await ctx.deps.db.update(workspaces).set({ plan }).where(eq(workspaces.id, id));
  const domain = await ctx.request(`/api/workspaces/${id}/domain`, {
    method: 'PUT',
    cookie,
    json: { enabled: true },
  });
  expect(domain.status).toBe(200);
  return { user, cookie, workspaceId: id };
}

const saveSso = (workspaceId: string, cookie: string, body: Record<string, unknown> = {}) =>
  ctx.request(`/api/workspaces/${workspaceId}/sso`, {
    method: 'PUT',
    cookie,
    json: { issuer: `${ISSUER}/`, clientId: 'slider-client', clientSecret: 'kc-secret', ...body },
  });

/** Saved and its domain proven by the TXT record. */
async function activeSso() {
  const admin = await companyAdmin();
  const saved = workspaceSsoSchema.parse(
    await (await saveSso(admin.workspaceId, admin.cookie)).json(),
  );
  txt[saved.dnsRecord!.name] = [[saved.dnsRecord!.value]];
  const verified = await ctx.request(`/api/workspaces/${admin.workspaceId}/sso/verify`, {
    method: 'POST',
    cookie: admin.cookie,
  });
  expect(verified.status).toBe(200);
  return admin;
}

/** discover → login → (fake provider) → callback. */
async function ssoLogin(idp: FakeIdp, email = 'ben@firma.de', returnTo = '/') {
  const found = await ctx.request('/api/auth/sso/discover', { method: 'POST', json: { email } });
  expect(found.status).toBe(200);
  const { loginUrl } = ssoLoginSchema.parse(await found.json());
  const start = await ctx.request(`${loginUrl}&returnTo=${encodeURIComponent(returnTo)}`);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  idp.nonce = authorize.searchParams.get('nonce') ?? '';
  const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const params = new URLSearchParams({
    state: authorize.searchParams.get('state') ?? '',
    code: 'the-code',
  });
  return {
    authorize,
    callback: await ctx.request(`/api/auth/sso/callback?${params.toString()}`, {
      cookie: stateCookie,
    }),
  };
}

const me = async (cookie: string) =>
  (await (await ctx.request('/api/me', { cookie })).json()) as MeResponse;

describe('company login per workspace (BER-162)', () => {
  it('is set up by an admin: discovery checked, secret kept back, domain proven by DNS', async () => {
    const idp = fakeIdp();
    await context(idp);
    const admin = await companyAdmin();

    const empty = workspaceSsoSchema.parse(
      await (
        await ctx.request(`/api/workspaces/${admin.workspaceId}/sso`, { cookie: admin.cookie })
      ).json(),
    );
    expect(empty).toMatchObject({
      configured: false,
      redirectUri: REDIRECT_URI,
      domain: 'firma.de',
      dnsRecord: null,
      available: true,
      active: false,
    });

    const res = await saveSso(admin.workspaceId, admin.cookie);
    expect(res.status).toBe(200);
    const saved: WorkspaceSso = workspaceSsoSchema.parse(await res.json());
    expect(idp.requests).toContain(`${ISSUER}/.well-known/openid-configuration`);
    expect(saved).toMatchObject({
      configured: true,
      issuer: ISSUER,
      clientId: 'slider-client',
      hasSecret: true,
      verified: false,
      active: false,
    });
    expect(JSON.stringify(saved)).not.toContain('kc-secret');
    expect(saved.dnsRecord?.name).toBe('_slider-sso.firma.de');
    expect(saved.dnsRecord?.value).toMatch(/^slider-sso=[\w-]{20,}$/);
    // Encrypted at rest.
    const [stored] = await ctx.deps.db
      .select({ raw: sql<string>`client_secret` })
      .from(workspaceSso);
    expect(stored?.raw).toBeTruthy();
    expect(stored?.raw).not.toContain('kc-secret');

    // Not yet in DNS.
    const missing = await ctx.request(`/api/workspaces/${admin.workspaceId}/sso/verify`, {
      method: 'POST',
      cookie: admin.cookie,
    });
    expect(missing.status).toBe(400);
    expect(
      await ctx.request('/api/auth/sso/discover', {
        method: 'POST',
        json: { email: 'ben@firma.de' },
      }),
    ).toHaveProperty('status', 404);

    txt['_slider-sso.firma.de'] = [['v=spf1 -all'], [saved.dnsRecord!.value]];
    const verified = workspaceSsoSchema.parse(
      await (
        await ctx.request(`/api/workspaces/${admin.workspaceId}/sso/verify`, {
          method: 'POST',
          cookie: admin.cookie,
        })
      ).json(),
    );
    expect(verified).toMatchObject({ verified: true, active: true });
    const providers = authProvidersSchema.parse(
      await (await ctx.request('/api/auth/providers')).json(),
    );
    expect(providers.sso).toBe(true);

    // Saving again without a secret keeps it, and the proof stays.
    const again = await saveSso(admin.workspaceId, admin.cookie, { clientSecret: undefined });
    expect(workspaceSsoSchema.parse(await again.json())).toMatchObject({ active: true });
  });

  it('signs a new colleague up and into the workspace, then in again as the same account', async () => {
    const idp = fakeIdp();
    await context(idp);
    const admin = await activeSso();

    const { authorize, callback } = await ssoLogin(idp, 'Ben@Firma.de', '/decks');
    expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: 'slider-client',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
    });
    expect(callback.headers.get('location')).toBe('http://localhost:5173/decks');
    const cookie = sessionCookieFrom(callback) ?? '';
    const body = await me(cookie);
    expect(body.user).toMatchObject({ email: 'ben@firma.de', name: 'Ben Krause' });
    // In the company's workspace, no own one founded.
    expect(body.workspaces).toEqual([
      expect.objectContaining({ id: admin.workspaceId, role: 'member' }),
    ]);
    const identities = await ctx.deps.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, body.user!.id));
    expect(identities).toEqual([
      expect.objectContaining({ provider: 'sso', subject: `${admin.workspaceId}:kc-ben` }),
    ]);

    const again = await ssoLogin(idp);
    expect((await me(sessionCookieFrom(again.callback) ?? '')).user?.id).toBe(body.user?.id);
  });

  it('signs into an existing account at the domain that signs in another way, and links to it', async () => {
    const idp = fakeIdp({ sub: 'kc-anna', email: 'anna@firma.de', name: 'Anna' });
    await context(idp);
    const admin = await activeSso();
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'google',
      subject: 'google-anna',
      userId: admin.user.id,
      email: 'anna@firma.de',
    });

    const { callback } = await ssoLogin(idp, 'anna@firma.de');
    expect((await me(sessionCookieFrom(callback) ?? '')).user?.id).toBe(admin.user.id);
    const providers = await ctx.deps.db
      .select({ provider: userIdentities.provider })
      .from(userIdentities)
      .where(eq(userIdentities.userId, admin.user.id));
    expect(providers.map((row) => row.provider).sort()).toEqual(['google', 'sso']);
  });

  it('refuses addresses outside the domain and logins after the domain changed', async () => {
    const idp = fakeIdp({ email: 'mallory@elsewhere.de' });
    await context(idp);
    const admin = await activeSso();

    const outside = await ssoLogin(idp);
    expect(outside.callback.headers.get('location')).toContain('/login?error=sso_domain');
    expect(sessionCookieFrom(outside.callback)).toBeNull();

    // Private again: the proof was for the domain, the login is off.
    await ctx.request(`/api/workspaces/${admin.workspaceId}/domain`, {
      method: 'PUT',
      cookie: admin.cookie,
      json: { enabled: false },
    });
    const found = await ctx.request('/api/auth/sso/discover', {
      method: 'POST',
      json: { email: 'ben@firma.de' },
    });
    expect(found.status).toBe(404);
    const direct = await ctx.request(`/api/auth/sso/login?workspace=${admin.workspaceId}`);
    expect(direct.headers.get('location')).toContain('/login?error=sso_unavailable');
    expect(
      authProvidersSchema.parse(await (await ctx.request('/api/auth/providers')).json()).sso,
    ).toBe(false);
  });

  it('needs a new secret and a new DNS proof for another provider', async () => {
    const idp = fakeIdp();
    await context(idp);
    const admin = await activeSso();
    const oldRecord = txt['_slider-sso.firma.de']![0]![0]!;

    // The stored secret never goes to another client.
    const noSecret = await saveSso(admin.workspaceId, admin.cookie, {
      clientId: 'other-client',
      clientSecret: undefined,
    });
    expect(noSecret.status).toBe(400);

    const other = workspaceSsoSchema.parse(
      await (
        await saveSso(admin.workspaceId, admin.cookie, {
          clientId: 'other-client',
          clientSecret: 'other-secret',
        })
      ).json(),
    );
    expect(other).toMatchObject({ verified: false, active: false });
    expect(other.dnsRecord?.value).not.toBe(oldRecord);
    const found = await ctx.request('/api/auth/sso/discover', {
      method: 'POST',
      json: { email: 'ben@firma.de' },
    });
    expect(found.status).toBe(404);

    // The old TXT record proves nothing for it.
    const stale = await ctx.request(`/api/workspaces/${admin.workspaceId}/sso/verify`, {
      method: 'POST',
      cookie: admin.cookie,
    });
    expect(stale.status).toBe(400);
  });

  it('is for admins of paid workspaces on the hosted instance, with a public https issuer', async () => {
    const idp = fakeIdp();
    await context(idp);
    const admin = await companyAdmin('free');
    const free = await saveSso(admin.workspaceId, admin.cookie);
    expect(free.status).toBe(403);
    expect(await free.json()).toMatchObject({ error: { code: 'plan_limit' } });

    await ctx.deps.db
      .update(workspaces)
      .set({ plan: 'paid' })
      .where(eq(workspaces.id, admin.workspaceId));
    const member = await signedInUser(ctx, { name: 'Ben', email: 'ben@firma.de' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: admin.workspaceId, userId: member.user.id, role: 'member' });
    expect((await saveSso(admin.workspaceId, member.cookie)).status).toBe(403);
    expect(
      (await ctx.request(`/api/workspaces/${admin.workspaceId}/sso`, { cookie: member.cookie }))
        .status,
    ).toBe(403);

    // Plain http and unanswered discovery are refused.
    expect(
      (await saveSso(admin.workspaceId, admin.cookie, { issuer: 'http://login.firma.de' })).status,
    ).toBe(400);
    expect(
      (await saveSso(admin.workspaceId, admin.cookie, { issuer: 'https://login.firma.de/nothing' }))
        .status,
    ).toBe(400);
    expect(await ctx.deps.db.select().from(workspaceSso)).toEqual([]);
  });

  it('never calls internal addresses', async () => {
    const idp = fakeIdp();
    txt = {};
    ctx = await createTestContext({
      config: { auth: { ...testConfig().auth, devLogin: false, signup: 'company' } },
      fetch: idp.fetch,
      lookup: async () => [{ address: '10.0.0.5' }],
      instanceAdmin: true,
    });
    const admin = await companyAdmin();
    expect((await saveSso(admin.workspaceId, admin.cookie)).status).toBe(400);
    expect(idp.requests).toEqual([]);
  });

  it('caps company-login starts per address, back to the login page without asking the provider', async () => {
    const idp = fakeIdp();
    await context(idp);
    const admin = await activeSso();
    for (let i = 0; i < SSO_LOGINS_PER_HOUR; i++) {
      const res = await ctx.request('/api/auth/sso/login?workspace=unknown');
      expect(res.headers.get('location')).toContain('/login?error=sso_unavailable');
    }
    const asked = idp.requests.length;
    const refused = await ctx.request(`/api/auth/sso/login?workspace=${admin.workspaceId}`);
    expect(refused.status).toBe(302);
    expect(refused.headers.get('location')).toContain('/login?error=rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(idp.requests).toHaveLength(asked);

    ctx.clock.advance(60 * 60_000);
    const later = await ctx.request(`/api/auth/sso/login?workspace=${admin.workspaceId}`);
    expect(later.headers.get('location')).toContain(`${ISSUER}/protocol/openid-connect/auth`);
    // Links from before the rename to Workspace still carry `?organisation=`.
    const old = await ctx.request(`/api/auth/sso/login?organisation=${admin.workspaceId}`);
    expect(old.headers.get('location')).toContain(`${ISSUER}/protocol/openid-connect/auth`);
  });

  it('is gone with its workspace, and admins can delete it', async () => {
    const idp = fakeIdp();
    await context(idp);
    const admin = await activeSso();
    const res = await ctx.request(`/api/workspaces/${admin.workspaceId}/sso`, {
      method: 'DELETE',
      cookie: admin.cookie,
    });
    expect(res.status).toBe(204);
    expect(
      await ctx.deps.db
        .select()
        .from(workspaceSso)
        .where(and(eq(workspaceSso.workspaceId, admin.workspaceId))),
    ).toEqual([]);
  });
});
