import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentTypeForKey, isValidKey } from '../src/storage/blob-storage';
import { configureFileUrls, fileUrl, fileUrlAt, verifyFileUrl } from '../src/storage/file-urls';
import { FsBlobStorage } from '../src/storage/fs-blob-storage';
import { workspaceMembers } from '../src/db/schema';
import { createReadyDeck, createTestContext, signedInUser, testConfig } from './helpers';

let root: string;
let storage: FsBlobStorage;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'slider-storage-test-'));
  storage = new FsBlobStorage(path.join(root, 'blobs'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('FsBlobStorage', () => {
  it('stores, reads and deletes blobs', async () => {
    await storage.put('decks/a/b.svg', new Uint8Array([1, 2]));
    expect(await storage.get('decks/a/b.svg')).toEqual(new Uint8Array([1, 2]));
    await storage.delete('decks/a/b.svg');
    expect(await storage.get('decks/a/b.svg')).toBeNull();
  });

  it('knows sizes and streams whole blobs or byte ranges', async () => {
    await storage.put('media/a.webm', new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(await storage.size('media/a.webm')).toBe(6);
    expect(await storage.size('media/none.webm')).toBeNull();
    expect(await storage.stream('media/none.webm')).toBeNull();
    const read = async (stream: ReadableStream<Uint8Array> | null) => [
      ...new Uint8Array(await new Response(stream).arrayBuffer()),
    ];
    expect(await read(await storage.stream('media/a.webm'))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await read(await storage.stream('media/a.webm', { start: 2, end: 4 }))).toEqual([
      2, 3, 4,
    ]);
  });

  it('deletes by prefix', async () => {
    await storage.put('decks/a/1.svg', new Uint8Array([1]));
    await storage.put('decks/a/x/2.svg', new Uint8Array([2]));
    await storage.put('decks/b/3.svg', new Uint8Array([3]));
    await storage.deletePrefix('decks/a/');
    expect(await storage.get('decks/a/1.svg')).toBeNull();
    expect(await storage.get('decks/a/x/2.svg')).toBeNull();
    expect(await storage.get('decks/b/3.svg')).not.toBeNull();
  });

  it('a rewrite and a delete of the same key run one after another', async () => {
    // Each delete starts while the rewrite has read the file and is about to write it back.
    for (const remove of [
      () => storage.delete('decks/a/1.svg'),
      () => storage.deletePrefix('decks/a/'),
    ]) {
      await storage.put('decks/a/1.svg', new Uint8Array([1]));
      let removing: Promise<void> | null = null;
      const rewritten = await storage.rewrite('decks/a/1.svg', (data) => {
        removing = remove();
        return new Uint8Array([...data, 2]);
      });
      expect(rewritten).toBe(true);
      await expect(removing).resolves.toBeUndefined();
      expect(await storage.get('decks/a/1.svg')).toBeNull();
      expect(await storage.list('decks/')).toEqual([]);
    }
  });

  it('a put during a rewrite is never overwritten by it', async () => {
    await storage.put('decks/a/1.svg', new Uint8Array([1]));
    let putting: Promise<void> | null = null;
    await storage.rewrite('decks/a/1.svg', () => {
      putting = storage.put('decks/a/1.svg', new Uint8Array([9]));
      return new Uint8Array([2]);
    });
    await putting;
    expect(await storage.get('decks/a/1.svg')).toEqual(new Uint8Array([9]));
  });

  it('lists the keys under a prefix, nested ones included', async () => {
    await storage.put('decks/a/1.svg', new Uint8Array([1]));
    await storage.put('decks/a/x/2.svg', new Uint8Array([2]));
    await storage.put('decks/ab/3.svg', new Uint8Array([3]));
    expect((await storage.list('decks/a/')).sort()).toEqual(['decks/a/1.svg', 'decks/a/x/2.svg']);
    expect(await storage.list('decks/none/')).toEqual([]);
    expect(await storage.list('decks/a/1.svg/')).toEqual([]);
  });

  it.each([
    '../secret',
    'decks/../../etc/passwd',
    '/etc/passwd',
    'a//b',
    '.hidden',
    'a/./b',
    'a\\b',
    '',
  ])('rejects the unsafe key %j', async (key) => {
    expect(isValidKey(key)).toBe(false);
    await expect(storage.put(key, new Uint8Array([1]))).rejects.toThrow();
    await expect(storage.get(key)).rejects.toThrow();
  });

  it('derives content types from the key', () => {
    expect(contentTypeForKey('a/b.svg')).toBe('image/svg+xml');
    expect(contentTypeForKey('a/b.PNG')).toBe('image/png');
    expect(contentTypeForKey('a/b')).toBe('application/octet-stream');
  });
});

describe('GET /files/*', () => {
  it('does not serve paths outside the storage root', async () => {
    const ctx = await createTestContext();
    try {
      expect((await ctx.request('/files/..%2F..%2Fpackage.json')).status).toBe(404);
      expect((await ctx.request('/files/decks/../../package.json')).status).toBe(404);
    } finally {
      await ctx.cleanup();
    }
  });

  it('serves a file only through a valid, unexpired signed link', async () => {
    const ctx = await createTestContext();
    try {
      const key = 'workspaces/w/logo-a.svg';
      await ctx.deps.storage.put(key, new TextEncoder().encode('<svg/>'));
      const url = fileUrl(key);
      const ok = await ctx.request(url);
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/);

      expect((await ctx.request(`/files/${key}`)).status).toBe(403);
      expect((await ctx.request(url.replace(/sig=./, 'sig=x'))).status).toBe(403);
      // A link signed for one file opens no other.
      expect((await ctx.request(url.replace('a.svg', 'b.svg'))).status).toBe(403);
    } finally {
      await ctx.cleanup();
    }
  });

  it('serves a deck’s files only to signed-in accounts that may see the deck', async () => {
    const ctx = await createTestContext({
      config: { auth: { ...testConfig().auth, devLogin: false } },
    });
    try {
      const { imageKeys } = await createReadyDeck(ctx);
      const url = fileUrl(imageKeys[0]!);
      // A passed-on link alone opens nothing.
      expect((await ctx.request(url)).status).toBe(401);
      const stranger = await signedInUser(ctx, { name: 'Eve', email: 'eve@example.com' });
      expect((await ctx.request(url, { cookie: stranger.cookie })).status).toBe(404);

      const mia = await signedInUser(ctx, { name: 'Mia', email: 'mia@example.org' });
      await ctx.deps.db
        .insert(workspaceMembers)
        .values({ workspaceId: ctx.workspaceId, userId: mia.user.id, role: 'viewer' });
      const ok = await ctx.request(url, { cookie: mia.cookie });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toMatch(/^private, max-age=\d+$/);
      const etag = ok.headers.get('etag')!;
      const again = await ctx.request(url, {
        cookie: mia.cookie,
        headers: { 'If-None-Match': etag },
      });
      expect(again.status).toBe(304);
      // The signature still counts.
      expect(
        (await ctx.request(url.replace(/sig=./, 'sig=x'), { cookie: mia.cookie })).status,
      ).toBe(403);
    } finally {
      await ctx.cleanup();
    }
  });

  it('streams the file with its length instead of reading it into memory', async () => {
    const ctx = await createTestContext();
    try {
      const key = (await createReadyDeck(ctx)).imageKeys[0]!.replace(/[^/]+$/, 'big.svg');
      const body = `<svg>${'x'.repeat(200_000)}</svg>`;
      await ctx.deps.storage.put(key, new TextEncoder().encode(body));
      const get = vi.spyOn(ctx.deps.storage, 'get');
      const res = await ctx.request(fileUrl(key));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-length')).toBe(String(body.length));
      expect(await res.text()).toBe(body);
      expect(get).not.toHaveBeenCalled();
      expect((await ctx.request(fileUrl(key.replace('big.svg', 'gone.svg')))).status).toBe(404);
    } finally {
      await ctx.cleanup();
    }
  });

  it('answers HEAD with the headers only, without opening the file', async () => {
    const ctx = await createTestContext();
    try {
      const key = (await createReadyDeck(ctx)).imageKeys[0]!;
      const size = await ctx.deps.storage.size(key);
      const stream = vi.spyOn(ctx.deps.storage, 'stream');
      const res = await ctx.request(fileUrl(key), { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-length')).toBe(String(size));
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      expect(await res.text()).toBe('');
      expect(stream).not.toHaveBeenCalled();
      const gone = fileUrl(key.replace(/[^/]+$/, 'gone.svg'));
      expect((await ctx.request(gone, { method: 'HEAD' })).status).toBe(404);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('signed file links', () => {
  const params = (url: string) => new URL(url, 'http://x').searchParams;

  it('keeps the same link within a window and lets it expire', () => {
    configureFileUrls('test-secret');
    const now = 1_800_000_000;
    const url = fileUrlAt('a/b.svg', now);
    expect(fileUrlAt('a/b.svg', now + 60)).toBe(url);

    const exp = params(url).get('exp') ?? '';
    const sig = params(url).get('sig') ?? '';
    const validFor = verifyFileUrl('a/b.svg', exp, sig, now) ?? 0;
    expect(validFor).toBeGreaterThanOrEqual(6 * 3600);
    expect(validFor).toBeLessThanOrEqual(12 * 3600);
    expect(verifyFileUrl('a/b.svg', exp, sig, Number(exp))).toBeNull();
  });

  it('rejects links signed with another secret', () => {
    configureFileUrls('one');
    const url = fileUrlAt('a/b.svg', 1_800_000_000);
    configureFileUrls('two');
    const p = params(url);
    expect(
      verifyFileUrl('a/b.svg', p.get('exp') ?? '', p.get('sig') ?? '', 1_800_000_000),
    ).toBeNull();
  });
});
