import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { mailFolderList, READER_SIGNATURE_PREFIX, withoutCredentials } from '@slider/shared';
import {
  aiProposalReactions,
  aiProposals,
  appConnections,
  cloudAreaMembers,
  cloudAreas,
  cloudConnections,
  cloudNodes,
  cloudPins,
  cloudRecents,
  cloudStars,
  commentReactions,
  comments,
  deckBoardItems,
  deckEdits,
  deckMaterials,
  decks,
  documentAiProposals,
  documentCommentReactions,
  documentComments,
  googleConnections,
  cloudAgentFiles,
  cloudAgents,
  materialChatMessages,
  materialChats,
  mailAccounts,
  mailMessages,
  mailInsights,
  mailRules,
  mailThreads,
  mailUploads,
  materialQuestions,
  media,
  nextcloudConnections,
  passkeys,
  pdfAiProposals,
  pdfComments,
  pdfMarks,
  readerSignatures,
  revisions,
  senderChannels,
  senderDrafts,
  senderScheduled,
  senderMembers,
  senderMessages,
  todoDependencies,
  todoMilestones,
  todos,
  calendars,
  calendarEvents,
  senderPins,
  sessions,
  showRuns,
  userIdentities,
  userWords,
  users,
  workspaceMembers,
  workspaceWords,
  workspaces,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, notFound } from '../http/errors';
import { callsOf } from './call-records';
import { normalizeEmail } from './accounts';
import { inviteEntries, invitesTo } from './data-requests';
import { cloudContext, type CloudCtx } from './cloud/context';
import { agentMessagesWhere, type AgentMessageRow } from './agent-chats';

/**
 * Everything Slider stores about an account, as a ZIP (BER-145: DSGVO Art. 15 copy and Art. 20
 * portability): `konto.json` (profile, logins, passkeys, Nextcloud accounts, KI-Apps, sessions,
 * workspaces, Cloud connections, areas, pins, stars, recents, Sender conversations, words taught a
 * workspace), `praesentationen.json` + the original file of each deck they own in a
 * workspace they are still in,
 * `kommentare.json` (what they wrote, in any deck), `reaktionen.json` (their 👍 / 👎 / egal),
 * `ki-auftraege.json` (what they asked the AI), `fragen.json` (their questions about material
 * and the answers), `ki-chats.json` (their chats with the AI on material pages),
 * `agenten.json` (their agents, and what they wrote to colleagues'), `material.json` (what they
 * put on material pages), `nachrichten.json` (their messages in Sender), `anrufe.json` (the calls
 * they were in: their words and the notes after), `dokumente.json` (Writer
 * and Reader: comments, reactions, AI requests, their entries on PDFs, signatures in
 * `unterschriften/`), `todos.json` (their own to-dos and those they wrote in areas),
 * `meilensteine.json` (their own milestones),
 * `kalender.json` (their own calendars and the events in them or that they made elsewhere),
 * `mail.json` (their mailboxes and mail, attachments in `mail/`), `mail-regeln.json` (their rules
 * for senders),
 * `bearbeitungen.json` (their edit steps), `woerterbuch.json` (their own spelling words),
 * `dateien.json` (their own files in Cloud, listed) and `aufnahmen/` (their recordings, with
 * transcripts, and rehearsals). Others' words stay out, except in what is one's own (a
 * colleague's message in one's agent stays, labelled as theirs). Secrets are left out: tokens,
 * passwords, passkey keys, session hashes, mailbox sign-ins.
 */
/**
 * The archive is built in memory, files and all: so only so many at once (one per account), and
 * only so many bytes of files in one – what does not fit is named in its list without its file.
 */
const EXPORTS_AT_ONCE = 2;
const MAX_EXPORT_FILE_BYTES = 1024 ** 3;
const LEFT_OUT = 'Zu groß für dieses Archiv. In Office lässt sich die Datei einzeln herunterladen.';
const running = new WeakMap<object, Set<string>>();

export async function exportAccount(
  deps: AppDeps,
  userId: string,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  let busy = running.get(deps.db);
  if (!busy) running.set(deps.db, (busy = new Set()));
  if (busy.has(userId) || busy.size >= EXPORTS_AT_ONCE) {
    throw new ApiError(
      429,
      'rate_limited',
      busy.has(userId)
        ? 'Deine Daten werden gerade schon zusammengestellt. Bitte warte einen Moment.'
        : 'Gerade werden viele Archive zusammengestellt. Bitte versuch es gleich noch einmal.',
    );
  }
  busy.add(userId);
  try {
    return await buildExport(deps, userId);
  } finally {
    busy.delete(userId);
  }
}

async function buildExport(
  deps: AppDeps,
  userId: string,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const { db } = deps;
  let room = MAX_EXPORT_FILE_BYTES;
  /** A file's bytes while the archive has room for it; `undefined`: left out for its size. */
  const fileOf = async (
    store: Pick<AppDeps['storage'], 'get' | 'size'>,
    key: string,
  ): Promise<Uint8Array | null | undefined> => {
    const size = await store.size(key);
    if (size === null) return null;
    if (size > room) return undefined;
    room -= size;
    return store.get(key);
  };
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw notFound('Dieses Konto gibt es nicht.');
  const now = deps.clock.now();

  const [
    logins,
    keys,
    nextcloud,
    google,
    sessionRows,
    memberships,
    ownedDecks,
    written,
    reactions,
    recordings,
    invites,
    asked,
    edited,
    apps,
    questions,
    chats,
    chatMessages,
  ] = await Promise.all([
    db.select().from(userIdentities).where(eq(userIdentities.userId, userId)),
    db.select().from(passkeys).where(eq(passkeys.userId, userId)),
    db.select().from(nextcloudConnections).where(eq(nextcloudConnections.userId, userId)),
    // Retired: kept only until Google could be reached to revoke the grant.
    db.select().from(googleConnections).where(eq(googleConnections.userId, userId)),
    db.select().from(sessions).where(eq(sessions.userId, userId)),
    db
      .select({ member: workspaceMembers, name: workspaces.name })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId)),
    db
      .select({ deck: decks, workspace: workspaces.name, pptxKey: revisions.pptxKey })
      .from(decks)
      .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
      .leftJoin(revisions, eq(revisions.id, decks.currentRevisionId))
      .where(eq(decks.ownerId, userId))
      .orderBy(asc(decks.createdAt)),
    db
      .select({ comment: comments, deckTitle: decks.title })
      .from(comments)
      .innerJoin(decks, eq(decks.id, comments.deckId))
      .where(sql`${comments.author}->>'id' = ${userId}`)
      .orderBy(asc(comments.createdAt)),
    db
      .select({ reaction: commentReactions, deckId: comments.deckId })
      .from(commentReactions)
      .innerJoin(comments, eq(comments.id, commentReactions.commentId))
      .where(eq(commentReactions.userId, userId))
      .orderBy(asc(commentReactions.createdAt)),
    db.select().from(media).where(eq(media.uploaderId, userId)).orderBy(asc(media.createdAt)),
    invitesTo(deps, normalizeEmail(user.email)),
    db
      .select({ proposal: aiProposals, deckTitle: decks.title })
      .from(aiProposals)
      .innerJoin(decks, eq(decks.id, aiProposals.deckId))
      .where(eq(aiProposals.createdById, userId))
      .orderBy(asc(aiProposals.createdAt)),
    db
      .select({ edit: deckEdits, deckTitle: decks.title })
      .from(deckEdits)
      .innerJoin(decks, eq(decks.id, deckEdits.deckId))
      .where(eq(deckEdits.authorId, userId))
      .orderBy(asc(deckEdits.createdAt)),
    db
      .select({ connection: appConnections, workspace: workspaces.name })
      .from(appConnections)
      .leftJoin(workspaces, eq(workspaces.id, appConnections.workspaceId))
      .where(eq(appConnections.userId, userId))
      .orderBy(asc(appConnections.createdAt)),
    db
      .select({
        question: materialQuestions,
        deckTitle: decks.title,
        documentName: cloudNodes.name,
      })
      .from(materialQuestions)
      // On a deck's board or a text document's: one of the two is there.
      .leftJoin(decks, eq(decks.id, materialQuestions.deckId))
      .leftJoin(cloudNodes, eq(cloudNodes.id, materialQuestions.documentId))
      .where(eq(materialQuestions.userId, userId))
      .orderBy(asc(materialQuestions.createdAt)),
    db
      .select({ chat: materialChats, deckTitle: decks.title, documentName: cloudNodes.name })
      .from(materialChats)
      .leftJoin(decks, eq(decks.id, materialChats.deckId))
      .leftJoin(cloudNodes, eq(cloudNodes.id, materialChats.documentId))
      .where(eq(materialChats.userId, userId))
      .orderBy(asc(materialChats.createdAt)),
    db
      .select({ message: materialChatMessages })
      .from(materialChatMessages)
      .innerJoin(materialChats, eq(materialChats.id, materialChatMessages.chatId))
      .where(eq(materialChats.userId, userId))
      .orderBy(asc(materialChatMessages.seq)),
  ]);

  // In Cloud and Sender: their connections to services outside (never the sign-in), what they
  // pinned, starred and opened last, the areas and conversations they are in, the chats and mails
  // they pinned in Sender, the words they taught a workspace's spell check.
  const nodeName = { id: cloudNodes.id, name: cloudNodes.name };
  const [connections, pins, stars, recents, areas, conversations, senderPinned, taught] =
    await Promise.all([
      db
        .select()
        .from(cloudConnections)
        .where(eq(cloudConnections.userId, userId))
        .orderBy(asc(cloudConnections.createdAt)),
      db
        .select({ node: nodeName, at: cloudPins.createdAt })
        .from(cloudPins)
        .innerJoin(cloudNodes, eq(cloudNodes.id, cloudPins.nodeId))
        .where(eq(cloudPins.userId, userId)),
      db
        .select({ node: nodeName, at: cloudStars.createdAt })
        .from(cloudStars)
        .innerJoin(cloudNodes, eq(cloudNodes.id, cloudStars.nodeId))
        .where(eq(cloudStars.userId, userId)),
      db
        .select({ node: nodeName, at: cloudRecents.at })
        .from(cloudRecents)
        .innerJoin(cloudNodes, eq(cloudNodes.id, cloudRecents.nodeId))
        .where(eq(cloudRecents.userId, userId))
        .orderBy(asc(cloudRecents.at)),
      db
        .select({
          member: cloudAreaMembers,
          area: cloudAreas.name,
          workspaceId: cloudAreas.workspaceId,
        })
        .from(cloudAreaMembers)
        .innerJoin(cloudAreas, eq(cloudAreas.id, cloudAreaMembers.areaId))
        .where(eq(cloudAreaMembers.userId, userId)),
      db
        .select({
          member: senderMembers,
          kind: senderChannels.kind,
          name: senderChannels.name,
          workspaceId: senderChannels.workspaceId,
        })
        .from(senderMembers)
        .innerJoin(senderChannels, eq(senderChannels.id, senderMembers.channelId))
        // How far they read an agent's chats: no conversation they are in (`agenten.json`).
        .where(and(eq(senderMembers.userId, userId), ne(senderChannels.kind, 'agent'))),
      db
        .select()
        .from(senderPins)
        .where(eq(senderPins.userId, userId))
        .orderBy(asc(senderPins.pinnedAt)),
      db
        .select()
        .from(workspaceWords)
        .where(eq(workspaceWords.addedById, userId))
        .orderBy(asc(workspaceWords.word)),
    ]);
  const placed = ({ node, at }: { node: { id: string; name: string }; at: Date }) => ({
    ...node,
    at: at.toISOString(),
  });

  const zip = new JSZip();
  zip.file('LIESMICH.txt', README);
  const picture = user.picture ? await fileOf(deps.storage, user.picture) : null;
  if (picture) zip.file('profilbild.jpg', picture, { compression: 'STORE' });
  zip.file(
    'konto.json',
    json({
      exportedAt: now.toISOString(),
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        color: user.color,
        picture: picture ? 'profilbild.jpg' : null,
        callVoice: user.callVoice,
        mailSyncMinutes: user.mailSyncMinutes,
        showExtensions: user.showExtensions,
        meetingNoticeMinutes: user.meetingNoticeMinutes,
        instanceAdmin: user.isInstanceAdmin,
        createdAt: user.createdAt.toISOString(),
        lastActiveAt: user.lastActiveAt.toISOString(),
      },
      logins: logins.map((row) => ({
        provider: row.provider,
        email: row.email,
        createdAt: row.createdAt.toISOString(),
      })),
      passkeys: keys.map((row) => ({
        name: row.name,
        deviceType: row.deviceType,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })),
      nextcloudAccounts: nextcloud.map((row) => ({
        server: row.serverUrl,
        account: row.loginName,
        connected: row.appPassword !== null,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })),
      ...(google.length > 0 && {
        googleAccounts: google.map((row) => ({
          account: row.account,
          connected: row.refreshToken !== null,
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        })),
      }),
      // „KI-Apps“: which app, for which workspace – never the tokens' hashes.
      aiApps: apps.map(({ connection, workspace }) => ({
        name: connection.name,
        kind: connection.kind,
        workspace: connection.workspaceId ? { id: connection.workspaceId, name: workspace } : null,
        createdAt: connection.createdAt.toISOString(),
        lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
      })),
      sessions: sessionRows.map((row) => ({
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        userAgent: row.userAgent,
      })),
      workspaces: memberships.map(({ member, name }) => ({
        id: member.workspaceId,
        name,
        role: member.role,
        joinedAt: member.createdAt.toISOString(),
      })),
      // „Verbindungen“ in Cloud: which service, never its sign-in (an API's: only its kind).
      cloudConnections: connections.map((row) => ({
        workspaceId: row.workspaceId,
        name: row.name,
        kind: row.kind,
        url: withoutCredentials(row.url),
        ...(row.api && {
          api: {
            auth: row.api.auth,
            header: row.api.header ?? null,
            spec: row.api.spec ? withoutCredentials(row.api.spec) : null,
            about: row.api.about ?? null,
          },
        }),
        state: row.state,
        mayChange: row.mayChange,
        createdAt: row.createdAt.toISOString(),
      })),
      cloudAreas: areas.map(({ member, area, workspaceId }) => ({
        id: member.areaId,
        workspaceId,
        name: area,
        title: member.title,
        since: member.createdAt.toISOString(),
      })),
      cloudPinned: pins.map(placed),
      cloudStarred: stars.map(placed),
      cloudRecent: recents.map(placed),
      senderConversations: conversations.map(({ member, kind, name, workspaceId }) => ({
        id: member.channelId,
        workspaceId,
        kind,
        name: name || null,
        readUpTo: member.readSeq,
        since: member.createdAt.toISOString(),
      })),
      senderPinned: senderPinned.map((pin) => ({
        conversationId: pin.channelId,
        agentId: pin.agentId,
        mailThreadId: pin.threadId,
        at: pin.pinnedAt.toISOString(),
      })),
      workspaceWords: taught.map((row) => ({
        workspaceId: row.workspaceId,
        word: row.word,
        createdAt: row.createdAt.toISOString(),
      })),
    }),
  );

  // Decks from workspaces they left (from before BER-165, which hands them over): newer
  // versions there are others' work – files and links only where they still are a member.
  const memberOf = new Set(memberships.map(({ member }) => member.workspaceId));
  const deckEntries = [];
  for (const [index, { deck, workspace, pptxKey }] of ownedDecks.entries()) {
    const allowed = memberOf.has(deck.workspaceId);
    const bytes = pptxKey && allowed ? await fileOf(deps.storage, pptxKey) : null;
    // A Word file, a picture … is kept as the PDF it became.
    const stored =
      pptxKey?.endsWith('.pdf') && !/\.pdf$/i.test(deck.fileName)
        ? `${deck.fileName.replace(/\.[^.]*$/, '')}.pdf`
        : deck.fileName;
    const file = bytes ? `praesentationen/${index + 1}-${safeName(stored)}` : null;
    if (file && bytes) zip.file(file, bytes, { compression: 'STORE' });
    deckEntries.push({
      id: deck.id,
      title: deck.title,
      fileName: deck.fileName,
      workspace,
      source: deck.source,
      sourceUrl: allowed && deck.sourceUrl ? withoutCredentials(deck.sourceUrl) : null,
      createdAt: deck.createdAt.toISOString(),
      updatedAt: deck.updatedAt.toISOString(),
      archivedAt: deck.archivedAt?.toISOString() ?? null,
      file,
      ...(bytes === undefined ? { note: LEFT_OUT } : {}),
    });
  }
  zip.file('praesentationen.json', json(deckEntries));

  zip.file(
    'kommentare.json',
    json(
      written.map(({ comment, deckTitle }) => ({
        id: comment.id,
        deck: { id: comment.deckId, title: deckTitle },
        slideId: comment.slideId,
        replyTo: comment.parentId,
        body: comment.body,
        status: comment.status,
        source: comment.source,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
      })),
    ),
  );

  // Those to the AI's answers, too.
  const answerReactions = await db
    .select({ reaction: aiProposalReactions, deckId: aiProposals.deckId })
    .from(aiProposalReactions)
    .innerJoin(aiProposals, eq(aiProposals.id, aiProposalReactions.proposalId))
    .where(eq(aiProposalReactions.userId, userId))
    .orderBy(asc(aiProposalReactions.createdAt));
  zip.file(
    'reaktionen.json',
    json([
      ...reactions.map(({ reaction, deckId }) => ({
        commentId: reaction.commentId,
        deckId,
        kind: reaction.kind,
        createdAt: reaction.createdAt.toISOString(),
      })),
      ...answerReactions.map(({ reaction, deckId }) => ({
        aiProposalId: reaction.proposalId,
        deckId,
        kind: reaction.kind,
        createdAt: reaction.createdAt.toISOString(),
      })),
    ]),
  );

  const recordingEntries = [];
  for (const row of recordings) {
    const bytes = await fileOf(deps.media, row.storageKey);
    const extension = row.storageKey.slice(row.storageKey.lastIndexOf('.') + 1);
    const file = bytes ? `aufnahmen/${row.id}.${extension}` : null;
    if (file && bytes) zip.file(file, bytes, { compression: 'STORE' });
    recordingEntries.push({
      id: row.id,
      commentId: row.commentId,
      kind: row.kind,
      position: row.position,
      mimeType: row.mimeType,
      durationMs: row.durationMs,
      transcript: row.transcript,
      transcriptSummary: row.transcriptSummary,
      createdAt: row.createdAt.toISOString(),
      file,
      ...(bytes === undefined ? { note: LEFT_OUT } : {}),
    });
  }
  // Their rehearsals (Präsentieren with a recording): the run's timings and the recording.
  const runs = await db
    .select({ run: showRuns, deckTitle: decks.title })
    .from(showRuns)
    .innerJoin(decks, eq(decks.id, showRuns.deckId))
    .where(eq(showRuns.recordedBy, userId))
    .orderBy(asc(showRuns.at));
  for (const { run, deckTitle } of runs) {
    const key = run.recordingKey;
    const bytes = key ? await fileOf(deps.storage, key) : null;
    const file =
      key && bytes ? `aufnahmen/durchlauf-${run.id}.${key.slice(key.lastIndexOf('.') + 1)}` : null;
    if (file && bytes) zip.file(file, bytes, { compression: 'STORE' });
    recordingEntries.push({
      id: run.id,
      kind: 'rehearsal',
      deck: { id: run.deckId, title: deckTitle },
      total: run.summary.total,
      slides: run.summary.rows.map((row) => ({
        number: row.number,
        title: row.title,
        ms: row.ms,
        skipped: row.skipped,
      })),
      createdAt: run.at.toISOString(),
      file,
      ...(bytes === undefined ? { note: LEFT_OUT } : {}),
    });
  }
  zip.file('aufnahmen.json', json(recordingEntries));
  zip.file('einladungen.json', json(inviteEntries(invites)));
  zip.file(
    'ki-auftraege.json',
    json(
      asked.map(({ proposal, deckTitle }) => ({
        id: proposal.id,
        deck: { id: proposal.deckId, title: deckTitle },
        slideId: proposal.slideId,
        commentId: proposal.commentId,
        prompt: proposal.prompt,
        summary: proposal.summary,
        status: proposal.status,
        createdAt: proposal.createdAt.toISOString(),
      })),
    ),
  );
  zip.file(
    'fragen.json',
    json(
      questions.map(({ question, deckTitle, documentName }) => ({
        id: question.id,
        ...boardOf(question, deckTitle, documentName),
        question: question.question,
        answer: question.answer,
        state: question.state,
        createdAt: question.createdAt.toISOString(),
      })),
    ),
  );
  const messagesOf = new Map<string, (typeof chatMessages)[number]['message'][]>();
  for (const { message } of chatMessages) {
    const list = messagesOf.get(message.chatId);
    if (list) list.push(message);
    else messagesOf.set(message.chatId, [message]);
  }
  // One's agents in Cloud: their chats and what lies (or lay) on their desks.
  const agents = await db
    .select()
    .from(cloudAgents)
    .where(eq(cloudAgents.userId, userId))
    .orderBy(asc(cloudAgents.createdAt));
  const agentMessages = (
    await agentMessagesWhere(
      db,
      inArray(
        senderChannels.agentId,
        agents.map((agent) => agent.id),
      ),
    )
  ).filter((message) => !message.deleted);
  const agentFiles = await db
    .select({ file: cloudAgentFiles })
    .from(cloudAgentFiles)
    .innerJoin(cloudAgents, eq(cloudAgents.id, cloudAgentFiles.agentId))
    .where(eq(cloudAgents.userId, userId))
    .orderBy(asc(cloudAgentFiles.createdAt));
  // What they wrote to colleagues' agents (an agent is a shared space): their messages only.
  const writtenElsewhere = (
    await agentMessagesWhere(
      db,
      and(
        eq(senderMessages.userId, userId),
        isNull(senderMessages.agentId),
        isNull(senderMessages.deletedAt),
      )!,
    )
  ).filter((message) => !agents.some((agent) => agent.id === message.agentId));
  // Hers is what she may still read: an area's agent while she sees the area (`seesAgent`).
  const contexts = new Map<string, Promise<CloudCtx | null>>();
  const contextIn = (workspaceId: string) => {
    let found = contexts.get(workspaceId);
    if (!found) {
      found = cloudContext(db, workspaceId, userId).catch(() => null);
      contexts.set(workspaceId, found);
    }
    return found;
  };
  const seen = new Set<string>();
  for (const agent of agents) {
    const ctx = agent.areaId ? await contextIn(agent.workspaceId) : null;
    if (!agent.shared || !agent.areaId || ctx?.areas.get(agent.areaId)?.access) seen.add(agent.id);
  }
  const elsewhere = writtenElsewhere.length
    ? await db
        .select()
        .from(cloudAgents)
        .where(
          inArray(cloudAgents.id, [...new Set(writtenElsewhere.map((message) => message.agentId))]),
        )
        .orderBy(asc(cloudAgents.createdAt))
    : [];
  /** A person's message: theirs (`null`: from before agents were shared – the owner's) or another's. */
  const roleOf = (message: AgentMessageRow) =>
    message.role !== 'user'
      ? 'KI'
      : message.userId === userId || message.userId === null
        ? 'du'
        : 'andere Person';
  zip.file(
    'agenten.json',
    json([
      ...agents.map((agent) => ({
        id: agent.id,
        workspaceId: agent.workspaceId,
        title: agent.title,
        createdAt: agent.createdAt.toISOString(),
        // One of an area she no longer sees: only what she wrote to it.
        ...(seen.has(agent.id) ? {} : { areaLeft: true }),
        messages: agentMessages
          .filter(
            (message) =>
              message.agentId === agent.id && (seen.has(agent.id) || roleOf(message) === 'du'),
          )
          .map((message) => ({
            role: roleOf(message),
            text: message.text,
            state: message.state,
            createdAt: message.createdAt.toISOString(),
          })),
        files: agentFiles
          .filter(({ file }) => file.agentId === agent.id && seen.has(agent.id))
          .map(({ file }) => ({
            name: file.name,
            kind: file.kind,
            status: file.status,
            content: file.content,
            createdAt: file.createdAt.toISOString(),
          })),
      })),
      ...elsewhere.map((agent) => ({
        id: agent.id,
        workspaceId: agent.workspaceId,
        title: agent.title,
        colleaguesAgent: true,
        createdAt: agent.createdAt.toISOString(),
        messages: writtenElsewhere
          .filter((message) => message.agentId === agent.id)
          .map((message) => ({
            role: 'du',
            text: message.text,
            createdAt: message.createdAt.toISOString(),
          })),
      })),
    ]),
  );
  zip.file(
    'ki-chats.json',
    json(
      chats.map(({ chat, deckTitle, documentName }) => ({
        id: chat.id,
        ...boardOf(chat, deckTitle, documentName),
        title: chat.title,
        createdAt: chat.createdAt.toISOString(),
        messages: (messagesOf.get(chat.id) ?? []).map((message) => ({
          role: message.role === 'user' ? 'du' : 'KI',
          text: message.text,
          state: message.state,
          createdAt: message.createdAt.toISOString(),
        })),
      })),
    ),
  );
  zip.file(
    'bearbeitungen.json',
    json(
      edited.map(({ edit, deckTitle }) => ({
        deck: { id: edit.deckId, title: deckTitle },
        step: edit.seq,
        source: edit.source,
        operations: edit.operations,
        createdAt: edit.createdAt.toISOString(),
      })),
    ),
  );

  const words = await db
    .select()
    .from(userWords)
    .where(eq(userWords.userId, userId))
    .orderBy(asc(userWords.word));
  zip.file(
    'woerterbuch.json',
    json(words.map((row) => ({ word: row.word, createdAt: row.createdAt.toISOString() }))),
  );

  // Their own files in Cloud („Meine Dateien“): what is there, by name and place. The files
  // themselves can be many times an archive built in memory – they are downloaded in Cloud.
  const ownFiles = await db
    .select()
    .from(cloudNodes)
    .where(and(eq(cloudNodes.ownerId, userId), isNull(cloudNodes.areaId)))
    .orderBy(asc(cloudNodes.createdAt));
  zip.file(
    'dateien.json',
    json(
      ownFiles.map((node) => ({
        id: node.id,
        kind: node.kind,
        name: node.name,
        folderId: node.parentId,
        sizeBytes: node.sizeBytes,
        createdAt: node.createdAt.toISOString(),
        updatedAt: node.updatedAt.toISOString(),
        deletedAt: node.deletedAt?.toISOString() ?? null,
      })),
    ),
  );

  // What they put on material pages (a deck's, a text document's): notes and links with their
  // text, files by name – the files themselves are downloaded there.
  const [notes, materials] = await Promise.all([
    db
      .select({ item: deckBoardItems, deckTitle: decks.title, documentName: cloudNodes.name })
      .from(deckBoardItems)
      .leftJoin(decks, eq(decks.id, deckBoardItems.deckId))
      .leftJoin(cloudNodes, eq(cloudNodes.id, deckBoardItems.documentId))
      .where(sql`${deckBoardItems.author}->>'id' = ${userId}`)
      .orderBy(asc(deckBoardItems.createdAt)),
    db
      .select({ material: deckMaterials, deckTitle: decks.title, documentName: cloudNodes.name })
      .from(deckMaterials)
      .leftJoin(decks, eq(decks.id, deckMaterials.deckId))
      .leftJoin(cloudNodes, eq(cloudNodes.id, deckMaterials.documentId))
      .where(sql`${deckMaterials.author}->>'id' = ${userId}`)
      .orderBy(asc(deckMaterials.createdAt)),
  ]);
  zip.file(
    'material.json',
    json({
      notes: notes.map(({ item, deckTitle, documentName }) => ({
        id: item.id,
        ...boardOf(item, deckTitle, documentName),
        kind: item.kind,
        text: item.text,
        url: item.url,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      files: materials.map(({ material, deckTitle, documentName }) => ({
        id: material.id,
        ...boardOf(material, deckTitle, documentName),
        name: material.name,
        kind: material.kind,
        mimeType: material.mimeType,
        sizeBytes: material.sizeBytes,
        createdAt: material.createdAt.toISOString(),
      })),
    }),
  );

  // To-dos: their own, and those they wrote in areas.
  const todoRows = await db
    .select()
    .from(todos)
    .where(or(eq(todos.ownerId, userId), eq(todos.createdBy, userId)))
    .orderBy(asc(todos.createdAt));
  const waits = todoRows.length
    ? await db
        .select()
        .from(todoDependencies)
        .where(
          inArray(
            todoDependencies.todoId,
            todoRows.map((row) => row.id),
          ),
        )
    : [];
  zip.file(
    'todos.json',
    json(
      todoRows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        areaId: row.areaId,
        own: row.ownerId === userId,
        number: row.number,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        startOn: row.startOn,
        dueOn: row.dueOn,
        milestoneId: row.milestoneId,
        blockedBy: waits.filter((one) => one.todoId === row.id).map((one) => one.blockedById),
        source: row.source,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    ),
  );

  // Milestones: their own (an area's are the area's, as its to-dos' plan).
  const milestoneRows = await db
    .select()
    .from(todoMilestones)
    .where(eq(todoMilestones.ownerId, userId))
    .orderBy(asc(todoMilestones.createdAt));
  zip.file(
    'meilensteine.json',
    json(
      milestoneRows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        name: row.name,
        dueOn: row.dueOn,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    ),
  );

  // Calendars: their own (private, sub-calendars, the mail accounts' names) and the events in
  // them or that they made in areas'. A mail account's events stay at the provider: none here.
  const ownCalendars = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.ownerId, userId), isNull(calendars.areaId)))
    .orderBy(asc(calendars.createdAt));
  const ownCalendarIds = ownCalendars.map((row) => row.id);
  const eventRows = await db
    .select()
    .from(calendarEvents)
    .where(
      ownCalendarIds.length
        ? or(
            inArray(calendarEvents.calendarId, ownCalendarIds),
            eq(calendarEvents.createdBy, userId),
          )
        : eq(calendarEvents.createdBy, userId),
    )
    .orderBy(asc(calendarEvents.startsAt));
  zip.file(
    'kalender.json',
    json({
      calendars: ownCalendars.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        parentId: row.parentId,
        kind: row.mailAccountId ? 'mail' : 'private',
        mailAccountId: row.mailAccountId,
        remoteId: row.remoteId,
        name: row.name || (row.parentId || row.mailAccountId ? '' : 'Privat'),
        color: row.color,
        // A mail calendar's name and colour in Slider alone, over the provider's.
        ...(row.mailAccountId && { localName: row.localName, localColor: row.localColor }),
        createdAt: row.createdAt.toISOString(),
      })),
      events: eventRows.map((row) => ({
        id: row.id,
        calendarId: row.calendarId,
        title: row.title,
        location: row.location,
        notes: row.notes,
        meetingUrl: row.meetingUrl,
        callChannelId: row.callChannelId,
        allDay: row.allDay,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        // A series: its RRULE from the first one, in its zone, the starts left out.
        ...(row.recurrence && {
          recurrence: row.recurrence,
          timeZone: row.timeZone,
          exdates: row.exdates,
        }),
        madeByYou: row.createdBy === userId,
        createdAt: row.createdAt.toISOString(),
      })),
    }),
  );

  // Sender: what they wrote, by conversation – not what others wrote there.
  const said = await db
    .select({
      message: senderMessages,
      kind: senderChannels.kind,
      channel: senderChannels.name,
      area: cloudAreas.name,
      workspaceId: senderChannels.workspaceId,
    })
    .from(senderMessages)
    .innerJoin(senderChannels, eq(senderChannels.id, senderMessages.channelId))
    .leftJoin(cloudAreas, eq(cloudAreas.id, senderChannels.areaId))
    .where(
      and(
        eq(senderMessages.userId, userId),
        isNull(senderMessages.deletedAt),
        // Their agents' chats: `agenten.json`.
        ne(senderChannels.kind, 'agent'),
      ),
    )
    .orderBy(asc(senderMessages.createdAt));
  zip.file(
    'nachrichten.json',
    json(
      said.map(({ message, kind, channel, area, workspaceId }) => ({
        conversation: {
          id: message.channelId,
          workspaceId,
          kind,
          name: channel || (kind === 'area' ? area : null) || null,
        },
        text: message.text,
        ...(message.mail ? { mail: message.mail } : {}),
        editedAt: message.editedAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
      })),
    ),
  );

  // What they wrote and did not send yet (`sender_drafts`): theirs alone, as they left it.
  const drafts = await db
    .select()
    .from(senderDrafts)
    .where(eq(senderDrafts.userId, userId))
    .orderBy(asc(senderDrafts.updatedAt));
  zip.file(
    'entwuerfe.json',
    json(
      drafts.map((row) => ({
        workspaceId: row.workspaceId,
        key: row.key,
        kind: row.kind,
        target: row.target,
        text: row.text,
        updatedAt: row.updatedAt.toISOString(),
      })),
    ),
  );

  // What they (or their agents for them) planned to send later („Später senden“).
  const plannedRows = await db
    .select()
    .from(senderScheduled)
    .where(eq(senderScheduled.userId, userId))
    .orderBy(asc(senderScheduled.sendAt));
  zip.file(
    'geplant.json',
    json(
      plannedRows.map((row) => ({
        workspaceId: row.workspaceId,
        conversationId: row.channelId,
        agentId: row.agentId,
        text: row.text,
        attachments: row.attachments.map((one) => one.name),
        sendAt: row.sendAt.toISOString(),
        state: row.state,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
      })),
    ),
  );

  // Calls they were in (written down): their own words and the notes written after.
  zip.file('anrufe.json', json(await callsOf({ db }, userId)));

  // Writer and Reader: their comments on text documents and PDFs, their reactions, what they
  // had the AI do there, what they filled in on PDFs and the signatures they keep.
  const fileOfRow = (id: string, name: string | null) => ({ id, name });
  const [writerComments, readerComments, writerReactions, writerAsked, readerAsked, marks, signs] =
    await Promise.all([
      db
        .select({ comment: documentComments, name: cloudNodes.name })
        .from(documentComments)
        .leftJoin(cloudNodes, eq(cloudNodes.id, documentComments.documentId))
        .where(eq(documentComments.authorId, userId))
        .orderBy(asc(documentComments.createdAt)),
      db
        .select({ comment: pdfComments, name: cloudNodes.name })
        .from(pdfComments)
        .leftJoin(cloudNodes, eq(cloudNodes.id, pdfComments.pdfId))
        .where(eq(pdfComments.authorId, userId))
        .orderBy(asc(pdfComments.createdAt)),
      db
        .select({ reaction: documentCommentReactions })
        .from(documentCommentReactions)
        .where(eq(documentCommentReactions.userId, userId))
        .orderBy(asc(documentCommentReactions.createdAt)),
      db
        .select({ proposal: documentAiProposals, name: cloudNodes.name })
        .from(documentAiProposals)
        .leftJoin(cloudNodes, eq(cloudNodes.id, documentAiProposals.documentId))
        .where(eq(documentAiProposals.createdBy, userId))
        .orderBy(asc(documentAiProposals.createdAt)),
      db
        .select({ proposal: pdfAiProposals, name: cloudNodes.name })
        .from(pdfAiProposals)
        .leftJoin(cloudNodes, eq(cloudNodes.id, pdfAiProposals.pdfId))
        .where(eq(pdfAiProposals.createdBy, userId))
        .orderBy(asc(pdfAiProposals.createdAt)),
      // Their own entries only: on a PDF others filled in too, those stay theirs.
      db
        .select({ mark: pdfMarks, name: cloudNodes.name })
        .from(pdfMarks)
        .leftJoin(cloudNodes, eq(cloudNodes.id, pdfMarks.pdfId))
        .where(eq(pdfMarks.authorId, userId))
        .orderBy(asc(pdfMarks.updatedAt)),
      db
        .select()
        .from(readerSignatures)
        .where(eq(readerSignatures.userId, userId))
        .orderBy(asc(readerSignatures.createdAt)),
    ]);
  /** A signature's picture as a file of its own, in place of its data URL. */
  const signatureFile = (image: string, name: string) => {
    if (!image.startsWith(READER_SIGNATURE_PREFIX)) return null;
    const file = `unterschriften/${name}.png`;
    zip.file(file, image.slice(READER_SIGNATURE_PREFIX.length), { base64: true });
    return file;
  };
  const commentEntry = (
    app: 'writer' | 'reader',
    fileId: string,
    name: string | null,
    comment: Pick<
      typeof documentComments.$inferSelect,
      'id' | 'parentId' | 'body' | 'status' | 'createdAt' | 'updatedAt'
    > & { anchor: unknown },
  ) => ({
    id: comment.id,
    app,
    file: fileOfRow(fileId, name),
    replyTo: comment.parentId,
    body: comment.body,
    anchor: comment.anchor,
    status: comment.status,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  });
  zip.file(
    'dokumente.json',
    json({
      comments: [
        ...writerComments.map(({ comment, name }) =>
          commentEntry('writer', comment.documentId, name, comment),
        ),
        ...readerComments.map(({ comment, name }) =>
          commentEntry('reader', comment.pdfId, name, comment),
        ),
      ],
      reactions: writerReactions.map(({ reaction }) => ({
        commentId: reaction.commentId,
        kind: reaction.kind,
        createdAt: reaction.createdAt.toISOString(),
      })),
      aiRequests: [
        ...writerAsked.map(({ proposal, name }) => ({
          app: 'writer',
          file: fileOfRow(proposal.documentId, name),
          commentId: proposal.commentId,
          summary: proposal.summary,
          status: proposal.status,
          createdAt: proposal.createdAt.toISOString(),
        })),
        ...readerAsked.map(({ proposal, name }) => ({
          app: 'reader',
          file: fileOfRow(proposal.pdfId, name),
          commentId: proposal.commentId,
          summary: proposal.summary,
          status: proposal.status,
          createdAt: proposal.createdAt.toISOString(),
        })),
      ],
      filledIn: marks.map(({ mark, name }, index) => {
        const { body } = mark;
        return {
          file: fileOfRow(mark.pdfId, name),
          id: mark.id,
          ...(body.kind === 'signature'
            ? { ...body, image: signatureFile(body.image, `eintrag-${index + 1}`) }
            : body),
          updatedAt: mark.updatedAt.toISOString(),
        };
      }),
      signatures: signs.map((row, index) => ({
        id: row.id,
        width: row.width,
        height: row.height,
        file: signatureFile(row.image, `${index + 1}`),
        createdAt: row.createdAt.toISOString(),
      })),
    }),
  );

  // Their mailboxes: where they read (never the sign-in), the mail read here with what the AI
  // made of each conversation, and the attachments while the archive has room.
  const mailboxes = await db
    .select({ account: mailAccounts, workspace: workspaces.name })
    .from(mailAccounts)
    .leftJoin(workspaces, eq(workspaces.id, mailAccounts.workspaceId))
    .where(eq(mailAccounts.userId, userId))
    .orderBy(asc(mailAccounts.createdAt));
  const mailThreadRows = await db
    .select({ thread: mailThreads })
    .from(mailThreads)
    .innerJoin(mailAccounts, eq(mailAccounts.id, mailThreads.accountId))
    .where(eq(mailAccounts.userId, userId))
    .orderBy(asc(mailThreads.lastAt));
  // The AI panel's bullets (kept 14 days at most): with their conversation, as `aiContext` is.
  const summaries = new Map(
    (
      await db
        .select({
          threadId: mailInsights.threadId,
          payload: mailInsights.payload,
          at: mailInsights.createdAt,
        })
        .from(mailInsights)
        .where(eq(mailInsights.userId, userId))
    ).map((row) => [row.threadId, { ...row.payload, madeAt: row.at.toISOString() }]),
  );
  const mails = await db
    .select({ message: mailMessages })
    .from(mailMessages)
    .innerJoin(mailAccounts, eq(mailAccounts.id, mailMessages.accountId))
    .where(eq(mailAccounts.userId, userId))
    .orderBy(asc(mailMessages.sentAt));
  // Each mail's folders by the names they show under („Posteingang“, „Kunden / Acme“).
  const folderNames = new Map(
    mailboxes.map(({ account }) => [
      account.id,
      new Map(mailFolderList(account.folders).map((one) => [one.key, one.name])),
    ]),
  );
  const mailEntry = async ({ message }: (typeof mails)[number]) => {
    const attachments = [];
    for (const attachment of message.attachments) {
      const bytes = await fileOf(deps.storage, attachment.key);
      const file = bytes ? `mail/${attachment.id}-${safeName(attachment.name)}` : null;
      if (file && bytes) zip.file(file, bytes, { compression: 'STORE' });
      attachments.push({
        name: attachment.name,
        type: attachment.type,
        sizeBytes: attachment.size,
        file,
        ...(bytes === undefined ? { note: LEFT_OUT } : {}),
      });
    }
    // The pictures its HTML shows from the mail itself (`cid:`), beside the attachments.
    const inlineImages = [];
    for (const image of message.inlineImages) {
      const bytes = await fileOf(deps.storage, image.key);
      const file = bytes ? `mail/${image.id}-${safeName(image.cid)}` : null;
      if (file && bytes) zip.file(file, bytes, { compression: 'STORE' });
      inlineImages.push({
        cid: image.cid,
        type: image.type,
        sizeBytes: image.size,
        file,
        ...(bytes === undefined ? { note: LEFT_OUT } : {}),
      });
    }
    return {
      folder: message.folder,
      folders: message.folders.map((key) => folderNames.get(message.accountId)?.get(key) ?? key),
      from: message.from,
      to: message.to,
      cc: message.cc,
      ...(message.bcc.length > 0 ? { bcc: message.bcc } : {}),
      subject: message.subject,
      text: message.text,
      /** Its HTML part as kept (sanitized), where it has one. */
      ...(message.html ? { html: message.html } : {}),
      ...(inlineImages.length > 0 ? { inlineImages } : {}),
      outgoing: message.outgoing,
      /** Read (as on the server, or read here). */
      seen: message.seen,
      sentAt: message.sentAt.toISOString(),
      /** Still in the outbox: `queued` until `sendAt`, `sending`, or `failed`. */
      ...(message.sendState
        ? { outbox: { state: message.sendState, sendAt: message.sendAt?.toISOString() ?? null } }
        : {}),
      attachments,
    };
  };
  // Files added to a mail not yet sent (kept 7 days, `mail_uploads`).
  const uploadsOf = async (accountId: string) => {
    const rows = await deps.db
      .select()
      .from(mailUploads)
      .where(eq(mailUploads.accountId, accountId))
      .orderBy(asc(mailUploads.createdAt));
    const waiting = [];
    for (const upload of rows) {
      const bytes = await fileOf(deps.storage, upload.key);
      const file = bytes ? `mail/${upload.id}-${safeName(upload.name)}` : null;
      if (file && bytes) zip.file(file, bytes, { compression: 'STORE' });
      waiting.push({
        name: upload.name,
        type: upload.type,
        sizeBytes: upload.size,
        addedAt: upload.createdAt.toISOString(),
        file,
        ...(bytes === undefined ? { note: LEFT_OUT } : {}),
      });
    }
    return waiting;
  };
  const mailEntries = [];
  for (const { account, workspace } of mailboxes) {
    if (account.calendarOnly) {
      // A Google calendar connected without a mailbox: no mail, no servers – never its token.
      mailEntries.push({
        workspace: { id: account.workspaceId, name: workspace },
        address: account.address,
        kind: 'Kalenderverbindung (nur Kalender, kein Postfach)',
        signIn: account.auth,
        state: account.state,
        createdAt: account.createdAt.toISOString(),
      });
      continue;
    }
    const own = mails.filter(({ message }) => message.accountId === account.id);
    const conversations = [];
    for (const { thread } of mailThreadRows.filter((row) => row.thread.accountId === account.id)) {
      const messages = [];
      for (const mail of own.filter(({ message }) => message.threadId === thread.id)) {
        messages.push(await mailEntry(mail));
      }
      conversations.push({
        subject: thread.subject,
        spam: thread.spam,
        spamBy: thread.spamBy,
        lastAt: thread.lastAt.toISOString(),
        readAt: thread.readAt?.toISOString() ?? null,
        aiContext: thread.context,
        aiSummary: summaries.get(thread.id) ?? null,
        messages,
      });
    }
    // A colleague's mail that went into a chat in Sender: it has no conversation here.
    const toChats = [];
    for (const mail of own.filter(({ message }) => message.threadId === null)) {
      toChats.push(await mailEntry(mail));
    }
    mailEntries.push({
      workspace: { id: account.workspaceId, name: workspace },
      address: account.address,
      name: account.name,
      label: account.label,
      signature: account.signature,
      imapServer: account.imapHost,
      smtpServer: account.smtpHost,
      /** How it signs in (`password`, `microsoft`, `google`) – never the password or token. */
      signIn: account.auth,
      state: account.state,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
      folders: mailFolderList(account.folders).map((one) => one.name),
      conversations,
      mailsToChats: toChats,
      attachmentsWaiting: await uploadsOf(account.id),
    });
  }
  zip.file('mail.json', json(mailEntries));
  // Their own rules for senders (blocked, trusted), per workspace.
  const ruleRows = await db
    .select({ rule: mailRules, workspace: workspaces.name })
    .from(mailRules)
    .leftJoin(workspaces, eq(workspaces.id, mailRules.workspaceId))
    .where(eq(mailRules.userId, userId))
    .orderBy(asc(mailRules.createdAt));
  zip.file(
    'mail-regeln.json',
    json(
      ruleRows.map(({ rule, workspace }) => ({
        workspace: { id: rule.workspaceId, name: workspace },
        kind: rule.kind === 'block' ? 'blockiert' : 'vertraut',
        match: rule.match === 'address' ? 'Adresse' : 'Domain',
        value: rule.value,
        createdAt: rule.createdAt.toISOString(),
      })),
    ),
  );

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { fileName: `slider-daten-${now.toISOString().slice(0, 10)}.zip`, bytes };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Whose board a question or chat is on: the presentation, or the text document (Writer). */
const boardOf = (
  row: { deckId: string | null; documentId: string | null },
  deckTitle: string | null,
  documentName: string | null,
) =>
  row.documentId
    ? { document: { id: row.documentId, title: documentName?.replace(/\.odt$/i, '') ?? null } }
    : { deck: { id: row.deckId, title: deckTitle } };

/** A file name safe in any ZIP tool: letters, digits, spaces, `._-`; at most 100 characters. */
const safeName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ._-]/gu, '_')
    .slice(-100)
    .trim() || 'praesentation.pptx';

const README = `Deine Daten aus Office

konto.json            Profil (dein Bild in profilbild.jpg), Anmeldewege, Passkeys, verbundene Nextcloud-Konten, KI-Apps, Sitzungen, Workspaces, Verbindungen, Bereiche, Angepinntes (in der Cloud und im Sender), Favoriten, zuletzt Geöffnetes, Unterhaltungen im Sender, Wörter für Workspaces
praesentationen.json  Präsentationen, die dir gehören; die Originaldateien liegen in praesentationen/
kommentare.json       Kommentare und Antworten, die du geschrieben hast – in allen Präsentationen
reaktionen.json       Deine Reaktionen auf Kommentare und KI-Antworten (up = Daumen hoch, down = Daumen runter, neutral = egal)
aufnahmen.json        Sprach- und Videoaufnahmen (mit Abschrift) sowie Bilder zu deinen Kommentaren, deine Probedurchläufe (Dateien in aufnahmen/)
einladungen.json      Einladungen in Workspaces an deine Adresse
ki-auftraege.json     Was du die KI an Präsentationen hast ändern lassen
fragen.json           Deine Notizen, die du der KI übergeben hast (⌘↵), und ihre Antworten
ki-chats.json         Deine Chats mit der KI auf den Materialseiten
agenten.json          Deine Agenten in der Cloud: ihre Chats und was sie geschrieben haben; was du Agenten anderer geschrieben hast
bearbeitungen.json    Deine Bearbeitungsschritte in Präsentationen
woerterbuch.json      Wörter, die du der Rechtschreibprüfung beigebracht hast
dateien.json          Deine eigenen Dateien und Ordner in der Cloud; die Dateien selbst lädst du dort herunter
material.json         Notizen, Links und Dateien (nur benannt), die du auf Materialseiten gelegt hast
nachrichten.json      Deine Nachrichten im Sender (nicht die der anderen)
entwuerfe.json        Was du geschrieben und noch nicht abgeschickt hast – in Unterhaltungen, an Agenten, als Mail
geplant.json          Nachrichten, die du (oder dein Agent) für später geplant hast und die noch nicht gesendet sind
anrufe.json           Anrufe, in denen du warst: wann, mit wem, was du gesagt hast, und die Notizen danach
dokumente.json        Deine Kommentare in Textdokumenten und PDFs, deine Reaktionen, KI-Aufträge dort, was du in PDFs ausgefüllt hast; Unterschriften in unterschriften/
todos.json            Deine eigenen Aufgaben und die, die du in Bereichen angelegt hast
meilensteine.json     Deine eigenen Meilensteine
kalender.json         Deine eigenen Kalender (dein privater und die du angelegt hast, die Namen der Kalender deiner Postfächer) mit ihren Terminen und die Termine, die du in Kalendern von Bereichen angelegt hast; Termine aus Postfächern bleiben beim Anbieter
mail.json             Deine Postfächer (Adresse, Server – ohne Anmeldedaten), die hier gelesenen und geschriebenen Mails (Text und gestaltete Fassung, Empfänger mit Bcc, was noch im Postausgang liegt) mit dem, was die KI dazu notiert hat; Anhänge und Bilder der Mails und Dateien, die an noch nicht gesendeten Mails hängen, in mail/
mail-regeln.json      Deine Regeln für Absender: blockiert (landet in Spam) oder vertraut (nie in Spam)

Zugangsdaten (Tokens, Passkey-Schlüssel) sind aus Sicherheitsgründen nicht enthalten.
`;
