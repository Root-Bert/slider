import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextcloudConnection, NextcloudListing, NextcloudLoginStart } from '@slider/shared';
import { decks, nextcloudConnections } from '../src/db/schema';
import { NextcloudClient, parseMultistatus } from '../src/sources/nextcloud';
import type { FetchLike, LookupAll } from '../src/sources/safe-fetch';
import { createTestContext, publicLookup, type TestContext } from './helpers';

const SERVER = 'https://cloud.example.de';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const pptx = (marker: string) =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(marker)]);

interface FakeFile {
  path: string;
  etag: string;
  bytes: Uint8Array;
  mime: string;
}

/**
 * A Nextcloud on `SERVER`: Login Flow v2, WebDAV (PROPFIND, SEARCH, GET), OCS (user, shares,
 * app password) and public shares. Only the app passwords it handed out open it; each login
 * hands out a new one (`app-pw-1`, `app-pw-2`, …) for the account in `state.account`.
 */
function fakeNextcloud() {
  const files = new Map<string, FakeFile>([
    ['101', { path: '/Decks/Q4.pptx', etag: '"e1"', bytes: pptx('v1'), mime: PPTX_MIME }],
    ['102', { path: '/Decks/Notizen.docx', etag: '"e2"', bytes: pptx('docx'), mime: 'x/docx' }],
  ]);
  const shares = new Map([['Ab3dEf9GhJkLmNo', '101']]);
  const state = {
    granted: false,
    account: { loginName: 'robert', id: 'robert-id' },
    handedOut: 0,
    revoked: [] as string[],
    /** `cloud/user` answers nonsense: connecting fails after the password was handed out. */
    brokenUser: false,
    /** Downloads are refused (401) although listing and searching still work. */
    refuseDownloads: false,
  };
  const accounts = new Map<string, { loginName: string; id: string }>();
  const calls: { method: string; url: string }[] = [];

  /** The account and app password a request authenticates with, if Nextcloud accepts them. */
  const authorized = (init?: RequestInit) => {
    const header = new Headers(init?.headers).get('authorization') ?? '';
    const [loginName, password = ''] = Buffer.from(header.replace(/^Basic /, ''), 'base64')
      .toString()
      .split(':');
    const account = accounts.get(password);
    if (!account || account.loginName !== loginName || state.revoked.includes(password)) {
      return null;
    }
    return { ...account, password };
  };
  const davResponse = (user: string, id: string, file: FakeFile) => `
    <d:response>
      <d:href>/remote.php/dav/files/${user}${file.path.split('/').map(encodeURIComponent).join('/')}</d:href>
      <d:propstat><d:prop>
        <d:getetag>${file.etag}</d:getetag><d:getcontenttype>${file.mime}</d:getcontenttype>
        <d:resourcetype/><d:getcontentlength>${file.bytes.length}</d:getcontentlength>
        <oc:fileid>${id}</oc:fileid><nc:has-preview>true</nc:has-preview>
        <d:getlastmodified>Sat, 17 Oct 2026 10:00:00 GMT</d:getlastmodified>
      </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    </d:response>`;
  const multistatus = (body: string) =>
    new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">${body}</d:multistatus>`,
      { status: 207, headers: { 'content-type': 'application/xml' } },
    );
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetch = vi.fn<FetchLike>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, url: url.href });
    if (url.origin !== SERVER) throw new Error(`Unexpected request: ${url.href}`);
    const path = decodeURIComponent(url.pathname);

    if (path === '/index.php/login/v2' && method === 'POST') {
      return json({
        poll: { token: 'poll-token', endpoint: `${SERVER}/login/v2/poll` },
        login: `${SERVER}/login/v2/flow/abc`,
      });
    }
    if (path === '/login/v2/poll' && method === 'POST') {
      if (!state.granted) return new Response('', { status: 404 });
      const appPassword = `app-pw-${++state.handedOut}`;
      accounts.set(appPassword, { ...state.account });
      return json({ server: SERVER, loginName: state.account.loginName, appPassword });
    }
    const share = /^\/s\/([^/]+)\/download$/.exec(path);
    if (share) {
      const file = files.get(shares.get(share[1]!) ?? '');
      if (!file) return new Response('', { status: 404 });
      const headers = {
        etag: file.etag,
        'content-type': file.mime,
        'content-disposition': `attachment; filename="${file.path.split('/').pop()}"`,
      };
      return new Response(method === 'HEAD' ? null : file.bytes, { headers });
    }

    const account = authorized(init);
    if (!account) return new Response('', { status: 401 });
    if (path === '/ocs/v2.php/cloud/user') {
      return json(state.brokenUser ? { ocs: {} } : { ocs: { data: { id: account.id } } });
    }
    if (path === '/ocs/v2.php/core/apppassword' && method === 'DELETE') {
      state.revoked.push(account.password);
      return json({ ocs: { data: [] } });
    }
    if (path === '/ocs/v2.php/apps/files_sharing/api/v1/shares') {
      return json({ ocs: { data: [] } });
    }
    if (path === '/remote.php/dav/' && method === 'SEARCH') {
      const body = String(init?.body ?? '');
      if (body.includes('<d:literal>%</d:literal>')) {
        // Every file of the account.
        return multistatus([...files].map(([id, f]) => davResponse(account.id, id, f)).join(''));
      }
      const id = /<oc:fileid\/><\/d:prop><d:literal>(\d+)<\/d:literal>/.exec(body)?.[1];
      const file = id ? files.get(id) : undefined;
      return multistatus(id && file ? davResponse(account.id, id, file) : '');
    }
    const dav = /^\/remote\.php\/dav\/files\/([^/]+)(\/.*)?$/.exec(path);
    if (dav && dav[1] !== account.id) return new Response('', { status: 403 });
    if (dav && method === 'PROPFIND') {
      const folder = (dav[2] ?? '/').replace(/\/$/, '') || '/';
      const prefix = `${folder === '/' ? '' : folder}/`;
      const below = [...files].filter(([, f]) => f.path.startsWith(prefix));
      // Depth 1: the files right in it, and the folders on the way to the others.
      const inFolder = below.filter(([, f]) => !f.path.slice(prefix.length).includes('/'));
      const subfolders = new Set(
        below
          .map(([, f]) => f.path.slice(prefix.length).split('/'))
          .filter((parts) => parts.length > 1)
          .map((parts) => parts[0]!),
      );
      const folderResponse = (path: string, id: string) =>
        `<d:response><d:href>/remote.php/dav/files/${account.id}${path === '/' ? '/' : `${path}/`}</d:href>
          <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><oc:fileid>${id}</oc:fileid></d:prop>
          <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      return multistatus(
        folderResponse(folder, '1') +
          [...subfolders]
            .map((name) => folderResponse(`${prefix}${name}`, `dir-${name}`))
            .join('') +
          inFolder.map(([id, f]) => davResponse(account.id, id, f)).join(''),
      );
    }
    if (dav && method === 'GET') {
      if (state.refuseDownloads) return new Response('', { status: 401 });
      const file = [...files.values()].find((f) => f.path === dav[2]);
      return file ? new Response(file.bytes) : new Response('', { status: 404 });
    }
    throw new Error(`Unexpected request: ${method} ${url.href}`);
  });
  return { fetch, files, state, calls };
}

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

async function connect(context: TestContext, nc: ReturnType<typeof fakeNextcloud>) {
  const start = await context.request('/api/nextcloud/login', {
    method: 'POST',
    json: { server: 'cloud.example.de/' },
  });
  expect(start.status).toBe(200);
  const { id, loginUrl } = (await start.json()) as NextcloudLoginStart;
  expect(loginUrl).toBe(`${SERVER}/login/v2/flow/abc`);
  // Nextcloud's grant page names this Slider and the account asking.
  const [, init] = nc.fetch.mock.calls.at(-1)!;
  expect(new Headers(init?.headers).get('user-agent')).toMatch(
    /^Slider \(localhost:5173\) für \S+@/,
  );
  const poll = () => context.request(`/api/nextcloud/login/${id}/poll`, { method: 'POST' });
  expect(await (await poll()).json()).toEqual({ status: 'pending' });
  nc.state.granted = true;
  const done = (await (await poll()).json()) as { status: 'done'; connection: NextcloudConnection };
  expect(done.status).toBe('done');
  // Picked up once: the same login cannot hand the password out again.
  expect(await (await poll()).json()).toEqual({ status: 'expired' });
  return done.connection;
}

describe('NextcloudClient', () => {
  it.each(['PUT', 'DELETE', 'MOVE', 'POST', 'PROPPATCH', 'MKCOL'])(
    'refuses %s before anything leaves the server',
    async (method) => {
      const fetch = vi.fn<FetchLike>();
      const client = new NextcloudClient(
        { fetch, lookup: publicLookup, maxBytes: 1024 },
        { server: SERVER, loginName: 'robert', userId: 'robert-id', appPassword: 'pw' },
      );
      await expect(client.request(method, '/remote.php/dav/files/robert-id/x')).rejects.toThrow(
        /only reads/,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('reads multistatus answers whatever the namespace prefixes', () => {
    const [resource] = parseMultistatus(`<D:multistatus xmlns:D="DAV:"><D:response>
      <D:href>/remote.php/dav/files/a/Q%204.pptx</D:href>
      <D:propstat><D:prop><x1:fileid xmlns:x1="http://owncloud.org/ns">7</x1:fileid>
        <D:getetag>&quot;abc&quot;</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
      <D:propstat><D:prop><D:getcontentlength/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
    </D:response></D:multistatus>`);
    expect(resource).toEqual({
      href: '/remote.php/dav/files/a/Q%204.pptx',
      props: { fileid: '7', getetag: '"abc"' },
    });
  });

  it('reads a hostile answer full of unclosed tags in linear time', () => {
    const prop = (inner: string) =>
      `<d:response><d:href>/x</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop>${inner}</d:prop></d:propstat></d:response>`;
    const started = performance.now();
    expect(parseMultistatus('<d:multistatus>' + '<d:response>'.repeat(200_000))).toEqual([]);
    expect(parseMultistatus(prop('<a>'.repeat(200_000)))).toHaveLength(1);
    expect(parseMultistatus(prop(`<d:x>${'<![CDATA['.repeat(100_000)}</d:x>`))).toHaveLength(1);
    // A lazy regex took minutes on this much; a linear scan takes milliseconds.
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('reads an endless unclosed tag name in linear time', () => {
    const head = '<d:response><d:href>/a</d:href>';
    const started = performance.now();
    expect(parseMultistatus(head + '<' + 'x-'.repeat(100_000))).toEqual([]);
    expect(parseMultistatus(head + '<d:' + 'x-'.repeat(100_000))).toEqual([]);
    // A `\b` after the name backtracked to every `-` and rescanned the rest: 80 KB took 16 s.
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('Nextcloud (BER-135)', () => {
  it('connects with Login Flow v2, browses, imports, follows a moved file and disconnects', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const connection = await connect(ctx, nc);
    expect(connection).toMatchObject({ server: SERVER, account: 'robert', needsReconnect: false });
    const [row] = await ctx.deps.db.select().from(nextcloudConnections);
    expect(row?.appPassword).toMatch(/^v1\./); // encrypted, never the password itself

    const listing = (await (
      await ctx.request(`/api/nextcloud/${connection.id}/files?path=/Decks`)
    ).json()) as NextcloudListing;
    expect(listing.entries.map((e) => e.name)).toEqual(['Notizen.docx', 'Q4.pptx']);
    expect(listing.entries[1]).toMatchObject({
      fileId: '101',
      path: '/Decks/Q4.pptx',
      folder: false,
    });

    const created = await ctx.request('/api/decks/nextcloud-item', {
      method: 'POST',
      json: { connectionId: connection.id, fileId: '101' },
    });
    expect(created.status).toBe(201);
    const { id: deckId } = (await created.json()) as { id: string };
    await ctx.deps.queue.idle();
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck).toMatchObject({
      source: 'nextcloud',
      sourceRef: `${SERVER}/f/101`,
      nextcloudConnectionId: connection.id,
    });

    // Renamed and moved, then changed: found again by its id.
    nc.files.set('101', {
      ...nc.files.get('101')!,
      path: '/Archiv/Q4 final.pptx',
      etag: '"e9"',
      bytes: pptx('v2'),
    });
    const result = await ctx.deps.sync.checkDeck(deckId, { manual: true });
    expect(result.status).toBe('updated');

    const removed = await ctx.request(`/api/me/nextcloud/${connection.id}`, { method: 'DELETE' });
    expect(await removed.json()).toEqual({ revoked: true });
    expect(nc.state.revoked).toEqual(['app-pw-1']);
    expect(await ctx.deps.db.select().from(nextcloudConnections)).toEqual([]);
    const [after] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(after?.nextcloudConnectionId).toBeNull();
    expect(after?.syncState.lastSyncError?.code).toBe('auth_required');
    // Its owner still opens it (their account read it); the banner asks to connect again.
    const opened = await ctx.request(`/api/decks/${deckId}`);
    expect(opened.status).toBe(200);
  });

  it('lists every file and folder, and turns down importing one that is no PowerPoint', async () => {
    const nc = fakeNextcloud();
    nc.files.set('103', {
      path: '/Leer/Brief.docx',
      etag: '"e3"',
      bytes: pptx('x'),
      mime: 'x/docx',
    });
    nc.files.set('104', {
      path: '/Archiv/2025/Alt.pptx',
      etag: '"e4"',
      bytes: pptx('alt'),
      mime: PPTX_MIME,
    });
    ctx = await createTestContext({ fetch: nc.fetch });
    const connection = await connect(ctx, nc);
    const list = async (path: string) =>
      (
        (await (
          await ctx!.request(`/api/nextcloud/${connection.id}/files?path=${path}`)
        ).json()) as NextcloudListing
      ).entries.map((e) => `${e.folder ? 'dir' : 'file'}:${e.name}`);

    expect(await list('/')).toEqual(['dir:Archiv', 'dir:Decks', 'dir:Leer']);
    expect(await list('/Archiv')).toEqual(['dir:2025']);
    expect(await list('/Decks')).toEqual(['file:Notizen.docx', 'file:Q4.pptx']);
    expect(await list('/Leer')).toEqual(['file:Brief.docx']);

    const refused = await ctx.request('/api/decks/nextcloud-item', {
      method: 'POST',
      json: { connectionId: connection.id, fileId: '103' },
    });
    expect(refused.status).toBe(400);
  });

  it('sorts numbers like Nextcloud and finds presentations by every word, in any order', async () => {
    const nc = fakeNextcloud();
    for (const [id, path] of [
      ['201', '/Folien/10_Strategie_JK_v1.pptx'],
      ['202', '/Folien/2_Strategie_MK.pptx'],
      ['203', '/Folien/Jk-Notizen.pptx'],
    ] as const) {
      nc.files.set(id, { path, etag: `"${id}"`, bytes: pptx(id), mime: PPTX_MIME });
    }
    ctx = await createTestContext({ fetch: nc.fetch });
    const connection = await connect(ctx, nc);
    const names = async (url: string) =>
      ((await (await ctx!.request(url)).json()) as NextcloudListing).entries.map((e) => e.name);

    expect(await names(`/api/nextcloud/${connection.id}/files?path=/Folien`)).toEqual([
      '2_Strategie_MK.pptx',
      '10_Strategie_JK_v1.pptx',
      'Jk-Notizen.pptx',
    ]);
    expect(await names(`/api/nextcloud/${connection.id}/search?q=jk%20strategie`)).toEqual([
      '10_Strategie_JK_v1.pptx',
    ]);
  });

  it('imports internal links through the matching account, and asks to connect without one', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const link = `${SERVER}/index.php/f/101`;
    const refused = await ctx.request('/api/decks/link', { method: 'POST', json: { url: link } });
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({
      error: { code: 'nextcloud_login_required', nextcloudServer: SERVER },
    });

    const connection = await connect(ctx, nc);
    const created = await ctx.request('/api/decks/link', { method: 'POST', json: { url: link } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, id));
    expect(deck?.nextcloudConnectionId).toBe(connection.id);
  });

  it('imports public shares without any account', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const res = await ctx.request('/api/decks/link', {
      method: 'POST',
      json: { url: `${SERVER}/s/Ab3dEf9GhJkLmNo` },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, id));
    expect(deck).toMatchObject({
      source: 'nextcloud',
      sourceRef: `${SERVER}/s/Ab3dEf9GhJkLmNo`,
      nextcloudConnectionId: null,
    });
    expect(nc.calls.every((call) => !call.url.includes('/remote.php/'))).toBe(true);
  });

  it('marks the account for reconnecting once Nextcloud refuses its app password', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const connection = await connect(ctx, nc);
    nc.state.revoked.push('app-pw-1'); // revoked under Settings → Security
    const res = await ctx.request(`/api/nextcloud/${connection.id}/files?path=/`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'nextcloud_login_required' } });
    const [listed] = (await (
      await ctx.request('/api/me/nextcloud')
    ).json()) as NextcloudConnection[];
    expect(listed?.needsReconnect).toBe(true);
  });

  it('switches a deck to another account at the server once its own loses access', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const first = await connect(ctx, nc);
    const created = await ctx.request('/api/decks/nextcloud-item', {
      method: 'POST',
      json: { connectionId: first.id, fileId: '101' },
    });
    expect(created.status).toBe(201);
    const { id: deckId } = (await created.json()) as { id: string };
    await ctx.deps.queue.idle();

    nc.state.granted = false;
    nc.state.account = { loginName: 'anna', id: 'anna-id' };
    const second = await connect(ctx, nc);
    nc.state.revoked.push('app-pw-1'); // the first account's password, revoked at Nextcloud
    nc.files.set('101', { ...nc.files.get('101')!, etag: '"e9"', bytes: pptx('v2') });

    const result = await ctx.deps.sync.checkDeck(deckId, { manual: true });
    expect(result.status).toBe('updated');
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck?.nextcloudConnectionId).toBe(second.id);
    const listed = (await (await ctx.request('/api/me/nextcloud')).json()) as NextcloudConnection[];
    expect(listed.find((c) => c.id === first.id)?.needsReconnect).toBe(true);
  });

  it('reads through the other accounts when the deck’s connection is gone, else asks to log in', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const first = await connect(ctx, nc);
    const context = { userId: ctx.ownerId, nextcloudConnectionId: 'gone' };
    const file = await ctx.deps.sources.nextcloud.resolveFile(SERVER, '101', context);
    expect(file.fileName).toBe('Q4.pptx');
    expect(context.nextcloudConnectionId).toBe(first.id);

    // No account left: a login is missing, the file itself is not "deleted or moved".
    await ctx.deps.db.delete(nextcloudConnections).where(eq(nextcloudConnections.id, first.id));
    await expect(
      ctx.deps.sources.nextcloud.resolveFile(SERVER, '101', {
        userId: ctx.ownerId,
        nextcloudConnectionId: 'gone',
      }),
    ).rejects.toMatchObject({ code: 'nextcloud_login_required' });
  });

  it('keeps syncing when the account that worked is disconnected during the check', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const first = await connect(ctx, nc);
    const created = await ctx.request('/api/decks/nextcloud-item', {
      method: 'POST',
      json: { connectionId: first.id, fileId: '101' },
    });
    const { id: deckId } = (await created.json()) as { id: string };
    await ctx.deps.queue.idle();
    nc.state.granted = false;
    nc.state.account = { loginName: 'anna', id: 'anna-id' };
    const second = await connect(ctx, nc);
    nc.state.revoked.push('app-pw-1');

    // The owner clicks "Trennen" on the second account while it answers the check.
    const adapter = ctx.deps.sources.nextcloud;
    const original = adapter.getChangeToken.bind(adapter);
    const db = ctx.deps.db;
    vi.spyOn(adapter, 'getChangeToken').mockImplementationOnce(async (remote, context) => {
      const token = await original(remote, context);
      await db.delete(nextcloudConnections).where(eq(nextcloudConnections.id, second.id));
      return token;
    });
    const result = await ctx.deps.sync.checkDeck(deckId, { manual: true });
    expect(result).not.toMatchObject({ error: { code: 'internal' } });
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck?.nextcloudConnectionId).toBe(first.id);
  });

  it('takes the app password back when the connection cannot be saved', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const start = await ctx.request('/api/nextcloud/login', {
      method: 'POST',
      json: { server: SERVER },
    });
    const { id } = (await start.json()) as NextcloudLoginStart;
    nc.state.granted = true;
    nc.state.brokenUser = true;
    const poll = await ctx.request(`/api/nextcloud/login/${id}/poll`, { method: 'POST' });
    expect(poll.status).toBe(502);
    expect(nc.state.revoked).toEqual(['app-pw-1']);
    expect(await ctx.deps.db.select().from(nextcloudConnections)).toEqual([]);
  });

  it('keeps one connection when two tabs finish the same login at once', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const start = () =>
      ctx!.request('/api/nextcloud/login', { method: 'POST', json: { server: SERVER } });
    const ids = await Promise.all(
      [await start(), await start()].map(
        async (res) => ((await res.json()) as NextcloudLoginStart).id,
      ),
    );
    nc.state.granted = true;
    const polls = await Promise.all(
      ids.map((id) => ctx!.request(`/api/nextcloud/login/${id}/poll`, { method: 'POST' })),
    );
    const done = (await Promise.all(polls.map((res) => res.json()))) as {
      status: string;
      connection: NextcloudConnection;
    }[];
    expect(done.map((d) => d.status)).toEqual(['done', 'done']);
    expect(done[0]!.connection.id).toBe(done[1]!.connection.id);
    expect(await ctx.deps.db.select().from(nextcloudConnections)).toHaveLength(1);
    // The password that lost is revoked at Nextcloud, not left behind.
    expect(nc.state.revoked).toHaveLength(1);
  });

  it('asks to reconnect when Nextcloud refuses the download', async () => {
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch });
    const connection = await connect(ctx, nc);
    nc.state.refuseDownloads = true;
    const res = await ctx.request('/api/decks/nextcloud-item', {
      method: 'POST',
      json: { connectionId: connection.id, fileId: '101' },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'nextcloud_login_required' } });
    const [listed] = (await (
      await ctx.request('/api/me/nextcloud')
    ).json()) as NextcloudConnection[];
    expect(listed?.needsReconnect).toBe(true);
  });

  it('imports a PowerPoint that Nextcloud knows by its type only, named .pptx', async () => {
    const nc = fakeNextcloud();
    nc.files.set('103', {
      path: '/Decks/Ohne Endung',
      etag: '"e3"',
      bytes: pptx('v1'),
      mime: PPTX_MIME,
    });
    ctx = await createTestContext({ fetch: nc.fetch });
    const connection = await connect(ctx, nc);
    const res = await ctx.request('/api/decks/nextcloud-item', {
      method: 'POST',
      json: { connectionId: connection.id, fileId: '103' },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ fileName: 'Ohne Endung.pptx' });
  });

  it('only lets the organisation’s Nextcloud live on an internal address', async () => {
    const internal: LookupAll = async () => [{ address: '10.0.0.5' }];
    const nc = fakeNextcloud();
    ctx = await createTestContext({ fetch: nc.fetch, lookup: internal });
    const refused = await ctx.request('/api/nextcloud/login', {
      method: 'POST',
      json: { server: SERVER },
    });
    expect(refused.status).toBe(400);
    expect(nc.fetch).not.toHaveBeenCalled();
    await ctx.cleanup();

    ctx = await createTestContext({
      fetch: nc.fetch,
      lookup: internal,
      config: { nextcloud: { server: SERVER, login: null, loginAnyServer: false } },
    });
    // The fixed server wins over whatever is typed.
    const allowed = await ctx.request('/api/nextcloud/login', {
      method: 'POST',
      json: { server: 'https://elsewhere.example' },
    });
    expect(allowed.status).toBe(200);
    expect(nc.calls.at(-1)?.url).toBe(`${SERVER}/index.php/login/v2`);
  });
});
