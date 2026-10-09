import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deckSchema, slideSchema, viewerSchema, type Deck } from '@slider/shared';
import { z } from 'zod';
import { decks, revisions } from '../src/db/schema';
import {
  createReadyDeck,
  createTestContext,
  MICROSOFT_TEST_CONFIG,
  pinComment,
  stubPptx,
  type TestContext,
} from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());

const uploadForm = (name: string, bytes: Uint8Array<ArrayBuffer>) => {
  const form = new FormData();
  form.append('file', new File([bytes], name));
  return form;
};

describe('GET /api/me', () => {
  it('returns the dev owner without a guest cookie', async () => {
    const res = await ctx.request('/api/me');
    expect(res.status).toBe(200);
    const body = z.object({ viewer: viewerSchema }).parse(await res.json());
    expect(body.viewer).toMatchObject({
      kind: 'owner',
      author: { name: 'Robert Hofmann', type: 'owner' },
    });
  });
});

describe('decks', () => {
  it('lists the owner’s decks, most recently updated first, with aggregates', async () => {
    const older = await createReadyDeck(ctx, { title: 'Alt', slideCount: 2 });
    const newer = await createReadyDeck(ctx, { title: 'Neu', slideCount: 4 });
    await ctx.request(`/api/decks/${newer.deckId}/comments`, {
      method: 'POST',
      json: pinComment(newer.slideIds[0] ?? ''),
    });

    const res = await ctx.request('/api/decks');
    expect(res.status).toBe(200);
    const list = deckSchema.array().parse(await res.json());
    expect(list.map((deck) => deck.title)).toEqual(['Neu', 'Alt']);
    expect(list[0]).toMatchObject({
      id: newer.deckId,
      slideCount: 4,
      openCommentCount: 1,
      revisionNumber: 1,
      thumbnailUrl: `/files/${newer.imageKeys[0]}`,
      thumbnailRenderer: null,
      participants: [{ name: 'Robert Hofmann' }],
    });
    // Nobody commented on the older deck: the owner stands in, so every deck has an avatar.
    expect(list[1]).toMatchObject({
      id: older.deckId,
      openCommentCount: 0,
      participants: [{ name: 'Robert Hofmann', type: 'owner' }],
    });
  });

  it('shows whoever last saved the file first, even without a Slider account', async () => {
    await ctx.cleanup();
    ctx = await createTestContext({ openPptx: stubPptx({ author: 'Kim Kollege' }) });
    const res = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: uploadForm('Von Kim.pptx', new Uint8Array([1, 2, 3])),
    });
    const { id } = deckSchema.parse(await res.json());
    await ctx.deps.queue.idle();
    const deck = deckSchema.parse(await (await ctx.request(`/api/decks/${id}`)).json());
    expect(deck.participants).toEqual([
      expect.objectContaining({ name: 'Kim Kollege', type: 'external' }),
    ]);
  });

  it('gets, renames and archives a deck', async () => {
    const { deckId } = await createReadyDeck(ctx);
    expect((await ctx.request(`/api/decks/${deckId}`)).status).toBe(200);

    const renamed = await ctx.request(`/api/decks/${deckId}`, {
      method: 'PATCH',
      json: { title: '  Neuer Titel ' },
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as Deck).title).toBe('Neuer Titel');

    const archived = await ctx.request(`/api/decks/${deckId}`, {
      method: 'PATCH',
      json: { archived: true },
    });
    expect(deckSchema.parse(await archived.json()).archivedAt).not.toBeNull();
    const restored = await ctx.request(`/api/decks/${deckId}`, {
      method: 'PATCH',
      json: { archived: false },
    });
    expect(deckSchema.parse(await restored.json()).archivedAt).toBeNull();
  });

  it('rejects an empty title', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const res = await ctx.request(`/api/decks/${deckId}`, {
      method: 'PATCH',
      json: { title: '   ' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('returns 404 for unknown decks', async () => {
    const res = await ctx.request('/api/decks/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('deletes a deck together with its files', async () => {
    const { deckId, imageKeys } = await createReadyDeck(ctx);
    const key = imageKeys[0] ?? '';
    expect((await ctx.request(`/files/${key}`)).status).toBe(200);

    expect((await ctx.request(`/api/decks/${deckId}`, { method: 'DELETE' })).status).toBe(204);
    expect((await ctx.request(`/api/decks/${deckId}`)).status).toBe(404);
    expect(await ctx.deps.storage.get(key)).toBeNull();
    expect((await ctx.request(`/files/${key}`)).status).toBe(404);
  });

  it('lists slides of the current revision in order', async () => {
    const { deckId, slideIds } = await createReadyDeck(ctx, { slideCount: 3 });
    await ctx.request(`/api/decks/${deckId}/comments`, {
      method: 'POST',
      json: pinComment(slideIds[1] ?? ''),
    });

    const list = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deckId}/slides`)).json());
    expect(list.map((slide) => slide.id)).toEqual(slideIds);
    expect(list.map((slide) => slide.openCommentCount)).toEqual([0, 1, 0]);
    expect(list[0]?.imageUrl).toMatch(/^\/files\/decks\//);
  });
});

describe('POST /api/decks/upload', () => {
  it('creates a queued deck and imports it in the background', async () => {
    const res = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: uploadForm('Quartalszahlen Q3.pptx', new Uint8Array([1, 2, 3])),
    });
    expect(res.status).toBe(201);
    const deck = deckSchema.parse(await res.json());
    expect(deck).toMatchObject({
      title: 'Quartalszahlen Q3',
      source: 'upload',
      import: { status: 'queued' },
    });

    await ctx.deps.queue.idle();
    const after = deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json());
    expect(after).toMatchObject({ import: { status: 'ready' }, slideCount: 2 });
  });

  it('rejects files that are not .pptx', async () => {
    const res = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: uploadForm('notes.pdf', new Uint8Array([1])),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'not_a_powerpoint' } });
  });

  it('rejects files above the upload limit', async () => {
    const small = await createTestContext({ config: { maxUploadBytes: 100 } });
    try {
      const res = await small.request('/api/decks/upload', {
        method: 'POST',
        body: uploadForm('gross.pptx', new Uint8Array(200)),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: { code: 'file_too_large' } });
    } finally {
      await small.cleanup();
    }
  });

  it('requires the file field', async () => {
    const res = await ctx.request('/api/decks/upload', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/decks/link', () => {
  it('rejects links that are neither OneDrive, SharePoint nor a .pptx file', async () => {
    const res = await ctx.request('/api/decks/link', {
      method: 'POST',
      json: { url: 'https://example.com/page.html' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'unsupported_link' } });
  });

  it('says how to set up the Microsoft login when it is not configured', async () => {
    const res = await ctx.request('/api/decks/link', {
      method: 'POST',
      json: { url: 'https://1drv.ms/p/c/abc123/EXAMPLE' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('microsoft_not_configured');
    expect(body.error.message).toContain('MS_CLIENT_ID');
  });

  it('imports a direct .pptx URL without any login', async () => {
    await ctx.cleanup();
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    ctx = await createTestContext({
      fetch: async () =>
        new Response(bytes, {
          headers: {
            'content-type':
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            etag: '"v1"',
          },
        }),
    });
    const res = await ctx.request('/api/decks/link', {
      method: 'POST',
      json: { url: 'https://example.com/files/Q4%20Strategie.pptx' },
    });
    expect(res.status).toBe(201);
    const deck = deckSchema.parse(await res.json());
    expect(deck).toMatchObject({
      source: 'url',
      title: 'Q4 Strategie',
      fileName: 'Q4 Strategie.pptx',
    });

    const [row] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deck.id));
    expect(row).toMatchObject({
      sourceUrl: 'https://example.com/files/Q4%20Strategie.pptx',
      sourceRef: 'https://example.com/files/Q4%20Strategie.pptx',
    });
    const [revision] = await ctx.deps.db
      .select()
      .from(revisions)
      .where(eq(revisions.deckId, deck.id));
    expect(revision?.sourceChangeToken).toBe('"v1"');
  });

  it('asks for a Microsoft login (with a login URL) when configured but not signed in', async () => {
    await ctx.cleanup();
    ctx = await createTestContext({
      config: { microsoft: MICROSOFT_TEST_CONFIG },
      // The anonymous attempt lands on the Microsoft login page.
      fetch: async () =>
        new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
    });
    const link = 'https://contoso.sharepoint.com/:p:/s/team/EabcDEF';
    const res = await ctx.request('/api/decks/link', { method: 'POST', json: { url: link } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; loginUrl: string } };
    expect(body.error.code).toBe('microsoft_login_required');
    expect(body.error.loginUrl).toBe(
      `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/neu?link=${encodeURIComponent(link)}`)}`,
    );
    expect(
      body.error.loginUrl.startsWith('/api/auth/microsoft/login?returnTo=%2Fneu%3Flink%3D'),
    ).toBe(true);
  });
});
