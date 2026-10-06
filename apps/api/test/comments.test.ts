import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentSchema, type Comment, type CreateCommentInput } from '@slider/shared';
import { comments } from '../src/db/schema';
import { externalAuthor } from '../src/authors';
import {
  cookieFrom,
  createReadyDeck,
  createTestContext,
  pinComment,
  type DeckFixture,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let deck: DeckFixture;
beforeEach(async () => {
  ctx = await createTestContext();
  deck = await createReadyDeck(ctx, { slideCount: 3 });
});
afterEach(() => ctx.cleanup());

const slide = (index: number) => deck.slideIds[index] ?? '';

async function post(input: CreateCommentInput, cookie?: string) {
  return ctx.request(`/api/decks/${deck.deckId}/comments`, { method: 'POST', json: input, cookie });
}

async function create(input: CreateCommentInput, cookie?: string): Promise<Comment> {
  const res = await post(input, cookie);
  expect(res.status).toBe(201);
  return commentSchema.parse(await res.json());
}

/** Joins the deck as a guest through a fresh review link and returns the cookie. */
async function joinAsGuest(name: string, role: 'view' | 'comment' = 'comment'): Promise<string> {
  const link = (await (
    await ctx.request(`/api/decks/${deck.deckId}/review-links`, { method: 'POST', json: { role } })
  ).json()) as { token: string };
  const res = await ctx.request(`/api/invites/${link.token}/join`, {
    method: 'POST',
    json: { name },
  });
  return cookieFrom(res);
}

describe('creating comments', () => {
  it('creates a pin comment authored by the viewer and lists it', async () => {
    const comment = await create(pinComment(slide(0), '  Logo fehlt.  '));
    expect(comment).toMatchObject({
      deckId: deck.deckId,
      slideId: slide(0),
      parentId: null,
      body: 'Logo fehlt.',
      status: 'open',
      source: 'app',
      author: { name: 'Robert Hofmann', type: 'owner' },
    });

    const list = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(list.map((c) => c.id)).toEqual([comment.id]);
  });

  it('accepts a drawing without text', async () => {
    const comment = await create({
      slideId: slide(0),
      body: '',
      anchor: { type: 'rect', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, shapeRef: null },
      strokes: [
        {
          tool: 'pen',
          color: 'yellow',
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.2, y: 0.2 },
          ],
        },
      ],
    });
    expect(comment.strokes).toHaveLength(1);
  });

  it('rejects comments with neither text nor drawing', async () => {
    const res = await post(pinComment(slide(0), '   '));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('rejects invalid anchors', async () => {
    const res = await post({
      slideId: slide(0),
      body: 'x',
      anchor: { type: 'point', point: { x: 2, y: 0 }, shapeRef: null },
    });
    expect(res.status).toBe(400);
  });

  it('rejects slides from another deck', async () => {
    const other = await createReadyDeck(ctx, { slideCount: 1 });
    const res = await post(pinComment(other.slideIds[0] ?? ''));
    expect(res.status).toBe(400);
  });

  it('creates gap comments without a slide', async () => {
    const comment = await create({
      slideId: null,
      body: 'Hier fehlt eine Folie.',
      anchor: { type: 'gap', afterSlideId: slide(1), beforeSlideId: slide(2) },
    });
    expect(comment.slideId).toBeNull();

    const withSlide = await post({
      slideId: slide(0),
      body: 'x',
      anchor: { type: 'gap', afterSlideId: slide(0), beforeSlideId: slide(1) },
    });
    expect(withSlide.status).toBe(400);
  });
});

describe('replies', () => {
  it('inherit the parent’s slide', async () => {
    const root = await create(pinComment(slide(1)));
    const reply = await create({
      slideId: null,
      parentId: root.id,
      body: 'Erledigt.',
      anchor: { type: 'slide' },
    });
    expect(reply).toMatchObject({ parentId: root.id, slideId: slide(1) });
  });

  it('cannot be nested', async () => {
    const root = await create(pinComment(slide(0)));
    const reply = await create({
      slideId: null,
      parentId: root.id,
      body: 'A',
      anchor: { type: 'slide' },
    });
    const res = await post({
      slideId: null,
      parentId: reply.id,
      body: 'B',
      anchor: { type: 'slide' },
    });
    expect(res.status).toBe(400);
  });

  it('must use a slide anchor and reference a comment of the same deck', async () => {
    const root = await create(pinComment(slide(0)));
    const withPin = await post({ ...pinComment(slide(0)), parentId: root.id });
    expect(withPin.status).toBe(400);
    const unknownParent = await post({
      slideId: null,
      parentId: 'nope',
      body: 'x',
      anchor: { type: 'slide' },
    });
    expect(unknownParent.status).toBe(400);
  });
});

describe('updating and deleting', () => {
  it('lets anyone with comment rights resolve, and records who did', async () => {
    const root = await create(pinComment(slide(0)));
    const guest = await joinAsGuest('Lena Wolf');

    const res = await ctx.request(`/api/comments/${root.id}`, {
      method: 'PATCH',
      json: { status: 'done' },
      cookie: guest,
    });
    expect(res.status).toBe(200);
    const done = commentSchema.parse(await res.json());
    expect(done.status).toBe('done');
    expect(done.resolvedBy).not.toBeNull();
    expect(done.resolvedAt).not.toBeNull();

    const reopened = commentSchema.parse(
      await (
        await ctx.request(`/api/comments/${root.id}`, { method: 'PATCH', json: { status: 'open' } })
      ).json(),
    );
    expect(reopened).toMatchObject({ status: 'open', resolvedBy: null, resolvedAt: null });
  });

  it('only lets the author edit the text', async () => {
    const root = await create(pinComment(slide(0)));
    const guest = await joinAsGuest('Max Kern');

    const byGuest = await ctx.request(`/api/comments/${root.id}`, {
      method: 'PATCH',
      json: { body: 'Gekapert' },
      cookie: guest,
    });
    expect(byGuest.status).toBe(403);

    const byAuthor = await ctx.request(`/api/comments/${root.id}`, {
      method: 'PATCH',
      json: { body: 'Präziser' },
    });
    expect(commentSchema.parse(await byAuthor.json()).body).toBe('Präziser');
  });

  it('never edits the text of PowerPoint comments', async () => {
    const id = crypto.randomUUID();
    await ctx.deps.db.insert(comments).values({
      id,
      deckId: deck.deckId,
      slideId: slide(0),
      author: externalAuthor('Anna Becker'),
      body: 'Aus PowerPoint',
      anchor: { type: 'slide' },
      source: 'pptx',
      externalId: 'guid-1',
    });
    const res = await ctx.request(`/api/comments/${id}`, {
      method: 'PATCH',
      json: { body: 'Neu' },
    });
    expect(res.status).toBe(403);
    const resolve = await ctx.request(`/api/comments/${id}`, {
      method: 'PATCH',
      json: { status: 'done' },
    });
    expect(resolve.status).toBe(200);
  });

  it('lets guests delete only their own comments; deleting a root removes its replies', async () => {
    const guest = await joinAsGuest('Anna Becker');
    const ownerRoot = await create(pinComment(slide(0)));
    const guestRoot = await create(pinComment(slide(1), 'Von Anna'), guest);
    await create({
      slideId: null,
      parentId: guestRoot.id,
      body: 'Antwort',
      anchor: { type: 'slide' },
    });

    expect(
      (await ctx.request(`/api/comments/${ownerRoot.id}`, { method: 'DELETE', cookie: guest }))
        .status,
    ).toBe(403);
    expect(
      (await ctx.request(`/api/comments/${guestRoot.id}`, { method: 'DELETE', cookie: guest }))
        .status,
    ).toBe(204);

    const left = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(left.map((c) => c.id)).toEqual([ownerRoot.id]);
  });

  it('lets the owner delete any comment', async () => {
    const guest = await joinAsGuest('Anna Becker');
    const guestRoot = await create(pinComment(slide(1)), guest);
    expect((await ctx.request(`/api/comments/${guestRoot.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
  });

  it('returns 404 for unknown comments', async () => {
    expect((await ctx.request('/api/comments/nope', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('view-only guests', () => {
  it('can read but not comment', async () => {
    const viewer = await joinAsGuest('Gast', 'view');
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/comments`, { cookie: viewer })).status,
    ).toBe(200);
    const res = await post(pinComment(slide(0)), viewer);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });
});
