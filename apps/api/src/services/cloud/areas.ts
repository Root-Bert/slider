import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import { CLOUD_AREA_MAX_DEPTH, type CloudArea, type CloudAreaMember } from '@slider/shared';
import {
  cloudAreaMembers,
  cloudAreas,
  cloudNodes,
  users,
  workspaceMembers,
  type CloudAreaRow,
} from '../../db/schema';
import { ApiError, badRequest, forbidden } from '../../http/errors';
import { ownerAuthor } from '../../authors';
import { fileBlobs } from './blobs';
import { deleteBlobs } from '../blob-deletions';
import { RANK, atLeast } from '../workspaces/roles';
import { cloudContext, requireArea, type CloudCtx, type CloudDeps } from './context';
import { recordEvent } from './events';
import { audienceShrank } from '../call-audience';
import type { AppDeps } from '../../deps';

/**
 * Areas („Bereiche“): a team's place in the workspace's files – a name, a colour, its people.
 * Members and admins found them; whoever founded one manages it, admins manage all.
 */

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('de-DE') === b.trim().toLocaleLowerCase('de-DE');

export async function toAreaDtos(
  deps: Pick<CloudDeps, 'db'>,
  ctx: CloudCtx,
  rows: readonly CloudAreaRow[],
): Promise<CloudArea[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [people, everyone, sizes] = await Promise.all([
    deps.db
      .select({ member: cloudAreaMembers, user: users, role: workspaceMembers.role })
      .from(cloudAreaMembers)
      .innerJoin(users, eq(users.id, cloudAreaMembers.userId))
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, cloudAreaMembers.userId),
          eq(workspaceMembers.workspaceId, ctx.workspaceId),
        ),
      )
      .where(inArray(cloudAreaMembers.areaId, ids))
      .orderBy(asc(cloudAreaMembers.createdAt)),
    // The workspace's own area: its people are the workspace's, nobody is named for it.
    rows.some((row) => row.root)
      ? deps.db
          .select({ user: users, role: workspaceMembers.role })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
          .orderBy(asc(users.name))
      : [],
    deps.db
      .select({
        areaId: cloudNodes.areaId,
        files: sql<number>`count(*) filter (where ${cloudNodes.kind} = 'file')::int`,
        bytes: sql<string | number | null>`sum(${cloudNodes.sizeBytes})`,
        activeAt: max(cloudNodes.updatedAt),
      })
      .from(cloudNodes)
      .where(and(inArray(cloudNodes.areaId, ids), isNull(cloudNodes.deletedAt)))
      .groupBy(cloudNodes.areaId),
  ]);
  const members = new Map<string, CloudAreaMember[]>();
  for (const row of people) {
    const list = members.get(row.member.areaId) ?? [];
    list.push({ ...ownerAuthor(row.user), title: row.member.title, role: row.role });
    members.set(row.member.areaId, list);
  }
  for (const row of rows) {
    if (!row.root) continue;
    members.set(
      row.id,
      everyone.map((each) => ({ ...ownerAuthor(each.user), title: null, role: each.role })),
    );
  }
  const size = new Map(sizes.map((row) => [row.areaId, row]));
  return rows.map((row) => {
    const used = size.get(row.id);
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      // Under an area the caller does not see it stands at the top.
      parentId: row.parentId && ctx.areas.get(row.parentId)?.access ? row.parentId : null,
      // The workspace's own is called as the workspace is (`cloudContext` reads that).
      name: (row.root && ctx.areas.get(row.id)?.row.name) || row.name,
      description: row.description,
      color: row.color,
      visibility: row.visibility,
      root: row.root,
      // Whoever leads comes first, as on an organisation chart.
      members: (members.get(row.id) ?? []).sort((a, b) => RANK[b.role] - RANK[a.role]),
      fileCount: Number(used?.files ?? 0),
      sizeBytes: Number(used?.bytes ?? 0),
      activeAt: used?.activeAt ? new Date(used.activeAt).toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      access: ctx.areas.get(row.id)?.access ?? 'view',
    };
  });
}

/** The areas open to the caller, in the side bar's order. */
export async function listAreas(deps: Pick<CloudDeps, 'db'>, ctx: CloudCtx): Promise<CloudArea[]> {
  const rows = [...ctx.areas.values()]
    .filter((area) => area.access)
    .map((area) => area.row)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'de'));
  return toAreaDtos(deps, ctx, rows);
}

export const canCreateAreas = (ctx: CloudCtx) => atLeast(ctx.role, 'member');

function assertFreeName(ctx: CloudCtx, name: string, exceptId?: string): void {
  for (const area of ctx.areas.values()) {
    // Only among the areas one sees: the answer must not tell that a hidden one has the name.
    if (area.access && area.row.id !== exceptId && sameName(area.row.name, name)) {
      throw new ApiError(409, 'bad_request', `Den Bereich „${area.row.name}“ gibt es schon.`);
    }
  }
}

export async function createArea(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
  input: Pick<CloudAreaRow, 'name' | 'description' | 'color' | 'visibility' | 'parentId'>,
): Promise<CloudArea> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  if (!canCreateAreas(ctx)) throw forbidden('Bereiche legen Mitglieder und Admins an.');
  assertFreeName(ctx, input.name);
  // Every area is the workspace's: under its own area means at the top.
  if (input.parentId && ctx.areas.get(input.parentId)?.row.root) {
    input = { ...input, parentId: null };
  }
  if (input.parentId) {
    // What lies under an area is its manager's to say, as its name and its people.
    if (requireArea(ctx, input.parentId).access !== 'manage') {
      throw forbidden('Unterbereiche legt an, wer den Bereich angelegt hat, oder ein Admin.');
    }
    let depth = 1;
    for (let at = ctx.areas.get(input.parentId)?.row; at; depth += 1) {
      at = at.parentId ? ctx.areas.get(at.parentId)?.row : undefined;
    }
    if (depth > CLOUD_AREA_MAX_DEPTH) {
      throw badRequest('Tiefer lassen sich Bereiche nicht schachteln.');
    }
  }
  const now = deps.clock.now();
  const position = Math.max(-1, ...[...ctx.areas.values()].map((area) => area.row.position)) + 1;
  const [row] = await deps.db
    .insert(cloudAreas)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      ...input,
      position,
      createdBy: userId,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('Area insert returned nothing');
  // Whoever founds it is its first person.
  await deps.db.insert(cloudAreaMembers).values({ areaId: row.id, userId, createdAt: now });
  await recordEvent(
    deps.db,
    {
      kind: 'area_created',
      actorId: userId,
      node: null,
      workspaceId,
      areaId: row.id,
      name: row.name,
    },
    now,
  );
  const fresh = await cloudContext(deps.db, workspaceId, userId);
  const [dto] = await toAreaDtos(deps, fresh, [row]);
  if (!dto) throw new Error('An area has no DTO');
  return dto;
}

async function loadArea(deps: CloudDeps, userId: string, areaId: string) {
  const [row] = await deps.db.select().from(cloudAreas).where(eq(cloudAreas.id, areaId));
  if (!row) throw badRequest('Diesen Bereich gibt es nicht (mehr).');
  const ctx = await cloudContext(deps.db, row.workspaceId, userId);
  const area = requireArea(ctx, areaId);
  if (area.access !== 'manage') {
    throw forbidden('Den Bereich ändert, wer ihn angelegt hat, oder ein Admin.');
  }
  return { row, ctx };
}

export async function updateArea(
  deps: CloudDeps,
  userId: string,
  areaId: string,
  input: Partial<Pick<CloudAreaRow, 'name' | 'description' | 'color' | 'visibility'>>,
): Promise<CloudArea> {
  const { row, ctx } = await loadArea(deps, userId, areaId);
  // The workspace's own: its colour and words can change, not what it is.
  if (
    row.root &&
    ((input.name !== undefined && input.name !== ctx.areas.get(areaId)?.row.name) ||
      (input.visibility !== undefined && input.visibility !== row.visibility))
  ) {
    throw badRequest('Der Bereich des Workspace heißt wie der Workspace und ist für alle darin.');
  }
  if (input.name !== undefined) assertFreeName(ctx, input.name, areaId);
  const [updated] = await deps.db
    .update(cloudAreas)
    .set(input)
    .where(eq(cloudAreas.id, areaId))
    .returning();
  if (!updated) throw new Error('Area update returned nothing');
  // For its people only: who no longer sees it is out of its channels' calls.
  if (input.visibility !== undefined && input.visibility !== row.visibility)
    audienceShrank(row.workspaceId);
  if (input.name !== undefined && !row.root && input.name !== row.name) {
    await recordEvent(
      deps.db,
      {
        kind: 'area_changed',
        actorId: userId,
        node: null,
        workspaceId: row.workspaceId,
        areaId,
        name: updated.name,
        detail: row.name,
      },
      deps.clock.now(),
    );
  }
  const fresh = await cloudContext(deps.db, row.workspaceId, userId);
  const [dto] = await toAreaDtos(deps, fresh, [updated]);
  if (!dto) throw new Error('An area has no DTO');
  return dto;
}

/** The area and every file in it, for good – the dialog says so and asks for its name. */
export async function deleteArea(deps: AppDeps, userId: string, areaId: string): Promise<void> {
  const { row } = await loadArea(deps, userId, areaId);
  if (row.root) throw badRequest('Der Bereich des Workspace lässt sich nicht löschen.');
  // Its files go for good – those of the areas under it are not asked about in the dialog.
  const [under] = await deps.db
    .select({ id: cloudAreas.id })
    .from(cloudAreas)
    .where(eq(cloudAreas.parentId, areaId))
    .limit(1);
  if (under) throw badRequest('Lösche zuerst die Unterbereiche dieses Bereichs.');
  const files = await deps.db
    .select({ id: cloudNodes.id })
    .from(cloudNodes)
    .where(and(eq(cloudNodes.areaId, areaId), eq(cloudNodes.kind, 'file')));
  const blobs = await fileBlobs(
    deps.db,
    row.workspaceId,
    files.map((file) => file.id),
  );
  // Loaded here: the agents' module reaches the files' (this one) as it loads.
  const { releaseAreaAgents } = await import('../cloud-agents');
  await releaseAreaAgents(deps, row);
  await deps.db.delete(cloudAreas).where(eq(cloudAreas.id, areaId));
  await deleteBlobs(deps, blobs);
}

/** The area's people, all of them at once; only members of the workspace can be named. */
export async function setAreaMembers(
  deps: CloudDeps,
  userId: string,
  areaId: string,
  members: readonly { userId: string; title: string | null }[],
): Promise<CloudArea> {
  const { row } = await loadArea(deps, userId, areaId);
  if (row.root) throw badRequest('Zum Bereich des Workspace gehören alle im Workspace.');
  const wanted = new Map(members.map((member) => [member.userId, member.title || null]));
  const inWorkspace = wanted.size
    ? await deps.db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, row.workspaceId),
            inArray(workspaceMembers.userId, [...wanted.keys()]),
          ),
        )
    : [];
  if (inWorkspace.length !== wanted.size) {
    throw badRequest('In einen Bereich kommen nur Personen aus dem Workspace.');
  }
  const now = deps.clock.now();
  const gone = await deps.db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(cloudAreaMembers)
      .where(eq(cloudAreaMembers.areaId, areaId));
    const gone = current.filter((each) => !wanted.has(each.userId)).map((each) => each.userId);
    if (gone.length) {
      await tx
        .delete(cloudAreaMembers)
        .where(and(eq(cloudAreaMembers.areaId, areaId), inArray(cloudAreaMembers.userId, gone)));
    }
    for (const [memberId, title] of wanted) {
      await tx
        .insert(cloudAreaMembers)
        .values({ areaId, userId: memberId, title, createdAt: now })
        .onConflictDoUpdate({
          target: [cloudAreaMembers.areaId, cloudAreaMembers.userId],
          set: { title },
        });
    }
    // Who came and who went, by name – told in the activity, and to agents that watch it.
    const had = new Set(current.map((each) => each.userId));
    const added = [...wanted.keys()].filter((each) => !had.has(each));
    if (added.length + gone.length > 0) {
      const names = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, [...added, ...gone]));
      const called = (ids: readonly string[]) =>
        ids.map((id) => names.find((each) => each.id === id)?.name ?? 'Jemand').join(', ');
      await recordEvent(
        tx,
        {
          kind: 'area_people',
          actorId: userId,
          node: null,
          workspaceId: row.workspaceId,
          areaId,
          name: row.name,
          detail: [
            added.length ? `dazu: ${called(added)}` : '',
            gone.length ? `nicht mehr: ${called(gone)}` : '',
          ]
            .filter(Boolean)
            .join('; '),
          groupKey: null,
        },
        now,
      );
    }
    return gone;
  });
  // Who went is out of its channels' calls too.
  if (gone.length > 0) audienceShrank(row.workspaceId);
  const fresh = await cloudContext(deps.db, row.workspaceId, userId);
  const [dto] = await toAreaDtos(deps, fresh, [row]);
  if (!dto) throw new Error('An area has no DTO');
  return dto;
}
