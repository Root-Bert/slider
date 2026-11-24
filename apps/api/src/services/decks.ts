import { deckPlaceWords } from './deck-place-words';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  min,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  DEFAULT_AI_NAME,
  aiNameOf,
  type Author,
  type Deck,
  type DeckPlace,
  type DeckSource,
  type DeckTemplate,
  type TemplateColor,
  type UpdateDeckInput,
  DECK_TRASH_DAYS,
} from '@slider/shared';
import { openToViewer, permissionsFor, type DeckViewerAccess } from '../auth/access';
import { displayAuthor, ownerAuthor } from '../authors';
import type { Executor } from '../db/client';
import {
  cloudNodes,
  comments,
  deckAccessGrants,
  decks,
  revisions,
  slideVersions,
  users,
  integrationKeys,
  workspaceMasters,
  workspaceMembers,
  workspaces,
  type DeckRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { sha256Hex } from '../import/common';
import { purgeRow } from './cloud/nodes';
import { readPolicy, ruleFor } from './integration-keys';
import { deckFileExtension } from '../import/odp-deck';
import { pdfMakerOf } from '../import/pdf-maker';
import { insertReadySlides, storeReadyPictures, type ReadyImport } from '../import/ready-blank';
import { remeasureDeck } from './workspace-storage';
import { blobKeys, fileUrl } from '../storage/blob-storage';
import { deckBlobs, deleteBlobs } from './blob-deletions';
import { toDeckSync } from './deck-sync';
import { deleteAttachments } from './attachments';
import { findFolder } from './folders';
import { attachmentsOn } from './purge-attachments';
import { isOpenComment } from './open-comments';
import { assertDeckSlot, assertStorageFor } from './plans';
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
  const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))];
  const masterIds = [
    ...new Set(rows.flatMap((row) => (row.masterId && !row.isTemplate ? [row.masterId] : []))),
  ];

  const places = options.access
    ? await deckPlaceWords(db, options.access.userId, rows)
    : new Map<string, DeckPlace>();
  const [
    owners,
    revisionNumbers,
    slideCounts,
    thumbnails,
    openCounts,
    authors,
    pendingRevisions,
    ais,
    activeKeys,
    policy,
    masterColors,
  ] = await Promise.all([
    db.select().from(users).where(inArray(users.id, ownerIds)),
    revisionIds.length
      ? db
          .select({
            id: revisions.id,
            number: revisions.number,
            summary: revisions.summary,
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
    db
      .select({
        id: workspaces.id,
        name: workspaces.aiName,
        // A key from before workspaces had several stays on the workspace until first used.
        oldKey: sql<boolean>`${workspaces.aiApiKey} is not null and ${workspaces.aiKeyError} is null`,
      })
      .from(workspaces)
      .where(inArray(workspaces.id, workspaceIds)),
    db
      .select({ workspaceId: integrationKeys.workspaceId, error: integrationKeys.error })
      .from(integrationKeys)
      .where(
        and(
          eq(integrationKeys.kind, 'ai'),
          eq(integrationKeys.active, true),
          or(
            inArray(integrationKeys.workspaceId, workspaceIds),
            isNull(integrationKeys.workspaceId),
          ),
        ),
      ),
    readPolicy({ db }),
    masterIds.length
      ? db
          .select({
            id: workspaceMasters.id,
            colors: workspaceMasters.colors,
            // Designed in Slider: its layout grid, from the template deck it is designed in.
            design: decks.templateDesign,
          })
          .from(workspaceMasters)
          .leftJoin(decks, eq(decks.id, workspaceMasters.draftDeckId))
          .where(inArray(workspaceMasters.id, masterIds))
      : [],
  ]);

  const ownerById = new Map(owners.map((owner) => [owner.id, ownerAuthor(owner)]));
  const numberByRevision = new Map(revisionNumbers.map((row) => [row.id, row.number]));
  const summaryByRevision = new Map(revisionNumbers.map((row) => [row.id, row.summary]));
  const pendingByDeck = new Map(pendingRevisions.map((row) => [row.deckId, row.since]));
  const slideCountByRevision = new Map(slideCounts.map((row) => [row.revisionId, row.count]));
  const thumbnailByRevision = new Map(thumbnails.map((row) => [row.revisionId, row]));
  const openCountByDeck = new Map(openCounts.map((row) => [row.deckId, row.count]));
  const participantsByDeck = groupParticipants(authors);
  const colorsByMaster = new Map(masterColors.map((row) => [row.id, row.colors]));
  const gridByMaster = new Map(masterColors.map((row) => [row.id, row.design?.grid ?? null]));
  // A template offers the colours being set in it; a deck those of the template it is made from.
  const templateColors = (row: DeckRow): TemplateColor[] | null => {
    const colors = row.isTemplate
      ? row.templateDesign?.colors
      : row.masterId
        ? colorsByMaster.get(row.masterId)
        : undefined;
    return colors?.length ? colors : null;
  };
  // As `effectiveKey`: the workspace's own active key, where it may use one, else the
  // instance's, where it takes that over. Refused, it is no help.
  const instanceKey = activeKeys.find((key) => key.workspaceId === null);
  const ownKeys = new Map(activeKeys.map((key) => [key.workspaceId, key]));
  const keyWorks = (workspaceId: string) => {
    const rule = ruleFor(policy, 'ai', workspaceId);
    const key =
      (rule.ownKeys && ownKeys.get(workspaceId)) ||
      (rule.inherit !== 'none' ? instanceKey : undefined);
    return Boolean(key && !key.error);
  };
  const aiByWorkspace = new Map(
    ais.map((ai) => [
      ai.id,
      { name: aiNameOf(ai.name), available: Boolean(ai.oldKey) || keyWorks(ai.id) },
    ]),
  );

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
      deletedAt: row.deletedAt?.toISOString() ?? null,
      revisionNumber: numberByRevision.get(revisionId) ?? 0,
      slideCount: slideCountByRevision.get(revisionId) ?? 0,
      openCommentCount: openCountByDeck.get(row.id) ?? 0,
      thumbnailUrl: thumbnail ? fileUrl(thumbnail.key) : null,
      thumbnailRenderer: thumbnail?.renderer ?? null,
      participants: participantsOf(owner, participantsByDeck.get(row.id) ?? []),
      ai: aiByWorkspace.get(row.workspaceId) ?? { name: DEFAULT_AI_NAME, available: false },
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
      cloudNodeId: row.cloudNodeId,
      place: places.get(row.id) ?? null,
      template: row.isTemplate ? (row.templateDesign ?? EMPTY_TEMPLATE) : null,
      colors: { template: templateColors(row), custom: row.customColors },
      grid: !row.isTemplate && row.masterId ? (gridByMaster.get(row.masterId) ?? null) : null,
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
    .where(
      and(
        inArray(decks.workspaceId, [...workspaceIds]),
        // Templates being designed are no projects – the library leads to them.
        eq(decks.isTemplate, false),
        openToViewer(access),
      ),
    )
    .orderBy(desc(decks.updatedAt));
  return toDeckDtos(db, rows, { access });
}

/**
 * „Löschen“: into the trash – out of every list and unreachable, yet whole, until someone
 * restores it or the trash clears it (`sweepDeckTrash`, `DECK_TRASH_DAYS`). One trash for both
 * apps: its file in Cloud lies in „Gelöscht“ with it (and deleting that file brings the
 * presentation here – `cloud/nodes.ts` `trashNodes`).
 */
export async function trashDeck(
  deps: Pick<AppDeps, 'db' | 'clock'>,
  deckId: string,
  userId: string,
) {
  const now = deps.clock.now();
  const [deck] = await deps.db
    .update(decks)
    .set({ deletedAt: now, deletedBy: userId })
    .where(eq(decks.id, deckId))
    .returning({ nodeId: decks.cloudNodeId });
  if (!deck?.nodeId) return;
  await deps.db
    .update(cloudNodes)
    .set({ deletedAt: now, deletedBy: userId, deletedRootId: deck.nodeId })
    .where(and(eq(cloudNodes.id, deck.nodeId), isNull(cloudNodes.deletedAt)));
}

/**
 * Back from the trash, where and as it was – its file in Cloud with it: where it lay, or at the
 * top of its place when the folder it lay in is gone or deleted.
 */
export async function restoreDeck({ db }: Pick<AppDeps, 'db'>, deckId: string) {
  const [deck] = await db
    .update(decks)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(decks.id, deckId))
    .returning({ nodeId: decks.cloudNodeId });
  if (!deck?.nodeId) return;
  const [node] = await db.select().from(cloudNodes).where(eq(cloudNodes.id, deck.nodeId));
  if (!node?.deletedAt) return;
  const [parent] = node.parentId
    ? await db
        .select({ deletedAt: cloudNodes.deletedAt, deletedRootId: cloudNodes.deletedRootId })
        .from(cloudNodes)
        .where(eq(cloudNodes.id, node.parentId))
    : [];
  await db
    .update(cloudNodes)
    .set({
      deletedAt: null,
      deletedBy: null,
      deletedRootId: null,
      parentId: parent && !parent.deletedAt ? node.parentId : null,
    })
    .where(eq(cloudNodes.id, node.id));
}

/**
 * The trash of these workspaces, last deleted first: what the caller may bring back – their own
 * presentations, and as an admin the workspace's.
 */
export async function listTrashedDecks(
  { db }: Pick<AppDeps, 'db'>,
  workspaceIds: readonly string[],
  access: DeckViewerAccess,
): Promise<Deck[]> {
  if (workspaceIds.length === 0) return [];
  const rows = await db
    .select()
    .from(decks)
    .where(
      and(
        inArray(decks.workspaceId, [...workspaceIds]),
        eq(decks.isTemplate, false),
        isNotNull(decks.deletedAt),
      ),
    )
    .orderBy(desc(decks.deletedAt));
  const dtos = await toDeckDtos(db, rows, { access });
  return dtos.filter((deck) => deck.permissions.canManage);
}

/** Clears the trash of what lay in it longer than `DECK_TRASH_DAYS` (hourly, `enforceRetention`). */
export async function sweepDeckTrash(deps: AppDeps): Promise<void> {
  const before = new Date(deps.clock.now().getTime() - DECK_TRASH_DAYS * 86_400_000);
  const old = await deps.db.select({ id: decks.id }).from(decks).where(lt(decks.deletedAt, before));
  for (const { id } of old) await deleteDeck(deps, id, lt(decks.deletedAt, before));
}

/** Records activity on a deck so the overview sorts it to the top. */
export async function touchDeck(db: Executor, deckId: string, now: Date): Promise<void> {
  await db.update(decks).set({ updatedAt: now }).where(eq(decks.id, deckId));
}

/**
 * Renames, archives (or brings back), moves into a folder of its workspace (`null`: out of any)
 * or sets its own colours – the caller checked the right to manage it. A template's name in the
 * library follows with `scheduleTemplateSave`, the caller's.
 */
export async function updateDeck(
  deps: Pick<AppDeps, 'db' | 'clock'>,
  deck: DeckRow,
  input: UpdateDeckInput,
): Promise<DeckRow> {
  // Only into a folder of the deck's own workspace.
  if (input.folderId) await findFolder(deps.db, deck.workspaceId, input.folderId);
  const now = deps.clock.now();
  const [updated] = await deps.db
    .update(decks)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.archived !== undefined
        ? { archivedAt: input.archived ? (deck.archivedAt ?? now) : null }
        : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
      ...(input.customColors !== undefined ? { customColors: input.customColors } : {}),
      updatedAt: now,
    })
    .where(eq(decks.id, deck.id))
    .returning();
  if (!updated) throw new Error(`Deck ${deck.id} vanished during update`);
  return updated;
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
  /** The Nextcloud connection that could read the file (`decks.nextcloud_connection_id`). */
  nextcloudConnectionId?: string | null;
  /** The workspace's design it was made from (`decks.master_id`). */
  masterId?: string | null;
  /** A template to design (`decks.is_template`), no review: no deck slot, its own title. */
  template?: { title: string; design?: DeckTemplate };
  /** Read and drawn already (a blank deck, `BlankDecks`): ready at once, no import. */
  ready?: ReadyImport;
}

/** A template just started: nothing named, marked or saved yet. */
export const EMPTY_TEMPLATE: DeckTemplate = {
  layoutNames: {},
  placeholders: {},
  guides: [],
  masterId: null,
  savedAt: null,
};

/**
 * Stores the original, creates deck + revision 1 and queues the import – or, with `file.ready`,
 * puts its slides in right away and the deck is ready. Returns at once.
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
  const pptxKey = blobKeys.pptx(deckId, revisionId, deckFileExtension(file.bytes));
  const now = deps.clock.now();

  await deps.storage.put(pptxKey, file.bytes);
  const { ready } = file;
  const pictures = ready
    ? await storeReadyPictures(deps.storage, deckId, revisionId, ready).catch(async (error) => {
        await deps.storage.deletePrefix(blobKeys.deckPrefix(deckId));
        throw error;
      })
    : null;
  const row = await deps.db
    .transaction(async (tx) => {
      // The plan's deck and storage limits (BER-130, BER-151), checked under a lock on the
      // workspace – the reservation below is part of the same transaction.
      if (file.template) {
        await assertStorageFor(tx, deps.config, workspaceId, file.bytes.byteLength, now);
      } else {
        await assertDeckSlot(tx, deps.config, workspaceId, {
          addBytes: file.bytes.byteLength,
          now,
        });
      }
      await tx.insert(decks).values({
        id: deckId,
        ownerId,
        linkedById: ownerId,
        workspaceId,
        title: file.template?.title ?? titleFromFileName(file.fileName),
        fileName: file.fileName,
        source: file.source,
        sourceUrl: file.sourceUrl ?? null,
        sourceRef: file.sourceRef ?? null,
        sourceContributors: file.contributors ?? null,
        nextcloudConnectionId: file.nextcloudConnectionId ?? null,
        masterId: file.masterId ?? null,
        isTemplate: file.template !== undefined,
        templateDesign: file.template ? (file.template.design ?? EMPTY_TEMPLATE) : null,
        createdAt: now,
        updatedAt: now,
        importState: ready ? { status: 'ready' } : { status: 'queued' },
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
      if (ready && pictures) await insertReadySlides(tx, deckId, revisionId, ready, pictures);
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

  // Nothing to import: measured now, which ends the reservation as an import's end would.
  if (ready) await remeasureDeck(deps, deckId);
  else deps.queue.enqueue({ deckId, revisionId });
  return toDeckDto(deps.db, row, {
    access: { kind: 'user', userId: ownerId, roles: await rolesOf(deps.db, ownerId) },
  });
}

/** Deletes the deck with everything in it, files included (BER-121). */
/** Deletes the deck and its files – with `condition`, only if that holds; `false` if not. */
export async function deleteDeck(deps: AppDeps, deckId: string, condition?: SQL): Promise<boolean> {
  // The files on its AI chats, gathered while the rows still point at them (a deck without a
  // file in Cloud too; its file's own go with `purgeRow`).
  const attached = await attachmentsOn(deps.db, { deckIds: [deckId] });
  const gone = await deps.db
    .delete(decks)
    .where(and(eq(decks.id, deckId), condition))
    .returning({ id: decks.id, nodeId: decks.cloudNodeId });
  if (condition && gone.length === 0) return false;
  // Its file in Cloud is the presentation's own: gone with it.
  const nodeId = gone[0]?.nodeId;
  if (nodeId) {
    const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
    if (node) await purgeRow(deps, node);
  }
  await deleteBlobs(deps, deckBlobs(blobKeys.deckPrefix(deckId)));
  await deleteAttachments(deps, attached);
  return true;
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const title = base.replace(/\.[^.]+$/, '').trim();
  return title || base || 'Unbenannte Präsentation';
}
