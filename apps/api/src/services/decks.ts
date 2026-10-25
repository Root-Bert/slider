import { and, asc, count, desc, eq, inArray, max, min, or, sql, type SQL } from 'drizzle-orm';
import type { Author, Deck, DeckSource } from '@slider/shared';
import { openToViewer, permissionsFor, type DeckViewerAccess } from '../auth/access';
import { displayAuthor, ownerAuthor } from '../authors';
import type { Executor } from '../db/client';
import {
  comments,
  deckAccessGrants,
  decks,
  revisions,
  slideVersions,
  users,
  workspaceMembers,
  type DeckRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { sha256Hex } from '../import/common';
import { isPdfBytes } from '../sources/safe-fetch';
import { pdfMakerOf } from '../import/pdf-maker';
import { blobKeys, fileUrl } from '../storage/blob-storage';
import { deckBlobs, deleteBlobs } from './blob-deletions';
import { toDeckSync } from './deck-sync';
import { isOpenComment } from './open-comments';
import { assertDeckSlot } from './plans';
import { rolesOf } from './workspaces/roles';

export interface DeckDtoOptions {
  /** Who is asking, for `permissions`; without it every permission is `false`. */
  access?: DeckViewerAccess;
}

/** Builds the `Deck` DTOs with their aggregates in a fixed number of queries, however many decks. */
export async function toDeckDtos(
  db: Executor,
  rows: readonly DeckRow[],
  options: DeckDtoOptions = {},
): Promise<Deck[]> {
  if (rows.length === 0) return [];
  const deckIds = rows.map((row) => row.id);
  const revisionIds = rows.flatMap((row) => (row.currentRevisionId ? [row.currentRevisionId] : []));
  const ownerIds = [...new Set(rows.map((row) => row.ownerId))];

  const [owners, revisionNumbers, slideCounts, thumbnails, openCounts, authors, pendingRevisions] =
    await Promise.all([
      db.select().from(users).where(inArray(users.id, ownerIds)),
      revisionIds.length
        ? db
            .select({
              id: revisions.id,
              number: revisions.number,
              summary: revisions.summary,
              officeFailure: revisions.officeFailure,
            })
            .from(revisions)
            .where(inArray(revisions.id, revisionIds))
        : [],
      revisionIds.length
        ? db
            .select({ revisionId: slideVersions.revisionId, count: count() })
            .from(slideVersions)
            // Visible slides only, as the viewer counts them ("1 / n").
            .where(
              and(inArray(slideVersions.revisionId, revisionIds), eq(slideVersions.hidden, false)),
            )
            .groupBy(slideVersions.revisionId)
        : [],
      revisionIds.length
        ? db
            .selectDistinctOn([slideVersions.revisionId], {
              revisionId: slideVersions.revisionId,
              key: slideVersions.thumbnailKey,
              renderer: slideVersions.renderer,
            })
            .from(slideVersions)
            .where(
              and(inArray(slideVersions.revisionId, revisionIds), eq(slideVersions.hidden, false)),
            )
            .orderBy(slideVersions.revisionId, asc(slideVersions.position))
        : [],
      db
        .select({ deckId: comments.deckId, count: count() })
        .from(comments)
        .where(and(inArray(comments.deckId, deckIds), isOpenComment()))
        .groupBy(comments.deckId),
      db
        .select({
          deckId: comments.deckId,
          author: comments.author,
          lastAt: max(comments.createdAt),
        })
        .from(comments)
        .where(inArray(comments.deckId, deckIds))
        .groupBy(comments.deckId, comments.author)
        .orderBy(desc(max(comments.createdAt))),
      db
        .select({ deckId: revisions.deckId, since: min(revisions.createdAt) })
        .from(revisions)
        .where(and(inArray(revisions.deckId, deckIds), eq(revisions.status, 'pending')))
        .groupBy(revisions.deckId),
    ]);

  const ownerById = new Map(owners.map((owner) => [owner.id, ownerAuthor(owner)]));
  const numberByRevision = new Map(revisionNumbers.map((row) => [row.id, row.number]));
  const summaryByRevision = new Map(revisionNumbers.map((row) => [row.id, row.summary]));
  const officeFailureByRevision = new Map(
    revisionNumbers.map((row) => [row.id, row.officeFailure]),
  );
  const pendingByDeck = new Map(pendingRevisions.map((row) => [row.deckId, row.since]));
  const slideCountByRevision = new Map(slideCounts.map((row) => [row.revisionId, row.count]));
  const thumbnailByRevision = new Map(thumbnails.map((row) => [row.revisionId, row]));
  const openCountByDeck = new Map(openCounts.map((row) => [row.deckId, row.count]));
  const participantsByDeck = groupParticipants(authors);

  return rows.map((row) => {
    const owner = ownerById.get(row.ownerId);
    if (!owner) throw new Error(`Owner ${row.ownerId} of deck ${row.id} is missing`);
    const revisionId = row.currentRevisionId ?? '';
    const thumbnail = thumbnailByRevision.get(revisionId);
    const permissions = permissionsFor(options.access, row);
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      title: row.title,
      fileName: row.fileName,
      source: row.source,
      owner,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      revisionNumber: numberByRevision.get(revisionId) ?? 0,
      slideCount: slideCountByRevision.get(revisionId) ?? 0,
      openCommentCount: openCountByDeck.get(row.id) ?? 0,
      thumbnailUrl: thumbnail ? fileUrl(thumbnail.key) : null,
      thumbnailRenderer: thumbnail?.renderer ?? null,
      officeFailure: officeFailureByRevision.get(revisionId) ?? null,
      participants: participantsOf(owner, participantsByDeck.get(row.id) ?? []),
      import: row.importState,
      currentRevisionId: row.currentRevisionId,
      sync: toDeckSync(row, {
        pendingRevisionAt: pendingByDeck.get(row.id) ?? null,
        summary: summaryByRevision.get(revisionId) ?? null,
        hideLoginUrl: !permissions.canManage,
      }),
      permissions,
      folderId: row.folderId,
      restricted: row.restrictedAt !== null,
    };
  });
}

/**
 * Most recent commenters first, one entry per author id. Never merged by name – too many people
 * share one: a PowerPoint author counts as a member only when the import recognised their account
 * (`import/pptx-authors`).
 */
function groupParticipants(
  rows: readonly { deckId: string; author: Author }[],
): Map<string, Author[]> {
  const byDeck = new Map<string, Author[]>();
  for (const { deckId, author } of rows) {
    const list = byDeck.get(deckId) ?? [];
    addParticipant(list, displayAuthor(author));
    byDeck.set(deckId, list);
  }
  return byDeck;
}

/** Adds `author` unless their id is listed already. */
function addParticipant(list: Author[], author: Author): void {
  if (!list.some((known) => known.id === author.id)) list.push(author);
}

/**
 * The avatars of a deck: the Slider accounts that commented, most recent first; the owner when
 * nobody did. Names from the file ("last saved by", the source's contributors) and PowerPoint
 * authors without a recognised account get none – they carry no address to tell who they are.
 */
function participantsOf(owner: Author, commenters: Author[]): Author[] {
  const accounts = commenters.filter((author) => author.type === 'owner');
  return accounts.length ? accounts : [owner];
}

/**
 * Everyone who can open the deck – the members of its workspace, whatever workspace the caller
 * came from (a deck shared with you lives in the sharer's); of a restricted deck only its owner,
 * the admins and the accounts on its list. `@` suggests them (BER-105).
 */
export async function listDeckPeople(db: Executor, deck: DeckRow): Promise<Author[]> {
  const rows = await db
    .select({ user: users })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, deck.workspaceId),
        deck.restrictedAt
          ? or(
              eq(workspaceMembers.role, 'admin'),
              eq(workspaceMembers.userId, deck.ownerId),
              sql`exists (select 1 from ${deckAccessGrants} where ${deckAccessGrants.deckId} = ${deck.id} and ${deckAccessGrants.userId} = ${workspaceMembers.userId})`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(users.name));
  return rows.map((row) => ownerAuthor(row.user));
}

export async function toDeckDto(
  db: Executor,
  row: DeckRow,
  options: DeckDtoOptions = {},
): Promise<Deck> {
  const [deck] = await toDeckDtos(db, [row], options);
  if (!deck) throw new Error(`Deck ${row.id} could not be mapped`);
  return deck;
}

/**
 * Decks of the given workspaces, most recently updated first – without the restricted ones not
 * open to the caller (`deck_access_grants`). Linked ones included, whatever the caller's own
 * accounts at the source may read: the workspace decides (BER-165).
 */
export async function listWorkspaceDecks(
  { db }: Pick<AppDeps, 'db'>,
  workspaceIds: readonly string[],
  access: DeckViewerAccess,
): Promise<Deck[]> {
  if (workspaceIds.length === 0) return [];
  const rows = await db
    .select()
    .from(decks)
    .where(and(inArray(decks.workspaceId, [...workspaceIds]), openToViewer(access)))
    .orderBy(desc(decks.updatedAt));
  return toDeckDtos(db, rows, { access });
}

/** Records activity on a deck so the overview sorts it to the top. */
export async function touchDeck(db: Executor, deckId: string, now: Date): Promise<void> {
  await db.update(decks).set({ updatedAt: now }).where(eq(decks.id, deckId));
}

export interface NewDeckFile {
  fileName: string;
  bytes: Uint8Array;
  /**
   * SHA-256 of the file as it came, when `bytes` is the PDF it became (a Word file, a picture):
   * conversions differ byte by byte each run, so versions are compared by the original.
   */
  sourceSha256?: string;
  source: DeckSource;
  /** For link imports: the pasted link, the provider reference and its change token (BER-92). */
  sourceUrl?: string;
  sourceRef?: string;
  /** Who worked on the linked file, if the source told (`decks.source_contributors`). */
  contributors?: string[] | null;
  changeToken?: string | null;
  /** The Microsoft connection that could read the file (`decks.microsoft_connection_id`). */
  microsoftConnectionId?: string | null;
  /** The Nextcloud connection that could read the file (`decks.nextcloud_connection_id`). */
  nextcloudConnectionId?: string | null;
  /** The Google connection that could read the file (`decks.google_connection_id`). */
  googleConnectionId?: string | null;
}

/**
 * Stores the original, creates deck + revision 1 and queues the import. Returns at once.
 * Fails with `plan_limit` when the workspace has no deck slot left (BER-130).
 * `ownerId` is the creator (whose Microsoft login keeps a linked deck in sync).
 */
export async function createDeckFromFile(
  deps: AppDeps,
  { ownerId, workspaceId }: { ownerId: string; workspaceId: string },
  file: NewDeckFile,
): Promise<Deck> {
  const deckId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const pptxKey = blobKeys.pptx(deckId, revisionId, isPdfBytes(file.bytes) ? 'pdf' : 'pptx');
  const now = deps.clock.now();

  await deps.storage.put(pptxKey, file.bytes);
  const row = await deps.db
    .transaction(async (tx) => {
      // The plan's deck and storage limits (BER-130, BER-151), checked under a lock on the
      // workspace – the reservation below is part of the same transaction.
      await assertDeckSlot(tx, deps.config, workspaceId, {
        addBytes: file.bytes.byteLength,
        now,
      });
      await tx.insert(decks).values({
        id: deckId,
        ownerId,
        linkedById: ownerId,
        workspaceId,
        title: titleFromFileName(file.fileName),
        fileName: file.fileName,
        source: file.source,
        sourceUrl: file.sourceUrl ?? null,
        sourceRef: file.sourceRef ?? null,
        sourceContributors: file.contributors ?? null,
        microsoftConnectionId: file.microsoftConnectionId ?? null,
        nextcloudConnectionId: file.nextcloudConnectionId ?? null,
        googleConnectionId: file.googleConnectionId ?? null,
        createdAt: now,
        updatedAt: now,
        importState: { status: 'queued' },
      });
      await tx.insert(revisions).values({
        id: revisionId,
        deckId,
        number: 1,
        createdAt: now,
        pptxKey,
        sourceChangeToken: file.changeToken ?? null,
        trigger: 'initial',
        contentSha256: file.sourceSha256 ?? sha256Hex(file.bytes),
        pdfRenderer: pdfMakerOf(file.bytes),
        // Held until the import was measured (BER-151): the next upload's check sees it.
        reservedBytes: file.bytes.byteLength,
      });
      const [deck] = await tx
        .update(decks)
        .set({ currentRevisionId: revisionId })
        .where(eq(decks.id, deckId))
        .returning();
      return deck;
    })
    .catch(async (error: unknown) => {
      await deps.storage.deletePrefix(blobKeys.deckPrefix(deckId));
      throw error;
    });
  if (!row) throw new Error('Deck insert returned no row');

  deps.queue.enqueue({ deckId, revisionId });
  return toDeckDto(deps.db, row, {
    access: { kind: 'user', userId: ownerId, roles: await rolesOf(deps.db, ownerId) },
  });
}

/** Deletes the deck with everything in it, files included (BER-121). */
/** Deletes the deck and its files – with `condition`, only if that holds; `false` if not. */
export async function deleteDeck(deps: AppDeps, deckId: string, condition?: SQL): Promise<boolean> {
  const gone = await deps.db
    .delete(decks)
    .where(and(eq(decks.id, deckId), condition))
    .returning({ id: decks.id });
  if (condition && gone.length === 0) return false;
  await deleteBlobs(deps, deckBlobs(blobKeys.deckPrefix(deckId)));
  return true;
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const title = base.replace(/\.[^.]+$/, '').trim();
  return title || base || 'Unbenannte Präsentation';
}
