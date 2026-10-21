import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceMembers } from '../src/db/schema';
import { DECK_UPLOADS_IN_FLIGHT, DECK_UPLOADS_IN_FLIGHT_TOTAL } from '../src/http/import-limit';
import { REMOTE_IMPORTS_IN_FLIGHT, REMOTE_IMPORTS_IN_FLIGHT_TOTAL } from '../src/routes/decks';
import { MEDIA_UPLOADS_IN_FLIGHT_TOTAL } from '../src/routes/media';
import type { RemoteFile } from '../src/sources/source-adapter';
import { createReadyDeck, createTestContext, signedInUser, type TestContext } from './helpers';
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

describe('deck uploads before the body is read', () => {
  it('refuses an account without a workspace before buffering anything', async () => {
    const fresh = await signedInUser(ctx, { name: 'Neu', email: 'neu@example.com' });
    const res = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: hugeForm(),
      cookie: fresh.cookie,
    });
    expect(res.status).toBe(400);
  });

  it('refuses a reviewer of the named workspace before buffering anything', async () => {
    const reviewer = await signedInUser(ctx, { name: 'Rita', email: 'rita@example.com' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: reviewer.user.id, role: 'reviewer' });
    const res = await ctx.request(`/api/decks/upload?workspaceId=${ctx.workspaceId}`, {
      method: 'POST',
      body: hugeForm(),
      cookie: reviewer.cookie,
    });
    expect(res.status).toBe(403);
  });

  it('refuses a new version from someone who does not own the deck before buffering', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const outsider = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    const res = await ctx.request(`/api/decks/${deckId}/revisions`, {
      method: 'POST',
      body: hugeForm(),
      cookie: outsider.cookie,
    });
    expect(res.status).toBe(404);
  });

  it('lets one account send only a few deck files at once, uploads and versions together', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const running = Array.from({ length: DECK_UPLOADS_IN_FLIGHT }, () =>
      hangingUpload('/api/decks/upload'),
    );
    await Promise.all(running.map((upload) => upload.reading));

    const refused = await ctx.request('/api/decks/upload', { method: 'POST', body: hugeForm() });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('5');
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
    const version = await ctx.request(`/api/decks/${deckId}/revisions`, {
      method: 'POST',
      body: hugeForm(),
    });
    expect(version.status).toBe(429);

    for (const upload of running) upload.release();
    await Promise.all(running.map((upload) => upload.response));
    // The slots are free again: the next upload gets as far as the body limit.
    const next = await ctx.request('/api/decks/upload', { method: 'POST', body: hugeForm() });
    expect(next.status).toBe(413);
  });

  it('caps deck files in flight across all accounts', async () => {
    const people = await Promise.all(
      Array.from({ length: DECK_UPLOADS_IN_FLIGHT_TOTAL }, async (_, i) => {
        const person = await signedInUser(ctx, { name: `P${i}`, email: `p${i}@example.com` });
        await ctx.deps.db
          .insert(workspaceMembers)
          .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role: 'member' });
        return person;
      }),
    );
    const running = people.map((person) => hangingUpload('/api/decks/upload', person.cookie));
    await Promise.all(running.map((upload) => upload.reading));

    // The dev owner has nothing in flight, but the server as a whole is full.
    const refused = await ctx.request('/api/decks/upload', { method: 'POST', body: hugeForm() });
    expect(refused.status).toBe(429);

    for (const upload of running) upload.release();
    await Promise.all(running.map((upload) => upload.response));
  });
});

describe('recording uploads before the body is read', () => {
  it('caps recordings in flight across all accounts', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const path = `/api/decks/${deckId}/media-comments`;
    const people = await Promise.all(
      Array.from({ length: MEDIA_UPLOADS_IN_FLIGHT_TOTAL }, async (_, i) => {
        const person = await signedInUser(ctx, { name: `R${i}`, email: `r${i}@example.com` });
        await ctx.deps.db
          .insert(workspaceMembers)
          .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role: 'reviewer' });
        return person;
      }),
    );
    const running = people.map((person) => hangingUpload(path, person.cookie));
    await Promise.all(running.map((upload) => upload.reading));

    // The dev owner has nothing in flight, but the server as a whole is full.
    const refused = await ctx.request(path, { method: 'POST', body: hugeForm() });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('5');

    for (const upload of running) upload.release();
    await Promise.all(running.map((upload) => upload.response));
  });
});

describe('link and picker imports in flight', () => {
  let source: FakeSource;
  /** Every resolve hangs until `release()`; `startedCalls(n)` waits until n of them run. */
  let release = () => {};
  let calls = 0;
  const startedCalls = (count: number) => vi.waitFor(() => expect(calls).toBe(count));

  beforeEach(async () => {
    await ctx.cleanup();
    source = new FakeSource();
    ctx = await createTestContext({
      config: { maxUploadBytes: 100 },
      sources: { onedrive: source },
    });
    calls = 0;
    const done = new Promise<void>((resolve) => (release = resolve));
    source.resolve.mockImplementation(async (): Promise<RemoteFile> => {
      calls += 1;
      await done;
      throw new Error('aborted by the test');
    });
  });

  const importLink = (cookie?: string) =>
    ctx.request('/api/decks/link', {
      method: 'POST',
      cookie,
      json: { url: 'https://1drv.ms/p/c/abc123/EXAMPLE' },
    });

  it('lets one account load only a few files at once, apart from uploads', async () => {
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
  });

  it('caps link imports in flight across all accounts', async () => {
    const people = await Promise.all(
      Array.from({ length: REMOTE_IMPORTS_IN_FLIGHT_TOTAL }, async (_, i) => {
        const person = await signedInUser(ctx, { name: `L${i}`, email: `l${i}@example.com` });
        await ctx.deps.db
          .insert(workspaceMembers)
          .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role: 'member' });
        return person;
      }),
    );
    const running = people.map((person) => importLink(person.cookie));
    await startedCalls(REMOTE_IMPORTS_IN_FLIGHT_TOTAL);

    // The dev owner has nothing in flight, but the server as a whole is full.
    expect((await importLink()).status).toBe(429);

    release();
    await Promise.all(running);
  });
});
