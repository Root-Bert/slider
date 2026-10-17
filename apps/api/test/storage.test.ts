import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentTypeForKey, isValidKey } from '../src/storage/blob-storage';
import { configureFileUrls, fileUrl, fileUrlAt, verifyFileUrl } from '../src/storage/file-urls';
import { FsBlobStorage } from '../src/storage/fs-blob-storage';
import { createTestContext } from './helpers';

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
      const key = 'decks/x/slides/a.svg';
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

  it('streams the file with its length instead of reading it into memory', async () => {
    const ctx = await createTestContext();
    try {
      const key = 'decks/x/slides/big.svg';
      const body = `<svg>${'x'.repeat(200_000)}</svg>`;
      await ctx.deps.storage.put(key, new TextEncoder().encode(body));
      const get = vi.spyOn(ctx.deps.storage, 'get');
      const res = await ctx.request(fileUrl(key));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-length')).toBe(String(body.length));
      expect(await res.text()).toBe(body);
      expect(get).not.toHaveBeenCalled();
      expect((await ctx.request(fileUrl('decks/x/slides/gone.svg'))).status).toBe(404);
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
