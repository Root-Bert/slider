import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mapMicrosoftError, MICROSOFT_SCOPES } from '../src/auth/microsoft';
import { decryptToken, encryptToken } from '../src/auth/token-crypto';
import { decks, microsoftConnections, userIdentities } from '../src/db/schema';
import { upsertUser } from '../src/services/users';
import type { FetchLike } from '../src/sources/safe-fetch';
import type { LoginIdentity, MeResponse, MicrosoftConnection } from '@slider/shared';
import {
  connectMicrosoft,
  createReadyDeck,
  createTestContext,
  fakeJwt,
  MICROSOFT_TEST_CONFIG,
  type TestContext,
} from './helpers';

const SECRET = 'test-secret-test-secret-test-secret!';

const connectionsOf = (ctx: TestContext, userId: string) =>
  ctx.deps.db
    .select()
    .from(microsoftConnections)
    .where(eq(microsoftConnections.userId, userId))
    .orderBy(microsoftConnections.createdAt);

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
    expect(cookie).toMatch(/Path=\/;/);
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

  it('sends a failed login started in a deck back to that deck', async () => {
    ctx = await configured();
    const { state, cookie } = await startLogin('/d/deck-1?slide=s1');
    const res = await ctx.request(
      `/api/auth/microsoft/callback?state=${state}&error=access_denied`,
      { cookie },
    );
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname).toBe('/d/deck-1');
    expect(location.searchParams.get('slide')).toBe('s1');
    expect(location.searchParams.get('msError')).toBe('denied');
  });

  it('sends a failed "Verbinden" from /konto or another page to /konto with linkError', async () => {
    ctx = await configured();
    for (const [returnTo, expected] of [
      ['/konto', '/konto?linkError=denied'],
      ['/w/w1/einstellungen', '/konto?linkError=denied'],
    ] as const) {
      const { state, cookie } = await startLogin(returnTo);
      const res = await ctx.request(
        `/api/auth/microsoft/callback?state=${state}&error=access_denied`,
        { cookie },
      );
      expect(res.headers.get('location')).toBe(`http://localhost:5173${expected}`);
    }
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

    const [connection] = await connectionsOf(ctx, ctx.ownerId);
    expect(connection?.account).toBe('robert@contoso.com');
    expect(connection?.refreshToken).toMatch(/^v1\./);
    expect(await decryptToken(SECRET, connection?.refreshToken ?? '')).toBe('rt-1');
    expect(await ctx.deps.microsoft.getAccessToken(connection!.id)).toBe('at-1');
  });

  it('signed in, the connect also links Microsoft as a login – which then stays', async () => {
    let nonce = '';
    ctx = await createTestContext({
      config: { microsoft: MICROSOFT_TEST_CONFIG },
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/oauth2/v2.0/token'))
          return Response.json({
            access_token: 'at-1',
            refresh_token: 'rt-1',
            expires_in: 3600,
            id_token: fakeJwt({
              iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
              aud: MICROSOFT_TEST_CONFIG.clientId,
              exp: Math.floor(Date.now() / 1000) + 300,
              nonce,
              tid: 'tenant-1',
              oid: 'oid-1',
              sub: 'pairwise-sub',
              preferred_username: 'robert@contoso.com',
            }),
          });
        if (url.startsWith('https://graph.microsoft.com/v1.0/me'))
          return Response.json({ id: 'ms-1', mail: 'robert@contoso.com' });
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    const start = await ctx.request('/api/auth/microsoft/login?returnTo=%2Fkonto');
    const authorize = new URL(start.headers.get('location') ?? '');
    nonce = authorize.searchParams.get('nonce') ?? '';
    const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const res = await ctx.request(
      `/api/auth/microsoft/callback?state=${authorize.searchParams.get('state')}&code=c`,
      { cookie },
    );
    expect(res.headers.get('location')).toBe('http://localhost:5173/konto');

    const identities = (await (await ctx.request('/api/me/identities')).json()) as LoginIdentity[];
    expect(identities.map((i) => [i.id, i.email])).toEqual([
      ['microsoft:tenant-1:oid-1', 'robert@contoso.com'],
    ]);

    // The only login stays.
    const unlink = () =>
      ctx.request('/api/me/identities/microsoft%3Atenant-1%3Aoid-1', { method: 'DELETE' });
    expect((await unlink()).status).toBe(400);

    // With a second login it can go, but the file access stays (`DELETE /me/microsoft/:id`).
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'oidc',
      subject: 'robert-sso',
      userId: ctx.ownerId,
      email: 'robert@example.org',
    });
    expect((await unlink()).status).toBe(204);
    expect(
      ((await (await ctx.request('/api/me/identities')).json()) as LoginIdentity[]).map(
        (i) => i.provider,
      ),
    ).toEqual(['oidc']);
    expect(await connectionsOf(ctx, ctx.ownerId)).toHaveLength(1);
  });

  it('connects one Microsoft account to at most two Slider accounts', async () => {
    ctx = await configured(async (input) => {
      const url = String(input);
      if (url.endsWith('/oauth2/v2.0/token'))
        return Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 });
      if (url.startsWith('https://graph.microsoft.com/v1.0/me'))
        return Response.json({ id: 'ms-1', mail: 'shared@contoso.com' });
      throw new Error(`Unexpected request: ${url}`);
    });
    const others = await Promise.all(
      ['a', 'b'].map((name) => upsertUser(ctx.deps.db, { name, email: `${name}@example.com` })),
    );
    const shared = [];
    for (const other of others)
      shared.push(await connectMicrosoft(ctx.deps.db, other.id, { subject: 'ms-1' }));

    let { state, cookie } = await startLogin();
    let res = await ctx.request(`/api/auth/microsoft/callback?state=${state}&code=c`, { cookie });
    expect(res.headers.get('location')).toContain('msError=account_limit');
    expect(await connectionsOf(ctx, ctx.ownerId)).toEqual([]);

    // An expired connection still counts – it can be renewed any time.
    await ctx.deps.microsoft.forgetToken(shared[0]!);
    ({ state, cookie } = await startLogin());
    res = await ctx.request(`/api/auth/microsoft/callback?state=${state}&code=c`, { cookie });
    expect(res.headers.get('location')).toContain('msError=account_limit');

    // One of them lets go: the slot is free again.
    await ctx.deps.db.delete(microsoftConnections).where(eq(microsoftConnections.id, shared[0]!));
    ({ state, cookie } = await startLogin());
    res = await ctx.request(`/api/auth/microsoft/callback?state=${state}&code=c`, { cookie });
    expect(res.headers.get('location')).not.toContain('msError');
    expect((await connectionsOf(ctx, ctx.ownerId)).map((c) => c.subject)).toEqual(['ms-1']);

    // Connecting it again only refreshes the owner's connection: the limit is about others.
    ({ state, cookie } = await startLogin());
    res = await ctx.request(`/api/auth/microsoft/callback?state=${state}&code=c`, { cookie });
    expect(res.headers.get('location')).not.toContain('msError');
    expect(await connectionsOf(ctx, ctx.ownerId)).toHaveLength(1);
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
    const id = await connectMicrosoft(ctx.deps.db, ctx.ownerId);

    expect(await ctx.deps.microsoft.getAccessToken(id)).toBe('at-2');
    const [rotated] = await connectionsOf(ctx, ctx.ownerId);
    expect(await decryptToken(SECRET, rotated?.refreshToken ?? '')).toBe('rt-2');
    expect(rotated?.lastUsedAt).not.toBeNull();

    refreshOk = false;
    expect(await ctx.deps.microsoft.getAccessToken(id, { forceRefresh: true })).toBeNull();
    // The connection stays (its decks keep it), waiting for a new sign-in.
    const [forgotten] = await connectionsOf(ctx, ctx.ownerId);
    expect(forgotten?.id).toBe(id);
    expect(forgotten?.refreshToken).toBeNull();
    expect(await ctx.deps.microsoft.connectionIds(ctx.ownerId)).toEqual([]);
  });

  it('trades the refresh token in once for parallel requests of one token', async () => {
    let refreshes = 0;
    ctx = await configured(async (input, init) => {
      const body = new URLSearchParams(String(init?.body));
      if (String(input).endsWith('/token') && body.get('grant_type') === 'refresh_token') {
        refreshes++;
        return Response.json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const id = await connectMicrosoft(ctx.deps.db, ctx.ownerId);

    const tokens = await Promise.all(
      Array.from({ length: 6 }, () => ctx.deps.microsoft.getAccessToken(id)),
    );
    expect(tokens).toEqual(Array(6).fill('at-2'));
    expect(refreshes).toBe(1);
  });

  it('keeps the refresh token when Microsoft is down, throttling or refuses the app itself', async () => {
    let answer: () => Response = () => Response.json({}, { status: 500 });
    ctx = await configured(async (input, init) => {
      const body = new URLSearchParams(String(init?.body));
      if (String(input).endsWith('/token') && body.get('grant_type') === 'refresh_token') {
        return answer();
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const id = await connectMicrosoft(ctx.deps.db, ctx.ownerId);
    const stored = async () => (await connectionsOf(ctx, ctx.ownerId))[0]?.refreshToken;

    const outcomes: [() => Response, string][] = [
      [() => Response.json({}, { status: 503 }), 'source_unreachable'],
      [
        () =>
          Response.json(
            { error: 'temporarily_unavailable', error_description: 'AADSTS50196' },
            { status: 400 },
          ),
        'source_unreachable',
      ],
      [() => new Response('slow down', { status: 429 }), 'source_unreachable'],
      [
        () =>
          Response.json(
            { error: 'invalid_client', error_description: 'AADSTS7000222: secret expired' },
            { status: 401 },
          ),
        'microsoft_not_configured',
      ],
    ];
    for (const [response, code] of outcomes) {
      answer = response;
      await expect(
        ctx.deps.microsoft.getAccessToken(id, { forceRefresh: true }),
      ).rejects.toMatchObject({ code });
      expect(await stored()).not.toBeNull();
    }

    answer = () => Response.json({ access_token: 'at-9', expires_in: 3600 });
    expect(await ctx.deps.microsoft.getAccessToken(id, { forceRefresh: true })).toBe('at-9');
  });

  it('never asks Microsoft for write scopes, even when `access=write` is requested', async () => {
    ctx = await configured();
    const res = await ctx.request(
      `/api/auth/microsoft/login?access=write&returnTo=${encodeURIComponent('/d/deck-1')}`,
    );
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('scope')).toBe(MICROSOFT_SCOPES);
  });
});

describe('several Microsoft accounts per Slider account', () => {
  let ctx: TestContext;
  afterEach(() => ctx.cleanup());

  /** Microsoft as far as the connect flow sees it; `as` picks the account the person chose. */
  async function setup() {
    let nonce = '';
    let as = { oid: 'oid-1', mail: 'robert@contoso.com', refresh: 'rt-1' };
    ctx = await createTestContext({
      config: { microsoft: MICROSOFT_TEST_CONFIG },
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/oauth2/v2.0/token'))
          return Response.json({
            access_token: `at-${as.oid}`,
            refresh_token: as.refresh,
            expires_in: 3600,
            id_token: fakeJwt({
              iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
              aud: MICROSOFT_TEST_CONFIG.clientId,
              exp: Math.floor(Date.now() / 1000) + 300,
              nonce,
              tid: 'tenant-1',
              oid: as.oid,
              sub: `sub-${as.oid}`,
              preferred_username: as.mail,
            }),
          });
        if (url.startsWith('https://graph.microsoft.com/v1.0/me'))
          return Response.json({ id: as.oid, mail: as.mail });
        throw new Error(`Unexpected request: ${url}`);
      },
    });
    const connect = async (account: typeof as, query = '') => {
      as = account;
      const start = await ctx.request(`/api/auth/microsoft/login?returnTo=%2Fkonto${query}`);
      const authorize = new URL(start.headers.get('location') ?? '');
      nonce = authorize.searchParams.get('nonce') ?? '';
      const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      const res = await ctx.request(
        `/api/auth/microsoft/callback?state=${authorize.searchParams.get('state')}&code=c`,
        { cookie },
      );
      return { authorize, location: res.headers.get('location') };
    };
    return { connect };
  }

  const list = async () =>
    (await (await ctx.request('/api/me/microsoft')).json()) as MicrosoftConnection[];

  it('adds a connection per account, refreshes one connected again and links each as a login', async () => {
    const { connect } = await setup();
    const first = await connect({ oid: 'oid-1', mail: 'robert@contoso.com', refresh: 'rt-1' });
    // The person picks the account at Microsoft.
    expect(first.authorize.searchParams.get('prompt')).toBe('select_account');
    expect(first.location).toBe('http://localhost:5173/konto');
    await connect({ oid: 'oid-2', mail: 'robert@fabrikam.com', refresh: 'rt-2' });
    expect((await list()).map((c) => c.account).sort()).toEqual([
      'robert@contoso.com',
      'robert@fabrikam.com',
    ]);

    await connect({ oid: 'oid-1', mail: 'robert@contoso.com', refresh: 'rt-1b' });
    const rows = await connectionsOf(ctx, ctx.ownerId);
    expect(rows).toHaveLength(2);
    const contoso = rows.find((row) => row.subject === 'oid-1');
    expect(await decryptToken(SECRET, contoso?.refreshToken ?? '')).toBe('rt-1b');
    expect(contoso?.identitySubject).toBe('tenant-1:oid-1');

    const identities = (await (await ctx.request('/api/me/identities')).json()) as LoginIdentity[];
    expect(identities.map((i) => i.id).sort()).toEqual([
      'microsoft:tenant-1:oid-1',
      'microsoft:tenant-1:oid-2',
    ]);
    const me = (await (await ctx.request('/api/me')).json()) as MeResponse;
    expect(me.user).toMatchObject({ microsoftConnected: true, microsoftConnections: 2 });
  });

  it('never attaches a login that already signs into another account', async () => {
    const { connect } = await setup();
    const other = await upsertUser(ctx.deps.db, { name: 'Max', email: 'max@example.com' });
    await ctx.deps.db.insert(userIdentities).values({
      provider: 'microsoft',
      subject: 'tenant-1:oid-9',
      userId: other.id,
      email: 'max@contoso.com',
    });
    await connect({ oid: 'oid-9', mail: 'max@contoso.com', refresh: 'rt-9' });
    // File access is fine (two Slider accounts may share one Microsoft account) …
    expect((await list()).map((c) => c.account)).toEqual(['max@contoso.com']);
    // … but the login stays with Max.
    const [identity] = await ctx.deps.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.subject, 'tenant-1:oid-9'));
    expect(identity?.userId).toBe(other.id);
  });

  it('preselects the account of a connection being renewed – only of my own', async () => {
    const { connect } = await setup();
    await connect({ oid: 'oid-1', mail: 'robert@contoso.com', refresh: 'rt-1' });
    const [mine] = await list();
    const other = await upsertUser(ctx.deps.db, { name: 'Max', email: 'max@example.com' });
    const theirs = await connectMicrosoft(ctx.deps.db, other.id, { account: 'max@contoso.com' });

    const renew = await connect(
      { oid: 'oid-1', mail: 'robert@contoso.com', refresh: 'rt-1c' },
      `&connection=${mine!.id}`,
    );
    expect(renew.authorize.searchParams.get('login_hint')).toBe('robert@contoso.com');
    const foreign = await ctx.request(`/api/auth/microsoft/login?connection=${theirs}`);
    expect(new URL(foreign.headers.get('location') ?? '').searchParams.has('login_hint')).toBe(
      false,
    );
  });

  it('a connect takes over a connection from before the account id was recorded', async () => {
    const { connect } = await setup();
    const legacy = await connectMicrosoft(ctx.deps.db, ctx.ownerId, {
      subject: `legacy:${ctx.ownerId}`,
    });
    await connect({ oid: 'oid-1', mail: 'robert@contoso.com', refresh: 'rt-1' });
    const rows = await connectionsOf(ctx, ctx.ownerId);
    expect(rows.map((row) => [row.id, row.subject])).toEqual([[legacy, 'oid-1']]);
  });

  it('lists only my connections with their reviews; disconnecting one asks those reviews to sign in', async () => {
    await setup();
    const contoso = await connectMicrosoft(ctx.deps.db, ctx.ownerId, {
      subject: 'oid-1',
      account: 'robert@contoso.com',
    });
    const fabrikam = await connectMicrosoft(ctx.deps.db, ctx.ownerId, {
      subject: 'oid-2',
      account: 'robert@fabrikam.com',
      refreshToken: null,
    });
    const other = await upsertUser(ctx.deps.db, { name: 'Max', email: 'max@example.com' });
    const theirs = await connectMicrosoft(ctx.deps.db, other.id);
    const { deckId } = await createReadyDeck(ctx, { slideCount: 1 });
    await ctx.deps.db
      .update(decks)
      .set({ source: 'onedrive', sourceRef: 'drives/d/items/i', microsoftConnectionId: contoso })
      .where(eq(decks.id, deckId));

    const listed = await list();
    expect(listed.map((c) => [c.id, c.deckCount, c.needsReconnect])).toEqual(
      expect.arrayContaining([
        [contoso, 1, false],
        [fabrikam, 0, true],
      ]),
    );
    expect(listed).toHaveLength(2);

    // Someone else's connection: not mine to remove.
    expect((await ctx.request(`/api/me/microsoft/${theirs}`, { method: 'DELETE' })).status).toBe(
      404,
    );
    expect(await connectionsOf(ctx, other.id)).toHaveLength(1);

    expect((await ctx.request(`/api/me/microsoft/${contoso}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await list()).map((c) => c.id)).toEqual([fabrikam]);
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck?.microsoftConnectionId).toBeNull();
    expect(deck?.syncState.lastSyncError?.code).toBe('auth_required');
  });
});
