import { asc, eq, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { withoutCredentials } from '@slider/shared';
import {
  aiProposals,
  commentReactions,
  comments,
  deckEdits,
  decks,
  media,
  microsoftConnections,
  googleConnections,
  nextcloudConnections,
  passkeys,
  revisions,
  sessions,
  userIdentities,
  users,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { notFound } from '../http/errors';
import { normalizeEmail } from './accounts';
import { inviteEntries, invitesTo } from './data-requests';

/**
 * Everything Slider stores about an account, as a ZIP (BER-145: DSGVO Art. 15 copy and Art. 20
 * portability): `konto.json` (profile, logins, passkeys, Microsoft accounts, sessions,
 * workspaces), `praesentationen.json` + the original file of each deck they own in a
 * workspace they are still in,
 * `kommentare.json` (what they wrote, in any deck), `reaktionen.json` (their 👍 / 👎 / egal),
 * `ki-auftraege.json` (what they asked the AI), `bearbeitungen.json` (their edit steps) and
 * `aufnahmen/` (their recordings).
 * Secrets are left out: tokens, passkey keys, session hashes.
 */
export async function exportAccount(
  deps: AppDeps,
  userId: string,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const { db } = deps;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw notFound('Dieses Konto gibt es nicht.');
  const now = deps.clock.now();

  const [
    logins,
    keys,
    microsoft,
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
  ] = await Promise.all([
    db.select().from(userIdentities).where(eq(userIdentities.userId, userId)),
    db.select().from(passkeys).where(eq(passkeys.userId, userId)),
    db.select().from(microsoftConnections).where(eq(microsoftConnections.userId, userId)),
    db.select().from(nextcloudConnections).where(eq(nextcloudConnections.userId, userId)),
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
  ]);

  const zip = new JSZip();
  zip.file('LIESMICH.txt', README);
  zip.file(
    'konto.json',
    json({
      exportedAt: now.toISOString(),
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        color: user.color,
        instanceAdmin: user.isInstanceAdmin,
        createdAt: user.createdAt.toISOString(),
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
      microsoftAccounts: microsoft.map((row) => ({
        account: row.account,
        connected: row.refreshToken !== null,
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
      googleAccounts: google.map((row) => ({
        account: row.account,
        connected: row.refreshToken !== null,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
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
    }),
  );

  // Decks from workspaces they left (from before BER-165, which hands them over): newer
  // versions there are others' work – files and links only where they still are a member.
  const memberOf = new Set(memberships.map(({ member }) => member.workspaceId));
  const deckEntries = [];
  for (const [index, { deck, workspace, pptxKey }] of ownedDecks.entries()) {
    const allowed = memberOf.has(deck.workspaceId);
    const bytes = pptxKey && allowed ? await deps.storage.get(pptxKey) : null;
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

  zip.file(
    'reaktionen.json',
    json(
      reactions.map(({ reaction, deckId }) => ({
        commentId: reaction.commentId,
        deckId,
        kind: reaction.kind,
        createdAt: reaction.createdAt.toISOString(),
      })),
    ),
  );

  const recordingEntries = [];
  for (const row of recordings) {
    const bytes = await deps.media.get(row.storageKey);
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
      createdAt: row.createdAt.toISOString(),
      file,
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

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { fileName: `slider-daten-${now.toISOString().slice(0, 10)}.zip`, bytes };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** A file name safe in any ZIP tool: letters, digits, spaces, `._-`; at most 100 characters. */
const safeName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ._-]/gu, '_')
    .slice(-100)
    .trim() || 'praesentation.pptx';

const README = `Deine Daten aus Slider

konto.json            Profil, Anmeldewege, Passkeys, verbundene Microsoft-, Nextcloud- und Google-Konten, Sitzungen, Workspaces
praesentationen.json  Präsentationen, die dir gehören; die Originaldateien liegen in praesentationen/
kommentare.json       Kommentare und Antworten, die du geschrieben hast – in allen Präsentationen
reaktionen.json       Deine Reaktionen auf Kommentare (up = Daumen hoch, down = Daumen runter, neutral = egal)
aufnahmen.json        Sprach- und Videoaufnahmen sowie Bilder zu deinen Kommentaren (Dateien in aufnahmen/)
einladungen.json      Einladungen in Workspaces an deine Adresse
ki-auftraege.json     Was du die KI an Präsentationen hast ändern lassen
bearbeitungen.json    Deine Bearbeitungsschritte in Präsentationen

Zugangsdaten (Tokens, Passkey-Schlüssel) sind aus Sicherheitsgründen nicht enthalten.
`;
