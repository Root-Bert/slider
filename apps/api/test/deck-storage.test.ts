import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Comment,
  DeckStorage,
  DeletedSlide,
  PruneDeckStorageResult,
  SlideVersionView,
} from '@slider/shared';
import {
  blobDeletions,
  comments,
  decks,
  media,
  revisions,
  slides,
  slideVersions,
  workspaceMembers,
} from '../src/db/schema';
import { retryBlobDeletions } from '../src/services/blob-deletions';
import { blobKeys } from '../src/storage/blob-storage';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type DeckFixture,
  type TestContext,
} from './helpers';

const bytes = (size: number) => new Uint8Array(size).fill(7);

describe('deck storage: sizes and "Alles außer der neuesten Version löschen"', () => {
  let ctx: TestContext;
  let deck: DeckFixture;
  /** Revision 2 – the current one. */
  let currentId: string;
  let oldPptx: string;
  let newPptx: string;
  /** Revision 1's image of slide 0, reused unchanged by revision 2 (blob reuse). */
  let reusedKey: string;
  let newImageKeys: string[];
  let goneSlideId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    deck = await createReadyDeck(ctx, { slideCount: 3 });
    const { db, storage } = ctx.deps;
    // createReadyDeck stores `<svg/>` (6 bytes) per slide; give revision 1 a 100-byte original.
    oldPptx = blobKeys.pptx(deck.deckId, deck.revisionId);
    await storage.put(oldPptx, bytes(100));
    await db.update(revisions).set({ pptxKey: oldPptx }).where(eq(revisions.id, deck.revisionId));

    // Revision 2: slide 0 keeps its image, slide 1 gets a new one, slide 2 was deleted, slide 3 new.
    currentId = crypto.randomUUID();
    newPptx = blobKeys.pptx(deck.deckId, currentId);
    await storage.put(newPptx, bytes(200));
    await db
      .insert(revisions)
      .values({ id: currentId, deckId: deck.deckId, number: 2, pptxKey: newPptx });
    const addedSlide = crypto.randomUUID();
    await db.insert(slides).values({ id: addedSlide, deckId: deck.deckId });
    reusedKey = deck.imageKeys[0] ?? '';
    goneSlideId = deck.slideIds[2] ?? '';
    newImageKeys = [
      blobKeys.slideRender(deck.deckId, currentId, 'svg'),
      blobKeys.slideRender(deck.deckId, currentId, 'svg'),
    ];
    for (const key of newImageKeys) await storage.put(key, bytes(10));
    const current = [
      { slideId: deck.slideIds[0] ?? '', key: reusedKey },
      { slideId: deck.slideIds[1] ?? '', key: newImageKeys[0] ?? '' },
      { slideId: addedSlide, key: newImageKeys[1] ?? '' },
    ];
    await db.insert(slideVersions).values(
      current.map(({ slideId, key }, position) => ({
        id: crypto.randomUUID(),
        slideId,
        revisionId: currentId,
        position,
        imageKey: key,
        thumbnailKey: key,
        aspectRatio: 16 / 9,
        shapes: [],
      })),
    );
    await db
      .update(revisions)
      .set({
        diff: {
          previousRevisionId: deck.revisionId,
          slides: [],
          deleted: [{ slideId: goneSlideId, previousPosition: 2, confidence: 1 }],
        },
      })
      .where(eq(revisions.id, currentId));
    await db.update(decks).set({ currentRevisionId: currentId }).where(eq(decks.id, deck.deckId));
  });
  afterEach(() => ctx.cleanup());

  const getStorage = async (cookie?: string) => {
    const res = await ctx.request(`/api/decks/${deck.deckId}/storage`, { cookie });
    return { res, body: res.ok ? ((await res.json()) as DeckStorage) : null };
  };
  const prune = (cookie?: string) =>
    ctx.request(`/api/decks/${deck.deckId}/storage/prune`, { method: 'POST', cookie });

  /** A comment on the slide revision 2 dropped, with a 50-byte voice recording. */
  async function commentWithMedia() {
    // Written while revision 1 was current – the API refuses comments on a deleted slide now.
    const comment = { id: crypto.randomUUID() };
    await ctx.deps.db.insert(comments).values({
      id: comment.id,
      deckId: deck.deckId,
      slideId: goneSlideId,
      author: { id: ctx.ownerId, name: 'Robert Hofmann', type: 'owner', color: 'red' },
      body: 'Auf alter Version',
      anchor: pinComment(goneSlideId).anchor,
      source: 'app',
    });
    const mediaId = crypto.randomUUID();
    const storageKey = blobKeys.media(deck.deckId, mediaId, 'webm');
    await ctx.deps.media.put(storageKey, bytes(50));
    await ctx.deps.db.insert(media).values({
      id: mediaId,
      deckId: deck.deckId,
      commentId: comment.id,
      ownerId: ctx.ownerId,
      uploaderId: ctx.ownerId,
      kind: 'audio',
      mimeType: 'audio/webm',
      sizeBytes: 50,
      durationMs: 1000,
      storageKey,
      sha256: 'x',
    });
    return { comment, storageKey };
  }

  it('reports sizes per kind and what only older versions use', async () => {
    await commentWithMedia();
    const { res, body } = await getStorage();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      // originals 100 + 200, images 3×6 (rev 1) + 2×10 (rev 2), media 50
      totalBytes: 300 + 38 + 50,
      breakdown: { originals: 300, slideImages: 38, media: 50, other: 0 },
      originalCount: 2,
      // rev 1's original and its two images revision 2 does not reuse
      reclaimableBytes: 100 + 12,
      olderVersionCount: 1,
      busy: false,
    } satisfies DeckStorage);
  });

  it('only managers see or prune it', async () => {
    const reviewer = await signedInUser(ctx, { name: 'Rita Review', email: 'rita@firma.de' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: reviewer.user.id, role: 'reviewer' });
    const outsider = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });

    expect((await getStorage(reviewer.cookie)).res.status).toBe(403);
    expect((await prune(reviewer.cookie)).status).toBe(403);
    expect((await getStorage(outsider.cookie)).res.status).toBe(404);
    expect((await prune(outsider.cookie)).status).toBe(404);
    // Nothing was deleted.
    expect(await ctx.deps.storage.size(oldPptx)).toBe(100);
  });

  it('deletes older files but keeps reused ones, comments, media and the newest version', async () => {
    const { comment, storageKey } = await commentWithMedia();
    const res = await prune();
    expect(res.status).toBe(200);
    const result = (await res.json()) as PruneDeckStorageResult;
    expect(result.freedBytes).toBe(112);
    expect(result.prunedVersionCount).toBe(1);
    expect(result.storage).toMatchObject({ reclaimableBytes: 0, olderVersionCount: 0 });
    expect(result.storage.totalBytes).toBe(200 + 6 + 20 + 50);

    const { storage } = ctx.deps;
    expect(await storage.size(oldPptx)).toBeNull();
    expect(await storage.size(deck.imageKeys[1] ?? '')).toBeNull();
    expect(await storage.size(deck.imageKeys[2] ?? '')).toBeNull();
    // Still used by revision 2 – lives in revision 1's folder, must stay.
    expect(await storage.size(reusedKey)).toBe(6);
    expect(await storage.size(newPptx)).toBe(200);
    for (const key of newImageKeys) expect(await storage.size(key)).toBe(10);
    expect(await ctx.deps.media.size(storageKey)).toBe(50);

    // Comments and their media stay.
    const listed = (await (
      await ctx.request(`/api/decks/${deck.deckId}/comments`)
    ).json()) as Comment[];
    expect(listed.map((c) => c.id)).toContain(comment.id);
    expect(listed.find((c) => c.id === comment.id)?.media?.id).toBeTruthy();

    // Old versions say their images are gone; the reused one does not.
    const versions = async (slideId: string) =>
      (await (
        await ctx.request(`/api/decks/${deck.deckId}/slides/${slideId}/versions`)
      ).json()) as SlideVersionView[];
    const slide1 = await versions(deck.slideIds[1] ?? '');
    expect(slide1.map((v) => [v.revisionNumber, v.filesDeleted ?? false])).toEqual([
      [2, false],
      [1, true],
    ]);
    const slide0 = await versions(deck.slideIds[0] ?? '');
    expect(slide0.every((v) => !v.filesDeleted)).toBe(true);

    // The deleted slide still lists with its comment, marked as gone.
    const deleted = (await (
      await ctx.request(`/api/decks/${deck.deckId}/deleted-slides`)
    ).json()) as DeletedSlide[];
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ slideId: goneSlideId, filesDeleted: true });
    expect(deleted[0]?.comments.map((c) => c.id)).toEqual([comment.id]);

    const [old] = await ctx.deps.db
      .select({ filesDeletedAt: revisions.filesDeletedAt })
      .from(revisions)
      .where(eq(revisions.id, deck.revisionId));
    expect(old?.filesDeletedAt).toBeInstanceOf(Date);

    // A second run has nothing left to free.
    const again = (await (await prune()).json()) as PruneDeckStorageResult;
    expect(again.freedBytes).toBe(0);
    expect(again.prunedVersionCount).toBe(0);
    expect(await storage.size(reusedKey)).toBe(6);
  });

  it('notes files the store fails to delete for the hourly retry, still answers', async () => {
    const { storage } = ctx.deps;
    const remove = storage.delete.bind(storage);
    const removePrefix = storage.deletePrefix.bind(storage);
    storage.delete = () => Promise.reject(new Error('storage down'));
    storage.deletePrefix = () => Promise.reject(new Error('storage down'));
    const res = await prune();
    storage.delete = remove;
    storage.deletePrefix = removePrefix;
    expect(res.status).toBe(200);
    const noted = await ctx.deps.db.select().from(blobDeletions);
    expect(noted).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: oldPptx, prefix: false })]),
    );
    await retryBlobDeletions(ctx.deps);
    expect(await storage.size(oldPptx)).toBeNull();
    expect(await storage.size(reusedKey)).toBe(6);
    expect(await ctx.deps.db.select().from(blobDeletions)).toEqual([]);
  });

  it('keeps files a version being imported refers to, and waits until it is done', async () => {
    await ctx.deps.db
      .insert(revisions)
      .values({ id: crypto.randomUUID(), deckId: deck.deckId, number: 3, status: 'pending' });
    expect((await getStorage()).body?.busy).toBe(true);
    const res = await prune();
    expect(res.status).toBe(409);
    expect(await ctx.deps.storage.size(oldPptx)).toBe(100);
  });

  it('waits while the slides are being re-rendered', async () => {
    ctx.deps.rendering?.progress.queued(deck.deckId);
    expect((await prune()).status).toBe(409);
    expect(await ctx.deps.storage.size(oldPptx)).toBe(100);
  });

  it('counts left-overs outside the known folders as "other" and leaves them', async () => {
    const stray = `${blobKeys.deckPrefix(deck.deckId)}stray.bin`;
    await ctx.deps.storage.put(stray, bytes(9));
    // MEDIA_DIR pointed at the blob folder: recordings are counted once (from the rows), kept.
    const recording = blobKeys.media(deck.deckId, crypto.randomUUID(), 'webm');
    await ctx.deps.storage.put(recording, bytes(40));
    expect((await getStorage()).body?.breakdown.other).toBe(9);
    await prune();
    expect(await ctx.deps.storage.size(stray)).toBe(9);
    expect(await ctx.deps.storage.size(recording)).toBe(40);
  });
});
