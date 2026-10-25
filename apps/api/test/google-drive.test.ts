import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoogleConnection } from '@slider/shared';
import type { ParsedSlide } from '@slider/pptx';
import { comments, decks, googleConnections, revisions, slideVersions } from '../src/db/schema';
import type { OpenPptx } from '../src/import/pptx';
import { slideOfAnchor } from '../src/sources/google-drive';
import type { FetchLike } from '../src/sources/safe-fetch';
import { createTestContext, fakeJwt, parsedSlide, stubPptx, type TestContext } from './helpers';
import { makePdf } from './pdf';

const CLIENT_ID = '123456789-abc.apps.googleusercontent.com';
const SLIDES_MIME = 'application/vnd.google-apps.presentation';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const pptx = (marker: string) =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(marker)]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const googleDrive = {
  clientId: CLIENT_ID,
  clientSecret: 'secret',
  redirectUri: 'http://localhost:5173/api/auth/google/callback',
};

interface FakeFile {
  name: string;
  mimeType: string;
  modifiedTime: string;
  bytes: Uint8Array;
  /** Granted to Slider: picked in the picker (`drive.file`). */
  picked: boolean;
  /** "Anyone with the link". */
  public: boolean;
  /** Who saved each revision, oldest first; the last one is the last editor. */
  editors?: string[];
  /** Google Slides' `objectId` of each slide (Slides API). */
  slideIds?: string[];
  /** Drive's `comments.list` answer. */
  comments?: unknown[];
  /** Drive's comment API answers 500. */
  commentsFail?: boolean;
}

/**
 * Google: the token and revoke endpoints, the Drive API (`files.get`, `alt=media`, `export`) and
 * the public export URLs. The Drive API shows only picked files (`drive.file`).
 */
function fakeGoogle() {
  const files = new Map<string, FakeFile>([
    [
      '1SlidesAbCdEfGhIjKlMn',
      {
        name: 'Q4 Strategie',
        mimeType: SLIDES_MIME,
        modifiedTime: '2026-10-19T10:00:00Z',
        bytes: pptx('v1'),
        picked: true,
        public: false,
        editors: ['Kim Kollege', 'Robert', 'Kim Kollege'],
      },
    ],
  ]);
  const state = {
    nonce: '',
    scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
    revoked: [] as string[],
    issued: 0,
    /** Whose Drive the picker page was used with (`about.get`). */
    pickedWith: 'Robert@example.com',
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const notFound = () => json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404);

  const fetch = vi.fn<FetchLike>(async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('authorization');
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body));
      const id = ++state.issued;
      return json({
        access_token: `at-${id}`,
        expires_in: 3600,
        scope: state.scope,
        ...(body.get('grant_type') === 'authorization_code'
          ? {
              refresh_token: 'rt-1',
              id_token: fakeJwt({
                iss: 'https://accounts.google.com',
                sub: 'g-robert',
                aud: CLIENT_ID,
                exp: Math.floor(Date.now() / 1000) + 3600,
                nonce: state.nonce,
                email: 'robert@example.com',
                email_verified: true,
                name: 'Robert',
              }),
            }
          : {}),
      });
    }
    if (url.pathname === '/drive/v3/about' && url.hostname === 'www.googleapis.com') {
      if (!auth?.startsWith('Bearer at-')) return json({ error: { code: 401 } }, 401);
      return json({ user: { emailAddress: state.pickedWith } });
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') {
      state.revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '');
      return new Response('', { status: 200 });
    }
    const exported = /^\/presentation\/d\/([^/]+)\/export\/(pptx|pdf)$/.exec(url.pathname);
    if (url.hostname === 'docs.google.com' && exported) {
      const file = files.get(exported[1]!);
      if (!file?.public) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://accounts.google.com/ServiceLogin' },
        });
      }
      return new Response(exported[2] === 'pdf' ? pdf : file.bytes, {
        headers: {
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}.pptx`,
        },
      });
    }
    if (url.hostname === 'accounts.google.com') {
      return new Response('<html>Anmelden</html>', { headers: { 'content-type': 'text/html' } });
    }
    const presentation = /^\/v1\/presentations\/([^/]+)$/.exec(url.pathname);
    if (url.hostname === 'slides.googleapis.com' && presentation) {
      if (!auth?.startsWith('Bearer at-')) return json({ error: { code: 401 } }, 401);
      const file = files.get(presentation[1]!);
      if (!file?.picked) return notFound();
      expect(url.searchParams.get('fields')).toBe('slides(objectId)');
      return json({ slides: (file.slideIds ?? []).map((objectId) => ({ objectId })) });
    }
    const commentList = /^\/drive\/v3\/files\/([^/]+)\/comments$/.exec(url.pathname);
    if (url.hostname === 'www.googleapis.com' && commentList) {
      if (!auth?.startsWith('Bearer at-')) return json({ error: { code: 401 } }, 401);
      const file = files.get(commentList[1]!);
      if (!file?.picked) return notFound();
      // Drive refuses comment calls without `fields`.
      expect(url.searchParams.get('fields')).toContain('comments(');
      if (file.commentsFail) return json({ error: { code: 500 } }, 500);
      return json({ comments: file.comments ?? [] });
    }
    const revisions = /^\/drive\/v3\/files\/([^/]+)\/revisions$/.exec(url.pathname);
    if (url.hostname === 'www.googleapis.com' && revisions) {
      const file = files.get(revisions[1]!);
      if (!file?.picked) return notFound();
      return json({
        revisions: (file.editors ?? []).map((name) => ({
          lastModifyingUser: { displayName: name },
        })),
      });
    }
    const api = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(url.pathname);
    if (url.hostname === 'www.googleapis.com' && api) {
      if (!auth?.startsWith('Bearer at-')) return json({ error: { code: 401 } }, 401);
      const id = api[1]!;
      const file = files.get(id);
      if (!file?.picked) return notFound();
      if (api[2]) {
        // A Google Slides file exports as its PPTX (or a stub PDF); a Google Doc as its PDF.
        const asPptx = url.searchParams.get('mimeType') === PPTX_MIME;
        return new Response(asPptx || file.mimeType !== SLIDES_MIME ? file.bytes : pdf);
      }
      if (url.searchParams.get('alt') === 'media') return new Response(file.bytes);
      return json({
        id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        webViewLink: `https://docs.google.com/presentation/d/${id}/edit`,
        owners: [{ displayName: 'Olga Owner' }],
        ...(file.editors?.length
          ? { lastModifyingUser: { displayName: file.editors.at(-1) } }
          : {}),
        ...(file.mimeType === SLIDES_MIME
          ? {}
          : { size: String(file.bytes.length), md5Checksum: `md5-${file.modifiedTime}` }),
      });
    }
    throw new Error(`Unexpected request: ${url.href}`);
  });
  return { fetch, files, state };
}

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** "Google Drive verbinden": to Google and back through the login's callback. */
async function connect(context: TestContext, google: ReturnType<typeof fakeGoogle>) {
  const start = await context.request('/api/auth/google/drive?returnTo=%2Fneu%3Fgoogle%3Dpick');
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  expect(authorize.origin + authorize.pathname).toBe(
    'https://accounts.google.com/o/oauth2/v2/auth',
  );
  expect(authorize.searchParams.get('scope')).toContain('auth/drive.file');
  expect(authorize.searchParams.get('scope')).not.toMatch(/drive\.readonly|auth\/drive(\s|$)/);
  expect(authorize.searchParams.get('access_type')).toBe('offline');
  google.state.nonce = authorize.searchParams.get('nonce') ?? '';
  const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const params = new URLSearchParams({
    code: 'code-1',
    state: authorize.searchParams.get('state')!,
  });
  return context.request(`/api/auth/google/callback?${params.toString()}`, { cookie });
}

/** Google's picker page (BER-158): to Google and back with `picked_file_ids` (or an error). */
async function pick(context: TestContext, back: Record<string, string>, query = '') {
  const start = await context.request(`/api/auth/google/pick?returnTo=%2Fneu${query}`);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const params = new URLSearchParams({ state: authorize.searchParams.get('state')!, ...back });
  const res = await context.request(`/api/auth/google/callback?${params.toString()}`, { cookie });
  return { authorize, location: res.headers.get('location') };
}

describe('Google Drive (BER-119)', () => {
  it('connects, picks, imports a Google Slides file, syncs a change and disconnects', async () => {
    const google = fakeGoogle();
    ctx = await createTestContext({ fetch: google.fetch, config: { googleDrive } });
    const back = await connect(ctx, google);
    expect(back.headers.get('location')).toBe('http://localhost:5173/neu?google=pick');
    const [row] = await ctx.deps.db.select().from(googleConnections);
    expect(row).toMatchObject({ subject: 'g-robert', account: 'robert@example.com' });
    expect(row?.refreshToken).toMatch(/^v1\./); // encrypted, never the token itself

    const connections = (await (await ctx.request('/api/me/google')).json()) as GoogleConnection[];
    expect(connections).toMatchObject([{ account: 'robert@example.com', needsReconnect: false }]);

    // Google's picker page, on the connected account, with nothing but `drive.file`.
    const picked = await pick(
      ctx,
      { code: 'code-2', picked_file_ids: '1SlidesAbCdEfGhIjKlMn' },
      '&fileId=1SlidesAbCdEfGhIjKlMn',
    );
    expect(Object.fromEntries(picked.authorize.searchParams)).toMatchObject({
      scope: 'https://www.googleapis.com/auth/drive.file',
      trigger_onepick: 'true',
      prompt: 'consent',
      login_hint: 'robert@example.com',
      file_ids: '1SlidesAbCdEfGhIjKlMn',
    });
    expect(picked.authorize.searchParams.has('mimetypes')).toBe(false);
    expect(picked.location).toBe(
      `http://localhost:5173/neu?googlePicked=1SlidesAbCdEfGhIjKlMn&googleConnection=${row!.id}`,
    );

    const created = await ctx.request('/api/decks/google-item', {
      method: 'POST',
      json: { connectionId: row!.id, fileId: '1SlidesAbCdEfGhIjKlMn' },
    });
    expect(created.status).toBe(201);
    const { id: deckId, title } = (await created.json()) as { id: string; title: string };
    expect(title).toBe('Q4 Strategie');
    await ctx.deps.queue.idle();
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck).toMatchObject({
      source: 'google',
      fileName: 'Q4 Strategie.pptx',
      sourceRef: 'https://docs.google.com/presentation/d/1SlidesAbCdEfGhIjKlMn',
      googleConnectionId: row!.id,
      // Everyone in the revisions, newest first, then the owner.
      sourceContributors: ['Kim Kollege', 'Robert', 'Olga Owner'],
    });

    const unchanged = await ctx.deps.sync.checkDeck(deckId, { manual: true });
    expect(unchanged.status).toBe('unchanged');
    google.files.set('1SlidesAbCdEfGhIjKlMn', {
      ...google.files.get('1SlidesAbCdEfGhIjKlMn')!,
      modifiedTime: '2026-10-19T11:00:00Z',
      bytes: pptx('v2'),
      editors: ['Kim Kollege', 'Robert', 'Kim Kollege', 'Paula Partner'],
    });
    const updated = await ctx.deps.sync.checkDeck(deckId, { manual: true });
    expect(updated.status).toBe('updated');
    const [synced] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(synced?.sourceContributors).toEqual([
      'Paula Partner',
      'Kim Kollege',
      'Robert',
      'Olga Owner',
    ]);

    const removed = await ctx.request(`/api/me/google/${row!.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect(google.state.revoked).toEqual(['rt-1']);
    expect(await ctx.deps.db.select().from(googleConnections)).toEqual([]);
    const [after] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(after?.googleConnectionId).toBeNull();
    expect(after?.syncState.lastSyncError).toMatchObject({ code: 'auth_required' });
  });

  it('imports a PDF from Drive as a review deck', async () => {
    const google = fakeGoogle();
    google.files.set('1PdfAbCdEfGhIjKlMnOp', {
      name: 'Keynote Export.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-10-19T10:00:00Z',
      bytes: makePdf(2),
      picked: true,
      public: false,
    });
    ctx = await createTestContext({ fetch: google.fetch, config: { googleDrive } });
    await connect(ctx, google);
    const [row] = await ctx.deps.db.select().from(googleConnections);

    const created = await ctx.request('/api/decks/google-item', {
      method: 'POST',
      json: { connectionId: row!.id, fileId: '1PdfAbCdEfGhIjKlMnOp' },
    });
    expect(created.status).toBe(201);
    const { id: deckId } = (await created.json()) as { id: string };
    await ctx.deps.queue.idle();
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck?.fileName).toBe('Keynote Export.pdf');
    const [revision] = await ctx.deps.db
      .select()
      .from(revisions)
      .where(eq(revisions.deckId, deckId));
    expect(revision?.pptxKey).toMatch(/\.pdf$/);
    const slides = await ctx.deps.db
      .select()
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, revision!.id));
    expect(slides).toHaveLength(2);
  });

  it("imports a Google Doc as Google's PDF of it, and refuses a folder", async () => {
    const google = fakeGoogle();
    google.files.set('1DocAbCdEfGhIjKlMnOpQ', {
      name: 'Konzept',
      mimeType: 'application/vnd.google-apps.document',
      modifiedTime: '2026-10-19T10:00:00Z',
      bytes: makePdf(3),
      picked: true,
      public: false,
    });
    google.files.set('1DirAbCdEfGhIjKlMnOpQ', {
      name: 'Ablage',
      mimeType: 'application/vnd.google-apps.folder',
      modifiedTime: '2026-10-19T10:00:00Z',
      bytes: new Uint8Array(),
      picked: true,
      public: false,
    });
    ctx = await createTestContext({ fetch: google.fetch, config: { googleDrive } });
    await connect(ctx, google);
    const [row] = await ctx.deps.db.select().from(googleConnections);
    const pick = (fileId: string) =>
      ctx!.request('/api/decks/google-item', {
        method: 'POST',
        json: { connectionId: row!.id, fileId },
      });

    const created = await pick('1DocAbCdEfGhIjKlMnOpQ');
    expect(created.status).toBe(201);
    const { id: deckId } = (await created.json()) as { id: string };
    await ctx.deps.queue.idle();
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck).toMatchObject({ fileName: 'Konzept.pdf', title: 'Konzept' });
    expect(deck?.importState.status).toBe('ready');
    const exports = google.fetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.endsWith('/1DocAbCdEfGhIjKlMnOpQ/export'));
    expect(exports.map((url) => url.searchParams.get('mimeType'))).toEqual(['application/pdf']);

    const folder = await pick('1DirAbCdEfGhIjKlMnOpQ');
    expect(folder.status).toBe(400);
  });

  it('imports a link anyone may open without an account, and asks to pick a private one', async () => {
    const google = fakeGoogle();
    google.files.set('1PublicAbCdEfGhIjKlMn', {
      name: 'Offen',
      mimeType: SLIDES_MIME,
      modifiedTime: '2026-10-19T10:00:00Z',
      bytes: pptx('open'),
      picked: false,
      public: true,
    });
    ctx = await createTestContext({ fetch: google.fetch });

    const open = await ctx.request('/api/decks/link', {
      method: 'POST',
      json: {
        url: 'https://docs.google.com/presentation/d/1PublicAbCdEfGhIjKlMn/edit?usp=sharing',
      },
    });
    expect(open.status).toBe(201);
    const { id: deckId } = (await open.json()) as { id: string };
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(deck).toMatchObject({
      source: 'google',
      fileName: 'Offen.pptx',
      googleConnectionId: null,
    });

    const closed = await ctx.request('/api/decks/link', {
      method: 'POST',
      json: { url: 'https://docs.google.com/presentation/d/1SlidesAbCdEfGhIjKlMn/edit' },
    });
    expect(closed.status).toBe(401);
    const body = (await closed.json()) as {
      error: { code: string; googleFileId?: string; loginUrl?: string };
    };
    expect(body.error).toMatchObject({
      code: 'google_login_required',
      googleFileId: '1SlidesAbCdEfGhIjKlMn',
    });
    expect(body.error.loginUrl).toMatch(/^\/api\/auth\/google\/drive\?returnTo=/);
  });

  it('refuses a connect without Drive access ticked at Google', async () => {
    const google = fakeGoogle();
    google.state.scope = 'openid email profile';
    ctx = await createTestContext({ fetch: google.fetch, config: { googleDrive } });
    const back = await connect(ctx, google);
    expect(back.headers.get('location')).toBe(
      'http://localhost:5173/neu?google=pick&googleError=scope',
    );
    expect(await ctx.deps.db.select().from(googleConnections)).toEqual([]);
  });

  it("connects first when picking without a connection, and refuses another account's pick", async () => {
    const google = fakeGoogle();
    ctx = await createTestContext({ fetch: google.fetch, config: { googleDrive } });
    const first = await ctx.request('/api/auth/google/pick?returnTo=%2Fneu&fileId=1SlidesAbCd');
    expect(first.headers.get('location')).toBe(
      `/api/auth/google/drive?returnTo=${encodeURIComponent('/neu?google=pick&googleFile=1SlidesAbCd')}`,
    );

    await connect(ctx, google);
    // Closing Google's picker just leads back.
    expect((await pick(ctx, { error: 'access_denied' })).location).toBe(
      'http://localhost:5173/neu',
    );
    google.state.pickedWith = 'someone-else@example.com';
    const other = await pick(ctx, { code: 'code-2', picked_file_ids: '1SlidesAbCdEfGhIjKlMn' });
    expect(other.location).toBe('http://localhost:5173/neu?googleError=account');
  });

  it('answers google_not_configured without the Google login', async () => {
    ctx = await createTestContext();
    const res = await ctx.request('/api/auth/google/pick');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'google_not_configured',
    );
  });
});

describe('Google Slides ids and comments (BER-157)', () => {
  /** Two slides that look exactly alike: content alone cannot tell them apart. */
  const twins = (): ParsedSlide[] =>
    [0, 1].map((i) => {
      const slide = parsedSlide(256 + i, i);
      return {
        ...slide,
        title: 'Agenda',
        textHash: 'agenda',
        shapes: slide.shapes.map((shape) => ({ ...shape, text: 'Agenda' })),
      };
    });
  const openTwins: OpenPptx = async (bytes) => await stubPptx({ slides: twins() })(bytes);

  const comment = (overrides: Record<string, unknown> = {}) => ({
    id: 'AAAAc1',
    author: { displayName: 'Robert', emailAddress: 'robert@example.org' },
    content: 'Zahlen prüfen',
    createdTime: '2026-10-19T09:00:00Z',
    resolved: false,
    anchor: JSON.stringify({ r: 'head', a: [{ page: { p: 'p2' } }] }),
    replies: [
      {
        id: 'AAAAr1',
        author: { displayName: 'Kim Kollege' },
        content: 'Mache ich',
        createdTime: '2026-10-19T09:30:00Z',
      },
      // A resolve mark without text.
      { id: 'AAAAr2', author: { displayName: 'Kim Kollege' }, content: '' },
    ],
    ...overrides,
  });

  it('imports the comments on their slide and keeps slides apart by objectId on a sync', async () => {
    const google = fakeGoogle();
    const fileId = '1SlidesAbCdEfGhIjKlMn';
    google.files.set(fileId, {
      ...google.files.get(fileId)!,
      slideIds: ['p1', 'p2'],
      comments: [
        comment(),
        // Without an anchor Google says nothing about the slide: left out.
        comment({ id: 'AAAAc2', anchor: undefined, replies: [] }),
        comment({ id: 'AAAAc3', deleted: true, replies: [] }),
      ],
    });
    ctx = await createTestContext({
      fetch: google.fetch,
      config: { googleDrive },
      openPptx: openTwins,
    });
    await connect(ctx, google);
    const [connection] = await ctx.deps.db.select().from(googleConnections);
    const created = await ctx.request('/api/decks/google-item', {
      method: 'POST',
      json: { connectionId: connection!.id, fileId },
    });
    const { id: deckId } = (await created.json()) as { id: string };
    await ctx.deps.queue.idle();

    const versions = await ctx.deps.db.select().from(slideVersions);
    expect(versions.map((v) => [v.position, v.sourceSlideId]).sort()).toEqual([
      [0, 'p1'],
      [1, 'p2'],
    ]);
    const slideOf = (objectId: string) =>
      versions.find((v) => v.sourceSlideId === objectId)?.slideId;
    const imported = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
    expect(imported).toHaveLength(2);
    const root = imported.find((row) => row.externalId === 'AAAAc1');
    expect(root).toMatchObject({
      source: 'gslides',
      slideId: slideOf('p2'),
      body: 'Zahlen prüfen',
      status: 'open',
      anchor: { type: 'slide' },
      // The address names the deck owner: shown as them, not as a stranger.
      author: { name: 'Robert Hofmann', type: 'owner' },
    });
    expect(imported.find((row) => row.externalId === 'AAAAc1/AAAAr1')).toMatchObject({
      parentId: root!.id,
      author: { name: 'Kim Kollege', type: 'external' },
    });

    // Comments cannot be edited in Slider, like PowerPoint's.
    const edit = await ctx.request(`/api/comments/${root!.id}`, {
      method: 'PATCH',
      json: { body: 'anders' },
    });
    expect(edit.status).toBe(403);

    // The twins swap places in Google, and the comment is resolved there.
    google.files.set(fileId, {
      ...google.files.get(fileId)!,
      modifiedTime: '2026-10-19T11:00:00Z',
      bytes: pptx('v2'),
      slideIds: ['p2', 'p1'],
      comments: [comment({ resolved: true })],
    });
    expect((await ctx.deps.sync.checkDeck(deckId, { manual: true })).status).toBe('updated');
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    const current = await ctx.deps.db
      .select()
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, deck!.currentRevisionId!));
    // Same Slider slide, now first: the content alone would have kept it second.
    expect(current.find((v) => v.slideId === slideOf('p2'))).toMatchObject({
      position: 0,
      sourceSlideId: 'p2',
    });
    const [after] = await ctx.deps.db.select().from(comments).where(eq(comments.id, root!.id));
    expect(after).toMatchObject({ slideId: slideOf('p2'), status: 'done' });
  });

  it("places Drive's comments where the export has them, taking over the export's own", async () => {
    const google = fakeGoogle();
    const fileId = '1SlidesAbCdEfGhIjKlMn';
    // Google's export: the comment as a legacy one with a position, no zone on its time.
    const exported = stubPptx({
      comments: [
        {
          externalId: '0:1',
          format: 'legacy',
          sldId: 256,
          author: { name: 'Robert Hofmann', initials: null },
          createdAt: '2026-10-20T14:52:58.143',
          text: 'Google Comment',
          status: 'open',
          anchor: { type: 'point', point: { x: 0.3, y: 0.1 } },
          replies: [],
        },
      ],
    });
    google.files.set(fileId, {
      ...google.files.get(fileId)!,
      // Drive's comment API is down at the first import.
      commentsFail: true,
      comments: [
        comment({
          id: 'AAAAc9',
          content: 'Google Comment',
          createdTime: '2026-10-20T14:52:58.143Z',
          anchor: undefined,
          replies: [],
        }),
      ],
    });
    ctx = await createTestContext({
      fetch: google.fetch,
      config: { googleDrive },
      openPptx: exported,
    });
    await connect(ctx, google);
    const [connection] = await ctx.deps.db.select().from(googleConnections);
    const created = await ctx.request('/api/decks/google-item', {
      method: 'POST',
      json: { connectionId: connection!.id, fileId },
    });
    const { id: deckId } = (await created.json()) as { id: string };
    await ctx.deps.queue.idle();
    const [first] = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
    // A Google comment, not a PowerPoint one, though it came out of the PPTX.
    expect(first).toMatchObject({ source: 'gslides', externalId: '0:1' });

    google.files.set(fileId, {
      ...google.files.get(fileId)!,
      commentsFail: false,
      modifiedTime: '2026-10-20T15:00:00Z',
      bytes: pptx('v2'),
    });
    expect((await ctx.deps.sync.checkDeck(deckId, { manual: true })).status).toBe('updated');
    const after = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
    // Same row, now with Drive's id and still where the export put it.
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      id: first!.id,
      source: 'gslides',
      externalId: 'AAAAc9',
      removedInSourceAt: null,
      anchor: { type: 'point', point: { x: 0.3, y: 0.1 } },
    });
  });

  it('finds the slide in the anchor by its objectId values only', () => {
    const ids = ['p', 'g2a3_0', 'g2a3_1'];
    expect(slideOfAnchor(JSON.stringify({ r: 'head', a: [{ pg: 'g2a3_1' }] }), ids)).toBe('g2a3_1');
    // A key named like a slide id is no slide.
    expect(slideOfAnchor(JSON.stringify({ p: 'x' }), ids)).toBeNull();
    // Two slides named: which one is a guess.
    expect(slideOfAnchor(JSON.stringify(['g2a3_0', 'g2a3_1']), ids)).toBeNull();
    expect(slideOfAnchor('kix.abc g2a3_0', ids)).toBe('g2a3_0');
    expect(slideOfAnchor(undefined, ids)).toBeNull();
  });
});
