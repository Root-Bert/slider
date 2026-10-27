import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { expect, it, vi } from 'vitest';
import { workspaceMembers, workspaces } from '../src/db/schema';
import { FontFileError, readFontFace } from '../src/services/font-file';
import { uploadWorkspaceFonts } from '../src/services/workspace-fonts';
import { blobKeys, fileUrl } from '../src/storage/blob-storage';
import { createTestContext, signedInUser } from './helpers';

const lato = () =>
  new Uint8Array(readFileSync(new URL('../../../fonts/google/Lato-Regular.ttf', import.meta.url)));

/** Valid SFNT metadata with repeated references to one name string. */
function namedFont(records: number, length: number) {
  const nameAt = 160;
  const stringAt = nameAt + 6 + records * 12;
  const bytes = new Uint8Array(stringAt + length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x10000);
  view.setUint16(4, 3);
  const table = (i: number, tag: string, at: number, length: number) => {
    bytes.set(new TextEncoder().encode(tag), 12 + i * 16);
    view.setUint32(12 + i * 16 + 8, at);
    view.setUint32(12 + i * 16 + 12, length);
  };
  table(0, 'head', 64, 54);
  view.setUint16(82, 1000);
  table(1, 'hhea', 120, 36);
  view.setInt16(124, 800);
  table(2, 'name', nameAt, bytes.length - nameAt);
  view.setUint16(nameAt + 2, records);
  view.setUint16(nameAt + 4, stringAt - nameAt);
  for (let i = 0; i < records; i++) {
    const at = nameAt + 6 + i * 12;
    view.setUint16(at, 3);
    view.setUint16(at + 2, 1);
    view.setUint16(at + 4, 0x409);
    view.setUint16(at + 6, 1);
    view.setUint16(at + 8, length);
  }
  for (let i = stringAt; i < bytes.length; i += 2) view.setUint16(i, 65);
  return { bytes, view, nameAt, stringAt };
}

it('reads real fonts and imports a normal ZIP of fonts', async () => {
  expect(readFontFace(lato())).toMatchObject({ family: 'Lato', weight: 400, italic: false });
  const ctx = await createTestContext();
  try {
    for (const compression of ['STORE', 'DEFLATE'] as const) {
      const zip = new JSZip();
      zip.file('fonts/Lato.ttf', lato());
      zip.file('fonts/empty.ttf', new Uint8Array());
      const result = await uploadWorkspaceFonts(ctx.deps, ctx.ownerId, ctx.workspaceId, [
        { name: 'fonts.zip', bytes: await zip.generateAsync({ type: 'uint8array', compression }) },
      ]);
      expect(result.skipped).toEqual([{ name: 'empty.ttf', reason: expect.any(String) }]);
      expect(result.fonts).toHaveLength(1);
      expect(result.fonts[0]?.family).toBe('Lato');
    }
  } finally {
    await ctx.cleanup();
  }
});

it('stops a ZIP with forged lengths before its full contents reach the reader', async () => {
  const ctx = await createTestContext();
  const zip = new JSZip();
  const actual = 2 * 1024 ** 2;
  zip.file('bomb.ttf', new Uint8Array(actual));
  const compressed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
  for (let i = 0; i + 46 < compressed.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 16, true);
  }
  try {
    const result = await uploadWorkspaceFonts(ctx.deps, ctx.ownerId, ctx.workspaceId, [
      { name: 'fonts.zip', bytes: compressed },
    ]);
    expect(result.fonts).toEqual([]);
    expect(result.skipped).toEqual([
      { name: 'bomb.ttf', reason: expect.stringContaining('beschädigt') },
    ]);
  } finally {
    await ctx.cleanup();
  }
});

it('rejects excessive font name counts, lengths, and references outside their table', () => {
  expect(() => readFontFace(namedFont(1025, 2).bytes)).toThrow(FontFileError);
  expect(() => readFontFace(namedFont(256, 4096).bytes)).toThrow(FontFileError);
  const font = namedFont(1, 16);
  // Trailing bytes are not part of the name table, even though they are in the file.
  font.view.setUint32(12 + 2 * 16 + 12, font.stringAt - font.nameAt);
  expect(() => readFontFace(font.bytes)).toThrow(FontFileError);
});

it('reads a repeated usable font name once and caps work on empty names', () => {
  const font = namedFont(256, 128);
  const characters = vi.spyOn(String, 'fromCharCode');
  try {
    expect(readFontFace(font.bytes).family).toBe('A'.repeat(64));
    expect(characters.mock.calls.length).toBeLessThan(1024);
  } finally {
    characters.mockRestore();
  }
  const blank = namedFont(32, 1024);
  for (let i = blank.stringAt; i < blank.bytes.length; i += 2) blank.view.setUint16(i, 32);
  expect(() => readFontFace(blank.bytes)).toThrow(/Namenstabelle.*zu groß/);
});

it('checks font membership on GET and HEAD, revokes links, and keeps logos public', async () => {
  const ctx = await createTestContext();
  try {
    const member = await signedInUser(ctx, { name: 'Mia', email: 'mia@example.com' });
    const outsider = await signedInUser(ctx, { name: 'Eve', email: 'eve@example.com' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: member.user.id, role: 'viewer' });
    const key = blobKeys.workspaceFont(ctx.workspaceId, crypto.randomUUID(), 'ttf');
    await ctx.deps.storage.put(key, new Uint8Array([1, 2, 3]));
    const url = fileUrl(key);
    ctx.deps.config.auth.devLogin = false;
    for (const method of ['GET', 'HEAD']) {
      expect((await ctx.request(url, { method })).status).toBe(401);
      expect((await ctx.request(url, { method, cookie: outsider.cookie })).status).toBe(404);
      const allowed = await ctx.request(url, { method, cookie: member.cookie });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('Cache-Control')).toBe('private, no-store');
    }
    await ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: new Date() })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect((await ctx.request(url, { cookie: member.cookie })).status).toBe(403);
    await ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: null })
      .where(eq(workspaces.id, ctx.workspaceId));
    await ctx.deps.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, ctx.workspaceId),
          eq(workspaceMembers.userId, member.user.id),
        ),
      );
    expect((await ctx.request(url, { cookie: member.cookie })).status).toBe(404);
    const logo = `workspaces/${ctx.workspaceId}/logo.png`;
    await ctx.deps.storage.put(logo, new Uint8Array([1]));
    expect((await ctx.request(fileUrl(logo))).status).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});
