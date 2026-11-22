import { and, eq, inArray } from 'drizzle-orm';
import {
  strongerCloudAccess,
  cloudAccessAtLeast,
  type Author,
  type CloudAccess,
  type WorkspaceRole,
} from '@slider/shared';
import type { Executor } from '../../db/client';
import {
  cloudAreaMembers,
  cloudAreas,
  cloudNodes,
  cloudShares,
  users,
  workspaces,
  type CloudAreaRow,
  type CloudNodeRow,
} from '../../db/schema';
import type { AppDeps } from '../../deps';
import { forbidden, notFound } from '../../http/errors';
import { ownerAuthor } from '../../authors';
import { atLeast, requireRole } from '../workspaces/roles';

/**
 * Cloud – who may do what with a workspace's files.
 *
 * An area gives everyone it is open to a right by their workspace role: admins manage, members
 * edit (and manage the areas they founded), reviewers and viewers read. One's own files
 * („Meine Dateien“, no area) are one's own alone – not even the workspace's admins see them.
 * A share adds to that, for the shared file or folder and everything in it. Nothing takes a
 * right away, so the strongest of them counts.
 */

export type CloudDeps = Pick<AppDeps, 'db' | 'storage' | 'clock' | 'log' | 'config'> &
  Partial<Pick<AppDeps, 'background' | 'materialPdf' | 'documentPdf'>>;

/** The largest file one upload may bring, unless the instance says otherwise. */
export const DEFAULT_CLOUD_MAX_FILE_BYTES = 5 * 1024 ** 3;
export const cloudMaxFileBytes = (config: AppDeps['config']) =>
  config.cloud?.maxFileBytes ?? DEFAULT_CLOUD_MAX_FILE_BYTES;
/**
 * Links for people outside the workspace: off unless the instance turns them on. Cloud is the
 * workspace's – who sees what follows from the workspace's roles, areas and shares by name.
 */
export const cloudPublicLinks = (config: AppDeps['config']) => config.cloud?.publicLinks === true;
/**
 * Sharing a file or folder with a person by hand: off unless the instance turns it on
 * (`CLOUD_SHARING=true`). Who sees what follows from the workspace's roles and areas. The shares
 * themselves stay, as what a presentation's access is mirrored in (`deck-places`).
 */
export const cloudSharing = (config: AppDeps['config']) => config.cloud?.sharing === true;
/**
 * `viewer` and `reviewer` look: everywhere they reach they see and load, nothing more – whatever
 * a share says – and they have no files of their own.
 */
export const looksOnly = (role: WorkspaceRole) => !atLeast(role, 'member');
export const noOwnFiles = () =>
  forbidden('Eigene Dateien haben Mitglieder und Admins des Workspace.');

export interface AreaEntry {
  row: CloudAreaRow;
  /** What the caller may do in it; `null`: it is not theirs to see. */
  access: CloudAccess | null;
  /** Named as one of its people. */
  member: boolean;
}

/** The caller in one workspace: their role and every area with their right in it. */
export interface CloudCtx {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  areas: Map<string, AreaEntry>;
}

export const nodeNotFound = () => notFound('Diese Datei gibt es nicht (mehr).');
export const areaNotFound = () => notFound('Diesen Bereich gibt es nicht (mehr).');
export const noEditRight = () => forbidden('Hier darfst du nur ansehen, nichts ändern.');

export function areaAccess(
  area: Pick<CloudAreaRow, 'visibility' | 'createdBy'>,
  role: WorkspaceRole,
  userId: string,
  member: boolean,
): CloudAccess | null {
  if (role === 'admin') return 'manage';
  if (area.visibility === 'members' && !member) return null;
  if (role === 'member') return area.createdBy === userId ? 'manage' : 'edit';
  return 'view';
}

/**
 * The workspace itself as an area, made the first time its files are looked at: every workspace
 * has one. Two asking at once make one – the second finds the first's.
 * Its name is the workspace's – read with the areas, so a renamed workspace needs nothing here.
 */
async function makeRootArea(db: Executor, workspaceId: string): Promise<CloudAreaRow> {
  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  await db
    .insert(cloudAreas)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      name: workspace?.name ?? 'Workspace',
      color: 'violet',
      visibility: 'workspace',
      // Before every area people made: they are listed under it.
      position: -2,
      root: true,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(cloudAreas)
    .where(and(eq(cloudAreas.workspaceId, workspaceId), eq(cloudAreas.root, true)));
  if (!row) throw new Error('The workspace has no area of its own');
  return row;
}

/** Throws 404 for people outside the workspace (`requireRole`). */
export async function cloudContext(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<CloudCtx> {
  const role = await requireRole(db, workspaceId, userId);
  const [found, mine] = await Promise.all([
    db
      .select({ area: cloudAreas, workspace: workspaces.name })
      .from(cloudAreas)
      .innerJoin(workspaces, eq(workspaces.id, cloudAreas.workspaceId))
      .where(eq(cloudAreas.workspaceId, workspaceId)),
    db
      .select({ areaId: cloudAreaMembers.areaId })
      .from(cloudAreaMembers)
      .innerJoin(cloudAreas, eq(cloudAreas.id, cloudAreaMembers.areaId))
      .where(and(eq(cloudAreas.workspaceId, workspaceId), eq(cloudAreaMembers.userId, userId))),
  ]);
  // The workspace's own area is called as the workspace is now.
  const areaRows = found.map(({ area, workspace }) =>
    area.root ? { ...area, name: workspace } : area,
  );
  if (!areaRows.some((row) => row.root)) areaRows.push(await makeRootArea(db, workspaceId));
  const memberOf = new Set(mine.map((row) => row.areaId));
  const areas = new Map<string, AreaEntry>();
  for (const row of areaRows) {
    const member = memberOf.has(row.id);
    areas.set(row.id, { row, member, access: areaAccess(row, role, userId, member) });
  }
  return { workspaceId, userId, role, areas };
}

/** The area, if the caller may at least `min` in it. */
export function requireArea(ctx: CloudCtx, areaId: string, min: CloudAccess = 'view'): AreaEntry {
  const entry = ctx.areas.get(areaId);
  if (!entry?.access) throw areaNotFound();
  if (!cloudAccessAtLeast(entry.access, min)) throw noEditRight();
  return entry;
}

/** The folders above `node`, nearest first, up to the top of its area or its owner's files. */
export async function ancestorsOf(
  db: Executor,
  node: Pick<CloudNodeRow, 'parentId'>,
): Promise<CloudNodeRow[]> {
  const chain: CloudNodeRow[] = [];
  let parentId = node.parentId;
  // A loop in the tree cannot be made (`moveNodes` refuses it); the bound is the second line.
  for (let depth = 0; parentId && depth < 64; depth++) {
    const [parent] = await db.select().from(cloudNodes).where(eq(cloudNodes.id, parentId));
    if (!parent) break;
    chain.push(parent);
    parentId = parent.parentId;
  }
  return chain;
}

/** What where it lies gives the caller, shares aside. */
export function baseAccess(
  ctx: CloudCtx,
  node: Pick<CloudNodeRow, 'areaId' | 'ownerId'>,
): CloudAccess | null {
  if (node.areaId) return ctx.areas.get(node.areaId)?.access ?? null;
  return node.ownerId === ctx.userId && !looksOnly(ctx.role) ? 'manage' : null;
}

/** The caller's shares on these nodes, by node: what each gives. */
export async function sharedAccess(
  db: Executor,
  ctx: Pick<CloudCtx, 'userId' | 'role'>,
  nodeIds: readonly string[],
  now: Date,
): Promise<Map<string, CloudAccess>> {
  const result = new Map<string, CloudAccess>();
  if (nodeIds.length === 0) return result;
  const rows = await db
    .select({
      nodeId: cloudShares.nodeId,
      role: cloudShares.role,
      expiresAt: cloudShares.expiresAt,
    })
    .from(cloudShares)
    .where(
      and(
        eq(cloudShares.kind, 'user'),
        eq(cloudShares.userId, ctx.userId),
        inArray(cloudShares.nodeId, [...nodeIds]),
      ),
    );
  for (const row of rows) {
    if (row.expiresAt && row.expiresAt <= now) continue;
    const role = looksOnly(ctx.role) ? 'view' : row.role;
    const merged = strongerCloudAccess(result.get(row.nodeId) ?? null, role);
    if (merged) result.set(row.nodeId, merged);
  }
  return result;
}

export interface NodeAccess {
  access: CloudAccess | null;
  /** The folders above it, nearest first. */
  chain: CloudNodeRow[];
  /**
   * Reached only through a share: the shared file or folder (itself or one above). The folders
   * above that one are not the caller's to see – not even their names.
   */
  sharedRoot: CloudNodeRow | null;
}

/** The caller's right on `node`: where it lies, and the shares on it and on the folders above. */
export async function accessOf(
  db: Executor,
  ctx: CloudCtx,
  node: CloudNodeRow,
  now: Date,
): Promise<NodeAccess> {
  const chain = await ancestorsOf(db, node);
  const base = baseAccess(ctx, node);
  if (base === 'manage') return { access: base, chain, sharedRoot: null };
  const line = [node, ...chain];
  const shares = await sharedAccess(
    db,
    ctx,
    line.map((each) => each.id),
    now,
  );
  let shared: CloudAccess | null = null;
  let sharedRoot: CloudNodeRow | null = null;
  for (const each of line) {
    const role = shares.get(each.id);
    if (!role) continue;
    shared = strongerCloudAccess(shared, role);
    // The outermost shared one is where the caller's view begins.
    sharedRoot = each;
  }
  return {
    access: strongerCloudAccess(base, shared),
    chain,
    sharedRoot: base ? null : sharedRoot,
  };
}

export interface LoadedNode extends NodeAccess {
  node: CloudNodeRow;
  ctx: CloudCtx;
  access: CloudAccess;
}

/**
 * The file or folder with the caller's right on it, or throws: 404 when it is not theirs to
 * see (or deleted, unless `deleted` asks for those), 403 below `min`.
 */
export async function loadNode(
  deps: Pick<CloudDeps, 'db' | 'clock'>,
  userId: string,
  nodeId: string,
  min: CloudAccess = 'view',
  { deleted = false }: { deleted?: boolean } = {},
): Promise<LoadedNode> {
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
  if (!node) throw nodeNotFound();
  // 404 for people outside the workspace, as for a file that is not there.
  const ctx = await cloudContext(deps.db, node.workspaceId, userId).catch((error: unknown) => {
    if (error instanceof Error && 'status' in error && error.status === 404) throw nodeNotFound();
    throw error;
  });
  if (Boolean(node.deletedAt) !== deleted) throw nodeNotFound();
  const found = await accessOf(deps.db, ctx, node, deps.clock.now());
  if (!found.access) throw nodeNotFound();
  if (!cloudAccessAtLeast(found.access, min)) throw noEditRight();
  return { ...found, access: found.access, node, ctx };
}

// ── People ──────────────────────────────────────────────────────────────────

/** Whoever's account is gone: their files and versions stay, without a name. */
export const GONE_AUTHOR: Author = {
  id: 'deleted',
  name: 'Gelöschtes Konto',
  type: 'deleted',
  color: 'deleted',
};

/** Authors by account id, for the ids given (`null`s and unknown ids are left out). */
export async function authorsOf(
  db: Executor,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, Author>> {
  const wanted = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  const result = new Map<string, Author>();
  for (let at = 0; at < wanted.length; at += 500) {
    const rows = await db
      .select()
      .from(users)
      .where(inArray(users.id, wanted.slice(at, at + 500)));
    for (const row of rows) result.set(row.id, ownerAuthor(row));
  }
  return result;
}

export const authorIn = (authors: ReadonlyMap<string, Author>, id: string | null): Author =>
  (id && authors.get(id)) || GONE_AUTHOR;
