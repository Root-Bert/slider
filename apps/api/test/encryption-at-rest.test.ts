import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openText, SEALED_PREFIX, sealText } from '../src/crypto/content-crypto';
import { sodium } from '../src/crypto/sodium';
import { dataKeyFromBytes, generateDataKey, loadDataKey } from '../src/crypto/data-key';
import {
  comments,
  decks,
  deletedPptxComments,
  instanceSettings,
  slideVersions,
} from '../src/db/schema';
import { silentLogger } from '../src/logger';
import {
  backfillContentEncryption,
  checkDataKey,
  WrongDataKeyError,
} from '../src/services/content-encryption';
import { blobKeys } from '../src/storage/blob-storage';
import { EncryptedBlobStorage } from '../src/storage/encrypted-blob-storage';
import { sealBlobV1, sealTextV1 } from './fixtures/legacy-v1-seal';
import { FsBlobStorage } from '../src/storage/fs-blob-storage';
import { createReadyDeck, createTestContext, openTestDatabase, pinComment } from './helpers';
import { TEST_DATA_KEY } from './setup-data-key';

const OTHER_KEY = dataKeyFromBytes(new Uint8Array(32).fill(9));
const read = async (stream: ReadableStream<Uint8Array> | null) =>
  new Uint8Array(await new Response(stream).arrayBuffer());
const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 251);

/** The libsodium formats before the place was bound in as additional data. */
function sealTextUnbound(plaintext: string): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    TEST_DATA_KEY.fieldKey,
  );
  return 'slenc2:' + Buffer.concat([nonce, ciphertext]).toString('base64url');
}
function sealBlobUnbound(data: Uint8Array): Uint8Array {
  const push = sodium.crypto_secretstream_xchacha20poly1305_init_push(TEST_DATA_KEY.blobKey);
  const parts: Uint8Array[] = [Buffer.from('SLS1'), push.header];
  for (let at = 0; at === 0 || at < data.length; at += 64 * 1024) {
    const last = at + 64 * 1024 >= data.length;
    parts.push(
      sodium.crypto_secretstream_xchacha20poly1305_push(
        push.state,
        data.subarray(at, at + 64 * 1024),
        null,
        last
          ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
          : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
      ),
    );
  }
  return Buffer.concat(parts);
}

let root: string;
let plain: FsBlobStorage;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'slider-encryption-test-'));
  plain = new FsBlobStorage(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('EncryptedBlobStorage', () => {
  const store = () => new EncryptedBlobStorage(plain, TEST_DATA_KEY);
  const CHUNK = 64 * 1024;

  it('keeps only ciphertext on disk and gives back the plaintext, any range, empty or missing', async () => {
    const data = new TextEncoder().encode('Vertrauliche Folie '.repeat(10));
    await store().put('decks/d/r/source-x.pptx', data);
    const onDisk = new Uint8Array(await readFile(path.join(root, 'decks/d/r/source-x.pptx')));
    expect(Buffer.from(onDisk).subarray(0, 4).toString('ascii')).toBe('SLS2');
    expect(Buffer.from(onDisk).includes(Buffer.from('Vertrauliche'))).toBe(false);
    expect(await store().get('decks/d/r/source-x.pptx')).toEqual(data);
    expect(await store().size('decks/d/r/source-x.pptx')).toBe(data.length);

    const media = bytes(3 * CHUNK + 1000);
    await store().put('decks/d/media/m.webm', media);
    expect(await store().size('decks/d/media/m.webm')).toBe(media.length);
    expect(await read(await store().stream('decks/d/media/m.webm'))).toEqual(media);
    for (const [start, end] of [
      [0, 0],
      [CHUNK - 1, CHUNK],
      [5, 2 * CHUNK + 7],
      [CHUNK, 2 * CHUNK - 1],
      [3 * CHUNK, 3 * CHUNK + 999],
      [3 * CHUNK + 500, 10 * CHUNK],
    ] as const) {
      expect(await read(await store().stream('decks/d/media/m.webm', { start, end }))).toEqual(
        media.slice(start, end + 1),
      );
    }

    await store().put('decks/d/empty.svg', new Uint8Array());
    expect(await store().get('decks/d/empty.svg')).toEqual(new Uint8Array());
    expect(await store().size('decks/d/empty.svg')).toBe(0);
    expect(await read(await store().stream('decks/d/empty.svg'))).toEqual(new Uint8Array());
    const exact = bytes(2 * CHUNK);
    await store().put('decks/d/exact.webm', exact);
    expect(await store().size('decks/d/exact.webm')).toBe(exact.length);
    expect(await read(await store().stream('decks/d/exact.webm'))).toEqual(exact);
    expect(await store().get('decks/d/none.svg')).toBeNull();
    expect(await store().size('decks/d/none.svg')).toBeNull();
    expect(await store().stream('decks/d/none.svg')).toBeNull();
  });

  it('reads plaintext and older formats, and seals them in place', async () => {
    await plain.put('decks/d/old.svg', new TextEncoder().encode('<svg/>'));
    expect(new TextDecoder().decode((await store().get('decks/d/old.svg')) ?? undefined)).toBe(
      '<svg/>',
    );
    expect(await store().size('decks/d/old.svg')).toBe(6);
    expect(await store().sealInPlace('decks/d/old.svg')).toBe(true);
    expect(await store().sealInPlace('decks/d/old.svg')).toBe(false);
    expect((await readFile(path.join(root, 'decks/d/old.svg'))).subarray(0, 4).toString()).toBe(
      'SLS2',
    );
    expect(new TextDecoder().decode((await store().get('decks/d/old.svg')) ?? undefined)).toBe(
      '<svg/>',
    );

    // The first format, and libsodium's before the key was bound in.
    const data = bytes(CHUNK + 10);
    await plain.put('decks/d/v1.webm', sealBlobV1(data, TEST_DATA_KEY));
    expect(await store().get('decks/d/v1.webm')).toEqual(data);
    expect(await store().size('decks/d/v1.webm')).toBe(data.length);
    expect(await read(await store().stream('decks/d/v1.webm', { start: 3, end: 9 }))).toEqual(
      data.slice(3, 10),
    );
    expect(await store().sealInPlace('decks/d/v1.webm')).toBe(true);
    expect((await readFile(path.join(root, 'decks/d/v1.webm'))).subarray(0, 4).toString()).toBe(
      'SLS2',
    );
    expect(await store().get('decks/d/v1.webm')).toEqual(data);

    const unbound = bytes(2 * CHUNK + 9);
    await plain.put('decks/d/unbound.webm', sealBlobUnbound(unbound));
    expect(await store().get('decks/d/unbound.webm')).toEqual(unbound);
    expect(await store().size('decks/d/unbound.webm')).toBe(unbound.length);
    expect(
      await read(
        await store().stream('decks/d/unbound.webm', { start: CHUNK - 2, end: CHUNK + 2 }),
      ),
    ).toEqual(unbound.slice(CHUNK - 2, CHUNK + 3));
    expect(await store().sealInPlace('decks/d/unbound.webm')).toBe(true);
    expect(await store().sealInPlace('decks/d/unbound.webm')).toBe(false);
    expect(
      (await readFile(path.join(root, 'decks/d/unbound.webm'))).subarray(0, 4).toString(),
    ).toBe('SLS2');
    expect(await store().get('decks/d/unbound.webm')).toEqual(unbound);

    // Plaintext streams, also ranges, as they were when opened.
    await plain.put('decks/d/old.webm', new TextEncoder().encode('0123456789'));
    expect(
      new TextDecoder().decode(
        await read(await store().stream('decks/d/old.webm', { start: 2, end: 5 })),
      ),
    ).toBe('2345');
    const opened = await store().stream('decks/d/old.webm');
    expect(await store().sealInPlace('decks/d/old.webm')).toBe(true);
    expect(new TextDecoder().decode(await read(opened))).toBe('0123456789');
  });

  it('refuses tampered files, cut-off files, other keys and files copied to another key', async () => {
    const data = bytes(2 * CHUNK + 40);
    await store().put('decks/d/a.webm', data);
    const file = path.join(root, 'decks/d/a.webm');
    const sealed = await readFile(file);
    await expect(
      new EncryptedBlobStorage(plain, OTHER_KEY).get('decks/d/a.webm'),
    ).rejects.toThrow();

    const flipped = Buffer.from(sealed);
    flipped[28 + 3]! ^= 1;
    await writeFile(file, flipped);
    await expect(store().get('decks/d/a.webm')).rejects.toThrow();
    await expect(read(await store().stream('decks/d/a.webm'))).rejects.toThrow();

    // Whole chunks dropped from the end are noticed too, not served as a shorter file.
    await writeFile(file, sealed.subarray(0, 28 + 2 * (CHUNK + 17)));
    await expect(store().get('decks/d/a.webm')).rejects.toThrow(/truncated/);
    await expect(read(await store().stream('decks/d/a.webm'))).rejects.toThrow(/truncated/);

    // Bound to its key: copied under another key it does not open.
    await store().put('decks/a/r/source.pptx', data);
    await plain.put('decks/b/r/source.pptx', (await plain.get('decks/a/r/source.pptx'))!);
    await expect(store().get('decks/b/r/source.pptx')).rejects.toThrow(/another key/);
    await expect(read(await store().stream('decks/b/r/source.pptx'))).rejects.toThrow(
      /another key/,
    );
    expect(await store().get('decks/a/r/source.pptx')).toEqual(data);
  });

  it('survives races with the backfill, deletes and crashes mid-write', async () => {
    const old = bytes(CHUNK + 5);
    await plain.put('decks/d/old.webm', old);
    // Sealed right after the format was looked at, before the size is read.
    class SealedWhileAsked extends FsBlobStorage {
      sealed = false;
      override async size(key: string) {
        if (!this.sealed) {
          this.sealed = true;
          await store().sealInPlace(key);
        }
        return super.size(key);
      }
    }
    const racing = new EncryptedBlobStorage(new SealedWhileAsked(root), TEST_DATA_KEY);
    expect(await racing.size('decks/d/old.webm')).toBe(old.length);
    await plain.deletePrefix('decks/');

    // Sealing in place never brings back a file deleted meanwhile.
    // Deleted while the plaintext is read, before the sealed file is written back.
    class DeletedWhileSealing extends FsBlobStorage {
      deleting: Promise<void> | null = null;
      constructor(private readonly remove: (store: FsBlobStorage) => Promise<void>) {
        super(root);
      }
      override async get(key: string) {
        const data = await super.get(key);
        this.deleting ??= this.remove(this);
        return data;
      }
    }
    for (const remove of [
      (fs: FsBlobStorage) => fs.deletePrefix('decks/d/'),
      (fs: FsBlobStorage) => fs.delete('decks/d/old.svg'),
    ]) {
      await plain.put('decks/d/old.svg', new TextEncoder().encode('<svg/>'));
      const inner = new DeletedWhileSealing(remove);
      await new EncryptedBlobStorage(inner, TEST_DATA_KEY).sealInPlace('decks/d/old.svg');
      await inner.deleting;
      expect(await plain.get('decks/d/old.svg')).toBeNull();
      expect(await plain.list('decks/')).toEqual([]);
    }

    // A crash mid-write never leaves half a file behind.
    await plain.put('decks/d/x.svg', new Uint8Array([1]));
    await writeFile(path.join(root, 'decks/d/x.svg.abc.partial'), 'cut short');
    expect(await plain.list('decks/')).toEqual(['decks/d/x.svg']);
  });
});

describe('encrypted columns', () => {
  it('stores comment bodies, drawn text, slide texts, titles and source links only as ciphertext', async () => {
    const ctx = await createTestContext();
    try {
      const deck = await createReadyDeck(ctx, {
        title: 'Geheimer Plan',
        slideCount: 1,
        shapes: [
          { id: '1', name: 'Titel', bbox: { x: 0, y: 0, w: 1, h: 1 }, text: 'Umsatzziel 2027' },
        ],
      });
      const response = await ctx.request(`/api/decks/${deck.deckId}/comments`, {
        method: 'POST',
        json: pinComment(deck.slideIds[0]!, 'Zahl stimmt nicht'),
      });
      expect(response.status).toBe(201);

      const [comment] = await ctx.deps.db
        .select({ raw: sql<string>`${comments.body}`, body: comments.body })
        .from(comments);
      expect(comment?.raw.startsWith(SEALED_PREFIX)).toBe(true);
      expect(comment?.raw).not.toContain('Zahl');
      expect(comment?.body).toBe('Zahl stimmt nicht');

      const [row] = await ctx.deps.db
        .select({
          title: sql<string>`${decks.title}`,
          fileName: sql<string>`${decks.fileName}`,
        })
        .from(decks)
        .where(eq(decks.id, deck.deckId));
      expect(row?.title.startsWith(SEALED_PREFIX)).toBe(true);
      expect(row?.fileName.startsWith(SEALED_PREFIX)).toBe(true);

      const [version] = await ctx.deps.db
        .select({
          kind: sql<string>`jsonb_typeof(${slideVersions.shapes})`,
          text: sql<string>`${slideVersions.shapes}::text`,
          shapes: slideVersions.shapes,
        })
        .from(slideVersions);
      expect(version?.kind).toBe('string');
      expect(version?.text).not.toContain('Umsatzziel');
      expect(version?.shapes[0]?.text).toBe('Umsatzziel 2027');

      const list = (await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json()) as {
        body: string;
      }[];
      expect(list.map((c) => c.body)).toEqual(['Zahl stimmt nicht']);

      // Bound to its column: copied into another one it does not open.
      await ctx.deps.db.execute(
        sql`update ${decks} set file_name = title where id = ${deck.deckId}`,
      );
      await expect(ctx.deps.db.select({ fileName: decks.fileName }).from(decks)).rejects.toThrow(
        /cannot be decrypted/,
      );
      const [titled] = await ctx.deps.db.select({ title: decks.title }).from(decks);
      expect(titled?.title).toBe('Geheimer Plan');
    } finally {
      await ctx.cleanup();
    }

    // Text placed on the slide and source links.
    const other = await createTestContext();
    try {
      const ctx = other;
      const deck = await createReadyDeck(ctx, { slideCount: 1 });
      await ctx.deps.db
        .update(decks)
        .set({ sourceUrl: 'https://firma.sharepoint.com/Doc.aspx?file=Geheimprojekt.pptx' })
        .where(eq(decks.id, deck.deckId));
      const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
      const post = (body: string) =>
        ctx.request(`/api/decks/${deck.deckId}/comments`, {
          method: 'POST',
          json: {
            slideId: deck.slideIds[0]!,
            body,
            anchor: { type: 'rect', rect, shapeRef: null },
            strokes: [{ tool: 'text', color: 'red', ...rect, text: 'Logo größer', fontSize: 0.04 }],
          },
        });
      expect((await post('Logo größer')).status).toBe(201);
      // Without a comment text: the sticker's text is the comment's, an open comment too.
      expect((await post('')).status).toBe(201);
      expect(
        (
          await ctx.request(`/api/decks/${deck.deckId}/comments`, {
            method: 'POST',
            json: pinComment(deck.slideIds[0]!, 'Ohne Zeichnung'),
          })
        ).status,
      ).toBe(201);

      const rows = await ctx.deps.db
        .select({ raw: sql<string>`${comments.strokes}::text`, strokes: comments.strokes })
        .from(comments)
        .orderBy(comments.createdAt);
      expect(rows.map((row) => row.raw.includes(SEALED_PREFIX))).toEqual([true, true, false]);
      expect(rows.some((row) => row.raw.includes('Logo'))).toBe(false);
      expect(rows[2]?.raw).toBe('[]');
      expect(rows[0]?.strokes[0]).toMatchObject({ tool: 'text', text: 'Logo größer' });

      const list = (await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json()) as {
        strokes: { text?: string }[];
      }[];
      expect(list.map((c) => c.strokes[0]?.text ?? null)).toEqual([
        'Logo größer',
        'Logo größer',
        null,
      ]);
      const card = (await (await ctx.request(`/api/decks/${deck.deckId}`)).json()) as {
        openCommentCount: number;
      };
      expect(card.openCommentCount).toBe(3);

      const [row] = await ctx.deps.db
        .select({ raw: sql<string>`${decks.sourceUrl}`, sourceUrl: decks.sourceUrl })
        .from(decks);
      expect(row?.raw.startsWith(SEALED_PREFIX)).toBe(true);
      expect(row?.raw).not.toContain('Geheimprojekt');
      expect(row?.sourceUrl).toContain('Geheimprojekt.pptx');
    } finally {
      await other.cleanup();
    }

    // Lookalikes are sealed, blank text stays blank; tampering, other keys and columns refused.
    const lookalike = `${SEALED_PREFIX}AAAA`;
    expect(openText(sealText(lookalike, 'comments.body'), 'comments.body')).toBe(lookalike);
    expect(sealText('  ', 'comments.body')).toBe('  ');
    // Blank as SQL's `btrim` sees it, which the backfill and open-comments test with.
    expect(sealText('\n\t', 'comments.body').startsWith(SEALED_PREFIX)).toBe(true);
    expect(sealText('a', 'comments.body')).not.toBe(sealText('a', 'comments.body'));

    const sealed = sealText('Umsatz', 'decks.title');
    expect(() => openText(sealed, 'decks.title', OTHER_KEY)).toThrow();
    const flipped = Buffer.from(sealed.slice(SEALED_PREFIX.length), 'base64url');
    flipped[flipped.length - 1]! ^= 1;
    expect(() => openText(SEALED_PREFIX + flipped.toString('base64url'), 'decks.title')).toThrow();
    expect(openText(sealTextV1('Altformat', TEST_DATA_KEY), 'decks.title')).toBe('Altformat');
    expect(openText(sealTextUnbound('Ohne Ort'), 'decks.title')).toBe('Ohne Ort');
    expect(() => openText(sealText('Umsatz', 'decks.title'), 'comments.body')).toThrow(
      /cannot be decrypted/,
    );
  });
});

describe('data key', () => {
  it('comes from env, a file or a generated file; the first start records it, another stops it', async () => {
    const { db, close } = await openTestDatabase();
    try {
      await checkDataKey(db, TEST_DATA_KEY);
      await checkDataKey(db, TEST_DATA_KEY);
      await expect(checkDataKey(db, OTHER_KEY)).rejects.toBeInstanceOf(WrongDataKeyError);
    } finally {
      await close();
    }

    const text = generateDataKey();
    expect(loadDataKey({ SLIDER_DATA_KEY: text }, root)).toMatchObject({ source: 'env' });

    const file = path.join(root, 'outside.key');
    await writeFile(file, `${text}\n`);
    const fromFile = loadDataKey({ SLIDER_DATA_KEY_FILE: file }, root);
    expect(fromFile).toMatchObject({ source: 'file', file });
    expect(fromFile.key.id).toBe(loadDataKey({ SLIDER_DATA_KEY: text }, root).key.id);

    const generated = loadDataKey({}, path.join(root, 'data'));
    expect(generated).toMatchObject({ source: 'data-dir', created: true });
    expect((await stat(generated.file!)).mode & 0o777).toBe(0o600);
    const again = loadDataKey({}, path.join(root, 'data'));
    expect(again).toMatchObject({ created: false });
    expect(again.key.id).toBe(generated.key.id);

    expect(() => loadDataKey({ SLIDER_DATA_KEY: 'too-short' }, root)).toThrow(/no usable data key/);
  });
});

describe('backfill', () => {
  it('seals files and rows stored before encryption, in batches, once', async () => {
    const ctx = await createTestContext();
    try {
      const deck = await createReadyDeck(ctx, {
        slideCount: 1,
        shapes: [{ id: '1', name: 'Titel', bbox: { x: 0, y: 0, w: 1, h: 1 }, text: 'Alt' }],
      });
      // As written before encryption: plaintext rows and files.
      await ctx.deps.db.execute(
        sql`update ${decks} set title = ${sealTextV1('Altes Deck', TEST_DATA_KEY)}, file_name = 'alt.pptx', source_url = 'https://example.com/alt.pptx' where id = ${deck.deckId}`,
      );
      await ctx.request(`/api/decks/${deck.deckId}/comments`, {
        method: 'POST',
        json: pinComment(deck.slideIds[0]!, 'Alt'),
      });
      await ctx.deps.db.execute(
        sql`update ${comments} set body = ${sealTextUnbound('Alter Kommentar')}`,
      );
      await ctx.deps.db.execute(
        sql`update ${comments} set strokes = '[{"tool":"text","color":"red","x":0.1,"y":0.1,"w":0.2,"h":0.1,"text":"Alter Text","fontSize":0.04}]'::jsonb`,
      );
      await ctx.deps.db.execute(
        sql`update ${slideVersions} set title = 'Alte Folie', text_hash = 'a1b2c3d4', shapes = '[{"id":"1","name":"Titel","bbox":{"x":0,"y":0,"w":1,"h":1},"text":"Alt"}]'::jsonb`,
      );
      await ctx.deps.db.execute(
        sql`insert into ${deletedPptxComments} (deck_id, external_id, body_hash) values (${deck.deckId}, 'old', 'deadbeef')`,
      );
      // Whitespace only, and more of it than one batch.
      await ctx.deps.db.execute(
        sql`insert into ${deletedPptxComments} (deck_id, external_id, body_hash) select ${deck.deckId}, 'blank-' || n, E'\n\t' from generate_series(1, 250) n`,
      );
      const fs = new FsBlobStorage(ctx.blobsDir);
      const legacyKey = blobKeys.slideRender(deck.deckId, deck.revisionId, 'svg');
      await fs.put(legacyKey, new TextEncoder().encode('<svg>alt</svg>'));
      const v1Key = blobKeys.slideRender(deck.deckId, deck.revisionId, 'svg');
      await fs.put(v1Key, sealBlobV1(new TextEncoder().encode('<svg>v1</svg>'), TEST_DATA_KEY));
      const unboundKey = `decks/${deck.deckId}/unbound.svg`;
      await fs.put(unboundKey, sealBlobUnbound(new TextEncoder().encode('<svg>ohne</svg>')));

      const storage = ctx.deps.storage as EncryptedBlobStorage;
      const media = ctx.deps.media as EncryptedBlobStorage;
      await backfillContentEncryption({
        db: ctx.deps.db,
        stores: [storage, media],
        log: silentLogger,
      });

      for (const key of [legacyKey, v1Key, unboundKey]) {
        expect(
          Buffer.from((await fs.get(key)) ?? [])
            .subarray(0, 4)
            .toString(),
        ).toBe('SLS2');
      }
      expect(new TextDecoder().decode((await storage.get(v1Key)) ?? undefined)).toBe(
        '<svg>v1</svg>',
      );
      expect(new TextDecoder().decode((await storage.get(legacyKey)) ?? undefined)).toBe(
        '<svg>alt</svg>',
      );
      expect(new TextDecoder().decode((await storage.get(unboundKey)) ?? undefined)).toBe(
        '<svg>ohne</svg>',
      );
      const [row] = await ctx.deps.db
        .select({
          raw: sql<string>`${decks.title}`,
          rawSourceUrl: sql<string>`${decks.sourceUrl}`,
          title: decks.title,
          fileName: decks.fileName,
          sourceUrl: decks.sourceUrl,
        })
        .from(decks);
      expect(row?.raw.startsWith(SEALED_PREFIX)).toBe(true);
      expect(row).toMatchObject({
        title: 'Altes Deck',
        fileName: 'alt.pptx',
        sourceUrl: 'https://example.com/alt.pptx',
      });
      expect(row?.rawSourceUrl.startsWith(SEALED_PREFIX)).toBe(true);
      const [comment] = await ctx.deps.db
        .select({
          raw: sql<string>`${comments.strokes}::text`,
          rawBody: sql<string>`${comments.body}`,
          body: comments.body,
          strokes: comments.strokes,
        })
        .from(comments);
      expect(comment?.rawBody.startsWith(SEALED_PREFIX)).toBe(true);
      expect(comment?.body).toBe('Alter Kommentar');
      expect(comment?.raw).not.toContain('Alter Text');
      expect(comment?.strokes[0]).toMatchObject({ text: 'Alter Text' });
      const [version] = await ctx.deps.db
        .select({
          kind: sql<string>`jsonb_typeof(${slideVersions.shapes})`,
          title: slideVersions.title,
          rawTextHash: sql<string>`${slideVersions.textHash}`,
          textHash: slideVersions.textHash,
          shapes: slideVersions.shapes,
        })
        .from(slideVersions);
      expect(version).toMatchObject({ kind: 'string', title: 'Alte Folie', textHash: 'a1b2c3d4' });
      expect(version?.rawTextHash.startsWith(SEALED_PREFIX)).toBe(true);
      const tombstones = await ctx.deps.db
        .select({
          external: deletedPptxComments.externalId,
          raw: sql<string>`${deletedPptxComments.bodyHash}`,
          hash: deletedPptxComments.bodyHash,
        })
        .from(deletedPptxComments);
      expect(tombstones).toHaveLength(251);
      expect(tombstones.every((row) => row.raw.startsWith(SEALED_PREFIX))).toBe(true);
      expect(tombstones.find((row) => row.external === 'old')?.hash).toBe('deadbeef');
      expect(tombstones.filter((row) => row.hash === '\n\t')).toHaveLength(250);
      expect(version?.shapes[0]?.text).toBe('Alt');

      // Done once: a later plaintext file is no longer looked for.
      const [done] = await ctx.deps.db
        .select()
        .from(instanceSettings)
        .where(eq(instanceSettings.key, '__content_encrypted'));
      expect(done?.value).toBe('v5');
      await fs.put('decks/x/late.svg', new TextEncoder().encode('<svg/>'));
      await backfillContentEncryption({
        db: ctx.deps.db,
        stores: [storage, media],
        log: silentLogger,
      });
      expect((await fs.get('decks/x/late.svg'))?.subarray(0, 4)).not.toEqual(
        new TextEncoder().encode('SLS2'),
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps edits made meanwhile, and refuses files without encryption once all was sealed', async () => {
    const ctx = await createTestContext();
    try {
      const fs = new FsBlobStorage(ctx.blobsDir);
      const storage = ctx.deps.storage as EncryptedBlobStorage;
      const media = ctx.deps.media as EncryptedBlobStorage;
      await storage.put('decks/d/sealed.svg', new TextEncoder().encode('<svg>ok</svg>'));
      // Before the backfill finished: read as stored before encryption.
      await fs.put('decks/d/early.svg', new TextEncoder().encode('<svg>alt</svg>'));
      expect(new TextDecoder().decode((await storage.get('decks/d/early.svg'))!)).toBe(
        '<svg>alt</svg>',
      );

      const deck = await createReadyDeck(ctx, { slideCount: 1 });
      await ctx.deps.db.execute(
        sql`update ${decks} set title = 'Alter Titel' where id = ${deck.deckId}`,
      );
      // The deck is renamed right after the backfill read it.
      const db = ctx.deps.db;
      const racing = new Proxy(db, {
        get(target, property, receiver) {
          if (property !== 'update') return Reflect.get(target, property, receiver);
          return (table: typeof decks) => {
            const update = target.update(table);
            if (table !== decks) return update;
            return {
              set(values: Parameters<typeof update.set>[0]) {
                const query = update.set(values);
                const run = query.then.bind(query);
                query.then = ((resolve, reject) =>
                  target
                    .update(decks)
                    .set({ title: 'Neuer Titel' })
                    .where(eq(decks.id, deck.deckId))
                    .then(() => run(resolve, reject))) as typeof query.then;
                return query;
              },
            };
          };
        },
      });
      const warnings: string[] = [];
      const log = { ...silentLogger, warn: (message: string) => warnings.push(message) };
      await backfillContentEncryption({ db: racing, stores: [storage, media], log });
      // The edit made between reading the row and sealing it is kept.
      const [row] = await db
        .select({ raw: sql<string>`${decks.title}`, title: decks.title })
        .from(decks)
        .where(eq(decks.id, deck.deckId));
      expect(row?.title).toBe('Neuer Titel');
      expect(row?.raw.startsWith(SEALED_PREFIX)).toBe(true);
      // Sealed by the backfill: still readable.
      expect(new TextDecoder().decode((await storage.get('decks/d/early.svg'))!)).toBe(
        '<svg>alt</svg>',
      );

      // Put there afterwards, from outside: missing, with a warning.
      await fs.put('decks/d/planted.svg', new TextEncoder().encode('<svg>fremd</svg>'));
      expect(await storage.get('decks/d/planted.svg')).toBeNull();
      expect(await storage.size('decks/d/planted.svg')).toBeNull();
      expect(await storage.stream('decks/d/planted.svg')).toBeNull();
      expect(await storage.stream('decks/d/planted.svg', { start: 0, end: 3 })).toBeNull();
      expect(warnings).toHaveLength(4);
      expect(warnings[0]).toContain('decks/d/planted.svg');
      expect(new TextDecoder().decode((await storage.get('decks/d/sealed.svg'))!)).toBe(
        '<svg>ok</svg>',
      );

      // A later start finds the backfill done and refuses them right away.
      const restarted = new EncryptedBlobStorage(fs, TEST_DATA_KEY);
      expect(await restarted.get('decks/d/planted.svg')).not.toBeNull();
      await backfillContentEncryption({ db: ctx.deps.db, stores: [restarted], log });
      expect(await restarted.get('decks/d/planted.svg')).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
