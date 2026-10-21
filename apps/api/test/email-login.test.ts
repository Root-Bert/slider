import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { authProvidersSchema, emailLoginResultSchema } from '@slider/shared';
import type { Config } from '../src/config';
import { loginLinks, userIdentities, users, workspaceInvites } from '../src/db/schema';
import { EMAIL_LOGIN_COOKIE } from '../src/routes/auth';
import { EMAIL_LOGIN_TTL_MS } from '../src/services/email-login';
import { enforceRetention } from '../src/services/retention';
import { RecordingMailer, type Mailer } from '../src/mail/mailer';
import {
  cookiePair,
  createTestContext,
  sessionCookieFrom,
  testConfig,
  type TestContext,
} from './helpers';

/** "Mit E-Mail fortfahren" (BER-168): a login link by mail, no password. */

let ctx: TestContext;
afterEach(async () => {
  await ctx.cleanup();
});

async function emailContext({
  auth = {},
  mailer = new RecordingMailer(),
}: { auth?: Partial<Config['auth']>; mailer?: Mailer } = {}) {
  ctx = await createTestContext({
    config: { auth: { ...testConfig().auth, devLogin: false, signup: 'open', ...auth } },
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

async function start(
  email: string,
  { cookie = '', returnTo }: { cookie?: string; returnTo?: string } = {},
) {
  const res = await ctx.request('/api/auth/email/start', {
    method: 'POST',
    json: { email, ...(returnTo ? { returnTo } : {}) },
    cookie,
  });
  return { res, browser: cookiePair(res, EMAIL_LOGIN_COOKIE) || cookie };
}

const confirm = (token: string, cookie?: string) =>
  ctx.request('/api/auth/email/confirm', { method: 'POST', json: { token }, cookie });

const mailedToken = (mailer: RecordingMailer) =>
  /\/anmelden\/([\w-]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';

describe('login by e-mail link', () => {
  it('is offered only where the server sends mail', async () => {
    await emailContext();
    const offered = authProvidersSchema.parse(
      await (await ctx.request('/api/auth/providers')).json(),
    );
    expect(offered.emailLogin).toBe(true);
    await ctx.cleanup();

    await emailContext({ mailer: { configured: false, send: async () => {} } });
    const without = authProvidersSchema.parse(
      await (await ctx.request('/api/auth/providers')).json(),
    );
    expect(without.emailLogin).toBe(false);
    expect((await start('lena@firma.de')).res.status).toBe(404);
  });

  it('creates the account from the link, then signs in with the next one', async () => {
    const mailer = (await emailContext()) as RecordingMailer;
    const first = await start('Lena@Firma.de', { returnTo: '/neu' });
    expect(first.res.status).toBe(204);
    expect(mailer.sent.at(-1)).toMatchObject({
      to: 'lena@firma.de',
      subject: 'Dein Slider-Konto erstellen',
    });
    // Only hashes are kept.
    const token = mailedToken(mailer);
    const [row] = await ctx.deps.db.select().from(loginLinks);
    expect(row?.tokenHash).not.toContain(token);

    const created = await confirm(token, first.browser);
    expect(created.status).toBe(200);
    expect(emailLoginResultSchema.parse(await created.json())).toEqual({
      redirectTo: '/neu',
      newAccount: true,
    });
    expect(sessionCookieFrom(created)).not.toBeNull();
    const [lena] = await ctx.deps.db.select().from(users).where(eq(users.email, 'lena@firma.de'));
    // The local part names the account until she changes it.
    expect(lena?.name).toBe('lena');

    const again = await start('lena@firma.de', { cookie: first.browser });
    expect(mailer.sent.at(-1)?.subject).toBe('Bei Slider anmelden');
    const signedIn = await confirm(mailedToken(mailer), again.browser);
    expect(emailLoginResultSchema.parse(await signedIn.json())).toEqual({
      redirectTo: '/',
      newAccount: false,
    });
    expect(
      await ctx.deps.db.select().from(users).where(eq(users.email, 'lena@firma.de')),
    ).toHaveLength(1);
  });

  it('works once, only in the browser that asked, and for 15 minutes', async () => {
    const mailer = (await emailContext()) as RecordingMailer;
    const { browser } = await start('lena@firma.de');
    const token = mailedToken(mailer);

    const elsewhere = await confirm(
      token,
      cookiePair(await (await start('x@firma.de')).res, EMAIL_LOGIN_COOKIE),
    );
    expect(elsewhere.status).toBe(403);
    // Not used up by the wrong browser.
    expect((await confirm(token, browser)).status).toBe(200);
    const twice = await confirm(token, browser);
    expect(twice.status).toBe(410);

    await start('lena@firma.de', { cookie: browser });
    const late = mailedToken(mailer);
    ctx.clock.advance(EMAIL_LOGIN_TTL_MS + 1);
    expect((await confirm(late, browser)).status).toBe(404);
    expect((await confirm('erfunden', browser)).status).toBe(404);
    // The hourly sweep removes old links.
    await enforceRetention(ctx.deps);
    expect(await ctx.deps.db.select().from(loginLinks)).toEqual([]);
  });

  it('answers the same for every address – the mail tells the mailbox what applies', async () => {
    const mailer = (await emailContext({ auth: { signup: 'invite' } })) as RecordingMailer;
    // Robert signs in with a company login: no link, the mail names the way in.
    const robert = await start('robert@example.org');
    expect(robert.res.status).toBe(204);
    expect(mailer.sent.at(-1)).toMatchObject({ subject: 'Deine Anmeldung bei Slider' });
    expect(mailer.sent.at(-1)?.text).toContain('dem Firmen-Login');
    expect(mailer.sent.at(-1)?.text).not.toContain('/anmelden/');
    // Nobody invited Lena, and this instance takes invited people only.
    const lena = await start('lena@firma.de');
    expect(lena.res.status).toBe(204);
    expect(mailer.sent.at(-1)?.text).toContain('nur mit einer Einladung');
    expect(await ctx.deps.db.select().from(loginLinks)).toEqual([]);
  });

  it('lets invited people sign up under SIGNUP=invite', async () => {
    const mailer = (await emailContext({ auth: { signup: 'invite' } })) as RecordingMailer;
    await ctx.deps.db.insert(workspaceInvites).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      email: 'lena@firma.de',
      role: 'member',
      tokenHash: crypto.randomUUID(),
      createdBy: ctx.ownerId,
      expiresAt: new Date(ctx.clock.now().getTime() + 86_400_000),
    });
    const { browser } = await start('lena@firma.de');
    const res = await confirm(mailedToken(mailer), browser);
    expect(emailLoginResultSchema.parse(await res.json()).newAccount).toBe(true);
  });

  it('never signs into an account that signs in another way', async () => {
    const mailer = (await emailContext()) as RecordingMailer;
    // Even a link mailed before the account got its other login.
    await ctx.deps.db.delete(userIdentities).where(eq(userIdentities.userId, ctx.ownerId));
    const { browser } = await start('robert@example.org');
    const token = mailedToken(mailer);
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'oidc',
      subject: 'robert@example.org',
      userId: ctx.ownerId,
      email: 'robert@example.org',
    });
    const res = await confirm(token, browser);
    expect(emailLoginResultSchema.parse(await res.json()).redirectTo).toBe(
      '/login?error=account_exists',
    );
    expect(sessionCookieFrom(res)).toBeNull();
  });

  it('limits the mails per address and per client', async () => {
    const mailer = (await emailContext()) as RecordingMailer;
    for (let i = 0; i < 6; i++) expect((await start('lena@firma.de')).res.status).toBe(204);
    // The sixth one is quietly not sent.
    expect(mailer.sent).toHaveLength(5);
    let last = 204;
    for (let i = 0; i < 30 && last === 204; i++) last = (await start(`p${i}@firma.de`)).res.status;
    expect(last).toBe(429);
  });

  it('says so when the mail could not be sent', async () => {
    await emailContext({
      mailer: {
        configured: true,
        send: async () => {
          throw new Error('SMTP down');
        },
      },
    });
    const { res } = await start('lena@firma.de');
    expect(res.status).toBe(503);
  });
});
