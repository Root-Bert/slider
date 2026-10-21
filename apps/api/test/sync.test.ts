import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNLIMITED_PLAN, workspaceUsages } from '../src/services/plans';
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
import { decks, revisions, slideVersions, workspaces } from '../src/db/schema';
import { MAX_IMPORT_ATTEMPTS } from '../src/import/attempts';
import { FINGERPRINT_VERSION } from '../src/import/common';
import { findInterruptedImports, importDeck } from '../src/import/import-deck';
import { silentLogger } from '../src/logger';
import { blobKeys } from '../src/storage/blob-storage';
import {
  microsoftLoginRequired,
  sourceForbidden,
  sourceNotFound,
  sourceUnreachable,
} from '../src/sources/errors';
import { SYNC_MAX_DECKS_PER_TICK, SyncScheduler, syncTickMs } from '../src/sync/scheduler';
import { SYNC_IMPORT_MAX_ATTEMPTS } from '../src/sync/sync-import';
import { connectMicrosoft, createTestContext, pinComment, type TestContext } from './helpers';
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
  ctx = await createTestContext({
    openPptx: pptx.open,
    sources: { onedrive: source },
    ...config,
    // Sync is not about plans: no deck limit (BER-130).
    config: { plans: { free: UNLIMITED_PLAN, paid: UNLIMITED_PLAN }, ...config.config },
  });
  const deckId = await createLinkDeck(ctx, source);
  return { ctx, source, pptx, deckId };
}

/** A check without debounce, as "Neu rendern" runs it. */
async function sync(context: TestContext, deckId: string): Promise<SyncResult> {
  return syncResultSchema.parse(await context.deps.sync.checkDeck(deckId, { manual: true }));
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

describe('manual check', () => {
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

  it('learns who worked on the file once, then with every new revision', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(V2_SLIDES) });
    expect((await deckRow(ctx, deckId)).sourceContributors).toBeNull();
    source.contributors = ['Kim Kollege', 'Olga Owner'];
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect((await deckRow(ctx, deckId)).sourceContributors).toEqual(['Kim Kollege', 'Olga Owner']);
    // Kept, but names alone get no avatar: the owner stands in.
    expect((await deckOf(ctx, deckId)).participants.map((person) => person.type)).toEqual([
      'owner',
    ]);

    // Unchanged files are not asked again.
    source.contributors = ['Paula Partner', 'Kim Kollege', 'Olga Owner'];
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect(source.listContributors).toHaveBeenCalledTimes(1);

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    expect((await deckRow(ctx, deckId)).sourceContributors).toEqual([
      'Paula Partner',
      'Kim Kollege',
      'Olga Owner',
    ]);

    // A source that stops telling keeps the names known so far.
    source.contributors = new Error('history closed');
    source.token = 'c3';
    source.bytes = pptxBytes('v1');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    expect((await deckRow(ctx, deckId)).sourceContributors).toHaveLength(3);
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

  it('pauses while the storage is full and takes the new version over once there is room', async () => {
    const { ctx, source, deckId, scheduler } = await withScheduler({
      v2: presentation(V2_SLIDES),
    });
    const tick = async () => {
      await scheduler.tick();
      await ctx.deps.queue.idle();
    };
    const count = async () => (await revisionRows(ctx, deckId)).length;
    const storageLimit = (maxStorageBytes: number | null) => {
      ctx.deps.config.plans.free = { ...UNLIMITED_PLAN, maxStorageBytes };
    };
    await tick();
    const [workspace] = await ctx.deps.db
      .select({ id: decks.workspaceId })
      .from(decks)
      .where(eq(decks.id, deckId));
    const stored = (
      await workspaceUsages(
        ctx.deps.db,
        ctx.deps.config,
        [{ id: workspace!.id, plan: 'free' }],
        ctx.clock.now(),
      )
    ).get(workspace!.id)!.storageBytes;

    // Full to the byte: the change is neither waited for nor downloaded.
    storageLimit(stored);
    ctx.clock.advance(POLL);
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    await tick();
    expect(await count()).toBe(1);
    expect(source.download).not.toHaveBeenCalled();
    const paused = (await deckOf(ctx, deckId)).sync;
    expect(paused).toMatchObject({
      pending: false,
      lastSyncError: {
        code: 'storage_full',
        message:
          'Speicher voll – neue Versionen aus OneDrive werden erst wieder übernommen, wenn Platz frei ist.',
      },
    });
    // Not a failure: no backoff, the next regular check looks again.
    expect((await deckRow(ctx, deckId)).syncState.consecutiveFailures ?? 0).toBe(0);
    const since = paused?.lastSyncError?.at;

    // Some room, but not enough for this file: downloaded, measured, still not imported.
    storageLimit(stored + Math.floor(pptxBytes('v2').byteLength / 2));
    ctx.clock.advance(POLL);
    await tick(); // change seen → debounce
    ctx.clock.advance(DEBOUNCE + 1_000);
    await tick();
    expect(source.download).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(1);
    // The same pause keeps its time: a banner closed once stays closed.
    expect((await deckOf(ctx, deckId)).sync?.lastSyncError).toMatchObject({
      code: 'storage_full',
      at: since,
    });
    // Later checks, and "Neu laden", say the same – without downloading the file again.
    for (let i = 0; i < 3; i++) {
      ctx.clock.advance(POLL);
      await tick();
    }
    expect(await sync(ctx, deckId)).toMatchObject({
      status: 'error',
      error: { code: 'storage_full' },
    });
    expect(source.download).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(1);

    // Room again: the next checks take the version over by themselves.
    storageLimit(null);
    ctx.clock.advance(POLL);
    await tick();
    ctx.clock.advance(DEBOUNCE + 1_000);
    await tick();
    expect(await count()).toBe(2);
    expect((await deckOf(ctx, deckId)).sync).toMatchObject({ lastSyncError: null });
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

  it('leaves the reviews of a blocked organisation alone (BER-167)', async () => {
    const { ctx, scheduler } = await withScheduler();
    await ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: ctx.clock.now() })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect(await scheduler.tick()).toEqual([]);
  });

  it('decks with a queued import do not take the slots of other decks', async () => {
    const { ctx, source, deckId, scheduler } = await withScheduler();
    for (let i = 0; i < SYNC_MAX_DECKS_PER_TICK; i++) {
      const id = await createLinkDeck(ctx, source);
      await ctx.deps.db.insert(revisions).values({
        id: crypto.randomUUID(),
        deckId: id,
        number: 2,
        status: 'pending',
        pptxKey: null,
      });
      // Due long before the other deck, as a pending deck's stale `nextCheckAt` is.
      await ctx.deps.db
        .update(decks)
        .set({ syncState: { nextCheckAt: new Date(0).toISOString() } })
        .where(eq(decks.id, id));
    }
    const checked = await scheduler.tick();
    expect(checked).toEqual([deckId]);
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

describe('several Microsoft accounts', () => {
  it('syncs through the deck’s own connection, switches when it loses access; the banner renews it', async () => {
    const { ctx, source, deckId } = await setup();
    const first = await connectMicrosoft(ctx.deps.db, ctx.ownerId, { subject: 'ms-1' });
    const deckAccount = await connectMicrosoft(ctx.deps.db, ctx.ownerId, { subject: 'ms-2' });
    await ctx.deps.db
      .update(decks)
      .set({ microsoftConnectionId: deckAccount })
      .where(eq(decks.id, deckId));
    source.access = new Set([deckAccount]);
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    const used = source.getChangeToken.mock.calls.map(([, context]) => context?.connectionId);
    expect(used).toEqual([deckAccount]);

    // That account loses access: the owner's other account can read it, so the deck switches.
    source.access = new Set([first]);
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect((await deckRow(ctx, deckId)).microsoftConnectionId).toBe(first);

    // No account can read it any more: the banner renews the deck's own account.
    source.error = microsoftLoginRequired('');
    source.access = null;
    const expired = await sync(ctx, deckId);
    expect(expired.error?.loginUrl).toBe(
      `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/d/${deckId}`)}&connection=${first}`,
    );
  });

  it('a deck without a connection (linked before) tries the owner’s accounts and keeps the winner', async () => {
    const { ctx, source, deckId } = await setup();
    const other = await connectMicrosoft(ctx.deps.db, ctx.ownerId, {
      subject: 'ms-1',
      lastUsedAt: new Date('2026-10-02'),
    });
    const winner = await connectMicrosoft(ctx.deps.db, ctx.ownerId, {
      subject: 'ms-2',
      lastUsedAt: new Date('2026-10-01'),
    });
    source.access = new Set([winner]);
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect(source.getChangeToken.mock.calls.map(([, c]) => c?.connectionId)).toEqual([
      other,
      winner,
    ]);
    expect((await deckRow(ctx, deckId)).microsoftConnectionId).toBe(winner);
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect(source.getChangeToken.mock.calls.at(-1)?.[1]?.connectionId).toBe(winner);
  });

  it('a public file never ties the deck to an account', async () => {
    const { ctx, deckId } = await setup();
    await connectMicrosoft(ctx.deps.db, ctx.ownerId);
    expect(await sync(ctx, deckId)).toEqual({ status: 'unchanged' });
    expect((await deckRow(ctx, deckId)).microsoftConnectionId).toBeNull();
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
    // Opened while the source answered: that grant carries the viewer through the outage.
    await deckOf(ctx, deckId);
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

  it('a file whose import keeps failing (not a parse error) backs off, then is skipped', async () => {
    const { ctx, source, deckId } = await setup({ v3: presentation(EDITED) });
    const scheduler = new SyncScheduler({
      db: ctx.deps.db,
      clock: ctx.clock,
      log: silentLogger,
      sync: ctx.deps.sync,
      config: ctx.deps.config,
    });
    // `versionedPptx` throws a plain Error (no PptxError) for an unknown version.
    source.token = 'c2';
    source.bytes = pptxBytes('renderer-bug');
    source.download.mockClear();
    // Two hours of polling, as the scheduler runs it.
    for (let i = 0; i < 240; i++) {
      ctx.clock.advance(30_000);
      await scheduler.tick();
      await ctx.deps.queue.idle();
    }
    expect(source.download).toHaveBeenCalledTimes(SYNC_IMPORT_MAX_ATTEMPTS);
    const after = await deckRow(ctx, deckId);
    expect(after.syncState).toMatchObject({
      failedToken: 'c2',
      consecutiveFailures: SYNC_IMPORT_MAX_ATTEMPTS,
      lastSyncError: { code: 'internal' },
    });
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);

    // "Neu rendern" still tries the file, and a newer file imports and resets the count.
    source.download.mockClear();
    expect((await sync(ctx, deckId)).status).toBe('error');
    expect(source.download).toHaveBeenCalledTimes(1);
    source.token = 'c3';
    source.bytes = pptxBytes('v3');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    expect((await deckRow(ctx, deckId)).syncState).toMatchObject({
      consecutiveFailures: 0,
      failedToken: null,
      lastSyncError: null,
    });
  });
});

describe('import attempts after an outage', () => {
  it('failed source checks before an edit do not use up the import attempts', async () => {
    const { ctx, source, deckId } = await setup({ v3: presentation(EDITED) });
    // The source is unreachable for a while (e.g. the Microsoft login expired) …
    source.error = sourceUnreachable();
    for (let i = 0; i < 5; i++) expect((await sync(ctx, deckId)).status).toBe('error');
    expect((await deckRow(ctx, deckId)).syncState.consecutiveFailures).toBe(5);

    // … then it is back with an edited file, whose first import fails for a passing reason.
    source.error = null;
    source.token = 'c2';
    source.bytes = pptxBytes('renderer-bug');
    expect((await sync(ctx, deckId)).status).toBe('error');
    expect((await deckRow(ctx, deckId)).syncState).toMatchObject({
      failedToken: null,
      consecutiveFailures: 1,
      importFailures: { token: 'c2', count: 1 },
    });

    // The scheduler tries the same file again, and this time it imports.
    source.bytes = pptxBytes('v3');
    const scheduler = new SyncScheduler({
      db: ctx.deps.db,
      clock: ctx.clock,
      log: silentLogger,
      sync: ctx.deps.sync,
      config: ctx.deps.config,
    });
    for (let i = 0; i < 240; i++) {
      ctx.clock.advance(30_000);
      await scheduler.tick();
      await ctx.deps.queue.idle();
    }
    expect(await revisionRows(ctx, deckId)).toHaveLength(2);
    expect((await deckRow(ctx, deckId)).syncState).toMatchObject({
      consecutiveFailures: 0,
      failedToken: null,
      importFailures: null,
      lastSyncError: null,
    });
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

  it('a sync import that keeps killing the process is given up and its file skipped', async () => {
    const { ctx, source, deckId, pptx } = await setup(
      { v2: presentation(EDITED) },
      { config: { sync: { pollIntervalMs: 0, debounceMs: 0 } } },
    );
    const release = pptx.gate('v2');
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    const queued = await ctx.deps.sync.checkDeck(deckId);
    expect(queued).toMatchObject({ status: 'queued', revisionId: expect.any(String) });
    const revisionId = (queued as { revisionId: string }).revisionId;
    const attempts = async () =>
      (await ctx.deps.db.select().from(revisions).where(eq(revisions.id, revisionId)))[0]
        ?.importAttempts;
    // The held run counts before the file is even parsed – as a run the process dies in would.
    await vi.waitFor(async () => expect(await attempts()).toBe(1));

    // Two more runs died the same way; on the next start the import gives up.
    await ctx.deps.db
      .update(revisions)
      .set({ importAttempts: MAX_IMPORT_ATTEMPTS })
      .where(eq(revisions.id, revisionId));
    const [job] = await findInterruptedImports(ctx.deps.db);
    expect(job).toEqual({ deckId, revisionId, kind: 'sync' });
    await importDeck({ ...ctx.deps, openPptx: pptx.open, log: silentLogger }, job!);
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);
    expect((await deckRow(ctx, deckId)).syncState).toMatchObject({
      failedToken: 'c2',
      lastSyncError: {
        code: 'parse_failed',
        message: expect.stringMatching(/mehrmals abgebrochen/),
      },
    });
    expect(await findInterruptedImports(ctx.deps.db)).toEqual([]);

    release();
    await ctx.deps.queue.idle();
  });

  it('a resumed sync import removes the slide images of the run that was cut off', async () => {
    const { ctx, source, deckId, pptx } = await setup(
      { v2: presentation(EDITED) },
      { config: { sync: { pollIntervalMs: 0, debounceMs: 0 } } },
    );
    const release = pptx.gate('v2');
    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    const queued = await ctx.deps.sync.checkDeck(deckId);
    const revisionId = (queued as { revisionId: string }).revisionId;
    // What an earlier run stored before the process went down.
    const stray = blobKeys.slideRender(deckId, revisionId, 'webp');
    await ctx.deps.storage.put(stray, new Uint8Array([1, 2, 3]));
    release();
    await ctx.deps.queue.idle();

    expect((await deckRow(ctx, deckId)).currentRevisionId).toBe(revisionId);
    expect(await ctx.deps.storage.get(stray)).toBeNull();
    const stored = await ctx.deps.storage.list(blobKeys.slideRenderPrefix(deckId, revisionId));
    expect(stored.length).toBeGreaterThan(0);
    for (const slide of await slidesOf(ctx, deckId)) {
      expect((await ctx.request(slide.imageUrl)).status).toBe(200);
    }
  });

  it('matches against fingerprints of the current code, not hashes stored by an older release', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(BASE_SLIDES) });
    const before = await slidesOf(ctx, deckId);
    const { currentRevisionId } = await deckRow(ctx, deckId);
    // What an older parser and renderer stored (e.g. slide numbers still in the text hash).
    await ctx.deps.db
      .update(slideVersions)
      .set({ textHash: 'old-text-hash', renderHash: 'old-render-hash', contentHash: null })
      .where(eq(slideVersions.revisionId, currentRevisionId ?? ''));
    // …and an older release recorded no fingerprint version.
    await ctx.deps.db
      .update(revisions)
      .set({ fingerprintVersion: null })
      .where(eq(revisions.id, currentRevisionId ?? ''));

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    const after = await slidesOf(ctx, deckId);
    expect(after.map((slide) => slide.id)).toEqual(before.map((slide) => slide.id));
    expect(after.map((slide) => slide.change?.status ?? 'unchanged')).toEqual(
      after.map(() => 'unchanged'),
    );
  });

  it('uses the stored hashes of the current code without parsing the previous file again', async () => {
    const pptx = versionedPptx({ v1: presentation(BASE_SLIDES), v2: presentation(EDITED) });
    const open = vi.fn(pptx.open);
    const { ctx, source, deckId } = await setup({}, { openPptx: open });
    const [first] = await revisionRows(ctx, deckId);
    expect(first?.fingerprintVersion).toBe(FINGERPRINT_VERSION);
    const before = await slidesOf(ctx, deckId);
    open.mockClear();

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    // Only the new file: the previous revision's hashes were already this code's.
    expect(open).toHaveBeenCalledTimes(1);
    const after = await slidesOf(ctx, deckId);
    expect(after.map((slide) => slide.id)).toEqual(before.map((slide) => slide.id));
    expect(after[1]?.change?.status).toBe('modified');
    const latest = (await revisionRows(ctx, deckId)).find((rev) => rev.id !== first?.id);
    expect(latest?.fingerprintVersion).toBe(FINGERPRINT_VERSION);
  });

  it('falls back to the stored hashes when the previous file is gone', async () => {
    const { ctx, source, deckId } = await setup({ v2: presentation(EDITED) });
    const before = await slidesOf(ctx, deckId);
    const [current] = await revisionRows(ctx, deckId);
    await ctx.deps.storage.delete(current?.pptxKey ?? '');

    source.token = 'c2';
    source.bytes = pptxBytes('v2');
    expect((await sync(ctx, deckId)).status).toBe('updated');
    const after = await slidesOf(ctx, deckId);
    expect(after.map((slide) => slide.id)).toEqual(before.map((slide) => slide.id));
    expect(after[1]?.change?.status).toBe('modified');
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
      workspaceId: ctx.workspaceId,
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
