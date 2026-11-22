import { and, count, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  cloudFileType,
  type CloudFileType,
  type CloudHome,
  type CloudOverview,
} from '@slider/shared';
import type { Executor } from '../../db/client';
import {
  cloudAreaMembers,
  cloudNodes,
  cloudShares,
  cloudVersions,
  users,
  workspaceMembers,
  workspaces,
} from '../../db/schema';
import { forbidden } from '../../http/errors';
import { ownerAuthor } from '../../authors';
import { planLimits } from '../plans';
import { DAY_MS } from '../retention-rules';
import { totalBytes, workspaceStorageUsage } from '../workspace-storage';
import { canCreateAreas, listAreas } from './areas';
import {
  cloudContext,
  cloudMaxFileBytes,
  cloudPublicLinks,
  cloudSharing,
  looksOnly,
  type CloudCtx,
  type CloudDeps,
} from './context';
import { listPins, toNodeDtos, trashCount } from './nodes';
import { anyShares, toShareDtos, unseenShares } from './shares';

/**
 * Numbers about a workspace's files: what the shell shows on every page (areas, the storage
 * bar), and the admins' overview – where the storage goes, who is in which area, what is open
 * to people outside. Sizes and counts; of people's own files never more than a size.
 */

const num = (value: string | number | null | undefined) => Number(value ?? 0);

/**
 * Bytes of every stored version per workspace – what the files take of its plan. A version
 * brought back points at the bytes of the one it came from, so bytes count once per stored file;
 * a presentation's file points at the presentation's own and counts there.
 */
export async function cloudBytes(
  db: Executor,
  workspaceIds: readonly string[],
): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();
  const stored = db
    .selectDistinctOn([cloudVersions.storageKey], {
      workspaceId: cloudVersions.workspaceId,
      sizeBytes: cloudVersions.sizeBytes,
    })
    .from(cloudVersions)
    .where(
      and(
        inArray(cloudVersions.workspaceId, [...workspaceIds]),
        // A presentation's file is counted where it is stored: with the presentation.
        sql`${cloudVersions.storageKey} not like 'decks/%'`,
      ),
    )
    .as('stored');
  const rows = await db
    .select({
      id: stored.workspaceId,
      bytes: sql<string | number | null>`sum(${stored.sizeBytes})`,
    })
    .from(stored)
    .groupBy(stored.workspaceId);
  return new Map(rows.map((row) => [row.id, num(row.bytes)]));
}

/** Living files per workspace – for the instance's list of workspaces. */
export async function cloudFileCounts(
  db: Executor,
  workspaceIds: readonly string[],
): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();
  const rows = await db
    .select({ id: cloudNodes.workspaceId, files: count() })
    .from(cloudNodes)
    .where(
      and(
        inArray(cloudNodes.workspaceId, [...workspaceIds]),
        eq(cloudNodes.kind, 'file'),
        isNull(cloudNodes.deletedAt),
      ),
    )
    .groupBy(cloudNodes.workspaceId);
  return new Map(rows.map((row) => [row.id, row.files]));
}

const DOCUMENTS = new Set<CloudFileType>([
  'document',
  'presentation',
  'spreadsheet',
  'pdf',
  'text',
]);
const MEDIA = new Set<CloudFileType>(['image', 'video', 'audio']);

/** Living files by extension – what the kinds add up from, without reading a name. */
async function byExtension(db: Executor, workspaceId: string) {
  return db
    .select({
      extension: cloudNodes.extension,
      files: count(),
      bytes: sql<string | number | null>`sum(${cloudNodes.sizeBytes})`,
    })
    .from(cloudNodes)
    .where(
      and(
        eq(cloudNodes.workspaceId, workspaceId),
        eq(cloudNodes.kind, 'file'),
        isNull(cloudNodes.deletedAt),
      ),
    )
    .groupBy(cloudNodes.extension);
}

async function storageOf(deps: CloudDeps, workspaceId: string): Promise<CloudHome['storage']> {
  const [workspace] = await deps.db
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const [breakdown, extensions] = await Promise.all([
    workspaceStorageUsage(deps.db, workspaceId),
    byExtension(deps.db, workspaceId),
  ]);
  let documentBytes = 0;
  let mediaBytes = 0;
  for (const row of extensions) {
    const type = cloudFileType(`x.${row.extension}`);
    if (DOCUMENTS.has(type)) documentBytes += num(row.bytes);
    else if (MEDIA.has(type)) mediaBytes += num(row.bytes);
  }
  const usedBytes = totalBytes(breakdown);
  const presentationBytes = usedBytes - breakdown.files;
  return {
    usedBytes,
    maxBytes: planLimits(deps.config, workspace?.plan ?? 'free').maxStorageBytes,
    presentationBytes,
    documentBytes,
    mediaBytes,
    // Other kinds of files, earlier versions and what lies in „Gelöscht“.
    otherBytes: Math.max(0, breakdown.files - documentBytes - mediaBytes),
  };
}

/** `GET /workspaces/:id/cloud`: what every page of Cloud shows around its content. */
export async function cloudHome(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
): Promise<CloudHome> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const [areas, pins, sharedNew, trash, storage, shared] = await Promise.all([
    listAreas(deps, ctx),
    listPins(deps, ctx),
    unseenShares(deps, userId, workspaceId),
    trashCount(deps.db, ctx, deps.clock.now()),
    storageOf(deps, workspaceId),
    anyShares(deps, userId, workspaceId),
  ]);
  return {
    areas,
    pins,
    canCreateAreas: canCreateAreas(ctx),
    counts: { sharedNew, trash },
    storage,
    maxFileBytes: cloudMaxFileBytes(deps.config),
    links: cloudPublicLinks(deps.config),
    sharing: cloudSharing(deps.config),
    ownFiles: !looksOnly(ctx.role),
    shared,
  };
}

const requireAdmin = (ctx: CloudCtx) => {
  if (ctx.role !== 'admin') throw forbidden('Die Übersicht sehen die Admins des Workspace.');
};

/** `GET /workspaces/:id/cloud/overview` – admins only. */
export async function cloudOverview(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
): Promise<CloudOverview> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  requireAdmin(ctx);
  const { db } = deps;
  const now = deps.clock.now();
  const inWorkspace = eq(cloudNodes.workspaceId, workspaceId);
  const since = new Date(now.getTime() - 29 * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);

  const [
    storage,
    extensions,
    kinds,
    areaRows,
    ownRows,
    trashRows,
    stored,
    shareRows,
    members,
    areaPeople,
    largest,
    days,
  ] = await Promise.all([
    storageOf(deps, workspaceId),
    byExtension(db, workspaceId),
    db
      .select({ kind: cloudNodes.kind, total: count() })
      .from(cloudNodes)
      .where(and(inWorkspace, isNull(cloudNodes.deletedAt)))
      .groupBy(cloudNodes.kind),
    db
      .select({
        areaId: cloudNodes.areaId,
        files: count(),
        bytes: sql<string | number | null>`sum(${cloudNodes.sizeBytes})`,
      })
      .from(cloudNodes)
      .where(and(inWorkspace, eq(cloudNodes.kind, 'file'), isNull(cloudNodes.deletedAt)))
      .groupBy(cloudNodes.areaId),
    db
      .select({
        ownerId: cloudNodes.ownerId,
        bytes: sql<string | number | null>`sum(${cloudNodes.sizeBytes})`,
      })
      .from(cloudNodes)
      .where(
        and(
          inWorkspace,
          eq(cloudNodes.kind, 'file'),
          isNull(cloudNodes.areaId),
          isNull(cloudNodes.deletedAt),
        ),
      )
      .groupBy(cloudNodes.ownerId),
    db
      .select({
        files: sql<number>`count(*) filter (where ${cloudNodes.deletedRootId} = ${cloudNodes.id})::int`,
        bytes: sql<string | number | null>`sum(${cloudNodes.sizeBytes})`,
      })
      .from(cloudNodes)
      .where(and(inWorkspace, isNotNull(cloudNodes.deletedAt))),
    cloudBytes(db, [workspaceId]),
    db.select().from(cloudShares).where(eq(cloudShares.workspaceId, workspaceId)),
    db
      .select({ user: users, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    db
      .select({ areaId: cloudAreaMembers.areaId, userId: cloudAreaMembers.userId })
      .from(cloudAreaMembers)
      .where(inArray(cloudAreaMembers.areaId, ['', ...ctx.areas.keys()])),
    db
      .select()
      .from(cloudNodes)
      .where(
        and(
          inWorkspace,
          eq(cloudNodes.kind, 'file'),
          isNotNull(cloudNodes.areaId),
          isNull(cloudNodes.deletedAt),
        ),
      )
      .orderBy(desc(cloudNodes.sizeBytes))
      .limit(8),
    db
      .select({
        day: sql<string>`to_char(${cloudVersions.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        uploads: count(),
        bytes: sql<string | number | null>`sum(${cloudVersions.sizeBytes})`,
      })
      .from(cloudVersions)
      .where(and(eq(cloudVersions.workspaceId, workspaceId), gte(cloudVersions.createdAt, since)))
      .groupBy(sql`1`),
  ]);

  const liveBytes = extensions.reduce((sum, row) => sum + num(row.bytes), 0);
  const trashBytes = num(trashRows[0]?.bytes);
  const allBytes = stored.get(workspaceId) ?? 0;
  const types = new Map<CloudFileType, { files: number; bytes: number }>();
  for (const row of extensions) {
    const type = cloudFileType(`x.${row.extension}`);
    const entry = types.get(type) ?? { files: 0, bytes: 0 };
    entry.files += row.files;
    entry.bytes += num(row.bytes);
    types.set(type, entry);
  }
  const areaSize = new Map(areaRows.map((row) => [row.areaId, row]));
  const own = areaSize.get(null);
  const byArea: CloudOverview['byArea'] = [...ctx.areas.values()]
    .sort((a, b) => a.row.position - b.row.position)
    .map((area) => ({
      areaId: area.row.id,
      name: area.row.name,
      color: area.row.color,
      files: areaSize.get(area.row.id)?.files ?? 0,
      bytes: num(areaSize.get(area.row.id)?.bytes),
    }));
  byArea.push({
    areaId: null,
    name: 'Persönliche Dateien',
    color: null,
    files: own?.files ?? 0,
    bytes: num(own?.bytes),
  });

  const ownBytes = new Map(ownRows.map((row) => [row.ownerId, num(row.bytes)]));
  const areasOf = new Map<string, string[]>();
  for (const row of areaPeople) {
    areasOf.set(row.userId, [...(areasOf.get(row.userId) ?? []), row.areaId]);
  }
  // Links to files in areas are listed; of people's own files only their number counts.
  const linkRows = shareRows.filter((row) => row.kind === 'link');
  const linkNodes = linkRows.length
    ? await db
        .select()
        .from(cloudNodes)
        .where(
          and(
            inArray(
              cloudNodes.id,
              linkRows.map((row) => row.nodeId),
            ),
            isNotNull(cloudNodes.areaId),
            isNull(cloudNodes.deletedAt),
          ),
        )
    : [];
  const nodeDtos = await toNodeDtos(deps, ctx, [...largest, ...linkNodes], {
    access: () => 'manage',
    location: true,
  });
  const dtoOf = new Map(nodeDtos.map((dto) => [dto.id, dto]));
  const shareDtos = await toShareDtos(
    deps,
    linkRows.filter((row) => linkNodes.some((node) => node.id === row.nodeId)),
  );
  const perDay = new Map(days.map((row) => [row.day, row]));

  return {
    totals: {
      files: kinds.find((row) => row.kind === 'file')?.total ?? 0,
      folders: kinds.find((row) => row.kind === 'folder')?.total ?? 0,
      bytes: allBytes,
      versionBytes: Math.max(0, allBytes - liveBytes - trashBytes),
      trashBytes,
      trashCount: num(trashRows[0]?.files),
      links: linkRows.length,
      shares: shareRows.length - linkRows.length,
    },
    storage,
    byArea,
    byType: [...types.entries()]
      .map(([type, entry]) => ({ type, ...entry }))
      .sort((a, b) => b.bytes - a.bytes),
    byPerson: members
      .map((member) => ({
        person: { ...ownerAuthor(member.user), email: member.user.email, role: member.role },
        areaIds: areasOf.get(member.user.id) ?? [],
        ownBytes: ownBytes.get(member.user.id) ?? 0,
        lastActiveAt: member.user.lastActiveAt.toISOString(),
      }))
      .sort((a, b) => a.person.name.localeCompare(b.person.name, 'de')),
    largest: largest.flatMap((row) => dtoOf.get(row.id) ?? []),
    links: shareDtos.flatMap((share) => {
      const node = dtoOf.get(share.nodeId);
      return node ? [{ share, node }] : [];
    }),
    days: Array.from({ length: 30 }, (_, index) => {
      const day = new Date(since.getTime() + index * DAY_MS).toISOString().slice(0, 10);
      const row = perDay.get(day);
      return { day, uploads: row?.uploads ?? 0, bytes: num(row?.bytes) };
    }),
  };
}
