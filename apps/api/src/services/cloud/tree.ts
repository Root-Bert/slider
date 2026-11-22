import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { cloudNameKey, type CloudAccess } from '@slider/shared';
import type { Executor } from '../../db/client';
import { cloudNodes, type CloudNodeRow } from '../../db/schema';
import { ApiError, badRequest } from '../../http/errors';
import {
  accessOf,
  nodeNotFound,
  noEditRight,
  requireArea,
  type AreaEntry,
  type CloudCtx,
  type CloudDeps,
  looksOnly,
  noOwnFiles,
} from './context';
import { cloudAccessAtLeast, CLOUD_MAX_DEPTH } from '@slider/shared';

/**
 * The tree of files and folders: where something lies, what lies beside it, what lies in it.
 * Names are sealed, so "the one called X here" is found by reading the folder, never by SQL.
 */

/** One folder's inside – or a top: of an area, or of someone's own files. */
export interface Place {
  workspaceId: string;
  /** `null`: someone's own files, `ownerId` says whose. */
  areaId: string | null;
  ownerId: string | null;
  parentId: string | null;
}

export const placeOf = (
  node: Pick<CloudNodeRow, 'workspaceId' | 'areaId' | 'ownerId' | 'parentId'>,
): Place => ({
  workspaceId: node.workspaceId,
  areaId: node.areaId,
  ownerId: node.areaId ? null : node.ownerId,
  parentId: node.parentId,
});

/** What lies directly in `place` (deleted things too – add `isNull(deletedAt)` for the living). */
export function inPlace(place: Place): SQL {
  if (place.parentId) return eq(cloudNodes.parentId, place.parentId);
  const top = place.areaId
    ? eq(cloudNodes.areaId, place.areaId)
    : and(isNull(cloudNodes.areaId), eq(cloudNodes.ownerId, place.ownerId ?? ''));
  return and(
    eq(cloudNodes.workspaceId, place.workspaceId),
    isNull(cloudNodes.parentId),
    top,
  ) as SQL;
}

export const live = isNull(cloudNodes.deletedAt);

/** The living files and folders directly in `place`. */
export async function siblingsIn(db: Executor, place: Place): Promise<CloudNodeRow[]> {
  return db
    .select()
    .from(cloudNodes)
    .where(and(inPlace(place), live));
}

export const nameTaken = (name: string) =>
  new ApiError(409, 'bad_request', `Hier gibt es schon „${name}“.`);

/** The sibling called `name` (names compare without case), if there is one. */
export const findByName = (siblings: readonly CloudNodeRow[], name: string, exceptId?: string) => {
  const key = cloudNameKey(name);
  return siblings.find((each) => each.id !== exceptId && cloudNameKey(each.name) === key) ?? null;
};

export const nameKeys = (siblings: readonly CloudNodeRow[]) =>
  new Set(siblings.map((each) => cloudNameKey(each.name)));

/**
 * Everything in these folders, at any depth (the folders themselves left out). `deleted`
 * `false`: only the living; `true`: whatever is there – what lies in a deleted folder is deleted.
 */
export async function descendantsOf(
  db: Executor,
  rootIds: readonly string[],
  { deleted = false }: { deleted?: boolean } = {},
): Promise<(CloudNodeRow & { rootId: string })[]> {
  const result: (CloudNodeRow & { rootId: string })[] = [];
  let frontier = new Map(rootIds.map((id) => [id, id]));
  for (let depth = 0; frontier.size > 0 && depth < 128; depth++) {
    const next = new Map<string, string>();
    const ids = [...frontier.keys()];
    for (let at = 0; at < ids.length; at += 500) {
      const rows = await db
        .select()
        .from(cloudNodes)
        .where(
          and(inArray(cloudNodes.parentId, ids.slice(at, at + 500)), deleted ? undefined : live),
        );
      for (const row of rows) {
        const rootId = frontier.get(row.parentId ?? '') ?? '';
        result.push({ ...row, rootId });
        if (row.kind === 'folder') next.set(row.id, rootId);
      }
    }
    frontier = next;
  }
  return result;
}

/** Files and bytes in each folder, at any depth – without reading a single name. */
export async function folderStats(
  db: Executor,
  folderIds: readonly string[],
  { deleted = false }: { deleted?: boolean } = {},
): Promise<Map<string, { files: number; bytes: number }>> {
  const stats = new Map(folderIds.map((id) => [id, { files: 0, bytes: 0 }]));
  let frontier = new Map(folderIds.map((id) => [id, id]));
  for (let depth = 0; frontier.size > 0 && depth < 128; depth++) {
    const next = new Map<string, string>();
    const ids = [...frontier.keys()];
    for (let at = 0; at < ids.length; at += 500) {
      const rows = await db
        .select({
          id: cloudNodes.id,
          parentId: cloudNodes.parentId,
          kind: cloudNodes.kind,
          sizeBytes: cloudNodes.sizeBytes,
        })
        .from(cloudNodes)
        .where(
          and(inArray(cloudNodes.parentId, ids.slice(at, at + 500)), deleted ? undefined : live),
        );
      for (const row of rows) {
        const rootId = frontier.get(row.parentId ?? '') ?? '';
        if (row.kind === 'folder') next.set(row.id, rootId);
        else {
          const entry = stats.get(rootId);
          if (entry) {
            entry.files += 1;
            entry.bytes += row.sizeBytes;
          }
        }
      }
    }
    frontier = next;
  }
  return stats;
}

export interface Target {
  place: Place;
  /** The open folder; `null` at a top. */
  folder: CloudNodeRow | null;
  /** The folders above the open one, nearest first. */
  chain: CloudNodeRow[];
  area: AreaEntry | null;
  access: CloudAccess;
  /** The caller got here through a share on this folder (or one above). */
  sharedRoot: CloudNodeRow | null;
}

/**
 * Where something is listed or put: a folder, an area's top, or – neither given – the caller's
 * own files. Throws 404 when it is not theirs to see, 403 below `min`.
 */
export async function resolveTarget(
  deps: Pick<CloudDeps, 'db' | 'clock'>,
  ctx: CloudCtx,
  target: { parentId?: string | null; areaId?: string | null },
  min: CloudAccess = 'view',
): Promise<Target> {
  if (target.parentId) {
    const [folder] = await deps.db
      .select()
      .from(cloudNodes)
      .where(and(eq(cloudNodes.id, target.parentId), eq(cloudNodes.workspaceId, ctx.workspaceId)));
    if (!folder || folder.deletedAt) throw nodeNotFound();
    if (folder.kind !== 'folder') throw badRequest('Das ist kein Ordner.');
    const found = await accessOf(deps.db, ctx, folder, deps.clock.now());
    if (!found.access) throw nodeNotFound();
    if (!cloudAccessAtLeast(found.access, min)) throw noEditRight();
    return {
      place: {
        workspaceId: ctx.workspaceId,
        areaId: folder.areaId,
        ownerId: folder.areaId ? null : folder.ownerId,
        parentId: folder.id,
      },
      folder,
      chain: found.chain,
      area: folder.areaId ? (ctx.areas.get(folder.areaId) ?? null) : null,
      access: found.access,
      sharedRoot: found.sharedRoot,
    };
  }
  if (target.areaId) {
    const area = requireArea(ctx, target.areaId, min);
    return {
      place: { workspaceId: ctx.workspaceId, areaId: area.row.id, ownerId: null, parentId: null },
      folder: null,
      chain: [],
      area,
      access: area.access ?? 'view',
      sharedRoot: null,
    };
  }
  if (looksOnly(ctx.role)) throw noOwnFiles();
  return {
    place: { workspaceId: ctx.workspaceId, areaId: null, ownerId: ctx.userId, parentId: null },
    folder: null,
    chain: [],
    area: null,
    access: 'manage',
    sharedRoot: null,
  };
}

/** How deep something put into `target` would lie; folders nest `CLOUD_MAX_DEPTH` deep at most. */
export function assertDepth(target: Target, extra = 1): void {
  const depth = (target.folder ? target.chain.length + 1 : 0) + extra;
  if (depth > CLOUD_MAX_DEPTH) {
    throw badRequest(`Ordner lassen sich höchstens ${CLOUD_MAX_DEPTH} Ebenen tief verschachteln.`);
  }
}

/** What the place is called, for „nach … verschoben“. */
export const targetName = (target: Target): string =>
  target.folder?.name ?? target.area?.row.name ?? 'Meine Dateien';
