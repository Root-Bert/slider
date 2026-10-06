import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentTypeForKey, isValidKey } from '../src/storage/blob-storage';
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

  it('deletes by prefix', async () => {
    await storage.put('decks/a/1.svg', new Uint8Array([1]));
    await storage.put('decks/a/x/2.svg', new Uint8Array([2]));
    await storage.put('decks/b/3.svg', new Uint8Array([3]));
    await storage.deletePrefix('decks/a/');
    expect(await storage.get('decks/a/1.svg')).toBeNull();
    expect(await storage.get('decks/a/x/2.svg')).toBeNull();
    expect(await storage.get('decks/b/3.svg')).not.toBeNull();
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
});
