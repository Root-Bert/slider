import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckSchema, deckStatusSchema, slideSchema, type Deck } from '@slider/shared';
import { decks, revisions, slideVersions, workspaceMembers } from '../src/db/schema';
import { MAX_IMPORT_ATTEMPTS } from '../src/import/attempts';
import { ConversionAborted, type PptxToPdf } from '../src/import/libreoffice';
import { findRerenderCandidates, rerenderJob, rerenderRevision } from '../src/import/rerender';
import { silentLogger } from '../src/logger';
import { blobKeys } from '../src/storage/blob-storage';
import {
  createReadyDeck,
  createTestContext,
  parsedSlide,
  signedInUser,
  stubPptx,
  type TestContext,
} from './helpers';
import { makePdf } from './pdf';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** A fake LibreOffice that can be switched between "not working" and "n pages". */
function switchableLibreOffice() {
  const state = { pages: 0 };
  const convert: PptxToPdf = async () => {
    if (state.pages === 0) throw new Error('soffice not working yet');
    return makePdf(state.pages);
  };
  return { state, convert };
}

async function upload(context: TestContext): Promise<Deck> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([80, 75, 3, 4])], 'Deck.pptx'));
  const res = await context.request('/api/decks/upload', { method: 'POST', body: form });
  const deck = deckSchema.parse(await res.json());
  await context.deps.queue.idle();
  return deck;
}

const versionsOf = (context: TestContext, deck: Deck) =>
  context.deps.db
    .select()
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, deck.currentRevisionId ?? ''))
    .orderBy(asc(slideVersions.position));

async function importedDeck(context: TestContext): Promise<Deck> {
  const created = await upload(context);
  return deckSchema.parse(await (await context.request(`/api/decks/${created.id}`)).json());
}

/** An imported deck that pretends to come from a OneDrive link. */
async function linkedDeck(context: TestContext): Promise<Deck> {
  const deck = await importedDeck(context);
  await context.deps.db
    .update(decks)
    .set({ source: 'onedrive', sourceRef: 'drives/d1/items/i1' })
    .where(eq(decks.id, deck.id));
  return deck;
}

/** Pretends the deck was imported before `renderer` existed. */
async function makeLegacy(context: TestContext, deck: Deck) {
  await context.deps.db
    .update(slideVersions)
    .set({ renderer: null })
    .where(eq(slideVersions.revisionId, deck.currentRevisionId ?? ''));
}

const importDeps = (context: TestContext, libreOfficePdf: PptxToPdf) => ({
  db: context.deps.db,
  storage: context.deps.storage,
  openPptx: stubPptx({
    slides: [parsedSlide(256, 0), { ...parsedSlide(257, 1), hidden: true }, parsedSlide(258, 2)],
  }),
  clock: context.clock,
  log: silentLogger,
  libreOfficePdf,
});

describe('rerenderRevision (BER-94)', () => {
  const threeSlides = () =>
    stubPptx({
      slides: [parsedSlide(256, 0), { ...parsedSlide(257, 1), hidden: true }, parsedSlide(258, 2)],
    });

  it('replaces the SVG previews of an old deck with LibreOffice pages and deletes the old files', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ openPptx: threeSlides(), libreOfficePdf: libreOffice.convert });
    const deck = await importedDeck(ctx);
    // LibreOffice failed at import time: SVG everywhere, marked as tried.
    const before = await versionsOf(ctx, deck);
    expect(before.map((row) => row.renderer)).toEqual(['svg', 'svg', 'svg']);
    expect(before.every((row) => row.imageKey.endsWith('.svg'))).toBe(true);
    await makeLegacy(ctx, deck);

    libreOffice.state.pages = 2;
    const outcome = await rerenderRevision(importDeps(ctx, libreOffice.convert), deck.id);
    expect(outcome).toMatchObject({ status: 'rendered', renderer: 'libreoffice', replaced: 2 });

    const after = await versionsOf(ctx, deck);
    expect(after.map((row) => row.renderer)).toEqual(['libreoffice', 'svg', 'libreoffice']);
    expect(after[0]?.imageKey.endsWith('.webp')).toBe(true);
    expect(after[0]?.thumbnailKey).not.toBe(after[0]?.imageKey);
    // The hidden slide has no PDF page and keeps its preview; matching hashes are untouched.
    expect(after[1]?.imageKey).toBe(before[1]?.imageKey);
    expect(after.map((row) => row.renderHash)).toEqual(before.map((row) => row.renderHash));

    const { storage } = ctx.deps;
    expect(await storage.get(before[0]?.imageKey ?? '')).toBeNull();
    expect(await storage.get(before[1]?.imageKey ?? '')).not.toBeNull();
    expect(await storage.get(after[0]?.imageKey ?? '')).not.toBeNull();
    expect(await storage.get(after[2]?.thumbnailKey ?? '')).not.toBeNull();

    const list = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.id}/slides`)).json());
    const image = await ctx.request(list[0]?.imageUrl ?? '');
    expect(image.headers.get('content-type')).toBe('image/webp');
  });

  it('keeps the old images when every renderer fails, and marks the revision as tried', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ openPptx: threeSlides(), libreOfficePdf: libreOffice.convert });
    const deck = await importedDeck(ctx);
    await makeLegacy(ctx, deck);
    const before = await versionsOf(ctx, deck);

    libreOffice.state.pages = 5; // does not match the 2 visible slides
    const outcome = await rerenderRevision(importDeps(ctx, libreOffice.convert), deck.id);
    expect(outcome.status).toBe('unchanged');
    const after = await versionsOf(ctx, deck);
    expect(after.map((row) => row.imageKey)).toEqual(before.map((row) => row.imageKey));
    expect(after.map((row) => row.renderer)).toEqual(['svg', 'svg', 'svg']);
    for (const row of after) expect(await ctx.deps.storage.get(row.imageKey)).not.toBeNull();
  });

  it('a re-render cut off by shutdown stays untried, so the next start renders it again', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ openPptx: threeSlides(), libreOfficePdf: libreOffice.convert });
    const deck = await importedDeck(ctx);
    await makeLegacy(ctx, deck);
    const aborting: PptxToPdf = async () => {
      throw new ConversionAborted();
    };
    await rerenderJob(importDeps(ctx, aborting), {
      deckId: deck.id,
      revisionId: deck.currentRevisionId ?? '',
      kind: 'rerender',
    });
    expect((await versionsOf(ctx, deck)).map((row) => row.renderer)).toEqual([null, null, null]);
    expect(
      await findRerenderCandidates(ctx.deps.db, { libreOfficePdf: libreOffice.convert }),
    ).toEqual([{ deckId: deck.id, revisionId: deck.currentRevisionId, kind: 'rerender' }]);
  });

  it('counts each run before rendering and gives up a deck whose rendering kills the process', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ openPptx: threeSlides(), libreOfficePdf: libreOffice.convert });
    const deck = await importedDeck(ctx);
    await makeLegacy(ctx, deck);
    const revisionId = deck.currentRevisionId ?? '';
    const attempts = async () =>
      (await ctx!.deps.db.select().from(revisions).where(eq(revisions.id, revisionId)))[0]
        ?.importAttempts;
    const job = { deckId: deck.id, revisionId, kind: 'rerender' as const };
    const seen: (number | undefined)[] = [];
    const counting: PptxToPdf = async () => {
      seen.push(await attempts());
      // A shutdown here takes the run back; a process that dies here leaves it counted.
      throw new ConversionAborted();
    };

    // The run is on record while it renders, so a run the process dies in counts.
    await rerenderJob(importDeps(ctx, counting), job);
    expect(seen).toEqual([1]);

    // As many crashed runs as allowed: the next start's backfill gives up instead of dying again.
    await ctx.deps.db
      .update(revisions)
      .set({ importAttempts: MAX_IMPORT_ATTEMPTS })
      .where(eq(revisions.id, revisionId));
    await rerenderJob(importDeps(ctx, counting), job);
    expect(seen).toHaveLength(1);
    expect((await versionsOf(ctx, deck)).map((row) => row.renderer)).toEqual(['svg', 'svg', 'svg']);
    expect(await attempts()).toBe(0);
    expect(
      await findRerenderCandidates(ctx.deps.db, { libreOfficePdf: libreOffice.convert }),
    ).toEqual([]);
  });

  it('removes slide images a re-render cut off before its swap left behind', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ openPptx: threeSlides(), libreOfficePdf: libreOffice.convert });
    const deck = await importedDeck(ctx);
    await makeLegacy(ctx, deck);
    const revisionId = deck.currentRevisionId ?? '';
    const stray = blobKeys.slideRender(deck.id, revisionId, 'webp');
    await ctx.deps.storage.put(stray, new Uint8Array([1, 2, 3]));

    libreOffice.state.pages = 2;
    const outcome = await rerenderRevision(importDeps(ctx, libreOffice.convert), deck.id);
    expect(outcome.status).toBe('rendered');
    expect(await ctx.deps.storage.get(stray)).toBeNull();
    const rows = await versionsOf(ctx, deck);
    const live = new Set(rows.flatMap((row) => [row.imageKey, row.thumbnailKey]));
    expect(
      new Set(await ctx.deps.storage.list(blobKeys.slideRenderPrefix(deck.id, revisionId))),
    ).toEqual(live);
  });

  it('skips revisions whose file is gone or whose slides no longer match', async () => {
    const libreOffice = switchableLibreOffice();
    libreOffice.state.pages = 2;
    ctx = await createTestContext({ libreOfficePdf: libreOffice.convert });
    // Demo-style deck without an original file.
    const fixture = await createReadyDeck(ctx);
    const deps = importDeps(ctx, libreOffice.convert);
    expect(await rerenderRevision(deps, fixture.deckId)).toMatchObject({
      status: 'skipped',
      reason: 'no original file',
    });
    const deck = await importedDeck(ctx); // 2 slides (default stub)
    expect(await rerenderRevision(deps, deck.id)).toMatchObject({
      status: 'skipped',
      reason: 'slides of the file do not match the revision',
    });
  });
});

describe('findRerenderCandidates', () => {
  it('finds current revisions never tried with a better renderer, once', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ libreOfficePdf: libreOffice.convert });
    const deck = await importedDeck(ctx);
    const renderers = { libreOfficePdf: libreOffice.convert };
    expect(await findRerenderCandidates(ctx.deps.db, renderers)).toEqual([]);

    await makeLegacy(ctx, deck);
    expect(await findRerenderCandidates(ctx.deps.db, renderers)).toEqual([
      { deckId: deck.id, revisionId: deck.currentRevisionId, kind: 'rerender' },
    ]);
    // Nothing better installed: nothing to do (the rows stay `null` for later).
    expect(await findRerenderCandidates(ctx.deps.db, {})).toEqual([]);
    // Office renders linked decks only: an upload is no candidate for it.
    const officePdf = async () => makePdf(1);
    expect(await findRerenderCandidates(ctx.deps.db, { officePdf })).toEqual([]);
    // A deck that already has a better picture somewhere is not re-rendered at start-up.
    const [first] = await versionsOf(ctx, deck);
    await ctx.deps.db
      .update(slideVersions)
      .set({ renderer: 'libreoffice' })
      .where(eq(slideVersions.id, first?.id ?? ''));
    expect(await findRerenderCandidates(ctx.deps.db, renderers)).toEqual([]);
    await makeLegacy(ctx, deck);
    await ctx.deps.db
      .update(decks)
      .set({ source: 'onedrive', sourceRef: 'drives/d1/items/i1' })
      .where(eq(decks.id, deck.id));
    expect(await findRerenderCandidates(ctx.deps.db, { officePdf })).toEqual([
      { deckId: deck.id, revisionId: deck.currentRevisionId, kind: 'rerender' },
    ]);
    await ctx.deps.db
      .update(decks)
      .set({ source: 'upload', sourceRef: null })
      .where(eq(decks.id, deck.id));

    // The job runs once; a failure marks the revision as tried.
    ctx.deps.queue.enqueue({
      deckId: deck.id,
      revisionId: deck.currentRevisionId ?? '',
      kind: 'rerender',
    });
    await ctx.deps.queue.idle();
    expect(await findRerenderCandidates(ctx.deps.db, renderers)).toEqual([]);
  });
});

describe('POST /api/decks/:id/rerender', () => {
  it('queues a re-render and reports it in the status', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ libreOfficePdf: libreOffice.convert });
    const deck = await importedDeck(ctx);
    libreOffice.state.pages = 2;

    const res = await ctx.request(`/api/decks/${deck.id}/rerender`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'queued', renderedAt: null });
    await ctx.deps.queue.idle();

    const status = deckStatusSchema.parse(
      await (await ctx.request(`/api/decks/${deck.id}/status`)).json(),
    );
    expect(status.rendering).toBeNull();
    expect(status.renderedAt).not.toBeNull();
    const rows = await versionsOf(ctx, deck);
    expect(rows.map((row) => row.renderer)).toEqual(['libreoffice', 'libreoffice']);
  });

  it('imports a linked file that changed meanwhile instead of re-rendering the old one', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ libreOfficePdf: libreOffice.convert });
    const deck = await linkedDeck(ctx);
    const check = vi.spyOn(ctx.deps.sync, 'checkDeck').mockResolvedValue({ status: 'queued' });
    const enqueue = vi.spyOn(ctx.deps.queue, 'enqueue');

    const res = await ctx.request(`/api/decks/${deck.id}/rerender`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'newVersion', renderedAt: null });
    expect(check).toHaveBeenCalledWith(deck.id, { manual: true });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('re-renders a linked deck whose file is unchanged', async () => {
    const libreOffice = switchableLibreOffice();
    ctx = await createTestContext({ libreOfficePdf: libreOffice.convert });
    const deck = await linkedDeck(ctx);
    vi.spyOn(ctx.deps.sync, 'checkDeck').mockResolvedValue({ status: 'unchanged' });

    const res = await ctx.request(`/api/decks/${deck.id}/rerender`, { method: 'POST' });
    expect(await res.json()).toEqual({ status: 'queued', renderedAt: null });
  });

  it('lets everyone who may comment ask for it – not viewers (BER-165)', async () => {
    const libreOffice = switchableLibreOffice();
    const context = await createTestContext({ libreOfficePdf: libreOffice.convert });
    ctx = context;
    const deck = await importedDeck(context);
    const as = async (name: string, role: 'viewer' | 'reviewer' | 'member') => {
      const person = await signedInUser(context, { name, email: `${name}@firma.de` });
      await context.deps.db
        .insert(workspaceMembers)
        .values({ workspaceId: context.workspaceId, userId: person.user.id, role });
      const res = await context.request(`/api/decks/${deck.id}/rerender`, {
        method: 'POST',
        cookie: person.cookie,
      });
      await context.deps.queue.idle();
      return res.status;
    };
    expect(await as('vera', 'viewer')).toBe(403);
    expect(await as('rita', 'reviewer')).toBe(202);
    expect(await as('mia', 'member')).toBe(202);
  });

  it('says why when the server has no better renderer', async () => {
    ctx = await createTestContext();
    const deck = await importedDeck(ctx);
    const res = await ctx.request(`/api/decks/${deck.id}/rerender`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      'LibreOffice',
    );
  });
});
