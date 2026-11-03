import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commentSchema,
  viewerSchema,
  type Comment,
  type CreateCommentInput,
  type Stroke,
} from '@slider/shared';
import { commentReactions, comments, workspaceMembers } from '../src/db/schema';
import { externalAuthor } from '../src/authors';
import { MAX_JSON_BODY_BYTES } from '../src/http/validate';
import {
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

/** A member of the deck's workspace – `reviewer` comments, `viewer` (shared with) only looks. */
async function asMember(name: string, role: 'reviewer' | 'viewer' = 'reviewer'): Promise<string> {
  const person = await signedInUser(ctx, {
    name,
    email: `${name.split(' ')[0]?.toLowerCase()}@firma.de`,
  });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
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

    // Written offline, under the browser's own id, and sent again after a lost answer (also a
    // reply naming it): each saved once, the retry answered with the comment saved first.
    const id = '6f1c2b0e-3a4d-4c5e-9f60-718293a4b5c6';
    const offline = await create({ ...pinComment(slide(1), 'Offline'), id });
    expect(offline.id).toBe(id);
    expect(await create({ ...pinComment(slide(1), 'Offline, anders'), id })).toMatchObject({
      id,
      body: 'Offline',
    });
    const replyId = '0a9b8c7d-6e5f-4a3b-8c1d-2e3f4a5b6c7d';
    const reply = {
      slideId: slide(1),
      parentId: id,
      body: 'Antwort',
      anchor: { type: 'slide' as const },
      id: replyId,
    };
    await create(reply);
    expect((await create(reply)).id).toBe(replyId);
    const saved = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(saved.map((c) => c.id).sort()).toEqual([comment.id, id, replyId].sort());
    // Someone else's id is not theirs to take, nor an id that is no UUID.
    const ben = await asMember('Ben Weber');
    expect((await post({ ...pinComment(slide(1), 'Meins'), id }, ben)).status).toBe(400);
    expect((await post({ ...pinComment(slide(1), 'Kurz'), id: 'abc' })).status).toBe(400);
  });

  it('accepts drawings without text, up to the largest (50 strokes of 2000 points) over the general JSON cap', async () => {
    const small = await create({
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
    expect(small.strokes).toHaveLength(1);

    const points = Array.from({ length: 2000 }, (_, i) => ({
      x: 0.123456789012345 + i / 1e6,
      y: 0.987654321098765 - i / 1e6,
    }));
    const input: CreateCommentInput = {
      slideId: slide(0),
      body: '',
      anchor: { type: 'rect', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, shapeRef: null },
      strokes: Array.from({ length: 50 }, () => ({
        tool: 'pen' as const,
        color: 'yellow' as const,
        points,
      })),
    };
    expect(JSON.stringify(input).length).toBeGreaterThan(MAX_JSON_BODY_BYTES);
    expect((await create(input)).strokes).toHaveLength(50);
  });

  it('rejects comments with neither text nor drawing, invalid anchors and slides of another deck', async () => {
    const empty = await post(pinComment(slide(0), '   '));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: { code: 'bad_request' } });

    const offSlide = await post({
      slideId: slide(0),
      body: 'x',
      anchor: { type: 'point', point: { x: 2, y: 0 }, shapeRef: null },
    });
    expect(offSlide.status).toBe(400);

    const other = await createReadyDeck(ctx, { slideCount: 1 });
    expect((await post(pinComment(other.slideIds[0] ?? ''))).status).toBe(400);
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

describe('listing after a change', () => {
  it('viewers refetching at once share one query, yet never get the list from before a change', async () => {
    await create(pinComment(slide(0), 'Eins'));
    const list = () => ctx.request(`/api/decks/${deck.deckId}/comments`);
    const select = vi.spyOn(ctx.deps.db, 'select');
    await list();
    const single = select.mock.calls.length;
    select.mockClear();
    const results = await Promise.all(Array.from({ length: 10 }, list));
    const bodies = await Promise.all(results.map((res) => res.json()));
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(select.mock.calls.length).toBeLessThan(10 * single);
    select.mockRestore();

    // A request while a load is running, right after a change, waits for its own.
    const before = list();
    await create(pinComment(slide(0), 'Zwei'));
    const after = commentSchema.array().parse(await (await list()).json());
    expect(after.map((c) => c.body)).toEqual(['Eins', 'Zwei']);
    await before;
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

  it('stores the text box next to drawings, separate from the comment, also without one', async () => {
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

    // A sticker without a comment of its own: its text is the comment's – it counts as one.
    const sticker = await create(textComment(textStroke(), ''));
    expect(sticker.body).toBe('Logo größer\nund mittig');
    expect(sticker.strokes[0]).toEqual(textStroke());

    // The old stroke format and rect shapes are still accepted.
    const old = await create({
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
    expect(old.strokes.map((stroke) => stroke.tool)).toEqual(['rect', 'highlighter']);
  });

  it('rejects invalid text boxes, and allows only one, and none on replies or gaps', async () => {
    const invalid: Record<string, unknown>[] = [
      { text: '   ' },
      { x: 0.8, w: 0.3 },
      { w: 0 },
      { fontSize: 0.001 },
      { fontSize: 0.5 },
      { color: 'pink' },
      { text: 'x'.repeat(2001) },
    ];
    for (const overrides of invalid) {
      expect(
        (await post(textComment(textStroke(overrides)))).status,
        JSON.stringify(overrides),
      ).toBe(400);
    }

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

  it('keeps the text box on edits of the comment; only its author moves it, onto the slide', async () => {
    const comment = await create(textComment(textStroke()));
    const edited = commentSchema.parse(
      await (
        await ctx.request(`/api/comments/${comment.id}`, {
          method: 'PATCH',
          json: { body: 'Neuer Text' },
        })
      ).json(),
    );
    expect(edited.body).toBe('Neuer Text');
    expect(edited.strokes[0]).toEqual(textStroke());

    // Moved and resized afterwards: the anchor follows it.
    const patch = (textBox: object, cookie?: string) =>
      ctx.request(`/api/comments/${comment.id}`, { method: 'PATCH', json: { textBox }, cookie });
    const moved = { x: 0.5, y: 0.6, w: 0.4, h: 0.2 };
    const updated = commentSchema.parse(await (await patch(moved)).json());
    expect(updated.strokes[0]).toEqual(textStroke(moved));
    expect(updated.anchor).toEqual({ type: 'rect', rect: moved, shapeRef: null });
    expect(updated.body).toBe('Neuer Text');

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

describe('moving a box afterwards', () => {
  const box = (rect: object) => ({ type: 'rect', rect, shapeRef: null });
  const boxComment = () =>
    create({
      slideId: slide(0),
      body: 'Hier',
      anchor: box({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
    } as CreateCommentInput);
  const patch = (id: string, anchor: object, cookie?: string) =>
    ctx.request(`/api/comments/${id}`, { method: 'PATCH', json: { anchor }, cookie });

  it('moves and resizes the author’s box – only for the author, on the slide, and only boxes', async () => {
    const comment = await boxComment();
    const res = await patch(comment.id, box({ x: 0.5, y: 0.4, w: 0.3, h: 0.1 }));
    expect(res.status).toBe(200);
    expect(commentSchema.parse(await res.json()).anchor).toEqual(
      box({ x: 0.5, y: 0.4, w: 0.3, h: 0.1 }),
    );

    // One comment on several boxes (⇧-click in box mode): all are stored, moving the first keeps
    // the others; more than a comment may mark are refused.
    const more = [{ rect: { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }, shapeRef: null }];
    const several = await create({
      slideId: slide(0),
      body: 'Alle drei',
      anchor: { ...box({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), more },
    } as CreateCommentInput);
    expect(several.anchor).toMatchObject({ type: 'rect', more });
    const movedFirst = await patch(several.id, box({ x: 0.3, y: 0.1, w: 0.2, h: 0.2 }));
    expect(commentSchema.parse(await movedFirst.json()).anchor).toEqual({
      ...box({ x: 0.3, y: 0.1, w: 0.2, h: 0.2 }),
      more,
    });
    const tooMany = await post({
      slideId: slide(0),
      body: 'x',
      anchor: { ...box({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), more: Array(50).fill(more[0]) },
    } as CreateCommentInput);
    expect(tooMany.status).toBe(400);

    const member = await asMember('Max Kern');
    expect((await patch(comment.id, box({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }), member)).status).toBe(
      403,
    );
    expect((await patch(comment.id, box({ x: 0.9, y: 0.2, w: 0.2, h: 0.2 }))).status).toBe(400);
    const pin = await create(pinComment(slide(0)));
    expect((await patch(pin.id, box({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }))).status).toBe(400);
    // A box that is the text on the slide moves with the text box instead.
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const text = await create({
      slideId: slide(0),
      body: '',
      anchor: box(rect),
      strokes: [{ tool: 'text', color: 'red', ...rect, text: 'Logo', fontSize: 0.04 }],
    } as CreateCommentInput);
    expect((await patch(text.id, box({ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }))).status).toBe(400);
  });
});

describe('replies', () => {
  it('inherit the parent’s slide, cannot be nested, use a slide anchor and a comment of the deck', async () => {
    const root = await create(pinComment(slide(1)));
    const reply = await create({
      slideId: null,
      parentId: root.id,
      body: 'Erledigt.',
      anchor: { type: 'slide' },
    });
    expect(reply).toMatchObject({ parentId: root.id, slideId: slide(1) });
    const nested = await post({
      slideId: null,
      parentId: reply.id,
      body: 'B',
      anchor: { type: 'slide' },
    });
    expect(nested.status).toBe(400);

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

  it('lets only the author edit the text, never emptied but on drawings, never on PowerPoint comments', async () => {
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

    // Without recording or image, the text is the comment: never emptied.
    for (const body of ['', '   ']) {
      const res = await ctx.request(`/api/comments/${root.id}`, {
        method: 'PATCH',
        json: { body },
      });
      expect(res.status).toBe(400);
    }
    const [row] = await ctx.deps.db.select().from(comments);
    expect(row?.body).toBe('Präziser');

    // A drawing stays the comment’s content.
    const drawing = await create({
      slideId: slide(0),
      body: 'Hier',
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
    const res = await ctx.request(`/api/comments/${drawing.id}`, {
      method: 'PATCH',
      json: { body: '' },
    });
    expect(res.status).toBe(200);
    expect(commentSchema.parse(await res.json())).toMatchObject({ body: '', strokes: [{}] });

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
    const pptx = await ctx.request(`/api/comments/${id}`, {
      method: 'PATCH',
      json: { body: 'Neu' },
    });
    expect(pptx.status).toBe(403);
    const resolve = await ctx.request(`/api/comments/${id}`, {
      method: 'PATCH',
      json: { status: 'done' },
    });
    expect(resolve.status).toBe(200);
  });

  it('lets members delete only their own comments, the owner any; deleting a root removes its replies', async () => {
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

    const another = await create(pinComment(slide(1)), guest);
    expect((await ctx.request(`/api/comments/${another.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await ctx.request('/api/comments/nope', { method: 'DELETE' })).status).toBe(404);
  });

  it('can delete only the comment and leave its drawing on the slide', async () => {
    const pen = {
      tool: 'pen',
      color: 'yellow',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
    } satisfies Stroke;
    const root = await create({
      slideId: slide(0),
      body: 'Pfeil hier',
      anchor: { type: 'rect', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, shapeRef: null },
      strokes: [pen],
    });
    await ctx.request(`/api/comments/${root.id}`, { method: 'PATCH', json: { status: 'done' } });
    await create({ slideId: null, parentId: root.id, body: 'Antwort', anchor: { type: 'slide' } });
    const pin = await create(pinComment(slide(1)));

    const del = (id: string) =>
      ctx.request(`/api/comments/${id}?keep=drawing`, { method: 'DELETE' });
    expect((await del(pin.id)).status).toBe(400);
    expect((await del(root.id)).status).toBe(204);

    const left = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json());
    expect(left.map((c) => c.id).sort()).toEqual([root.id, pin.id].sort());
    expect(left.find((c) => c.id === root.id)).toMatchObject({
      body: '',
      strokes: [pen],
      status: 'open',
      media: null,
    });
  });

  it('can take only the drawing off the slide; the comment stays as a pin', async () => {
    const pen = {
      tool: 'pen',
      color: 'yellow',
      points: [
        { x: 0.1, y: 0.15 },
        { x: 0.2, y: 0.2 },
      ],
    } satisfies Stroke;
    const rect = { x: 0.1, y: 0.15, w: 0.1, h: 0.05 };
    const root = await create({
      slideId: slide(0),
      body: 'Pfeil hier',
      anchor: { type: 'rect', rect, shapeRef: null },
      strokes: [pen],
    });
    const bare = await create({
      slideId: slide(0),
      body: '',
      anchor: { type: 'rect', rect, shapeRef: null },
      strokes: [pen],
    });
    const pin = await create(pinComment(slide(1)));
    const patch = (id: string, removeMarks: object, cookie?: string) =>
      ctx.request(`/api/comments/${id}`, { method: 'PATCH', json: { removeMarks }, cookie });

    const member = await asMember('Mia');
    expect((await patch(root.id, { pin: { x: 0.1, y: 0.15 } }, member)).status).toBe(403);
    // Nothing on the slide, or nothing would be left: delete it instead.
    expect((await patch(pin.id, { pin: null })).status).toBe(400);
    expect((await patch(bare.id, { pin: null })).status).toBe(400);

    const res = await patch(root.id, { pin: { x: 0.1, y: 0.15 } });
    expect(res.status).toBe(200);
    expect(commentSchema.parse(await res.json())).toMatchObject({
      body: 'Pfeil hier',
      strokes: [],
      anchor: { type: 'point', point: { x: 0.1, y: 0.15 }, shapeRef: null },
    });
  });

  it('draws on a bare freehand drawing: its strokes make one drawing', async () => {
    const pen = (x: number) =>
      ({
        tool: 'pen',
        color: 'yellow',
        points: [
          { x, y: 0.1 },
          { x: x + 0.1, y: 0.2 },
        ],
      }) satisfies Stroke;
    const arrow = { ...pen(0.5), tool: 'arrow' } satisfies Stroke;
    const anchor = (w: number) =>
      ({ type: 'rect', rect: { x: 0.1, y: 0.1, w, h: 0.1 }, shapeRef: null }) as const;
    const bare = await create({
      slideId: slide(0),
      body: '',
      anchor: anchor(0.1),
      strokes: [pen(0.1)],
    });
    const commented = await create({
      slideId: slide(0),
      body: 'Hier',
      anchor: anchor(0.1),
      strokes: [pen(0.1)],
    });
    const arrowed = await create({
      slideId: slide(0),
      body: '',
      anchor: anchor(0.1),
      strokes: [arrow],
    });
    const patch = (id: string, strokes: Stroke[], cookie?: string) =>
      ctx.request(`/api/comments/${id}`, {
        method: 'PATCH',
        json: { addStrokes: { strokes, rect: anchor(0.3).rect } },
        cookie,
      });

    expect((await patch(bare.id, [pen(0.3)], await asMember('Mia'))).status).toBe(403);
    // Commented on, or arrows and markers: they stay as they are.
    expect((await patch(commented.id, [pen(0.3)])).status).toBe(400);
    expect((await patch(arrowed.id, [pen(0.3)])).status).toBe(400);
    expect((await patch(bare.id, [arrow])).status).toBe(400);

    const res = await patch(bare.id, [pen(0.3)]);
    expect(res.status).toBe(200);
    expect(commentSchema.parse(await res.json())).toMatchObject({
      body: '',
      strokes: [pen(0.1), pen(0.3)],
      anchor: anchor(0.3),
    });
  });
});

describe('viewers only look', () => {
  it('can read but not comment, resolve or delete', async () => {
    const viewer = await asMember('Gesa Teil', 'viewer');
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/comments`, { cookie: viewer })).status,
    ).toBe(200);
    const res = await post(pinComment(slide(0)), viewer);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: 'forbidden', message: expect.stringMatching(/Betrachter/) },
    });

    const root = await create(pinComment(slide(0)));
    const patch = await ctx.request(`/api/comments/${root.id}`, {
      method: 'PATCH',
      json: { status: 'done' },
      cookie: viewer,
    });
    expect(patch.status).toBe(403);
    expect(
      (await ctx.request(`/api/comments/${root.id}`, { method: 'DELETE', cookie: viewer })).status,
    ).toBe(403);
    const deckRes = (await (
      await ctx.request(`/api/decks/${deck.deckId}`, { cookie: viewer })
    ).json()) as { permissions: unknown };
    expect(deckRes.permissions).toEqual({ canManage: false, canComment: false });
  });
});

describe('reactions (👍 / 👎 / egal)', () => {
  const react = (commentId: string, kind: string | null, cookie?: string) =>
    ctx.request(`/api/comments/${commentId}/reaction`, { method: 'PUT', json: { kind }, cookie });
  const listed = async (commentId: string) =>
    commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`)).json())
      .find((c) => c.id === commentId);

  it('keeps one reaction per person: reacting again changes it, null takes it back; on replies too', async () => {
    const root = await create(pinComment(slide(0)));
    const ada = await asMember('Ada Lovelace');
    expect((await react(root.id, 'up')).status).toBe(200);
    const res = await react(root.id, 'neutral', ada);
    expect(res.status).toBe(200);
    expect(commentSchema.parse(await res.json()).reactions).toMatchObject([
      { kind: 'up', author: { name: 'Robert Hofmann' } },
      { kind: 'neutral', author: { name: 'Ada Lovelace' } },
    ]);

    await react(root.id, 'down');
    expect((await listed(root.id))?.reactions?.map((r) => r.kind).sort()).toEqual([
      'down',
      'neutral',
    ]);
    await react(root.id, null, ada);
    expect((await listed(root.id))?.reactions).toMatchObject([
      { kind: 'down', author: { name: 'Robert Hofmann' } },
    ]);

    // On a reply too, and it goes with the comment.
    const reply = await create({
      ...pinComment(slide(0), 'Ja'),
      parentId: root.id,
      anchor: { type: 'slide' },
    });
    await react(reply.id, 'up');
    expect((await listed(reply.id))?.reactions).toHaveLength(1);
    await ctx.request(`/api/comments/${root.id}`, { method: 'DELETE' });
    expect(await ctx.deps.db.select().from(commentReactions)).toEqual([]);
  });

  it('refuses unknown kinds, unknown comments and viewers', async () => {
    const root = await create(pinComment(slide(0)));
    expect((await react(root.id, 'love')).status).toBe(400);
    expect((await react('nope', 'up')).status).toBe(404);
    const viewer = await asMember('Gesa Teil', 'viewer');
    expect((await react(root.id, 'up', viewer)).status).toBe(403);
  });
});

describe('own colour (PATCH /me)', () => {
  const patchMe = (color: string, cookie?: string) =>
    ctx.request('/api/me', { method: 'PATCH', json: { color }, cookie });
  const listed = async (cookie?: string) =>
    commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/comments`, { cookie })).json());

  it('recolours the person and their existing comments, not other people’s, in known colours only', async () => {
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

    const byGuest = await patchMe('yellow', guest);
    expect(meResponse(await byGuest.json()).author.color).toBe('yellow');
    expect((await listed(guest)).find((c) => c.id === guestComment.id)?.author.color).toBe(
      'yellow',
    );
    expect((await patchMe('pink')).status).toBe(400);
  });
});

const meResponse = (json: unknown) => viewerSchema.parse((json as { viewer: unknown }).viewer);
