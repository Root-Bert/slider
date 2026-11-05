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
import {
  comments,
  deckAccessGrants,
  decks,
  media,
  deckMaterials,
  showRuns,
  users,
  workspaces,
  workspaceMembers,
} from '../src/db/schema';
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
async function commentWithRecording(): Promise<{
  commentId: string;
  mediaId: string;
  materialId: string;
  runId: string;
}> {
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
  const materialId = crypto.randomUUID();
  const materialKey = blobKeys.material(deck.deckId, materialId);
  await ctx.deps.media.put(materialKey, new Uint8Array([4, 5, 6]));
  await ctx.deps.db.insert(deckMaterials).values({
    id: materialId,
    deckId: deck.deckId,
    author: { id: ctx.ownerId, name: 'Owner', type: 'owner', color: 'blue' },
    name: 'Private.bin',
    kind: 'other',
    mimeType: 'application/octet-stream',
    sizeBytes: 3,
    storageKey: materialKey,
    previewKey: materialKey,
    sha256: 'material-hash',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
  });
  const runId = crypto.randomUUID();
  const recordingKey = `decks/${deck.deckId}/runs/${runId}.webm`;
  await ctx.deps.storage.put(recordingKey, new Uint8Array([7, 8, 9]));
  await ctx.deps.db.insert(showRuns).values({
    id: runId,
    deckId: deck.deckId,
    at: ctx.clock.now(),
    summary: { at: ctx.clock.now().toISOString(), total: 1000, rows: [] },
    recordingKey,
  });
  return { commentId, mediaId, materialId, runId };
}

/** Every way to reach a deck's content, as one person: their status codes, by endpoint. */
async function reach(
  cookie: string,
  ids: { commentId: string; mediaId: string; materialId: string; runId: string },
) {
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
    board: await get(`/api/decks/${deckId}/board`),
    creation: await get(`/api/decks/${deckId}/creation`),
    runs: await get(`/api/decks/${deckId}/runs`),
    recording: await get(`/api/decks/${deckId}/runs/${ids.runId}/recording`),
    recordingHead: (
      await ctx.request(`/api/decks/${deckId}/runs/${ids.runId}/recording`, {
        method: 'HEAD',
        cookie,
      })
    ).status,
    material: await get(`/api/materials/${ids.materialId}/file`),
    preview: await get(`/api/materials/${ids.materialId}/preview`),
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
  board: 200,
  creation: 200,
  runs: 200,
  recording: 200,
  recordingHead: 200,
  material: 200,
  preview: 200,
  mediaUsage: 200,
  media: 200,
  file: 200,
  live: 200,
  comment: 201,
  resolve: 200,
};

describe('restricting a deck to selected accounts', () => {
  it('keeps everyone unlisted out like a non-member, on every way to the deck, until lifted', async () => {
    const start = await ctx.request(`/api/decks/${deck.deckId}/access`);
    expect(start.status).toBe(200);
    expect(deckAccessSchema.parse(await start.json())).toEqual({ restricted: false, userIds: [] });
    expect(
      deckSchema.parse(await (await ctx.request(`/api/decks/${deck.deckId}`)).json()).restricted,
    ).toBe(false);

    const anna = await member('Anna', 'reviewer');
    const ben = await member('Ben', 'reviewer');
    const ids = await commentWithRecording();
    expect(await reach(ben.cookie, ids)).toEqual(OPEN);

    const outsider = await signedInUser(ctx, { name: 'Outside', email: 'outside@foreign.test' });
    expect(await reach(outsider.cookie, ids)).toEqual(
      Object.fromEntries(Object.keys(OPEN).map((key) => [key, 404])),
    );
    const observer = await member('Observer', 'viewer');
    expect(await reach(observer.cookie, ids)).toEqual({ ...OPEN, comment: 403, resolve: 403 });
    const protectedWrites = [
      [
        'POST',
        `/api/decks/${deck.deckId}/runs`,
        { id: crypto.randomUUID(), run: { at: ctx.clock.now().toISOString(), total: 0, rows: [] } },
      ],
      [
        'POST',
        `/api/decks/${deck.deckId}/creation`,
        { description: 'Create a deck', kind: 'keynote', pages: 5, templateId: null },
      ],
      ['POST', `/api/decks/${deck.deckId}/creation/cancel`, undefined],
      ['POST', `/api/decks/${deck.deckId}/creation/dismiss`, undefined],
      [
        'POST',
        `/api/decks/${deck.deckId}/board/items`,
        { id: crypto.randomUUID(), kind: 'box', text: 'Unauthorized', x: 0, y: 0, w: 100, h: 100 },
      ],
    ] as const;
    for (const [method, url, json] of protectedWrites) {
      expect((await ctx.request(url, { method, json, cookie: outsider.cookie })).status, url).toBe(
        404,
      );
      expect((await ctx.request(url, { method, json, cookie: observer.cookie })).status, url).toBe(
        403,
      );
    }

    // Previously issued URLs cease to authorize requests after a role or account is revoked.
    await ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: ctx.clock.now() })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect(await reach(ben.cookie, ids)).toEqual(
      Object.fromEntries(Object.keys(OPEN).map((key) => [key, 403])),
    );
    await ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: null })
      .where(eq(workspaces.id, ctx.workspaceId));
    await ctx.deps.db
      .update(users)
      .set({ blockedAt: ctx.clock.now() })
      .where(eq(users.id, outsider.user.id));
    // Disable the development fallback for this check: production never impersonates an owner.
    ctx.deps.config.auth.devLogin = false;
    expect(await reach(outsider.cookie, ids)).toEqual(
      Object.fromEntries(Object.keys(OPEN).map((key) => [key, 401])),
    );
    ctx.deps.config.auth.devLogin = true;

    const access = await restrict(deck.deckId, [anna.user.id]);
    expect(access).toEqual({ restricted: true, userIds: [anna.user.id] });

    for (const [method, url, json] of protectedWrites) {
      expect(
        (await ctx.request(url, { method, json, cookie: ben.cookie })).status,
        `${url} after restriction`,
      ).toBe(404);
    }
    // A recording id is scoped to its deck, even when both decks are readable.
    const otherDeck = await createReadyDeck(ctx);
    expect(
      (await ctx.request(`/api/decks/${otherDeck.deckId}/runs/${ids.runId}/recording`)).status,
    ).toBe(404);
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

    // archived and in a folder, it stays restricted and out of the lists
    const folder = await ctx.request(`/api/workspaces/${ctx.workspaceId}/folders`, {
      method: 'POST',
      json: { name: 'Vorstand' },
    });
    const { id: folderId } = (await folder.json()) as { id: string };
    const moved = await ctx.request(`/api/decks/${deck.deckId}`, {
      method: 'PATCH',
      json: { folderId, archived: true },
    });
    expect(deckSchema.parse(await moved.json()).restricted).toBe(true);
    expect(await listedDeckIds(ben.cookie)).not.toContain(deck.deckId);

    // a new list replaces the old one, duplicates folded
    await restrict(deck.deckId, [anna.user.id, ben.user.id, anna.user.id]);
    expect((await restrict(deck.deckId, [ben.user.id])).userIds).toEqual([ben.user.id]);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: anna.cookie })).status).toBe(
      404,
    );

    // lifting lets everyone in again and keeps the list for next time
    const lifted = await setAccess(deck.deckId, { restricted: false, userIds: [ben.user.id] });
    expect(deckAccessSchema.parse(await lifted.json())).toEqual({
      restricted: false,
      userIds: [ben.user.id],
    });
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: anna.cookie })).status).toBe(
      200,
    );
  });

  it('never locks out the owner or the admins, and suggests only who may open it for @', async () => {
    const anna = await member('Anna', 'reviewer');
    const mia = await member('Mia', 'member');
    const carla = await member('Carla', 'admin');
    await restrict(deck.deckId, [anna.user.id]);
    const people = await ctx.request(`/api/decks/${deck.deckId}/people`);
    const suggested = authorSchema
      .array()
      .parse(await people.json())
      .map((person) => person.id);
    expect(suggested.sort()).toEqual([anna.user.id, carla.user.id, ctx.ownerId].sort());

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

  it('lets only its managers change the list, to members of the workspace only', async () => {
    const anna = await member('Anna', 'member');
    const mia = await member('Mia', 'member');
    const carla = await member('Carla', 'admin');
    const outsider = await signedInUser(ctx, { name: 'Olaf', email: 'olaf@extern.de' });
    const path = `/api/decks/${deck.deckId}/access`;

    const foreign = await setAccess(deck.deckId, { restricted: true, userIds: [outsider.user.id] });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toMatchObject({ error: { code: 'bad_request' } });
    expect((await setAccess(deck.deckId, { restricted: true, userIds: ['nobody'] })).status).toBe(
      400,
    );
    expect((await setAccess(deck.deckId, { restricted: 'ja', userIds: [] })).status).toBe(400);
    expect((await setAccess(deck.deckId, { restricted: true })).status).toBe(400);
    expect(deckAccessSchema.parse(await (await ctx.request(path)).json())).toEqual({
      restricted: false,
      userIds: [],
    });

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

  it('drops a grant when its member leaves, and all of them with the deck', async () => {
    const anna = await member('Anna', 'reviewer');
    await restrict(deck.deckId, [anna.user.id]);
    const removed = await ctx.request(
      `/api/workspaces/${ctx.workspaceId}/members/${anna.user.id}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(204);
    expect(
      await ctx.deps.db
        .select()
        .from(deckAccessGrants)
        .where(eq(deckAccessGrants.deckId, deck.deckId)),
    ).toEqual([]);

    // Back in the workspace, Anna is no longer on the list.
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: anna.user.id, role: 'reviewer' });
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: anna.cookie })).status).toBe(
      404,
    );

    await restrict(deck.deckId, [anna.user.id]);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(204);
    expect(await ctx.deps.db.select().from(deckAccessGrants)).toEqual([]);
    expect(await ctx.deps.db.select().from(comments)).toEqual([]);
  });

  it('ends the live connections of everyone it keeps out right away and tells the others', async () => {
    const anna = await member('Anna', 'reviewer');
    const ben = await member('Ben', 'reviewer');
    const events: LiveEvent[] = [];
    const owner: Author = { id: ctx.ownerId, name: 'Owner', type: 'owner', color: 'blue' };
    hub.join(deck.deckId, owner, (event) => events.push(event));
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
      expect(names().sort()).toEqual(['Anna', 'Ben', 'Owner']);

      await restrict(deck.deckId, [anna.user.id]);
      expect(names().sort()).toEqual(['Anna', 'Owner']);
      expect(events.map((event) => event.type)).toContain('leave');
    } finally {
      for (const stream of opened) {
        stream.abort();
        await stream.body?.cancel().catch(() => {});
      }
    }
  });
});
