import { and, asc, count, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import type { Author, Deck, DeckSource } from '@slider/shared';
import { ownerAuthor } from '../authors';
import type { Executor } from '../db/client';
import { comments, decks, revisions, slideVersions, users, type DeckRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { blobKeys, fileUrl } from '../storage/blob-storage';

const MAX_PARTICIPANTS = 5;

/** Builds the `Deck` DTOs with their aggregates in a fixed number of queries, however many decks. */
export async function toDeckDtos(db: Executor, rows: readonly DeckRow[]): Promise<Deck[]> {
  if (rows.length === 0) return [];
  const deckIds = rows.map((row) => row.id);
  const revisionIds = rows.flatMap((row) => (row.currentRevisionId ? [row.currentRevisionId] : []));
  const ownerIds = [...new Set(rows.map((row) => row.ownerId))];

  const [owners, revisionNumbers, slideCounts, thumbnails, openCounts, authors] = await Promise.all(
    [
      db.select().from(users).where(inArray(users.id, ownerIds)),
      revisionIds.length
        ? db
            .select({ id: revisions.id, number: revisions.number })
            .from(revisions)
            .where(inArray(revisions.id, revisionIds))
        : [],
      revisionIds.length
        ? db
            .select({ revisionId: slideVersions.revisionId, count: count() })
            .from(slideVersions)
            .where(inArray(slideVersions.revisionId, revisionIds))
            .groupBy(slideVersions.revisionId)
        : [],
      revisionIds.length
        ? db
            .selectDistinctOn([slideVersions.revisionId], {
              revisionId: slideVersions.revisionId,
              key: slideVersions.thumbnailKey,
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
        .where(
          and(
            inArray(comments.deckId, deckIds),
            isNull(comments.parentId),
            eq(comments.status, 'open'),
          ),
        )
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
    ],
  );

  const ownerById = new Map(owners.map((owner) => [owner.id, ownerAuthor(owner)]));
  const numberByRevision = new Map(revisionNumbers.map((row) => [row.id, row.number]));
  const slideCountByRevision = new Map(slideCounts.map((row) => [row.revisionId, row.count]));
  const thumbnailByRevision = new Map(thumbnails.map((row) => [row.revisionId, fileUrl(row.key)]));
  const openCountByDeck = new Map(openCounts.map((row) => [row.deckId, row.count]));
  const participantsByDeck = groupParticipants(authors);

  return rows.map((row) => {
    const owner = ownerById.get(row.ownerId);
    if (!owner) throw new Error(`Owner ${row.ownerId} of deck ${row.id} is missing`);
    const revisionId = row.currentRevisionId ?? '';
    return {
      id: row.id,
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
      thumbnailUrl: thumbnailByRevision.get(revisionId) ?? null,
      participants: participantsByDeck.get(row.id) ?? [],
      import: row.importState,
    };
  });
}

/**
 * Most recent commenters first, one entry per person. Matched by name as well as id, because
 * someone who commented in PowerPoint and later as a guest has two ids but is one participant.
 */
function groupParticipants(
  rows: readonly { deckId: string; author: Author }[],
): Map<string, Author[]> {
  const byDeck = new Map<string, Author[]>();
  const samePerson = (a: Author, b: Author) =>
    a.id === b.id || a.name.toLowerCase() === b.name.toLowerCase();
  for (const { deckId, author } of rows) {
    const list = byDeck.get(deckId) ?? [];
    if (list.length < MAX_PARTICIPANTS && !list.some((known) => samePerson(known, author)))
      list.push(author);
    byDeck.set(deckId, list);
  }
  return byDeck;
}

export async function toDeckDto(db: Executor, row: DeckRow): Promise<Deck> {
  const [deck] = await toDeckDtos(db, [row]);
  if (!deck) throw new Error(`Deck ${row.id} could not be mapped`);
  return deck;
}

export async function listOwnerDecks(db: Executor, ownerId: string): Promise<Deck[]> {
  const rows = await db
    .select()
    .from(decks)
    .where(eq(decks.ownerId, ownerId))
    .orderBy(desc(decks.updatedAt));
  return toDeckDtos(db, rows);
}

/** Records activity on a deck so the overview sorts it to the top. */
export async function touchDeck(db: Executor, deckId: string, now: Date): Promise<void> {
  await db.update(decks).set({ updatedAt: now }).where(eq(decks.id, deckId));
}

export interface NewDeckFile {
  fileName: string;
  bytes: Uint8Array;
  source: DeckSource;
  /** For link imports: the pasted link, the provider reference and its change token (BER-92). */
  sourceUrl?: string;
  sourceRef?: string;
  changeToken?: string | null;
}

/** Stores the original, creates deck + revision 1 and queues the import. Returns at once. */
export async function createDeckFromFile(
  deps: AppDeps,
  ownerId: string,
  file: NewDeckFile,
): Promise<Deck> {
  const deckId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const pptxKey = blobKeys.pptx(deckId, revisionId);
  const now = deps.clock.now();

  await deps.storage.put(pptxKey, file.bytes);
  const row = await deps.db.transaction(async (tx) => {
    await tx.insert(decks).values({
      id: deckId,
      ownerId,
      title: titleFromFileName(file.fileName),
      fileName: file.fileName,
      source: file.source,
      sourceUrl: file.sourceUrl ?? null,
      sourceRef: file.sourceRef ?? null,
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
    });
    const [deck] = await tx
      .update(decks)
      .set({ currentRevisionId: revisionId })
      .where(eq(decks.id, deckId))
      .returning();
    return deck;
  });
  if (!row) throw new Error('Deck insert returned no row');

  deps.queue.enqueue({ deckId, revisionId });
  return toDeckDto(deps.db, row);
}

/** Deletes the deck with everything in it, files included (BER-121). */
export async function deleteDeck(deps: AppDeps, deckId: string): Promise<void> {
  await deps.db.delete(decks).where(eq(decks.id, deckId));
  await deps.storage.deletePrefix(blobKeys.deckPrefix(deckId));
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const title = base.replace(/\.[^.]+$/, '').trim();
  return title || base || 'Unbenannte Präsentation';
}
