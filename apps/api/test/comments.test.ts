import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentSchema, viewerSchema, type Comment, type CreateCommentInput } from '@slider/shared';
import { comments, reviewLinks, workspaceMembers } from '../src/db/schema';
import { newReviewToken } from '../src/services/review-links';
import { externalAuthor } from '../src/authors';
import {
  cookieFrom,
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
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

/** Joins the deck as a guest through a fresh (view-only) review link and returns the cookie. */
async function joinAsGuest(name: string): Promise<string> {
  const link = (await (
    await ctx.request(`/api/decks/${deck.deckId}/review-links`, {
      method: 'POST',
      json: { role: 'view' },
    })
  ).json()) as { token: string };
  return joinWithToken(link.token, name);
}

async function joinWithToken(token: string, name: string): Promise<string> {
  const res = await ctx.request(`/api/invites/${token}/join`, { method: 'POST', json: { name } });
  return cookieFrom(res);
}

/** A reviewer in the deck's organisation – commenting is for members (BER-130). */
async function asMember(name: string): Promise<string> {
  const person = await signedInUser(ctx, {
    name,
    email: `${name.split(' ')[0]?.toLowerCase()}@firma.de`,
  });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role: 'reviewer' });
  return person.cookie;
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

describe('text on the slide ("Text auf Folie")', () => {
  const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
  const textStroke = (overrides: Record<string, unknown> = {}) =>
    ({
      tool: 'text',
      color: 'red',
      ...box,
      text: 'Logo größer\nund mittig',
      fontSize: 0.04,
      ...overrides,
    }) as const;
  const textComment = (stroke: object, body = 'Bitte prüfen'): CreateCommentInput =>
    ({
      slideId: slide(0),
      body,
      anchor: { type: 'rect', rect: box, shapeRef: null },
      strokes: [stroke],
    }) as CreateCommentInput;

  it('stores the text box next to drawings, separate from the comment', async () => {
    const comment = await create({
      ...textComment(textStroke()),
      strokes: [
        textStroke(),
        {
          tool: 'ellipse',
          color: 'red',
          points: [
            { x: 0.5, y: 0.5 },
            { x: 0.7, y: 0.8 },
          ],
        },
      ],
    });
    expect(comment.body).toBe('Bitte prüfen');
    expect(comment.strokes[0]).toEqual(textStroke());
    expect(comment.strokes[1]).toMatchObject({ tool: 'ellipse' });

    const [listed] = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(listed?.strokes[0]).toEqual(textStroke());
  });

  it('accepts a text box without a comment', async () => {
    const comment = await create(textComment(textStroke(), ''));
    expect(comment.body).toBe('');
    expect(comment.strokes[0]).toEqual(textStroke());
  });

  it('still accepts the old stroke format and rect shapes', async () => {
    const comment = await create({
      slideId: slide(0),
      body: '',
      anchor: { type: 'rect', rect: box, shapeRef: null },
      strokes: [
        {
          tool: 'rect',
          color: 'blue',
          points: [
            { x: 0.1, y: 0.2 },
            { x: 0.4, y: 0.3 },
          ],
        },
        {
          tool: 'highlighter',
          color: 'yellow',
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.2, y: 0.2 },
          ],
        },
      ],
    });
    expect(comment.strokes.map((stroke) => stroke.tool)).toEqual(['rect', 'highlighter']);
  });

  it.each([
    ['empty text', { text: '   ' }],
    ['a box beyond the slide', { x: 0.8, w: 0.3 }],
    ['a zero-width box', { w: 0 }],
    ['a tiny font', { fontSize: 0.001 }],
    ['a huge font', { fontSize: 0.5 }],
    ['an unknown colour', { color: 'green' }],
    ['text that is too long', { text: 'x'.repeat(2001) }],
  ])('rejects %s', async (_, overrides) => {
    const res = await post(textComment(textStroke(overrides)));
    expect(res.status).toBe(400);
  });

  it('allows only one text box, and none on replies or gaps', async () => {
    const two = await post({ ...textComment(textStroke()), strokes: [textStroke(), textStroke()] });
    expect(two.status).toBe(400);

    const root = await create(pinComment(slide(0)));
    const reply = await post({
      slideId: slide(0),
      parentId: root.id,
      body: 'Antwort',
      anchor: { type: 'slide' },
      strokes: [textStroke()],
    });
    expect(reply.status).toBe(400);

    const gap = await post({
      slideId: null,
      body: 'x',
      anchor: { type: 'gap', afterSlideId: slide(0), beforeSlideId: slide(1) },
      strokes: [textStroke()],
    });
    expect(gap.status).toBe(400);
  });

  it('leaves the text on the slide alone when the comment is edited', async () => {
    const comment = await create(textComment(textStroke()));
    const res = await ctx.request(`/api/comments/${comment.id}`, {
      method: 'PATCH',
      json: { body: 'Neuer Text' },
    });
    const updated = commentSchema.parse(await res.json());
    expect(updated.body).toBe('Neuer Text');
    expect(updated.strokes[0]).toEqual(textStroke());
  });

  it('moves and resizes the text box afterwards; the anchor follows it', async () => {
    const comment = await create(textComment(textStroke()));
    const moved = { x: 0.5, y: 0.6, w: 0.4, h: 0.2 };
    const res = await ctx.request(`/api/comments/${comment.id}`, {
      method: 'PATCH',
      json: { textBox: moved },
    });
    const updated = commentSchema.parse(await res.json());
    expect(updated.strokes[0]).toEqual(textStroke(moved));
    expect(updated.anchor).toEqual({ type: 'rect', rect: moved, shapeRef: null });
    expect(updated.body).toBe('Bitte prüfen');
  });

  it('lets only the author move a text box, onto the slide, on comments that have one', async () => {
    const comment = await create(textComment(textStroke()));
    const patch = (textBox: object, cookie?: string) =>
      ctx.request(`/api/comments/${comment.id}`, { method: 'PATCH', json: { textBox }, cookie });
    const guest = await asMember('Max Kern');
    expect((await patch({ x: 0.2, y: 0.2, w: 0.2, h: 0.1 }, guest)).status).toBe(403);
    expect((await patch({ x: 0.9, y: 0.2, w: 0.2, h: 0.1 })).status).toBe(400);
    expect((await patch({ x: 0.2, y: 0.2, w: 0, h: 0.1 })).status).toBe(400);

    const pin = await create(pinComment(slide(0)));
    const noText = await ctx.request(`/api/comments/${pin.id}`, {
      method: 'PATCH',
      json: { textBox: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 } },
    });
    expect(noText.status).toBe(400);
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
    const guest = await asMember('Lena Wolf');

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
    const guest = await asMember('Max Kern');

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

  it('lets members delete only their own comments; deleting a root removes its replies', async () => {
    const guest = await asMember('Anna Becker');
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
    const guest = await asMember('Anna Becker');
    const guestRoot = await create(pinComment(slide(1)), guest);
    expect((await ctx.request(`/api/comments/${guestRoot.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
  });

  it('returns 404 for unknown comments', async () => {
    expect((await ctx.request('/api/comments/nope', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('guests only look (BER-130)', () => {
  it('can read but not comment', async () => {
    const viewer = await joinAsGuest('Gast');
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/comments`, { cookie: viewer })).status,
    ).toBe(200);
    const res = await post(pinComment(slide(0)), viewer);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: 'forbidden', message: expect.stringMatching(/Konto in dieser Organisation/) },
    });
  });

  it('treats an old comment link like a view link', async () => {
    const token = newReviewToken();
    await ctx.deps.db
      .insert(reviewLinks)
      .values({ id: crypto.randomUUID(), deckId: deck.deckId, token, role: 'comment' });
    const info = (await (await ctx.request(`/api/invites/${token}`)).json()) as { role: string };
    expect(info.role).toBe('view');
    const guest = await joinWithToken(token, 'Alter Gast');
    const me = meResponse(await (await ctx.request('/api/me', { cookie: guest })).json());
    expect(me).toMatchObject({ kind: 'guest', role: 'view' });

    const root = await create(pinComment(slide(0)));
    expect((await post(pinComment(slide(0)), guest)).status).toBe(403);
    const patch = await ctx.request(`/api/comments/${root.id}`, {
      method: 'PATCH',
      json: { status: 'done' },
      cookie: guest,
    });
    expect(patch.status).toBe(403);
    expect(
      (await ctx.request(`/api/comments/${root.id}`, { method: 'DELETE', cookie: guest })).status,
    ).toBe(403);
    const deckRes = (await (
      await ctx.request(`/api/decks/${deck.deckId}`, { cookie: guest })
    ).json()) as { permissions: unknown };
    expect(deckRes.permissions).toEqual({ canManage: false, canComment: false });
  });
});

describe('own colour (PATCH /me)', () => {
  const patchMe = (color: string, cookie?: string) =>
    ctx.request('/api/me', { method: 'PATCH', json: { color }, cookie });
  const listed = async (cookie?: string) =>
    commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`, { cookie })).json());

  it('recolours the owner and their existing comments, not other people’s', async () => {
    const guest = await asMember('Lena');
    const own = await create(pinComment(slide(0)));
    const guestComment = await create(pinComment(slide(1)), guest);

    const res = await patchMe('violet');
    expect(res.status).toBe(200);
    expect(meResponse(await res.json()).author.color).toBe('violet');
    expect(meResponse(await (await ctx.request('/api/me')).json()).author.color).toBe('violet');

    const comments = await listed();
    expect(comments.find((c) => c.id === own.id)?.author.color).toBe('violet');
    expect(comments.find((c) => c.id === guestComment.id)?.author.color).toBe(
      guestComment.author.color,
    );
  });

  it('lets a guest pick their colour', async () => {
    const guest = await joinAsGuest('Lena');
    const res = await patchMe('yellow', guest);
    expect(meResponse(await res.json()).author.color).toBe('yellow');
    expect((await listed(guest)).length).toBe(0);
  });

  it('lets a member recolour their comments', async () => {
    const member = await asMember('Lena');
    const own = await create(pinComment(slide(0)), member);
    const res = await patchMe('yellow', member);
    expect(meResponse(await res.json()).author.color).toBe('yellow');
    expect((await listed(member)).find((c) => c.id === own.id)?.author.color).toBe('yellow');
  });

  it('rejects unknown colours', async () => {
    expect((await patchMe('green')).status).toBe(400);
  });
});

const meResponse = (json: unknown) => viewerSchema.parse((json as { viewer: unknown }).viewer);
