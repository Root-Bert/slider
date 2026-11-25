import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { count, eq, inArray, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import {
  DELETED_ACCOUNT_NAME,
  type Author,
  type MePicture,
  type MeResponse,
  type PeoplePictures,
  type WorkspaceRole,
} from '@slider/shared';
import {
  appConnections,
  blobDeletions,
  callRecords,
  cloudAreas,
  cloudConnections,
  cloudNodes,
  cloudStars,
  comments,
  decks,
  deletedPptxComments,
  documentCommentReactions,
  documentComments,
  googleConnections,
  integrationKeys,
  mailAccounts,
  mailInsights,
  mailMessages,
  mailThreads,
  cloudAgentFiles,
  cloudAgents,
  materialChatMessages,
  materialChats,
  materialQuestions,
  media,
  pdfComments,
  pdfMarks,
  readerSignatures,
  revisions,
  senderChannels,
  senderDrafts,
  senderScheduled,
  senderMessages,
  sessions,
  showRuns,
  slides,
  slideVersions,
  todoMilestones,
  todoProjects,
  userIdentities,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  attachments as attachmentRows,
} from '../src/db/schema';
import { keepAgentMessage, openAgentChat } from '../src/services/agent-chats';
import { hashToken } from '../src/auth/session';
import { encryptToken } from '../src/auth/token-crypto';
import { ensurePersonalWorkspace } from '../src/services/workspaces';
import { RecordingMailer } from '../src/mail/mailer';
import { deleteAccount } from '../src/services/account-deletion';
import { sweepUnusedAccounts } from '../src/services/unused-accounts';
import { setUnusedDeletionSince, unusedDeletionSince } from '../src/services/unused-deletion';
import { blobKeys } from '../src/storage/blob-storage';
import { loadImage } from '../src/import/load-image';
import { aiLimits } from '../src/http/ai-limits';
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

/** A rehearsal on `deckId` saved by `userId`, with a 4-byte recording. */
async function rehearsal(deckId: string, userId: string) {
  const id = crypto.randomUUID();
  const recordingKey = `decks/${deckId}/runs/${id}.webm`;
  await ctx.deps.storage.put(recordingKey, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
  const at = new Date();
  await ctx.deps.db.insert(showRuns).values({
    id,
    deckId,
    at,
    summary: { at: at.toISOString(), total: 1000, rows: [] },
    recordingKey,
    recordedBy: userId,
  });
  return { id, recordingKey };
}

/**
 * A mailbox of `userId` in `workspaceId` with one mail and its attachment kept in storage;
 * `microsoft`: signed in through Microsoft, its refresh token kept (sealed) beside the password.
 */
async function mailbox(userId: string, workspaceId: string, signIn?: 'microsoft') {
  const id = crypto.randomUUID();
  await ctx.deps.db.insert(mailAccounts).values({
    id,
    workspaceId,
    userId,
    address: 'anna@firma.de',
    name: 'Anna Schmidt',
    imapHost: 'imap.firma.de',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.firma.de',
    smtpPort: 465,
    smtpSecure: true,
    username: 'anna-login',
    password: 'postfach-geheim',
    ...(signIn ? { auth: signIn, refreshToken: 'ms-refresh-geheim' } : {}),
    folders: [{ key: 'Kunden', path: 'Kunden', name: 'Kunden', role: null }],
  });
  const threadId = crypto.randomUUID();
  await ctx.deps.db.insert(mailThreads).values({
    id: threadId,
    accountId: id,
    subject: 'Angebot',
    lastAt: new Date(),
    context: {
      summary: 'Ein Kunde schickt ein Angebot.',
      kind: 'Angebot',
      verdict: 'ok',
      warning: null,
      todo: null,
      needsInfo: false,
      facts: [],
      links: [],
      documents: [],
      filing: [],
    },
  });
  const key = `mail/${id}/${crypto.randomUUID()}`;
  await ctx.deps.storage.put(key, new TextEncoder().encode('PDF'));
  const picture = `mail/${id}/${crypto.randomUUID()}`;
  await ctx.deps.storage.put(picture, new TextEncoder().encode('PNG'));
  await ctx.deps.db.insert(mailMessages).values({
    id: crypto.randomUUID(),
    accountId: id,
    threadId,
    folder: 'inbox',
    folders: ['inbox', 'Kunden'],
    uid: 1,
    messageId: `<${id}@firma.de>`,
    from: { name: 'Kunde', address: 'kunde@extern.de' },
    to: [{ name: 'Anna Schmidt', address: 'anna@firma.de' }],
    cc: [],
    subject: 'Angebot',
    text: 'Anbei das Angebot.',
    attachments: [{ id: 'a1', name: 'Angebot.pdf', type: 'application/pdf', size: 3, key }],
    html: '<p>Anbei das Angebot.</p><img src="cid:logo">',
    inlineImages: [{ id: 'i1', cid: 'logo', type: 'image/png', size: 3, key: picture }],
    sentAt: new Date(),
  });
  // The AI panel's bullets for it (kept 14 days): in the export with their conversation.
  await ctx.deps.db.insert(mailInsights).values({
    threadId,
    userId,
    version: '1:x',
    payload: { bullets: ['Angebot kommt'], organisations: [] },
  });
  return id;
}

const deleteMe = (cookie: string, confirmEmail: string) =>
  ctx.request('/api/me', { method: 'DELETE', json: { confirmEmail }, cookie });

const rowCount = async (query: Promise<{ count: number }[]>) => (await query)[0]?.count ?? 0;

describe('data export (BER-145)', () => {
  it('zips profile, own and taken-over decks with their files, own comments and recordings – no secrets; uploads passed on with a removal stay out', async () => {
    const person = await anna();
    let plannedFile: string;
    await ctx.deps.db.update(users).set({ callVoice: 'paul' }).where(eq(users.id, person.user.id));
    // „Dateiendungen zeigen“ is the account's: off until switched on, then on wherever one signs in.
    const meNow = async () =>
      ((await (await ctx.request('/api/me', { cookie: person.cookie })).json()) as MeResponse).user;
    expect((await meNow())?.showExtensions).toBe(false);
    expect(
      (
        await ctx.request('/api/me', {
          method: 'PATCH',
          json: { showExtensions: true },
          cookie: person.cookie,
        })
      ).status,
    ).toBe(200);
    expect((await meNow())?.showExtensions).toBe(true);
    // „Meetings vorher zeigen“ too: 5 minutes until changed, off as null, nothing past two hours.
    expect((await meNow())?.meetingNoticeMinutes).toBe(5);
    const notice = (minutes: number | null) =>
      ctx.request('/api/me', {
        method: 'PATCH',
        json: { meetingNoticeMinutes: minutes },
        cookie: person.cookie,
      });
    expect((await notice(121)).status).toBe(400);
    expect((await notice(null)).status).toBe(200);
    expect((await meNow())?.meetingNoticeMinutes).toBeNull();
    expect((await notice(15)).status).toBe(200);
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
    await ctx.deps.db
      .update(media)
      .set({ transcript: 'Die Folie ist zu voll.', transcriptStatus: 'done' })
      .where(eq(media.commentId, commentId));
    await rehearsal(other.deckId, person.user.id);
    await rehearsal(other.deckId, ctx.ownerId);
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
    const box = await mailbox(person.user.id, ctx.workspaceId, 'microsoft');
    // Sender: her message and Robert's answer in their direct conversation.
    const direct = (await (
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/sender/direct`, {
        method: 'POST',
        json: { userId: person.user.id },
      })
    ).json()) as { id: string };
    for (const [text, cookie] of [
      ['Hast du die Folien?', person.cookie],
      ['Ja, gleich.', undefined],
    ] as const) {
      const sent = await ctx.request(`/api/sender/channels/${direct.id}/messages`, {
        method: 'POST',
        json: { text },
        cookie,
      });
      expect(sent.status).toBe(201);
    }
    // She pinned the conversation at the top of her chats; Robert's pin of it is his.
    for (const cookie of [person.cookie, undefined]) {
      const pinned = await ctx.request('/api/sender/pins', {
        method: 'POST',
        json: { kind: 'channel', id: direct.id, pinned: true },
        cookie,
      });
      expect(pinned.status).toBe(200);
    }
    // Her draft in the conversation and Robert's there: only hers goes along, as she wrote it.
    for (const [text, cookie] of [
      ['Und die Zahlen …', person.cookie],
      ['Roberts Entwurf', undefined],
    ] as const) {
      const kept = await ctx.request(`/api/workspaces/${ctx.workspaceId}/drafts/${direct.id}`, {
        method: 'PUT',
        json: { text, target: { kind: 'conversation' }, at: new Date().toISOString() },
        cookie,
      });
      expect(kept.status).toBe(200);
    }
    // Her message planned for later, with a file: in the archive; gone with her when she leaves.
    {
      const form = new FormData();
      form.append('file', new File(['Plan'], 'Plan.txt', { type: 'text/plain' }));
      const up = await ctx.request(`/api/workspaces/${ctx.workspaceId}/attachments`, {
        method: 'POST',
        body: form,
        cookie: person.cookie,
      });
      plannedFile = ((await up.json()) as { id: string }).id;
      const planned = await ctx.request(`/api/sender/channels/${direct.id}/scheduled`, {
        method: 'POST',
        json: {
          text: 'Morgen früh',
          attachments: [plannedFile],
          sendAt: new Date(ctx.deps.clock.now().getTime() + 86_400_000).toISOString(),
        },
        cookie: person.cookie,
      });
      expect(planned.status).toBe(201);
    }
    // Writer and Reader: her comments, a reaction, what she and Robert filled in, her signature.
    const [documentId, pdfId] = [crypto.randomUUID(), crypto.randomUUID()];
    await ctx.deps.db.insert(cloudNodes).values([
      { id: documentId, workspaceId: ctx.workspaceId, kind: 'file', name: 'Bericht.odt' },
      { id: pdfId, workspaceId: ctx.workspaceId, kind: 'file', name: 'Vertrag.pdf' },
    ]);
    const writerComment = crypto.randomUUID();
    await ctx.deps.db.insert(documentComments).values({
      id: writerComment,
      documentId,
      authorId: person.user.id,
      body: 'Absatz 2 kürzen.',
    });
    await ctx.deps.db.insert(documentCommentReactions).values({
      commentId: writerComment,
      userId: person.user.id,
      author: { id: person.user.id, name: 'Anna Schmidt', type: 'owner', color: 'blue' },
      kind: 'up',
    });
    await ctx.deps.db.insert(pdfComments).values({
      id: crypto.randomUUID(),
      pdfId,
      authorId: person.user.id,
      body: 'Seite 3 fehlt.',
    });
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    await ctx.deps.db.insert(pdfMarks).values([
      {
        pdfId,
        id: 'sig-1',
        authorId: person.user.id,
        body: { kind: 'signature', page: 0, rect: { x: 0, y: 0, w: 0.2, h: 0.1 }, image: png },
      },
      {
        pdfId,
        id: 'field:Ort',
        authorId: ctx.ownerId,
        body: { kind: 'field', page: 0, name: 'Ort', value: 'Berlin' },
      },
    ]);
    await ctx.deps.db.insert(cloudStars).values({ userId: person.user.id, nodeId: pdfId });
    await ctx.deps.db.insert(cloudConnections).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      userId: person.user.id,
      name: 'Linear',
      url: 'https://mcp.linear.app/mcp',
      auth: {
        token: 'geheim-token',
        tokens: { access_token: 'geheim-at' },
        discovery: {
          authorizationServerUrl: 'https://mcp.linear.app',
          authorizationServerMetadata: { revocation_endpoint: 'https://mcp.linear.app/revoke' },
        },
      },
      state: 'connected',
      tools: [],
    });
    // An API's key goes in a header of its own: its kind is exported, the key never.
    await ctx.deps.db.insert(cloudConnections).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      userId: person.user.id,
      name: 'Personio',
      url: 'https://api.personio.test/v1',
      kind: 'api',
      api: { auth: 'header', header: 'X-Api-Key', about: 'Urlaube' },
      auth: { token: 'api-geheim' },
      state: 'connected',
      tools: [],
    });
    await ctx.deps.db.insert(readerSignatures).values({
      id: crypto.randomUUID(),
      userId: person.user.id,
      image: png,
      width: 10,
      height: 5,
    });
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
    const agentId = crypto.randomUUID();
    await ctx.deps.db.insert(cloudAgents).values({
      id: agentId,
      workspaceId: ctx.workspaceId,
      userId: person.user.id,
      title: 'Schreib einen Bericht',
    });
    const chatOf = (agent: string, userId: string) =>
      openAgentChat(
        ctx.deps.db,
        { id: agent, workspaceId: ctx.workspaceId },
        { id: agent, userId, at: ctx.deps.clock.now() },
      );
    const tell = (
      chat: Awaited<ReturnType<typeof chatOf>>,
      userId: string | null,
      text: string,
      byAgent = false,
    ) => keepAgentMessage(ctx.deps.db, chat, ctx.deps.clock.now(), { userId, text, byAgent });
    // From before agents were shared, her own message had nobody: hers.
    const hersChat = await chatOf(agentId, person.user.id);
    await tell(hersChat, null, 'Schreib einen Bericht');
    // Robert wrote to her agent too; she wrote to his.
    await tell(hersChat, ctx.ownerId, 'Mit Zahlen bitte');
    const robertsAgent = crypto.randomUUID();
    await ctx.deps.db.insert(cloudAgents).values({
      id: robertsAgent,
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerId,
      title: 'Roberts Agent',
    });
    const robertsChat = await chatOf(robertsAgent, ctx.ownerId);
    await tell(robertsChat, ctx.ownerId, 'Von Robert an seinen');
    await tell(robertsChat, person.user.id, 'Von Anna an Roberts');
    await ctx.deps.db.insert(cloudAgentFiles).values({
      id: crypto.randomUUID(),
      agentId,
      kind: 'new',
      name: 'Bericht.md',
      content: '# Bericht',
    });
    // Her agent of an area she no longer sees: only what she wrote to it.
    const board = crypto.randomUUID();
    await ctx.deps.db.insert(cloudAreas).values({
      id: board,
      workspaceId: ctx.workspaceId,
      name: 'Vorstand',
      color: 'violet',
      visibility: 'members',
      createdBy: ctx.ownerId,
    });
    const areaAgent = crypto.randomUUID();
    await ctx.deps.db.insert(cloudAgents).values({
      id: areaAgent,
      workspaceId: ctx.workspaceId,
      userId: person.user.id,
      areaId: board,
      shared: true,
      title: 'Agent',
    });
    const areaChat = await chatOf(areaAgent, person.user.id);
    await tell(areaChat, person.user.id, 'Meins im Bereich');
    await tell(areaChat, ctx.ownerId, 'Von Robert im Bereich');
    await tell(areaChat, null, 'Antwort im Bereich', true);
    // Her private one there stays hers in full.
    const privateThere = crypto.randomUUID();
    await ctx.deps.db.insert(cloudAgents).values({
      id: privateThere,
      workspaceId: ctx.workspaceId,
      userId: person.user.id,
      areaId: board,
      title: 'Privat',
    });
    const privateChat = await chatOf(privateThere, person.user.id);
    await tell(privateChat, person.user.id, 'Nur für mich');
    await tell(privateChat, null, 'Gern', true);
    await ctx.deps.db.insert(cloudAgentFiles).values({
      id: crypto.randomUUID(),
      agentId: areaAgent,
      kind: 'new',
      name: 'Vorstand.md',
      content: '# Vorstand',
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

    // The spell check's own words: the account's go into the export, the workspace's stay there.
    const words = (path: string, init: { method?: string; json?: unknown } = {}) =>
      ctx.request(path, { cookie: person.cookie, ...init });
    const teach = (path: string, word: string) => words(path, { method: 'POST', json: { word } });
    expect((await teach('/api/me/words', 'Slider-Deck')).status).toBe(200);
    expect(await (await teach('/api/me/words', 'Slider-Deck')).json()).toEqual([
      { word: 'Slider-Deck', createdAt: expect.any(String), addedBy: null },
    ]);
    expect((await teach('/api/me/words', 'zwei Wörter')).status).toBe(400);
    const teamWords = `/api/workspaces/${ctx.workspaceId}/words`;
    expect(await (await teach(teamWords, 'Quartalsziel')).json()).toEqual([
      expect.objectContaining({ word: 'Quartalsziel', addedBy: 'Anna Schmidt' }),
    ]);
    expect(
      await (await words(`${teamWords}?word=Quartalsziel`, { method: 'DELETE' })).json(),
    ).toEqual([]);
    expect((await teach(teamWords, 'Umsatzziel')).status).toBe(200);

    // A call with Robert in their direct conversation, written down, with its notes.
    const turn = (userId: string, name: string, text: string) => ({
      userId,
      name,
      text,
      at: new Date().toISOString(),
    });
    await ctx.deps.db.insert(callRecords).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      channelId: direct.id,
      kind: 'direct',
      title: '',
      startedBy: person.user.id,
      personIds: [person.user.id, ctx.ownerId],
      people: [
        { id: person.user.id, name: 'Anna Schmidt', type: 'owner', color: 'blue' },
        { id: ctx.ownerId, name: 'Robert', type: 'owner', color: 'red' },
      ],
      lines: [
        turn(person.user.id, 'Anna Schmidt', 'Machen wir Freitag.'),
        turn(ctx.ownerId, 'Robert', 'Passt mir.'),
      ],
      orders: [],
      notes: { summary: 'Termin Freitag.', decisions: [], todos: [], open: [], links: [] },
      notesState: 'done',
      startedAt: new Date(),
      endedAt: new Date(),
    });

    const res = await ctx.request('/api/me/export', { cookie: person.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="slider-daten-/);

    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const read = async (name: string) => JSON.parse((await zip.file(name)?.async('string')) ?? '');
    const account = await read('konto.json');
    // Their own files in Cloud are listed (none here); a second archive at once is refused.
    expect(await read('dateien.json')).toEqual([]);
    expect(
      (
        await Promise.all([
          ctx.request('/api/me/export', { cookie: person.cookie }),
          ctx.request('/api/me/export', { cookie: person.cookie }),
        ])
      )
        .map((each) => each.status)
        .sort(),
    ).toEqual([200, 429]);
    expect(await read('woerterbuch.json')).toEqual([
      { word: 'Slider-Deck', createdAt: expect.any(String) },
    ]);
    expect(account.profile).toMatchObject({
      name: 'Anna Schmidt',
      email: 'anna@firma.de',
      callVoice: 'paul',
      showExtensions: true,
      meetingNoticeMinutes: 15,
    });
    expect(account.workspaces).toEqual([
      expect.objectContaining({ id: ctx.workspaceId, role: 'member' }),
    ]);
    expect(account.sessions).toHaveLength(1);
    expect(account.profile.lastActiveAt).toEqual(expect.any(String));
    // Both made in the same moment: in either order.
    expect(account.cloudConnections).toHaveLength(2);
    expect(account.cloudConnections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Linear',
          kind: 'mcp',
          url: 'https://mcp.linear.app/mcp',
          state: 'connected',
        }),
        expect.objectContaining({
          name: 'Personio',
          kind: 'api',
          api: { auth: 'header', header: 'X-Api-Key', spec: null, about: 'Urlaube' },
        }),
      ]),
    );
    expect(account.cloudStarred).toEqual([
      expect.objectContaining({ id: pdfId, name: 'Vertrag.pdf' }),
    ]);
    expect(account.senderConversations).toEqual([
      expect.objectContaining({ id: direct.id, kind: 'direct' }),
    ]);
    expect(account.senderPinned).toEqual([
      { conversationId: direct.id, agentId: null, mailThreadId: null, at: expect.any(String) },
    ]);
    expect(account.workspaceWords).toEqual([expect.objectContaining({ word: 'Umsatzziel' })]);
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
    expect(await read('agenten.json')).toEqual([
      expect.objectContaining({
        title: 'Schreib einen Bericht',
        messages: [
          expect.objectContaining({ role: 'du', text: 'Schreib einen Bericht' }),
          expect.objectContaining({ role: 'andere Person', text: 'Mit Zahlen bitte' }),
        ],
        files: [expect.objectContaining({ name: 'Bericht.md', kind: 'new', content: '# Bericht' })],
      }),
      expect.objectContaining({
        id: areaAgent,
        areaLeft: true,
        messages: [expect.objectContaining({ role: 'du', text: 'Meins im Bereich' })],
        files: [],
      }),
      expect.objectContaining({
        id: privateThere,
        messages: [
          expect.objectContaining({ role: 'du', text: 'Nur für mich' }),
          expect.objectContaining({ role: 'KI', text: 'Gern' }),
        ],
      }),
      expect.objectContaining({
        title: 'Roberts Agent',
        messages: [expect.objectContaining({ role: 'du', text: 'Von Anna an Roberts' })],
      }),
    ]);
    expect(await read('material.json')).toEqual({
      notes: [
        expect.objectContaining({
          deck: { id: other.deckId, title: 'Roberts Deck' },
          text: 'Wie stark wächst der Markt?',
        }),
      ],
      files: [],
    });
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
    // Her comment's recording and her rehearsal – not Robert's.
    expect(recordings.map((r: { kind: string }) => r.kind)).toEqual(['audio', 'rehearsal']);
    expect(recordings[0].transcript).toBe('Die Folie ist zu voll.');
    for (const each of recordings) expect(zip.file(each.file)).not.toBeNull();
    expect(await read('nachrichten.json')).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({ id: direct.id, kind: 'direct' }),
        text: 'Hast du die Folien?',
      }),
    ]);
    expect(await read('entwuerfe.json')).toEqual([
      expect.objectContaining({
        workspaceId: ctx.workspaceId,
        key: direct.id,
        kind: 'conversation',
        text: 'Und die Zahlen …',
      }),
    ]);
    expect(await read('geplant.json')).toEqual([
      expect.objectContaining({
        conversationId: direct.id,
        text: 'Morgen früh',
        attachments: ['Plan.txt'],
        state: 'waiting',
      }),
    ]);
    // Her calls: her words, not Robert's, and the notes.
    expect(await read('anrufe.json')).toEqual([
      expect.objectContaining({
        said: [expect.objectContaining({ text: 'Machen wir Freitag.' })],
        notes: expect.objectContaining({ summary: 'Termin Freitag.' }),
      }),
    ]);
    const documents = await read('dokumente.json');
    expect(documents.comments.map((c: { body: string }) => c.body)).toEqual([
      'Absatz 2 kürzen.',
      'Seite 3 fehlt.',
    ]);
    expect(documents.reactions).toEqual([expect.objectContaining({ commentId: writerComment })]);
    // Her entry on the PDF, not Robert's; the signature's picture as a file.
    expect(documents.filledIn).toEqual([
      expect.objectContaining({ id: 'sig-1', file: { id: pdfId, name: 'Vertrag.pdf' } }),
    ]);
    for (const file of [documents.filledIn[0].image, documents.signatures[0].file]) {
      expect((await zip.file(file)?.async('uint8array'))?.slice(1, 4)).toEqual(
        new TextEncoder().encode('PNG'),
      );
    }
    // Her mailbox: where she reads and what – never its sign-in (checked with all below).
    const mail = await read('mail.json');
    expect(mail).toEqual([
      expect.objectContaining({
        address: 'anna@firma.de',
        imapServer: 'imap.firma.de',
        signIn: 'microsoft',
        folders: ['Posteingang', 'Gesendet', 'Spam', 'Kunden'],
        conversations: [
          expect.objectContaining({
            subject: 'Angebot',
            aiContext: expect.objectContaining({ summary: 'Ein Kunde schickt ein Angebot.' }),
            aiSummary: expect.objectContaining({ bullets: ['Angebot kommt'] }),
            messages: [
              expect.objectContaining({
                text: 'Anbei das Angebot.',
                seen: false,
                // Where it lies, by the names its folders show under.
                folders: ['Posteingang', 'Kunden'],
                attachments: [expect.objectContaining({ name: 'Angebot.pdf' })],
              }),
            ],
          }),
        ],
      }),
    ]);
    const attachment = mail[0].conversations[0].messages[0].attachments[0].file;
    expect(await zip.file(attachment)?.async('string')).toBe('PDF');
    // Its HTML and the pictures it brings itself (`cid:`) come along too.
    const [inline] = mail[0].conversations[0].messages[0].inlineImages;
    expect(mail[0].conversations[0].messages[0].html).toContain('cid:logo');
    expect(inline).toMatchObject({ cid: 'logo', type: 'image/png' });
    expect(await zip.file(inline.file)?.async('string')).toBe('PNG');
    expect(await read('einladungen.json')).toEqual([
      expect.objectContaining({ email: 'Anna@Firma.de', role: 'member' }),
    ]);

    const everything = await Promise.all(
      Object.values(zip.files).map((file) => file.async('string')),
    );
    expect(everything.join('\n')).not.toMatch(
      /token_hash|refreshToken|publicKey|geheim|anna-login/,
    );
    expect(everything.join('\n')).not.toContain(appHash);

    // Removed from the workspace: the upload is the workspace's now (BER-165); her mailbox
    // there stops syncing and goes, attachments and all – the one elsewhere stays. Her
    // connection there goes too, its sign-in handed back to the service.
    const revoked: string[] = [];
    ctx.deps.ssoNetwork!.fetch = async (url, init) => {
      revoked.push(`${String(url)} ${String(init?.body)}`);
      return new Response(null, { status: 200 });
    };
    const elsewhereId = crypto.randomUUID();
    await ctx.deps.db
      .insert(workspaces)
      .values({ id: elsewhereId, name: 'Privat', slug: 'privat' });
    await join(person.user.id, elsewhereId, 'admin');
    const keptBox = await mailbox(person.user.id, elsewhereId);
    // Her own projects and milestones here go with her own to-dos – back again, none show.
    for (const kind of ['todo-projects', 'todo-milestones'])
      expect(
        (
          await ctx.request(`/api/workspaces/${ctx.workspaceId}/${kind}`, {
            method: 'POST',
            json: { name: 'Privatplan' },
            cookie: person.cookie,
          })
        ).status,
      ).toBe(201);
    const removed = await ctx.request(
      `/api/workspaces/${ctx.workspaceId}/members/${person.user.id}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(204);
    expect(
      (
        await ctx.deps.db
          .select({ id: mailAccounts.id })
          .from(mailAccounts)
          .where(eq(mailAccounts.userId, person.user.id))
      ).map((row) => row.id),
    ).toEqual([keptBox]);
    expect(await ctx.deps.storage.list(`mail/${box}/`)).toEqual([]);
    for (const table of [todoProjects, todoMilestones])
      expect(
        await ctx.deps.db.select().from(table).where(eq(table.ownerId, person.user.id)),
      ).toEqual([]);
    expect(await ctx.deps.storage.list(`mail/${keptBox}/`)).toHaveLength(2);
    await ctx.deps.background?.idle();
    expect(revoked).toEqual([
      'https://mcp.linear.app/revoke token=geheim-at&token_type_hint=access_token',
    ]);
    expect(
      await ctx.deps.db
        .select()
        .from(cloudConnections)
        .where(eq(cloudConnections.userId, person.user.id)),
    ).toEqual([]);
    const after = await JSZip.loadAsync(
      await (await ctx.request('/api/me/export', { cookie: person.cookie })).arrayBuffer(),
    );
    const afterList = JSON.parse(
      (await after.file('praesentationen.json')?.async('string')) ?? '',
    ) as { title: string }[];
    expect(afterList.map((deck) => deck.title)).not.toContain('Annas Deck');
    expect(after.file(ownEntry.file)).toBeNull();
    // Her drafts and pins there go with her: nobody could see or delete them any more.
    expect(JSON.parse((await after.file('entwuerfe.json')?.async('string')) ?? '')).toEqual([]);
    expect(JSON.parse((await after.file('geplant.json')?.async('string')) ?? '')).toEqual([]);
    expect(
      await ctx.deps.db.select().from(attachmentRows).where(eq(attachmentRows.id, plannedFile)),
    ).toEqual([]);
    expect(
      JSON.parse((await after.file('konto.json')?.async('string')) ?? '').senderPinned,
    ).toEqual([]);
  });
});

describe('own account settings', () => {
  it('removing a login signs out everywhere else; renaming renames the comments, an empty name is refused; an own picture is drawn anew and seen by colleagues', async () => {
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

    // An own picture (Konto › Profil): drawn by us as a square JPEG, seen by colleagues only.
    const wide = new Uint8Array(await createCanvas(30, 20).encode('png'));
    const sent = (bytes: Uint8Array, name: string) => {
      const body = new FormData();
      body.append('file', new File([bytes.slice()], name));
      return body;
    };
    const putPicture = (bytes: Uint8Array, name = 'ich.png') =>
      ctx.request('/api/me/picture', {
        method: 'PUT',
        body: sent(bytes, name),
        cookie: here.cookie,
      });
    expect((await putPicture(new TextEncoder().encode('kein Bild'), 'notiz.txt')).status).toBe(400);
    const put = await putPicture(wide);
    expect(put.status).toBe(200);
    const mine = (await put.json()) as MePicture;
    expect(mine).toEqual({ url: expect.stringMatching(/^\/files\/users\/.+\.jpg\?/), ai: false });
    const pictureKey = async () =>
      (
        await ctx.deps.db
          .select({ picture: users.picture })
          .from(users)
          .where(eq(users.id, here.user.id))
      )[0]?.picture ?? null;
    const first = (await pictureKey())!;
    const served = await ctx.request(mine.url!, { cookie: here.cookie });
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    const drawn = await loadImage(new Uint8Array(await served.arrayBuffer()));
    expect([drawn.width, drawn.height]).toEqual([512, 512]);
    const peopleOf = async (cookie?: string) =>
      (await (await ctx.request('/api/people/pictures', { cookie })).json()) as PeoplePictures;
    expect((await peopleOf())[here.user.id]).toBe(mine.url);
    const outsider = await signedInUser(ctx, { name: 'Olaf Berg', email: 'olaf@woanders.de' });
    expect(await peopleOf(outsider.cookie)).toEqual({});
    const exported = await JSZip.loadAsync(
      await (await ctx.request('/api/me/export', { cookie: here.cookie })).arrayBuffer(),
    );
    expect(exported.file('profilbild.jpg')).not.toBeNull();
    // Without an image model that goes after a photo: no „Profibild mit KI“, said so.
    const professional = await ctx.request('/api/me/picture/professional', {
      method: 'POST',
      body: sent(wide, 'foto.png'),
      cookie: here.cookie,
    });
    expect(professional.status).toBe(400);
    expect(JSON.stringify(await professional.json())).toContain('Bildgenerierung');
    // A new picture's file replaces the old one's; deleting goes back to the name's.
    expect((await putPicture(wide)).status).toBe(200);
    expect(await pictureKey()).not.toBe(first);
    expect(await ctx.deps.storage.get(first)).toBeNull();
    const second = (await pictureKey())!;
    expect(
      (await ctx.request('/api/me/picture', { method: 'DELETE', cookie: here.cookie })).status,
    ).toBe(204);
    expect(await (await ctx.request('/api/me/picture', { cookie: here.cookie })).json()).toEqual({
      url: null,
      ai: false,
    });
    expect(await ctx.deps.storage.get(second)).toBeNull();
    expect(await peopleOf()).not.toHaveProperty(here.user.id);
    // A small file claiming more pixels than any phone's photo is not decoded.
    const huge = wide.slice();
    new DataView(huge.buffer).setUint32(16, 8000);
    new DataView(huge.buffer).setUint32(20, 6000);
    const tooBig = await putPicture(huge);
    expect(tooBig.status).toBe(400);
    expect(JSON.stringify(await tooBig.json())).toContain('Megapixel');
    // Each upload or photo for the AI is decoded whole: six a minute per person together (five
    // sent above, the photo among them), then both refused.
    expect((await putPicture(wide)).status).toBe(200);
    expect((await putPicture(wide)).status).toBe(429);
    const photoAgain = await ctx.request('/api/me/picture/professional', {
      method: 'POST',
      body: sent(wide, 'foto.png'),
      cookie: here.cookie,
    });
    expect(photoAgain.status).toBe(429);
    // …without using up the AI's budget, which every other AI feature shares (one photo above).
    const aiLeft = Array.from(
      { length: 19 },
      () => aiLimits(ctx.deps).aiRequests.hit(here.user.id).allowed,
    );
    expect(aiLeft.every(Boolean)).toBe(true);
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
    const run = await rehearsal(roberts.deckId, annaId);
    // Her reply under Robert's note on the material page, the AI key she set.
    const noteId = crypto.randomUUID();
    await ctx.request(`/api/decks/${roberts.deckId}/board/items`, {
      method: 'POST',
      json: { id: noteId, kind: 'box', text: 'Marktgröße?', x: 0, y: 0, w: 200, h: 120 },
    });
    const replyId = crypto.randomUUID();
    await ctx.deps.db.insert(materialQuestions).values({
      id: replyId,
      deckId: roberts.deckId,
      noteId,
      userId: annaId,
      kind: 'reply',
      author: { id: annaId, name: 'Anna Schmidt', type: 'owner', color: 'blue' },
      question: 'Eher 12 Prozent.',
      answer: '',
    });
    const keyId = crypto.randomUUID();
    await ctx.deps.db.insert(integrationKeys).values({
      id: keyId,
      workspaceId: ctx.workspaceId,
      kind: 'ai',
      provider: 'anthropic',
      apiKey: 'sk-ant-anna',
      hint: 'sk-ant-…anna',
      model: 'claude',
      setById: annaId,
      setByName: 'Anna Schmidt',
      setAt: new Date(),
    });
    await ctx.deps.db
      .update(workspaces)
      .set({ aiKeySetById: annaId, aiKeySetByName: 'Anna Schmidt' })
      .where(eq(workspaces.id, ctx.workspaceId));
    // Sender: Robert's direct conversation with her, mentioning her by first and full name;
    // Writer: a comment mentioning her.
    const direct = (await (
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/sender/direct`, {
        method: 'POST',
        json: { userId: annaId },
      })
    ).json()) as { id: string };
    const say = async (text: string, cookie?: string) => {
      const sent = await ctx.request(`/api/sender/channels/${direct.id}/messages`, {
        method: 'POST',
        json: { text },
        cookie,
      });
      expect(sent.status).toBe(201);
      return ((await sent.json()) as { id: string }).id;
    };
    const toHer = await say('Hallo @Anna, und @anna schmidt?');
    const hers = await say('Hallo Robert', person.cookie);
    // Her draft goes with her.
    await ctx.deps.db.insert(senderDrafts).values({
      id: crypto.randomUUID(),
      userId: annaId,
      workspaceId: ctx.workspaceId,
      key: direct.id,
      kind: 'conversation',
      target: { kind: 'conversation' },
      text: 'Noch nicht abgeschickt',
      updatedAt: new Date(),
    });
    // Her message planned for later goes unsent, its file with it – not the file of one stuck
    // after it went out (posted under the plan's id): the message has it.
    const planKey = `workspaces/${ctx.workspaceId}/attachments/plan-file`;
    for (const id of ['plan-file', 'posted-file'])
      await ctx.deps.db.insert(attachmentRows).values({
        id,
        workspaceId: ctx.workspaceId,
        userId: annaId,
        name: 'Plan.txt',
        type: 'text/plain',
        size: 4,
        key: `workspaces/${ctx.workspaceId}/attachments/${id}`,
        takenAt: new Date(),
      });
    await ctx.deps.db.insert(senderScheduled).values({
      id: hers,
      workspaceId: ctx.workspaceId,
      channelId: direct.id,
      userId: annaId,
      text: 'Hallo Robert',
      attachments: [{ id: 'posted-file', name: 'Plan.txt', type: 'text/plain', size: 4 }],
      sendAt: new Date(),
      state: 'failed',
    });
    await ctx.deps.db.insert(senderScheduled).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      channelId: direct.id,
      userId: annaId,
      text: 'Später',
      attachments: [{ id: 'plan-file', name: 'Plan.txt', type: 'text/plain', size: 4 }],
      sendAt: new Date(Date.now() + 86_400_000),
    });
    // Then two more in the workspace: another Anna, and her namesake. Their mentions stay theirs.
    const berg = await signedInUser(ctx, { name: 'Anna Berg', email: 'berg@firma.de' });
    await join(berg.user.id, ctx.workspaceId, 'member');
    const namesake = await signedInUser(ctx, { name: 'Anna Schmidt', email: 'schmidt@firma.de' });
    await join(namesake.user.id, ctx.workspaceId, 'member');
    const both = await say('@Anna Berg und @anna, bitte.');
    const toNamesake = await say('@Anna Schmidt, kommst du?');
    const onlyBerg = await say('Danke @Anna Berg');
    const documentId = crypto.randomUUID();
    await ctx.deps.db.insert(cloudNodes).values({
      id: documentId,
      workspaceId: ctx.workspaceId,
      kind: 'file',
      name: 'Bericht.odt',
    });
    const writerComment = crypto.randomUUID();
    await ctx.deps.db.insert(documentComments).values({
      id: writerComment,
      documentId,
      authorId: ctx.ownerId,
      body: 'Frag @Anna Schmidt.',
    });
    // Her grants outside: a Google one left from before, a connection in Cloud signed in by OAuth
    // at a service that names where to revoke – both revoked once she is gone.
    await ctx.deps.db.insert(googleConnections).values({
      id: crypto.randomUUID(),
      userId: annaId,
      subject: 'sub-anna',
      refreshToken: await encryptToken(ctx.deps.config.secret, 'g-anna', 'google-refresh-token'),
    });
    await ctx.deps.db.insert(cloudConnections).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      userId: annaId,
      name: 'Linear',
      url: 'https://mcp.linear.app/mcp',
      auth: {
        client: { client_id: 'slider-client' },
        tokens: { access_token: 'at-anna', refresh_token: 'rt-anna' },
        discovery: {
          authorizationServerUrl: 'https://mcp.linear.app',
          authorizationServerMetadata: { revocation_endpoint: 'https://mcp.linear.app/revoke' },
        },
      },
      state: 'connected',
      tools: [],
    });
    const revoked: string[] = [];
    ctx.deps.ssoNetwork!.fetch = async (url, init) => {
      revoked.push(`${String(url)} ${String(init?.body)}`);
      return new Response(null, { status: 200 });
    };
    // Her mailboxes, here and in her own workspace: their attachments go too.
    // The one signed in through Microsoft: its refresh token goes with it.
    const mailboxes = [
      await mailbox(annaId, ctx.workspaceId),
      await mailbox(annaId, soloId, 'microsoft'),
    ];
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

    // Her agent goes with her, its chats with it – and the file Robert sent there, its bytes too.
    const herAgent = crypto.randomUUID();
    await ctx.deps.db.insert(cloudAgents).values({
      id: herAgent,
      workspaceId: ctx.workspaceId,
      userId: annaId,
      title: 'Ablage',
    });
    const fileKey = `workspaces/${ctx.workspaceId}/attachments/agent-file`;
    await ctx.deps.db.insert(attachmentRows).values({
      id: 'agent-file',
      workspaceId: ctx.workspaceId,
      userId: ctx.ownerId,
      name: 'Liste.txt',
      type: 'text/plain',
      size: 5,
      key: fileKey,
      takenAt: new Date(),
    });
    await keepAgentMessage(
      ctx.deps.db,
      await openAgentChat(
        ctx.deps.db,
        { id: herAgent, workspaceId: ctx.workspaceId },
        { id: herAgent, userId: annaId, at: ctx.deps.clock.now() },
      ),
      ctx.deps.clock.now(),
      {
        userId: ctx.ownerId,
        text: 'Hier die Liste',
        attachments: [{ id: 'agent-file', name: 'Liste.txt', type: 'text/plain', size: 5 }],
      },
    );
    // Her files are noted for deletion with the rows: a crash after the commit leaves them to
    // the sweep. Gone, the notes go too.
    const transaction = ctx.deps.db.transaction.bind(ctx.deps.db);
    let noted: string[] | undefined;
    ctx.deps.db.transaction = (async (...args: Parameters<typeof transaction>) => {
      const result = await transaction(...args);
      noted ??= (await ctx.deps.db.select().from(blobDeletions)).map((row) => row.key);
      return result;
    }) as typeof transaction;
    const res = await deleteMe(person.cookie, ' Anna@Firma.de ');
    ctx.deps.db.transaction = transaction;
    expect(res.status).toBe(204);
    expect(noted).toEqual(
      expect.arrayContaining([
        recordingKey,
        run.recordingKey,
        blobKeys.deckPrefix(linked.deckId),
        ...mailboxes.map((id) => `mail/${id}/`),
        fileKey,
        planKey,
      ]),
    );
    expect(
      await ctx.deps.db
        .select()
        .from(attachmentRows)
        .where(inArray(attachmentRows.id, ['agent-file', 'plan-file', 'posted-file'])),
    ).toEqual([expect.objectContaining({ id: 'posted-file' })]);
    expect(await ctx.deps.db.select().from(blobDeletions)).toEqual([]);
    // The services are asked to forget her grants after that, in the background.
    await ctx.deps.background?.idle();

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
    // Her rehearsal's recording goes; the run stays with the deck.
    const [runLeft] = await db.select().from(showRuns).where(eq(showRuns.id, run.id));
    expect(runLeft).toMatchObject({ recordingKey: null, recordedBy: null });
    expect(await ctx.deps.storage.get(run.recordingKey)).toBeNull();
    expect(await db.select().from(senderDrafts).where(eq(senderDrafts.userId, annaId))).toEqual([]);
    expect(await db.select().from(mailAccounts).where(eq(mailAccounts.userId, annaId))).toEqual([]);
    expect(revoked).toEqual([
      'https://oauth2.googleapis.com/revoke token=g-anna',
      'https://mcp.linear.app/revoke token=rt-anna&token_type_hint=refresh_token&client_id=slider-client',
      'https://mcp.linear.app/revoke token=at-anna&token_type_hint=access_token&client_id=slider-client',
    ]);
    expect(
      await db.select().from(cloudConnections).where(eq(cloudConnections.userId, annaId)),
    ).toEqual([]);
    for (const id of mailboxes) expect(await ctx.deps.storage.list(`mail/${id}/`)).toEqual([]);
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
    const [reply] = await db
      .select()
      .from(materialQuestions)
      .where(eq(materialQuestions.id, replyId));
    expect(reply).toMatchObject({
      userId: null,
      author: { id: author.id, name: DELETED_ACCOUNT_NAME },
    });
    expect(JSON.stringify(await db.select().from(materialQuestions))).not.toContain(annaId);
    const said = await db
      .select()
      .from(senderMessages)
      .where(eq(senderMessages.channelId, direct.id));
    expect(said.find((m) => m.id === toHer)).toMatchObject({
      text: `Hallo @${DELETED_ACCOUNT_NAME}, und @${DELETED_ACCOUNT_NAME}?`,
      mentions: [],
    });
    expect(said.find((m) => m.id === hers)).toMatchObject({ userId: null, text: 'Hallo Robert' });
    // `@Anna` before „Berg“ is the other Anna's, and with her namesake there the deleted one's
    // own name may be the living one's: those stay as written, only her id goes.
    for (const [id, text] of [
      [both, '@Anna Berg und @anna, bitte.'],
      [toNamesake, '@Anna Schmidt, kommst du?'],
      [onlyBerg, 'Danke @Anna Berg'],
    ] as const) {
      const message = said.find((m) => m.id === id);
      expect(message?.text).toBe(text);
      expect(message?.mentions).toEqual(expect.arrayContaining([berg.user.id, namesake.user.id]));
      expect(message?.mentions).not.toContain(annaId);
    }
    const [conversation] = await db
      .select()
      .from(senderChannels)
      .where(eq(senderChannels.id, direct.id));
    expect(conversation?.directKey).not.toContain(annaId);
    const [writer] = await db
      .select()
      .from(documentComments)
      .where(eq(documentComments.id, writerComment));
    expect(writer?.body).toBe(`Frag @${DELETED_ACCOUNT_NAME}.`);
    const [key] = await db.select().from(integrationKeys).where(eq(integrationKeys.id, keyId));
    expect(key).toMatchObject({ setById: null, setByName: DELETED_ACCOUNT_NAME });
    const [shared] = await db.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
    expect(shared).toMatchObject({ aiKeySetById: null, aiKeySetByName: DELETED_ACCOUNT_NAME });

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
    // The whole account: two days, three downloads – then the page and the link say so.
    expect(mailer.sent.at(-1)?.text).toContain('48 Stunden');
    const exportInfo = (await (await ctx.request(`/api/data-requests/${token}`)).json()) as {
      expiresAt: string;
    };
    expect(
      new Date(exportInfo.expiresAt).getTime() - ctx.clock.now().getTime(),
    ).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
    for (let i = 0; i < 2; i++) {
      expect((await ctx.request(`/api/data-requests/${token}/export`)).status).toBe(200);
    }
    expect((await ctx.request(`/api/data-requests/${token}/export`)).status).toBe(410);
    expect((await ctx.request(`/api/data-requests/${token}`)).status).toBe(410);
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
    expect(subjects()).toEqual(['Dein Konto wird in 6 Monaten gelöscht']);
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
      'Dein Konto wird in 6 Monaten gelöscht',
      'Dein Konto wird in 3 Monaten gelöscht',
      'Dein Konto wird in einem Monat gelöscht',
      'Dein Konto wird in einer Woche gelöscht',
      'Dein Konto wird in 3 Tagen gelöscht',
      'Dein Konto wird übermorgen gelöscht',
      'Dein Konto wird morgen gelöscht',
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
    expect(subjects()).toEqual(['Dein Konto wird in 6 Monaten gelöscht']);

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
    expect(subjects().slice(1)).toEqual(['Dein Konto wird in 6 Monaten gelöscht']);
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

    // „Löschen“ puts it into the trash: in no list, not to be opened, yet whole – and back as
    // it was when restored. Only out of the trash it is gone.
    const listed = async (path: string) =>
      ((await (await ctx.request(path)).json()) as { id: string }[]).map((each) => each.id);
    const picture = (
      (await (await ctx.request('/api/decks')).json()) as { id: string; thumbnailUrl: string }[]
    ).find((each) => each.id === deck.deckId)!.thumbnailUrl;
    expect((await ctx.request(picture)).status).toBe(200);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(204);
    expect(await listed('/api/decks')).not.toContain(deck.deckId);
    expect(await listed('/api/decks/trash')).toEqual([deck.deckId]);
    // The trash shows its picture to whoever may bring it back.
    expect((await ctx.request(picture)).status).toBe(200);
    expect((await ctx.request(`/api/decks/${deck.deckId}`)).status).toBe(404);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/restore`, { method: 'POST' })).status,
    ).toBe(204);
    expect(await listed('/api/decks')).toContain(deck.deckId);
    expect(await listed('/api/decks/trash')).toEqual([]);
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/trash`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(204);
    expect(
      (await ctx.request(`/api/decks/${deck.deckId}/trash`, { method: 'DELETE' })).status,
    ).toBe(204);

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
