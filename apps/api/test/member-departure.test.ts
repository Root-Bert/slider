import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { WorkspaceRole } from '@slider/shared';
import { comments, decks, slides, workspaceMembers } from '../src/db/schema';
import { blobKeys } from '../src/storage/blob-storage';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type TestContext,
} from './helpers';
import { FakeSource } from './sync-helpers';

let ctx: TestContext;
let onedrive: FakeSource;
let sharepoint: FakeSource;

beforeEach(async () => {
  onedrive = new FakeSource();
  sharepoint = new FakeSource();
  ctx = await createTestContext({ sources: { onedrive, sharepoint } });
});
afterEach(() => ctx.cleanup());

async function member(name: string, role: WorkspaceRole) {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person;
}

type Linked = {
  ownerId: string;
  source?: 'onedrive' | 'sharepoint' | 'nextcloud' | 'url';
  sourceRef?: string;
  sourceUrl?: string | null;
};

/** A ready linked deck owned by `ownerId`, straight in the database. */
async function linkedDeck({
  ownerId,
  source = 'sharepoint',
  sourceRef = 'drives/b!lib/items/i1',
  sourceUrl = null,
}: Linked): Promise<string> {
  const { deckId } = await createReadyDeck(ctx);
  await ctx.deps.db
    .update(decks)
    .set({ ownerId, linkedById: ownerId, source, sourceRef, sourceUrl })
    .where(eq(decks.id, deckId));
  return deckId;
}

const deck = async (deckId: string) => {
  const [row] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
  if (!row) throw new Error('deck missing');
  return row;
};

const removeRequest = (userId: string, cookie?: string, successor?: string) =>
  ctx.request(
    `/api/workspaces/${ctx.workspaceId}/members/${userId}${successor ? `?successor=${successor}` : ''}`,
    { method: 'DELETE', cookie },
  );

/** An uploaded deck owned by `ownerId`. */
async function uploadedDeck(ownerId: string, title = 'Upload'): Promise<string> {
  const { deckId } = await createReadyDeck(ctx, { title });
  await ctx.deps.db.update(decks).set({ ownerId }).where(eq(decks.id, deckId));
  return deckId;
}

const gone = async (deckId: string) =>
  (await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId))).length === 0;

const preview = async (userId: string, cookie?: string, successor?: string) => {
  const query = successor ? `?successor=${successor}` : '';
  return ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${userId}/departure${query}`, {
    cookie,
  });
};

describe('decks of someone removed from the workspace (BER-165)', () => {
  it('deletes their linked decks with comments and files – Slider read them with their accounts', async () => {
    const mia = await member('Mia', 'member');
    const sharepointDeck = await linkedDeck({ ownerId: mia.user.id });
    const [slide] = await ctx.deps.db
      .select()
      .from(slides)
      .where(eq(slides.deckId, sharepointDeck));
    const posted = await ctx.request(`/api/decks/${sharepointDeck}/comments`, {
      method: 'POST',
      json: pinComment(slide?.id ?? ''),
      cookie: mia.cookie,
    });
    expect(posted.status).toBe(201);
    // After the comment: the free plan takes three reviews before it stops new comments.
    const onedriveDeck = await linkedDeck({ ownerId: mia.user.id, source: 'onedrive' });
    const nextcloudDeck = await linkedDeck({
      ownerId: mia.user.id,
      source: 'nextcloud',
      sourceRef: 'https://cloud.example.de/f/101',
    });
    const web = await linkedDeck({
      ownerId: mia.user.id,
      source: 'url',
      sourceRef: 'https://cdn.example.com/q4.pptx',
    });

    expect((await removeRequest(mia.user.id)).status).toBe(204);

    for (const id of [sharepointDeck, onedriveDeck, nextcloudDeck, web]) {
      expect(await gone(id)).toBe(true);
      expect(await ctx.deps.storage.list(blobKeys.deckPrefix(id))).toEqual([]);
    }
    expect(
      await ctx.deps.db.select().from(comments).where(eq(comments.deckId, sharepointDeck)),
    ).toEqual([]);
  });

  it('hands their uploads to the workspace owner, not to the admin who removed them', async () => {
    const olga = await member('Olga', 'admin');
    const mia = await member('Mia', 'member');
    const upload = await uploadedDeck(mia.user.id);

    expect((await removeRequest(mia.user.id, olga.cookie)).status).toBe(204);

    expect(await deck(upload)).toMatchObject({ ownerId: ctx.ownerId, archivedAt: null });
  });

  it('leaves the decks of other people alone', async () => {
    const mia = await member('Mia', 'member');
    const linked = await linkedDeck({ ownerId: ctx.ownerId });
    const upload = await uploadedDeck(ctx.ownerId);
    expect((await removeRequest(mia.user.id)).status).toBe(204);
    expect(await deck(linked)).toMatchObject({ archivedAt: null, ownerId: ctx.ownerId });
    expect((await deck(upload)).ownerId).toBe(ctx.ownerId);
  });
});

describe('decks of someone leaving', () => {
  it('linked ones are deleted, uploads go to the workspace owner', async () => {
    const mia = await member('Mia', 'member');
    const linked = await linkedDeck({ ownerId: mia.user.id });
    const upload = await uploadedDeck(mia.user.id);

    expect((await removeRequest(mia.user.id, mia.cookie)).status).toBe(204);

    expect(await gone(linked)).toBe(true);
    expect((await deck(upload)).ownerId).toBe(ctx.ownerId);
  });

  it('the owner leaving: uploads go to whom the workspace passes', async () => {
    const mia = await member('Mia', 'member');
    const linked = await linkedDeck({ ownerId: ctx.ownerId });
    const upload = await uploadedDeck(ctx.ownerId);

    expect((await removeRequest(ctx.ownerId, undefined, mia.user.id)).status).toBe(204);

    expect(await gone(linked)).toBe(true);
    expect((await deck(upload)).ownerId).toBe(mia.user.id);
  });

  it('a refused leave changes nothing', async () => {
    const linked = await linkedDeck({ ownerId: ctx.ownerId });
    expect((await removeRequest(ctx.ownerId)).status).toBe(400);
    expect(await deck(linked)).toMatchObject({ ownerId: ctx.ownerId, archivedAt: null });
  });
});

describe('the warning before someone goes', () => {
  it('lists the decks to be deleted and those passing to the workspace owner', async () => {
    const mia = await member('Mia', 'member');
    const linked = await linkedDeck({ ownerId: mia.user.id });
    await ctx.deps.db.update(decks).set({ title: 'Q4 aus SharePoint' }).where(eq(decks.id, linked));
    const upload = await uploadedDeck(mia.user.id, 'Hochgeladen');
    await uploadedDeck(ctx.ownerId, 'Nicht ihres');

    for (const cookie of [undefined, mia.cookie]) {
      const res = await preview(mia.user.id, cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        heir: { userId: ctx.ownerId, name: expect.any(String) },
        deleted: [{ id: linked, title: 'Q4 aus SharePoint' }],
        transferred: [{ id: upload, title: 'Hochgeladen' }],
      });
    }
  });

  it('names the successor a leaving owner picks', async () => {
    const mia = await member('Mia', 'member');
    const upload = await uploadedDeck(ctx.ownerId);
    const res = await preview(ctx.ownerId, undefined, mia.user.id);
    expect(await res.json()).toMatchObject({
      heir: { userId: mia.user.id, name: 'Mia' },
      transferred: [{ id: upload }],
    });
  });

  it('ignores a successor where removing takes none', async () => {
    const mia = await member('Mia', 'member');
    const ben = await member('Ben', 'member');
    await uploadedDeck(mia.user.id);
    const res = await preview(mia.user.id, undefined, ben.user.id);
    expect(await res.json()).toMatchObject({ heir: { userId: ctx.ownerId } });
  });

  it('only for the person themselves and admins', async () => {
    const mia = await member('Mia', 'member');
    const olga = await member('Olga', 'member');
    expect((await preview(olga.user.id, mia.cookie)).status).toBe(403);
    const outsider = await signedInUser(ctx, { name: 'Out', email: 'out@example.com' });
    expect((await preview(mia.user.id, outsider.cookie)).status).toBe(404);
  });
});
