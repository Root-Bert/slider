import { createHash } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  CLOUD_REMOVED_DAYS,
  cloudAccessAtLeast,
  strongerCloudAccess,
  type CloudAccess,
  type CloudChanges,
  type CloudDriveNode,
  type CloudDriveRoot,
} from '@slider/shared';
import type { Executor } from '../../db/client';
import {
  cloudNodes,
  cloudRemoved,
  cloudShares,
  cloudVersions,
  workspaces,
  type CloudNodeRow,
} from '../../db/schema';
import { DAY_MS } from '../retention-rules';
import { baseAccess, cloudContext, looksOnly, type CloudCtx, type CloudDeps } from './context';

/*
 * Cloud on a computer (the drive in the Finder or Explorer): what changed since it last asked.
 *
 * Every file and folder carries `changed_at`, set by a trigger from the database's clock, and
 * what goes for good leaves a row in `cloud_removed` – so nothing that changes files has to
 * remember to tell. The answer walks the rows in that order; the cursor is where it stopped.
 * A change is stamped when it is made and seen when its transaction ends: the cursor therefore
 * stays `OVERLAP_SECONDS` behind the clock, and a computer hears of late ones twice – applying
 * an answer twice changes nothing.
 *
 * In it: one's own files, the areas one sees, and – under „Geteilt“ – what others shared from
 * where one does not see: each shared file or folder at its top, with everything in it. Sharing
 * stamps no file, so a share given, changed, taken or run out makes another view and the
 * computer starts over. A folder moved into or out of a shared one is stamped alone: what is in
 * it is told along (`withinMoved`).
 *
 * Dropped (`removed`) is told only of what the caller could see: where it lies (deleted), where it
 * lay before it last moved (`left_*`, kept by a trigger), or where it lay when it went for good –
 * the ids of files never theirs to see stay unknown to them.
 */

const OVERLAP_SECONDS = 10;
const REMOVED_AT_ONCE = 5000;

interface Cursor {
  /** Rows after this time and id come next (`changed_at::text`, to the microsecond). */
  t: string;
  id: string;
  /** The caller's view when it was made: another one starts over. */
  v: string;
  /** Still on the way through everything: the time it began, where telling of changes starts. */
  s?: string;
}

const START = '1970-01-01 00:00:00+00';

const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decode(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    const stamp = (text: unknown): text is string =>
      typeof text === 'string' && text.length < 48 && !Number.isNaN(Date.parse(text));
    if (!stamp(value.t) || typeof value.id !== 'string' || typeof value.v !== 'string') return null;
    if (value.s !== undefined && !stamp(value.s)) return null;
    return { t: value.t, id: value.id, v: value.v, s: value.s };
  } catch {
    return null;
  }
}

/** Everything live below these folders, level by level. */
async function below(db: Executor, folderIds: readonly string[]): Promise<CloudNodeRow[]> {
  const found: CloudNodeRow[] = [];
  const seen = new Set(folderIds);
  let level = [...folderIds];
  // A loop in the tree cannot be made (`moveNodes` refuses it); the bound is the second line.
  for (let depth = 0; level.length && depth < 64; depth++) {
    const rows = await db
      .select()
      .from(cloudNodes)
      .where(and(inArray(cloudNodes.parentId, level), isNull(cloudNodes.deletedAt)));
    const fresh = rows.filter((row) => !seen.has(row.id));
    for (const row of fresh) seen.add(row.id);
    found.push(...fresh);
    level = fresh.filter((row) => row.kind === 'folder').map((row) => row.id);
  }
  return found;
}

/** What the caller's shares give: every shared file and folder and all in them, by id. */
async function sharedView(
  db: Executor,
  ctx: CloudCtx,
  now: Date,
): Promise<{ access: Map<string, CloudAccess>; key: string[]; beyond: boolean }> {
  const rows = await db
    .select({ node: cloudNodes, role: cloudShares.role, expiresAt: cloudShares.expiresAt })
    .from(cloudShares)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudShares.nodeId))
    .where(
      and(
        eq(cloudShares.kind, 'user'),
        eq(cloudShares.userId, ctx.userId),
        eq(cloudShares.workspaceId, ctx.workspaceId),
        isNull(cloudNodes.deletedAt),
      ),
    );
  const access = new Map<string, CloudAccess>();
  const give = (id: string, shared: CloudAccess) => {
    const role = looksOnly(ctx.role) ? 'view' : shared;
    const merged = strongerCloudAccess(access.get(id) ?? null, role);
    if (merged) access.set(id, merged);
  };
  const key: string[] = [];
  /** Something shared lies where the caller does not see: „Geteilt“ has something in it. */
  let beyond = false;
  for (const row of rows) {
    if (row.expiresAt && row.expiresAt <= now) continue;
    beyond ||= baseAccess(ctx, row.node) === null;
    key.push(`share:${row.node.id}:${row.role}`);
    give(row.node.id, row.role);
    if (row.node.kind !== 'folder') continue;
    for (const inside of await below(db, [row.node.id])) give(inside.id, row.role);
  }
  return { access, key, beyond };
}

const rootsOf = (ctx: CloudCtx, shared: boolean): CloudDriveRoot[] => [
  ...(looksOnly(ctx.role)
    ? []
    : [
        { id: 'mine', kind: 'mine' as const, parentId: null, name: 'Meine Dateien', canEdit: true },
      ]),
  ...[...ctx.areas.values()]
    .filter((area) => area.access)
    .sort((a, b) => a.row.position - b.row.position || a.row.name.localeCompare(b.row.name, 'de'))
    .map((area) => ({
      id: area.row.id,
      kind: area.row.root ? ('workspace' as const) : ('area' as const),
      // Under an area the caller does not see it stands at the top, as in the web.
      parentId:
        area.row.parentId && ctx.areas.get(area.row.parentId)?.access ? area.row.parentId : null,
      name: area.row.name,
      canEdit: cloudAccessAtLeast(area.access, 'edit'),
    })),
  // Only where something is shared; nothing is put at its top.
  ...(shared
    ? [{ id: 'shared', kind: 'shared' as const, parentId: null, name: 'Geteilt', canEdit: false }]
    : []),
];

/** Who sees what: when this changes, single changes no longer tell the whole story. */
const viewOf = (ctx: CloudCtx, shares: readonly string[]) =>
  createHash('sha256')
    .update(
      [...ctx.areas.values()]
        .filter((area) => area.access)
        .map((area) => `${area.row.id}:${area.access}`)
        .concat(shares)
        .sort()
        .join('|'),
    )
    .digest('base64url')
    .slice(0, 16);

/** The database's clock, a little behind: changes stamped before it are all to be seen. */
async function settledNow(db: Executor, workspaceId: string): Promise<string> {
  const [row] = await db
    .select({
      at: sql<string>`(clock_timestamp() - make_interval(secs => ${OVERLAP_SECONDS}))::text`,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw new Error('Workspace is gone');
  return row.at;
}

export async function syncChanges(
  deps: Pick<CloudDeps, 'db' | 'clock'>,
  userId: string,
  workspaceId: string,
  query: { cursor?: string; limit: number },
): Promise<CloudChanges> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const shares = await sharedView(deps.db, ctx, deps.clock.now());
  const view = viewOf(ctx, shares.key);
  const settled = await settledNow(deps.db, workspaceId);
  const given = decode(query.cursor);
  const tooOld =
    given !== null && Date.parse(given.t) < Date.parse(settled) - (CLOUD_REMOVED_DAYS / 2) * DAY_MS;
  const from: Cursor =
    given && given.v === view && !tooOld ? given : { t: START, id: '', v: view, s: settled };
  const reset = Boolean(query.cursor) && from !== given;
  /** On the way through everything nothing is told to drop: there is nothing held yet. */
  const whole = from.s !== undefined;

  const rows = await deps.db
    .select({
      node: cloudNodes,
      at: sql<string>`${cloudNodes.changedAt}::text`,
      sha256: cloudVersions.sha256,
    })
    .from(cloudNodes)
    .leftJoin(cloudVersions, eq(cloudVersions.id, cloudNodes.currentVersionId))
    .where(
      and(
        eq(cloudNodes.workspaceId, workspaceId),
        sql`(${cloudNodes.changedAt}, ${cloudNodes.id}) > (${from.t}::timestamptz, ${from.id})`,
      ),
    )
    .orderBy(asc(cloudNodes.changedAt), asc(cloudNodes.id))
    .limit(query.limit + 1);
  const more = rows.length > query.limit;
  const page = more ? rows.slice(0, query.limit) : rows;

  /** The caller's right on a file: where it lies, or a share on it or above – the stronger. */
  const accessOn = (node: CloudNodeRow) =>
    node.deletedAt
      ? null
      : strongerCloudAccess(baseAccess(ctx, node), shares.access.get(node.id) ?? null);
  const told = (node: CloudNodeRow, access: CloudAccess, sha256: string | null): CloudDriveNode => {
    // Seen only through a share it lies in „Geteilt“ – at its top, if the folder above is not shared.
    const own = baseAccess(ctx, node) !== null;
    const parentId =
      own || (node.parentId && shares.access.has(node.parentId)) ? node.parentId : null;
    return {
      id: node.id,
      rootId: own ? (node.areaId ?? 'mine') : 'shared',
      parentId,
      kind: node.kind,
      name: node.name,
      sizeBytes: node.sizeBytes,
      versionId: node.kind === 'file' ? node.currentVersionId : null,
      sha256: node.kind === 'file' ? sha256 : null,
      createdAt: node.createdAt.toISOString(),
      modifiedAt: node.updatedAt.toISOString(),
      canEdit: cloudAccessAtLeast(access, 'edit'),
    };
  };

  /** Could the caller see it at this place (area or own files, or in something shared)? */
  const seenAt = (place: {
    areaId: string | null;
    ownerId: string | null;
    parentId: string | null;
  }) =>
    baseAccess(ctx, place) !== null ||
    (place.parentId !== null && shares.access.has(place.parentId));
  /** Out of the caller's sight now: was it in it before – still where it lies, or where it left? */
  const sawBefore = (node: CloudNodeRow, deletedRootParent: string | null) =>
    seenAt(node) ||
    shares.access.has(node.id) ||
    (deletedRootParent !== null && shares.access.has(deletedRootParent)) ||
    seenAt({
      areaId: node.leftAreaId,
      ownerId: node.leftOwnerId,
      parentId: node.leftParentId,
    });
  /** Where what was deleted with it lay: deleted inside something shared, it was seen there. */
  const deletedRoots = [
    ...new Set(
      page.flatMap(({ node }) =>
        node.deletedRootId && node.deletedRootId !== node.id ? [node.deletedRootId] : [],
      ),
    ),
  ];
  const rootParents = new Map(
    !whole && deletedRoots.length
      ? (
          await deps.db
            .select({ id: cloudNodes.id, parentId: cloudNodes.parentId })
            .from(cloudNodes)
            .where(inArray(cloudNodes.id, deletedRoots))
        ).map((row) => [row.id, row.parentId])
      : [],
  );

  const nodes: CloudDriveNode[] = [];
  const removed: string[] = [];
  /** Another's own folders that changed: moved, what is in them changed sides unstamped. */
  const moved: string[] = [];
  /** … of which the caller saw where it lay: what is in them out of sight now goes. */
  const movedSeen = new Set<string>();
  for (const { node, sha256 } of page) {
    const access = accessOn(node);
    if (!whole && node.kind === 'folder' && !node.deletedAt && baseAccess(ctx, node) === null) {
      moved.push(node.id);
      if (sawBefore(node, null)) movedSeen.add(node.id);
    }
    if (!access) {
      const rootParent = node.deletedRootId ? (rootParents.get(node.deletedRootId) ?? null) : null;
      if (!whole && sawBefore(node, rootParent)) removed.push(node.id);
      continue;
    }
    nodes.push(told(node, access, sha256));
  }
  if (moved.length) {
    const unseen = moved.filter((id) => !movedSeen.has(id));
    const seenInside = await below(deps.db, [...movedSeen]);
    const inside = [...seenInside, ...(unseen.length ? await below(deps.db, unseen) : [])];
    const goes = new Set(seenInside.map((node) => node.id));
    const versions = inside.flatMap((node) => node.currentVersionId ?? []);
    const hashes = new Map(
      versions.length
        ? (
            await deps.db
              .select({ id: cloudVersions.id, sha256: cloudVersions.sha256 })
              .from(cloudVersions)
              .where(inArray(cloudVersions.id, versions))
          ).map((row) => [row.id, row.sha256])
        : [],
    );
    for (const node of inside) {
      const access = accessOn(node);
      if (access) nodes.push(told(node, access, hashes.get(node.currentVersionId ?? '') ?? null));
      else if (goes.has(node.id)) removed.push(node.id);
    }
  }

  let startOver = false;
  if (!whole) {
    const gone = await deps.db
      .select({
        id: cloudRemoved.nodeId,
        areaId: cloudRemoved.areaId,
        ownerId: cloudRemoved.ownerId,
        parentId: cloudRemoved.parentId,
        placeKnown: cloudRemoved.placeKnown,
      })
      .from(cloudRemoved)
      .where(
        and(
          eq(cloudRemoved.workspaceId, workspaceId),
          gt(cloudRemoved.removedAt, sql`${from.t}::timestamptz`),
        ),
      )
      .limit(REMOVED_AT_ONCE + 1);
    // More went than one answer tells: simpler to begin again than to page through them.
    if (gone.length > REMOVED_AT_ONCE) startOver = true;
    else removed.push(...gone.filter((row) => !row.placeKnown || seenAt(row)).map((row) => row.id));
  }
  if (startOver) {
    return syncChanges(deps, userId, workspaceId, { limit: query.limit }).then((fresh) => ({
      ...fresh,
      reset: true,
    }));
  }

  const last = page.at(-1);
  const next: Cursor =
    more && last
      ? { t: last.at, id: last.node.id, v: view, s: from.s }
      : // Through: from here on changes are told, beginning where the walk began.
        { t: whole ? (from.s ?? settled) : settled, id: '', v: view };
  return { cursor: encode(next), reset, more, roots: rootsOf(ctx, shares.beyond), nodes, removed };
}

/** The hourly tidy-up: what a computer no longer needs to be told. */
export async function sweepRemoved(deps: Pick<CloudDeps, 'db' | 'clock'>): Promise<void> {
  const before = new Date(deps.clock.now().getTime() - CLOUD_REMOVED_DAYS * DAY_MS);
  await deps.db.delete(cloudRemoved).where(lt(cloudRemoved.removedAt, before));
}
