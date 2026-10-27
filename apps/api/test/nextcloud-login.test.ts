import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { RecordingMailer } from '../src/mail/mailer';
import type { Config } from '../src/config';
import {
  cookiePair,
  createTestContext,
  sessionCookieFrom,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

const SERVER = 'https://cloud.firma.de';

let ctx: TestContext;
let mailer: RecordingMailer;
afterEach(() => ctx.cleanup());

/** The organisation's Nextcloud: whoever signs in there says which address they have. */
function fakeNextcloud(user: { id: string; email: string }) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (url === `${SERVER}/index.php/apps/oauth2/api/v1/token`) {
      return Response.json({ access_token: 'at', user_id: user.id });
    }
    if (url === `${SERVER}/ocs/v2.php/cloud/user?format=json`) {
      return Response.json({ ocs: { data: { id: user.id, email: user.email, displayname: 'X' } } });
    }
    return new Response('not found', { status: 404 });
  };
}

async function context(user: { id: string; email: string }, signup: Config['auth']['signup']) {
  mailer = new RecordingMailer();
  ctx = await createTestContext({
    config: {
      auth: { ...testConfig().auth, devLogin: false, signup },
      nextcloud: {
        server: SERVER,
        login: {
          clientId: 'nc-client',
          clientSecret: 'nc-secret',
          redirectUri: 'http://localhost:5173/api/auth/nextcloud/callback',
        },
        loginAnyServer: false,
      },
    },
    fetch: fakeNextcloud(user),
    mailer,
    instanceAdmin: true,
  });
}

/** "Weiter mit Nextcloud" → the organisation's Nextcloud → back. */
async function nextcloudLogin() {
  const start = await ctx.request('/api/auth/nextcloud/login?returnTo=%2F');
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
  const browser = [cookiePair(start, 'slider_nextcloud'), cookiePair(start, 'slider_nc_signup')]
    .filter(Boolean)
    .join('; ');
  const callback = await ctx.request(`/api/auth/nextcloud/callback?state=${state}&code=c`, {
    cookie: browser,
  });
  return { callback, browser };
}

const userByEmail = async (email: string) =>
  (await ctx.deps.db.select().from(users).where(eq(users.email, email)))[0];

describe("the organisation's Nextcloud as a login", () => {
  it('a new account confirms its address by mail first, in the same browser', async () => {
    await context({ id: 'anna', email: 'anna@firma.de' }, 'open');
    const { callback, browser } = await nextcloudLogin();
    expect(callback.headers.get('location')).toBe('http://localhost:5173/login?confirm=nextcloud');
    expect(sessionCookieFrom(callback)).toBeNull();
    expect(await userByEmail('anna@firma.de')).toBeUndefined();
    expect(mailer.sent.map((mail) => mail.to)).toEqual(['anna@firma.de']);

    const token = /konto-bestaetigen\/([\w.-]+)/.exec(mailer.sent[0]?.text ?? '')?.[1] ?? '';
    const confirmed = await ctx.request('/api/auth/nextcloud/confirm', {
      method: 'POST',
      json: { token },
      cookie: browser,
    });
    expect(confirmed.status).toBe(200);
    expect(sessionCookieFrom(confirmed)).toBeTruthy();
    expect(await userByEmail('anna@firma.de')).toBeDefined();

    // Known from now on: signs straight in.
    const again = await nextcloudLogin();
    expect(again.callback.headers.get('location')).toBe('http://localhost:5173/');
    expect(sessionCookieFrom(again.callback)).toBeTruthy();
  });

  it('an address typed into Nextcloud takes neither an invitation nor an account', async () => {
    await context({ id: 'mallory', email: 'chef@firma.de' }, 'invite');
    const admin = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    const created = await ctx.request('/api/workspaces', {
      method: 'POST',
      cookie: admin.cookie,
      json: { name: 'Firma' },
    });
    const { id } = (await created.json()) as { id: string };
    const invited = await ctx.request(`/api/workspaces/${id}/invites`, {
      method: 'POST',
      cookie: admin.cookie,
      json: { email: 'chef@firma.de', role: 'admin' },
    });
    expect(invited.status).toBeLessThan(300);
    mailer.sent.length = 0;

    const { callback } = await nextcloudLogin();
    expect(sessionCookieFrom(callback)).toBeNull();
    expect(await userByEmail('chef@firma.de')).toBeUndefined();
    // The confirmation goes to the real mailbox, not to whoever runs the Nextcloud account.
    expect(mailer.sent.map((mail) => mail.to)).toEqual(['chef@firma.de']);
  });

  it('without mail a new account is refused, not created unconfirmed', async () => {
    await context({ id: 'ben', email: 'ben@firma.de' }, 'open');
    Object.assign(mailer, { configured: false });
    const { callback } = await nextcloudLogin();
    expect(callback.headers.get('location')).toBe(
      'http://localhost:5173/login?error=mail_unavailable',
    );
    expect(await userByEmail('ben@firma.de')).toBeUndefined();
  });
});
