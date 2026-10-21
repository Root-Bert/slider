import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Author, SlideVersionView } from '@slider/shared';
import { revisions, slideVersions, workspaceMembers } from '../src/db/schema';
import {
  createReadyDeck,
  createTestContext,
  signedInUser,
  type DeckFixture,
  type TestContext,
} from './helpers';

describe('GET /decks/:deckId/people and /slides/:slideId/versions', () => {
  let ctx: TestContext;
  let deck: DeckFixture;

  beforeEach(async () => {
    ctx = await createTestContext();
    deck = await createReadyDeck(ctx);
  });
  afterEach(() => ctx.cleanup());

  /** A second revision of the deck holding the given slides. */
  async function addRevision(number: number, status: 'ready' | 'pending' = 'ready') {
    const revisionId = crypto.randomUUID();
    await ctx.deps.db
      .insert(revisions)
      .values({ id: revisionId, deckId: deck.deckId, number, pptxKey: null, status });
    await ctx.deps.db.insert(slideVersions).values(
      deck.slideIds.map((slideId, position) => ({
        id: crypto.randomUUID(),
        slideId,
        revisionId,
        position,
        imageKey: `decks/${deck.deckId}/r${number}-${position}.svg`,
        thumbnailKey: `decks/${deck.deckId}/r${number}-${position}.svg`,
        aspectRatio: 4 / 3,
        shapes: [],
      })),
    );
    return revisionId;
  }

  it('lists the members of the deck’s organisation, sorted by name', async () => {
    const zoe = await signedInUser(ctx, { name: 'Zoe Zimmer', email: 'zoe@firma.de' });
    const anna = await signedInUser(ctx, { name: 'Anna Arndt', email: 'anna@firma.de' });
    await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    await ctx.deps.db.insert(workspaceMembers).values([
      { workspaceId: ctx.workspaceId, userId: zoe.user.id, role: 'reviewer' },
      { workspaceId: ctx.workspaceId, userId: anna.user.id, role: 'viewer' },
    ]);

    const res = await ctx.request(`/api/decks/${deck.deckId}/people`);
    expect(res.status).toBe(200);
    const people = (await res.json()) as Author[];
    expect(people.map((p) => p.name)).toEqual(['Anna Arndt', 'Robert Hofmann', 'Zoe Zimmer']);
    expect(people.every((p) => p.type === 'owner')).toBe(true);
    expect(people.find((p) => p.name === 'Zoe Zimmer')).toEqual({
      id: zoe.user.id,
      name: 'Zoe Zimmer',
      type: 'owner',
      color: 'blue',
    });

    // Viewers may see who is there too.
    const asViewer = await ctx.request(`/api/decks/${deck.deckId}/people`, { cookie: anna.cookie });
    expect(asViewer.status).toBe(200);
  });

  it('hides people and versions from accounts outside the organisation', async () => {
    const { cookie } = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    const slideId = deck.slideIds[0] ?? '';
    expect((await ctx.request(`/api/decks/${deck.deckId}/people`, { cookie })).status).toBe(404);
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/slides/${slideId}/versions`, { cookie }))
        .status,
    ).toBe(404);
    expect((await ctx.request(`/api/decks/${crypto.randomUUID()}/people`)).status).toBe(404);
  });

  it('lists every ready version of a slide, newest first', async () => {
    await addRevision(2);
    await addRevision(3, 'pending');
    const slideId = deck.slideIds[1] ?? '';
    const res = await ctx.request(`/api/decks/${deck.deckId}/slides/${slideId}/versions`);
    expect(res.status).toBe(200);
    const versions = (await res.json()) as SlideVersionView[];
    expect(versions.map((v) => v.revisionNumber)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({ aspectRatio: 4 / 3, shapes: [] });
    expect(versions[0]?.imageUrl).toMatch(/^\/files\/decks\/.+\?exp=\d+&sig=/);
    expect(versions[1]?.revisionId).toBe(deck.revisionId);
    expect(versions[1]?.revisionCreatedAt).toEqual(expect.any(String));
  });

  it('is empty for a slide of another deck', async () => {
    const other = await createReadyDeck(ctx, { title: 'Anderes Deck' });
    const res = await ctx.request(
      `/api/decks/${deck.deckId}/slides/${other.slideIds[0] ?? ''}/versions`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
