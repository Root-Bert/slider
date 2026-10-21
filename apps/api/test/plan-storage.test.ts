import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PptxError } from '@slider/pptx';
import { workspaceUsageDetailsSchema, type WorkspaceRole } from '@slider/shared';
import type { Config } from '../src/config';
import {
  decks,
  media,
  revisions,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from '../src/db/schema';
import { MAX_IMPORT_ATTEMPTS } from '../src/import/attempts';
import { findInterruptedImports } from '../src/import/import-deck';
import type { OpenPptx } from '../src/import/pptx';
import { measureDeckFiles } from '../src/services/deck-storage';
import { DEFAULT_PLAN_LIMITS } from '../src/services/plans';
import { backfillDeckFilesBytes, workspaceStorageUsage } from '../src/services/workspace-storage';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  stubPptx,
  type TestContext,
} from './helpers';
import { pptxBytes } from './sync-helpers';

/** BER-151: storage counted per organisation. BER-155: locked while over a limit. */

let ctx: TestContext;
afterEach(() => ctx.cleanup());

const setup = async (
  maxStorageBytes: number | null = 2 * 1024 ** 3,
  extra: Partial<Config> = {},
) => {
  ctx = await createTestContext({
    config: {
      plans: { ...DEFAULT_PLAN_LIMITS, free: { maxMembers: 5, maxDecks: 3, maxStorageBytes } },
      ...extra,
    },
  });
};

async function person(name: string, role: WorkspaceRole = 'member') {
  const user = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: user.user.id, role });
  return user;
}

const addMedia = (
  deckId: string,
  commentId: string,
  kind: 'audio' | 'video' | 'image',
  bytes: number,
  ownerId: string,
) =>
  ctx.deps.db.insert(media).values({
    id: crypto.randomUUID(),
    deckId,
    commentId,
    ownerId,
    uploaderId: ownerId,
    kind,
    mimeType: kind === 'image' ? 'image/png' : `${kind}/webm`,
    sizeBytes: bytes,
    durationMs: 0,
    storageKey: `decks/${deckId}/media/${crypto.randomUUID()}.webm`,
    sha256: 'x',
  });

async function comment(deckId: string, slideId: string, cookie?: string) {
  const res = await ctx.request(`/api/decks/${deckId}/comments`, {
    method: 'POST',
    json: pinComment(slideId),
    cookie,
  });
  return res;
}

const upload = (bytes = pptxBytes('v1')) => {
  const form = new FormData();
  form.append('file', new File([bytes], 'Neu.pptx'));
  form.append('workspaceId', ctx.workspaceId);
  return ctx.request(`/api/decks/upload?workspaceId=${ctx.workspaceId}`, {
    method: 'POST',
    body: form,
  });
};

const usage = async () =>
  workspaceUsageDetailsSchema.parse(
    await (await ctx.request(`/api/workspaces/${ctx.workspaceId}/usage`)).json(),
  );

describe('storage per organisation (BER-151)', () => {
  it('adds up files and recordings of every review by kind, whoever uploaded them', async () => {
    await setup();
    const one = await createReadyDeck(ctx, { slideCount: 2 });
    const two = await createReadyDeck(ctx, { slideCount: 1 });
    await ctx.deps.storage.put(
      `decks/${one.deckId}/${one.revisionId}/source-a.pptx`,
      new Uint8Array(100),
    );
    await measureDeckFiles(ctx.deps, one.deckId);
    await measureDeckFiles(ctx.deps, two.deckId);

    const ada = await person('Ada');
    const posted = (await (await comment(one.deckId, one.slideIds[0]!, ada.cookie)).json()) as {
      id: string;
    };
    await addMedia(one.deckId, posted.id, 'audio', 1000, ada.user.id);
    const other = (await (await comment(two.deckId, two.slideIds[0]!)).json()) as { id: string };
    await addMedia(two.deckId, other.id, 'video', 3000, ctx.ownerId);
    await addMedia(two.deckId, other.id, 'image', 500, ctx.ownerId);

    const breakdown = await workspaceStorageUsage(ctx.deps.db, ctx.workspaceId);
    expect(breakdown).toMatchObject({ audio: 1000, videos: 3000, images: 500, originals: 100 });
    // Three stored "<svg/>" renders, six bytes each – and their size is what the store reports.
    expect(breakdown.slideImages).toBeGreaterThan(0);

    const details = await usage();
    expect(details.storage).toEqual(breakdown);
    expect(details.usage.storageBytes).toBe(
      Object.values(breakdown).reduce((sum, bytes) => sum + bytes, 0),
    );
    expect(details.usage.maxStorageBytes).toBe(2 * 1024 ** 3);
  });

  it('refuses an upload over the storage limit', async () => {
    const file = pptxBytes('v1');
    await setup();
    await createReadyDeck(ctx, { slideCount: 1 });
    const stored = (await usage()).usage.storageBytes;
    // Room for half the file: what is stored fits, the upload doesn't.
    ctx.deps.config.plans.free.maxStorageBytes = stored + Math.floor(file.byteLength / 2);
    expect((await usage()).locked).toBe(false);
    const full = await upload();
    expect(full.status).toBe(403);
    expect(await full.json()).toMatchObject({
      error: {
        code: 'plan_limit',
        message: expect.stringMatching(/Speicher der Organisation ist voll/),
      },
    });
  });

  it('has no storage limit on a self-hosted instance', async () => {
    await setup(null);
    expect((await usage()).usage.maxStorageBytes).toBeNull();
  });
});

describe('lock mode over the limits (BER-155)', () => {
  it('blocks creating, allows reading and deleting, and ends once everything fits', async () => {
    await setup();
    const decksIn = [];
    for (let i = 0; i < 3; i++) decksIn.push(await createReadyDeck(ctx, { title: `Deck ${i}` }));
    const extra = await createReadyDeck(ctx, { title: 'Zu viel' });
    // Four of three: e.g. after falling back from paid.
    const [first] = decksIn;

    const details = await usage();
    expect(details.locked).toBe(true);

    const refused = await comment(first!.deckId, first!.slideIds[0]!);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: { code: 'plan_over_limit', message: expect.stringMatching(/4 von 3 Reviews/) },
    });
    const invite = await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
      method: 'POST',
      json: { email: 'neu@firma.de' },
    });
    expect(invite.status).toBe(403);
    const link = await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
      method: 'POST',
      json: {},
    });
    expect(link.status).toBe(403);
    expect((await upload()).status).toBe(403);

    // Reading works.
    expect((await ctx.request(`/api/decks/${first!.deckId}/comments`)).status).toBe(200);
    expect((await ctx.request(`/api/decks/${first!.deckId}`)).status).toBe(200);

    // Deleting a review brings it back into the limit: unlocked by itself.
    expect((await ctx.request(`/api/decks/${extra.deckId}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await usage()).locked).toBe(false);
    expect((await comment(first!.deckId, first!.slideIds[0]!)).status).toBe(201);
  });

  it('locks over the seat limit until invites are withdrawn, and never when paid', async () => {
    await setup();
    for (const name of ['Ada', 'Ben', 'Cleo', 'Dora']) await person(name);
    const deck = await createReadyDeck(ctx);
    const now = new Date();
    await ctx.deps.db.insert(workspaceInvites).values({
      id: 'inv-extra',
      workspaceId: ctx.workspaceId,
      email: 'extra@firma.de',
      role: 'member',
      tokenHash: 'hash-extra',
      createdBy: ctx.ownerId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    expect((await usage()).locked).toBe(true);
    expect((await comment(deck.deckId, deck.slideIds[0]!)).status).toBe(403);

    await ctx.deps.db
      .update(workspaces)
      .set({ plan: 'paid' })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect((await usage()).locked).toBe(false);
    expect((await comment(deck.deckId, deck.slideIds[0]!)).status).toBe(201);

    await ctx.deps.db
      .update(workspaces)
      .set({ plan: 'free' })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect(
      (await ctx.request('/api/workspace-invites/inv-extra', { method: 'DELETE' })).status,
    ).toBe(204);
    expect((await usage()).locked).toBe(false);
  });
});

/**
 * Imports under way hold their original's size (`revisions.reserved_bytes`): a deck is measured
 * only after its import, and two uploads at once must not both fit into the same rest.
 */
describe('storage reserved for imports under way (BER-151)', () => {
  /** Imports wait at `openPptx` while held; `fail` makes them fail like a corrupt file. */
  const gate = () => {
    let release = () => {};
    const state = { held: null as Promise<void> | null, fail: false };
    const stub = stubPptx();
    const openPptx: OpenPptx = async (bytes) => {
      if (state.held) await state.held;
      if (state.fail) throw new PptxError('corrupt', 'broken');
      return stub(bytes);
    };
    return {
      openPptx,
      state,
      hold: () => {
        state.held = new Promise<void>((resolve) => (release = resolve));
      },
      release: () => {
        state.held = null;
        release();
      },
    };
  };

  const setupGated = async (imports: ReturnType<typeof gate>) => {
    ctx = await createTestContext({
      openPptx: imports.openPptx,
      config: {
        plans: {
          ...DEFAULT_PLAN_LIMITS,
          free: { maxMembers: 5, maxDecks: 10, maxStorageBytes: null },
        },
      },
    });
  };
  const limitStorage = (maxStorageBytes: number | null) => {
    ctx.deps.config.plans.free = { ...ctx.deps.config.plans.free, maxStorageBytes };
  };
  const reservations = async () =>
    (await ctx.deps.db.select({ bytes: revisions.reservedBytes }).from(revisions))
      .map((row) => row.bytes)
      .filter((bytes) => bytes !== null);
  /** Until the import (held at `openPptx`) runs. */
  const running = async (deckId: string) => {
    for (let i = 0; i < 100; i++) {
      const [row] = await ctx.deps.db
        .select({ state: decks.importState })
        .from(decks)
        .where(eq(decks.id, deckId));
      if (row?.state.status === 'running') return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Import of ${deckId} never started`);
  };

  it('counts an upload still importing, so a second one at once is refused', async () => {
    const imports = gate();
    await setupGated(imports);
    const first = pptxBytes('erste Datei');
    const second = pptxBytes('zweite Datei');
    const stored = (await usage()).usage.storageBytes;
    // Room for either file, not for both.
    limitStorage(stored + first.byteLength + second.byteLength - 1);

    imports.hold();
    const created = await upload(first);
    expect(created.status).toBe(201);
    const { id: deckId } = (await created.json()) as { id: string };
    await running(deckId);
    expect(await reservations()).toEqual([first.byteLength]);
    // Shown as well, as an original: the numbers don't jump once the import is measured.
    const during = await usage();
    expect(during.usage.storageBytes).toBe(stored + first.byteLength);
    expect(during.storage.originals).toBe(first.byteLength);
    expect(during.locked).toBe(false);
    // A measurement meanwhile neither counts the original twice nor ends the reservation.
    await measureDeckFiles(ctx.deps, deckId);
    expect((await usage()).usage.storageBytes).toBe(stored + first.byteLength);

    const refused = await upload(second);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: { code: 'plan_limit', message: expect.stringMatching(/Speicher der Organisation/) },
    });

    // The import is over: its real files count instead, the reservation is gone.
    imports.release();
    await ctx.deps.queue.idle();
    expect(await reservations()).toEqual([]);
    const after = await usage();
    // Encrypted at rest: the stored original is a little bigger than the upload.
    expect(after.storage.originals).toBeGreaterThanOrEqual(first.byteLength);
    expect(after.storage.slideImages).toBeGreaterThan(0);
  });

  it('serialises two new versions at once: the second is refused', async () => {
    const imports = gate();
    await setupGated(imports);
    const ids: string[] = [];
    for (const name of ['a', 'b']) {
      const res = await upload(pptxBytes(`deck ${name}`));
      ids.push(((await res.json()) as { id: string }).id);
    }
    await ctx.deps.queue.idle();
    const [a, b] = ids as [string, string];
    const v2a = pptxBytes('deck a, version 2');
    const v2b = pptxBytes('deck b, version 2');
    const stored = (await usage()).usage.storageBytes;
    limitStorage(stored + v2a.byteLength + v2b.byteLength - 1);

    const newVersion = (deckId: string, bytes: Uint8Array<ArrayBuffer>) => {
      const form = new FormData();
      form.append('file', new File([bytes], 'Neu.pptx'));
      return ctx.request(`/api/decks/${deckId}/revisions`, { method: 'POST', body: form });
    };
    imports.hold();
    // Answers once the import is done (or after a while): not awaited yet.
    const firstVersion = newVersion(a, v2a);
    for (let i = 0; i < 100 && (await reservations()).length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(await reservations()).toEqual([v2a.byteLength]);
    const refused = await newVersion(b, v2b);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'plan_limit' } });

    imports.release();
    expect((await firstVersion).status).toBe(200);
    await ctx.deps.queue.idle();
    expect(await reservations()).toEqual([]);
  });

  it('ends the reservation of a failed import; its original still counts', async () => {
    const imports = gate();
    await setupGated(imports);
    imports.state.fail = true;
    const file = pptxBytes('kaputt');
    const res = await upload(file);
    expect(res.status).toBe(201);
    await ctx.deps.queue.idle();
    const [deck] = await ctx.deps.db.select().from(decks);
    expect(deck?.importState.status).toBe('failed');
    expect(await reservations()).toEqual([]);
    expect((await usage()).storage.originals).toBeGreaterThanOrEqual(file.byteLength);
  });

  it('keeps the reservation across a restart, and ends it once the import gives up', async () => {
    const imports = gate();
    await setupGated(imports);
    const file = pptxBytes('stürzt ab');
    const res = await upload(file);
    const { id: deckId } = (await res.json()) as { id: string };
    await ctx.deps.queue.idle();
    // The process died during the import: still `running`, the reservation still held, its
    // runs used up.
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    await ctx.deps.db
      .update(decks)
      .set({ importState: { status: 'running', step: 'parsing', progress: null } })
      .where(eq(decks.id, deckId));
    await ctx.deps.db
      .update(revisions)
      .set({ reservedBytes: file.byteLength, importAttempts: MAX_IMPORT_ATTEMPTS })
      .where(eq(revisions.id, deck!.currentRevisionId!));

    // Start: the measurement of decks with reservations leaves an import under way alone.
    await backfillDeckFilesBytes(ctx.deps);
    expect(await reservations()).toEqual([file.byteLength]);
    const jobs = await findInterruptedImports(ctx.deps.db);
    expect(jobs).toHaveLength(1);
    for (const job of jobs) await ctx.deps.queue.run(job);
    const [failed] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    expect(failed?.importState.status).toBe('failed');
    expect(await reservations()).toEqual([]);
  });

  it('ends a reservation left behind by a failed measurement at the next start', async () => {
    const imports = gate();
    await setupGated(imports);
    const res = await upload(pptxBytes('fertig'));
    const { id: deckId } = (await res.json()) as { id: string };
    await ctx.deps.queue.idle();
    const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
    await ctx.deps.db
      .update(revisions)
      .set({ reservedBytes: 1_000 })
      .where(eq(revisions.id, deck!.currentRevisionId!));
    const counted = (await usage()).usage.storageBytes;

    await backfillDeckFilesBytes(ctx.deps);
    expect(await reservations()).toEqual([]);
    expect((await usage()).usage.storageBytes).toBe(counted - 1_000);
  });
});
