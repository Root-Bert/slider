import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authProvidersSchema,
  nextcloudSignInPollSchema,
  type NextcloudLoginStart,
} from '@slider/shared';
import type { Config } from '../src/config';
import { nextcloudConnections, userIdentities, users } from '../src/db/schema';
import { NEXTCLOUD_FLOW_TTL_MS } from '../src/routes/auth';
import { RecordingMailer, type Mailer } from '../src/mail/mailer';
import type { FetchLike } from '../src/sources/safe-fetch';
import {
  cookiePair,
  createTestContext,
  publicLookup,
  sessionCookieFrom,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

/** "Weiter mit Nextcloud" for any Nextcloud: Login Flow v2 and the mailed confirmation, faked. */

let ctx: TestContext;
afterEach(async () => {
  await ctx.cleanup();
});

const SERVER = 'https://cloud.lena.de';
const NEXTCLOUD: Config['nextcloud'] = { server: null, login: null, loginAnyServer: true };

/** A Nextcloud whose login flow is granted at once, by `lena` with her address. */
function fakeNextcloud(user: { id?: string; email?: string | null } = {}) {
  const state = { handedOut: 0, revoked: [] as string[], loginUrls: [] as string[] };
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.origin !== SERVER) throw new Error(`Unexpected request: ${url.href}`);
    const json = (body: unknown) => Response.json(body);
    if (url.pathname === '/index.php/login/v2' && method === 'POST') {
      state.loginUrls.push(new Headers(init?.headers).get('user-agent') ?? '');
      return json({
        poll: { token: 'poll-token', endpoint: `${SERVER}/login/v2/poll` },
        login: `${SERVER}/login/v2/flow/abc`,
      });
    }
    if (url.pathname === '/login/v2/poll' && method === 'POST') {
      return json({ server: SERVER, loginName: 'lena', appPassword: `pw-${++state.handedOut}` });
    }
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const password = Buffer.from(auth.replace(/^Basic /, ''), 'base64')
      .toString()
      .split(':')[1];
    if (!password || state.revoked.includes(password)) return new Response('', { status: 401 });
    if (url.pathname === '/ocs/v2.php/cloud/user') {
      return json({
        ocs: {
          data: {
            id: user.id ?? 'lena',
            email: user.email === undefined ? 'lena@firma.de' : user.email,
            displayname: 'Lena Berg',
          },
        },
      });
    }
    if (url.pathname === '/ocs/v2.php/core/apppassword' && method === 'DELETE') {
      state.revoked.push(password);
      return json({ ocs: { data: [] } });
    }
    throw new Error(`Unexpected request: ${method} ${url.href}`);
  };
  return { fetch, state };
}

async function flowContext(
  nc: ReturnType<typeof fakeNextcloud>,
  {
    auth = {},
    mailer = new RecordingMailer(),
    nextcloud = NEXTCLOUD,
  }: { auth?: Partial<Config['auth']>; mailer?: Mailer; nextcloud?: Config['nextcloud'] } = {},
) {
  ctx = await createTestContext({
    config: {
      auth: { ...testConfig().auth, devLogin: false, signup: 'open', ...auth },
      nextcloud,
    },
    fetch: nc.fetch,
    lookup: publicLookup,
    mailer,
    instanceAdmin: true,
  });
  // Bootstrapped: the next login is a normal sign-up.
  await ctx.deps.db.insert(userIdentities).values({
    provider: 'oidc',
    subject: 'robert@example.org',
    userId: ctx.ownerId,
    email: 'robert@example.org',
  });
  return mailer;
}

/** Starts a flow and polls it once (the fake grants at once). */
async function signIn({ returnTo = '/', cookie = '', intent = 'login' } = {}) {
  const start = await ctx.request('/api/auth/nextcloud/flow', {
    method: 'POST',
    json: { server: 'cloud.lena.de', returnTo, intent },
    cookie,
  });
  expect(start.status).toBe(200);
  const { id } = (await start.json()) as NextcloudLoginStart;
  const flowCookie = cookiePair(start, 'slider_nc_flow');
  // This browser's key for the mailed confirmation link.
  const browserCookie = cookiePair(start, 'slider_nc_signup');
  const poll = await ctx.request(`/api/auth/nextcloud/flow/${id}/poll`, {
    method: 'POST',
    cookie: [flowCookie, browserCookie, cookie].filter(Boolean).join('; '),
  });
  return {
    poll,
    body: nextcloudSignInPollSchema.parse(await poll.json()),
    id,
    flowCookie,
    browserCookie,
  };
}

const confirmSignUp = (token: string, cookie?: string) =>
  ctx.request('/api/auth/nextcloud/confirm', { method: 'POST', json: { token }, cookie });

const mailedToken = (mailer: RecordingMailer) =>
  /\/konto-bestaetigen\/([\w.-]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';

describe('Nextcloud sign-in with any Nextcloud', () => {
  it('is offered, and Nextcloud’s grant page shows the code the asking window shows', async () => {
    const nc = fakeNextcloud();
    await flowContext(nc);
    const body = authProvidersSchema.parse(await (await ctx.request('/api/auth/providers')).json());
    expect(body.nextcloudAnyServer).toBe(true);
    const start = await ctx.request('/api/auth/nextcloud/flow', {
      method: 'POST',
      json: { server: 'cloud.lena.de' },
    });
    const { code } = (await start.json()) as NextcloudLoginStart;
    expect(code).toMatch(/^\d{4}$/);
    expect(nc.state.loginUrls).toEqual([`Slider (localhost:5173) | Code ${code}`]);
  });

  it('is 404 when switched off', async () => {
    await flowContext(fakeNextcloud(), {
      nextcloud: { ...NEXTCLOUD, loginAnyServer: false },
    });
    const res = await ctx.request('/api/auth/nextcloud/flow', {
      method: 'POST',
      json: { server: 'cloud.lena.de' },
    });
    expect(res.status).toBe(404);
  });

  it('signs a known identity in and keeps the grant as its file connection', async () => {
    const nc = fakeNextcloud();
    await flowContext(nc);
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'nextcloud',
      subject: `${SERVER}:lena`,
      userId: ctx.ownerId,
      email: 'lena@firma.de',
    });
    const { poll, body } = await signIn({ returnTo: '/neu' });
    expect(body).toEqual({ status: 'done', redirectTo: '/neu' });
    expect(sessionCookieFrom(poll)).toBeTruthy();
    const connections = await ctx.deps.db
      .select()
      .from(nextcloudConnections)
      .where(eq(nextcloudConnections.userId, ctx.ownerId));
    expect(connections.map((c) => [c.serverUrl, c.ncUserId])).toEqual([[SERVER, 'lena']]);
    expect(nc.state.revoked).toEqual([]);
  });

  it('only the browser that started the flow picks it up', async () => {
    await flowContext(fakeNextcloud());
    const start = await ctx.request('/api/auth/nextcloud/flow', {
      method: 'POST',
      json: { server: 'cloud.lena.de' },
    });
    const { id } = (await start.json()) as NextcloudLoginStart;
    const poll = await ctx.request(`/api/auth/nextcloud/flow/${id}/poll`, { method: 'POST' });
    expect(await poll.json()).toEqual({ status: 'expired' });
    expect(sessionCookieFrom(poll)).toBeNull();
  });

  it('a grant later than 5 minutes signs nobody in', async () => {
    const nc = fakeNextcloud();
    await flowContext(nc);
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'nextcloud',
      subject: `${SERVER}:lena`,
      userId: ctx.ownerId,
      email: 'lena@firma.de',
    });
    const start = await ctx.request('/api/auth/nextcloud/flow', {
      method: 'POST',
      json: { server: 'cloud.lena.de' },
    });
    const { id } = (await start.json()) as NextcloudLoginStart;
    ctx.clock.advance(NEXTCLOUD_FLOW_TTL_MS + 1000);
    const poll = await ctx.request(`/api/auth/nextcloud/flow/${id}/poll`, {
      method: 'POST',
      cookie: cookiePair(start, 'slider_nc_flow'),
    });
    expect(await poll.json()).toEqual({ status: 'expired' });
    expect(sessionCookieFrom(poll)).toBeNull();
    // Not even asked: Nextcloud hands no app password out.
    expect(nc.state.handedOut).toBe(0);
  });

  it('a new account first confirms its address by mail, then exists', async () => {
    const nc = fakeNextcloud();
    const mailer = (await flowContext(nc)) as RecordingMailer;
    const { poll, body, browserCookie } = await signIn({ returnTo: '/neu' });
    expect(body).toEqual({ status: 'confirm', email: 'lena@firma.de' });
    expect(sessionCookieFrom(poll)).toBeNull();
    // Nothing exists yet, and the app password went back to Nextcloud.
    expect(await ctx.deps.db.select().from(users).where(eq(users.email, 'lena@firma.de'))).toEqual(
      [],
    );
    expect(nc.state.revoked).toEqual(['pw-1']);
    expect(mailer.sent.map((m) => [m.to, m.subject])).toEqual([
      ['lena@firma.de', 'Dein Slider-Konto bestätigen'],
    ]);

    const confirm = await confirmSignUp(mailedToken(mailer), browserCookie);
    expect(await confirm.json()).toEqual({ redirectTo: '/neu' });
    expect(sessionCookieFrom(confirm)).toBeTruthy();
    const [lena] = await ctx.deps.db.select().from(users).where(eq(users.email, 'lena@firma.de'));
    expect(lena?.name).toBe('Lena Berg');

    // From now on the same Nextcloud signs straight in.
    const again = await signIn();
    expect(again.body).toEqual({ status: 'done', redirectTo: '/' });
  });

  it('confirms only in the browser that started the sign-in', async () => {
    const mailer = (await flowContext(fakeNextcloud())) as RecordingMailer;
    // Someone puts Lena's address into their own Nextcloud; the mail reaches Lena.
    const { browserCookie } = await signIn();
    expect(mailer.sent.at(-1)?.text).toContain('im selben Browser');
    const token = mailedToken(mailer);

    for (const elsewhere of [undefined, 'slider_nc_signup=forged']) {
      const res = await confirmSignUp(token, elsewhere);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
        'im selben Browser',
      );
      expect(sessionCookieFrom(res)).toBeNull();
    }
    // Another browser's own key does not fit either.
    const other = await ctx.request('/api/auth/nextcloud/flow', {
      method: 'POST',
      json: { server: 'cloud.lena.de' },
    });
    const otherBrowser = cookiePair(other, 'slider_nc_signup');
    expect(otherBrowser).not.toBe(browserCookie);
    expect((await confirmSignUp(token, otherBrowser)).status).toBe(403);
    expect(await ctx.deps.db.select().from(users).where(eq(users.email, 'lena@firma.de'))).toEqual(
      [],
    );

    expect((await confirmSignUp(token, browserCookie)).status).toBe(200);
  });

  it('keeps the browser key across sign-ins, so an earlier link still works', async () => {
    const mailer = (await flowContext(fakeNextcloud())) as RecordingMailer;
    const first = await signIn();
    const token = mailedToken(mailer);
    const second = await signIn({ cookie: first.browserCookie });
    expect(second.body).toEqual({ status: 'confirm', email: 'lena@firma.de' });
    expect(second.browserCookie).toBe(first.browserCookie);
    expect((await confirmSignUp(token, first.browserCookie)).status).toBe(200);
  });

  it('a used confirmation link is spent', async () => {
    const mailer = (await flowContext(fakeNextcloud())) as RecordingMailer;
    const { browserCookie } = await signIn();
    const token = mailedToken(mailer);
    expect((await confirmSignUp(token, browserCookie)).status).toBe(200);
    const again = await confirmSignUp(token, browserCookie);
    expect(again.status).toBe(410);
    expect(sessionCookieFrom(again)).toBeNull();
  });

  it('mails one address at most three times an hour', async () => {
    const mailer = (await flowContext(fakeNextcloud())) as RecordingMailer;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { body } = await signIn();
      expect(body).toEqual({ status: 'confirm', email: 'lena@firma.de' });
    }
    expect(mailer.sent).toHaveLength(3);
  });

  it('a forged or altered confirmation link does nothing', async () => {
    const mailer = (await flowContext(fakeNextcloud())) as RecordingMailer;
    const { browserCookie } = await signIn();
    const token = mailedToken(mailer);
    const [body, signature] = token.split('.');
    const altered = Buffer.from(
      Buffer.from(body!, 'base64url').toString().replace('lena@firma.de', 'chef@firma.de'),
    ).toString('base64url');
    const res = await confirmSignUp(`${altered}.${signature}`, browserCookie);
    expect(res.status).toBe(404);
  });

  it('cannot take an address that already has an account', async () => {
    const mailer = (await flowContext(
      fakeNextcloud({ email: 'robert@example.org' }),
    )) as RecordingMailer;
    const { body } = await signIn();
    expect(body).toEqual({ status: 'done', redirectTo: '/login?error=account_exists' });
    expect(mailer.sent).toEqual([]);
  });

  it('mails nothing where the account could not come about anyway', async () => {
    const mailer = (await flowContext(fakeNextcloud(), {
      auth: { signup: 'invite' },
    })) as RecordingMailer;
    const { body } = await signIn();
    expect(body).toEqual({ status: 'done', redirectTo: '/login?error=signup_closed' });
    expect(mailer.sent).toEqual([]);
  });

  it('needs mail for a new account', async () => {
    const quiet: Mailer = { configured: false, send: async () => {} };
    await flowContext(fakeNextcloud(), { mailer: quiet });
    const { body } = await signIn();
    expect(body).toEqual({ status: 'done', redirectTo: '/login?error=mail_unavailable' });
  });

  it('links it to the signed-in account from /konto', async () => {
    const nc = fakeNextcloud({ email: 'lena@privat.de' });
    await flowContext(nc);
    const owner = await signedInUser(ctx, { name: 'Robert', email: 'robert2@example.org' });
    const { body } = await signIn({ cookie: owner.cookie, intent: 'connect', returnTo: '/konto' });
    expect(body).toEqual({ status: 'done', redirectTo: '/konto' });
    // Linking names the account asking, and needs no code.
    expect(nc.state.loginUrls).toEqual(['Slider (localhost:5173) für robert2@example.org']);
    const identities = await ctx.deps.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, owner.user.id));
    expect(identities.map((i) => [i.provider, i.subject])).toEqual([
      ['nextcloud', `${SERVER}:lena`],
    ]);
  });
});
