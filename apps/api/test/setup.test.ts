import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import {
  decks,
  instanceSettings,
  passkeys,
  userIdentities,
  users,
  workspaceMembers,
} from '../src/db/schema';
import { loadBootConfig, loadConfig } from '../src/config';
import { silentLogger, type Logger } from '../src/logger';
import { MAX_TOKEN_FAILURES } from '../src/routes/setup';
import { claimInstance } from '../src/services/accounts';
import {
  announceSetup,
  ensureSetupToken,
  loadInstanceConfig,
  readSetupToken,
  readStoredSettings,
  saveStoredSettings,
  setupTokenMatches,
} from '../src/services/instance-settings';
import {
  createReadyDeck,
  createTestContext,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let dataDir: string;
let token: string;
let restart: ReturnType<typeof vi.fn<() => void>>;

/** A login to save; Google doesn't count while the Google login is off. */
const LOGIN = {
  MS_CLIENT_ID: 'ms-id',
  MS_CLIENT_SECRET: 'geheim',
};

/** `manual`: no supervisor restarts the server; `none`: no instance control at all. */
async function setup(
  env: NodeJS.ProcessEnv = {},
  control: 'supervised' | 'manual' | 'none' = 'supervised',
  devLogin = false,
) {
  dataDir = await mkdtemp(path.join(tmpdir(), 'slider-setup-'));
  restart = vi.fn<() => void>();
  ctx = await createTestContext({
    config: { dataDir, auth: { ...testConfig().auth, devLogin } },
    instance:
      control === 'none' ? undefined : { env, restart: control === 'manual' ? null : restart },
  });
  token = ensureSetupToken(dataDir);
}

const status = async (headers: Record<string, string> = {}, cookie?: string) => {
  const res = await ctx.request('/api/setup', { headers, cookie });
  return { status: res.status, body: (await res.json()) as SetupStatus };
};

const save = (
  values: Record<string, string | null>,
  headers: Record<string, string> = {},
  cookie?: string,
) => ctx.request('/api/setup', { method: 'PUT', json: { values }, headers, cookie });

const withToken = () => ({ [SETUP_TOKEN_HEADER]: token });

const claimWith = (headers: Record<string, string>, cookie?: string) =>
  ctx.request('/api/setup/claim', { method: 'POST', headers, cookie });

const adminFlag = async (userId: string) =>
  (await ctx.deps.db.select().from(users).where(eq(users.id, userId)))[0]?.isInstanceAdmin;

async function claim(userId: string) {
  await ctx.deps.db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, userId));
  await ctx.deps.db.insert(userIdentities).values({
    provider: 'google',
    subject: 'robert@example.org',
    userId,
    email: 'robert@example.org',
  });
}

async function teardown() {
  await ctx.cleanup();
  await rm(dataDir, { recursive: true, force: true });
}

afterEach(teardown);

describe('setup page before the first account', () => {
  beforeEach(() => setup());

  it('shows nothing without the token from the log, the fields and redirect URIs with it', async () => {
    expect((await status()).body).toEqual({
      authorized: false,
      claimed: false,
      claimable: false,
      loginConfigured: false,
    });
    expect((await status({ [SETUP_TOKEN_HEADER]: 'wrong' })).body.authorized).toBe(false);
    expect((await save(LOGIN)).status).toBe(403);

    const { body } = await status(withToken());
    expect(body.authorized).toBe(true);
    expect(body.settings?.url).toBe('http://localhost:5173');
    expect(body.settings?.restart).toBe('automatic');
    expect(body.settings?.redirectUris.microsoft).toBe(
      'http://localhost:5173/api/auth/microsoft/callback',
    );
    expect(body.settings?.fields.MS_CLIENT_SECRET).toEqual({
      source: null,
      value: null,
      set: false,
    });
    expect(body.settings?.features).toEqual({ payments: false, stockPhotos: false });
    // The token file stays until the server sees the first account.
    expect(readSetupToken(dataDir)).toBe(token);
  });

  it('saves logins encrypted, never returns secrets, restarts and removes values with null', async () => {
    const res = await save(LOGIN, withToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restart: 'automatic' });

    const [row] = await ctx.deps.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, 'MS_CLIENT_SECRET'));
    expect(row?.value).not.toContain('geheim');
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual(LOGIN);

    const fields = (await status(withToken())).body.settings?.fields;
    expect(fields?.MS_CLIENT_SECRET).toEqual({ source: 'stored', value: null, set: true });
    expect(fields?.MS_CLIENT_ID).toEqual({
      source: 'stored',
      value: LOGIN.MS_CLIENT_ID,
      set: true,
    });

    await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());

    // null removes a value.
    await save({ OIDC_LABEL: 'Firmen-Login' }, withToken());
    await save({ OIDC_LABEL: null }, withToken());
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual(LOGIN);
  });

  it('needs a login first, and refuses invalid combinations', async () => {
    const noLogin = await save({ SIGNUP: 'open' }, withToken());
    expect(noLogin.status).toBe(400);
    const noLoginBody = JSON.stringify(await noLogin.json());
    expect(noLoginBody).toMatch(/Anmeldeweg/);
    // E-mail login is gone (0020_drop_email_login): only offer what exists.
    expect(noLoginBody).toContain('(Microsoft, Google, Nextcloud oder SSO)');
    // Half a Google pair is refused.
    expect((await save({ GOOGLE_CLIENT_ID: 'g-id' }, withToken())).status).toBe(400);

    const badSignup = await save({ ...LOGIN, SIGNUP: 'domains' }, withToken());
    expect(badSignup.status).toBe(400);
    expect(JSON.stringify(await badSignup.json())).toMatch(/SIGNUP_DOMAINS/);

    const halfOidc = await save({ ...LOGIN, OIDC_ISSUER: 'https://sso.firma.de' }, withToken());
    expect(halfOidc.status).toBe(400);
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual({});
    expect(restart).not.toHaveBeenCalled();
  });

  it('shows the mail server without its password and keeps the password only for the same server and user', async () => {
    const smtp = 'smtps://mailer:pa%24s@smtp.firma.de:465';
    await save({ ...LOGIN, SMTP_URL: smtp, MAIL_FROM: 'slider@firma.de' }, withToken());
    const fields = (await status(withToken())).body.settings?.fields;
    expect(fields?.SMTP_URL).toEqual({
      source: 'stored',
      value: 'smtps://mailer@smtp.firma.de:465',
      set: true,
    });

    // Saved again as shown, no password typed: the saved password stays.
    await save({ SMTP_URL: 'smtps://mailer@smtp.firma.de:465' }, withToken());
    const stored = async () =>
      (await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).SMTP_URL;
    expect(await stored()).toBe(smtp);
    // Another server, port or user doesn't get it: the password never goes to a new host.
    for (const other of [
      'smtps://mailer@mail.evil.example:465',
      'smtps://mailer@smtp.firma.de:2465',
      'smtps://other@smtp.firma.de:465',
    ]) {
      await save({ SMTP_URL: smtp }, withToken());
      await save({ SMTP_URL: other }, withToken());
      expect(await stored()).toBe(other);
    }
  });
});

describe('setup page and the environment', () => {
  it('shows values from the environment read-only, follows the restart mode, dev login and instance control', async () => {
    await setup({ ...LOGIN, SIGNUP: 'invite' });
    const fields = (await status(withToken())).body.settings?.fields;
    expect(fields?.MS_CLIENT_SECRET).toEqual({ source: 'env', value: null, set: true });
    expect(fields?.SIGNUP).toEqual({ source: 'env', value: 'invite', set: true });

    const res = await save({ SIGNUP: 'open' }, withToken());
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Umgebungsvariable gesetzt: SIGNUP/);

    // No admin address in production – BOOTSTRAP_EMAIL is no setting any more.
    await teardown();
    await setup({ NODE_ENV: 'production', SLIDER_URL: 'https://slider.firma.de' });
    expect((await save(LOGIN, withToken())).status).toBe(200);
    expect((await save({ BOOTSTRAP_EMAIL: 'robert@firma.de' }, withToken())).status).toBe(400);
    expect((await status(withToken())).body.settings?.fields).not.toHaveProperty('BOOTSTRAP_EMAIL');

    // Without a supervisor the restart is manual; without instance control there is no page.
    await teardown();
    await setup({}, 'manual');
    expect((await status(withToken())).body.settings?.restart).toBe('manual');
    await teardown();
    await setup({}, 'none');
    expect((await ctx.request('/api/setup')).status).toBe(404);

    // Dev login: works with the token as before; the dev owner is no claimant.
    await teardown();
    await setup({}, 'supervised', true);
    expect((await status()).body).toMatchObject({ authorized: false, claimable: false });
    expect((await status(withToken())).body.authorized).toBe(true);
    expect((await claimWith(withToken())).status).toBe(401);
    expect(await adminFlag(ctx.ownerId)).toBe(false);
  });
});

describe('setup page after the first account', () => {
  beforeEach(() => setup());

  it('belongs to the instance admin, with passkeys only too; the token no longer works', async () => {
    const admin = await signedInUser(ctx, { name: 'Robert', email: 'robert@firma.de' });
    const other = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    await claim(admin.user.id);

    expect((await status(withToken())).body).toMatchObject({ authorized: false, claimed: true });
    expect((await save(LOGIN, withToken())).status).toBe(403);
    expect((await status({}, other.cookie)).body.authorized).toBe(false);
    expect((await save(LOGIN, {}, other.cookie)).status).toBe(403);

    expect((await status({}, admin.cookie)).body.authorized).toBe(true);
    // Once claimed, saving without a login is allowed (the admin may switch logins off and on).
    expect((await save({ SIGNUP: 'open' }, {}, admin.cookie)).status).toBe(200);

    // Stays claimed when the admin signs in with passkeys only.
    await ctx.deps.db.delete(userIdentities);
    await ctx.deps.db.insert(passkeys).values({
      id: 'pk-1',
      userId: admin.user.id,
      credentialId: 'cred-1',
      publicKey: 'key',
      deviceType: 'singleDevice',
      name: 'YubiKey',
    });

    expect((await status(withToken())).body).toMatchObject({ authorized: false, claimed: true });
    expect((await save(LOGIN, withToken())).status).toBe(403);
    expect((await status({}, admin.cookie)).body.authorized).toBe(true);
  });

  it('refuses to remove the last login unless the admin can still sign in with a passkey', async () => {
    const admin = await signedInUser(ctx, { name: 'Robert', email: 'robert@firma.de' });
    await claim(admin.user.id);
    expect((await save(LOGIN, {}, admin.cookie)).status).toBe(200);

    const removeAll = { MS_CLIENT_ID: null, MS_CLIENT_SECRET: null };
    const refused = await save(removeAll, {}, admin.cookie);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toMatch(/Passkey/);
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual(LOGIN);
    // Other changes still save while a login remains.
    expect((await save({ SIGNUP: 'open' }, {}, admin.cookie)).status).toBe(200);

    await ctx.deps.db.insert(passkeys).values({
      id: 'pk-1',
      userId: admin.user.id,
      credentialId: 'cred-1',
      publicKey: 'key',
      deviceType: 'singleDevice',
      name: 'YubiKey',
    });
    expect((await save(removeAll, {}, admin.cookie)).status).toBe(200);
  });
});

describe('server start', () => {
  beforeEach(() => setup());

  it('boots when a pair is split between the environment and the setup page; BOOTSTRAP_EMAIL is only noted', async () => {
    await saveStoredSettings(
      ctx.deps.db,
      ctx.deps.config.secret,
      { OIDC_CLIENT_SECRET: 'geheim' },
      ctx.clock.now(),
    );
    // Pinned in deploy/.env later; its partner stays on the setup page.
    const env = {
      OIDC_ISSUER: 'https://sso.firma.de',
      OIDC_CLIENT_ID: 'o-id',
      SLIDER_SECRET: ctx.deps.config.secret,
    };
    expect(() => loadConfig(env, () => {})).toThrow(/OIDC_CLIENT_SECRET/);
    const boot = loadBootConfig(env);
    expect(boot.secret).toBe(ctx.deps.config.secret);
    const config = await loadInstanceConfig(env, boot, ctx.deps.db, silentLogger);
    expect(config.auth.oidc?.clientId).toBe('o-id');
    await ctx.deps.db.delete(instanceSettings);

    // BOOTSTRAP_EMAIL: one info line that it is ignored and how to claim instead.
    const info = vi.fn<Logger['info']>();
    const log = { ...silentLogger, info };
    const bare = { SLIDER_SECRET: ctx.deps.config.secret };
    const notices = () =>
      info.mock.calls.filter(([message]) => String(message).includes('BOOTSTRAP_EMAIL'));

    await loadInstanceConfig(bare, loadBootConfig(bare), ctx.deps.db, log);
    expect(notices()).toEqual([]);

    const withEmail = { ...bare, BOOTSTRAP_EMAIL: 'robert@firma.de' };
    const emailConfig = await loadInstanceConfig(
      withEmail,
      loadBootConfig(withEmail),
      ctx.deps.db,
      log,
    );
    expect(emailConfig.auth).not.toHaveProperty('bootstrapEmails');
    expect(notices()).toHaveLength(1);
    expect(String(notices()[0]?.[0])).toMatch(
      /BOOTSTRAP_EMAIL is ignored.*\/einrichtung.*setup token/,
    );

    // Saved by an older setup page: ignored the same way, and not read as a setting.
    info.mockClear();
    await ctx.deps.db
      .insert(instanceSettings)
      .values({ key: 'BOOTSTRAP_EMAIL', value: 'robert@firma.de', updatedAt: ctx.clock.now() });
    await loadInstanceConfig(bare, loadBootConfig(bare), ctx.deps.db, log);
    expect(notices()).toHaveLength(1);
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual({});
  });

  it('logs the setup page and the token – never in a URL – and how to claim while unclaimed', async () => {
    const devDir = await mkdtemp(path.join(tmpdir(), 'slider-setup-dev-'));
    const info = vi.fn<Logger['info']>();
    try {
      const config = testConfig({
        env: 'development',
        dataDir: devDir,
        auth: { ...testConfig().auth, devLogin: true },
      });
      await announceSetup(config, ctx.deps.db, { ...silentLogger, info });
      const devToken = readSetupToken(devDir) ?? '';
      expect(devToken).toEqual(expect.any(String));
      expect(info).toHaveBeenCalledOnce();
      const line = String(info.mock.calls[0]?.[0]);
      expect(line).toContain('http://localhost:5173/einrichtung');
      expect(line).toContain(`Setup token: ${devToken}`);
      expect(line).not.toContain('#token=');
    } finally {
      await rm(devDir, { recursive: true, force: true });
    }

    // Production: with logins from the environment only, or no login yet.
    const cases: [boolean, RegExp, string][] = [
      [true, /asks every account for the setup token/, '   https://slider.firma.de\n'],
      [false, /configure the login/, '   https://slider.firma.de/einrichtung\n'],
    ];
    const prod: { dir: string; config: ReturnType<typeof testConfig> }[] = [];
    const warn = vi.fn<Logger['warn']>();
    try {
      for (const [google, steps, url] of cases) {
        const dir = await mkdtemp(path.join(tmpdir(), 'slider-setup-prod-'));
        const config = testConfig({
          env: 'production',
          dataDir: dir,
          webOrigin: 'https://slider.firma.de',
          auth: {
            ...testConfig().auth,
            devLogin: false,
            google: google
              ? {
                  issuer: 'https://accounts.google.com',
                  clientId: 'g',
                  clientSecret: 's',
                  label: 'Weiter mit Google',
                  scopes: 'openid email profile',
                  redirectUri: 'https://slider.firma.de/api/auth/google/callback',
                }
              : null,
          },
        });
        prod.push({ dir, config });
        warn.mockClear();
        await announceSetup(config, ctx.deps.db, { ...silentLogger, warn });
        const message = String(warn.mock.calls[0]?.[0]);
        const prodToken = readSetupToken(dir) ?? '';
        expect(message).toContain(url);
        expect(message).toContain(`Setup token: ${prodToken}`);
        expect(message).toMatch(steps);
        expect(message).not.toContain('#token=');
        expect(message).not.toMatch(new RegExp(`einrichtung\\S*${prodToken}`));
      }

      // Claimed: the token file goes, nothing more is printed.
      const admin = await signedInUser(ctx, { name: 'Robert', email: 'robert@firma.de' });
      await claim(admin.user.id);
      for (const { dir, config } of prod) {
        warn.mockClear();
        await announceSetup(config, ctx.deps.db, { ...silentLogger, warn });
        expect(readSetupToken(dir)).toBeNull();
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Setup token'));
      }
    } finally {
      for (const { dir } of prod) await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('claiming the instance with the setup token', () => {
  beforeEach(() => setup());

  it('signing in alone grants nothing; a wrong token makes nobody admin, the right one does, once', async () => {
    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    expect((await status({}, anna.cookie)).body).toEqual({
      authorized: false,
      claimed: false,
      claimable: true,
      loginConfigured: false,
    });
    // Signed in, the token doesn't open the settings – it is for claiming.
    expect((await status(withToken(), anna.cookie)).body.authorized).toBe(false);
    const res = await save({ SIGNUP: 'open' }, withToken(), anna.cookie);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/Setup-Token/);
    expect(await adminFlag(anna.user.id)).toBe(false);

    // Claiming needs a signed-in account.
    expect((await claimWith(withToken())).status).toBe(401);
    expect(readSetupToken(dataDir)).toBe(token);

    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });

    const wrong = await claimWith({ [SETUP_TOKEN_HEADER]: 'wrong' }, anna.cookie);
    expect(wrong.status).toBe(403);
    expect(JSON.stringify(await wrong.json())).toMatch(/Server-Log/);
    expect((await claimWith({}, anna.cookie)).status).toBe(403);
    expect(await adminFlag(anna.user.id)).toBe(false);

    const right = await claimWith(withToken(), anna.cookie);
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ claimed: true });
    expect(await adminFlag(anna.user.id)).toBe(true);

    // Single use: the token is gone, a second account can't claim with it.
    expect(readSetupToken(dataDir)).toBeNull();
    expect(setupTokenMatches(dataDir, token)).toBe(false);
    expect((await claimWith(withToken(), max.cookie)).status).toBe(403);
    expect(await adminFlag(max.user.id)).toBe(false);
    // Nor does it open the page any more – the admin does.
    expect((await status(withToken())).body).toMatchObject({ authorized: false, claimed: true });
    expect((await status({}, anna.cookie)).body).toMatchObject({
      authorized: true,
      claimable: false,
    });
    expect((await status({}, max.cookie)).body).toMatchObject({
      authorized: false,
      claimable: false,
    });
  });

  it('an account that is gone claims nothing; of two claims at once only one becomes admin', async () => {
    expect(await claimInstance(ctx.deps, 'no-such-user', token)).toEqual({
      ok: false,
      error: 'invalid_token',
    });
    expect(readSetupToken(dataDir)).toBe(token);
    expect((await status(withToken())).body).toMatchObject({ authorized: true, claimed: false });

    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    const results = await Promise.all([
      claimInstance(ctx.deps, anna.user.id, token),
      claimInstance(ctx.deps, max.user.id, token),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const admins = await ctx.deps.db.select().from(users).where(eq(users.isInstanceAdmin, true));
    expect(admins).toHaveLength(1);
  });

  it('takes over the decks and workspaces of the dev owner nobody can sign in as, only those', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    // Before the claim the account can't open anything (`instance_unclaimed`).
    expect((await ctx.request(`/api/decks/${deckId}`, { cookie: anna.cookie })).status).toBe(403);

    expect((await claimWith(withToken(), anna.cookie)).status).toBe(200);
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck?.ownerId).toBe(anna.user.id);
    const [membership] = await ctx.deps.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, anna.user.id));
    expect(membership).toMatchObject({ workspaceId: ctx.workspaceId, role: 'admin' });
    expect((await ctx.request(`/api/decks/${deckId}`, { cookie: anna.cookie })).status).toBe(200);

    // A dev owner that has a login of its own is left alone.
    await teardown();
    await setup();
    const own = await createReadyDeck(ctx);
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'google',
      subject: 'robert',
      userId: ctx.ownerId,
      email: 'robert@example.org',
    });
    const other = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    expect((await claimWith(withToken(), other.cookie)).status).toBe(200);
    const [kept] = await ctx.deps.db.select().from(decks).where(eq(decks.id, own.deckId));
    expect(kept?.ownerId).toBe(ctx.ownerId);
  });

  it(`rate-limits wrong tokens: after ${MAX_TOKEN_FAILURES}, even the right one waits – the right one alone never locks out`, async () => {
    for (let i = 0; i < MAX_TOKEN_FAILURES + 5; i++) {
      expect((await status(withToken())).body.authorized).toBe(true);
    }
    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    for (let i = 0; i < MAX_TOKEN_FAILURES; i++) {
      expect((await status({ [SETUP_TOKEN_HEADER]: `wrong-${i}` })).status).toBe(200);
    }
    const blocked = await claimWith(withToken(), anna.cookie);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await status(withToken())).status).toBe(429);
    expect(await adminFlag(anna.user.id)).toBe(false);

    ctx.clock.advance(16 * 60_000);
    expect((await claimWith(withToken(), anna.cookie)).status).toBe(200);
  });
});
