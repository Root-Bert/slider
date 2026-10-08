import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETUP_TOKEN_HEADER, type SetupStatus } from '@slider/shared';
import { instanceSettings, userIdentities, users } from '../src/db/schema';
import {
  ensureSetupToken,
  readSetupToken,
  readStoredSettings,
} from '../src/services/instance-settings';
import { createTestContext, signedInUser, testConfig, type TestContext } from './helpers';

let ctx: TestContext;
let dataDir: string;
let token: string;
let restart: ReturnType<typeof vi.fn<() => void>>;

const SMTP = {
  SMTP_URL: 'smtps://slider:geheim@mail.firma.de:465',
  MAIL_FROM: 'Slider <s@firma.de>',
};

async function setup(env: NodeJS.ProcessEnv = {}) {
  dataDir = await mkdtemp(path.join(tmpdir(), 'slider-setup-'));
  ctx = await createTestContext({
    config: { dataDir, auth: { ...testConfig().auth, devLogin: false } },
  });
  restart = vi.fn<() => void>();
  ctx.deps.instance = { env, restart };
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
    provider: 'email',
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
    expect((await save(SMTP)).status).toBe(403);
  });

  it('shows the fields and redirect URIs with the token', async () => {
    const { body } = await status(withToken());
    expect(body.authorized).toBe(true);
    expect(body.settings?.url).toBe('http://localhost:5173');
    expect(body.settings?.restart).toBe('automatic');
    expect(body.settings?.redirectUris.google).toBe(
      'http://localhost:5173/api/auth/google/callback',
    );
    expect(body.settings?.fields.SMTP_URL).toEqual({ source: null, value: null, set: false });
  });

  it('saves logins encrypted, never returns secrets and restarts', async () => {
    const res = await save({ ...SMTP, BOOTSTRAP_EMAIL: 'robert@q4-team.de' }, withToken());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restart: 'automatic' });

    const [row] = await ctx.deps.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.key, 'SMTP_URL'));
    expect(row?.value).not.toContain('geheim');
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual({
      ...SMTP,
      BOOTSTRAP_EMAIL: 'robert@q4-team.de',
    });

    const fields = (await status(withToken())).body.settings?.fields;
    expect(fields?.SMTP_URL).toEqual({ source: 'stored', value: null, set: true });
    expect(fields?.MAIL_FROM).toEqual({ source: 'stored', value: SMTP.MAIL_FROM, set: true });

    await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  });

  it('needs a login first, and refuses invalid combinations', async () => {
    const noLogin = await save({ SIGNUP: 'open' }, withToken());
    expect(noLogin.status).toBe(400);
    expect(JSON.stringify(await noLogin.json())).toMatch(/Anmeldeweg/);

    const badSignup = await save({ ...SMTP, SIGNUP: 'domains' }, withToken());
    expect(badSignup.status).toBe(400);
    expect(JSON.stringify(await badSignup.json())).toMatch(/SIGNUP_DOMAINS/);

    const halfGoogle = await save({ ...SMTP, GOOGLE_CLIENT_ID: 'g-id' }, withToken());
    expect(halfGoogle.status).toBe(400);
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual({});
    expect(restart).not.toHaveBeenCalled();
  });

  it('removes a value with null', async () => {
    await save({ ...SMTP, OIDC_LABEL: 'Firmen-Login' }, withToken());
    await save({ OIDC_LABEL: null }, withToken());
    expect(await readStoredSettings(ctx.deps.db, ctx.deps.config.secret)).toEqual(SMTP);
  });
});

describe('setup page and the environment', () => {
  it('shows values from the environment read-only and refuses to change them', async () => {
    await setup({ ...SMTP, SIGNUP: 'invite' });
    const fields = (await status(withToken())).body.settings?.fields;
    expect(fields?.SMTP_URL).toEqual({ source: 'env', value: null, set: true });
    expect(fields?.SIGNUP).toEqual({ source: 'env', value: 'invite', set: true });

    const res = await save({ SIGNUP: 'open' }, withToken());
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Umgebungsvariable gesetzt: SIGNUP/);
  });

  it('asks for the admin address in production', async () => {
    await setup({ NODE_ENV: 'production', SLIDER_URL: 'https://slider.firma.de' });
    const res = await save(SMTP, withToken());
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Admin/);
    expect((await save({ ...SMTP, BOOTSTRAP_EMAIL: 'robert@firma.de' }, withToken())).status).toBe(
      200,
    );
  });

  it('reports a manual restart when no supervisor runs the server', async () => {
    await setup();
    ctx.deps.instance = { env: {}, restart: null };
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
    expect((await save(SMTP, withToken())).status).toBe(403);
    expect((await status({}, other.cookie)).body.authorized).toBe(false);
    expect((await save(SMTP, {}, other.cookie)).status).toBe(403);

    expect((await status({}, admin.cookie)).body.authorized).toBe(true);
    // Once claimed, saving without a login is allowed (the admin may switch logins off and on).
    expect((await save({ SIGNUP: 'open' }, {}, admin.cookie)).status).toBe(200);
  });

  it('keeps the token file until the server sees the first account', () => {
    expect(readSetupToken(dataDir)).toBe(token);
  });
});

describe('setup page without instance control', () => {
  it('does not exist', async () => {
    await setup();
    delete ctx.deps.instance;
    expect((await ctx.request('/api/setup')).status).toBe(404);
  });
});
