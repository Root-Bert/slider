import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deckFolderSchema, deckSchema } from '@slider/shared';
import { workspaceMembers } from '../src/db/schema';
import { createReadyDeck, createTestContext, signedInUser, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());

const createFolder = async (name: string, cookie?: string) =>
  ctx.request(`/api/workspaces/${ctx.workspaceId}/folders`, {
    method: 'POST',
    json: { name },
    cookie,
  });

describe('deck folders', () => {
  it('creates, lists, renames and deletes a folder; the deck survives', async () => {
    const res = await createFolder('  Demo Slides ');
    expect(res.status).toBe(201);
    const folder = deckFolderSchema.parse(await res.json());
    expect(folder.name).toBe('Demo Slides');

    const { deckId } = await createReadyDeck(ctx);
    const moved = await ctx.request(`/api/decks/${deckId}`, {
      method: 'PATCH',
      json: { folderId: folder.id },
    });
    expect(deckSchema.parse(await moved.json()).folderId).toBe(folder.id);

    const renamed = await ctx.request(`/api/folders/${folder.id}`, {
      method: 'PATCH',
      json: { name: 'Demos' },
    });
    expect(deckFolderSchema.parse(await renamed.json()).name).toBe('Demos');
    const list = await ctx.request(`/api/workspaces/${ctx.workspaceId}/folders`);
    expect((await list.json()) as unknown[]).toHaveLength(1);

    expect((await ctx.request(`/api/folders/${folder.id}`, { method: 'DELETE' })).status).toBe(204);
    const deck = deckSchema.parse(await (await ctx.request(`/api/decks/${deckId}`)).json());
    expect(deck.folderId).toBeNull();
  });

  it('rejects a folder of another workspace and reviewers managing folders', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const res = await ctx.request(`/api/decks/${deckId}`, {
      method: 'PATCH',
      json: { folderId: 'nope' },
    });
    expect(res.status).toBe(404);

    const reviewer = await signedInUser(ctx, { name: 'Rita', email: 'rita@firma.de' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: reviewer.user.id, role: 'reviewer' });
    expect((await createFolder('Mine', reviewer.cookie)).status).toBe(403);
  });
});
