import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { commentSchema, deckSchema, slideSchema, type Deck } from '@slider/shared';
import { PptxError, type ParsedComment } from '@slider/pptx';
import { comments, decks, revisions, slideVersions, userIdentities, users } from '../src/db/schema';
import { externalAuthor } from '../src/authors';
import {
  MAX_IMPORT_ATTEMPTS,
  endImportAttempt,
  releaseRunningImportAttempts,
  resumeImports,
} from '../src/import/attempts';
import { deband } from '../src/import/deband';
import { backfillFileAuthors } from '../src/import/file-author-backfill';
import { findInterruptedImports, importDeck } from '../src/import/import-deck';
import { ConversionAborted, type PptxToPdf } from '../src/import/libreoffice';
import type { OpenPptx } from '../src/import/pptx';
import { toAnchor, upsertPptxComments } from '../src/import/pptx-comments';
import { silentLogger } from '../src/logger';
import {
  createReadyDeck,
  createTestContext,
  parsedSlide,
  stubPptx,
  type TestContext,
} from './helpers';
import { makePdf } from './pdf';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

// A different file each time: the same bytes again would open the deck they made.
let uploads = 0;
async function upload(
  context: TestContext,
  name = 'Deck.pptx',
  bytes = new Uint8Array([80, 75, 3, 4, ++uploads]),
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
  it('creates slides with shapes and SVG renders, counts only visible slides and re-runs without duplicating', async () => {
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
    // Cached only briefly: every revalidation runs the deck's access check again.
    expect(image.headers.get('cache-control')).toBe('private, max-age=300');
    expect(await image.text()).toContain('<svg');

    // The same revision imported again keeps its slides.
    await importDeck(
      { ...ctx.deps, openPptx: stubPptx({}, 3), log: silentLogger },
      { deckId: deck.id, revisionId: deck.currentRevisionId ?? '' },
    );
    const again = deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json());
    expect(again).toMatchObject({ import: { status: 'ready' }, slideCount: 3 });

    // Hidden slides are not counted, like the viewer.
    await ctx.cleanup();
    const slides = [
      parsedSlide(256, 0),
      { ...parsedSlide(257, 1), hidden: true },
      parsedSlide(258, 2),
    ];
    ctx = await createTestContext({ openPptx: stubPptx({ slides }) });
    expect(await upload(ctx)).toMatchObject({ import: { status: 'ready' }, slideCount: 2 });
  });

  it('reports failures in German', async () => {
    const cases: [Error, string][] = [
      [
        new PptxError('encrypted', 'parser detail'),
        'Die Datei ist passwortgeschützt. Bitte ohne Passwort speichern und erneut hochladen.',
      ],
      [new PptxError('not_pptx', 'parser detail'), 'Die Datei ist keine PowerPoint (.pptx).'],
      [
        new PptxError('corrupt', 'parser detail'),
        'Die Datei ist beschädigt und konnte nicht gelesen werden.',
      ],
      [
        new PptxError('too_many_slides', 'parser detail'),
        'Diese Präsentation hat mehr als 1024 Folien – so große Decks können wir nicht übernehmen.',
      ],
      // Unexpected errors get a generic message.
      [new Error('boom'), 'Import fehlgeschlagen. Bitte erneut versuchen.'],
    ];
    for (const [error, message] of cases) {
      await ctx?.cleanup();
      ctx = await createTestContext({ openPptx: failingWith(error) });
      const deck = await upload(ctx);
      expect(deck.import, message).toEqual({ status: 'failed', error: message });
    }
  });

  it('imports PowerPoint comments with replies and anchors; duplicate sldIds give them to the first slide', async () => {
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

    // Two slides with the same sldId: the first gets the comments, as in a sync.
    await ctx.cleanup();
    const doubled: ParsedComment[] = [
      { ...parsed[0]!, externalId: '{D}', sldId: 300, anchor: { type: 'slide' }, replies: [] },
    ];
    const slides = [parsedSlide(300, 0), parsedSlide(300, 1)];
    ctx = await createTestContext({ openPptx: stubPptx({ slides, comments: doubled }) });
    const twin = await upload(ctx);
    const twinSlides = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${twin.id}/slides`)).json());
    const [comment] = commentSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${twin.id}/comments`)).json());
    expect(comment?.slideId).toBe(twinSlides[0]?.id);
  });
});

describe('after a restart', () => {
  it('resumes first imports cut off mid-way; ready decks and demo decks stay as they are', async () => {
    ctx = await createTestContext({ openPptx: stubPptx({}, 3) });
    const cutOff = await upload(ctx);
    const finished = await upload(ctx, 'Fertig.pptx');
    // A demo deck without an original, left "running" too.
    const demo = await createReadyDeck(ctx);
    const crashed = (deckId: string) =>
      ctx!.deps.db
        .update(decks)
        .set({ importState: { status: 'running', step: 'rendering', progress: null } })
        .where(eq(decks.id, deckId));
    await crashed(cutOff.id);
    await crashed(demo.deckId);

    const jobs = await findInterruptedImports(ctx.deps.db);
    expect(jobs).toEqual([
      { deckId: cutOff.id, revisionId: cutOff.currentRevisionId, kind: 'initial' },
    ]);
    const state = async (deckId: string) =>
      (await ctx!.deps.db.select().from(decks).where(eq(decks.id, deckId)))[0]?.importState;
    expect(await state(cutOff.id)).toEqual({ status: 'queued' });
    expect(await state(finished.id)).toEqual({ status: 'ready' });

    for (const job of jobs) ctx.deps.queue.enqueue(job);
    await ctx.deps.queue.idle();
    const resumed = deckSchema.parse(await (await ctx.request(`/api/decks/${cutOff.id}`)).json());
    expect(resumed).toMatchObject({ import: { status: 'ready' }, slideCount: 3 });
    const slides = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${cutOff.id}/slides`)).json());
    expect(slides).toHaveLength(3);
  });
});

describe('imports that kill the process', () => {
  it('count each run before parsing and give up after repeated crashes instead of crash-looping', async () => {
    const seen: number[] = [];
    const parse = stubPptx({}, 2);
    let revisionId = '';
    const attempts = async () =>
      (await ctx!.deps.db.select().from(revisions).where(eq(revisions.id, revisionId)))[0]
        ?.importAttempts;
    const openPptx: OpenPptx = async (bytes) => {
      if (revisionId) seen.push((await attempts()) ?? -1);
      return parse(bytes);
    };
    ctx = await createTestContext({ openPptx });
    const deck = await upload(ctx);
    revisionId = deck.currentRevisionId ?? '';
    expect(await attempts()).toBe(0);

    const crashedRuns = async (count: number) => {
      await ctx!.deps.db
        .update(revisions)
        .set({ importAttempts: count })
        .where(eq(revisions.id, revisionId));
      await ctx!.deps.db
        .update(decks)
        .set({ importState: { status: 'running', step: 'rendering', progress: null } })
        .where(eq(decks.id, deck.id));
      for (const job of await findInterruptedImports(ctx!.deps.db)) ctx!.deps.queue.enqueue(job);
      await ctx!.deps.queue.idle();
      return deckSchema.parse(await (await ctx!.request(`/api/decks/${deck.id}`)).json());
    };

    // Fewer crashes than the limit: the import is simply tried again – and the run is on record
    // before the file is parsed, so a run the process dies in counts.
    expect((await crashedRuns(MAX_IMPORT_ATTEMPTS - 1)).import).toEqual({ status: 'ready' });
    expect(seen).toEqual([MAX_IMPORT_ATTEMPTS]);
    expect(await attempts()).toBe(0);

    // As many crashes as allowed: the next start gives up instead of dying again.
    const failed = await crashedRuns(MAX_IMPORT_ATTEMPTS);
    expect(failed.import).toEqual({
      status: 'failed',
      error: expect.stringMatching(/^Import abgebrochen – die Datei ist zu groß oder beschädigt/),
    });
    expect(seen).toHaveLength(1);
    expect(await attempts()).toBe(0);
    expect(await findInterruptedImports(ctx.deps.db)).toEqual([]);
  });
});

describe('file author backfill', () => {
  it('reads only finished imports, and marks each file before opening it', async () => {
    ctx = await createTestContext({ openPptx: stubPptx({}, 2) });
    const ready = await upload(ctx);
    const failed = await upload(ctx, 'Kaputt.pptx');
    const running = await upload(ctx, 'Läuft.pptx');
    await ctx.deps.db
      .update(decks)
      .set({ importState: { status: 'failed', error: 'zu groß' } })
      .where(eq(decks.id, failed.id));
    await ctx.deps.db
      .update(decks)
      .set({ importState: { status: 'running', step: 'rendering', progress: null } })
      .where(eq(decks.id, running.id));
    await ctx.deps.db.update(revisions).set({ fileAuthor: null });
    const author = async (revisionId: string | null | undefined) =>
      (
        await ctx!.deps.db
          .select()
          .from(revisions)
          .where(eq(revisions.id, revisionId ?? ''))
      )[0]?.fileAuthor;

    const opened: (string | null | undefined)[] = [];
    const parse = stubPptx({ author: 'Ada' }, 2);
    await backfillFileAuthors({
      ...ctx.deps,
      log: silentLogger,
      openPptx: async (bytes) => {
        // Already marked: a file the process dies in is not opened again on the next start.
        opened.push(await author(ready.currentRevisionId));
        return parse(bytes);
      },
    });
    expect(opened).toEqual(['']);
    expect(await author(ready.currentRevisionId)).toBe('Ada');
    // A failed import may be the file that crashed the process; a running one sets it itself.
    expect(await author(failed.currentRevisionId)).toBeNull();
    expect(await author(running.currentRevisionId)).toBeNull();
  });
});

describe('shutdown during rendering', () => {
  it('leaves the import to resume instead of finishing with SVG previews', async () => {
    let aborting = true;
    const libreOfficePdf: PptxToPdf = async () => {
      if (aborting) throw new ConversionAborted();
      return makePdf(3);
    };
    ctx = await createTestContext({ openPptx: stubPptx({}, 3), libreOfficePdf });
    const cut = await upload(ctx);
    expect(cut.import.status).toBe('running');
    const rows = await ctx.deps.db
      .select({ renderer: slideVersions.renderer })
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, cut.currentRevisionId ?? ''));
    expect(rows.some((row) => row.renderer === 'svg')).toBe(false);
    // A shutdown is no crash: it does not count towards giving up.
    const [revision] = await ctx.deps.db
      .select()
      .from(revisions)
      .where(eq(revisions.id, cut.currentRevisionId ?? ''));
    expect(revision?.importAttempts).toBe(0);

    // Next start: picked up again and rendered properly.
    aborting = false;
    const jobs = await findInterruptedImports(ctx.deps.db);
    expect(jobs).toEqual([{ deckId: cut.id, revisionId: cut.currentRevisionId, kind: 'initial' }]);
    for (const job of jobs) ctx.deps.queue.enqueue(job);
    await ctx.deps.queue.idle();
    const after = await ctx.deps.db
      .select({ renderer: slideVersions.renderer })
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, cut.currentRevisionId ?? ''));
    expect(after.map((row) => row.renderer)).toEqual(['libreoffice', 'libreoffice', 'libreoffice']);
  });
});

describe('shutdown in any phase of an import', () => {
  afterEach(() => resumeImports());

  it('never counts as a crash, however often it happens, and takes back no earlier one', async () => {
    let shuttingDown = true;
    const parse = stubPptx({}, 2);
    const openPptx: OpenPptx = async (bytes) => {
      if (shuttingDown) {
        // Shutdown while parsing: the attempts are released, then the database closes under us.
        await releaseRunningImportAttempts(ctx!.deps.db);
        throw new Error('database is closed');
      }
      return parse(bytes);
    };
    ctx = await createTestContext({ openPptx });
    const deck = await upload(ctx);
    const revisionId = deck.currentRevisionId ?? '';
    const attempts = async () =>
      (await ctx!.deps.db.select().from(revisions).where(eq(revisions.id, revisionId)))[0]
        ?.importAttempts;
    expect(deck.import.status).toBe('running');
    expect(await attempts()).toBe(0);

    for (let restart = 0; restart <= MAX_IMPORT_ATTEMPTS; restart++) {
      resumeImports();
      const jobs = await findInterruptedImports(ctx.deps.db);
      expect(jobs).toEqual([{ deckId: deck.id, revisionId, kind: 'initial' }]);
      for (const job of jobs) ctx.deps.queue.enqueue(job);
      await ctx.deps.queue.idle();
      expect(await attempts()).toBe(0);
    }

    resumeImports();
    shuttingDown = false;
    for (const job of await findInterruptedImports(ctx.deps.db)) ctx.deps.queue.enqueue(job);
    await ctx.deps.queue.idle();
    const done = deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json());
    expect(done.import).toEqual({ status: 'ready' });

    // A run stopped before it was counted takes back no earlier crash.
    await ctx.deps.db
      .update(revisions)
      .set({ importAttempts: 2 })
      .where(eq(revisions.id, revisionId));
    await releaseRunningImportAttempts(ctx.deps.db);
    // Shutdown before `beginImportAttempt` (e.g. the database closing under the first step).
    await endImportAttempt(ctx.deps.db, revisionId, { stopped: true });
    expect(await attempts()).toBe(2);
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

  it('is idempotent, updates text and keeps a status changed in Slider on re-import', async () => {
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

    // A status changed in Slider survives re-imports.
    await ctx.deps.db
      .update(comments)
      .set({ status: 'done' })
      .where(eq(comments.externalId, 'author1:1'));
    await upsertPptxComments(ctx.deps.db, deckId, parsed('Dann'), slides, now);
    const [row] = await ctx.deps.db
      .select()
      .from(comments)
      .where(eq(comments.externalId, 'author1:1'));
    expect(row?.status).toBe('done');
  });

  it('legacy comments converted to modern ones by PowerPoint 365 keep their row, replies and status, and stay deleted if deleted in Slider', async () => {
    ctx = await createTestContext();
    const { deckId, slideIds } = await createReadyDeck(ctx, { slideCount: 1 });
    const slides = new Map([[7, { slideId: slideIds[0] ?? '', shapes: [] }]]);
    const legacy: ParsedComment = {
      externalId: 'author1:1',
      format: 'legacy',
      sldId: 7,
      author: { name: 'Lena Wolf', initials: 'LW' },
      // Legacy times carry no time zone.
      createdAt: '2025-03-01T10:00:00.000',
      text: 'Bitte die Zahlen prüfen.',
      status: 'open',
      anchor: { type: 'point', point: { x: 0.2, y: 0.3 } },
      replies: [
        {
          externalId: 'author2:1',
          author: { name: 'Max Kern', initials: null },
          createdAt: '2025-03-01T11:00:00.000',
          text: 'Mach ich.',
        },
      ],
    };
    const other: ParsedComment = {
      ...legacy,
      externalId: 'author1:2',
      text: 'Andere Folie, anderer Text',
      replies: [],
    };
    await upsertPptxComments(ctx.deps.db, deckId, [legacy, other], slides, new Date());
    const before = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
    const root = before.find((row) => row.externalId === 'author1:1');
    // In Slider: resolved, and answered.
    await ctx.deps.db
      .update(comments)
      .set({ status: 'done' })
      .where(eq(comments.id, root?.id ?? ''));
    const answer = await ctx.request(`/api/decks/${deckId}/comments`, {
      method: 'POST',
      json: { slideId: slideIds[0], body: 'Danke!', parentId: root?.id, anchor: { type: 'slide' } },
    });
    expect(answer.status).toBe(201);

    const modern: ParsedComment = {
      ...legacy,
      externalId: '{0F6E3A2B-1C4D-4E5F-8A9B-0C1D2E3F4A5B}',
      format: 'modern',
      createdAt: '2025-03-01T09:00:00.000Z',
      replies: [
        {
          externalId: '{9A8B7C6D-5E4F-4A3B-8C2D-1E0F9A8B7C6D}',
          author: { name: 'Max Kern', initials: null },
          createdAt: '2025-03-01T10:00:00.000Z',
          text: 'Mach ich.',
        },
      ],
    };
    const counts = await upsertPptxComments(
      ctx.deps.db,
      deckId,
      [modern, other],
      slides,
      new Date(),
    );
    expect(counts).toMatchObject({ inserted: 0, removed: 0 });

    const after = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
    expect(after).toHaveLength(before.length + 1);
    const taken = after.find((row) => row.id === root?.id);
    expect(taken).toMatchObject({
      externalId: modern.externalId,
      status: 'done',
      removedInSourceAt: null,
    });
    const replies = after.filter((row) => row.parentId === root?.id);
    expect(replies.map((row) => row.body).sort()).toEqual(['Danke!', 'Mach ich.']);
    expect(replies.find((row) => row.body === 'Mach ich.')?.externalId).toBe(
      `${modern.externalId}/${modern.replies[0]?.externalId}`,
    );

    // Comments deleted in Slider stay deleted once PowerPoint 365 converted them.
    {
      const { deckId, slideIds } = await createReadyDeck(ctx, { slideCount: 1 });
      const slides = new Map([[7, { slideId: slideIds[0] ?? '', shapes: [] }]]);
      const legacy = (id: string, text: string, replies: ParsedComment['replies'] = []) =>
        ({
          externalId: id,
          format: 'legacy',
          sldId: 7,
          author: { name: 'Lena Wolf', initials: 'LW' },
          createdAt: '2025-03-01T10:00:00.000',
          text,
          status: 'open',
          anchor: { type: 'slide' },
          replies,
        }) satisfies ParsedComment;
      const reply = (id: string, text: string) => ({
        externalId: id,
        author: { name: 'Max Kern', initials: null },
        createdAt: '2025-03-01T11:00:00.000',
        text,
      });
      const gone = legacy('author1:1', 'Weg damit.', [reply('author2:1', 'Ok.')]);
      const kept = legacy('author1:2', 'Bleibt.', [reply('author2:2', 'Antwort weg.')]);
      await upsertPptxComments(ctx.deps.db, deckId, [gone, kept], slides, new Date());
      const rows = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
      const idOf = (externalId: string) => rows.find((row) => row.externalId === externalId)?.id;
      // Deleted in Slider: one whole thread, and one reply of the other.
      for (const id of [idOf('author1:1'), idOf('author1:2/author2:2')]) {
        expect((await ctx.request(`/api/comments/${id}`, { method: 'DELETE' })).status).toBe(204);
      }

      const converted = (comment: ParsedComment, guid: string): ParsedComment => ({
        ...comment,
        externalId: `{${guid}}`,
        format: 'modern',
        createdAt: '2025-03-01T09:00:00.000Z',
        replies: comment.replies.map((r, i) => ({
          ...r,
          externalId: `{${guid}-R${i}}`,
          createdAt: '2025-03-01T10:00:00.000Z',
        })),
      });
      const file = [converted(gone, 'AAAA'), converted(kept, 'BBBB')];
      for (let run = 0; run < 2; run++) {
        const counts = await upsertPptxComments(ctx.deps.db, deckId, file, slides, new Date());
        expect(counts).toMatchObject({ inserted: 0, restored: 0 });
      }

      const after = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deckId));
      expect(after.map((row) => row.externalId)).toEqual(['{BBBB}']);
      expect(after[0]?.id).toBe(idOf('author1:2'));
    }
  });

  it('recognises a linked deck’s authors by a member’s address only; an uploaded file’s stay PowerPoint authors', async () => {
    ctx = await createTestContext();
    const { db } = ctx.deps;
    const owner = (await db.select().from(users).where(eq(users.id, ctx.ownerId)))[0]!;
    const { deckId, slideIds } = await createReadyDeck(ctx, { slideCount: 1 });
    await db.update(decks).set({ source: 'nextcloud' }).where(eq(decks.id, deckId));
    const slides = new Map([[7, { slideId: slideIds[0] ?? '', shapes: [] }]]);
    const comment = (externalId: string, author: ParsedComment['author']): ParsedComment => ({
      ...emptyComment(),
      externalId,
      sldId: 7,
      author,
      text: externalId,
    });
    const authorsAfter = async (parsedComments: ParsedComment[]) => {
      await upsertPptxComments(db, deckId, parsedComments, slides, new Date());
      const rows = await db.select().from(comments).where(eq(comments.deckId, deckId));
      return (id: string) => rows.find((row) => row.externalId === id)?.author;
    };
    const oid = '6f1c2d3e-4b5a-4c6d-8e7f-901a2b3c4d5e';
    await db.insert(userIdentities).values([
      {
        provider: 'microsoft',
        subject: '9188040d-6c67-4c5b-b112-36a304b66dad:00000000-0000-0000-1a2b-3c4d5e6f7a8b',
        userId: owner.id,
      },
      // The address of a login, which any Nextcloud server may claim, is ignored.
      {
        provider: 'nextcloud',
        subject: 'https://cloud.example.com:robert',
        email: 'ceo@firma.de',
        userId: owner.id,
      },
    ]);
    const authorOf = await authorsAfter([
      // A file's `authors.xml` claiming a Google account names nobody.
      comment('forged-google', {
        name: 'Robert',
        initials: null,
        userId: owner.email,
        providerId: 'Google',
      }),
      comment('stranger', {
        name: 'Lena Wolf',
        initials: null,
        userId: 'S::lena@firma.de::00000000-1111-2222-3333-444444444444',
        providerId: 'AD',
      }),
      // The object id of the member's Microsoft login, but another address: nobody.
      comment('object-id', {
        name: 'R. Hofmann',
        initials: null,
        userId: `S::someone@elsewhere.example::${oid.toUpperCase()}`,
        providerId: 'AD',
      }),
      // The CID of a personal account matches the Microsoft login's object id: still nobody.
      comment('personal', {
        name: 'Robert',
        initials: null,
        userId: '1a2b3c4d5e6f7a8b',
        providerId: 'Windows Live',
      }),
      comment('address', {
        name: 'R. H.',
        initials: null,
        userId: `S::${owner.email.toUpperCase()}::00000000-1111-2222-3333-444444444444`,
        providerId: 'AD',
      }),
      comment('legacy', { name: owner.name, initials: null }),
      comment('namesake', {
        name: owner.name,
        initials: null,
        userId: 'S::namesake@elsewhere.example::00000000-1111-2222-3333-444444444444',
        providerId: 'AD',
      }),
      comment('claimed', {
        name: 'CEO',
        initials: null,
        userId: 'S::ceo@firma.de::00000000-1111-2222-3333-444444444444',
        providerId: 'AD',
      }),
    ]);
    expect(authorOf('address')).toMatchObject({ id: owner.id, type: 'owner' });
    expect(authorOf('forged-google')).toEqual(externalAuthor('Robert'));
    expect(authorOf('stranger')).toEqual({
      id: 'pptx:lena wolf',
      name: 'Lena Wolf',
      type: 'external',
      color: 'powerpoint',
    });
    expect(authorOf('object-id')).toEqual(externalAuthor('R. Hofmann'));
    expect(authorOf('personal')).toEqual(externalAuthor('Robert'));
    for (const id of ['legacy', 'namesake']) {
      expect(authorOf(id)).toEqual(externalAuthor(owner.name));
    }
    expect(authorOf('claimed')).toEqual(externalAuthor('CEO'));

    // An uploaded file names nobody, whatever it claims.
    await db.update(decks).set({ source: 'upload' }).where(eq(decks.id, deckId));
    const uploadedAuthorOf = await authorsAfter([
      comment('forged-email', {
        name: owner.name,
        initials: null,
        userId: `S::${owner.email}::00000000-1111-2222-3333-444444444444`,
        providerId: 'AD',
      }),
      comment('forged-id', {
        name: owner.name,
        initials: null,
        userId: `S::someone@elsewhere.example::${oid}`,
        providerId: 'AD',
      }),
    ]);
    expect(uploadedAuthorOf('forged-email')).toEqual(externalAuthor(owner.name));
    expect(uploadedAuthorOf('forged-id')).toEqual(externalAuthor(owner.name));
  });
});

describe('toAnchor', () => {
  it('attaches points to the shape below them and falls back to the slide when the shape is gone', () => {
    const shapes = [{ id: '4', name: 'Bild', bbox: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, text: '' }];
    expect(toAnchor({ type: 'point', point: { x: 0.7, y: 0.7 } }, shapes)).toEqual({
      type: 'point',
      point: { x: 0.7, y: 0.7 },
      shapeRef: {
        shapeId: '4',
        offset: { x: expect.closeTo(0.5), y: expect.closeTo(0.5) },
        name: 'Bild',
        bbox: shapes[0]!.bbox,
      },
    });
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

describe('deband', () => {
  it('smooths LibreOffice’s gradient bands, leaving lines and a lone faint edge as drawn', () => {
    const width = 400;
    const height = 3;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const set = (x: number, y: number, v: number) =>
      rgba.set([v, 40, 90, 255], (y * width + x) * 4);
    for (let x = 0; x < width; x++) {
      // Row 0: ten 20 px bands two shades apart, a white hairline through them; then flat.
      set(x, 0, x === 100 ? 255 : x < 200 ? 20 + Math.floor(x / 20) * 2 : 60);
      // Row 1: a card two shades lighter on its background – one edge, no gradient.
      set(x, 1, x < 150 ? 50 : 52);
      // Row 2: the bands without the line.
      set(x, 2, x < 200 ? 20 + Math.floor(x / 20) * 2 : 60);
    }
    const before = new Uint8ClampedArray(rgba);
    deband(rgba, width, height);
    const red = (x: number, y: number) => rgba[(y * width + x) * 4] as number;
    // Between the middles of the first and last band: no step larger than the dither's.
    for (let x = 31; x < 190; x++)
      expect(Math.abs(red(x, 2) - red(x - 1, 2))).toBeLessThanOrEqual(2);
    expect(new Set(Array.from({ length: 160 }, (_, i) => red(30 + i, 2))).size).toBeGreaterThan(15);
    // Pixels follow the ramp: about where the bands' shades say.
    expect(Math.abs(red(50, 2) - (20 + (50 - 10) / 10))).toBeLessThanOrEqual(1.5);
    expect(red(100, 0)).toBe(255);
    for (let x = 0; x < width; x++) expect(red(x, 1)).toBe(before[(width + x) * 4]);
    // Flat beyond the last band, and colour channels that did not change stay as they were.
    expect(red(300, 2)).toBe(60);
    expect(rgba[(2 * width + 50) * 4 + 1]).toBe(40);
  });
});
