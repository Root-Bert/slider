import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type {
  CloudNodeDetail,
  CloudPerson,
  CloudPublic,
  CloudShare,
  CloudShareRole,
} from '@slider/shared';
import { cloudAccessAtLeast, cloudFileType } from '@slider/shared';
import { hashToken, newSecretToken } from '../../auth/session';
import {
  cloudAreaMembers,
  cloudNodes,
  cloudShares,
  users,
  workspaceMembers,
  workspaces,
  type CloudNodeRow,
  type CloudShareRow,
  type CloudVersionRow,
} from '../../db/schema';
import { ApiError, badRequest, forbidden } from '../../http/errors';
import { ownerAuthor } from '../../authors';
import { listMembers } from '../workspaces/members';
import { toAreaDtos } from './areas';
import {
  accessOf,
  ancestorsOf,
  authorIn,
  authorsOf,
  cloudContext,
  cloudPublicLinks,
  loadNode,
  type CloudDeps,
} from './context';
import { nodeEvents, recordEvent } from './events';
import { versionToServe, versionsOf } from './files';
import { nodeDto, touchRecent } from './nodes';
import { officePreviewable } from './pictures';
import { folderStats, live, siblingsIn } from './tree';

/**
 * Sharing a file or folder beyond where it lies: with someone of the workspace („Kann
 * ansehen“ / „Kann bearbeiten“), or by a link anyone holding it opens – to look and load, never
 * to change, until it expires or is taken back. Whoever may edit something may share it.
 */

export const shareUrl = (deps: Pick<CloudDeps, 'config'>, token: string) =>
  `${deps.config.webOrigin}/s/${token}`;

export async function toShareDtos(
  deps: Pick<CloudDeps, 'db' | 'config'>,
  rows: readonly CloudShareRow[],
): Promise<CloudShare[]> {
  const authors = await authorsOf(
    deps.db,
    rows.map((row) => row.createdBy),
  );
  const userIds = rows.map((row) => row.userId).filter((id): id is string => Boolean(id));
  const people = userIds.length
    ? await deps.db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const person = new Map(people.map((row) => [row.id, row]));
  return rows.map((row) => {
    const user = row.userId ? person.get(row.userId) : undefined;
    return {
      id: row.id,
      nodeId: row.nodeId,
      kind: row.kind,
      user: user ? { ...ownerAuthor(user), email: user.email } : null,
      role: row.role,
      url: row.kind === 'link' && row.token ? shareUrl(deps, row.token) : null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      opens: row.opens,
      createdAt: row.createdAt.toISOString(),
      createdBy: authorIn(authors, row.createdBy),
    };
  });
}

async function sharesOfNode(deps: CloudDeps, nodeId: string): Promise<CloudShare[]> {
  const rows = await deps.db
    .select()
    .from(cloudShares)
    .where(eq(cloudShares.nodeId, nodeId))
    .orderBy(desc(cloudShares.createdAt));
  return toShareDtos(deps, rows);
}

/** With a member of the workspace, or by link. A second share with the same person changes the first. */
export async function createShare(
  deps: CloudDeps,
  userId: string,
  nodeId: string,
  input: { userId: string; role: CloudShareRole } | { link: true; expiresAt: string | null },
): Promise<CloudShare> {
  const { node } = await loadNode(deps, userId, nodeId, 'edit');
  const now = deps.clock.now();
  let row: CloudShareRow | undefined;
  if ('link' in input) {
    if (!cloudPublicLinks(deps.config)) {
      throw badRequest('Links nach außen gibt es hier nicht. Teile mit Personen im Workspace.');
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= now)
      throw badRequest('Das Ablaufdatum liegt in der Vergangenheit.');
    const [existing] = await deps.db
      .select()
      .from(cloudShares)
      .where(and(eq(cloudShares.nodeId, node.id), eq(cloudShares.kind, 'link')));
    if (existing) {
      // Its maker may no longer share it: the one asking now stands for it from here on.
      const maker = (await linkerMay(deps, existing.createdBy, node)) ? existing.createdBy : userId;
      [row] = await deps.db
        .update(cloudShares)
        .set({ expiresAt, createdBy: maker })
        .where(eq(cloudShares.id, existing.id))
        .returning();
    } else {
      const token = newSecretToken();
      [row] = await deps.db
        .insert(cloudShares)
        .values({
          id: crypto.randomUUID(),
          workspaceId: node.workspaceId,
          nodeId: node.id,
          kind: 'link',
          role: 'view',
          tokenHash: hashToken(token),
          token,
          expiresAt,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      await recordEvent(
        deps.db,
        {
          kind: 'link_created',
          actorId: userId,
          node,
          workspaceId: node.workspaceId,
          name: node.name,
          groupKey: null,
        },
        now,
      );
    }
  } else {
    if (input.userId === userId) throw badRequest('Mit dir selbst musst du nichts teilen.');
    const [person] = await deps.db
      .select({ name: users.name })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, node.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      );
    if (!person) throw badRequest('Teilen geht mit Personen aus dem Workspace.');
    const [existing] = await deps.db
      .select()
      .from(cloudShares)
      .where(
        and(
          eq(cloudShares.nodeId, node.id),
          eq(cloudShares.kind, 'user'),
          eq(cloudShares.userId, input.userId),
        ),
      );
    if (existing) {
      [row] = await deps.db
        .update(cloudShares)
        .set({ role: input.role })
        .where(eq(cloudShares.id, existing.id))
        .returning();
    } else {
      [row] = await deps.db
        .insert(cloudShares)
        .values({
          id: crypto.randomUUID(),
          workspaceId: node.workspaceId,
          nodeId: node.id,
          kind: 'user',
          userId: input.userId,
          role: input.role,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      await recordEvent(
        deps.db,
        {
          kind: 'shared',
          actorId: userId,
          node,
          workspaceId: node.workspaceId,
          name: node.name,
          detail: person.name,
          groupKey: null,
        },
        now,
      );
    }
  }
  if (!row) throw new Error('Share returned nothing');
  forgetLinkers();
  const [dto] = await toShareDtos(deps, [row]);
  if (!dto) throw new Error('A share has no DTO');
  return dto;
}

async function loadShare(deps: CloudDeps, userId: string, shareId: string) {
  const [share] = await deps.db.select().from(cloudShares).where(eq(cloudShares.id, shareId));
  if (!share) throw new ApiError(404, 'not_found', 'Diese Freigabe gibt es nicht (mehr).');
  const { node } = await loadNode(deps, userId, share.nodeId, 'edit');
  return { share, node };
}

export async function updateShare(
  deps: CloudDeps,
  userId: string,
  shareId: string,
  input: { role?: CloudShareRole; expiresAt?: string | null },
): Promise<CloudShare> {
  const { share } = await loadShare(deps, userId, shareId);
  // Who it is given to may edit through it, not make it last longer or reach further.
  if (share.userId === userId)
    throw forbidden('Deine eigene Freigabe ändert, wer sie gegeben hat.');
  const expiresAt =
    input.expiresAt === undefined ? undefined : input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt <= deps.clock.now()) {
    throw badRequest('Das Ablaufdatum liegt in der Vergangenheit.');
  }
  const [row] = await deps.db
    .update(cloudShares)
    .set({
      // A link only ever lets people look.
      ...(input.role && share.kind === 'user' ? { role: input.role } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    })
    .where(eq(cloudShares.id, share.id))
    .returning();
  forgetLinkers();
  const [dto] = await toShareDtos(deps, row ? [row] : [share]);
  if (!dto) throw new Error('A share has no DTO');
  return dto;
}

/** Ends it at once: the person no longer reaches it, the link opens nothing. */
/** Returns the file or folder it was on. */
export async function removeShare(
  deps: CloudDeps,
  userId: string,
  shareId: string,
): Promise<string> {
  const { share, node } = await loadShare(deps, userId, shareId);
  await deps.db.delete(cloudShares).where(eq(cloudShares.id, share.id));
  forgetLinkers();
  const [person] = share.userId
    ? await deps.db.select({ name: users.name }).from(users).where(eq(users.id, share.userId))
    : [];
  await recordEvent(
    deps.db,
    {
      kind: share.kind === 'link' ? 'link_removed' : 'unshared',
      actorId: userId,
      node,
      workspaceId: node.workspaceId,
      name: node.name,
      detail: person?.name ?? null,
      groupKey: null,
    },
    deps.clock.now(),
  );
  return node.id;
}

/** The people of the workspace, to share with or to put into an area. */
export async function listPeople(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
): Promise<CloudPerson[]> {
  const members = await listMembers(deps.db, userId, workspaceId);
  return members.map((member) => ({
    id: member.userId,
    name: member.name,
    type: 'owner' as const,
    color: member.color,
    email: member.email,
    role: member.role,
  }));
}

/** New shares with the caller they have not looked at yet – the number beside „Geteilt“. */
/** Something is shared with the caller or by them: „Geteilt“ has something in it. */
export async function anyShares(
  deps: Pick<CloudDeps, 'db'>,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await deps.db
    .select({ id: cloudShares.id })
    .from(cloudShares)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudShares.nodeId))
    .where(
      and(
        eq(cloudShares.kind, 'user'),
        eq(cloudShares.workspaceId, workspaceId),
        or(eq(cloudShares.userId, userId), eq(cloudShares.createdBy, userId)),
        live,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function unseenShares(
  deps: Pick<CloudDeps, 'db'>,
  userId: string,
  workspaceId: string,
): Promise<number> {
  const [row] = await deps.db
    .select({ count: sql<number>`count(*)::int` })
    .from(cloudShares)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudShares.nodeId))
    .where(
      and(
        eq(cloudShares.kind, 'user'),
        eq(cloudShares.userId, userId),
        eq(cloudShares.workspaceId, workspaceId),
        sql`${cloudShares.seenAt} is null`,
        live,
      ),
    );
  return Number(row?.count ?? 0);
}

// ── One file, opened ────────────────────────────────────────────────────────

/** `GET /cloud/nodes/:id`: the file with its versions, its shares and what happened to it. */
export async function nodeDetail(
  deps: CloudDeps,
  userId: string,
  nodeId: string,
): Promise<CloudNodeDetail> {
  const { node, ctx, access, chain, sharedRoot } = await loadNode(deps, userId, nodeId);
  if (node.kind === 'file') await touchRecent(deps.db, userId, node.id, deps.clock.now());
  const line = [...chain].reverse();
  const from = sharedRoot ? line.findIndex((each) => each.id === sharedRoot.id) : 0;
  // Reached through a share on the file itself: none of the folders above is the caller's to see.
  const path = (from < 0 ? [] : line.slice(from)).map((each) => ({ id: each.id, name: each.name }));
  const area = node.areaId && !sharedRoot ? ctx.areas.get(node.areaId) : undefined;
  const [areaDto] = area ? await toAreaDtos(deps, ctx, [area.row]) : [];
  let audience: CloudNodeDetail['audience'] = { kind: 'owner', count: 1 };
  if (area) {
    if (area.row.visibility === 'workspace') {
      const [row] = await deps.db
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, node.workspaceId));
      audience = { kind: 'workspace', count: Number(row?.count ?? 0) };
    } else {
      const [row] = await deps.db
        .select({ count: sql<number>`count(*)::int` })
        .from(cloudAreaMembers)
        .where(eq(cloudAreaMembers.areaId, area.row.id));
      audience = { kind: 'area', count: Number(row?.count ?? 0) };
    }
  }
  return {
    node: await nodeDto(deps, ctx, node, access),
    area: areaDto ?? null,
    path,
    versions: node.kind === 'file' ? await versionsOf(deps, node) : [],
    // Who else has it is for those who could change that.
    shares: access === 'view' ? [] : await sharesOfNode(deps, node.id),
    audience,
    // Nor who it was shared with, in what happened to it.
    events: (await nodeEvents(deps.db, node.id)).filter(
      (event) => access !== 'view' || !SHARING_EVENTS.has(event.kind),
    ),
    officePreview: officePreviewable(deps, node.name),
  };
}

// ── A link, opened by someone outside ───────────────────────────────────────

const linkGone = () =>
  new ApiError(
    410,
    'link_revoked',
    'Dieser Link führt nirgends (mehr) hin. Frag nach einem neuen.',
  );

const SHARING_EVENTS = new Set(['shared', 'unshared', 'link_created', 'link_removed']);

/**
 * {@link linkerMay}'s answers for links, by share – a folder's link asks with every thumbnail.
 * Kept a few seconds; whatever changes a share forgets them all at once.
 */
const LINKER_MS = 5_000;
const linkers = new Map<string, { userId: string | null; may: boolean; until: number }>();
const forgetLinkers = () => linkers.clear();

async function linkerMayCached(deps: CloudDeps, share: CloudShareRow, node: CloudNodeRow) {
  const now = deps.clock.now().getTime();
  const known = linkers.get(share.id);
  if (known && known.userId === share.createdBy && known.until > now) return known.may;
  const may = await linkerMay(deps, share.createdBy, node);
  if (linkers.size >= 1000) linkers.clear();
  linkers.set(share.id, { userId: share.createdBy, may, until: now + LINKER_MS });
  return may;
}

/**
 * Whether who made a link may still share what it opens: in the workspace and able to change
 * it. Gone from the workspace, or left with looking only, their links open nothing any more.
 */
async function linkerMay(
  deps: CloudDeps,
  userId: string | null,
  node: CloudNodeRow,
): Promise<boolean> {
  // Their account deleted: nobody stands for the link.
  if (!userId) return false;
  try {
    const ctx = await cloudContext(deps.db, node.workspaceId, userId);
    const { access } = await accessOf(deps.db, ctx, node, deps.clock.now());
    return cloudAccessAtLeast(access, 'edit');
  } catch (error) {
    if (error instanceof ApiError) return false;
    throw error;
  }
}

/** The share and what it shares, for a link's token – or throws 410. */
async function resolveLink(deps: CloudDeps, token: string) {
  // Turned off: links made while they were on open nothing either.
  if (!cloudPublicLinks(deps.config)) throw linkGone();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw linkGone();
  const [found] = await deps.db
    .select({ share: cloudShares, root: cloudNodes })
    .from(cloudShares)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudShares.nodeId))
    .where(and(eq(cloudShares.tokenHash, hashToken(token)), eq(cloudShares.kind, 'link')));
  if (!found || found.root.deletedAt) throw linkGone();
  if (found.share.expiresAt && found.share.expiresAt <= deps.clock.now()) {
    throw new ApiError(410, 'link_expired', 'Dieser Link ist abgelaufen. Frag nach einem neuen.');
  }
  if (!(await linkerMayCached(deps, found.share, found.root))) throw linkGone();
  return found;
}

/** The root itself, or something in it – never anything beside or above it. */
async function withinLink(
  deps: CloudDeps,
  root: CloudNodeRow,
  nodeId: string | undefined,
): Promise<{ node: CloudNodeRow; path: CloudNodeRow[] }> {
  if (!nodeId || nodeId === root.id) return { node: root, path: [] };
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
  if (!node || node.deletedAt) throw linkGone();
  const chain = await ancestorsOf(deps.db, node);
  const at = chain.findIndex((each) => each.id === root.id);
  if (at < 0) throw linkGone();
  return { node, path: chain.slice(0, at).reverse() };
}

const publicNode = (row: CloudNodeRow, stats?: { bytes: number }) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  fileType: row.kind === 'file' ? cloudFileType(row.name, row.mimeType) : null,
  sizeBytes: stats ? stats.bytes : row.sizeBytes,
  updatedAt: row.updatedAt.toISOString(),
  versionId: row.currentVersionId,
  thumbnail: row.thumbnail === 'ready',
});

/** What a link shows: the shared file, or the shared folder (or one inside) with what is in it. */
export async function publicView(
  deps: CloudDeps,
  token: string,
  nodeId?: string,
): Promise<CloudPublic> {
  const { share, root } = await resolveLink(deps, token);
  const { node, path } = await withinLink(deps, root, nodeId);
  if (!nodeId) {
    await deps.db
      .update(cloudShares)
      .set({ opens: share.opens + 1 })
      .where(eq(cloudShares.id, share.id));
  }
  const children =
    node.kind === 'folder'
      ? await siblingsIn(deps.db, {
          workspaceId: node.workspaceId,
          areaId: node.areaId,
          ownerId: node.ownerId,
          parentId: node.id,
        })
      : [];
  const stats = await folderStats(
    deps.db,
    [node, ...children].filter((each) => each.kind === 'folder').map((each) => each.id),
  );
  const [workspace] = await deps.db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, root.workspaceId));
  const authors = await authorsOf(deps.db, [share.createdBy]);
  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  return {
    workspaceName: workspace?.name ?? '',
    sharedBy: authorIn(authors, share.createdBy).name,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    root: { id: root.id, name: root.name, kind: root.kind },
    node: publicNode(node, stats.get(node.id)),
    path: [...(node.id === root.id ? [] : [root]), ...path]
      .filter((each) => each.id !== node.id)
      .map((each) => ({ id: each.id, name: each.name })),
    children: children
      .sort((a, b) =>
        a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'folder' ? -1 : 1,
      )
      .map((child) => publicNode(child, stats.get(child.id))),
  };
}

/** A file behind a link, with the version to serve. */
export async function publicFile(
  deps: CloudDeps,
  token: string,
  nodeId: string | undefined,
): Promise<{ node: CloudNodeRow; version: CloudVersionRow }> {
  const { root } = await resolveLink(deps, token);
  const { node } = await withinLink(deps, root, nodeId);
  return { node, version: await versionToServe(deps, node) };
}

/** A file or folder behind a link – for its ZIP. */
export async function publicNodeRow(
  deps: CloudDeps,
  token: string,
  nodeId: string | undefined,
): Promise<CloudNodeRow> {
  const { root } = await resolveLink(deps, token);
  return (await withinLink(deps, root, nodeId)).node;
}
