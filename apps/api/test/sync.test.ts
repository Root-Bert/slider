import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commentSchema,
  deckSchema,
  deckStatusSchema,
  revisionDiffSchema,
  revisionSchema,
  slideSchema,
  syncResultSchema,
  type SyncResult,
} from '@slider/shared';
import { decks, revisions, users } from '../src/db/schema';
import { findInterruptedImports, importDeck } from '../src/import/import-deck';
import { silentLogger } from '../src/logger';
import {
  microsoftLoginRequired,
  sourceForbidden,
  sourceNotFound,
  sourceUnreachable,
} from '../src/sources/errors';
import { SyncScheduler, syncTickMs } from '../src/sync/scheduler';
import { createDeckFromFile } from '../src/services/decks';
import { cookieFrom, createTestContext, pinComment, type TestContext } from './helpers';
import {
  BASE_SLIDES,
  commentRows,
  createLinkDeck,
  deckRow,
  FakeSource,
  pptComment,
  pptxBytes,
  presentation,
  revisionRows,
  versionedPptx,
  type SlideDef,
} from './sync-helpers';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

const EDITED: SlideDef[] = BASE_SLIDES.map((s) =>
  s.sldId === 257 ? { ...s, body: 'Rückblick Umsatz Roadmap nächste Schritte Verantwortung' } : s,
);
/** Agenda edited, a new slide after it, "Umsatz nach Region" deleted. */
const V2_SLIDES: SlideDef[] = [
  BASE_SLIDES[0]!,
  EDITED[1]!,
  { sldId: 400, title: 'Wettbewerb', body: 'Marktanteile Preise Positionierung' },
  ...BASE_SLIDES.slice(3),
];

async function setup(
  versions: Record<string, ReturnType<typeof presentation>> = {},
  config: Parameters<typeof createTestContext>[0] = {},
) {
  const source = new FakeSource();
  const pptx = versionedPptx({ v1: presentation(BASE_SLIDES), ...versions });
  ctx = await createTestContext({ openPptx: pptx.open, sources: { onedrive: source }, ...config });
  const deckId = await createLinkDeck(ctx, source);
  return { ctx, source, pptx, deckId };
}

async function sync(context: TestContext, deckId: string, cookie?: string): Promise<SyncResult> {
  const res = await context.request(`/api/decks/${deckId}/sync`, { method: 'POST', cookie });
  expect(res.status).toBe(200);
  return syncResultSchema.parse(await res.json());
}

async function getJson<T>(
  context: TestContext,
  path: string,
  schema: { parse(value: unknown): T },
  cookie?: string,
): Promise<T> {
  const res = await context.request(path, { cookie });
  expect(res.status).toBe(200);
  return schema.parse(await res.json());
}

const slidesOf = (context: TestContext, deckId: string) =>
  getJson(context, `/api/decks/${deckId}/slides`, slideSchema.array());
const deckOf = (context: TestContext, deckId: string) =>
  getJson(context, `/api/decks/${deckId}`, deckSchema);

describe('manual sync (POST /decks/:id/sync)', () => {
  it('is idempotent: the same token 10× creates no revision and downloads nothing', async () => {
    const { ctx, source, deckId } = await setup();
    const before = await deckRow(ctx, deckId);
    const commentsBefore = (await commentRows(ctx, deckId)).length;
    for (let i = 0; i < 10; i++) {
      expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    }
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);
    expect(source.download).not.toHaveBeenCalled();
    expect(source.getChangeToken).toHaveBeenCalledTimes(10);
    expect((await commentRows(ctx, deckId)).length).toBe(commentsBefore);
    const after = await deckRow(ctx, deckId);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.syncState).toMatchObject({ lastSyncError: null, consecutiveFailures: 0 });
    expect(after.syncState.lastCheckedAt).toBeTruthy();
  });

  it('records a new token for identical bytes without a revision, then imports real changes once', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(V2_SLIDES) });
    source.token = 'c2';
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    const [rev1] = await revisionRows(ctx, deckId);
    expect(rev1?.sourceChangeToken).toBe('c2');
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);

    source.token = 'c3';
    source.bytes = pptxBytes('v2');
    const first = await sync(ctx, deckId);
    expect(first.status).toBe('updated');
    const commentCount = (await commentRows(ctx, deckId)).length;
    for (let i = 0; i < 9; i++) expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect(await revisionRows(ctx, deckId)).toHaveLength(2);
    expect((await commentRows(ctx, deckId)).length).toBe(commentCount);
  });

  it('bypasses the debounce and answers with the summary', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(V2_SLIDES) });
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    const result = await sync(ctx, deckId);
    expect(result).toMatchObject({
      status: 'updated',
      revisionId: expect.any(String),
      summary: {
        slidesModified: 1,
        slidesNew: 1,
        slidesDeleted: 1,
        text: '1 Folie geändert, 1 neu, 1 gelöscht',
      },
    });
    expect((await deckOf(ctx, deckId)).revisionNumber).toBe(2);
    const status = await getJson(ctx, `/api/decks/${deckId}/status`, deckStatusSchema);
    expect(status).toMatchObject({
      revisionNumber: 2,
      currentRevisionId: result.revisionId,
      import: { status: 'ready' },
      sync: {
        enabled: true,
        pending: false,
        lastSyncError: null,
        latestSummary: { text: '1 Folie geändert, 1 neu, 1 gelöscht' },
      },
    });
    expect(status.sync.lastSyncAt).toBeTruthy();
  });

  it('compares the content when the source has no change token', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(EDITED) });
    source.token = '';
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect(source.download).toHaveBeenCalledTimes(1);

    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    const [, rev2] = await revisionRows(ctx, deckId);
    expect(rev2?.sourceChangeToken).toBeNull();
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });

    // Polling downloads at most every 5 poll intervals.
    source.download.mockClear();
    expect(await ctx.deps.sync.checkDeck(deckId)).toEqual({ status: 'unchanged' });
    expect(source.download).not.toHaveBeenCalled();
    ctx.clock.advance(5 * 120_000);
    await ctx.deps.sync.checkDeck(deckId);
    expect(source.download).toHaveBeenCalledTimes(1);
    expect(await revisionRows(ctx, deckId)).toHaveLength(2);
  });

  it('only lets the owner sync, and not upload decks', async () => {
    const { ctx, deckId } = await setup();
    const link = (await (
      await ctx.request(`/api/decks/${deckId}/review-links`, {
        method: 'POST',
        json: { role: 'comment' },
      })
    ).json()) as { token: string };
    const guest = cookieFrom(
      await ctx.request(`/api/invites/${link.token}/join`, {
        method: 'POST',
        json: { name: 'Gast' },
      }),
    );
    expect(
      (await ctx.request(`/api/decks/${deckId}/sync`, { method: 'POST', cookie: guest })).status,
    ).toBe(403);
    // Guests may poll the status, but never see the owner's login link.
    const status = await getJson(ctx, `/api/decks/${deckId}/status`, deckStatusSchema, guest);
    expect(status.revisionNumber).toBe(1);

    const [stranger] = await ctx.deps.db
      .insert(users)
      .values({ id: crypto.randomUUID(), name: 'Fremd', email: 'fremd@example.com', color: 'blue' })
      .returning();
    await ctx.deps.db.update(decks).set({ ownerId: stranger!.id }).where(eq(decks.id, deckId));
    expect((await ctx.request(`/api/decks/${deckId}/sync`, { method: 'POST' })).status).toBe(404);

    const upload = await createDeckFromFile(ctx.deps, ctx.ownerId, {
      fileName: 'Upload.pptx',
      bytes: pptxBytes('v1'),
      source: 'upload',
    });
    await ctx.deps.queue.idle();
    const res = await ctx.request(`/api/decks/${upload.id}/sync`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: 'bad_request',
        message:
          'Hochgeladene Präsentationen werden nicht automatisch aktualisiert. Lade eine neue Version hoch.',
      },
    });
  });
});

describe('scheduler', () => {
  const POLL = 120_000;
  const DEBOUNCE = 60_000;

  async function withScheduler(versions: Record<string, ReturnType<typeof presentation>> = {}) {
    const env = await setup(versions, {
      config: { sync: { pollIntervalMs: POLL, debounceMs: DEBOUNCE } },
    });
    const scheduler = new SyncScheduler({
      db: env.ctx.deps.db,
      clock: env.ctx.clock,
      log: silentLogger,
      sync: env.ctx.deps.sync,
      config: env.ctx.deps.config,
    });
    return { ...env, scheduler };
  }

  it('debounces autosaves and forces an import after 10 × debounce', async () => {
    const { ctx, source, deckId, scheduler } = await withScheduler({
      v2: presentation(EDITED),
      v3: presentation(V2_SLIDES),
    });
    const tick = async () => {
      const checked = await scheduler.tick();
      await ctx.deps.queue.idle();
      return checked;
    };
    const count = async () => (await revisionRows(ctx, deckId)).length;

    expect(await tick()).toEqual([deckId]); // first check: unchanged
    expect(await tick()).toEqual([]); // not due again before the poll interval
    ctx.clock.advance(POLL);

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    await tick(); // t0: change seen → pending
    expect(await count()).toBe(1);
    expect((await deckOf(ctx, deckId)).sync).toMatchObject({ pending: true });

    ctx.clock.advance(30_000);
    source.token = 'c3';
    await tick(); // t0+30s: changed again → quiet period restarts
    expect((await deckRow(ctx, deckId)).syncState.pending?.token).toBe('c3');
    ctx.clock.advance(30_000);
    await tick(); // t0+60s: only 30 s quiet
    expect(await count()).toBe(1);
    ctx.clock.advance(31_000);
    await tick(); // t0+91s: 61 s quiet → import
    expect(await count()).toBe(2);
    const rev2 = (await revisionRows(ctx, deckId))[1];
    expect(rev2).toMatchObject({ status: 'ready', trigger: 'poll', sourceChangeToken: 'c3' });
    expect((await deckOf(ctx, deckId)).sync).toMatchObject({ pending: false });

    for (let i = 0; i < 3; i++) {
      ctx.clock.advance(POLL);
      await tick();
    }
    expect(await count()).toBe(2);
    expect(source.download).toHaveBeenCalledTimes(1);

    // PowerPoint Online saving every 30 s: the import happens once 10 × debounce passed.
    ctx.clock.advance(POLL);
    source.bytes = pptxBytes('v3');
    let elapsed = 0;
    for (let i = 1; i <= 25 && (await count()) === 2; i++) {
      source.token = `d${i}`;
      await tick();
      if ((await count()) === 3) break;
      ctx.clock.advance(30_000);
      elapsed += 30_000;
    }
    expect(await count()).toBe(3);
    expect(elapsed).toBeGreaterThanOrEqual(10 * DEBOUNCE);
    expect(elapsed).toBeLessThanOrEqual(10 * DEBOUNCE + 30_000);
  });

  it('skips uploads, archived, inactive and failed decks', async () => {
    const { ctx, source, deckId, scheduler } = await withScheduler();
    const make = async (patch: Partial<typeof decks.$inferInsert>) => {
      const id = await createLinkDeck(ctx, source);
      await ctx.deps.db.update(decks).set(patch).where(eq(decks.id, id));
      return id;
    };
    const old = new Date(ctx.clock.now().getTime() - 8 * 24 * 60 * 60 * 1000);
    await make({ source: 'upload', sourceRef: null });
    await make({ archivedAt: ctx.clock.now() });
    await make({ updatedAt: old, lastViewedAt: old });
    await make({ importState: { status: 'failed', error: 'kaputt' } });
    const recentlyViewed = await make({ updatedAt: old, lastViewedAt: ctx.clock.now() });
    source.getChangeToken.mockClear();

    const checked = await scheduler.tick();
    expect(checked.sort()).toEqual([deckId, recentlyViewed].sort());
    expect(source.getChangeToken).toHaveBeenCalledTimes(2);
  });

  it('opening a deck marks it as viewed, at most hourly', async () => {
    const { ctx, deckId } = await setup();
    expect((await deckRow(ctx, deckId)).lastViewedAt).toBeNull();
    await deckOf(ctx, deckId);
    const first = (await deckRow(ctx, deckId)).lastViewedAt;
    expect(first).toBeInstanceOf(Date);
    ctx.clock.advance(10 * 60 * 1000);
    await deckOf(ctx, deckId);
    expect((await deckRow(ctx, deckId)).lastViewedAt).toEqual(first);
    ctx.clock.advance(60 * 60 * 1000);
    const before = (await deckRow(ctx, deckId)).updatedAt;
    await deckOf(ctx, deckId);
    const row = await deckRow(ctx, deckId);
    expect(row.lastViewedAt?.getTime()).toBeGreaterThan(first!.getTime());
    expect(row.updatedAt).toEqual(before);
  });

  it('does not start with SYNC_POLL_INTERVAL_MS=0', async () => {
    const { ctx } = await setup();
    const scheduler = new SyncScheduler({
      db: ctx.deps.db,
      clock: ctx.clock,
      log: silentLogger,
      sync: ctx.deps.sync,
      config: { sync: { pollIntervalMs: 0, debounceMs: DEBOUNCE } },
    });
    scheduler.start();
    expect(scheduler.started).toBe(false);
    const running = new SyncScheduler({
      db: ctx.deps.db,
      clock: ctx.clock,
      log: silentLogger,
      sync: ctx.deps.sync,
      config: { sync: { pollIntervalMs: POLL, debounceMs: DEBOUNCE } },
    });
    running.start();
    expect(running.started).toBe(true);
    running.stop();
    expect(running.started).toBe(false);
    expect(syncTickMs({ pollIntervalMs: POLL, debounceMs: DEBOUNCE })).toBe(30_000);
    expect(syncTickMs({ pollIntervalMs: 10_000, debounceMs: 0 })).toBe(10_000);
  });
});

describe('errors keep the last revision', () => {
  it.each([
    [microsoftLoginRequired(''), 'auth_required'],
    [sourceNotFound(), 'not_found'],
    [sourceForbidden(), 'access_revoked'],
  ] as const)('%s → %s', async (error, code) => {
    const { ctx, source, deckId } = await setup();
    const slidesBefore = await slidesOf(ctx, deckId);
    const before = await deckRow(ctx, deckId);
    source.error = error;
    const result = await sync(ctx, deckId);
    expect(result).toMatchObject({ status: 'error', error: { code } });
    const deck = await deckOf(ctx, deckId);
    expect(deck.sync?.lastSyncError?.code).toBe(code);
    expect(deck.sync?.lastSyncError?.message).toMatch(/Version|Datei|Microsoft/);
    if (code === 'auth_required') {
      const loginUrl = `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/d/${deckId}`)}`;
      expect(result.error?.loginUrl).toBe(loginUrl);
      expect(deck.sync?.lastSyncError?.loginUrl).toBe(loginUrl);
      expect(result.error?.message).toContain('Bis dahin siehst du die letzte Version');
    }
    expect(deck.currentRevisionId).toBe(before.currentRevisionId);
    expect(deck.import).toEqual({ status: 'ready' });
    expect(await slidesOf(ctx, deckId)).toEqual(slidesBefore);

    source.error = null;
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect((await deckOf(ctx, deckId)).sync?.lastSyncError).toBeNull();
  });

  it('shows "unreachable" only from the third failure in a row', async () => {
    const { ctx, source, deckId } = await setup();
    source.error = sourceUnreachable();
    for (const attempt of [1, 2]) {
      expect((await sync(ctx, deckId)).error?.code).toBe('unreachable');
      expect((await deckOf(ctx, deckId)).sync?.lastSyncError, `attempt ${attempt}`).toBeNull();
    }
    await sync(ctx, deckId);
    expect((await deckOf(ctx, deckId)).sync?.lastSyncError).toMatchObject({
      code: 'unreachable',
      message: 'Die Quelle ist gerade nicht erreichbar. Slider versucht es automatisch erneut.',
    });
    expect((await deckRow(ctx, deckId)).syncState.consecutiveFailures).toBe(3);
  });

  it('a new file that cannot be parsed leaves the deck as it was', async () => {
    const { ctx, source, deckId } = await setup({ v3: presentation(EDITED) });
    const scheduler = new SyncScheduler({
      db: ctx.deps.db,
      clock: ctx.clock,
      log: silentLogger,
      sync: ctx.deps.sync,
      config: { sync: { pollIntervalMs: 120_000, debounceMs: 60_000 } },
    });
    const before = await deckRow(ctx, deckId);
    source.token = 'c2';
    source.bytes = pptxBytes('corrupt-v2');
    const result = await sync(ctx, deckId);
    expect(result).toMatchObject({ status: 'error', error: { code: 'parse_failed' } });
    expect(result.error?.message).toBe(
      'Die neue Version ist beschädigt und konnte nicht gelesen werden. Es bleibt die letzte Version sichtbar.',
    );
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);
    const after = await deckRow(ctx, deckId);
    expect(after.currentRevisionId).toBe(before.currentRevisionId);
    expect(after.importState).toEqual({ status: 'ready' });
    expect(after.syncState.failedToken).toBe('c2');

    // The scheduler does not download the known-broken file again …
    source.download.mockClear();
    ctx.clock.advance(10 * 60_000);
    await scheduler.tick();
    await ctx.deps.queue.idle();
    expect(source.download).not.toHaveBeenCalled();
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);

    // … but a newer file is tried.
    source.token = 'c3';
    source.bytes = pptxBytes('v3');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    expect((await deckOf(ctx, deckId)).sync?.lastSyncError).toBeNull();
  });
});

describe('revisions and diffs', () => {
  it('exposes revisions, per-slide changes and deleted slides', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(V2_SLIDES) });
    const v1 = await slidesOf(ctx, deckId);
    expect(v1.every((s) => s.change === null)).toBe(true);
    const deletedV1 = v1[2]!;
    const deletedImage = deletedV1.imageUrl;

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    const result = await sync(ctx, deckId);

    const list = await getJson(ctx, `/api/decks/${deckId}/revisions`, revisionSchema.array());
    expect(list.map((r) => [r.number, r.status, r.isCurrent, r.trigger])).toEqual([
      [2, 'ready', true, 'manual'],
      [1, 'ready', false, 'initial'],
    ]);
    expect(list[0]?.summary?.text).toBe('1 Folie geändert, 1 neu, 1 gelöscht');

    const diff = await getJson(
      ctx,
      `/api/decks/${deckId}/revisions/latest/diff`,
      revisionDiffSchema,
    );
    expect(diff).toMatchObject({ revisionId: result.revisionId, number: 2 });
    expect(diff.slides.map((s) => s.status)).toEqual([
      'unchanged',
      'modified',
      'new',
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
    expect(diff.slides.some((s) => s.moved)).toBe(false);
    expect(diff.deletedSlides).toHaveLength(1);
    expect(diff.deletedSlides[0]).toMatchObject({
      slideId: deletedV1.id,
      title: 'Umsatz nach Region',
      previousPosition: 2,
      lastRevisionNumber: 1,
      imageUrl: deletedImage,
    });
    expect((await ctx.request(deletedImage)).status).toBe(200);

    const v2 = await slidesOf(ctx, deckId);
    // Matched slides keep their Slider ids.
    expect(v2.map((s) => s.id)).toEqual([
      v1[0]!.id,
      v1[1]!.id,
      v2[2]!.id,
      v1[3]!.id,
      v1[4]!.id,
      v1[5]!.id,
    ]);
    expect(v2.map((s) => s.change?.status)).toEqual([
      'unchanged',
      'modified',
      'new',
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
    const rev1 = list[1]!;
    const first = await getJson(
      ctx,
      `/api/decks/${deckId}/revisions/${rev1.id}/diff`,
      revisionDiffSchema,
    );
    expect(first).toMatchObject({
      number: 1,
      previousRevisionId: null,
      slides: [],
      deletedSlides: [],
    });
    expect((await ctx.request(`/api/decks/${deckId}/revisions/nope/diff`)).status).toBe(404);
  });

  it('comments survive slide deletion and follow moved slides', async () => {
    const reordered: SlideDef[] = [
      BASE_SLIDES[0]!,
      BASE_SLIDES[3]!,
      BASE_SLIDES[1]!,
      BASE_SLIDES[4]!,
      BASE_SLIDES[5]!,
    ];
    const { ctx, source, deckId } = await setup({ v2: presentation(reordered) });
    const v1 = await slidesOf(ctx, deckId);
    const onDeleted = commentSchema.parse(
      await (
        await ctx.request(`/api/decks/${deckId}/comments`, {
          method: 'POST',
          json: pinComment(v1[2]!.id, 'Quelle der Zahlen?'),
        })
      ).json(),
    );
    const reply = commentSchema.parse(
      await (
        await ctx.request(`/api/decks/${deckId}/comments`, {
          method: 'POST',
          json: {
            slideId: null,
            parentId: onDeleted.id,
            body: 'Controlling',
            anchor: { type: 'slide' },
          },
        })
      ).json(),
    );
    const onMoved = commentSchema.parse(
      await (
        await ctx.request(`/api/decks/${deckId}/comments`, {
          method: 'POST',
          json: pinComment(v1[3]!.id, 'Roadmap prüfen'),
        })
      ).json(),
    );

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');

    const all = await getJson(ctx, `/api/decks/${deckId}/comments`, commentSchema.array());
    expect(all.find((c) => c.id === onDeleted.id)?.slideId).toBe(v1[2]!.id);
    expect(all.find((c) => c.id === reply.id)?.parentId).toBe(onDeleted.id);
    expect(all.find((c) => c.id === onMoved.id)?.slideId).toBe(v1[3]!.id);
    const v2 = await slidesOf(ctx, deckId);
    expect(v2.find((s) => s.id === v1[3]!.id)?.position).toBe(1);
    expect(v2.filter((s) => s.change?.status === 'moved')).toHaveLength(1);

    const diff = await getJson(
      ctx,
      `/api/decks/${deckId}/revisions/latest/diff`,
      revisionDiffSchema,
    );
    expect(diff.deletedSlides.map((s) => s.slideId)).toEqual([v1[2]!.id]);
    expect(diff.deletedSlides[0]?.comments.map((c) => c.id)).toEqual([onDeleted.id, reply.id]);
    const deleted = await ctx.request(`/api/decks/${deckId}/deleted-slides`);
    expect(((await deleted.json()) as { slideId: string }[]).map((s) => s.slideId)).toEqual([
      v1[2]!.id,
    ]);
    // The deck's open count still includes feedback on deleted slides.
    expect((await deckOf(ctx, deckId)).openCommentCount).toBe(2);
  });

  it('an import retry never deletes commented slides', async () => {
    const { ctx, deckId, pptx } = await setup();
    const v1 = await slidesOf(ctx, deckId);
    await ctx.request(`/api/decks/${deckId}/comments`, {
      method: 'POST',
      json: pinComment(v1[0]!.id),
    });
    const [rev] = await revisionRows(ctx, deckId);
    await importDeck(
      { ...ctx.deps, openPptx: pptx.open, log: silentLogger },
      { deckId, revisionId: rev!.id },
    );
    expect(await commentRows(ctx, deckId)).toHaveLength(1);
  });
});

describe('robustness', () => {
  it('a sync while an import runs joins it instead of creating a second revision', async () => {
    const { ctx, source, deckId, pptx } = await setup(
      { v2: presentation(EDITED) },
      { config: { sync: { pollIntervalMs: 0, debounceMs: 0 } } },
    );
    const release = pptx.gate('v2');
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    const queued = await ctx.deps.sync.checkDeck(deckId);
    expect(queued).toMatchObject({ status: 'queued', revisionId: expect.any(String) });
    expect(await sync(ctx, deckId)).toEqual({ status: 'queued', revisionId: queued.revisionId });
    expect((await deckOf(ctx, deckId)).sync?.pending).toBe(true);
    expect(await revisionRows(ctx, deckId)).toHaveLength(2);

    // A restart in this state picks the pending revision up again.
    expect(await findInterruptedImports(ctx.deps.db)).toEqual([
      { deckId, revisionId: queued.revisionId, kind: 'sync' },
    ]);

    release();
    await ctx.deps.queue.idle();
    const rows = await revisionRows(ctx, deckId);
    expect(rows.map((r) => r.status)).toEqual(['ready', 'ready']);
    expect((await deckRow(ctx, deckId)).currentRevisionId).toBe(queued.revisionId);
  });

  it('migrated defaults: revisions are ready and sync state is empty', async () => {
    const { ctx, deckId } = await setup();
    const [rev] = await ctx.deps.db.select().from(revisions).where(eq(revisions.deckId, deckId));
    expect(rev).toMatchObject({ status: 'ready', trigger: 'initial', diff: null, summary: null });
    expect(rev?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    const id = crypto.randomUUID();
    await ctx.deps.db.insert(decks).values({
      id,
      ownerId: ctx.ownerId,
      title: 'Alt',
      fileName: 'Alt.pptx',
      source: 'upload',
      importState: { status: 'ready' },
    });
    expect((await deckRow(ctx, id)).syncState).toEqual({});
  });

  it('re-uploading an upload deck creates a matched revision', async () => {
    const pptx = versionedPptx({ v1: presentation(BASE_SLIDES), v2: presentation(EDITED) });
    ctx = await createTestContext({ openPptx: pptx.open });
    const form = (version: string) => {
      const body = new FormData();
      body.append('file', new File([pptxBytes(version)], 'Deck.pptx'));
      return body;
    };
    const created = await ctx.request('/api/decks/upload', { method: 'POST', body: form('v1') });
    const deck = deckSchema.parse(await created.json());
    await ctx.deps.queue.idle();
    const v1 = await slidesOf(ctx, deck.id);

    const same = await ctx.request(`/api/decks/${deck.id}/revisions`, {
      method: 'POST',
      body: form('v1'),
    });
    expect(syncResultSchema.parse(await same.json())).toEqual({ status: 'unchanged' });
    const res = await ctx.request(`/api/decks/${deck.id}/revisions`, {
      method: 'POST',
      body: form('v2'),
    });
    expect(syncResultSchema.parse(await res.json())).toMatchObject({
      status: 'updated',
      summary: { text: '1 Folie geändert' },
    });
    const v2 = await slidesOf(ctx, deck.id);
    expect(v2.map((s) => s.id)).toEqual(v1.map((s) => s.id));
    expect((await deckOf(ctx, deck.id)).sync?.enabled).toBe(false);
  });
});

describe('fix round 1 regressions', () => {
  it('a fully rewritten slide with the same sldId keeps its id and its comments', async () => {
    const rewritten: SlideDef[] = BASE_SLIDES.map((s) =>
      s.sldId === 258
        ? { ...s, title: 'Ganz anderes Thema', body: 'Neue Inhalte ohne jede Überschneidung' }
        : s,
    );
    const { ctx, source, deckId } = await setup({ v2: presentation(rewritten) });
    const v1 = await slidesOf(ctx, deckId);
    const comment = commentSchema.parse(
      await (
        await ctx.request(`/api/decks/${deckId}/comments`, {
          method: 'POST',
          json: pinComment(v1[2]!.id, 'Zahlen?'),
        })
      ).json(),
    );
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect(await sync(ctx, deckId)).toMatchObject({
      status: 'updated',
      summary: { text: '1 Folie geändert' },
    });
    const v2 = await slidesOf(ctx, deckId);
    expect(v2.map((s) => s.id)).toEqual(v1.map((s) => s.id));
    expect(v2[2]?.change).toMatchObject({ status: 'modified' });
    const all = await getJson(ctx, `/api/decks/${deckId}/comments`, commentSchema.array());
    expect(all.find((c) => c.id === comment.id)?.slideId).toBe(v2[2]!.id);
    const deleted = await ctx.request(`/api/decks/${deckId}/deleted-slides`);
    expect(await deleted.json()).toEqual([]);
  });

  it('a queued import finishing during a manual check does not cause a duplicate revision', async () => {
    const { ctx, source, deckId, pptx } = await setup(
      { v2: presentation(EDITED) },
      { config: { sync: { pollIntervalMs: 0, debounceMs: 0 } } },
    );
    const release = pptx.gate('v2');
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await ctx.deps.sync.checkDeck(deckId)).status).toBe('queued');

    // The import commits right while the manual check looks for a pending revision.
    const service = ctx.deps.sync as unknown as {
      pendingRevision(id: string): Promise<{ id: string } | null>;
    };
    const original = service.pendingRevision.bind(service);
    let first = true;
    service.pendingRevision = async (id) => {
      if (first) {
        first = false;
        release();
        await ctx!.deps.queue.idle();
      }
      return original(id);
    };
    expect(await ctx.deps.sync.checkDeck(deckId, { manual: true })).toEqual({
      status: 'unchanged',
    });
    const rows = await revisionRows(ctx, deckId);
    expect(rows.map((r) => r.status)).toEqual(['ready', 'ready']);
  });

  it('never creates a revision for bytes the newest revision already has (stale baseline)', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(EDITED) });
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    const [rev1] = await revisionRows(ctx, deckId);
    // Pretend the check still saw revision 1 as current.
    const service = ctx.deps.sync as unknown as {
      load(id: string): Promise<{ deck: unknown; current: unknown }>;
    };
    const original = service.load.bind(service);
    service.load = async (id) => ({ ...(await original(id)), current: rev1 });
    source.token = 'c3';
    expect(await ctx.deps.sync.checkDeck(deckId, { manual: true })).toEqual({
      status: 'unchanged',
    });
    const rows = await revisionRows(ctx, deckId);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.sourceChangeToken).toBe('c3');
  });

  it('two concurrent uploads both become revisions, in order', async () => {
    const third: SlideDef[] = EDITED.map((s) =>
      s.sldId === 260 ? { ...s, body: 'Budget Personal Lieferketten Wettbewerb Zinsen' } : s,
    );
    const pptx = versionedPptx({
      v1: presentation(BASE_SLIDES),
      v2: presentation(EDITED),
      v3: presentation(third),
    });
    ctx = await createTestContext({ openPptx: pptx.open });
    const body = new FormData();
    body.append('file', new File([pptxBytes('v1')], 'Deck.pptx'));
    const created = await ctx.request('/api/decks/upload', { method: 'POST', body });
    const deck = deckSchema.parse(await created.json());
    await ctx.deps.queue.idle();

    const [a, b] = await Promise.all([
      ctx.deps.sync.importUpload(deck.id, pptxBytes('v2')),
      ctx.deps.sync.importUpload(deck.id, pptxBytes('v3')),
    ]);
    expect(a.status).toBe('updated');
    expect(b.status).toBe('updated');
    expect(a.revisionId).not.toBe(b.revisionId);
    const rows = await revisionRows(ctx, deck.id);
    expect(rows.map((r) => r.status)).toEqual(['ready', 'ready', 'ready']);
    expect((await deckRow(ctx, deck.id)).currentRevisionId).toBe(b.revisionId);
  });

  it('with duplicate sldIds the original keeps its PowerPoint comments', async () => {
    const comment = pptComment('pc1', 257, 'Agenda kürzen?');
    const duplicated: SlideDef[] = [
      BASE_SLIDES[0]!,
      BASE_SLIDES[1]!,
      { ...BASE_SLIDES[1]!, body: 'Rückblick Umsatz Roadmap nächste Schritte Kopie' },
      ...BASE_SLIDES.slice(2),
    ];
    const { ctx, source, deckId, pptx } = await setup({
      v2: presentation(duplicated, [comment]),
    });
    pptx.versions.v1 = presentation(BASE_SLIDES, [comment]);
    // Re-import v1 so the comment exists before the sync (the deck was created without it).
    source.token = 'c1b';
    source.bytes = pptxBytes('v1b');
    pptx.versions.v1b = presentation(BASE_SLIDES, [comment]);
    await sync(ctx, deckId);
    const v1 = await slidesOf(ctx, deckId);
    const before = (await commentRows(ctx, deckId)).find((c) => c.externalId === 'pc1');
    expect(before?.slideId).toBe(v1[1]!.id);

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    const v2 = await slidesOf(ctx, deckId);
    expect(v2[1]?.id).toBe(v1[1]!.id);
    expect(v2[2]?.change?.status).toBe('new');
    const after = (await commentRows(ctx, deckId)).find((c) => c.externalId === 'pc1');
    expect(after?.slideId).toBe(v1[1]!.id);
  });

  it('a slide deleted in one revision and restored later gets its identity and comments back', async () => {
    const { ctx, source, deckId } = await setup({
      v2: presentation(BASE_SLIDES.slice(1)),
      v3: presentation(BASE_SLIDES),
    });
    const v1 = await slidesOf(ctx, deckId);
    const comment = commentSchema.parse(
      await (
        await ctx.request(`/api/decks/${deckId}/comments`, {
          method: 'POST',
          json: pinComment(v1[0]!.id, 'Titel passt'),
        })
      ).json(),
    );
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect(await sync(ctx, deckId)).toMatchObject({ summary: { slidesDeleted: 1 } });
    const gone = await ctx.request(`/api/decks/${deckId}/deleted-slides`);
    expect(((await gone.json()) as { slideId: string }[]).map((s) => s.slideId)).toEqual([
      v1[0]!.id,
    ]);

    source.token = 'c3';
    source.bytes = pptxBytes('v3');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    const v3 = await slidesOf(ctx, deckId);
    expect(v3.map((s) => s.id)).toEqual(v1.map((s) => s.id));
    const all = await getJson(ctx, `/api/decks/${deckId}/comments`, commentSchema.array());
    expect(all.find((c) => c.id === comment.id)?.slideId).toBe(v3[0]!.id);
    const deleted = await ctx.request(`/api/decks/${deckId}/deleted-slides`);
    expect(await deleted.json()).toEqual([]);
  });

  it('an unrelated new slide reusing a deleted sldId does not inherit the old identity', async () => {
    const last = BASE_SLIDES[5]!;
    const { ctx, source, deckId } = await setup({
      v2: presentation(BASE_SLIDES.slice(0, 5)),
      v3: presentation([
        ...BASE_SLIDES.slice(0, 5),
        { sldId: last.sldId, title: 'Anhang', body: 'Glossar Quellen Kontakte' },
      ]),
    });
    const v1 = await slidesOf(ctx, deckId);
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    await sync(ctx, deckId);
    source.token = 'c3';
    source.bytes = pptxBytes('v3');
    await sync(ctx, deckId);
    const v3 = await slidesOf(ctx, deckId);
    expect(v3[5]?.id).not.toBe(v1[5]!.id);
  });
});
