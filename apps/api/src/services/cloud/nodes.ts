import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import {
  CLOUD_TRASH_DAYS,
  cloudAccessAtLeast,
  cloudExtension,
  cloudFileType,
  cloudFreeName,
  cloudNameKey,
  strongerCloudAccess,
  type CloudAccess,
  type CloudBatchResult,
  type CloudListing,
  type CloudLocation,
  type CloudAreaColor,
  type CloudNode,
  type CloudSearchQuery,
  type CloudSearchResult,
  type CloudPin,
  type CloudScope,
} from '@slider/shared';
import type { Executor } from '../../db/client';
import { deleteAttachments } from '../attachments';
import { attachmentsOn } from '../purge-attachments';
import {
  cloudAgentFiles,
  cloudAgents,
  cloudNodes,
  cloudRecents,
  cloudShares,
  cloudPins,
  cloudVersions,
  decks,
  type CloudNodeRow,
} from '../../db/schema';
import { blobKeys } from '../../storage/blob-storage';
import { ApiError, badRequest, forbidden } from '../../http/errors';
import { deckBlobs, deleteBlobs } from '../blob-deletions';
import { runs, runsOf } from '../cloud-agent-runs';
import { DAY_MS } from '../retention-rules';
import { deckPermissions } from '../workspaces/roles';
import { toAreaDtos } from './areas';
import { fileBlobs } from './blobs';
import {
  accessOf,
  ancestorsOf,
  authorIn,
  authorsOf,
  baseAccess,
  cloudContext,
  loadNode,
  sharedAccess,
  type CloudCtx,
  type CloudDeps,
  looksOnly,
} from './context';
import { recordEvent } from './events';
import { healThumbnails, searchText } from './pictures';
import {
  assertDepth,
  descendantsOf,
  findByName,
  folderStats,
  live,
  nameKeys,
  nameTaken,
  placeOf,
  resolveTarget,
  siblingsIn,
  targetName,
  type Place,
} from './tree';

/**
 * Files and folders: listing them, and everything done to them short of their bytes – a new
 * folder, a new name, another place, the trash and the way back out of it.
 */

/** How many files „Zuletzt“ lists. */
const RECENT_LIMIT = 60;

// ── What a file looks like to the browser ───────────────────────────────────

interface DtoOptions {
  /** The caller's right on each row. */
  access: (row: CloudNodeRow) => CloudAccess;
  /** Where each lies – for lists across folders. */
  location?: boolean;
  /** The rows are in „Gelöscht“: folders count what was deleted with them. */
  trashed?: boolean;
}

/** How many files a folder's card shows peeking out. */
const PEEK = 3;

/** The newest files lying directly in each folder, `PEEK` at most. */
async function peekInto(
  db: CloudDeps['db'],
  folderIds: readonly string[],
): Promise<Map<string, CloudNodeRow[]>> {
  const found = new Map<string, CloudNodeRow[]>();
  for (let at = 0; at < folderIds.length; at += 500) {
    const rows = await db
      .select()
      .from(cloudNodes)
      .where(
        and(
          inArray(cloudNodes.parentId, folderIds.slice(at, at + 500)),
          eq(cloudNodes.kind, 'file'),
          live,
        ),
      )
      .orderBy(desc(cloudNodes.updatedAt));
    for (const row of rows) {
      const list = found.get(row.parentId ?? '') ?? [];
      if (list.length < PEEK) found.set(row.parentId ?? '', [...list, row]);
    }
  }
  return found;
}

export async function toNodeDtos(
  deps: Pick<CloudDeps, 'db' | 'clock'>,
  ctx: CloudCtx,
  rows: readonly CloudNodeRow[],
  options: DtoOptions,
): Promise<CloudNode[]> {
  if (rows.length === 0) return [];
  const { db } = deps;
  const now = deps.clock.now();
  const ids = rows.map((row) => row.id);
  const folderIds = rows.filter((row) => row.kind === 'folder').map((row) => row.id);
  const [authors, pinned, shares, stats, agents] = await Promise.all([
    authorsOf(
      db,
      rows.flatMap((row) => [row.ownerId, row.updatedBy, row.deletedBy]),
    ),
    pinnedOf(db, ctx.userId, ids),
    sharesOf(db, ids, now),
    folderStats(db, folderIds, { deleted: options.trashed }),
    agentsAt(db, ctx.userId, ids),
  ]);
  const locations = options.location ? await locationsOf(db, ctx, rows) : null;
  const peeks = options.trashed ? new Map<string, CloudNodeRow[]>() : await peekInto(db, folderIds);
  return rows.map((row) => {
    const folder = stats.get(row.id);
    const shared = shares.get(row.id);
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      areaId: row.areaId,
      parentId: row.parentId,
      kind: row.kind,
      name: row.name,
      fileType: row.kind === 'file' ? cloudFileType(row.name, row.mimeType) : null,
      mimeType: row.mimeType,
      sizeBytes: folder ? folder.bytes : row.sizeBytes,
      fileCount: folder ? folder.files : null,
      color: row.color,
      ...(folder && !options.trashed
        ? {
            peek: (peeks.get(row.id) ?? []).map((file) => ({
              id: file.id,
              versionId: file.currentVersionId,
              fileType: cloudFileType(file.name, file.mimeType),
              thumbnail: file.thumbnail === 'ready',
            })),
          }
        : {}),
      versionId: row.currentVersionId,
      versionCount: row.versionCount,
      thumbnail: row.thumbnail === 'ready',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: authorIn(authors, row.updatedBy ?? row.ownerId),
      owner: authorIn(authors, row.ownerId),
      pinned: pinned.has(row.id),
      shared: { people: shared?.people ?? 0, link: shared?.link ?? false },
      ...(agents.has(row.id) ? { agents: agents.get(row.id) } : {}),
      deleted: row.deletedAt
        ? {
            at: row.deletedAt.toISOString(),
            by: authorIn(authors, row.deletedBy),
            daysLeft: Math.max(
              0,
              CLOUD_TRASH_DAYS - Math.floor((now.getTime() - row.deletedAt.getTime()) / DAY_MS),
            ),
          }
        : null,
      access: options.access(row),
      ...(locations ? { location: locations.get(row.id) } : {}),
    };
  });
}

async function pinnedOf(db: Executor, userId: string, ids: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ nodeId: cloudPins.nodeId })
    .from(cloudPins)
    .where(and(eq(cloudPins.userId, userId), inArray(cloudPins.nodeId, ids)));
  return new Set(rows.map((row) => row.nodeId));
}

/** An agent at work on a file. */
type AgentAt = { id: string; title: string };

/**
 * The agents at work right now on these files and folders: each runs and has made, changed,
 * moved, renamed or deleted it – or changed the presentation whose file it is – since that work
 * began. The caller's own and those shared. Shown only while the agent works, as a person is
 * only while they are there; what it did is listed on its desk.
 */
async function agentsAt(
  db: Executor,
  userId: string,
  ids: string[],
): Promise<Map<string, AgentAt[]>> {
  if (runs.size === 0) return new Map();
  const working = [...new Set([...runs.values()].map((run) => run.agentId))];
  const seen = and(
    inArray(cloudAgents.id, working),
    ne(cloudAgentFiles.status, 'discarded'),
    or(eq(cloudAgents.shared, true), eq(cloudAgents.userId, userId)),
  );
  const columns = { id: cloudAgents.id, title: cloudAgents.title, at: cloudAgentFiles.updatedAt };
  const [files, presentations] = await Promise.all([
    db
      .select({ nodeId: cloudAgentFiles.nodeId, ...columns })
      .from(cloudAgentFiles)
      .innerJoin(cloudAgents, eq(cloudAgents.id, cloudAgentFiles.agentId))
      .where(and(inArray(cloudAgentFiles.nodeId, ids), seen)),
    db
      .select({ nodeId: decks.cloudNodeId, ...columns })
      .from(cloudAgentFiles)
      .innerJoin(cloudAgents, eq(cloudAgents.id, cloudAgentFiles.agentId))
      // The presentation itself – or, from before, the one a work copy was made of.
      .innerJoin(
        decks,
        or(
          eq(decks.id, cloudAgentFiles.originalDeckId),
          and(isNull(cloudAgentFiles.originalDeckId), eq(decks.id, cloudAgentFiles.deckId)),
        ),
      )
      .where(and(inArray(decks.cloudNodeId, ids), seen)),
  ]);
  const found = new Map<string, AgentAt[]>();
  for (const row of [...files, ...presentations]) {
    if (!row.nodeId) continue;
    // Since its work began: what it touched in an earlier piece of work it is not at now.
    const since = Math.min(...runsOf(row.id).map((run) => run.since.getTime()));
    if (row.at.getTime() < since) continue;
    const list = found.get(row.nodeId) ?? [];
    if (!list.some((each) => each.id === row.id)) list.push({ id: row.id, title: row.title });
    found.set(row.nodeId, list);
  }
  return found;
}

/** The folders a person pinned to the side bar, in the order pinned – those they still see. */
export async function listPins(deps: CloudDeps, ctx: CloudCtx): Promise<CloudPin[]> {
  const rows = await deps.db
    .select({ node: cloudNodes })
    .from(cloudPins)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudPins.nodeId))
    .where(and(eq(cloudPins.userId, ctx.userId), eq(cloudNodes.workspaceId, ctx.workspaceId), live))
    .orderBy(asc(cloudPins.createdAt));
  const nodes = rows.map((row) => row.node);
  const seen = await withAccess(deps, ctx, nodes);
  const visible = new Set(seen.rows.map((row) => row.id));
  return nodes
    .filter((node) => visible.has(node.id))
    .map((node) => {
      // Without a colour of its own a folder takes its area's – not the workspace's own area's.
      const area = node.areaId ? ctx.areas.get(node.areaId)?.row : undefined;
      const color = node.color ?? (area && !area.root ? area.color : null);
      return { id: node.id, name: node.name, color: color as CloudPin['color'] };
    });
}

async function sharesOf(db: Executor, ids: string[], now: Date) {
  const rows = await db
    .select({
      nodeId: cloudShares.nodeId,
      kind: cloudShares.kind,
      expiresAt: cloudShares.expiresAt,
    })
    .from(cloudShares)
    .where(inArray(cloudShares.nodeId, ids));
  const result = new Map<string, { people: number; link: boolean }>();
  for (const row of rows) {
    if (row.expiresAt && row.expiresAt <= now) continue;
    const entry = result.get(row.nodeId) ?? { people: 0, link: false };
    if (row.kind === 'link') entry.link = true;
    else entry.people += 1;
    result.set(row.nodeId, entry);
  }
  return result;
}

/** Area and folders of each row. Rows the caller only reaches through a share say nothing. */
async function locationsOf(
  db: Executor,
  ctx: CloudCtx,
  rows: readonly CloudNodeRow[],
): Promise<Map<string, CloudLocation>> {
  const chains = new Map<string | null, { id: string; name: string }[]>([[null, []]]);
  const result = new Map<string, CloudLocation>();
  for (const row of rows) {
    const area = row.areaId ? ctx.areas.get(row.areaId) : undefined;
    if (!baseAccess(ctx, row)) {
      result.set(row.id, { areaId: null, areaName: null, areaColor: null, folders: [] });
      continue;
    }
    let folders = chains.get(row.parentId);
    if (!folders) {
      const chain = await ancestorsOf(db, row);
      folders = chain.reverse().map((each) => ({ id: each.id, name: each.name }));
      chains.set(row.parentId, folders);
    }
    result.set(row.id, {
      areaId: row.areaId,
      areaName: area?.row.name ?? null,
      areaColor: area?.row.color ?? null,
      folders,
    });
  }
  return result;
}

/** One row as the browser sees it, the caller's right worked out. */
export async function nodeDto(
  deps: Pick<CloudDeps, 'db' | 'clock'>,
  ctx: CloudCtx,
  row: CloudNodeRow,
  access?: CloudAccess,
): Promise<CloudNode> {
  const right = access ?? (await accessOf(deps.db, ctx, row, deps.clock.now())).access ?? 'view';
  const [dto] = await toNodeDtos(deps, ctx, [row], {
    access: () => right,
    trashed: Boolean(row.deletedAt),
  });
  if (!dto) throw new Error('A node has no DTO');
  return dto;
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
/** Folders first, then by name as people read them („Datei 2“ before „Datei 10“). */
const byName = (a: CloudNodeRow, b: CloudNodeRow) =>
  a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1;

// ── Lists ───────────────────────────────────────────────────────────────────

export async function listNodes(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
  query: { scope: CloudScope; folder?: string; area?: string },
): Promise<CloudListing> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  if (query.scope === 'folder') return listFolder(deps, ctx, query);
  const across = {
    scope: query.scope,
    area: null,
    folder: null,
    path: [],
    sharedBy: null,
    access: 'view' as CloudAccess,
  };
  if (query.scope === 'trash') return { ...across, nodes: await listTrash(deps, ctx) };
  if (query.scope === 'recent') return { ...across, nodes: await listRecent(deps, ctx) };
  if (query.scope === 'all') return { ...across, nodes: await listAll(deps, ctx) };
  if (query.scope === 'shared') return { ...across, nodes: await listSharedWithMe(deps, ctx) };
  return { ...across, nodes: await listSharedByMe(deps, ctx) };
}

async function listFolder(
  deps: CloudDeps,
  ctx: CloudCtx,
  query: { folder?: string; area?: string },
): Promise<CloudListing> {
  const target = await resolveTarget(deps, ctx, { parentId: query.folder, areaId: query.area });
  const rows = (await siblingsIn(deps.db, target.place)).sort(byName);
  healThumbnails(deps, rows);
  // A share on a single thing in here can only add to the folder's right.
  const own =
    target.access === 'manage'
      ? new Map<string, CloudAccess>()
      : await sharedAccess(
          deps.db,
          ctx,
          rows.map((row) => row.id),
          deps.clock.now(),
        );
  const nodes = await toNodeDtos(deps, ctx, rows, {
    access: (row) => strongerCloudAccess(target.access, own.get(row.id) ?? null) ?? target.access,
  });
  // Above the shared folder nothing is the caller's to see – the path starts there.
  const line = target.folder ? [...target.chain].reverse().concat(target.folder) : [];
  const from = target.sharedRoot ? line.findIndex((each) => each.id === target.sharedRoot?.id) : 0;
  const path = line.slice(Math.max(0, from)).map((each) => ({ id: each.id, name: each.name }));
  const [area] = target.area ? await toAreaDtos(deps, ctx, [target.area.row]) : [];
  const sharedBy = target.sharedRoot
    ? authorIn(await authorsOf(deps.db, [target.sharedRoot.ownerId]), target.sharedRoot.ownerId)
    : null;
  if (target.folder) await touchRecent(deps.db, ctx.userId, target.folder.id, deps.clock.now());
  return {
    scope: 'folder',
    area: target.sharedRoot ? null : (area ?? null),
    folder: target.folder ? await nodeDto(deps, ctx, target.folder, target.access) : null,
    path,
    sharedBy,
    nodes,
    access: target.access,
  };
}

/** The rows the caller may see, each with their right; the others dropped. */
async function withAccess(
  deps: CloudDeps,
  ctx: CloudCtx,
  rows: readonly CloudNodeRow[],
): Promise<{ rows: CloudNodeRow[]; access: Map<string, CloudAccess> }> {
  const access = new Map<string, CloudAccess>();
  const kept: CloudNodeRow[] = [];
  const now = deps.clock.now();
  for (const row of rows) {
    const base = baseAccess(ctx, row);
    const right = base === 'manage' ? base : (await accessOf(deps.db, ctx, row, now)).access;
    if (!right) continue;
    access.set(row.id, right);
    kept.push(row);
  }
  return { rows: kept, access };
}

/** Conditions for the living files in the areas open to the caller and in their own files. */
export function reachable(ctx: CloudCtx) {
  const open = [...ctx.areas.values()].filter((area) => area.access).map((area) => area.row.id);
  // Who only looks has no files of their own.
  const own = looksOnly(ctx.role)
    ? sql`false`
    : and(isNull(cloudNodes.areaId), eq(cloudNodes.ownerId, ctx.userId));
  return and(
    eq(cloudNodes.workspaceId, ctx.workspaceId),
    live,
    open.length ? or(inArray(cloudNodes.areaId, open), own) : own,
  );
}

/**
 * „Zuletzt“: what the caller opened, and what changed where they work – the newest of both
 * first. Files only; folders are places, not work.
 */
async function listRecent(deps: CloudDeps, ctx: CloudCtx): Promise<CloudNode[]> {
  const [opened, changed] = await Promise.all([
    deps.db
      .select({ node: cloudNodes, at: cloudRecents.at })
      .from(cloudRecents)
      .innerJoin(cloudNodes, eq(cloudNodes.id, cloudRecents.nodeId))
      .where(
        and(
          eq(cloudRecents.userId, ctx.userId),
          eq(cloudNodes.workspaceId, ctx.workspaceId),
          eq(cloudNodes.kind, 'file'),
          live,
        ),
      )
      .orderBy(desc(cloudRecents.at))
      .limit(RECENT_LIMIT),
    deps.db
      .select()
      .from(cloudNodes)
      .where(and(reachable(ctx), eq(cloudNodes.kind, 'file')))
      .orderBy(desc(cloudNodes.updatedAt))
      .limit(RECENT_LIMIT),
  ]);
  const at = new Map<string, number>();
  const rows = new Map<string, CloudNodeRow>();
  for (const row of changed) {
    rows.set(row.id, row);
    at.set(row.id, row.updatedAt.getTime());
  }
  for (const { node, at: openedAt } of opened) {
    rows.set(node.id, node);
    at.set(node.id, Math.max(at.get(node.id) ?? 0, openedAt.getTime()));
  }
  const sorted = [...rows.values()]
    .sort((a, b) => (at.get(b.id) ?? 0) - (at.get(a.id) ?? 0))
    .slice(0, RECENT_LIMIT);
  const seen = await withAccess(deps, ctx, sorted);
  healThumbnails(deps, seen.rows);
  const nodes = await toNodeDtos(deps, ctx, seen.rows, {
    access: (row) => seen.access.get(row.id) ?? 'view',
    location: true,
  });
  return nodes.map((node) => ({
    ...node,
    recentAt: new Date(at.get(node.id) ?? Date.parse(node.updatedAt)).toISOString(),
  }));
}

/**
 * „Alles“: the top of everything the caller reaches in one list – their own files, the areas
 * open to them, and what others shared with them. Folders first, by name.
 */
async function listAll(deps: CloudDeps, ctx: CloudCtx): Promise<CloudNode[]> {
  const tops = await deps.db
    .select()
    .from(cloudNodes)
    .where(and(reachable(ctx), isNull(cloudNodes.parentId)));
  const own = await toNodeDtos(deps, ctx, tops, {
    access: (row) => baseAccess(ctx, row) ?? 'view',
    location: true,
  });
  const have = new Set(own.map((node) => node.id));
  // Looked at among everything else: still new under „Geteilt“.
  const shared = (await listSharedWithMe(deps, ctx, false)).filter((node) => !have.has(node.id));
  return [...own, ...shared].sort((a, b) =>
    a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1,
  );
}

/** What others shared with the caller; listing it marks it as seen (`seen`). */
async function listSharedWithMe(deps: CloudDeps, ctx: CloudCtx, seen = true): Promise<CloudNode[]> {
  const now = deps.clock.now();
  const rows = await deps.db
    .select({ node: cloudNodes, share: cloudShares })
    .from(cloudShares)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudShares.nodeId))
    .where(
      and(
        eq(cloudShares.kind, 'user'),
        eq(cloudShares.userId, ctx.userId),
        eq(cloudShares.workspaceId, ctx.workspaceId),
        live,
      ),
    )
    .orderBy(desc(cloudShares.createdAt));
  const valid = rows.filter((row) => !row.share.expiresAt || row.share.expiresAt > now);
  const unseen = valid.filter((row) => !row.share.seenAt).map((row) => row.share.id);
  if (seen && unseen.length) {
    await deps.db.update(cloudShares).set({ seenAt: now }).where(inArray(cloudShares.id, unseen));
  }
  const access = new Map<string, CloudAccess>();
  const nodes = new Map<string, CloudNodeRow>();
  for (const row of valid) {
    nodes.set(row.node.id, row.node);
    access.set(
      row.node.id,
      strongerCloudAccess(access.get(row.node.id) ?? null, row.share.role) ?? 'view',
    );
  }
  return toNodeDtos(deps, ctx, [...nodes.values()], {
    access: (row) => access.get(row.id) ?? 'view',
    location: true,
  });
}

/** What the caller shared: with people or by link. */
async function listSharedByMe(deps: CloudDeps, ctx: CloudCtx): Promise<CloudNode[]> {
  const rows = await deps.db
    .select({ node: cloudNodes })
    .from(cloudShares)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudShares.nodeId))
    .where(
      and(
        eq(cloudShares.createdBy, ctx.userId),
        eq(cloudShares.workspaceId, ctx.workspaceId),
        live,
      ),
    )
    .orderBy(desc(cloudShares.createdAt));
  const unique = [...new Map(rows.map((row) => [row.node.id, row.node])).values()];
  const seen = await withAccess(deps, ctx, unique);
  return toNodeDtos(deps, ctx, seen.rows, {
    access: (row) => seen.access.get(row.id) ?? 'view',
    location: true,
  });
}

/** What the caller may do in „Gelöscht“ with each row they see there, by id: it is theirs to change. */
async function trashRights(
  db: Executor,
  ctx: CloudCtx,
  rows: readonly CloudNodeRow[],
  now: Date,
): Promise<Map<string, CloudAccess>> {
  const rights = new Map<string, CloudAccess>();
  for (const row of rows) {
    const base = baseAccess(ctx, row);
    if (base && cloudAccessAtLeast(base, 'edit')) {
      rights.set(row.id, base);
      continue;
    }
    // Deleted from someone else's files through a share: whoever deleted it gets it back – while
    // a share still lets them change it, not once it was taken back.
    if (row.deletedBy !== ctx.userId) continue;
    const { access } = await accessOf(db, ctx, row, now);
    if (cloudAccessAtLeast(access, 'edit')) rights.set(row.id, 'edit');
  }
  return rights;
}

/** „Gelöscht“: what was deleted (not what went along inside it), newest first. */
async function listTrash(deps: CloudDeps, ctx: CloudCtx): Promise<CloudNode[]> {
  const rows = await deps.db
    .select()
    .from(cloudNodes)
    .where(
      and(
        eq(cloudNodes.workspaceId, ctx.workspaceId),
        isNotNull(cloudNodes.deletedAt),
        eq(cloudNodes.deletedRootId, cloudNodes.id),
      ),
    )
    .orderBy(desc(cloudNodes.deletedAt));
  const rights = await trashRights(deps.db, ctx, rows, deps.clock.now());
  const mine = rows.filter((row) => rights.has(row.id));
  return toNodeDtos(deps, ctx, mine, {
    access: (row) => rights.get(row.id) ?? 'view',
    location: true,
    trashed: true,
  });
}

/** How much lies in „Gelöscht“ for the caller – the number beside it in the side bar. */
export async function trashCount(db: Executor, ctx: CloudCtx, now: Date): Promise<number> {
  const rows = await db
    .select()
    .from(cloudNodes)
    .where(
      and(
        eq(cloudNodes.workspaceId, ctx.workspaceId),
        isNotNull(cloudNodes.deletedAt),
        eq(cloudNodes.deletedRootId, cloudNodes.id),
      ),
    );
  return (await trashRights(db, ctx, rows, now)).size;
}

// ── Opened last, pins ───────────────────────────────────────────────────────

export async function touchRecent(
  db: Executor,
  userId: string,
  nodeId: string,
  now: Date,
): Promise<void> {
  await db
    .insert(cloudRecents)
    .values({ userId, nodeId, at: now })
    .onConflictDoUpdate({ target: [cloudRecents.userId, cloudRecents.nodeId], set: { at: now } });
}

/** „Anpinnen“ / „Lösen“: a folder in the side bar, each person's own. */
export async function setPin(
  deps: CloudDeps,
  userId: string,
  nodeId: string,
  pinned: boolean,
): Promise<CloudNode> {
  const { node, ctx, access } = await loadNode(deps, userId, nodeId);
  if (node.kind !== 'folder') throw badRequest('Anpinnen lassen sich nur Ordner.');
  if (pinned) {
    await deps.db
      .insert(cloudPins)
      .values({ userId, nodeId, createdAt: deps.clock.now() })
      .onConflictDoNothing();
  } else {
    await deps.db
      .delete(cloudPins)
      .where(and(eq(cloudPins.userId, userId), eq(cloudPins.nodeId, nodeId)));
  }
  return nodeDto(deps, ctx, node, access);
}

// ── Folders, names ──────────────────────────────────────────────────────────

export async function createFolder(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
  input: { name: string; numbered?: boolean; parentId?: string | null; areaId?: string | null },
): Promise<CloudNode> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const target = await resolveTarget(deps, ctx, input, 'edit');
  assertDepth(target);
  const siblings = await siblingsIn(deps.db, target.place);
  if (!input.numbered && findByName(siblings, input.name)) throw nameTaken(input.name);
  const name = cloudFreeName(input.name, nameKeys(siblings));
  const row = await insertFolder(deps.db, target.place, name, userId, deps.clock.now());
  await recordEvent(
    deps.db,
    { kind: 'folder_created', actorId: userId, node: row, workspaceId, name: row.name },
    deps.clock.now(),
  );
  return nodeDto(deps, ctx, row, target.access);
}

export async function insertFolder(
  db: Executor,
  place: Place,
  name: string,
  userId: string,
  now: Date,
): Promise<CloudNodeRow> {
  const [row] = await db
    .insert(cloudNodes)
    .values({
      id: crypto.randomUUID(),
      workspaceId: place.workspaceId,
      areaId: place.areaId,
      // In someone's own files it is theirs, whoever made it there.
      ownerId: place.areaId ? userId : place.ownerId,
      parentId: place.parentId,
      kind: 'folder',
      name,
      createdAt: now,
      updatedAt: now,
      updatedBy: userId,
    })
    .returning();
  if (!row) throw new Error('Folder insert returned nothing');
  return row;
}

export async function renameNode(
  deps: CloudDeps,
  userId: string,
  nodeId: string,
  name: string,
): Promise<CloudNode> {
  const { node, ctx, access } = await loadNode(deps, userId, nodeId, 'edit');
  if (name === node.name) return nodeDto(deps, ctx, node, access);
  const siblings = await siblingsIn(deps.db, placeOf(node));
  if (findByName(siblings, name, node.id)) throw nameTaken(name);
  const now = deps.clock.now();
  const [row] = await deps.db
    .update(cloudNodes)
    .set({
      name,
      extension: node.kind === 'file' ? cloudExtension(name) : '',
      updatedAt: now,
      updatedBy: userId,
    })
    .where(eq(cloudNodes.id, node.id))
    .returning();
  if (!row) throw new Error('Rename returned nothing');
  await recordEvent(
    deps.db,
    {
      kind: 'renamed',
      actorId: userId,
      node: row,
      workspaceId: row.workspaceId,
      name: row.name,
      detail: node.name,
      groupKey: null,
    },
    now,
  );
  return nodeDto(deps, ctx, row, access);
}

/** A folder's colour, for everyone who sees it; `null` takes it off. */
export async function setNodeColor(
  deps: CloudDeps,
  userId: string,
  nodeId: string,
  color: CloudAreaColor | null,
): Promise<CloudNode> {
  const { node, ctx, access } = await loadNode(deps, userId, nodeId, 'edit');
  if (node.kind !== 'folder') throw badRequest('Nur Ordner haben eine Farbe.');
  const [row] = await deps.db
    .update(cloudNodes)
    .set({ color })
    .where(eq(cloudNodes.id, node.id))
    .returning();
  if (!row) throw new Error('Colour returned nothing');
  return nodeDto(deps, ctx, row, access);
}

// ── Several at once ─────────────────────────────────────────────────────────

type Skipped = CloudBatchResult['skipped'][number];

/** Runs `each` for every id; what it throws becomes a line in `skipped`. */
async function batch(
  ids: readonly string[],
  each: (id: string) => Promise<CloudNode | null>,
): Promise<CloudBatchResult> {
  const nodes: CloudNode[] = [];
  const skipped: Skipped[] = [];
  for (const id of [...new Set(ids)]) {
    try {
      const node = await each(id);
      if (node) nodes.push(node);
    } catch (error) {
      if (!(error instanceof Error) || !('status' in error)) throw error;
      skipped.push({ id, name: '', reason: error.message });
    }
  }
  return { nodes, skipped };
}

/**
 * A presentation is its file: taking it out of its place – to another area or someone's own
 * files, into „Gelöscht“, gone for good – is for whom Slider lets delete it and say who sees it
 * (its owner and the admins, `DELETE /decks/:id`), not for everyone who may change the area.
 * Throws for `node` when it is such a file, or a folder with one in it (in „Gelöscht“ too).
 * A presentation already in Slider's trash keeps its own place there, to come back from: it
 * holds up a move or a delete no longer – but going for good (`forGood`) takes it along
 * (`purgeRow`), so there it is its owner's still.
 */
async function assertDecksOwn(
  db: Executor,
  ctx: CloudCtx,
  node: CloudNodeRow,
  forGood = false,
): Promise<void> {
  const inside =
    node.kind === 'folder' ? await descendantsOf(db, [node.id], { deleted: true }) : [];
  const ids = [node.id, ...inside.filter((each) => each.kind === 'file').map((each) => each.id)];
  for (let at = 0; at < ids.length; at += 500) {
    const found = await db
      .select({ ownerId: decks.ownerId, isTemplate: decks.isTemplate })
      .from(decks)
      .where(
        and(
          inArray(decks.cloudNodeId, ids.slice(at, at + 500)),
          forGood ? undefined : isNull(decks.deletedAt),
        ),
      );
    if (found.every((deck) => deckPermissions(ctx.role, deck, ctx.userId).canManage)) continue;
    throw forbidden(
      node.kind === 'folder'
        ? `In „${node.name}“ liegt eine Präsentation, die nur die Person, die sie angelegt hat, und Admins verschieben oder löschen.`
        : `„${node.name}“ verschieben oder löschen nur die Person, die die Präsentation angelegt hat, und Admins.`,
    );
  }
}

export async function moveNodes(
  deps: CloudDeps,
  userId: string,
  input: { ids: string[]; parentId?: string | null; areaId?: string | null },
): Promise<CloudBatchResult> {
  let workspaceId: string | null = null;
  return batch(input.ids, async (id) => {
    const { node, ctx } = await loadNode(deps, userId, id, 'edit');
    workspaceId ??= node.workspaceId;
    if (node.workspaceId !== workspaceId) {
      throw badRequest('Verschieben geht nur innerhalb eines Workspace.');
    }
    const target = await resolveTarget(deps, ctx, input, 'edit');
    const here = placeOf(node);
    if (
      here.parentId === target.place.parentId &&
      here.areaId === target.place.areaId &&
      here.ownerId === target.place.ownerId
    ) {
      return nodeDto(deps, ctx, node);
    }
    // Shared with the caller, not theirs: it may be sorted where it lies, not taken out of its
    // owner's files or its area (the owner would lose it, without a trace).
    if (
      !cloudAccessAtLeast(baseAccess(ctx, node), 'edit') &&
      (here.areaId !== target.place.areaId || here.ownerId !== target.place.ownerId)
    ) {
      throw badRequest(`„${node.name}“ ist mit dir geteilt und bleibt, wo es liegt.`);
    }
    // Elsewhere, a presentation is seen by others: its owner's to decide (`followPlace`).
    if (here.areaId !== target.place.areaId || here.ownerId !== target.place.ownerId) {
      await assertDecksOwn(deps.db, ctx, node);
    }
    if (node.kind === 'folder') {
      const line = [target.folder, ...target.chain].map((each) => each?.id);
      if (line.includes(node.id)) {
        throw badRequest(`„${node.name}“ kann nicht in sich selbst verschoben werden.`);
      }
      // With the folders it brings along: else moves would stack them deeper than any walk up
      // the tree looks. They come level by level, a parent before what is in it.
      const level = new Map([[node.id, 0]]);
      let height = 0;
      for (const each of await descendantsOf(deps.db, [node.id], { deleted: true })) {
        // What lies in „Gelöscht“ does not stand in anyone's way.
        if (each.kind !== 'folder' || each.deletedAt) continue;
        const at = (level.get(each.parentId ?? '') ?? 0) + 1;
        level.set(each.id, at);
        height = Math.max(height, at);
      }
      assertDepth(target, 1 + height);
    }
    const siblings = await siblingsIn(deps.db, target.place);
    if (findByName(siblings, node.name)) {
      throw badRequest(`„${node.name}“ gibt es in „${targetName(target)}“ schon.`);
    }
    const now = deps.clock.now();
    const space = {
      areaId: target.place.areaId,
      ...(target.place.areaId ? {} : { ownerId: target.place.ownerId }),
    };
    const [row] = await deps.db
      .update(cloudNodes)
      .set({ ...space, parentId: target.place.parentId, updatedAt: now, updatedBy: userId })
      .where(eq(cloudNodes.id, node.id))
      .returning();
    if (!row) throw new Error('Move returned nothing');
    // Into another area (or out of one): everything in it goes along.
    if (node.kind === 'folder' && (here.areaId !== space.areaId || !space.areaId)) {
      const inside = await descendantsOf(deps.db, [node.id], { deleted: true });
      for (let at = 0; at < inside.length; at += 500) {
        await deps.db
          .update(cloudNodes)
          .set(space)
          .where(
            inArray(
              cloudNodes.id,
              inside.slice(at, at + 500).map((each) => each.id),
            ),
          );
      }
    }
    await recordEvent(
      deps.db,
      {
        kind: 'moved',
        actorId: userId,
        node: row,
        workspaceId: row.workspaceId,
        name: row.name,
        detail: targetName(target),
        groupKey: `moved:${target.place.parentId ?? target.place.areaId ?? 'own'}`,
      },
      now,
    );
    return nodeDto(deps, ctx, row);
  });
}

/** Into „Gelöscht“: it and everything in it, for `CLOUD_TRASH_DAYS`. */
export async function trashNodes(
  deps: CloudDeps,
  userId: string,
  ids: string[],
): Promise<CloudBatchResult> {
  return batch(ids, async (id) => {
    const [exists] = await deps.db
      .select({ deletedAt: cloudNodes.deletedAt })
      .from(cloudNodes)
      .where(eq(cloudNodes.id, id));
    // Went along with its folder a moment ago (both were picked): nothing more to do.
    if (exists?.deletedAt) return null;
    const { node, ctx, access } = await loadNode(deps, userId, id, 'edit');
    await assertDecksOwn(deps.db, ctx, node);
    const now = deps.clock.now();
    const inside = node.kind === 'folder' ? await descendantsOf(deps.db, [node.id]) : [];
    const all = [node.id, ...inside.map((each) => each.id)];
    for (let at = 0; at < all.length; at += 500) {
      await deps.db
        .update(cloudNodes)
        .set({ deletedAt: now, deletedBy: userId, deletedRootId: node.id })
        .where(and(inArray(cloudNodes.id, all.slice(at, at + 500)), live));
      // One trash for both apps: the presentations whose files these are lie in Slider's too.
      await deps.db
        .update(decks)
        .set({ deletedAt: now, deletedBy: userId })
        .where(and(inArray(decks.cloudNodeId, all.slice(at, at + 500)), isNull(decks.deletedAt)));
    }
    await recordEvent(
      deps.db,
      {
        kind: 'deleted',
        actorId: userId,
        node,
        workspaceId: node.workspaceId,
        name: node.name,
      },
      now,
    );
    return nodeDto(
      deps,
      ctx,
      { ...node, deletedAt: now, deletedBy: userId, deletedRootId: node.id },
      access,
    );
  });
}

/** A deleted file or folder with the caller's right to bring it back, or throws. */
async function loadTrashed(deps: CloudDeps, userId: string, id: string) {
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, id));
  if (!node?.deletedAt || node.deletedRootId !== node.id) {
    throw badRequest('Das liegt nicht (mehr) in „Gelöscht“.');
  }
  const ctx = await cloudContext(deps.db, node.workspaceId, userId);
  const access = (await trashRights(deps.db, ctx, [node], deps.clock.now())).get(node.id);
  if (!access) throw badRequest('Das liegt nicht (mehr) in „Gelöscht“.');
  return { node, ctx, access };
}

/** Back to where it was – or, with that folder gone, to the top of its area. */
export async function restoreNodes(
  deps: CloudDeps,
  userId: string,
  ids: string[],
): Promise<CloudBatchResult> {
  return batch(ids, async (id) => {
    const { node, ctx, access } = await loadTrashed(deps, userId, id);
    let parentId = node.parentId;
    if (parentId) {
      const [parent] = await deps.db
        .select({ deletedAt: cloudNodes.deletedAt })
        .from(cloudNodes)
        .where(eq(cloudNodes.id, parentId));
      if (!parent || parent.deletedAt) parentId = null;
    }
    const siblings = await siblingsIn(deps.db, { ...placeOf(node), parentId });
    const name = cloudFreeName(node.name, nameKeys(siblings));
    const now = deps.clock.now();
    const back = await deps.db
      .update(cloudNodes)
      .set({ deletedAt: null, deletedBy: null, deletedRootId: null })
      .where(eq(cloudNodes.deletedRootId, node.id))
      .returning({ id: cloudNodes.id });
    // … and their presentations with them, out of Slider's trash.
    for (let at = 0; at < back.length; at += 500) {
      await deps.db
        .update(decks)
        .set({ deletedAt: null, deletedBy: null })
        .where(
          inArray(
            decks.cloudNodeId,
            back.slice(at, at + 500).map((each) => each.id),
          ),
        );
    }
    const [row] = await deps.db
      .update(cloudNodes)
      .set({ parentId, name })
      .where(eq(cloudNodes.id, node.id))
      .returning();
    if (!row) throw new Error('Restore returned nothing');
    await recordEvent(
      deps.db,
      { kind: 'restored', actorId: userId, node: row, workspaceId: row.workspaceId, name },
      now,
    );
    return nodeDto(deps, ctx, row, access);
  });
}

/**
 * Gone for good, bytes and all. Whoever deleted it may, and whoever manages where it lay.
 * Resolves with the ids that went.
 */
export async function purgeNodes(
  deps: CloudDeps,
  userId: string,
  ids: string[],
): Promise<CloudBatchResult & { purged: string[] }> {
  const purged: string[] = [];
  const result = await batch(ids, async (id) => {
    const { node, ctx, access } = await loadTrashed(deps, userId, id);
    // Deleted through a share: back it may come, gone for good only by whom it belongs to.
    const own = cloudAccessAtLeast(baseAccess(ctx, node), 'edit');
    if (access !== 'manage' && !(own && node.deletedBy === userId)) {
      throw badRequest(
        `„${node.name}“ löscht endgültig, wer es gelöscht hat oder den Bereich verwaltet.`,
      );
    }
    await assertDecksOwn(deps.db, ctx, node, true);
    await recordEvent(
      deps.db,
      { kind: 'purged', actorId: userId, node, workspaceId: node.workspaceId, name: node.name },
      deps.clock.now(),
    );
    await purgeRow(deps, node);
    purged.push(node.id);
    return null;
  });
  return { ...result, purged };
}

/** Removes the row (and, through it, everything in it) and every byte of its files. */
export async function purgeRow(
  deps: Pick<CloudDeps, 'db' | 'storage' | 'log'>,
  node: CloudNodeRow,
): Promise<void> {
  const inside =
    node.kind === 'folder' ? await descendantsOf(deps.db, [node.id], { deleted: true }) : [];
  const files = [node, ...inside].filter((each) => each.kind === 'file');
  const blobs = await fileBlobs(
    deps.db,
    node.workspaceId,
    files.map((file) => file.id),
  );
  // The files on their comments and AI chats: nothing points at them once the rows are gone.
  const attached = await attachmentsOn(deps.db, { nodeIds: files.map((file) => file.id) });
  // A presentation is its file: gone for good here, it is gone in Slider.
  const gone: string[] = [];
  for (let at = 0; at < files.length; at += 500) {
    const rows = await deps.db
      .delete(decks)
      .where(
        inArray(
          decks.cloudNodeId,
          files.slice(at, at + 500).map((file) => file.id),
        ),
      )
      .returning({ id: decks.id });
    gone.push(...rows.map((row) => row.id));
  }
  await deps.db.delete(cloudNodes).where(eq(cloudNodes.id, node.id));
  await deleteBlobs(deps, blobs);
  for (const id of gone) await deleteBlobs(deps, deckBlobs(blobKeys.deckPrefix(id)));
  await deleteAttachments(deps, attached);
}

/** „Papierkorb leeren“: everything the caller may delete for good. */
export async function emptyTrash(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
): Promise<{ purged: number; skipped: CloudBatchResult['skipped'] }> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const rows = await deps.db
    .select()
    .from(cloudNodes)
    .where(
      and(
        eq(cloudNodes.workspaceId, workspaceId),
        isNotNull(cloudNodes.deletedAt),
        eq(cloudNodes.deletedRootId, cloudNodes.id),
      ),
    );
  let purged = 0;
  const skipped: CloudBatchResult['skipped'] = [];
  const rights = await trashRights(deps.db, ctx, rows, deps.clock.now());
  for (const row of rows) {
    const access = rights.get(row.id) ?? null;
    // As `purgeNodes`: deleted through a share it may come back, gone for good only by whom
    // it belongs to.
    const own = cloudAccessAtLeast(baseAccess(ctx, row), 'edit');
    if (access !== 'manage' && !(own && row.deletedBy === userId)) continue;
    // … and presentations by whom Slider lets delete them: left there, and said why.
    try {
      await assertDecksOwn(deps.db, ctx, row, true);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 403) throw error;
      skipped.push({ id: row.id, name: row.name, reason: error.message });
      continue;
    }
    await purgeRow(deps, row);
    purged += 1;
  }
  return { purged, skipped };
}

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * Files and folders by name, everywhere the caller may look. Names are sealed, so they are
 * read and matched here: every word of the query must be in the name; names starting with it
 * come first, then the most recently changed. `in=all` adds what the files say after the names;
 * `area` and `owner` narrow where it lies and whose it is before anything is matched.
 */
export async function searchNodes(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
  query: Pick<CloudSearchQuery, 'q' | 'limit' | 'area' | 'owner'> & {
    in?: CloudSearchQuery['in'];
  },
): Promise<CloudSearchResult> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const words = cloudNameKey(query.q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return { nodes: [], more: false };
  const shared = await deps.db
    .select({ node: cloudNodes })
    .from(cloudShares)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudShares.nodeId))
    .where(
      and(
        eq(cloudShares.kind, 'user'),
        eq(cloudShares.userId, userId),
        eq(cloudShares.workspaceId, workspaceId),
        live,
      ),
    );
  const sharedRoots = shared.map((row) => row.node);
  const sharedInside = await descendantsOf(
    deps.db,
    sharedRoots.filter((row) => row.kind === 'folder').map((row) => row.id),
  );
  const candidates = new Map<string, CloudNodeRow>();
  for (const row of [...sharedRoots, ...sharedInside]) candidates.set(row.id, row);
  const own = await deps.db.select().from(cloudNodes).where(reachable(ctx));
  const reached = new Set(own.map((row) => row.id));
  for (const row of own) candidates.set(row.id, row);
  const where = (row: CloudNodeRow) =>
    query.area === undefined
      ? true
      : query.area === 'own'
        ? row.areaId === null && row.ownerId === userId
        : query.area === 'shared'
          ? !reached.has(row.id)
          : row.areaId === query.area;
  const narrowed = [...candidates.values()].filter(
    (row) => where(row) && (query.owner === undefined || row.ownerId === query.owner),
  );

  if (query.in === 'text') return searchInText(deps, ctx, narrowed, words, query);
  const byName = await searchInNames(deps, ctx, narrowed, words, query);
  if (query.in !== 'all') return byName;
  // Both: what is called so first, then what says so – each thing once.
  const named = new Set(byName.nodes.map((node) => node.id));
  const said = await searchInText(
    deps,
    ctx,
    narrowed.filter((row) => !named.has(row.id)),
    words,
    { limit: Math.max(0, query.limit - byName.nodes.length) },
  );
  return {
    nodes: [...byName.nodes, ...said.nodes],
    more: byName.more || said.more,
    snippets: said.snippets,
    pending: said.pending,
  };
}

/** The search in names: every word in the name; names starting with the first come first. */
async function searchInNames(
  deps: CloudDeps,
  ctx: CloudCtx,
  candidates: readonly CloudNodeRow[],
  words: readonly string[],
  query: { limit: number },
): Promise<CloudSearchResult> {
  const first = words[0] ?? '';
  const matches = candidates
    .map((row) => ({ row, key: cloudNameKey(row.name) }))
    .filter(({ key }) => words.every((word) => key.includes(word)))
    .sort(
      (a, b) =>
        Number(b.key.startsWith(first)) - Number(a.key.startsWith(first)) ||
        b.row.updatedAt.getTime() - a.row.updatedAt.getTime(),
    );
  const page = matches.slice(0, query.limit).map((match) => match.row);
  const seen = await withAccess(deps, ctx, page);
  return {
    nodes: await toNodeDtos(deps, ctx, seen.rows, {
      access: (row) => seen.access.get(row.id) ?? 'view',
      location: true,
    }),
    more: matches.length > query.limit,
  };
}

/** Files looked through per search in what they say, the newest first. */
const TEXT_SEARCH_FILES = 600;
/** How long one search reads files not read yet; the rest waits for the next one. */
const TEXT_SEARCH_READ_MS = 4000;
const SNIPPET_BEFORE = 40;
const SNIPPET_CHARS = 140;

/**
 * The search in what files say: every word must stand in the file's text. A file's text is read
 * once and kept (`searchText`); what is not read within the time is `pending` – the page asks
 * again, and each time more is read.
 */
async function searchInText(
  deps: CloudDeps,
  ctx: CloudCtx,
  candidates: readonly CloudNodeRow[],
  words: readonly string[],
  query: { limit: number },
): Promise<CloudSearchResult> {
  const files = candidates
    .filter((row) => row.kind === 'file' && row.currentVersionId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, TEXT_SEARCH_FILES);
  // Only what the caller may see is read at all.
  const seen = await withAccess(deps, ctx, files);
  const versionIds = seen.rows.flatMap((row) =>
    row.currentVersionId ? [row.currentVersionId] : [],
  );
  const versions = new Map(
    (versionIds.length
      ? await deps.db.select().from(cloudVersions).where(inArray(cloudVersions.id, versionIds))
      : []
    ).map((version) => [version.id, version]),
  );
  const until = Date.now() + TEXT_SEARCH_READ_MS;
  const matches: CloudNodeRow[] = [];
  const snippets: Record<string, string> = {};
  let pending = false;
  for (const row of seen.rows) {
    const version = versions.get(row.currentVersionId ?? '');
    if (!version) continue;
    const text = await searchText(deps, row, version, Date.now() < until);
    if (text === undefined) {
      pending = true;
      continue;
    }
    const key = cloudNameKey(text);
    if (!words.every((word) => key.includes(word))) continue;
    matches.push(row);
    const at = Math.max(0, key.indexOf(words[0] ?? '') - SNIPPET_BEFORE);
    snippets[row.id] =
      (at > 0 ? '… ' : '') +
      text.slice(at, at + SNIPPET_CHARS).trim() +
      (at + SNIPPET_CHARS < text.length ? ' …' : '');
  }
  const page = matches.slice(0, query.limit);
  return {
    nodes: await toNodeDtos(deps, ctx, page, {
      access: (row) => seen.access.get(row.id) ?? 'view',
      location: true,
    }),
    more: matches.length > query.limit,
    snippets: Object.fromEntries(page.map((row) => [row.id, snippets[row.id] ?? ''])),
    pending,
  };
}
