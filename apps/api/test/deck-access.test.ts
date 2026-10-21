import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  authorSchema,
  deckAccessSchema,
  deckSchema,
  type Author,
  type DeckAccess,
  type LiveEvent,
  type WorkspaceRole,
} from '@slider/shared';
import { comments, deckAccessGrants, decks, media, workspaceMembers } from '../src/db/schema';
import { LiveHub } from '../src/realtime/live-hub';
import { blobKeys } from '../src/storage/blob-storage';
import { fileUrl } from '../src/storage/file-urls';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type DeckFixture,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let hub: LiveHub;
let deck: DeckFixture;

beforeEach(async () => {
  hub = new LiveHub();
  ctx = await createTestContext({ live: hub });
  deck = await createReadyDeck(ctx, { title: 'Geheim' });
});
afterEach(async () => {
  hub.closeAll();
  await ctx.cleanup();
});

async function member(name: string, role: WorkspaceRole) {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person;
}

const setAccess = (deckId: string, body: unknown, cookie?: string) =>
  ctx.request(`/api/decks/${deckId}/access`, { method: 'PUT', json: body, cookie });

async function restrict(deckId: string, userIds: string[], cookie?: string): Promise<DeckAccess> {
  const res = await setAccess(deckId, { restricted: true, userIds }, cookie);
  expect(res.status).toBe(200);
  return deckAccessSchema.parse(await res.json());
}

const listedDeckIds = async (cookie?: string, query = '') => {
  const res = await ctx.request(`/api/decks${query}`, { cookie });
  expect(res.status).toBe(200);
  return deckSchema
    .array()
    .parse(await res.json())
    .map((d) => d.id);
};

/** A comment of the dev owner with a recording, straight in the database. */
async function commentWithRecording(): Promise<{ commentId: string; mediaId: string }> {
  const posted = await ctx.request(`/api/decks/${deck.deckId}/comments`, {
    method: 'POST',
    json: pinComment(deck.slideIds[0] ?? ''),
  });
  expect(posted.status).toBe(201);
  const { id: commentId } = (await posted.json()) as { id: string };
  const mediaId = crypto.randomUUID();
  const storageKey = blobKeys.media(deck.deckId, mediaId, 'webm');
  await ctx.deps.media.put(storageKey, new Uint8Array([1, 2, 3]));
  await ctx.deps.db.insert(media).values({
    id: mediaId,
    deckId: deck.deckId,
    commentId,
    ownerId: ctx.ownerId,
    uploaderId: ctx.ownerId,
    kind: 'audio',
    mimeType: 'audio/webm',
    sizeBytes: 3,
    durationMs: 1000,
    storageKey,
    sha256: 'abc',
  });
  return { commentId, mediaId };
}

/** Every way to reach a deck's content, as one person: their status codes, by endpoint. */
async function reach(cookie: string, ids: { commentId: string; mediaId: string }) {
  const { deckId, revisionId } = deck;
  const get = async (path: string) => (await ctx.request(path, { cookie })).status;
  return {
    detail: await get(`/api/decks/${deckId}`),
    slides: await get(`/api/decks/${deckId}/slides`),
    people: await get(`/api/decks/${deckId}/people`),
    comments: await get(`/api/decks/${deckId}/comments`),
    status: await get(`/api/decks/${deckId}/status`),
    revisions: await get(`/api/decks/${deckId}/revisions`),
    diff: await get(`/api/decks/${deckId}/revisions/${revisionId}/diff`),
    mediaUsage: await get(`/api/decks/${deckId}/media-usage`),
    media: await get(`/api/media/${ids.mediaId}`),
    file: await get(fileUrl(deck.imageKeys[0] ?? '')),
    live: await (async () => {
      const controller = new AbortController();
      const res = await ctx.request(`/api/decks/${deckId}/live`, {
        cookie,
        signal: controller.signal,
      });
      controller.abort();
      await res.body?.cancel().catch(() => {});
      return res.status;
    })(),
    comment: (
      await ctx.request(`/api/decks/${deckId}/comments`, {
        method: 'POST',
        json: pinComment(deck.slideIds[0] ?? ''),
        cookie,
      })
    ).status,
    resolve: (
      await ctx.request(`/api/comments/${ids.commentId}`, {
        method: 'PATCH',
        json: { status: 'done' },
        cookie,
      })
    ).status,
  };
}

/** What {@link reach} answers someone who may open the deck. */
const OPEN = {
  detail: 200,
  slides: 200,
  people: 200,
  comments: 200,
  status: 200,
  revisions: 200,
  diff: 200,
  mediaUsage: 200,
  media: 200,
  file: 200,
  live: 200,
  comment: 201,
  resolve: 200,
};

describe('restricting a deck to selected accounts', () => {
  it('starts unrestricted and says so in the deck and its access list', async () => {
    const res = await ctx.request(`/api/decks/${deck.deckId}/access`);
    expect(res.status).toBe(200);
    expect(deckAccessSchema.parse(await res.json())).toEqual({ restricted: false, userIds: [] });
    const dto = deckSchema.parse(await (await ctx.request(`/api/decks/${deck.deckId}`)).json());
    expect(dto.restricted).toBe(false);
  });

  it('keeps everyone else out like a non-member, on every way to the deck', async () => {
    const anna = await member('Anna', 'reviewer');
    const ben = await member('Ben', 'reviewer');
    const ids = await commentWithRecording();
    const before = await reach(ben.cookie, ids);
    expect(before).toEqual(OPEN);

    const access = await restrict(deck.deckId, [anna.user.id]);
    expect(access).toEqual({ restricted: true, userIds: [anna.user.id] });

    const kept = await reach(ben.cookie, ids);
    expect(kept).toEqual(Object.fromEntries(Object.keys(OPEN).map((key) => [key, 404])));
    expect(await listedDeckIds(ben.cookie)).not.toContain(deck.deckId);
    expect(await listedDeckIds(ben.cookie, `?workspaceId=${ctx.workspaceId}`)).not.toContain(
      deck.deckId,
    );

    expect(await reach(anna.cookie, ids)).toEqual(OPEN);
    expect(await listedDeckIds(anna.cookie)).toContain(deck.deckId);
    const dto = deckSchema.parse(
      await (await ctx.request(`/api/decks/${deck.deckId}`, { cookie: anna.cookie })).json(),
    );
    expect(dto.restricted).toBe(true);
  });

  it('keeps archived and foldered decks out of the lists too, and keeps the restriction', async () => {
    const ben = await member('Ben', 'member');
    const folder = await ctx.request(`/api/workspaces/${ctx.workspaceId}/folders`, {
      method: 'POST',
      json: { name: 'Vorstand' },
    });
    const { id: folderId } = (await folder.json()) as { id: string };
    await restrict(deck.deckId, []);
    const moved = await ctx.request(`/api/decks/${deck.deckId}`, {
      method: 'PATCH',
      json: { folderId, archived: true },
    });
    expect(deckSchema.parse(await moved.json()).restricted).toBe(true);
    expect(await listedDeckIds(ben.cookie)).not.toContain(deck.deckId);
  });

  it('never locks out the owner or the admins, listed or not', async () => {
    const mia = await member('Mia', 'member');
    const carla = await member('Carla', 'admin');
    await ctx.deps.db.update(decks).set({ ownerId: mia.user.id }).where(eq(decks.id, deck.deckId));
    await restrict(deck.deckId, []);

    for (const cookie of [mia.cookie, carla.cookie, undefined]) {
      expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie })).status).toBe(200);
      expect(await listedDeckIds(cookie)).toContain(deck.deckId);
    }
    // A new owner (handover) gets in as well, listed or not.
    const nora = await member('Nora', 'reviewer');
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: nora.cookie })).status).toBe(
      404,
    );
    await ctx.deps.db.update(decks).set({ ownerId: nora.user.id }).where(eq(decks.id, deck.deckId));
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: nora.cookie })).status).toBe(
      200,
    );
  });

  it('suggests only the people who may open it for @', async () => {
    const anna = await member('Anna', 'reviewer');
    await member('Ben', 'reviewer');
    const carla = await member('Carla', 'admin');
    await restrict(deck.deckId, [anna.user.id]);
    const res = await ctx.request(`/api/decks/${deck.deckId}/people`);
    const ids = authorSchema
      .array()
      .parse(await res.json())
      .map((person) => person.id);
    expect(ids.sort()).toEqual([anna.user.id, carla.user.id, ctx.ownerId].sort());
  });

  it('lifting the restriction lets everyone in again and keeps the list for next time', async () => {
    const anna = await member('Anna', 'reviewer');
    const ben = await member('Ben', 'reviewer');
    await restrict(deck.deckId, [anna.user.id]);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: ben.cookie })).status).toBe(
      404,
    );

    const res = await setAccess(deck.deckId, { restricted: false, userIds: [anna.user.id] });
    expect(deckAccessSchema.parse(await res.json())).toEqual({
      restricted: false,
      userIds: [anna.user.id],
    });
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: ben.cookie })).status).toBe(
      200,
    );
    expect(await listedDeckIds(ben.cookie)).toContain(deck.deckId);
  });

  it('replaces the whole list', async () => {
    const anna = await member('Anna', 'reviewer');
    const ben = await member('Ben', 'reviewer');
    await restrict(deck.deckId, [anna.user.id, ben.user.id, anna.user.id]);
    const access = await restrict(deck.deckId, [ben.user.id]);
    expect(access.userIds).toEqual([ben.user.id]);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: anna.cookie })).status).toBe(
      404,
    );
  });

  it('accepts only members of the workspace, and rejects malformed bodies', async () => {
    const outsider = await signedInUser(ctx, { name: 'Olaf', email: 'olaf@extern.de' });
    const res = await setAccess(deck.deckId, { restricted: true, userIds: [outsider.user.id] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'bad_request' } });
    const unknown = await setAccess(deck.deckId, { restricted: true, userIds: ['nobody'] });
    expect(unknown.status).toBe(400);
    expect((await setAccess(deck.deckId, { restricted: 'ja', userIds: [] })).status).toBe(400);
    expect((await setAccess(deck.deckId, { restricted: true })).status).toBe(400);
    // Nothing changed.
    const access = await ctx.request(`/api/decks/${deck.deckId}/access`);
    expect(deckAccessSchema.parse(await access.json())).toEqual({ restricted: false, userIds: [] });
  });

  it('lets only its managers and the admins read or change the list', async () => {
    const anna = await member('Anna', 'member');
    const mia = await member('Mia', 'member');
    const carla = await member('Carla', 'admin');
    const outsider = await signedInUser(ctx, { name: 'Olaf', email: 'olaf@extern.de' });
    const path = `/api/decks/${deck.deckId}/access`;

    // A member who doesn't own it may see the deck, not its list.
    expect((await ctx.request(path, { cookie: anna.cookie })).status).toBe(403);
    expect(
      (await setAccess(deck.deckId, { restricted: true, userIds: [] }, anna.cookie)).status,
    ).toBe(403);
    expect((await ctx.request(path, { cookie: outsider.cookie })).status).toBe(404);

    await restrict(deck.deckId, [anna.user.id], carla.cookie);
    // Listed, still no manager: 403; kept out: 404 like everywhere else.
    expect((await ctx.request(path, { cookie: anna.cookie })).status).toBe(403);
    expect((await ctx.request(path, { cookie: mia.cookie })).status).toBe(404);

    // The owner (a member) manages it.
    await ctx.deps.db.update(decks).set({ ownerId: mia.user.id }).where(eq(decks.id, deck.deckId));
    expect((await ctx.request(path, { cookie: mia.cookie })).status).toBe(200);
    expect((await restrict(deck.deckId, [], mia.cookie)).userIds).toEqual([]);
  });

  it('drops the grant when its member leaves or is removed', async () => {
    const anna = await member('Anna', 'reviewer');
    await restrict(deck.deckId, [anna.user.id]);
    const removed = await ctx.request(
      `/api/workspaces/${ctx.workspaceId}/members/${anna.user.id}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(204);
    const grants = await ctx.deps.db
      .select()
      .from(deckAccessGrants)
      .where(eq(deckAccessGrants.deckId, deck.deckId));
    expect(grants).toEqual([]);

    // Back in the workspace, Anna is no longer on the list.
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: anna.user.id, role: 'reviewer' });
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: anna.cookie })).status).toBe(
      404,
    );
  });

  it('goes with the deck', async () => {
    const anna = await member('Anna', 'reviewer');
    await restrict(deck.deckId, [anna.user.id]);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(204);
    expect(await ctx.deps.db.select().from(deckAccessGrants)).toEqual([]);
    expect(await ctx.deps.db.select().from(comments)).toEqual([]);
  });

  it('ends the live connections of everyone it keeps out, right away', async () => {
    const anna = await member('Anna', 'reviewer');
    const ben = await member('Ben', 'reviewer');
    const opened: { abort: () => void; body: ReadableStream<Uint8Array> | null }[] = [];
    const openLive = async (cookie: string) => {
      const controller = new AbortController();
      const res = await ctx.request(`/api/decks/${deck.deckId}/live`, {
        cookie,
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      opened.push({ abort: () => controller.abort(), body: res.body });
      const reader = res.body?.getReader();
      // Wait for the `hello`: the connection is in the room then.
      await reader?.read();
      reader?.releaseLock();
    };
    try {
      await openLive(anna.cookie);
      await openLive(ben.cookie);
      const names = () => hub.peers(deck.deckId).map((peer) => peer.author.name);
      expect(names().sort()).toEqual(['Anna', 'Ben']);

      await restrict(deck.deckId, [anna.user.id]);
      expect(names()).toEqual(['Anna']);
    } finally {
      for (const stream of opened) {
        stream.abort();
        await stream.body?.cancel().catch(() => {});
      }
    }
  });

  it('tells the others in the deck who left', async () => {
    const events: LiveEvent[] = [];
    const author = (id: string, name: string): Author => ({
      id,
      name,
      type: 'owner',
      color: 'blue',
    });
    hub.join(deck.deckId, author(ctx.ownerId, 'Owner'), (event) => events.push(event));
    const ben = await member('Ben', 'reviewer');
    hub.join(deck.deckId, author(ben.user.id, 'Ben'), () => {});
    await restrict(deck.deckId, []);
    expect(events.map((event) => event.type)).toContain('leave');
    expect(hub.peers(deck.deckId).map((peer) => peer.author.id)).toEqual([ctx.ownerId]);
  });
});
