import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mapMicrosoftError, MICROSOFT_SCOPES, MICROSOFT_WRITE_SCOPES } from '../src/auth/microsoft';
import { decryptToken, encryptToken } from '../src/auth/token-crypto';
import { users } from '../src/db/schema';
import type { FetchLike } from '../src/sources/safe-fetch';
import { createTestContext, MICROSOFT_TEST_CONFIG, type TestContext } from './helpers';

const SECRET = 'test-secret-test-secret-test-secret!';

describe('token encryption', () => {
  it('round-trips', async () => {
    const payload = await encryptToken(SECRET, 'refresh-token-123');
    expect(payload).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(payload).not.toContain('refresh-token-123');
    expect(await decryptToken(SECRET, payload)).toBe('refresh-token-123');
  });

  it('uses a fresh IV every time', async () => {
    expect(await encryptToken(SECRET, 'same')).not.toBe(await encryptToken(SECRET, 'same'));
  });

  it('throws on a tampered ciphertext', async () => {
    const [version, iv, ciphertext = ''] = (await encryptToken(SECRET, 'token')).split('.');
    const flipped = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
    await expect(decryptToken(SECRET, [version, iv, flipped].join('.'))).rejects.toThrow();
  });

  it('throws with another secret', async () => {
    const payload = await encryptToken(SECRET, 'token');
    await expect(decryptToken(`${SECRET}-other`, payload)).rejects.toThrow();
  });
});

describe('mapMicrosoftError', () => {
  it.each([
    [
      'invalid_grant',
      'AADSTS65001: The user or administrator has not consented to use the application.',
    ],
    ['access_denied', 'AADSTS90094: admin approval required'],
    ['consent_required', ''],
    ['access_denied', 'Need admin approval'],
  ])('%s / %s → admin_consent', (error, description) => {
    expect(mapMicrosoftError(error, description)).toBe('admin_consent');
  });

  it('treats a plain access_denied as a cancelled login', () => {
    expect(mapMicrosoftError('access_denied', 'AADSTS65004: User declined to consent.')).toBe(
      'denied',
    );
  });

  it('maps anything else to failed', () => {
    expect(mapMicrosoftError('invalid_request', 'AADSTS50011: redirect URI mismatch')).toBe(
      'failed',
    );
  });
});

describe('Microsoft login routes', () => {
  let ctx: TestContext;
  afterEach(() => ctx.cleanup());

  const configured = (fetch?: FetchLike) =>
    createTestContext({ config: { microsoft: MICROSOFT_TEST_CONFIG }, fetch });

  it('answers 503 when the login is not configured', async () => {
    ctx = await createTestContext();
    const res = await ctx.request('/api/auth/microsoft/login');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'microsoft_not_configured' } });
  });

  it('redirects to Microsoft with PKCE and sets the state cookie', async () => {
    ctx = await configured();
    const res = await ctx.request(
      `/api/auth/microsoft/login?returnTo=${encodeURIComponent('/neu?link=x')}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: 'client-id',
      response_type: 'code',
      redirect_uri: MICROSOFT_TEST_CONFIG.redirectUri,
      scope: 'openid profile email offline_access User.Read Files.Read.All',
      code_challenge_method: 'S256',
    });
    expect(location.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^slider_ms_oauth=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/microsoft/);
  });

  async function startLogin(returnTo = '/neu?link=https%3A%2F%2F1drv.ms%2Fp%2Fc%2Fx') {
    const res = await ctx.request(
      `/api/auth/microsoft/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    return { state, cookie };
  }

  it('sends the browser back with msError=failed on a state mismatch', async () => {
    ctx = await configured();
    const { cookie } = await startLogin();
    const res = await ctx.request('/api/auth/microsoft/callback?code=abc&state=forged', { cookie });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin).toBe('http://localhost:5173');
    expect(location.pathname).toBe('/neu');
    expect(location.searchParams.get('msError')).toBe('failed');
    expect(location.searchParams.get('link')).toBe('https://1drv.ms/p/c/x');
  });

  it('sends a failed write login back to its deck, without inserting (BER-128)', async () => {
    ctx = await configured();
    const { state, cookie } = await startLogin('/d/deck-1?slide=s1&insertAfter=s1');
    const res = await ctx.request(
      `/api/auth/microsoft/callback?state=${state}&error=access_denied`,
      { cookie },
    );
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/d/deck-1');
    expect(location.searchParams.get('slide')).toBe('s1');
    expect(location.searchParams.get('insertAfter')).toBeNull();
    expect(location.searchParams.get('msError')).toBe('denied');
  });

  it('maps an admin consent error from Microsoft', async () => {
    ctx = await configured();
    const { state, cookie } = await startLogin();
    const res = await ctx.request(
      `/api/auth/microsoft/callback?state=${state}&error=access_denied&error_description=${encodeURIComponent('AADSTS90094: admin approval')}`,
      { cookie },
    );
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('msError')).toBe(
      'admin_consent',
    );
  });

  it('never redirects off-site', async () => {
    ctx = await configured();
    const { state, cookie } = await startLogin('//evil.example/x');
    const res = await ctx.request(
      `/api/auth/microsoft/callback?state=${state}&error=access_denied`,
      {
        cookie,
      },
    );
    expect(new URL(res.headers.get('location') ?? '').origin).toBe('http://localhost:5173');
  });

  it('exchanges the code, stores the refresh token encrypted and returns to returnTo', async () => {
    const tokenRequests: URLSearchParams[] = [];
    ctx = await configured(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/oauth2/v2.0/token')) {
        tokenRequests.push(new URLSearchParams(String(init?.body)));
        return Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
      }
      if (url.startsWith('https://graph.microsoft.com/v1.0/me')) {
        return Response.json({ mail: 'robert@contoso.com' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { state, cookie } = await startLogin();
    const res = await ctx.request(`/api/auth/microsoft/callback?state=${state}&code=the-code`, {
      cookie,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'http://localhost:5173/neu?link=https%3A%2F%2F1drv.ms%2Fp%2Fc%2Fx',
    );
    expect(Object.fromEntries(tokenRequests[0] ?? [])).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      client_secret: 'client-secret',
    });
    expect(tokenRequests[0]?.get('code_verifier')).toMatch(/^[\w-]{43}$/);

    const [owner] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.ownerId));
    expect(owner?.msAccount).toBe('robert@contoso.com');
    expect(owner?.msRefreshToken).toMatch(/^v1\./);
    expect(await decryptToken(SECRET, owner?.msRefreshToken ?? '')).toBe('rt-1');
    expect(await ctx.deps.microsoft.getAccessToken(ctx.ownerId)).toBe('at-1');
  });

  it('refreshes expired access tokens and forgets revoked refresh tokens', async () => {
    let refreshOk = true;
    ctx = await configured(async (input, init) => {
      const body = new URLSearchParams(String(init?.body));
      if (String(input).endsWith('/token') && body.get('grant_type') === 'refresh_token') {
        return refreshOk
          ? Response.json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 })
          : Response.json(
              { error: 'invalid_grant', error_description: 'AADSTS70008: expired' },
              { status: 400 },
            );
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    await ctx.deps.db
      .update(users)
      .set({ msRefreshToken: await encryptToken(SECRET, 'rt-1') })
      .where(eq(users.id, ctx.ownerId));

    expect(await ctx.deps.microsoft.getAccessToken(ctx.ownerId)).toBe('at-2');
    const [rotated] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.ownerId));
    expect(await decryptToken(SECRET, rotated?.msRefreshToken ?? '')).toBe('rt-2');

    refreshOk = false;
    expect(await ctx.deps.microsoft.getAccessToken(ctx.ownerId, { forceRefresh: true })).toBeNull();
    const [forgotten] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.ownerId));
    expect(forgotten?.msRefreshToken).toBeNull();
  });

  it('asks Microsoft for write scopes only on a write login (BER-128)', async () => {
    ctx = await configured();
    const res = await ctx.request(
      `/api/auth/microsoft/login?access=write&returnTo=${encodeURIComponent('/d/deck-1')}`,
    );
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('scope')).toBe(MICROSOFT_WRITE_SCOPES);
  });

  it('without write consent yet, a write token is null but the sign-in stays (BER-128)', async () => {
    const scopes: string[] = [];
    ctx = await configured(async (input, init) => {
      const body = new URLSearchParams(String(init?.body));
      if (String(input).endsWith('/token')) {
        scopes.push(body.get('scope') ?? '');
        return body.get('scope')?.includes('ReadWrite')
          ? Response.json(
              { error: 'invalid_grant', error_description: 'AADSTS65001: no consent' },
              { status: 400 },
            )
          : Response.json({ access_token: 'at-read', expires_in: 3600 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    await ctx.deps.db
      .update(users)
      .set({ msRefreshToken: await encryptToken(SECRET, 'rt-1') })
      .where(eq(users.id, ctx.ownerId));

    expect(await ctx.deps.microsoft.getAccessToken(ctx.ownerId, { access: 'write' })).toBeNull();
    expect(await ctx.deps.microsoft.getAccessToken(ctx.ownerId)).toBe('at-read');
    expect(scopes).toEqual([MICROSOFT_WRITE_SCOPES, MICROSOFT_SCOPES]);
    const [owner] = await ctx.deps.db.select().from(users).where(eq(users.id, ctx.ownerId));
    expect(owner?.msRefreshToken).not.toBeNull();
  });
});
