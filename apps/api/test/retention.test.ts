import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { blobDeletions, decks, sessions, workspaceInvites, workspaces } from '../src/db/schema';
import { RecordingMailer } from '../src/mail/mailer';
import { retryBlobDeletions } from '../src/services/blob-deletions';
import { deleteDeck } from '../src/services/decks';
import { purgeEmptyWorkspaces, purgeStaleRows } from '../src/services/retention';
import { addMonths } from '../src/services/retention-rules';
import { sweepUnusedDecks } from '../src/services/unused-decks';
import { setUnusedDeletionSince, unusedDeletionSince } from '../src/services/unused-deletion';
import { blobKeys } from '../src/storage/blob-storage';
import { createReadyDeck, createTestContext, signedInUser, type TestContext } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
let ctx: TestContext;
let mailer: RecordingMailer;

beforeEach(async () => {
  mailer = new RecordingMailer();
  ctx = await createTestContext({
    instanceAdmin: true,
    mailer,
    config: { retention: { deleteUnused: true } },
  });
});
afterEach(() => ctx.cleanup());

describe('files that could not be deleted (BER-143)', () => {
  it('are noted and deleted by the hourly retry', async () => {
    const deck = await createReadyDeck(ctx, { title: 'Weg' });
    const prefix = blobKeys.deckPrefix(deck.deckId);
    await ctx.deps.storage.put(`${prefix}x.bin`, new Uint8Array(3));
    const storage = ctx.deps.storage;
    const deletePrefix = storage.deletePrefix.bind(storage);
    storage.deletePrefix = () => Promise.reject(new Error('storage down'));

    await deleteDeck(ctx.deps, deck.deckId);
    expect(await ctx.deps.db.select().from(decks).where(eq(decks.id, deck.deckId))).toEqual([]);
    expect(await storage.list(prefix)).not.toEqual([]);
    expect(await ctx.deps.db.select().from(blobDeletions)).toEqual([
      expect.objectContaining({ store: 'storage', key: prefix, prefix: true }),
    ]);

    await retryBlobDeletions(ctx.deps);
    expect(await ctx.deps.db.select().from(blobDeletions)).toHaveLength(1);
    storage.deletePrefix = deletePrefix;
    await retryBlobDeletions(ctx.deps);
    expect(await storage.list(prefix)).toEqual([]);
    expect(await ctx.deps.db.select().from(blobDeletions)).toEqual([]);
  });
});

describe('organisations without members (BER-145)', () => {
  it('are purged once they are a day old; ones with members stay', async () => {
    const now = ctx.clock.now().getTime();
    const org = (id: string, createdAt: Date) =>
      ctx.deps.db.insert(workspaces).values({ id, name: id, slug: id, createdAt });
    await org('left-over', new Date(now - 2 * DAY));
    await org('just-created', new Date(now - 1000));
    const deck = await createReadyDeck(ctx, { title: 'Übrig' });
    await ctx.deps.db
      .update(decks)
      .set({ workspaceId: 'left-over' })
      .where(eq(decks.id, deck.deckId));

    await purgeEmptyWorkspaces(ctx.deps);

    const left = await ctx.deps.db.select({ id: workspaces.id }).from(workspaces);
    expect(left.map((row) => row.id).sort()).toEqual(['just-created', ctx.workspaceId].sort());
    expect(await ctx.deps.db.select().from(decks).where(eq(decks.id, deck.deckId))).toEqual([]);
  });
});

describe('stale rows (BER-143)', () => {
  it('drops invitations 30 days after they ended, and expired sessions', async () => {
    const now = ctx.clock.now().getTime();
    const invite = (id: string, fields: Partial<typeof workspaceInvites.$inferInsert>) =>
      ctx.deps.db.insert(workspaceInvites).values({
        id,
        workspaceId: ctx.workspaceId,
        email: `${id}@firma.de`,
        role: 'member',
        tokenHash: id,
        expiresAt: new Date(now + DAY),
        ...fields,
      });
    await invite('open', {});
    await invite('expired-lately', { expiresAt: new Date(now - 10 * DAY) });
    await invite('expired-long', { expiresAt: new Date(now - 31 * DAY) });
    await invite('accepted-long', { acceptedAt: new Date(now - 31 * DAY) });
    await invite('revoked-long', { revokedAt: new Date(now - 31 * DAY) });
    const person = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    await ctx.deps.db
      .update(sessions)
      .set({ expiresAt: new Date(now - 1000) })
      .where(eq(sessions.userId, person.user.id));

    await purgeStaleRows(ctx.deps);

    const left = await ctx.deps.db.select({ id: workspaceInvites.id }).from(workspaceInvites);
    expect(left.map((row) => row.id).sort()).toEqual(['expired-lately', 'open']);
    expect(
      await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, person.user.id)),
    ).toEqual([]);
  });
});

describe('unused decks (BER-143)', () => {
  // On for long already: the grace after switching it on is over.
  beforeEach(() => setUnusedDeletionSince(ctx.deps, new Date(0)));

  /** A deck nobody used for `months` months. */
  async function unusedDeck(months: number) {
    const deck = await createReadyDeck(ctx, { title: 'Alt' });
    const usedAt = addMonths(ctx.clock.now(), -months);
    await ctx.deps.db
      .update(decks)
      .set({ createdAt: usedAt, updatedAt: usedAt, lastViewedAt: usedAt })
      .where(eq(decks.id, deck.deckId));
    return { ...deck, deadline: addMonths(usedAt, 18) };
  }
  const moveTo = (time: number) => ctx.clock.advance(time - ctx.clock.now().getTime());
  const subjects = () => mailer.sent.map((mail) => mail.subject);

  it('reminds the owner a month, a week and a day before, then deletes deck and files', async () => {
    const deck = await unusedDeck(17);
    const keepRecent = await createReadyDeck(ctx, { title: 'Neu' });
    await sweepUnusedDecks(ctx.deps);
    await sweepUnusedDecks(ctx.deps);
    expect(subjects()).toEqual(['„Alt“ wird in einem Monat gelöscht']);
    expect(mailer.sent[0]?.to).toBe('robert@example.org');
    expect(mailer.sent[0]?.text).toContain(`/d/${deck.deckId}`);

    moveTo(deck.deadline.getTime() - 7 * DAY);
    await sweepUnusedDecks(ctx.deps);
    moveTo(deck.deadline.getTime() - DAY);
    await sweepUnusedDecks(ctx.deps);
    expect(subjects().slice(1)).toEqual([
      '„Alt“ wird in einer Woche gelöscht',
      '„Alt“ wird morgen gelöscht',
    ]);

    moveTo(deck.deadline.getTime());
    expect(await sweepUnusedDecks(ctx.deps)).toEqual({ reminded: [], deleted: [deck.deckId] });
    expect(await ctx.deps.db.select().from(decks).where(eq(decks.id, deck.deckId))).toEqual([]);
    expect(await ctx.deps.storage.list(blobKeys.deckPrefix(deck.deckId))).toEqual([]);
    expect(
      await ctx.deps.db.select().from(decks).where(eq(decks.id, keepRecent.deckId)),
    ).toHaveLength(1);
  });

  it('reminds the admins instead of an owner removed from the organisation', async () => {
    const deck = await unusedDeck(17);
    const gone = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    await ctx.deps.db.update(decks).set({ ownerId: gone.user.id }).where(eq(decks.id, deck.deckId));
    await sweepUnusedDecks(ctx.deps);
    expect(mailer.sent.map((mail) => mail.to)).toEqual(['robert@example.org']);
  });

  it('opening it once keeps it; reminders from before no longer count', async () => {
    const deck = await unusedDeck(17);
    await sweepUnusedDecks(ctx.deps);
    expect(mailer.sent).toHaveLength(1);
    ctx.clock.advance(DAY);
    expect((await ctx.request(`/api/decks/${deck.deckId}`)).status).toBe(200);
    // Nearly 18 months later it is unused again: the reminders start from the beginning.
    ctx.clock.advance(addMonths(ctx.clock.now(), 17).getTime() - ctx.clock.now().getTime() + DAY);
    await sweepUnusedDecks(ctx.deps);
    expect(mailer.sent.at(-1)?.subject).toBe('„Alt“ wird in einem Monat gelöscht');
    expect(await ctx.deps.db.select().from(decks).where(eq(decks.id, deck.deckId))).toHaveLength(1);
  });

  it('counts from switching it on at the earliest: nothing goes right away', async () => {
    await ctx.cleanup();
    mailer = new RecordingMailer();
    const retention = { deleteUnused: false };
    ctx = await createTestContext({ instanceAdmin: true, mailer, config: { retention } });
    const deck = await unusedDeck(40);
    expect(await sweepUnusedDecks(ctx.deps)).toEqual({ reminded: [], deleted: [] });
    expect(await unusedDeletionSince(ctx.deps)).toBeNull();

    retention.deleteUnused = true;
    expect(await sweepUnusedDecks(ctx.deps)).toEqual({ reminded: [], deleted: [] });
    const switchedOn = await unusedDeletionSince(ctx.deps);
    if (!switchedOn) throw new Error('not noted');
    const deadline = addMonths(switchedOn, 18);
    moveTo(addMonths(deadline, -1).getTime());
    await sweepUnusedDecks(ctx.deps);
    expect(subjects()).toEqual(['„Alt“ wird in einem Monat gelöscht']);
    moveTo(deadline.getTime() - 60_000);
    expect((await sweepUnusedDecks(ctx.deps)).deleted).toEqual([]);
    moveTo(deadline.getTime());
    expect((await sweepUnusedDecks(ctx.deps)).deleted).toEqual([deck.deckId]);

    // Switched off, the noted time goes: switching on again grants a new grace.
    retention.deleteUnused = false;
    await sweepUnusedDecks(ctx.deps);
    retention.deleteUnused = true;
    expect((await unusedDeletionSince(ctx.deps))?.getTime()).toBeGreaterThanOrEqual(
      deadline.getTime(),
    );
  });
});
