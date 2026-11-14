import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import {
  authProvidersSchema,
  createdWorkspaceInviteSchema,
  deckEditStateSchema,
  DESKTOP_SECRET_HEADER,
  SETUP_TOKEN_HEADER,
  type CloudSession,
  type CloudStatus,
  type DeckEditState,
  type MeResponse,
} from '@slider/shared';
import { z } from 'zod';
import { SESSION_MAX_AGE_MS } from '../src/auth/session';
import { signInWithIdentity } from '../src/services/accounts';
import type { Config, OidcConfig } from '../src/config';
import { encryptToken } from '../src/auth/token-crypto';
import {
  decks,
  googleConnections,
  microsoftConnections,
  sessions,
  userIdentities,
  users,
} from '../src/db/schema';
import { silentLogger } from '../src/logger';
import { retireFileConnections } from '../src/services/retired-connections';
import { ensureSetupToken, setupGrant } from '../src/services/instance-settings';
import { purgeStaleRows } from '../src/services/retention';
import type { FetchLike } from '../src/sources/safe-fetch';
import {
  cookiePair,
  createReadyDeck,
  createTestContext,
  fakeJwt,
  MICROSOFT_TEST_CONFIG,
  sessionCookieFrom,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';

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
  it('lists the configured logins and the sign-up mode', async () => {
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
      desktop: false,
      signup: 'domains',
      needsSetup: false,
      setupPending: false,
      nextcloudAnyServer: false,
      sso: false,
      // No mail on this instance: no login links (BER-168).
      emailLogin: false,
    });

    // Open sign-up while the instance has no admin, then SIGNUP again.
    await ctx.cleanup();
    ctx = await createTestContext({ config: authConfig({ oidc: OIDC, signup: 'invite' }) });
    const signup = async () =>
      authProvidersSchema.parse(await (await ctx.request('/api/auth/providers')).json()).signup;
    expect(await signup()).toBe('open');
    await ctx.deps.db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, ctx.ownerId));
    expect(await signup()).toBe('invite');
  });
});

describe('sessions', () => {
  it('answers 401 to anonymous callers (no guests), signs in with the cookie, renews at most daily, expires and logs out', async () => {
    ctx = await createTestContext({ config: authConfig() });
    expect((await me()).status).toBe(401);
    expect(await (await ctx.request('/api/decks')).json()).toMatchObject({
      error: { code: 'unauthorized' },
    });
    const { deckId } = await createReadyDeck(ctx);
    expect((await ctx.request(`/api/decks/${deckId}`)).status).toBe(401);

    // Every registered private API route must authenticate, including newly added routes.
    // Public login/contact endpoints, OAuth for AI apps and short-lived bearer-capability endpoints
    // are separate.
    const publicRoute = (method: string, route: string) =>
      /^\/api\/(?:auth\/|oauth\/|setup(?:\/|$)|site-live(?:\/|$)|contact$|data-requests(?:\/|$)|join\/|billing\/webhook$|csp-report$|health$)/.test(
        route,
      ) ||
      (method === 'GET' && route === '/api/legal') ||
      (method === 'POST' &&
        /^\/api\/live\/:key(?:\/leave|\/text\/:elementId(?:\/leave)?)?$/.test(route));
    const privateRoutes = new Map(
      ctx.app.routes
        .filter(
          (route) =>
            /^(GET|POST|PUT|PATCH|DELETE)$/.test(route.method) &&
            route.path.startsWith('/api/') &&
            !publicRoute(route.method, route.path),
        )
        .map((route) => [`${route.method} ${route.path}`, route]),
    );
    expect(privateRoutes.size).toBeGreaterThan(100);
    for (const route of privateRoutes.values()) {
      const url = route.path.replace(
        /:([A-Za-z0-9_]+)(?:\{([^}]+)\})?/g,
        (_match, name: string, pattern: string | undefined) =>
          pattern
            ? pattern.split('|')[0]!
            : name === 'deckId'
              ? deckId
              : name === 'part'
                ? 'file'
                : '00000000-0000-4000-8000-000000000001',
      );
      const response = await ctx.request(url, {
        method: route.method,
        headers: { 'Tus-Resumable': '1.0.0' },
      });
      expect(response.status, `${route.method} ${route.path} must require a session`).toBe(401);
      if (route.method === 'GET')
        expect(
          (await ctx.request(url, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } }))
            .status,
          `HEAD ${route.path}`,
        ).toBe(401);
    }

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
    });
    expect(body.workspaces).toEqual([
      expect.objectContaining({ name: 'Mein Workspace', role: 'admin', memberCount: 1 }),
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

    // Unused for 31 days: expired.
    const idle = await signedInUser(ctx, { name: 'R', email: 'r2@example.org' });
    ctx.clock.advance(31 * DAY_MS);
    expect((await me(idle.cookie)).status).toBe(401);

    // The desktop app signs in to this server like Figma (BER-201): its local server starts, the
    // browser asks for a code, the app trades it once with the verifier only it knows.
    // A claimed server (an unclaimed one hands out nothing before its setup).
    const cloud = await createTestContext({
      config: authConfig(),
      instanceAdmin: true,
      libreOfficePdf: fakeOdpPdf(),
    });
    const dataDir = await mkdtemp(path.join(tmpdir(), 'slider-desktop-'));
    let offline = false;
    const local = await createTestContext({
      // The desktop's dev login: its one person.
      config: { desktop: true, cloudUrl: 'http://cloud.test', dataDir },
      libreOfficePdf: fakeOdpPdf(),
      cloudFetch: async (url, init) => {
        if (offline) throw new TypeError('fetch failed');
        // A self-hosted Slider (the same server under another address), a page that is no
        // Slider, and one that is not there.
        const at = ['http://cloud.test', 'http://localhost:7'].find((s) => url.startsWith(s));
        if (at) return cloud.request(url.slice(at.length), init);
        if (url.startsWith('http://127.0.0.1:5')) return new Response('nope', { status: 404 });
        throw new TypeError('fetch failed');
      },
    });
    try {
      const status = async () => (await local.request('/api/desktop/cloud')).json();
      expect(await status()).toEqual({
        server: 'http://cloud.test',
        account: null,
        sync: null,
        cloudDecks: {},
      });
      const start = async () => {
        const { url } = (await (
          await local.request('/api/desktop/cloud/start', { method: 'POST' })
        ).json()) as { url: string };
        const page = new URL(url);
        expect(page.origin + page.pathname).toBe('http://cloud.test/desktop-anmelden');
        return {
          challenge: page.searchParams.get('challenge') ?? '',
          state: page.searchParams.get('state') ?? '',
        };
      };
      const desktop = await signedInUser(cloud, { name: 'Dana Desk', email: 'dana@example.org' });
      // Dana's team on the server has a deck, this machine one of its own.
      const teamSpace = z.object({ id: z.string() }).parse(
        await (
          await cloud.request('/api/workspaces', {
            method: 'POST',
            cookie: desktop.cookie,
            json: { name: 'Dana Team' },
          })
        ).json(),
      );
      await cloud.request(`/api/decks/upload?workspaceId=${teamSpace.id}`, {
        method: 'POST',
        cookie: desktop.cookie,
        body: odpForm(DEMO_ODP, 'Team.odp'),
      });
      await local.request('/api/decks/upload', {
        method: 'POST',
        body: odpForm(DEMO_ODP, 'Hier.odp'),
      });
      await Promise.all([local.deps.queue.idle(), cloud.deps.queue.idle()]);
      // This machine's file is on the server already (where its workspace goes): the upload finds
      // it (the server dedupes bytes) – one deck on each side, not brought back as a second.
      const [hier] = z
        .array(z.object({ id: z.string() }))
        .parse(await (await local.request('/api/decks')).json());
      const hierFile = await local.request(`/api/decks/${hier!.id}/file`);
      await cloud.request(`/api/decks/upload?workspaceId=${teamSpace.id}`, {
        method: 'POST',
        cookie: desktop.cookie,
        body: odpForm(new Uint8Array(await hierFile.arrayBuffer()), 'Hier.odp'),
      });
      await cloud.deps.queue.idle();
      const askCode = async (challenge: string, cookie?: string) =>
        cloud.request('/api/auth/desktop/code', { method: 'POST', cookie, json: { challenge } });
      const first = await start();
      // Signed out: no code (the instance gate answers before the login does).
      expect(await (await askCode(first.challenge)).json()).not.toHaveProperty('code');
      const { code } = (await (await askCode(first.challenge, desktop.cookie)).json()) as {
        code: string;
      };
      const finish = (state: string) =>
        local.request('/api/desktop/cloud/finish', { method: 'POST', json: { code, state } });
      expect((await finish('not-started')).status).toBe(404);
      expect(await (await finish(first.state)).json()).toMatchObject({
        server: 'http://cloud.test',
        account: { name: 'Dana Desk', email: 'dana@example.org', color: expect.any(String) },
      });
      expect(await status()).toMatchObject({ account: { name: 'Dana Desk' } });
      // The token is kept sealed, and only this app's session has it.
      const stored = JSON.parse(await readFile(path.join(dataDir, 'cloud.json'), 'utf8')) as {
        token: string;
      };
      expect(stored.token).toMatch(/^slenc3:/);
      const sessionsOf = async () =>
        (await cloud.deps.db.select().from(sessions).where(eq(sessions.userId, desktop.user.id)))
          .map((row) => row.userAgent)
          .sort();
      expect(await sessionsOf()).toHaveLength(2);
      expect(await sessionsOf()).toContain('Slider Desktop');
      // Reaching 127.0.0.1 is not enough: another browser has no page cookie, a page rebound
      // to 127.0.0.1 (DNS rebinding) names its own host. The health check stays open.
      const stranger = { headers: { cookie: 'other=1' } };
      expect((await local.request('/api/workspaces', stranger)).status).toBe(403);
      expect((await local.request('/api/health', stranger)).status).toBe(200);
      expect((await local.request('http://evil.test:47821/api/workspaces')).status).toBe(403);
      expect((await local.request('http://127.0.0.1:47821/api/workspaces')).status).toBe(200);
      // Electron alone gets the token, for the server's pages in its tabs.
      expect((await local.request('/api/desktop/cloud/session')).status).toBe(403);
      const session = (await (
        await local.request('/api/desktop/cloud/session', {
          headers: { [DESKTOP_SECRET_HEADER]: local.deps.config.secret },
        })
      ).json()) as { token: string };
      expect(
        (await cloud.request('/api/workspaces', { cookie: `slider_session=${session.token}` }))
          .status,
      ).toBe(200);
      // Signed in, both hold the same (BER-201): this machine's first workspace goes into the
      // account's, decks new on either side are made on the other.
      const pass = async () => {
        await local.request('/api/desktop/cloud/sync', { method: 'POST' });
        await Promise.all([local.deps.queue.idle(), cloud.deps.queue.idle()]);
      };
      const deckIn = async (ctx: TestContext, cookie?: string) =>
        z
          .array(z.object({ id: z.string(), title: z.string() }))
          .parse(await (await ctx.request('/api/decks', { cookie })).json());
      const stateIn = async (ctx: TestContext, deckId: string, cookie?: string) =>
        deckEditStateSchema.parse(
          await (await ctx.request(`/api/decks/${deckId}/edit`, { cookie })).json(),
        );
      await pass();
      await pass();
      expect((await deckIn(local)).map((deck) => deck.title).sort()).toEqual(['Hier', 'Team']);
      expect((await deckIn(cloud, desktop.cookie)).map((deck) => deck.title).sort()).toEqual([
        'Hier',
        'Team',
      ]);
      const pair = async (title: string) => ({
        here: (await deckIn(local)).find((deck) => deck.title === title)!.id,
        there: (await deckIn(cloud, desktop.cookie)).find((deck) => deck.title === title)!.id,
      });
      const team = await pair('Team');
      // Online the tabs show the server's pages: Electron learns which deck is which there.
      const ids = (await (
        await local.request('/api/desktop/cloud/session', {
          headers: { [DESKTOP_SECRET_HEADER]: local.deps.config.secret },
        })
      ).json()) as CloudSession;
      expect(ids.decks[team.here]).toBe(team.there);
      expect(Object.keys(ids.workspaces)).toHaveLength(1);
      // Edited here: the step goes there as its operations.
      const titleOf = (state: DeckEditState) =>
        state.slides[0]!.elements.find((item) => item.role === 'title')!;
      const titleId = titleOf(await stateIn(local, team.here)).id;
      await local.request(`/api/decks/${team.here}/edit/operations`, {
        method: 'POST',
        json: {
          baseSeq: 0,
          operations: [{ type: 'setText', elementId: titleId, paragraphs: ['Von hier'] }],
        },
      });
      await pass();
      const there = await stateIn(cloud, team.there, desktop.cookie);
      expect(there.seq).toBe(1);
      expect(titleOf(there).paragraphs).toEqual(['Von hier']);
      // Edited there: the copy takes it in as a new version.
      await cloud.request(`/api/decks/${team.there}/edit/operations`, {
        method: 'POST',
        cookie: desktop.cookie,
        json: {
          baseSeq: 1,
          operations: [{ type: 'setText', elementId: titleId, paragraphs: ['Von dort'] }],
        },
      });
      await pass();
      await pass();
      expect(titleOf(await stateIn(local, team.here)).paragraphs).toEqual(['Von dort']);
      // Offline the edit waits here; with the connection back it goes up.
      offline = true;
      await local.request(`/api/decks/${team.here}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [{ type: 'setText', elementId: titleId, paragraphs: ['Im Zug'] }],
        },
      });
      await pass();
      expect(await status()).toMatchObject({ sync: { state: 'offline' } });
      offline = false;
      await pass();
      expect(titleOf(await stateIn(cloud, team.there, desktop.cookie)).paragraphs).toEqual([
        'Im Zug',
      ]);
      // Renamed here: there too; renamed there: here too.
      await local.request(`/api/decks/${team.here}`, {
        method: 'PATCH',
        json: { title: 'Team 2' },
      });
      await pass();
      expect((await deckIn(cloud, desktop.cookie)).map((deck) => deck.title)).toContain('Team 2');
      await cloud.request(`/api/decks/${team.there}`, {
        method: 'PATCH',
        cookie: desktop.cookie,
        json: { title: 'Team' },
      });
      await pass();
      expect((await deckIn(local)).map((deck) => deck.title)).toContain('Team');
      // Deleted there: gone here.
      const here = await pair('Hier');
      await cloud.request(`/api/decks/${here.there}`, { method: 'DELETE', cookie: desktop.cookie });
      await pass();
      expect((await deckIn(local)).map((deck) => deck.title)).toEqual(['Team']);
      // One of the account's decks marked „Auf diesem Gerät behalten“; decks made here need none.
      // Other bytes: the same file twice in a workspace is one deck.
      const other = async (note: string) => {
        const zip = await JSZip.loadAsync(DEMO_ODP);
        zip.file('note.txt', note);
        return zip.generateAsync({ type: 'uint8array' });
      };
      await cloud.request(`/api/decks/upload?workspaceId=${teamSpace.id}`, {
        method: 'POST',
        cookie: desktop.cookie,
        body: odpForm(await other('Mitnehmen'), 'Mitnehmen.odp'),
      });
      await local.request('/api/decks/upload', {
        method: 'POST',
        body: odpForm(await other('Eigene'), 'Eigene.odp'),
      });
      await Promise.all([local.deps.queue.idle(), cloud.deps.queue.idle()]);
      await pass();
      await pass();
      const keepIt = await pair('Mitnehmen');
      const own = await pair('Eigene');
      expect(Object.keys(((await status()) as CloudStatus).cloudDecks ?? {}).sort()).toEqual(
        [team.here, keepIt.here].sort(),
      );
      const keep = (deckId: string) =>
        local.request(`/api/desktop/cloud/decks/${deckId}/keep`, {
          method: 'PUT',
          json: { keep: true },
        });
      expect(
        ((await (await keep(keepIt.here)).json()) as CloudStatus).cloudDecks?.[keepIt.here],
      ).toEqual({
        keep: true,
      });
      expect((await keep(own.here)).status).toBe(404);
      // Taken once; never without the verifier; never after five minutes.
      const trade = (body: { code: string; verifier: string }) =>
        cloud.request('/api/auth/desktop/token', { method: 'POST', json: body });
      const someVerifier = 'v'.repeat(43);
      expect(await (await trade({ code, verifier: someVerifier })).json()).toMatchObject({
        error: { code: 'invalid_code' },
      });
      const second = await start();
      const late = (await (await askCode(second.challenge, desktop.cookie)).json()) as {
        code: string;
      };
      expect((await trade({ code: late.code, verifier: someVerifier })).status).toBe(400);
      expect((await trade({ code: `${late.code}x`, verifier: someVerifier })).status).toBe(400);
      cloud.clock.advance(6 * 60_000);
      expect(
        (
          await local.request('/api/desktop/cloud/finish', {
            method: 'POST',
            json: { code: late.code, state: second.state },
          })
        ).status,
      ).toBe(400);
      // „Abmelden“ forgets the account here and ends the app's session there – the browser stays.
      expect(
        await (await local.request('/api/desktop/cloud', { method: 'DELETE' })).json(),
      ).toEqual({ server: 'http://cloud.test', account: null, sync: null, cloudDecks: {} });
      expect(await sessionsOf()).toHaveLength(1);
      expect(await sessionsOf()).not.toContain('Slider Desktop');
      // Like iCloud: the account's decks left this machine, the kept one and the own one stay.
      expect((await deckIn(local)).map((deck) => deck.title).sort()).toEqual([
        'Eigene',
        'Mitnehmen',
      ]);
      expect(await (await local.request('/api/workspaces')).json()).toHaveLength(1);
      // Signed in again they join their decks there, nothing is uploaded twice.
      const again = await start();
      const { code: againCode } = (await (
        await askCode(again.challenge, desktop.cookie)
      ).json()) as { code: string };
      await local.request('/api/desktop/cloud/finish', {
        method: 'POST',
        json: { code: againCode, state: again.state },
      });
      await pass();
      await pass();
      const titles = ['Eigene', 'Mitnehmen', 'Team'];
      expect((await deckIn(cloud, desktop.cookie)).map((deck) => deck.title).sort()).toEqual(
        titles,
      );
      expect((await deckIn(local)).map((deck) => deck.title).sort()).toEqual(titles);
      // Another server, like Bitwarden: typed as an address, checked to be a Slider before the
      // browser opens – and only once signed out.
      const startAt = (server: string) =>
        local.request('/api/desktop/cloud/start', { method: 'POST', json: { server } });
      expect((await startAt('http://localhost:7')).status).toBe(409);
      // Off the desktop there is no such route.
      expect((await cloud.request('/api/desktop/cloud')).status).toBe(404);
      // A file on this computer is the truth (BER-201): opened, every step goes back into it, a
      // change made elsewhere comes in as a new version; only Electron may name a path.
      const filePath = path.join(dataDir, 'Datei.odp');
      await writeFile(filePath, await other('Datei'));
      const electron = { [DESKTOP_SECRET_HEADER]: local.deps.config.secret };
      const open = (headers: Record<string, string>) =>
        local.request('/api/desktop/files/open', {
          method: 'POST',
          headers,
          json: { path: filePath },
        });
      expect((await open({})).status).toBe(403);
      const opened = (await (await open(electron)).json()) as { deckId: string; linked: boolean };
      expect(opened.linked).toBe(true);
      await local.deps.queue.idle();
      // An identical copy of it opened too: a presentation of its own, the first keeps its file.
      const copyPath = path.join(dataDir, 'Kopie.odp');
      await writeFile(copyPath, await readFile(filePath));
      const copy = (await (
        await local.request('/api/desktop/files/open', {
          method: 'POST',
          headers: electron,
          json: { path: copyPath },
        })
      ).json()) as { deckId: string };
      expect(copy.deckId).not.toBe(opened.deckId);
      expect(await (await local.request('/api/desktop/files')).json()).toMatchObject({
        [opened.deckId]: { path: filePath },
        [copy.deckId]: { path: copyPath },
      });
      await local.deps.queue.idle();
      await local.request(`/api/decks/${copy.deckId}`, { method: 'DELETE' });
      // Opened through a symlink: the file it points to, the same presentation.
      const alias = path.join(dataDir, 'Verknüpfung.odp');
      await symlink(filePath, alias);
      const viaAlias = await local.request('/api/desktop/files/open', {
        method: 'POST',
        headers: electron,
        json: { path: alias },
      });
      expect(((await viaAlias.json()) as { deckId: string }).deckId).toBe(opened.deckId);
      const filePass = async () => {
        await local.request('/api/desktop/files/sync', { method: 'POST' });
        await local.deps.queue.idle();
      };
      // A Finder tag on it stays when Slider writes it (macOS: extended attributes).
      const tagged = process.platform === 'darwin';
      if (tagged) execFileSync('/usr/bin/xattr', ['-w', 'org.slider.test', 'rot', filePath]);
      const fileTitle = titleOf(await stateIn(local, opened.deckId)).id;
      await local.request(`/api/decks/${opened.deckId}/edit/operations`, {
        method: 'POST',
        json: {
          baseSeq: 0,
          operations: [{ type: 'setText', elementId: fileTitle, paragraphs: ['In der Datei'] }],
        },
      });
      await filePass();
      const written = await readFile(filePath);
      const answer = await local.request(`/api/decks/${opened.deckId}/file`);
      expect(Buffer.from(await answer.arrayBuffer()).equals(written)).toBe(true);
      if (tagged) {
        expect(
          execFileSync('/usr/bin/xattr', ['-p', 'org.slider.test', filePath], { encoding: 'utf8' }),
        ).toBe('rot\n');
      }
      // Saved elsewhere (LibreOffice): a new version here.
      await writeFile(filePath, await other('Außen'));
      await filePass();
      await filePass();
      expect(
        z
          .array(z.unknown())
          .parse(await (await local.request(`/api/decks/${opened.deckId}/revisions`)).json()),
      ).toHaveLength(2);
      expect(((await (await open(electron)).json()) as { deckId: string }).deckId).toBe(
        opened.deckId,
      );
      expect(await (await local.request('/api/desktop/files')).json()).toEqual({
        [opened.deckId]: { path: filePath, missing: false, changedAt: expect.any(String) },
      });
      // Renamed in its folder: found again.
      const renamedPath = path.join(dataDir, 'Umbenannt.odp');
      await rename(filePath, renamedPath);
      await filePass();
      expect(await (await local.request('/api/desktop/files')).json()).toMatchObject({
        [opened.deckId]: { path: renamedPath, missing: false },
      });
      expect(
        await (
          await local.request(`/api/desktop/files/${opened.deckId}/reveal`, { method: 'POST' })
        ).json(),
      ).toEqual({ path: renamedPath });
      // Deleted here: the file stays.
      await local.request(`/api/decks/${opened.deckId}`, { method: 'DELETE' });
      await filePass();
      expect(await (await local.request('/api/desktop/files')).json()).toEqual({});
      expect((await readFile(renamedPath)).byteLength).toBeGreaterThan(0);
      // „Als Datei sichern …“ to a file not there yet: written at once, linked from then on.
      const savedPath = path.join(dataDir, 'Gesichert.odp');
      const saved = await local.request(`/api/desktop/files/${own.here}/save`, {
        method: 'POST',
        headers: electron,
        json: { path: savedPath },
      });
      expect(await saved.json()).toEqual({
        [own.here]: { path: savedPath, missing: false, changedAt: null },
      });
      const ownFile = await local.request(`/api/decks/${own.here}/file`);
      expect(Buffer.from(await ownFile.arrayBuffer()).equals(await readFile(savedPath))).toBe(true);
      await local.request('/api/desktop/cloud', { method: 'DELETE' });
      const refusal = async (server: string) => {
        const answer = await startAt(server);
        return [
          answer.status,
          ((await answer.json()) as { error: { message: string } }).error.message,
        ];
      };
      expect(await refusal('http://slider.firma.de')).toEqual([
        400,
        'Der Slider-Server muss über https:// erreichbar sein.',
      ]);
      expect(await refusal('http://127.0.0.1:5')).toEqual([
        400,
        'Unter 127.0.0.1:5 läuft kein Slider.',
      ]);
      expect(await refusal('https://weg.test')).toEqual([502, 'weg.test ist nicht erreichbar.']);
      const selfHosted = (await (await startAt('http://localhost:7/egal?x=1')).json()) as {
        url: string;
      };
      const page = new URL(selfHosted.url);
      expect(page.origin + page.pathname).toBe('http://localhost:7/desktop-anmelden');
      // Not before the sign-in is done.
      expect(await status()).toMatchObject({ server: 'http://cloud.test' });
      const { code: hostedCode } = (await (
        await askCode(page.searchParams.get('challenge') ?? '', desktop.cookie)
      ).json()) as { code: string };
      expect(
        await (
          await local.request('/api/desktop/cloud/finish', {
            method: 'POST',
            json: { code: hostedCode, state: page.searchParams.get('state') },
          })
        ).json(),
      ).toMatchObject({ server: 'http://localhost:7', account: { name: 'Dana Desk' } });
      // Signed out, the server stays for the next „Anmelden“ – across restarts too.
      expect(
        await (await local.request('/api/desktop/cloud', { method: 'DELETE' })).json(),
      ).toMatchObject({ server: 'http://localhost:7', account: null });
      expect(JSON.parse(await readFile(path.join(dataDir, 'cloud.json'), 'utf8'))).toEqual({
        server: 'http://localhost:7',
      });
    } finally {
      await local.cleanup();
      await cloud.cleanup();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('ends a session 90 days after its login, however often it is used – old sessions too', async () => {
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

    // Sessions from before the cap end on time too, and the hourly job deletes them.
    const old = await signedInUser(ctx, { name: 'O', email: 'old@example.org' });
    // Renewed the old way: valid for another 30 days, but its login is 91 days ago.
    const now = ctx.clock.now().getTime();
    await ctx.deps.db
      .update(sessions)
      .set({
        createdAt: new Date(now - 91 * DAY_MS),
        expiresAt: new Date(now + 29 * DAY_MS),
      })
      .where(eq(sessions.userId, old.user.id));
    expect((await me(old.cookie)).status).toBe(401);
    await purgeStaleRows(ctx.deps);
    expect(
      await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, old.user.id)),
    ).toEqual([]);
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
    // A workspace of their own right away, named after the company; they are asked whether
    // it is private or the company's (BER-148).
    expect(body.workspaces).toEqual([
      expect.objectContaining({ name: 'Firma', role: 'admin', audiencePending: true }),
    ]);
    // Their own one; on the limited test instance a second (private) one may follow.
    expect(body.limits).toEqual({ canCreateWorkspace: true, domainJoin: true });

    // The same identity signs into the same account again.
    const again = await redirectLogin('oidc', idp);
    expect((await me(sessionCookieFrom(again) ?? '')).body.user?.id).toBe(body.user?.id);
  });

  it('rejects forged, foreign, replayed or expired logins and missing or unverified e-mails', async () => {
    const cases: [Record<string, unknown>, Record<string, string>, string][] = [
      [{}, { state: 'forged' }, 'failed'],
      [{ aud: 'someone-else' }, {}, 'failed'],
      [{ iss: 'https://evil.example.com' }, {}, 'failed'],
      [{ nonce: 'old-nonce' }, {}, 'failed'],
      [{ exp: 1_000 }, {}, 'failed'],
      [{ email_verified: false }, {}, 'email_unverified'],
      [{ email: undefined }, {}, 'no_email'],
      [{}, { error: 'access_denied' }, 'denied'],
    ];
    const idp = fakeOidc();
    await oidcContext(idp, { signup: 'open' });
    const base = idp.claims;
    for (const [claims, tamper, error] of cases) {
      idp.claims = { ...base, ...claims };
      const res = await redirectLogin('oidc', idp, { tamper });
      expect(res.headers.get('location')).toBe(`http://localhost:5173/login?error=${error}`);
      expect(sessionCookieFrom(res)).toBeNull();
    }
  });

  it('applies SIGNUP (invite closed, domains for verified company addresses) and never merges into another login', async () => {
    const idp = fakeOidc();
    await oidcContext(idp);
    const res = await redirectLogin('oidc', idp, { returnTo: '/decks' });
    expect(res.headers.get('location')).toBe(
      'http://localhost:5173/login?error=signup_closed&returnTo=%2Fdecks',
    );
    expect(await ctx.deps.db.select().from(users).where(eq(users.email, 'anna@firma.de'))).toEqual(
      [],
    );

    await ctx.cleanup();
    await oidcContext(idp, { signup: 'domains', signupDomains: ['firma.de'] });
    expect(sessionCookieFrom(await redirectLogin('oidc', idp))).toBeTruthy();
    idp.claims = { ...idp.claims, sub: 'other', email: 'max@gmail.com' };
    expect((await redirectLogin('oidc', idp)).headers.get('location')).toMatch(
      /error=signup_closed/,
    );

    // Never merges into an account that already signs in another way.
    await ctx.cleanup();
    idp.claims = { ...idp.claims, sub: 'oidc-user-2', email: 'robert@example.org' };
    await oidcContext(idp, { signup: 'open' });
    expect((await redirectLogin('oidc', idp)).headers.get('location')).toMatch(
      /error=account_exists/,
    );
  });

  it('lets invited people sign up: by e-mail invite without a workspace of their own, by invite link joining', async () => {
    const idp = fakeOidc();
    await oidcContext(idp);
    const owner = await ownerCookie();
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
      method: 'POST',
      json: { email: 'Anna@Firma.de', role: 'reviewer' },
      cookie: owner,
    });
    const cookie = sessionCookieFrom(await redirectLogin('oidc', idp)) ?? '';
    const { body } = await me(cookie);
    expect(body.workspaces).toEqual([]);
    expect(body.pendingInvites).toEqual([
      expect.objectContaining({ workspaceName: 'Mein Workspace', role: 'reviewer' }),
    ]);

    // Through an invite link (returnTo /join/…).
    idp.claims = { ...idp.claims, sub: 'extern', email: 'extern@agentur.de' };
    const created = createdWorkspaceInviteSchema.parse(
      await (
        await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
          method: 'POST',
          json: { role: 'member' },
          cookie: owner,
        })
      ).json(),
    );
    const joinPath = new URL(created.url).pathname;
    const res = await redirectLogin('oidc', idp, { returnTo: joinPath });
    expect(res.headers.get('location')).toBe(`http://localhost:5173${joinPath}`);
    const joined = sessionCookieFrom(res) ?? '';
    const join = await ctx.request(`/api${joinPath}`, { method: 'POST', cookie: joined });
    expect(join.status).toBe(200);
    expect((await me(joined)).body.workspaces).toEqual([
      expect.objectContaining({ id: ctx.workspaceId, role: 'member' }),
    ]);
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

  it('the first login creates a normal account – never instance admin – and keeps no file token', async () => {
    const idp = fakeMicrosoft();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'slider-auth-ms-'));
    await msContext(idp, { dataDir, auth: { ...authConfig().auth!, signup: 'open' } });
    ensureSetupToken(dataDir);
    // Unclaimed: signed in from the browser that typed in the setup token.
    const grant = `slider_setup=${setupGrant(ctx.deps.config.secret, dataDir)}`;
    const { deckId } = await createReadyDeck(ctx);

    const start = await ctx.request('/api/auth/microsoft/login', { cookie: grant });
    expect(location(start).searchParams.get('scope')).toBe('openid profile email');
    expect(location(start).searchParams.get('nonce')).toMatch(/^[\w-]{43}$/);

    const res = await redirectLogin('microsoft', idp, { returnTo: '/', cookie: grant });
    expect(res.headers.get('location')).toBe('http://localhost:5173/');
    const cookie = sessionCookieFrom(res) ?? '';
    await rm(dataDir, { recursive: true, force: true });
    const { body } = await me(cookie);
    expect(body.user).toMatchObject({
      email: 'robert.hofmann@example.org',
      isInstanceAdmin: false,
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
    expect(await ctx.deps.db.select().from(users).where(eq(users.isInstanceAdmin, true))).toEqual(
      [],
    );

    // File connections from before Google Drive and OneDrive went: revoked at Google, deleted,
    // the deck lets go of them.
    const secret = ctx.deps.config.secret;
    await ctx.deps.db.insert(googleConnections).values({
      id: 'g1',
      userId: ctx.ownerId,
      subject: 'sub-1',
      refreshToken: await encryptToken(secret, 'google-refresh', 'google-refresh-token'),
    });
    await ctx.deps.db.insert(microsoftConnections).values({
      id: 'm1',
      userId: ctx.ownerId,
      subject: 'oid-1',
      refreshToken: await encryptToken(secret, 'ms-refresh'),
    });
    await ctx.deps.db
      .update(decks)
      .set({ googleConnectionId: 'g1', microsoftConnectionId: 'm1' })
      .where(eq(decks.id, deckId));
    const revoked: string[] = [];
    await retireFileConnections({
      db: ctx.deps.db,
      secret,
      log: silentLogger,
      fetch: async (url, init) => {
        revoked.push(`${String(url)} ${String(init?.body)}`);
        return new Response(null, { status: 200 });
      },
    });
    expect(revoked).toEqual(['https://oauth2.googleapis.com/revoke token=google-refresh']);
    expect(await ctx.deps.db.select().from(googleConnections)).toEqual([]);
    expect(await ctx.deps.db.select().from(microsoftConnections)).toEqual([]);
    const [linked] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(linked).toMatchObject({ googleConnectionId: null, microsoftConnectionId: null });
  });

  it('signed in, links the login – no new session; unverified e-mails never sign up', async () => {
    const idp = fakeMicrosoft({ oid: 'oid-lena', preferred_username: 'lena@firma.de' });
    await msContext(idp, {}, { instanceAdmin: true });
    await finishBootstrap();
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const res = await redirectLogin('microsoft', idp, { returnTo: '/neu', cookie: lena.cookie });
    expect(res.headers.get('location')).toBe('http://localhost:5173/neu');
    expect(sessionCookieFrom(res)).toBeNull();
    expect((await me(lena.cookie)).body.user).toMatchObject({ id: lena.user.id });
    const loginsOf = (userId: string) =>
      ctx.deps.db
        .select({ provider: userIdentities.provider })
        .from(userIdentities)
        .where(eq(userIdentities.userId, userId));
    expect(await loginsOf(lena.user.id)).toEqual([{ provider: 'microsoft' }]);

    // Someone else may not take its login.
    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    await redirectLogin('microsoft', idp, { returnTo: '/neu', cookie: max.cookie });
    expect(await loginsOf(max.user.id)).toEqual([]);
    expect(await loginsOf(lena.user.id)).toEqual([{ provider: 'microsoft' }]);

    // An unverified e-mail claim is not taken for sign-up.
    await ctx.cleanup();
    idp.claims = {
      ...idp.claims,
      oid: 'oid-x',
      preferred_username: undefined,
      email: 'robert@example.org',
    };
    await msContext(
      idp,
      { auth: { ...authConfig().auth!, signup: 'open' } },
      { instanceAdmin: true },
    );
    await finishBootstrap();
    expect((await redirectLogin('microsoft', idp)).headers.get('location')).toMatch(
      /error=email_unverified/,
    );
  });
});

describe('first logins of an unclaimed instance', () => {
  let instanceDir: string | null = null;
  let setupToken = '';
  afterEach(async () => {
    if (instanceDir) await rm(instanceDir, { recursive: true, force: true });
    instanceDir = null;
  });
  const oidcInstance = async (idp: FakeIdp, config: Partial<Config> = {}, auth = {}) => {
    instanceDir = await mkdtemp(path.join(tmpdir(), 'slider-auth-unclaimed-'));
    ctx = await createTestContext({
      config: { dataDir: instanceDir, ...config, ...authConfig({ oidc: OIDC, ...auth }) },
      fetch: idp.fetch,
      instance: { env: {}, restart: null },
    });
    setupToken = ensureSetupToken(instanceDir);
  };
  /** This browser typed in the setup token on `/einrichtung`: the cookie it got for that. */
  const setupGrant = async () =>
    cookiePair(
      await ctx.request('/api/setup', { headers: { [SETUP_TOKEN_HEADER]: setupToken } }),
      'slider_setup',
    );
  const identities = () => ctx.deps.db.select().from(userIdentities);
  const admins = () => ctx.deps.db.select().from(users).where(eq(users.isInstanceAdmin, true));

  it('signing in never makes anyone instance admin (production), not even two first logins at once', async () => {
    const cases: [Partial<Config['auth']>, string][] = [
      [{ signup: 'open' }, 'anna@firma.de'],
      [{ signup: 'domains', signupDomains: ['firma.de'] }, 'anna@firma.de'],
      // The dev owner's own address takes over the login-less dev owner account – still no admin.
      [{ signup: 'open' }, 'robert@example.org'],
    ];
    for (const [auth, email] of cases) {
      if (instanceDir) {
        await ctx.cleanup();
        await rm(instanceDir, { recursive: true, force: true });
      }
      const idp = fakeOidc({ email });
      await oidcInstance(idp, { env: 'production' }, auth);
      const grant = await setupGrant();
      const cookie = sessionCookieFrom(await redirectLogin('oidc', idp, { cookie: grant })) ?? '';
      expect((await me(cookie)).body.user).toMatchObject({ email, isInstanceAdmin: false });
      expect(await admins()).toEqual([]);
    }

    await ctx.cleanup();
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

  it('nobody signs in or up without the setup token typed in this browser; with it, even under SIGNUP=invite or domains', async () => {
    const idp = fakeOidc();
    await oidcInstance(idp, { env: 'production' }, { signup: 'open' });
    const providers = async (cookie = '') =>
      authProvidersSchema.parse(
        await (await ctx.request('/api/auth/providers', { cookie })).json(),
      );
    expect((await providers()).setupPending).toBe(true);

    // Login buttons and callbacks lead to the setup page; calls get `instance_unclaimed`.
    for (const cookie of ['', 'slider_setup=forged']) {
      const start = await ctx.request('/api/auth/oidc/login?returnTo=%2F', { cookie });
      expect(start.status).toBe(302);
      expect(start.headers.get('location')).toBe('http://localhost:5173/einrichtung');
      const callback = await ctx.request('/api/auth/oidc/callback?state=x&code=y', { cookie });
      expect(callback.headers.get('location')).toBe('http://localhost:5173/einrichtung');
      expect(sessionCookieFrom(callback)).toBeNull();
    }
    const email = await ctx.request('/api/auth/email/start', {
      method: 'POST',
      json: { email: 'x@gmail.com' },
    });
    expect(email.status).toBe(403);
    expect(await email.json()).toMatchObject({ error: { code: 'instance_unclaimed' } });
    const passkey = await ctx.request('/api/auth/passkey/options', { method: 'POST' });
    expect(passkey.status).toBe(403);
    expect(await identities()).toEqual([]);

    // A wrong token grants nothing.
    const wrong = await ctx.request('/api/setup', { headers: { [SETUP_TOKEN_HEADER]: 'wrong' } });
    expect(cookiePair(wrong, 'slider_setup')).toBe('');

    const grant = await setupGrant();
    expect(grant).toMatch(/^slider_setup=/);
    expect((await providers(grant)).setupPending).toBe(false);
    expect(sessionCookieFrom(await redirectLogin('oidc', idp, { cookie: grant }))).toBeTruthy();
    expect(await admins()).toEqual([]);

    // With the grant, whoever typed in the token signs up even under SIGNUP=invite or domains.
    await ctx.cleanup();
    await rm(instanceDir!, { recursive: true, force: true });
    idp.claims = { ...idp.claims, sub: 'x', email: 'x@gmail.com' };
    await oidcInstance(idp, { env: 'production' });
    expect(
      sessionCookieFrom(await redirectLogin('oidc', idp, { cookie: await setupGrant() })),
    ).toBeTruthy();

    await ctx.cleanup();
    await rm(instanceDir!, { recursive: true, force: true });
    await oidcInstance(
      idp,
      { env: 'production' },
      { signup: 'domains', signupDomains: ['firma.de'] },
    );
    expect(
      sessionCookieFrom(await redirectLogin('oidc', idp, { cookie: await setupGrant() })),
    ).toBeTruthy();
    expect(await admins()).toEqual([]);
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
    /** Signs in in the browser that typed in the setup token. */
    const grantedLogin = async (idp: FakeIdp) => {
      const grant = cookiePair(
        await ctx.request('/api/setup', { headers: { [SETUP_TOKEN_HEADER]: token } }),
        'slider_setup',
      );
      return sessionCookieFrom(await redirectLogin('oidc', idp, { cookie: grant })) ?? '';
    };

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

    it('every route but login, /me and the setup page is closed until the claim; then SIGNUP applies again', async () => {
      const idp = fakeOidc();
      await tokenInstance(idp);
      // Signed out, or with a stale session: 401 as before, not the claim.
      expect((await ctx.request('/api/decks')).status).toBe(401);
      expect((await ctx.request('/api/decks', { cookie: 'slider_session=stale' })).status).toBe(
        401,
      );

      const cookie = await grantedLogin(idp);
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

      idp.claims = { ...idp.claims, sub: 'bert', email: 'bert@firma.de', name: 'Bert' };
      const bert = await grantedLogin(idp);
      await blocked(await ctx.request('/api/decks', { cookie: bert }));

      expect((await claim(cookie)).status).toBe(200);
      expect((await me(cookie)).body).toMatchObject({
        instanceClaimed: true,
        user: { isInstanceAdmin: true },
      });
      expect((await ctx.request('/api/decks', { cookie })).status).toBe(200);
      expect((await ctx.request('/api/workspaces', { cookie })).status).toBe(200);

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

  it('dev login: the dev owner and signed-in accounts are never asked for the token, a session wins', async () => {
    ctx = await createTestContext();
    expect((await me()).body.instanceClaimed).toBe(true);
    expect((await ctx.request('/api/decks')).status).toBe(200);
    const { user, cookie } = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    expect((await me(cookie)).body.instanceClaimed).toBe(true);
    // A session wins over the dev owner.
    expect((await me(cookie)).body.viewer.author.id).toBe(user.id);
    expect((await me()).body.viewer.author.id).toBe(ctx.ownerId);
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
    const grant = await setupGrant();
    expect(grant).toMatch(/^__Host-slider_setup=/);
    const start = await ctx.request('/api/auth/oidc/login?returnTo=%2F', { cookie: grant });
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
        { cookie: `${cookie}; ${grant}` },
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
