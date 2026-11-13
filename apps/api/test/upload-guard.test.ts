import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceMembers } from '../src/db/schema';
import { DECK_UPLOADS_IN_FLIGHT, DECK_UPLOADS_IN_FLIGHT_TOTAL } from '../src/http/import-limit';
import { deckTusRoutes, TUS_UPLOAD_EXPIRY_MS } from '../src/routes/deck-tus';
import { REMOTE_IMPORTS_IN_FLIGHT, REMOTE_IMPORTS_IN_FLIGHT_TOTAL } from '../src/routes/decks';
import { MEDIA_UPLOADS_IN_FLIGHT_TOTAL } from '../src/routes/media';
import type { RemoteFile } from '../src/sources/source-adapter';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type TestContext,
} from './helpers';
import { FakeSource } from './sync-helpers';

/** Deck uploads and new versions are checked and capped before their body is read. */
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext({ config: { maxUploadBytes: 100 } });
});
afterEach(() => ctx.cleanup());

/** Far over the body limit: a check that ran after buffering would answer 413. */
const hugeForm = () => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(10_000)], 'Gross.pptx'));
  return form;
};

/**
 * A multipart upload whose body never finishes until `release()` – the request stays in flight.
 * `reading` resolves once the server starts reading the body.
 */
function hangingUpload(path: string, cookie?: string) {
  let release = () => {};
  let started = () => {};
  const reading = new Promise<void>((resolve) => (started = resolve));
  const done = new Promise<void>((resolve) => (release = resolve));
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        started();
        await done;
        controller.error(new Error('aborted by the test'));
      },
    },
    { highWaterMark: 0 },
  );
  const response = ctx.request(path, {
    method: 'POST',
    body,
    cookie,
    headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
    // Needed for streamed request bodies.
    duplex: 'half',
  });
  return { reading, response, release };
}

/** Members of the workspace, each with a cookie of their own. */
const people = (prefix: string, count: number, role: 'member' | 'reviewer') =>
  Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const person = await signedInUser(ctx, {
        name: `${prefix}${i}`,
        email: `${prefix.toLowerCase()}${i}@example.com`,
      });
      await ctx.deps.db
        .insert(workspaceMembers)
        .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
      return person;
    }),
  );

describe('uploads before the body is read', () => {
  it('refuses accounts without the right to upload before buffering anything', async () => {
    const fresh = await signedInUser(ctx, { name: 'Neu', email: 'neu@example.com' });
    const noWorkspace = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: hugeForm(),
      cookie: fresh.cookie,
    });
    expect(noWorkspace.status).toBe(400);

    const [reviewer] = await people('Rita', 1, 'reviewer');
    const asReviewer = await ctx.request(`/api/decks/upload?workspaceId=${ctx.workspaceId}`, {
      method: 'POST',
      body: hugeForm(),
      cookie: reviewer?.cookie,
    });
    expect(asReviewer.status).toBe(403);

    const { deckId } = await createReadyDeck(ctx);
    const outsider = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    const version = await ctx.request(`/api/decks/${deckId}/revisions`, {
      method: 'POST',
      body: hugeForm(),
      cookie: outsider.cookie,
    });
    expect(version.status).toBe(404);
  });

  it('caps deck files in flight per account and across accounts, and recordings across accounts', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const own = Array.from({ length: DECK_UPLOADS_IN_FLIGHT }, () =>
      hangingUpload('/api/decks/upload'),
    );
    await Promise.all(own.map((upload) => upload.reading));

    const refused = await ctx.request('/api/decks/upload', { method: 'POST', body: hugeForm() });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('5');
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    // Uploads and new versions share the slots.
    const version = await ctx.request(`/api/decks/${deckId}/revisions`, {
      method: 'POST',
      body: hugeForm(),
    });
    expect(version.status).toBe(429);

    for (const upload of own) upload.release();
    await Promise.all(own.map((upload) => upload.response));
    // The slots are free again: the next upload gets as far as the body limit.
    const next = await ctx.request('/api/decks/upload', { method: 'POST', body: hugeForm() });
    expect(next.status).toBe(413);

    // The dev owner has nothing in flight, but the server as a whole is full.
    const uploaders = await people('P', DECK_UPLOADS_IN_FLIGHT_TOTAL, 'member');
    const all = uploaders.map((person) => hangingUpload('/api/decks/upload', person.cookie));
    await Promise.all(all.map((upload) => upload.reading));
    expect(
      (await ctx.request('/api/decks/upload', { method: 'POST', body: hugeForm() })).status,
    ).toBe(429);
    for (const upload of all) upload.release();
    await Promise.all(all.map((upload) => upload.response));

    const path = `/api/decks/${deckId}/media-comments`;
    const recorders = await people('R', MEDIA_UPLOADS_IN_FLIGHT_TOTAL, 'reviewer');
    const recordings = recorders.map((person) => hangingUpload(path, person.cookie));
    await Promise.all(recordings.map((upload) => upload.reading));
    const full = await ctx.request(path, { method: 'POST', body: hugeForm() });
    expect(full.status).toBe(429);
    expect(full.headers.get('retry-after')).toBe('5');
    for (const upload of recordings) upload.release();
    await Promise.all(recordings.map((upload) => upload.response));
  });
  it('takes a deck file in tus parts: bound to its uploader, offsets checked, the same deck as one request', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'slider-tus-'));
    await ctx.cleanup();
    ctx = await createTestContext({ config: { maxUploadBytes: 100, dataDir } });
    const tus = (url: string, init: RequestInit & { cookie?: string } = {}) =>
      ctx.request(url, {
        ...init,
        headers: { 'Tus-Resumable': '1.0.0', ...(init.headers as Record<string, string>) },
      });
    const b64 = (text: string) => Buffer.from(text).toString('base64');
    const create = (size: number, name = 'Groß.pptx') =>
      tus('/api/decks/tus', {
        method: 'POST',
        headers: {
          'Upload-Length': String(size),
          'Upload-Metadata': `filename ${b64(name)},workspaceId ${b64(ctx.workspaceId)}`,
        },
      });
    const part = (url: string, offset: number, bytes: Uint8Array, cookie?: string) =>
      tus(url, {
        method: 'PATCH',
        cookie,
        body: bytes,
        headers: {
          'Content-Type': 'application/offset+octet-stream',
          'Upload-Offset': String(offset),
        },
      });

    // Too big is refused before anything is stored.
    expect((await create(101)).status).toBe(413);
    expect((await ctx.request('/api/decks/tus', { method: 'POST' })).status).toBe(412);

    const file = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4, 5, 6]);
    const created = await create(file.length);
    expect(created.status).toBe(201);
    const url = created.headers.get('location') ?? '';
    expect(url).toMatch(/^\/api\/decks\/tus\/[0-9a-f-]{36}$/);

    // Someone else neither sees nor fills it.
    const other = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    expect((await tus(url, { method: 'HEAD', cookie: other.cookie })).status).toBe(404);
    expect((await part(url, 0, file.subarray(0, 4), other.cookie)).status).toBe(404);

    const first = await part(url, 0, file.subarray(0, 6));
    expect(first.status).toBe(204);
    expect(first.headers.get('upload-offset')).toBe('6');
    // A part at the wrong offset (a lost answer, a gap) is refused; HEAD says where it stands.
    expect((await part(url, 4, file.subarray(4))).status).toBe(409);
    expect((await part(url, 8, file.subarray(8))).status).toBe(409);
    expect((await tus(`${url}/finish`, { method: 'POST' })).status).toBe(409);
    // The upload outlives a restart: a new app finds it on disk.
    const restarted = deckTusRoutes(ctx.deps);
    const head = await restarted.request(url.replace('/api', ''), {
      method: 'HEAD',
      headers: { 'Tus-Resumable': '1.0.0' },
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('upload-offset')).toBe('6');
    expect(head.headers.get('upload-length')).toBe('10');

    expect((await part(url, 6, file.subarray(6))).headers.get('upload-offset')).toBe('10');
    const finished = await tus(`${url}/finish`, { method: 'POST' });
    expect(finished.status).toBe(201);
    const deck = (await finished.json()) as { id: string; title: string };
    // Done: file and upload are gone.
    expect((await tus(url, { method: 'HEAD' })).status).toBe(404);
    expect(await readdir(path.join(dataDir, 'tmp', 'uploads'))).toEqual([]);
    // The same file in one request finds that deck: both ran the same pipeline.
    const form = new FormData();
    form.append('file', new File([file], 'Groß.pptx'));
    const single = await ctx.request('/api/decks/upload', { method: 'POST', body: form });
    expect(single.status).toBe(200);
    expect(((await single.json()) as { id: string }).id).toBe(deck.id);
    // A finish asked again (its answer lost on the way) gets the same answer – only its uploader.
    const retried = await tus(`${url}/finish`, { method: 'POST' });
    expect(retried.status).toBe(201);
    expect(((await retried.json()) as { id: string }).id).toBe(deck.id);
    expect((await tus(`${url}/finish`, { method: 'POST', cookie: other.cookie })).status).toBe(404);

    // A full plan keeps the file: once there is room, the finish goes through without a resend.
    const second = file.map((byte, i) => (i < 4 ? byte : byte + 10));
    const roomy = (await create(second.length)).headers.get('location') ?? '';
    await part(roomy, 0, second);
    const plans = ctx.deps.config.plans;
    ctx.deps.config.plans = { ...plans, free: { ...plans.free, maxDecks: 1 } };
    expect((await tus(`${roomy}/finish`, { method: 'POST' })).status).toBe(403);
    expect((await tus(roomy, { method: 'HEAD' })).headers.get('upload-offset')).toBe('10');
    ctx.deps.config.plans = plans;
    expect((await tus(`${roomy}/finish`, { method: 'POST' })).status).toBe(201);
    // A file Slider cannot open is gone at once: sending it again would not help.
    const unreadable = (await create(file.length, 'Notiz.xyz')).headers.get('location') ?? '';
    await part(unreadable, 0, new Uint8Array(file.length));
    expect((await tus(`${unreadable}/finish`, { method: 'POST' })).status).toBe(400);
    expect((await tus(unreadable, { method: 'HEAD' })).status).toBe(404);
    expect(await readdir(path.join(dataDir, 'tmp', 'uploads'))).toEqual([]);

    // Untouched for a day: dropped with its file when the next upload begins.
    const stale = (await create(file.length)).headers.get('location') ?? '';
    ctx.clock.advance(TUS_UPLOAD_EXPIRY_MS + 1);
    expect((await create(file.length)).status).toBe(201);
    expect((await tus(stale, { method: 'HEAD' })).status).toBe(404);
    expect(await readdir(path.join(dataDir, 'tmp', 'uploads'))).toHaveLength(2);

    // A recording goes the same way, checked against the recording limit, and is named by its
    // upload in the comment's own request.
    const { deckId, slideIds } = await createReadyDeck(ctx);
    const recording = (size: number) =>
      tus('/api/decks/tus', {
        method: 'POST',
        headers: {
          'Upload-Length': String(size),
          'Upload-Metadata': `filename ${b64('aufnahme.mp4')},purpose ${b64('recording')},deckId ${b64(deckId)}`,
        },
      });
    expect((await recording(ctx.deps.config.media.maxBytes + 1)).status).toBe(413);
    const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const sound = (await recording(mp4.length)).headers.get('location') ?? '';
    expect((await part(sound, 0, mp4)).status).toBe(204);
    // Not a deck: it is not finished on its own.
    expect((await tus(`${sound}/finish`, { method: 'POST' })).status).toBe(400);
    const commentForm = new FormData();
    commentForm.append(
      'comment',
      JSON.stringify({
        ...pinComment(slideIds[0] ?? ''),
        body: '',
        media: { kind: 'video', durationMs: 4000 },
      }),
    );
    commentForm.append('upload', sound.split('/').pop() ?? '');
    const comment = await ctx.request(`/api/decks/${deckId}/media-comments`, {
      method: 'POST',
      body: commentForm,
    });
    expect(comment.status).toBe(201);
    expect(await comment.json()).toMatchObject({ media: { kind: 'video' } });
    expect((await tus(sound, { method: 'HEAD' })).status).toBe(404);
    await rm(dataDir, { recursive: true, force: true });
  });
});

describe('link and picker imports in flight', () => {
  it('caps link imports per account, apart from uploads, and across accounts', async () => {
    await ctx.cleanup();
    const source = new FakeSource();
    ctx = await createTestContext({
      config: { maxUploadBytes: 100 },
      sources: { url: source },
    });
    let release = () => {};
    let calls = 0;
    /** Every resolve hangs until `release()`. */
    const hang = () => {
      calls = 0;
      const done = new Promise<void>((resolve) => (release = resolve));
      source.resolve.mockImplementation(async (): Promise<RemoteFile> => {
        calls += 1;
        await done;
        throw new Error('aborted by the test');
      });
    };
    const startedCalls = (count: number) => vi.waitFor(() => expect(calls).toBe(count));
    const importLink = (cookie?: string) =>
      ctx.request('/api/decks/link', {
        method: 'POST',
        cookie,
        json: { url: 'https://example.com/files/deck.pptx' },
      });

    hang();
    const running = Array.from({ length: REMOTE_IMPORTS_IN_FLIGHT }, () => importLink());
    await startedCalls(REMOTE_IMPORTS_IN_FLIGHT);
    const refused = await importLink();
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('5');
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    // Plain uploads have their own slots.
    const upload = await ctx.request('/api/decks/upload', { method: 'POST', body: hugeForm() });
    expect(upload.status).toBe(413);
    release();
    for (const res of await Promise.all(running)) expect(res.status).toBe(500);
    // The slots are free again, failed imports included.
    source.resolve.mockImplementation(async () => {
      throw new Error('resolved');
    });
    expect((await importLink()).status).toBe(500);

    hang();
    const importers = await people('L', REMOTE_IMPORTS_IN_FLIGHT_TOTAL, 'member');
    const all = importers.map((person) => importLink(person.cookie));
    await startedCalls(REMOTE_IMPORTS_IN_FLIGHT_TOTAL);
    // The dev owner has nothing in flight, but the server as a whole is full.
    expect((await importLink()).status).toBe(429);
    release();
    await Promise.all(all);
  });
});
