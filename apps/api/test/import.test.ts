import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { commentSchema, deckSchema, slideSchema, type Deck } from '@slider/shared';
import { PptxError, type ParsedComment } from '@slider/pptx';
import { comments } from '../src/db/schema';
import { importDeck } from '../src/import/import-deck';
import type { OpenPptx } from '../src/import/pptx';
import { toAnchor, upsertPptxComments } from '../src/import/pptx-comments';
import { silentLogger } from '../src/logger';
import { createReadyDeck, createTestContext, stubPptx, type TestContext } from './helpers';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

async function upload(
  context: TestContext,
  name = 'Deck.pptx',
  bytes = new Uint8Array([80, 75, 3, 4]),
): Promise<Deck> {
  const form = new FormData();
  form.append('file', new File([bytes], name));
  const res = await context.request('/api/decks/upload', { method: 'POST', body: form });
  expect(res.status).toBe(201);
  const deck = deckSchema.parse(await res.json());
  await context.deps.queue.idle();
  return deckSchema.parse(await (await context.request(`/api/decks/${deck.id}`)).json());
}

const failingWith =
  (error: Error): OpenPptx =>
  async () => {
    throw error;
  };

describe('import pipeline', () => {
  it('creates slides with shapes and stores an SVG render per slide', async () => {
    ctx = await createTestContext({ openPptx: stubPptx({}, 3) });
    const deck = await upload(ctx);
    expect(deck).toMatchObject({ import: { status: 'ready' }, slideCount: 3 });

    const list = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.id}/slides`)).json());
    expect(list.map((slide) => slide.title)).toEqual(['Folie 1', 'Folie 2', 'Folie 3']);
    expect(list[0]?.shapes).toEqual([
      { id: '2', name: 'Titel 1', bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }, text: 'Folie 1' },
    ]);
    expect(list[0]?.aspectRatio).toBeCloseTo(16 / 9);

    const image = await ctx.request(list[0]?.imageUrl ?? '');
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/svg+xml');
    expect(image.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(await image.text()).toContain('<svg');
  });

  it.each([
    [
      'encrypted',
      'Die Datei ist passwortgeschützt. Bitte ohne Passwort speichern und erneut hochladen.',
    ],
    ['not_pptx', 'Die Datei ist keine PowerPoint (.pptx).'],
    ['corrupt', 'Die Datei ist beschädigt und konnte nicht gelesen werden.'],
  ] as const)('reports %s files in German', async (code, message) => {
    ctx = await createTestContext({ openPptx: failingWith(new PptxError(code, 'parser detail')) });
    const deck = await upload(ctx);
    expect(deck.import).toEqual({ status: 'failed', error: message });
  });

  it('fails with a generic message on unexpected errors', async () => {
    ctx = await createTestContext({ openPptx: failingWith(new Error('boom')) });
    const deck = await upload(ctx);
    expect(deck.import).toEqual({
      status: 'failed',
      error: 'Import fehlgeschlagen. Bitte erneut versuchen.',
    });
  });

  it('can be re-run for the same revision without duplicating slides', async () => {
    ctx = await createTestContext({ openPptx: stubPptx({}, 2) });
    const deck = await upload(ctx);
    const [revision] = await ctx.deps.db.query.revisions.findMany({
      where: (r, { eq: is }) => is(r.deckId, deck.id),
    });
    await importDeck(
      { ...ctx.deps, openPptx: stubPptx({}, 2), log: silentLogger },
      { deckId: deck.id, revisionId: revision?.id ?? '' },
    );
    const again = deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json());
    expect(again).toMatchObject({ import: { status: 'ready' }, slideCount: 2 });
  });

  it('imports PowerPoint comments with replies and maps anchors', async () => {
    const parsed: ParsedComment[] = [
      {
        externalId: '{A}',
        format: 'modern',
        sldId: 256,
        author: { name: 'Anna Becker', initials: 'AB' },
        createdAt: '2026-10-03T09:41:00Z',
        text: 'Bildquelle fehlt.',
        status: 'open',
        anchor: { type: 'shape', shapeId: '2' },
        replies: [
          {
            externalId: '{B}',
            author: { name: 'Max Kern', initials: null },
            createdAt: null,
            text: 'Stimmt.',
          },
        ],
      },
    ];
    ctx = await createTestContext({ openPptx: stubPptx({ comments: parsed }, 2) });
    const deck = await upload(ctx);
    expect(deck.openCommentCount).toBe(1);

    const list = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.id}/comments`)).json());
    const [root, reply] = list;
    expect(root).toMatchObject({
      source: 'pptx',
      body: 'Bildquelle fehlt.',
      createdAt: '2026-10-03T09:41:00.000Z',
      author: { name: 'Anna Becker', type: 'external' },
      anchor: {
        type: 'rect',
        rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
        shapeRef: { shapeId: '2', offset: { x: 0.5, y: 0.5 } },
      },
    });
    expect(reply).toMatchObject({
      parentId: root?.id,
      slideId: root?.slideId,
      author: { name: 'Max Kern' },
    });
  });
});

describe('upsertPptxComments', () => {
  const parsed = (text: string): ParsedComment[] => [
    {
      externalId: 'author1:1',
      format: 'legacy',
      sldId: 7,
      author: { name: 'Lena Wolf', initials: 'LW' },
      createdAt: null,
      text,
      status: 'open',
      anchor: { type: 'point', point: { x: 0.2, y: 0.3 } },
      replies: [],
    },
    {
      externalId: '{guid}',
      format: 'modern',
      sldId: 7,
      author: { name: 'Max Kern', initials: null },
      createdAt: null,
      text: 'Modern',
      status: 'done',
      anchor: { type: 'slide' },
      replies: [
        {
          externalId: '{reply}',
          author: { name: 'Lena Wolf', initials: null },
          createdAt: null,
          text: 'Ok',
        },
      ],
    },
    { ...emptyComment(), externalId: 'orphan', sldId: 999 },
  ];

  it('is idempotent and updates text on re-import', async () => {
    ctx = await createTestContext();
    const { deckId, slideIds } = await createReadyDeck(ctx, { slideCount: 1 });
    const slides = new Map([[7, { slideId: slideIds[0] ?? '', shapes: [] }]]);
    const now = new Date();

    expect(await upsertPptxComments(ctx.deps.db, deckId, parsed('Erst'), slides, now)).toEqual({
      inserted: 3,
      updated: 0,
      removed: 0,
      restored: 0,
      total: 3,
    });
    expect(await upsertPptxComments(ctx.deps.db, deckId, parsed('Dann'), slides, now)).toEqual({
      inserted: 0,
      updated: 1,
      removed: 0,
      restored: 0,
      total: 3,
    });

    const rows = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.externalId === 'author1:1')?.body).toBe('Dann');
    const reply = rows.find((row) => row.externalId === '{guid}/{reply}');
    expect(reply?.parentId).toBe(rows.find((row) => row.externalId === '{guid}')?.id);
  });

  it('keeps a status changed in Slider across re-imports', async () => {
    ctx = await createTestContext();
    const { deckId, slideIds } = await createReadyDeck(ctx, { slideCount: 1 });
    const slides = new Map([[7, { slideId: slideIds[0] ?? '', shapes: [] }]]);
    await upsertPptxComments(ctx.deps.db, deckId, parsed('x'), slides, new Date());
    await ctx.deps.db
      .update(comments)
      .set({ status: 'done' })
      .where(eq(comments.externalId, 'author1:1'));
    await upsertPptxComments(ctx.deps.db, deckId, parsed('x'), slides, new Date());

    const [row] = await ctx.deps.db
      .select()
      .from(comments)
      .where(eq(comments.externalId, 'author1:1'));
    expect(row?.status).toBe('done');
  });
});

describe('toAnchor', () => {
  const shapes = [{ id: '4', name: 'Bild', bbox: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, text: '' }];

  it('attaches points to the shape below them', () => {
    expect(toAnchor({ type: 'point', point: { x: 0.7, y: 0.7 } }, shapes)).toEqual({
      type: 'point',
      point: { x: 0.7, y: 0.7 },
      shapeRef: { shapeId: '4', offset: { x: expect.closeTo(0.5), y: expect.closeTo(0.5) } },
    });
  });

  it('falls back to the slide when the shape is gone', () => {
    expect(toAnchor({ type: 'shape', shapeId: '99' }, shapes)).toEqual({ type: 'slide' });
  });
});

const SAMPLE = fileURLToPath(
  new URL('../../../packages/pptx/samples/slider-demo.pptx', import.meta.url),
);

describe.skipIf(!existsSync(SAMPLE))('real PPTX import', () => {
  it('imports the sample deck end to end', async () => {
    const { openPptx } = await import('@slider/pptx');
    ctx = await createTestContext({ openPptx });
    const deck = await upload(ctx, 'slider-demo.pptx', new Uint8Array(await readFile(SAMPLE)));

    expect(deck.import).toEqual({ status: 'ready' });
    expect(deck.slideCount).toBeGreaterThan(0);
    const list = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.id}/slides`)).json());
    const svg = await (await ctx.request(list[0]?.imageUrl ?? '')).text();
    expect(svg).toContain('<svg');
    const imported = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.id}/comments`)).json());
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.every((comment) => comment.source === 'pptx')).toBe(true);
  });
});

function emptyComment(): ParsedComment {
  return {
    externalId: '',
    format: 'legacy',
    sldId: 0,
    author: { name: '', initials: null },
    createdAt: null,
    text: '',
    status: 'open',
    anchor: { type: 'slide' },
    replies: [],
  };
}
