import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import { instanceSettings, passkeys, userIdentities, users } from '../src/db/schema';
import { loadBootConfig, loadConfig } from '../src/config';
import { silentLogger, type Logger } from '../src/logger';
import {
  announceSetup,
  ensureSetupToken,
  loadInstanceConfig,
  readSetupToken,
  readStoredSettings,
  saveStoredSettings,
} from '../src/services/instance-settings';
import { createTestContext, signedInUser, testConfig, type TestContext } from './helpers';

let ctx: TestContext;
let dataDir: string;
let token: string;
let restart: ReturnType<typeof vi.fn<() => void>>;

const GOOGLE = {
  GOOGLE_CLIENT_ID: 'g-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'geheim',
};

/** `manual`: no supervisor restarts the server; `none`: no instance control at all. */
async function setup(
  env: NodeJS.ProcessEnv = {},
  control: 'supervised' | 'manual' | 'none' = 'supervised',
) {
  dataDir = await mkdtemp(path.join(tmpdir(), 'slider-setup-'));
  restart = vi.fn<() => void>();
  ctx = await createTestContext({
    config: { dataDir, auth: { ...testConfig().auth, devLogin: false } },
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

async function claim(userId: string) {
  await ctx.deps.db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, userId));
  await ctx.deps.db.insert(userIdentities).values({
    provider: 'google',
    subject: 'robert@q4-team.de',
    userId,
    email: 'robert@q4-team.de',
  });
}

afterEach(async () => {
  await ctx.cleanup();
  await rm(dataDir, { recursive: true, force: true });
});

describe('setup page before the first account', () => {
  beforeEach(() => setup());

  it('shows nothing without the token from the log', async () => {
    const { body } = await status();
    expect(body).toEqual({ authorized: false, hasAccount: false, loginConfigured: false });
    expect((await status({ [SETUP_TOKEN_HEADER]: 'wrong' })).body.authorized).toBe(false);
    expect((await save(GOOGLE)).status).toBe(403);
  });

  it('shows the fields and redirect URIs with the token', async () => {
    const { body } = await status(withToken());
    expect(body.authorized).toBe(true);
    expect(body.settings?.url).toBe('http://localhost:5173');
    expect(body.settings?.restart).toBe('automatic');
    expect(body.settings?.redirectUris.google).toBe(
      'http://localhost:5173/api/auth/google/callback',
    );
    expect(body.settings?.fields.GOOGLE_CLIENT_SECRET).toEqual({
      source: null,
      value: null,
      set: false,
    });
  });

  it('saves logins encrypted, never returns secrets and restarts', async () => {
    const res = await save({ ...GOOGLE, BOOTSTRAP_EMAIL: 'robert@q4-team.de' }, withToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restart: 'automatic' });

    const [row] = await ctx.deps.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, 'GOOGLE_CLIENT_SECRET'));
    expect(row?.value).not.toContain('geheim');
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual({
      ...GOOGLE,
      BOOTSTRAP_EMAIL: 'robert@q4-team.de',
    });

    const fields = (await status(withToken())).body.settings?.fields;
    expect(fields?.GOOGLE_CLIENT_SECRET).toEqual({ source: 'stored', value: null, set: true });
    expect(fields?.GOOGLE_CLIENT_ID).toEqual({
      source: 'stored',
      value: GOOGLE.GOOGLE_CLIENT_ID,
      set: true,
    });

    await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  });

  it('needs a login first, and refuses invalid combinations', async () => {
    const noLogin = await save({ SIGNUP: 'open' }, withToken());
    expect(noLogin.status).toBe(400);
    const noLoginBody = JSON.stringify(await noLogin.json());
    expect(noLoginBody).toMatch(/Anmeldeweg/);
    // E-mail login is gone (0020_drop_email_login): only offer what exists.
    expect(noLoginBody).toContain('(Microsoft, Google oder SSO)');

    const badSignup = await save({ ...GOOGLE, SIGNUP: 'domains' }, withToken());
    expect(badSignup.status).toBe(400);
    expect(JSON.stringify(await badSignup.json())).toMatch(/SIGNUP_DOMAINS/);

    const halfOidc = await save({ ...GOOGLE, OIDC_ISSUER: 'https://sso.firma.de' }, withToken());
    expect(halfOidc.status).toBe(400);
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual({});
    expect(restart).not.toHaveBeenCalled();
  });

  it('removes a value with null', async () => {
    await save({ ...GOOGLE, OIDC_LABEL: 'Firmen-Login' }, withToken());
    await save({ OIDC_LABEL: null }, withToken());
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual(GOOGLE);
  });
});

describe('setup page and the environment', () => {
  it('shows values from the environment read-only and refuses to change them', async () => {
    await setup({ ...GOOGLE, SIGNUP: 'invite' });
    const fields = (await status(withToken())).body.settings?.fields;
    expect(fields?.GOOGLE_CLIENT_SECRET).toEqual({ source: 'env', value: null, set: true });
    expect(fields?.SIGNUP).toEqual({ source: 'env', value: 'invite', set: true });

    const res = await save({ SIGNUP: 'open' }, withToken());
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Umgebungsvariable gesetzt: SIGNUP/);
  });

  it('asks for the admin address in production', async () => {
    await setup({ NODE_ENV: 'production', SLIDER_URL: 'https://slider.firma.de' });
    const res = await save(GOOGLE, withToken());
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Admin/);
    expect(
      (await save({ ...GOOGLE, BOOTSTRAP_EMAIL: 'robert@firma.de' }, withToken())).status,
    ).toBe(200);
  });

  it('reports a manual restart when no supervisor runs the server', async () => {
    await setup({}, 'manual');
    expect((await status(withToken())).body.settings?.restart).toBe('manual');
  });
});

describe('setup page after the first account', () => {
  beforeEach(() => setup());

  it('belongs to the instance admin; the token no longer works', async () => {
    const admin = await signedInUser(ctx, { name: 'Robert', email: 'robert@firma.de' });
    const other = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    await claim(admin.user.id);

    expect((await status(withToken())).body).toMatchObject({ authorized: false, hasAccount: true });
    expect((await save(GOOGLE, withToken())).status).toBe(403);
    expect((await status({}, other.cookie)).body.authorized).toBe(false);
    expect((await save(GOOGLE, {}, other.cookie)).status).toBe(403);

    expect((await status({}, admin.cookie)).body.authorized).toBe(true);
    // Once claimed, saving without a login is allowed (the admin may switch logins off and on).
    expect((await save({ SIGNUP: 'open' }, {}, admin.cookie)).status).toBe(200);
  });

  it('stays claimed when the admin signs in with passkeys only', async () => {
    const admin = await signedInUser(ctx, { name: 'Robert', email: 'robert@firma.de' });
    await claim(admin.user.id);
    await ctx.deps.db.delete(userIdentities);
    await ctx.deps.db.insert(passkeys).values({
      id: 'pk-1',
      userId: admin.user.id,
      credentialId: 'cred-1',
      publicKey: 'key',
      deviceType: 'singleDevice',
      name: 'YubiKey',
    });

    expect((await status(withToken())).body).toMatchObject({ authorized: false, hasAccount: true });
    expect((await save(GOOGLE, withToken())).status).toBe(403);
    expect((await status({}, admin.cookie)).body.authorized).toBe(true);
  });

  it('refuses to remove the last login unless the admin can still sign in with a passkey', async () => {
    const admin = await signedInUser(ctx, { name: 'Robert', email: 'robert@firma.de' });
    await claim(admin.user.id);
    expect((await save(GOOGLE, {}, admin.cookie)).status).toBe(200);

    const removeAll = { GOOGLE_CLIENT_ID: null, GOOGLE_CLIENT_SECRET: null };
    const refused = await save(removeAll, {}, admin.cookie);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toMatch(/Passkey/);
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual(GOOGLE);
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

  it('keeps the token file until the server sees the first account', () => {
    expect(readSetupToken(dataDir)).toBe(token);
  });
});

describe('setup page without instance control', () => {
  it('does not exist', async () => {
    await setup({}, 'none');
    expect((await ctx.request('/api/setup')).status).toBe(404);
  });
});

describe('server start', () => {
  beforeEach(() => setup());

  it('boots when a pair is split between the environment and the setup page', async () => {
    await saveStoredSettings(
      ctx.deps.db,
      ctx.deps.config.secret,
      { GOOGLE_CLIENT_SECRET: 'geheim' },
      ctx.clock.now(),
    );
    // Pinned in deploy/.env later; its partner stays on the setup page.
    const env = {
      GOOGLE_CLIENT_ID: GOOGLE.GOOGLE_CLIENT_ID,
      SLIDER_SECRET: ctx.deps.config.secret,
    };
    expect(() => loadConfig(env, () => {})).toThrow(/must be set together/);
    const boot = loadBootConfig(env);
    expect(boot.secret).toBe(ctx.deps.config.secret);
    const config = await loadInstanceConfig(env, boot, ctx.deps.db, silentLogger);
    expect(config.auth.google?.clientId).toBe(GOOGLE.GOOGLE_CLIENT_ID);
  });

  it('logs a setup link with dev login too, so the hint on /einrichtung leads somewhere', async () => {
    const devDir = await mkdtemp(path.join(tmpdir(), 'slider-setup-dev-'));
    const info = vi.fn<Logger['info']>();
    try {
      const config = testConfig({
        env: 'development',
        dataDir: devDir,
        auth: { ...testConfig().auth, devLogin: true },
      });
      await announceSetup(config, ctx.deps.db, { ...silentLogger, info });
      const devToken = readSetupToken(devDir);
      expect(devToken).toEqual(expect.any(String));
      expect(info).toHaveBeenCalledWith(expect.stringContaining(`/einrichtung#token=${devToken}`));
    } finally {
      await rm(devDir, { recursive: true, force: true });
    }
  });
});
