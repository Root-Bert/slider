import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentSchema, type Comment, type CreateMediaCommentInput } from '@slider/shared';
import { workspaceMembers } from '../src/db/schema';
import { parseRange } from '../src/http/range';
import { sniffMediaContainer } from '../src/services/media';
import {
  cookieFrom,
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
    config: { media: { dir: '/unused', quotaBytes: 4096, maxBytes: 3000 } },
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

/** Another member of the organisation – guests only look (BER-130). */
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
      transcript: null,
      transcriptStatus: 'pending',
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

  it('enforces the storage quota of the deck owner, other members included', async () => {
    await create(voiceComment(), webm(2500));
    const guest = await joinAsMember('Mara');
    const res = await upload(voiceComment(), webm(2000), 'audio/webm', guest);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'quota_exceeded' } });

    const usage = await (await ctx.request(`/api/decks/${deck.deckId}/media-usage`)).json();
    expect(usage).toEqual({ usedBytes: 2500, limitBytes: 4096 });
  });

  it('lets only the recording person set the transcript', async () => {
    const guest = await joinAsMember('Mara');
    const res = await upload(voiceComment(), webm(), 'audio/webm', guest);
    const { media } = commentSchema.parse(await res.json());

    const byOwner = await ctx.request(`${media!.url}/transcript`, {
      method: 'PUT',
      json: { status: 'done', transcript: 'Hallo' },
    });
    expect(byOwner.status).toBe(403);

    const byGuest = await ctx.request(`${media!.url}/transcript`, {
      method: 'PUT',
      json: { status: 'done', transcript: '  Bitte das Logo größer.  ' },
      cookie: guest,
    });
    expect(byGuest.status).toBe(200);
    expect(commentSchema.parse(await byGuest.json()).media).toMatchObject({
      transcript: 'Bitte das Logo größer.',
      transcriptStatus: 'done',
    });
  });

  it('keeps recordings private to people with access to the deck', async () => {
    const { media } = await create();
    const other = await createReadyDeck(ctx, { slideCount: 1 });
    const link = (await (
      await ctx.request(`/api/decks/${other.deckId}/review-links`, { method: 'POST', json: {} })
    ).json()) as { token: string };
    const join = await ctx.request(`/api/invites/${link.token}/join`, {
      method: 'POST',
      json: { name: 'Fremd' },
    });
    const res = await ctx.request(media!.url, { cookie: cookieFrom(join) });
    expect(res.status).toBe(403);
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
