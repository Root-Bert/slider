import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { count, eq, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { DELETED_ACCOUNT_NAME, type Author, type WorkspaceRole } from '@slider/shared';
import {
  appConnections,
  comments,
  decks,
  deletedPptxComments,
  materialChatMessages,
  materialChats,
  materialQuestions,
  media,
  revisions,
  sessions,
  slides,
  slideVersions,
  userIdentities,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from '../src/db/schema';
import { hashToken } from '../src/auth/session';
import { ensurePersonalWorkspace } from '../src/services/workspaces';
import { RecordingMailer } from '../src/mail/mailer';
import { deleteAccount } from '../src/services/account-deletion';
import { sweepUnusedAccounts } from '../src/services/unused-accounts';
import { setUnusedDeletionSince, unusedDeletionSince } from '../src/services/unused-deletion';
import { blobKeys } from '../src/storage/blob-storage';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type TestContext,
} from './helpers';

let ctx: TestContext;
const DELETE_UNUSED = { retention: { deleteUnused: true } };

beforeEach(async () => {
  ctx = await createTestContext({ instanceAdmin: true });
});
afterEach(() => ctx.cleanup());

async function join(userId: string, workspaceId: string, role: WorkspaceRole) {
  await ctx.deps.db.insert(workspaceMembers).values({ workspaceId, userId, role });
}

async function anna() {
  const person = await signedInUser(ctx, { name: 'Anna Schmidt', email: 'anna@firma.de' });
  await join(person.user.id, ctx.workspaceId, 'member');
  return person;
}

async function comment(deckId: string, slideId: string, body: string, cookie?: string) {
  const res = await ctx.request(`/api/decks/${deckId}/comments`, {
    method: 'POST',
    json: pinComment(slideId, body),
    cookie,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A 50-byte voice recording (or drawing) on `commentId`, recorded by `uploaderId`. */
async function recording(
  deckId: string,
  commentId: string,
  uploaderId: string,
  kind: 'audio' | 'image' = 'audio',
) {
  const id = crypto.randomUUID();
  const storageKey = blobKeys.media(deckId, id, kind === 'audio' ? 'webm' : 'png');
  await ctx.deps.media.put(storageKey, new Uint8Array(50));
  await ctx.deps.db.insert(media).values({
    id,
    deckId,
    commentId,
    ownerId: ctx.ownerId,
    uploaderId,
    kind,
    mimeType: kind === 'audio' ? 'audio/webm' : 'image/png',
    sizeBytes: 50,
    durationMs: kind === 'audio' ? 1000 : 0,
    storageKey,
    sha256: 'x',
  });
  return storageKey;
}

const deleteMe = (cookie: string, confirmEmail: string) =>
  ctx.request('/api/me', { method: 'DELETE', json: { confirmEmail }, cookie });

const rowCount = async (query: Promise<{ count: number }[]>) => (await query)[0]?.count ?? 0;

describe('data export (BER-145)', () => {
  it('zips profile, own and taken-over decks with their files, own comments and recordings – no secrets; uploads passed on with a removal stay out', async () => {
    const person = await anna();
    const own = await createReadyDeck(ctx, { title: 'Annas Deck' });
    const pptxKey = blobKeys.pptx(own.deckId, own.revisionId);
    await ctx.deps.storage.put(pptxKey, new TextEncoder().encode('PPTX'));
    await ctx.deps.db.update(revisions).set({ pptxKey }).where(eq(revisions.id, own.revisionId));
    await ctx.deps.db
      .update(decks)
      .set({ ownerId: person.user.id })
      .where(eq(decks.id, own.deckId));
    // A linked deck taken over: the workspace decides, not the source.
    const inherited = await createReadyDeck(ctx, { title: 'Geerbt' });
    const inheritedKey = blobKeys.pptx(inherited.deckId, inherited.revisionId);
    await ctx.deps.storage.put(inheritedKey, new TextEncoder().encode('Geerbt'));
    await ctx.deps.db
      .update(revisions)
      .set({ pptxKey: inheritedKey })
      .where(eq(revisions.id, inherited.revisionId));
    await ctx.deps.db
      .update(decks)
      .set({
        ownerId: person.user.id,
        linkedById: ctx.ownerId,
        source: 'sharepoint',
        sourceRef: `drives/b!lib/items/${inherited.deckId}`,
        // Linked before links with credentials were refused: they stay stored, never shown.
        sourceUrl: 'https://anna:geheim@firma.sharepoint.com/Geerbt',
      })
      .where(eq(decks.id, inherited.deckId));
    const other = await createReadyDeck(ctx, { title: 'Roberts Deck' });
    const commentId = await comment(
      other.deckId,
      other.slideIds[0] ?? '',
      'Folie 1 ist zu voll.',
      person.cookie,
    );
    await recording(other.deckId, commentId, person.user.id);
    await comment(other.deckId, other.slideIds[0] ?? '', 'Von Robert');
    await ctx.deps.db.insert(workspaceInvites).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      email: 'Anna@Firma.de',
      role: 'member',
      tokenHash: crypto.randomUUID(),
      createdBy: ctx.ownerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    // A KI-App let in for the workspace, and a question about a deck's material.
    const appHash = hashToken('slider_pat_anna');
    await ctx.deps.db.insert(appConnections).values({
      id: crypto.randomUUID(),
      userId: person.user.id,
      kind: 'token',
      name: 'Claude Code',
      workspaceId: ctx.workspaceId,
      accessHash: appHash,
    });
    const noteId = crypto.randomUUID();
    await ctx.request(`/api/decks/${other.deckId}/board/items`, {
      method: 'POST',
      cookie: person.cookie,
      json: {
        id: noteId,
        kind: 'box',
        text: 'Wie stark wächst der Markt?',
        x: 0,
        y: 0,
        w: 200,
        h: 120,
      },
    });
    await ctx.deps.db.insert(materialQuestions).values({
      id: crypto.randomUUID(),
      deckId: other.deckId,
      noteId,
      userId: person.user.id,
      question: 'Wie stark wächst der Markt?',
      answer: 'Um **12 Prozent**.',
      state: 'done',
    });
    const chatId = crypto.randomUUID();
    await ctx.deps.db.insert(materialChats).values({
      id: chatId,
      deckId: other.deckId,
      userId: person.user.id,
      title: 'Wer sind die Wettbewerber?',
    });
    await ctx.deps.db.insert(materialChatMessages).values([
      { id: crypto.randomUUID(), chatId, seq: 1, role: 'user', text: 'Wer sind die Wettbewerber?' },
      {
        id: crypto.randomUUID(),
        chatId,
        seq: 2,
        role: 'assistant',
        text: 'Vor allem zwei.',
        state: 'done',
      },
    ]);

    const res = await ctx.request('/api/me/export', { cookie: person.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="slider-daten-/);

    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const read = async (name: string) => JSON.parse((await zip.file(name)?.async('string')) ?? '');
    const account = await read('konto.json');
    expect(account.profile).toMatchObject({ name: 'Anna Schmidt', email: 'anna@firma.de' });
    expect(account.workspaces).toEqual([
      expect.objectContaining({ id: ctx.workspaceId, role: 'member' }),
    ]);
    expect(account.sessions).toHaveLength(1);
    expect(account.aiApps).toEqual([
      expect.objectContaining({
        name: 'Claude Code',
        kind: 'token',
        workspace: { id: ctx.workspaceId, name: expect.any(String) },
        lastUsedAt: null,
      }),
    ]);
    expect(await read('fragen.json')).toEqual([
      expect.objectContaining({
        deck: { id: other.deckId, title: 'Roberts Deck' },
        question: 'Wie stark wächst der Markt?',
        answer: 'Um **12 Prozent**.',
      }),
    ]);
    expect(await read('ki-chats.json')).toEqual([
      expect.objectContaining({
        deck: { id: other.deckId, title: 'Roberts Deck' },
        title: 'Wer sind die Wettbewerber?',
        messages: [
          expect.objectContaining({ role: 'du', text: 'Wer sind die Wettbewerber?' }),
          expect.objectContaining({ role: 'KI', text: 'Vor allem zwei.', state: 'done' }),
        ],
      }),
    ]);
    const deckList = (await read('praesentationen.json')) as {
      title: string;
      file: string;
      sourceUrl?: string;
    }[];
    expect(deckList.map((deck) => deck.title).sort()).toEqual(['Annas Deck', 'Geerbt']);
    const ownEntry = deckList.find((deck) => deck.title === 'Annas Deck')!;
    expect(await zip.file(ownEntry.file)?.async('string')).toBe('PPTX');
    const inheritedEntry = deckList.find((deck) => deck.title === 'Geerbt')!;
    expect(inheritedEntry.sourceUrl).toBe('https://firma.sharepoint.com/Geerbt');
    expect(await zip.file(inheritedEntry.file)?.async('string')).toBe('Geerbt');
    const written = await read('kommentare.json');
    expect(written.map((c: { body: string }) => c.body)).toEqual(['Folie 1 ist zu voll.']);
    const recordings = await read('aufnahmen.json');
    expect(recordings).toHaveLength(1);
    expect(zip.file(recordings[0].file)).not.toBeNull();
    expect(await read('einladungen.json')).toEqual([
      expect.objectContaining({ email: 'Anna@Firma.de', role: 'member' }),
    ]);

    const everything = await Promise.all(
      Object.values(zip.files).map((file) => file.async('string')),
    );
    expect(everything.join('\n')).not.toMatch(/token_hash|refreshToken|publicKey|geheim/);
    expect(everything.join('\n')).not.toContain(appHash);

    // Removed from the workspace: the upload is the workspace's now (BER-165).
    const removed = await ctx.request(
      `/api/workspaces/${ctx.workspaceId}/members/${person.user.id}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(204);
    const after = await JSZip.loadAsync(
      await (await ctx.request('/api/me/export', { cookie: person.cookie })).arrayBuffer(),
    );
    const afterList = JSON.parse(
      (await after.file('praesentationen.json')?.async('string')) ?? '',
    ) as { title: string }[];
    expect(afterList.map((deck) => deck.title)).not.toContain('Annas Deck');
    expect(after.file(ownEntry.file)).toBeNull();
  });
});

describe('own account settings', () => {
  it('removing a login signs out everywhere else; renaming renames the comments, an empty name is refused', async () => {
    const here = await anna();
    const elsewhere = await signedInUser(ctx, { name: 'Anna Schmidt', email: 'anna@firma.de' });
    await ctx.deps.db.insert(userIdentities).values([
      { provider: 'google', subject: 'g-anna', userId: here.user.id, email: 'anna@firma.de' },
      { provider: 'oidc', subject: 'o-anna', userId: here.user.id, email: 'anna@firma.de' },
    ]);
    const res = await ctx.request('/api/me/identities/google:g-anna', {
      method: 'DELETE',
      cookie: here.cookie,
    });
    expect(res.status).toBe(204);
    // Only this browser's session is left.
    const left = await ctx.deps.db
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(eq(sessions.userId, here.user.id));
    expect(left).toHaveLength(1);
    expect(left[0]?.tokenHash).toBe(hashToken(here.cookie.split('=')[1] ?? ''));
    expect(elsewhere.cookie).not.toBe(here.cookie);

    // Correcting the own name (BER-145).
    const deck = await createReadyDeck(ctx);
    const commentId = await comment(deck.deckId, deck.slideIds[0] ?? '', 'Hallo', here.cookie);
    const rename = (name: string) =>
      ctx.request('/api/me', { method: 'PATCH', json: { name }, cookie: here.cookie });
    expect((await rename('   ')).status).toBe(400);
    const renamed = await rename('  Anna Becker ');
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { user: { name: string } }).user.name).toBe('Anna Becker');
    const [row] = await ctx.deps.db.select().from(comments).where(eq(comments.id, commentId));
    expect((row?.author as Author).name).toBe('Anna Becker');
  });
});

describe('deleting an account (BER-145)', () => {
  it('wants the own e-mail address and a fresh sign-in; refuses the only instance admin and the dev owner', async () => {
    await ctx.deps.db.update(users).set({ isInstanceAdmin: false });
    const person = await anna();
    const userCount = () => rowCount(ctx.deps.db.select({ count: count() }).from(users));
    expect((await deleteMe(person.cookie, 'falsch@firma.de')).status).toBe(400);
    expect(await userCount()).toBe(2);

    await ctx.deps.db
      .update(users)
      .set({ isInstanceAdmin: true })
      .where(eq(users.id, person.user.id));
    expect((await deleteMe(person.cookie, 'anna@firma.de')).status).toBe(400);
    // No cookie: the dev owner of the dev login.
    expect(
      (
        await ctx.request('/api/me', {
          method: 'DELETE',
          json: { confirmEmail: 'robert@example.org' },
        })
      ).status,
    ).toBe(400);
    await ctx.deps.db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, ctx.ownerId));

    // A session left open somewhere deletes nothing.
    ctx.clock.advance(11 * 60_000);
    const stale = await deleteMe(person.cookie, 'anna@firma.de');
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: 'reauth_required' } });
    expect(await userCount()).toBe(2);
  });

  it('anonymises comments, deletes recordings, hands decks over and removes everything personal', async () => {
    const person = await anna();
    const annaId = person.user.id;
    // Her own workspace, alone, with a deck: gone with her.
    const soloId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaces).values({ id: soloId, name: 'Privat', slug: 'privat' });
    await join(annaId, soloId, 'admin');
    const solo = await createReadyDeck(ctx, { title: 'Privat' });
    await ctx.deps.db
      .update(decks)
      .set({ ownerId: annaId, workspaceId: soloId })
      .where(eq(decks.id, solo.deckId));
    // Her upload in the shared workspace: passes to the admin.
    const upload = await createReadyDeck(ctx, { title: 'Annas Upload' });
    await ctx.deps.db.update(decks).set({ ownerId: annaId }).where(eq(decks.id, upload.deckId));
    // Her linked deck there: deleted – Slider read its file with her accounts (BER-165).
    const linked = await createReadyDeck(ctx, { title: 'Annas SharePoint' });
    await ctx.deps.db
      .update(decks)
      .set({
        ownerId: annaId,
        linkedById: annaId,
        source: 'sharepoint',
        sourceRef: 'drives/b!lib/items/anna',
      })
      .where(eq(decks.id, linked.deckId));
    // Her comment with a recording on Robert's deck, resolved by her; Robert mentions her.
    const roberts = await createReadyDeck(ctx, { title: 'Roberts Deck' });
    const slideId = roberts.slideIds[0] ?? '';
    const annasComment = await comment(roberts.deckId, slideId, 'Zu viel Text.', person.cookie);
    const recordingKey = await recording(roberts.deckId, annasComment, annaId);
    const drawingKey = await recording(roberts.deckId, annasComment, annaId, 'image');
    await ctx.deps.db
      .update(comments)
      .set({ status: 'done', resolvedBy: annaId })
      .where(eq(comments.id, annasComment));
    const mention = await comment(
      roberts.deckId,
      slideId,
      'Danke @Anna Schmidt! Und @Anna Schmidtke?',
    );
    // An invitation to her address elsewhere.
    const elsewhere = await signedInUser(ctx, { name: 'Bob', email: 'bob@firma.de' });
    const bobsId = await ensurePersonalWorkspace(ctx.deps.db, elsewhere.user.id);
    await ctx.deps.db.insert(workspaceInvites).values({
      id: crypto.randomUUID(),
      workspaceId: bobsId,
      email: 'anna@firma.de',
      role: 'member',
      tokenHash: crypto.randomUUID(),
      createdBy: elsewhere.user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await deleteMe(person.cookie, ' Anna@Firma.de ');
    expect(res.status).toBe(204);

    const { db } = ctx.deps;
    expect(await db.select().from(users).where(eq(users.id, annaId))).toEqual([]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, annaId))).toEqual([]);
    expect(await db.select().from(workspaces).where(eq(workspaces.id, soloId))).toEqual([]);
    expect(await db.select().from(decks).where(eq(decks.id, solo.deckId))).toEqual([]);
    expect(await ctx.deps.storage.list(blobKeys.deckPrefix(solo.deckId))).toEqual([]);
    const [handedOver] = await db.select().from(decks).where(eq(decks.id, upload.deckId));
    expect(handedOver?.ownerId).toBe(ctx.ownerId);
    expect(await db.select().from(decks).where(eq(decks.id, linked.deckId))).toEqual([]);
    expect(await ctx.deps.storage.list(blobKeys.deckPrefix(linked.deckId))).toEqual([]);

    const [anonymous] = await db.select().from(comments).where(eq(comments.id, annasComment));
    const author = anonymous?.author as Author;
    expect(author).toMatchObject({ name: DELETED_ACCOUNT_NAME, type: 'deleted', color: 'deleted' });
    expect(author.id).not.toContain(annaId);
    expect(anonymous?.body).toBe('Zu viel Text.');
    expect(anonymous?.resolvedBy).toBe(author.id);
    expect(await db.select().from(media).where(eq(media.uploaderId, annaId))).toEqual([]);
    expect(await ctx.deps.media.get(recordingKey)).toBeNull();
    // Images go too (what a screenshot shows can't be anonymised); the comment text stays.
    expect(await db.select().from(media).where(eq(media.storageKey, drawingKey))).toEqual([]);
    expect(await ctx.deps.media.get(drawingKey)).toBeNull();
    const [mentioning] = await db.select().from(comments).where(eq(comments.id, mention));
    expect(mentioning?.body).toBe(`Danke @${DELETED_ACCOUNT_NAME}! Und @Anna Schmidtke?`);

    expect(
      await db
        .select()
        .from(workspaceInvites)
        .where(sql`lower(${workspaceInvites.email}) = 'anna@firma.de'`),
    ).toEqual([]);
    const leftovers = await db
      .select({ count: count() })
      .from(comments)
      .where(sql`${comments.author}::text like ${`%${annaId}%`}`);
    expect(leftovers[0]?.count).toBe(0);

    // The deck shows the comment under the deleted author.
    const list = (await (await ctx.request(`/api/decks/${roberts.deckId}/comments`)).json()) as {
      id: string;
      author: Author;
    }[];
    expect(list.find((c) => c.id === annasComment)?.author.name).toBe(DELETED_ACCOUNT_NAME);
  });

  it('asks who takes over where the account is the only admin, nothing goes before; workspaces it is the last member of close at once', async () => {
    const person = await anna();
    const teamId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaces).values({ id: teamId, name: 'Annas Team', slug: 'team' });
    await join(person.user.id, teamId, 'admin');
    const vera = await signedInUser(ctx, { name: 'Vera', email: 'vera@firma.de' });
    await join(vera.user.id, teamId, 'viewer');
    const bob = await signedInUser(ctx, { name: 'Bob', email: 'bob@firma.de' });
    await join(bob.user.id, teamId, 'member');
    // Alone here: nobody to choose, deleted – but not before the choice is complete.
    const soloId = crypto.randomUUID();
    await ctx.deps.db
      .insert(workspaces)
      .values({ id: soloId, name: 'Firma', slug: 'firma', joinDomain: 'firma.de' });
    await join(person.user.id, soloId, 'admin');

    const choices = await (await ctx.request('/api/me/deletion', { cookie: person.cookie })).json();
    expect(choices).toEqual([
      {
        workspaceId: teamId,
        workspaceName: 'Annas Team',
        // Viewers are guests: they take a workspace over only when nobody else is left.
        candidates: [{ userId: bob.user.id, name: 'Bob', role: 'member' }],
      },
    ]);

    const missing = await deleteMe(person.cookie, 'anna@firma.de');
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toContain(
      '„Annas Team“',
    );
    const stranger = await ctx.request('/api/me', {
      method: 'DELETE',
      json: { confirmEmail: 'anna@firma.de', successors: { [teamId]: ctx.ownerId } },
      cookie: person.cookie,
    });
    expect(stranger.status).toBe(400);
    const viewer = await ctx.request('/api/me', {
      method: 'DELETE',
      json: { confirmEmail: 'anna@firma.de', successors: { [teamId]: vera.user.id } },
      cookie: person.cookie,
    });
    expect(viewer.status).toBe(400);
    expect(((await viewer.json()) as { error: { message: string } }).error.message).toContain(
      'nur, wenn sonst niemand',
    );
    expect(
      await ctx.deps.db.select().from(workspaces).where(eq(workspaces.id, soloId)),
    ).toHaveLength(1);

    // Right after the deletion's transaction, before the workspace is purged: nobody can join
    // it by domain or invite in between.
    const transaction = ctx.deps.db.transaction.bind(ctx.deps.db);
    let between: unknown;
    ctx.deps.db.transaction = (async (...args: Parameters<typeof transaction>) => {
      const result = await transaction(...args);
      between ??= await ctx.deps.db
        .select({ id: workspaces.id, joinDomain: workspaces.joinDomain })
        .from(workspaces)
        .where(eq(workspaces.id, soloId));
      return result;
    }) as typeof transaction;
    const res = await ctx.request('/api/me', {
      method: 'DELETE',
      json: { confirmEmail: 'anna@firma.de', successors: { [teamId]: bob.user.id } },
      cookie: person.cookie,
    });
    ctx.deps.db.transaction = transaction;
    expect(res.status).toBe(204);
    expect(between).toEqual([{ id: soloId, joinDomain: null }]);
    expect(await ctx.deps.db.select().from(workspaces).where(eq(workspaces.id, soloId))).toEqual(
      [],
    );
    const roles = await ctx.deps.db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, teamId));
    expect(roles).toEqual(
      expect.arrayContaining([
        { userId: vera.user.id, role: 'viewer' },
        { userId: bob.user.id, role: 'admin' },
      ]),
    );
  });

  it('hands a workspace with only viewers left to a viewer: it goes only with its last member', async () => {
    const person = await anna();
    const guestsId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaces).values({ id: guestsId, name: 'Gäste', slug: 'gaeste' });
    await join(person.user.id, guestsId, 'admin');
    const vera = await signedInUser(ctx, { name: 'Vera', email: 'vera@extern.de' });
    await join(vera.user.id, guestsId, 'viewer');
    const deck = await createReadyDeck(ctx, { title: 'Für Gäste' });
    await ctx.deps.db
      .update(decks)
      .set({ workspaceId: guestsId, ownerId: person.user.id })
      .where(eq(decks.id, deck.deckId));

    const choices = await (await ctx.request('/api/me/deletion', { cookie: person.cookie })).json();
    expect(choices).toEqual([
      {
        workspaceId: guestsId,
        workspaceName: 'Gäste',
        candidates: [{ userId: vera.user.id, name: 'Vera', role: 'viewer' }],
      },
    ]);
    expect((await deleteMe(person.cookie, 'anna@firma.de')).status).toBe(400);

    const res = await ctx.request('/api/me', {
      method: 'DELETE',
      json: { confirmEmail: 'anna@firma.de', successors: { [guestsId]: vera.user.id } },
      cookie: person.cookie,
    });
    expect(res.status).toBe(204);
    expect(
      await ctx.deps.db
        .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, guestsId)),
    ).toEqual([{ userId: vera.user.id, role: 'admin' }]);
    const [kept] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deck.deckId));
    expect(kept?.ownerId).toBe(vera.user.id);

    // Vera is the last member now: deleting her account takes the workspace along.
    expect((await deleteMe(vera.cookie, 'vera@extern.de')).status).toBe(204);
    expect(await ctx.deps.db.select().from(workspaces).where(eq(workspaces.id, guestsId))).toEqual(
      [],
    );
    expect(await ctx.deps.db.select().from(decks).where(eq(decks.id, deck.deckId))).toEqual([]);
  });

  it('checks the choices again under the lock: members who joined or admins who left after they were read', async () => {
    const person = await anna();
    const transaction = ctx.deps.db.transaction.bind(ctx.deps.db);
    /** Runs `change` right before the deletion locks. */
    const beforeLock = (change: () => Promise<unknown>) => {
      ctx.deps.db.transaction = (async (...args: Parameters<typeof transaction>) => {
        ctx.deps.db.transaction = transaction;
        await change();
        return transaction(...args);
      }) as typeof transaction;
    };
    const leave = (workspaceId: string, userId: string) =>
      ctx.deps.db
        .delete(workspaceMembers)
        .where(
          sql`${workspaceMembers.workspaceId} = ${workspaceId} and ${workspaceMembers.userId} = ${userId}`,
        );
    const annaExists = async () =>
      (await ctx.deps.db.select().from(users).where(eq(users.id, person.user.id))).length === 1;

    // Only a viewer at the check, so she is chosen. Bob joins right before the deletion locks.
    const guestsId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaces).values({ id: guestsId, name: 'Gäste', slug: 'gaeste' });
    await join(person.user.id, guestsId, 'admin');
    const vera = await signedInUser(ctx, { name: 'Vera', email: 'vera@extern.de' });
    await join(vera.user.id, guestsId, 'viewer');
    const bob = await signedInUser(ctx, { name: 'Bob', email: 'bob@firma.de' });
    beforeLock(() => join(bob.user.id, guestsId, 'member'));
    const joined = await ctx.request('/api/me', {
      method: 'DELETE',
      json: { confirmEmail: 'anna@firma.de', successors: { [guestsId]: vera.user.id } },
      cookie: person.cookie,
    });
    ctx.deps.db.transaction = transaction;
    expect(joined.status).toBe(400);
    expect(((await joined.json()) as { error: { message: string } }).error.message).toContain(
      '„Gäste“',
    );
    // Nobody was made admin behind the person's back, nothing is gone.
    const [bobs] = await ctx.deps.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        sql`${workspaceMembers.workspaceId} = ${guestsId} and ${workspaceMembers.userId} = ${bob.user.id}`,
      );
    expect(bobs?.role).toBe('member');
    expect(await annaExists()).toBe(true);
    await leave(guestsId, person.user.id);

    // Two admins at the check: nothing to choose. Carl deletes his account right before the lock.
    const teamId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaces).values({ id: teamId, name: 'Team', slug: 'team' });
    await join(person.user.id, teamId, 'admin');
    const carl = await signedInUser(ctx, { name: 'Carl', email: 'carl@firma.de' });
    await join(carl.user.id, teamId, 'admin');
    await join(bob.user.id, teamId, 'member');
    beforeLock(() => leave(teamId, carl.user.id));
    const left = await deleteMe(person.cookie, 'anna@firma.de');
    ctx.deps.db.transaction = transaction;
    expect(left.status).toBe(400);
    expect(((await left.json()) as { error: { message: string } }).error.message).toBe(
      'Wähle für „Team“, wer dort Admin wird.',
    );
    expect(await annaExists()).toBe(true);

    // The only other member, an admin, leaves right before the lock: the workspace closes.
    await leave(teamId, bob.user.id);
    await join(carl.user.id, teamId, 'admin');
    beforeLock(() => leave(teamId, carl.user.id));
    const closed = await deleteMe(person.cookie, 'anna@firma.de');
    ctx.deps.db.transaction = transaction;
    expect(closed.status).toBe(204);
    expect(await annaExists()).toBe(false);
    expect(
      await ctx.deps.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, teamId)),
    ).toHaveLength(0);
  });
});

describe('data requests without login (BER-146)', () => {
  let mailer: RecordingMailer;
  beforeEach(async () => {
    await ctx.cleanup();
    mailer = new RecordingMailer();
    ctx = await createTestContext({ instanceAdmin: true, mailer });
  });

  const ask = (email: string, purpose: 'export' | 'delete') =>
    ctx.request('/api/data-requests', { method: 'POST', json: { email, purpose } });
  /** The token of the link in the last mail. */
  const lastToken = () => /\/daten\/([\w.-]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';

  it('mails the link to the address only, at most three times an hour; the answer never tells whether it exists; deleting signs out only that account', async () => {
    const person = await anna();
    const other = await signedInUser(ctx, { name: 'Ben Berg', email: 'ben@firma.de' });
    const unknown = await ask('niemand@firma.de', 'export');
    const known = await ask('ANNA@firma.de', 'export');
    expect([unknown.status, known.status]).toEqual([202, 202]);
    expect(await unknown.json()).toEqual(await known.json());
    expect(mailer.sent.map((m) => m.to)).toEqual(['anna@firma.de']);
    for (let i = 0; i < 4; i++) expect((await ask('anna@firma.de', 'export')).status).toBe(202);
    expect(mailer.sent).toHaveLength(3);

    const token = lastToken();
    expect(await (await ctx.request(`/api/data-requests/${token}`)).json()).toMatchObject({
      purpose: 'export',
      email: 'anna@firma.de',
      hasAccount: true,
    });
    const zip = await ctx.request(`/api/data-requests/${token}/export`);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    // An export link deletes nothing, a forged one does nothing at all.
    expect(
      (await ctx.request(`/api/data-requests/${token}/delete`, { method: 'POST' })).status,
    ).toBe(400);
    const [body = '', signature = ''] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), p: 'delete' }),
    ).toString('base64url');
    expect(
      (await ctx.request(`/api/data-requests/${forged}.${signature}/delete`, { method: 'POST' }))
        .status,
    ).toBe(404);

    // Deleting happens only on the confirmation, within a day.
    ctx.clock.advance(61 * 60 * 1000);
    await ask('anna@firma.de', 'delete');
    expect(mailer.sent).toHaveLength(4);
    const deletion = lastToken();
    const info = (await (await ctx.request(`/api/data-requests/${deletion}`)).json()) as {
      expiresAt: string;
    };
    expect(new Date(info.expiresAt).getTime() - ctx.clock.now().getTime()).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
    expect(await ctx.deps.db.select().from(users).where(eq(users.id, person.user.id))).toHaveLength(
      1,
    );
    ctx.clock.advance(25 * 60 * 60 * 1000);
    expect(
      (await ctx.request(`/api/data-requests/${deletion}/delete`, { method: 'POST' })).status,
    ).toBe(404);
    ctx.clock.advance(-25 * 60 * 60 * 1000);
    const res = await ctx.request(`/api/data-requests/${deletion}/delete`, {
      method: 'POST',
      cookie: other.cookie,
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await ctx.deps.db.select().from(users).where(eq(users.id, person.user.id))).toEqual([]);
    expect(
      await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, other.user.id)),
    ).toHaveLength(1);
  });

  it('covers invitations to an address without account', async () => {
    await ctx.deps.db.insert(workspaceInvites).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      email: 'gast@extern.de',
      role: 'reviewer',
      tokenHash: crypto.randomUUID(),
      createdBy: ctx.ownerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await ask('gast@extern.de', 'export');
    const exportToken = lastToken();
    expect(await (await ctx.request(`/api/data-requests/${exportToken}`)).json()).toMatchObject({
      hasAccount: false,
    });
    const zip = await JSZip.loadAsync(
      await (await ctx.request(`/api/data-requests/${exportToken}/export`)).arrayBuffer(),
    );
    const invites = JSON.parse((await zip.file('einladungen.json')?.async('string')) ?? '[]');
    expect(invites).toEqual([
      expect.objectContaining({ workspace: 'Mein Workspace', invitedBy: 'Robert Hofmann' }),
    ]);

    await ask('gast@extern.de', 'delete');
    expect(
      (await ctx.request(`/api/data-requests/${lastToken()}/delete`, { method: 'POST' })).status,
    ).toBe(204);
    expect(
      await rowCount(
        ctx.deps.db
          .select({ count: count() })
          .from(workspaceInvites)
          .where(eq(workspaceInvites.email, 'gast@extern.de')),
      ),
    ).toBe(0);
  });
});

describe('data requests without mail delivery', () => {
  it('say so instead of pretending', async () => {
    await anna();
    expect(
      (
        await ctx.request('/api/data-requests', {
          method: 'POST',
          json: { email: 'anna@firma.de', purpose: 'export' },
        })
      ).status,
    ).toBe(503);
  });
});

describe('unused accounts (BER-147)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  let mailer: RecordingMailer;

  /**
   * A fresh context with its clock on the 15th of next month: month arithmetic on the 29th–31st
   * would overflow into the next month and shift every deadline.
   */
  async function context(options: Parameters<typeof createTestContext>[0]) {
    await ctx.cleanup();
    ctx = await createTestContext(options);
    const now = ctx.clock.now();
    ctx.clock.advance(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15, 12) - now.getTime(),
    );
  }

  beforeEach(async () => {
    mailer = new RecordingMailer();
    await context({ instanceAdmin: true, mailer, config: DELETE_UNUSED });
    // On for long already: the grace after switching it on is over.
    await setUnusedDeletionSince(ctx.deps, new Date(0));
  });

  /** Anna, last active `monthsAgo` months before the test clock's now. */
  async function unusedAnna(monthsAgo: number) {
    const person = await anna();
    const lastActiveAt = ctx.clock.now();
    lastActiveAt.setUTCMonth(lastActiveAt.getUTCMonth() - monthsAgo);
    await ctx.deps.db.update(users).set({ lastActiveAt }).where(eq(users.id, person.user.id));
    return { ...person, lastActiveAt };
  }
  const subjects = () => mailer.sent.map((m) => m.subject);
  const exists = async (id: string) =>
    (await ctx.deps.db.select().from(users).where(eq(users.id, id))).length === 1;
  /** Moves the clock to `deadline` minus `ms`. */
  const at = (deadline: Date, ms: number) => {
    const target = deadline.getTime() - ms;
    ctx.clock.advance(target - ctx.clock.now().getTime());
  };

  it('deletes after 18 months even when reminders were missed, keeps one used after the sweep read it, leaves instance admins alone and picks new admins itself', async () => {
    const person = await unusedAnna(19);
    // The sweep read this; then Anna signs in: kept.
    await ctx.deps.db
      .update(users)
      .set({ lastActiveAt: ctx.clock.now() })
      .where(eq(users.id, person.user.id));
    expect(await deleteAccount(ctx.deps, person.user.id, 'automatic', person.lastActiveAt)).toBe(
      false,
    );
    expect(await exists(person.user.id)).toBe(true);
    await ctx.deps.db
      .update(users)
      .set({ lastActiveAt: person.lastActiveAt })
      .where(eq(users.id, person.user.id));
    // Instance admins are never swept.
    await ctx.deps.db
      .update(users)
      .set({ lastActiveAt: new Date(0) })
      .where(eq(users.id, ctx.ownerId));

    // The longest-standing member with the highest role takes over; a viewer only when nobody else is left.
    const teamId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaces).values({ id: teamId, name: 'Team', slug: 'team' });
    await join(person.user.id, teamId, 'admin');
    const vera = await signedInUser(ctx, { name: 'Vera', email: 'vera@firma.de' });
    await join(vera.user.id, teamId, 'viewer');
    const bob = await signedInUser(ctx, { name: 'Bob', email: 'bob@firma.de' });
    await join(bob.user.id, teamId, 'member');
    const guestsId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaces).values({ id: guestsId, name: 'Gäste', slug: 'gaeste' });
    await join(person.user.id, guestsId, 'admin');
    await join(vera.user.id, guestsId, 'viewer');

    expect(await sweepUnusedAccounts(ctx.deps)).toEqual({
      reminded: [],
      deleted: [person.user.id],
    });
    expect(await exists(person.user.id)).toBe(false);
    expect(await exists(ctx.ownerId)).toBe(true);
    // Mails only inform: none went to Anna.
    expect(mailer.sent.filter((mail) => mail.to === 'anna@firma.de')).toEqual([]);
    const [bobRole] = await ctx.deps.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, bob.user.id));
    expect(bobRole?.role).toBe('admin');
    const toBob = mailer.sent.find((mail) => mail.to === 'bob@firma.de');
    expect(toBob?.subject).toBe('Du bist jetzt Admin von „Team“');
    expect(toBob?.text).toContain('lange nicht genutzt');
    expect(
      await ctx.deps.db
        .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, guestsId)),
    ).toEqual([{ userId: vera.user.id, role: 'admin' }]);
  });

  it('"Konto behalten" and any use start over; otherwise warns after a year, again 3 months … 1 day before, deletes after 18 months', async () => {
    const person = await unusedAnna(12);
    await sweepUnusedAccounts(ctx.deps);
    await sweepUnusedAccounts(ctx.deps);
    expect(subjects()).toEqual(['Dein Slider-Konto wird in 6 Monaten gelöscht']);
    expect(mailer.sent[0]?.to).toBe('anna@firma.de');
    const token = /\/daten\/([\w.-]+)/.exec(mailer.sent[0]?.text ?? '')?.[1] ?? '';
    expect(await (await ctx.request(`/api/data-requests/${token}`)).json()).toMatchObject({
      purpose: 'keep',
    });
    expect((await ctx.request(`/api/data-requests/${token}/keep`, { method: 'POST' })).status).toBe(
      204,
    );
    const [kept] = await ctx.deps.db.select().from(users).where(eq(users.id, person.user.id));
    expect(kept?.inactivityNotices).toBe(0);
    expect(kept?.lastActiveAt.getTime()).toBeGreaterThan(person.lastActiveAt.getTime());

    // Using Slider: the daily session renewal counts.
    await ctx.deps.db
      .update(users)
      .set({ lastActiveAt: new Date(0), inactivityNotices: 3 })
      .where(eq(users.id, person.user.id));
    await ctx.deps.db
      .update(sessions)
      .set({ lastSeenAt: new Date(0) })
      .where(eq(sessions.userId, person.user.id));
    await ctx.request('/api/me', { cookie: person.cookie });
    const [used] = await ctx.deps.db.select().from(users).where(eq(users.id, person.user.id));
    expect(used?.inactivityNotices).toBe(0);
    expect(used?.lastActiveAt.getTime()).toBeGreaterThan(0);

    // Unused again for a year: the full round of reminders.
    await ctx.deps.db
      .update(users)
      .set({ lastActiveAt: person.lastActiveAt })
      .where(eq(users.id, person.user.id));
    mailer.sent.length = 0;
    const deadline = new Date(person.lastActiveAt);
    deadline.setUTCMonth(deadline.getUTCMonth() + 18);
    await sweepUnusedAccounts(ctx.deps);
    const before3Months = new Date(deadline);
    before3Months.setUTCMonth(before3Months.getUTCMonth() - 3);
    at(before3Months, 0);
    await sweepUnusedAccounts(ctx.deps);
    const before1Month = new Date(deadline);
    before1Month.setUTCMonth(before1Month.getUTCMonth() - 1);
    at(before1Month, 0);
    await sweepUnusedAccounts(ctx.deps);
    for (const days of [7, 3, 2, 1]) {
      at(deadline, days * DAY);
      await sweepUnusedAccounts(ctx.deps);
    }
    expect(subjects()).toEqual([
      'Dein Slider-Konto wird in 6 Monaten gelöscht',
      'Dein Slider-Konto wird in 3 Monaten gelöscht',
      'Dein Slider-Konto wird in einem Monat gelöscht',
      'Dein Slider-Konto wird in einer Woche gelöscht',
      'Dein Slider-Konto wird in 3 Tagen gelöscht',
      'Dein Slider-Konto wird übermorgen gelöscht',
      'Dein Slider-Konto wird morgen gelöscht',
    ]);
    expect(await exists(person.user.id)).toBe(true);

    at(deadline, 0);
    expect(await sweepUnusedAccounts(ctx.deps)).toEqual({
      reminded: [],
      deleted: [person.user.id],
    });
    expect(await exists(person.user.id)).toBe(false);
  });

  it('does nothing until switched on, then counts from switching on; switched off and on again, a new grace starts', async () => {
    mailer = new RecordingMailer();
    // Its own config object: switched off and on below.
    const retention = { deleteUnused: false };
    await context({ instanceAdmin: true, mailer, config: { retention } });
    const person = await unusedAnna(40);
    expect(await sweepUnusedAccounts(ctx.deps)).toEqual({ reminded: [], deleted: [] });
    expect(await exists(person.user.id)).toBe(true);
    expect(subjects()).toEqual([]);

    retention.deleteUnused = true;
    expect(await sweepUnusedAccounts(ctx.deps)).toEqual({ reminded: [], deleted: [] });
    expect(await exists(person.user.id)).toBe(true);
    // Noted by that first sweep.
    const switchedOn = await unusedDeletionSince(ctx.deps);
    if (!switchedOn) throw new Error('not noted');
    const firstReminder = new Date(switchedOn);
    firstReminder.setUTCMonth(firstReminder.getUTCMonth() + 12);
    at(firstReminder, DAY);
    await sweepUnusedAccounts(ctx.deps);
    expect(subjects()).toEqual([]);
    at(firstReminder, 0);
    await sweepUnusedAccounts(ctx.deps);
    expect(subjects()).toEqual(['Dein Slider-Konto wird in 6 Monaten gelöscht']);

    // Off for a while: the sweep forgets when it was switched on.
    retention.deleteUnused = false;
    ctx.clock.advance(60 * DAY);
    await sweepUnusedAccounts(ctx.deps);
    retention.deleteUnused = true;
    expect(await sweepUnusedAccounts(ctx.deps)).toEqual({ reminded: [], deleted: [] });
    const again = await unusedDeletionSince(ctx.deps);
    if (!again) throw new Error('not noted');
    expect(again.getTime()).toBeGreaterThan(switchedOn.getTime());

    // 12 months after switching on again: the round starts from the first reminder.
    const deadline = new Date(again);
    deadline.setUTCMonth(deadline.getUTCMonth() + 18);
    const nextReminder = new Date(again);
    nextReminder.setUTCMonth(nextReminder.getUTCMonth() + 12);
    at(nextReminder, 0);
    await sweepUnusedAccounts(ctx.deps);
    expect(subjects().slice(1)).toEqual(['Dein Slider-Konto wird in 6 Monaten gelöscht']);
    at(deadline, 60_000);
    await sweepUnusedAccounts(ctx.deps);
    expect(await exists(person.user.id)).toBe(true);
    at(deadline, 0);
    expect((await sweepUnusedAccounts(ctx.deps)).deleted).toEqual([person.user.id]);
  });

  it('deletes without mail delivery too, just unannounced', async () => {
    await context({ instanceAdmin: true, config: DELETE_UNUSED });
    await setUnusedDeletionSince(ctx.deps, new Date(0));
    const early = await unusedAnna(13);
    expect(await sweepUnusedAccounts(ctx.deps)).toEqual({ reminded: [], deleted: [] });
    await ctx.deps.db
      .update(users)
      .set({ lastActiveAt: new Date(0) })
      .where(eq(users.id, early.user.id));
    expect(await sweepUnusedAccounts(ctx.deps)).toEqual({
      reminded: [],
      deleted: [early.user.id],
    });
  });
});

describe('deleting a deck (BER-143)', () => {
  it('leaves no rows and no files of it behind', async () => {
    const deck = await createReadyDeck(ctx);
    const pptxKey = blobKeys.pptx(deck.deckId, deck.revisionId);
    await ctx.deps.storage.put(pptxKey, new TextEncoder().encode('PPTX'));
    await ctx.deps.db.update(revisions).set({ pptxKey }).where(eq(revisions.id, deck.revisionId));
    const commentId = await comment(deck.deckId, deck.slideIds[0] ?? '', 'Weg damit');
    await comment(deck.deckId, deck.slideIds[1] ?? '', 'Und damit');
    await recording(deck.deckId, commentId, ctx.ownerId);
    await ctx.deps.db
      .insert(deletedPptxComments)
      .values({ deckId: deck.deckId, externalId: 'pptx-1' });

    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(204);

    const { db } = ctx.deps;
    for (const [name, rows] of [
      ['decks', db.select({ count: count() }).from(decks).where(eq(decks.id, deck.deckId))],
      [
        'revisions',
        db.select({ count: count() }).from(revisions).where(eq(revisions.deckId, deck.deckId)),
      ],
      ['slides', db.select({ count: count() }).from(slides).where(eq(slides.deckId, deck.deckId))],
      [
        'slide_versions',
        db
          .select({ count: count() })
          .from(slideVersions)
          .where(eq(slideVersions.revisionId, deck.revisionId)),
      ],
      [
        'comments',
        db.select({ count: count() }).from(comments).where(eq(comments.deckId, deck.deckId)),
      ],
      ['media', db.select({ count: count() }).from(media).where(eq(media.deckId, deck.deckId))],
      [
        'deleted_pptx_comments',
        db
          .select({ count: count() })
          .from(deletedPptxComments)
          .where(eq(deletedPptxComments.deckId, deck.deckId)),
      ],
    ] as const) {
      expect([name, await rowCount(rows)]).toEqual([name, 0]);
    }
    expect(await ctx.deps.storage.list(blobKeys.deckPrefix(deck.deckId))).toEqual([]);
    expect(await ctx.deps.media.list(blobKeys.deckPrefix(deck.deckId))).toEqual([]);
  });
});
