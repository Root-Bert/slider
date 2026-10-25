import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commentSchema, type Comment, type CreateMediaCommentInput } from '@slider/shared';
import { workspaceMembers } from '../src/db/schema';
import { parseRange } from '../src/http/range';
import { MEDIA_UPLOADS_PER_HOUR } from '../src/routes/media';
import { sniffMediaContainer } from '../src/services/media';
import { DEFAULT_PLAN_LIMITS } from '../src/services/plans';
import {
  createReadyDeck,
  createTestContext,
  signedInUser,
  type DeckFixture,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let deck: DeckFixture;
beforeEach(async () => {
  ctx = await createTestContext({
    config: {
      media: { dir: '/unused', maxBytes: 3000 },
      plans: {
        ...DEFAULT_PLAN_LIMITS,
        free: { maxMembers: 5, maxDecks: 3, maxStorageBytes: 4096 },
      },
    },
  });
  deck = await createReadyDeck(ctx, { slideCount: 2 });
});
afterEach(() => ctx.cleanup());

/** A tiny "WebM": the EBML magic followed by filler bytes. */
const webm = (size = 1000) => {
  const bytes = new Uint8Array(size).fill(7);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  return bytes;
};

const voiceComment = (
  overrides: Partial<CreateMediaCommentInput> = {},
): CreateMediaCommentInput => ({
  slideId: deck.slideIds[0] ?? '',
  body: '',
  anchor: { type: 'point', point: { x: 0.5, y: 0.5 }, shapeRef: null },
  media: { kind: 'audio', durationMs: 4200, peaks: [0.1, 0.8, 0.4] },
  ...overrides,
});

function upload(
  input: CreateMediaCommentInput,
  bytes: Uint8Array<ArrayBuffer> = webm(),
  type = 'audio/webm;codecs=opus',
  cookie?: string,
) {
  const form = new FormData();
  form.append('comment', JSON.stringify(input));
  form.append('file', new File([bytes], 'aufnahme.webm', { type }));
  return ctx.request(`/api/decks/${deck.deckId}/media-comments`, {
    method: 'POST',
    body: form,
    cookie,
  });
}

async function create(input = voiceComment(), bytes = webm()): Promise<Comment> {
  const res = await upload(input, bytes);
  expect(res.status).toBe(201);
  return commentSchema.parse(await res.json());
}

/** Another member of the workspace who may comment. */
async function joinAsMember(name: string): Promise<string> {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role: 'reviewer' });
  return person.cookie;
}

describe('voice and video comments', () => {
  it('stores the recording and lists it with the comment', async () => {
    const comment = await create();
    expect(comment.body).toBe('');
    expect(comment.media).toMatchObject({
      kind: 'audio',
      mimeType: 'audio/webm',
      sizeBytes: 1000,
      durationMs: 4200,
      peaks: [0.1, 0.8, 0.4],
    });

    const list = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(list[0]?.media?.id).toBe(comment.media?.id);
  });

  it('streams the recording, with byte ranges', async () => {
    const { media } = await create();
    const full = await ctx.request(media!.url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/webm');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect((await full.arrayBuffer()).byteLength).toBe(1000);

    const part = await ctx.request(media!.url, { headers: { Range: 'bytes=0-3' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 0-3/1000');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

    const beyond = await ctx.request(media!.url, { headers: { Range: 'bytes=5000-' } });
    expect(beyond.status).toBe(416);
  });

  it('answers HEAD with the headers only, without opening the recording', async () => {
    const { media } = await create();
    const stream = vi.spyOn(ctx.deps.media, 'stream');
    const full = await ctx.request(media!.url, { method: 'HEAD' });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe('1000');
    expect(await full.text()).toBe('');
    const part = await ctx.request(media!.url, {
      method: 'HEAD',
      headers: { Range: 'bytes=0-3' },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 0-3/1000');
    expect(part.headers.get('content-length')).toBe('4');
    expect(stream).not.toHaveBeenCalled();
  });

  it('lets the browser keep a recording only briefly, revalidated after the access check', async () => {
    const { media } = await create();
    const full = await ctx.request(media!.url);
    expect(full.headers.get('cache-control')).toBe('private, max-age=300');
    const etag = full.headers.get('etag') ?? '';
    const cached = await ctx.request(media!.url, { headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304);

    const outsider = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    const refused = await ctx.request(media!.url, {
      cookie: outsider.cookie,
      headers: { 'If-None-Match': etag },
    });
    expect(refused.status).toBe(404);
  });

  it('reads only the requested bytes, never the whole recording into memory', async () => {
    const { media } = await create();
    const get = vi.spyOn(ctx.deps.media, 'get');
    const stream = vi.spyOn(ctx.deps.media, 'stream');
    const part = await ctx.request(media!.url, { headers: { Range: 'bytes=996-' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-length')).toBe('4');
    expect((await part.arrayBuffer()).byteLength).toBe(4);
    const full = await ctx.request(media!.url);
    expect((await full.arrayBuffer()).byteLength).toBe(1000);
    expect(get).not.toHaveBeenCalled();
    expect(stream.mock.calls.map(([, range]) => range)).toEqual([
      { start: 996, end: 999 },
      undefined,
    ]);
  });

  it('lets the author empty the note, the recording stays the content', async () => {
    const comment = await create(voiceComment({ body: 'Hör mal rein.' }));
    const res = await ctx.request(`/api/comments/${comment.id}`, {
      method: 'PATCH',
      json: { body: '  ' },
    });
    expect(res.status).toBe(200);
    const edited = commentSchema.parse(await res.json());
    expect(edited.body).toBe('');
    expect(edited.media?.id).toBe(comment.media?.id);
  });

  it('accepts replies with a recording', async () => {
    const root = await create();
    const res = await upload(
      voiceComment({
        parentId: root.id,
        anchor: { type: 'slide' },
        media: { kind: 'video', durationMs: 900 },
      }),
      webm(),
      'video/webm;codecs=vp9,opus',
    );
    expect(res.status).toBe(201);
    expect(commentSchema.parse(await res.json()).media?.kind).toBe('video');
  });

  it('rejects files that are not a recording', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
    const res = await upload(voiceComment(), html);
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: 'unsupported_media' } });

    // Ogg is fine for voice, but no browser records video into it.
    const ogg = new TextEncoder().encode('OggS-rest-of-the-file');
    const oggVideo = await upload(
      voiceComment({ media: { kind: 'video', durationMs: 900 } }),
      ogg,
      'video/ogg',
    );
    expect(oggVideo.status).toBe(415);
  });

  it('takes the type from the bytes, not from the upload', async () => {
    // Bun's multipart parser reports any `.webm` as `video/webm`, even a voice note.
    const res = await upload(voiceComment(), webm(), 'video/webm');
    expect(res.status).toBe(201);
    expect(commentSchema.parse(await res.json()).media?.mimeType).toBe('audio/webm');
  });

  it('rejects recordings over five minutes and over the size limit', async () => {
    const long = await upload(voiceComment({ media: { kind: 'audio', durationMs: 6 * 60_000 } }));
    expect(long.status).toBe(400);

    const big = await upload(voiceComment(), webm(3500));
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: { code: 'file_too_large' } });
  });

  it("enforces the workspace's storage, whoever records", async () => {
    await create(voiceComment(), webm(2500));
    const guest = await joinAsMember('Mara');
    const res = await upload(voiceComment(), webm(2000), 'audio/webm', guest);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'plan_limit' } });

    const usage = await (await ctx.request(`/api/decks/${deck.deckId}/media-usage`)).json();
    expect(usage).toEqual({ usedBytes: 2500, limitBytes: 4096 });
  });

  it('two uploads at once cannot share the last of the storage', async () => {
    const results = await Promise.all([
      upload(voiceComment(), webm(2500)),
      upload(voiceComment(), webm(2500)),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 403]);
    const usage = await (await ctx.request(`/api/decks/${deck.deckId}/media-usage`)).json();
    expect(usage).toEqual({ usedBytes: 2500, limitBytes: 4096 });
  });

  it('keeps recordings private to people with access to the deck', async () => {
    const { media } = await create();
    const outsider = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    const res = await ctx.request(media!.url, { cookie: outsider.cookie });
    expect(res.status).toBe(404);
  });

  it('checks deck access before reading the body', async () => {
    const outsider = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    // Far over the body limit: refused as "not found", never buffered and refused as too large.
    const res = await upload(voiceComment(), webm(12 * 1024 * 1024), 'audio/webm', outsider.cookie);
    expect(res.status).toBe(404);
    const missing = await ctx.request('/api/decks/gibt-es-nicht/media-comments', {
      method: 'POST',
      body: new FormData(),
    });
    expect(missing.status).toBe(404);
  });

  it('caps uploads per account and hour, failed ones included', async () => {
    for (let i = 0; i < MEDIA_UPLOADS_PER_HOUR.limited; i++) {
      const res = await upload(voiceComment(), new Uint8Array(100).fill(1));
      expect(res.status).toBe(415);
    }
    const refused = await upload(voiceComment());
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    ctx.clock.advance(60 * 60_000);
    expect((await upload(voiceComment())).status).toBe(201);
  });

  it('deletes the recordings with their thread', async () => {
    const root = await create();
    const reply = await create(voiceComment({ parentId: root.id, anchor: { type: 'slide' } }));
    const keys = [root, reply].map((c) => `decks/${deck.deckId}/media/${c.media!.id}.webm`);
    for (const key of keys) expect(await ctx.deps.media.get(key)).not.toBeNull();

    expect((await ctx.request(`/api/comments/${root.id}`, { method: 'DELETE' })).status).toBe(204);
    for (const key of keys) expect(await ctx.deps.media.get(key)).toBeNull();
    const usage = await (await ctx.request(`/api/decks/${deck.deckId}/media-usage`)).json();
    expect(usage).toMatchObject({ usedBytes: 0 });
  });

  it('deletes the recordings with the deck', async () => {
    const { media } = await create();
    const key = `decks/${deck.deckId}/media/${media!.id}.webm`;
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(204);
    expect(await ctx.deps.media.get(key)).toBeNull();
  });
});

describe('images', () => {
  /** A tiny "PNG": the signature followed by filler bytes. */
  const png = (size = 500) => {
    const bytes = new Uint8Array(size).fill(3);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return bytes;
  };

  function uploadImage(
    input: CreateMediaCommentInput,
    image: Uint8Array<ArrayBuffer> | Uint8Array<ArrayBuffer>[],
    recording?: Uint8Array<ArrayBuffer>,
  ) {
    const form = new FormData();
    form.append('comment', JSON.stringify(input));
    for (const bytes of [image].flat())
      form.append('image', new File([bytes], 'bild.png', { type: 'image/png' }));
    if (recording) form.append('file', new File([recording], 'memo.webm', { type: 'audio/webm' }));
    return ctx.request(`/api/decks/${deck.deckId}/media-comments`, { method: 'POST', body: form });
  }

  it('stores an image alone and streams it', async () => {
    const res = await uploadImage(voiceComment({ media: undefined }), png());
    expect(res.status).toBe(201);
    const comment = commentSchema.parse(await res.json());
    expect(comment.media).toBeNull();
    expect(comment.images).toMatchObject([{ mimeType: 'image/png', sizeBytes: 500 }]);

    const file = await ctx.request(comment.images![0]!.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
  });

  it('stores an image with the voice memo recorded while drawing', async () => {
    const res = await uploadImage(voiceComment(), png(), webm());
    expect(res.status).toBe(201);
    const comment = commentSchema.parse(await res.json());
    expect(comment.images?.[0]?.sizeBytes).toBe(500);
    expect(comment.media).toMatchObject({ kind: 'audio', sizeBytes: 1000 });

    const list = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(list[0]?.images?.[0]?.id).toBe(comment.images?.[0]?.id);
    expect(list[0]?.media?.id).toBe(comment.media?.id);

    // Both count towards the storage.
    const usage = await (await ctx.request(`/api/decks/${deck.deckId}/media-usage`)).json();
    expect(usage).toMatchObject({ usedBytes: 1500 });
  });

  it('lets the author empty the note of an image', async () => {
    const res = await uploadImage(voiceComment({ body: 'Siehe Skizze', media: undefined }), png());
    const comment = commentSchema.parse(await res.json());
    const edited = await ctx.request(`/api/comments/${comment.id}`, {
      method: 'PATCH',
      json: { body: '' },
    });
    expect(edited.status).toBe(200);
    expect(commentSchema.parse(await edited.json())).toMatchObject({ body: '', media: null });
  });

  it('stores several images in their order', async () => {
    const res = await uploadImage(voiceComment({ media: undefined }), [
      png(500),
      png(600),
      png(700),
    ]);
    expect(res.status).toBe(201);
    const comment = commentSchema.parse(await res.json());
    expect(comment.images?.map((image) => image.sizeBytes)).toEqual([500, 600, 700]);

    const list = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(list[0]?.images?.map((image) => image.id)).toEqual(
      comment.images?.map((image) => image.id),
    );
  });

  it('takes at most ten images', async () => {
    const res = await uploadImage(
      voiceComment({ media: undefined }),
      Array.from({ length: 11 }, () => png()),
    );
    expect(res.status).toBe(400);
  });

  it('rejects images that are not PNG, and memo details without a memo', async () => {
    expect((await uploadImage(voiceComment({ media: undefined }), webm(500))).status).toBe(415);
    expect((await uploadImage(voiceComment(), png())).status).toBe(400);
  });
});

describe('parseRange', () => {
  it('handles open, closed, suffix and invalid ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
  });
});

describe('sniffMediaContainer', () => {
  it('recognises WebM, MP4 and Ogg', () => {
    expect(sniffMediaContainer(webm(8))).toBe('webm');
    expect(sniffMediaContainer(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))).toBe(
      'mp4',
    );
    expect(sniffMediaContainer(new TextEncoder().encode('OggS....'))).toBe('ogg');
    expect(sniffMediaContainer(new TextEncoder().encode('<html>'))).toBeNull();
  });
});
