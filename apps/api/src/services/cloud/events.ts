import { AsyncLocalStorage } from 'node:async_hooks';
import { and, desc, eq, gt, inArray, isNull, lt, notInArray, or, type SQL } from 'drizzle-orm';
import type { CloudActivityQuery, CloudEvent, CloudEventKind, CloudNodeKind } from '@slider/shared';
import type { Executor } from '../../db/client';
import { cloudEvents, cloudNodes, type CloudEventRow, type CloudNodeRow } from '../../db/schema';
import {
  authorIn,
  authorsOf,
  cloudContext,
  loadNode,
  requireArea,
  type CloudDeps,
} from './context';

/**
 * „Aktivität“: what happened to the files, newest first – who put what where, renamed, shared,
 * deleted or brought back. Kept with the names as they were then. Several of a kind in one go
 * (twelve files dropped into a folder) are one line with a count.
 */

/** Events of one kind by one person in one place this close together fold into one. */
const FOLD_MS = 2 * 60_000;

/**
 * An agent at work: what happens inside is its own doing. Its events carry its id in their
 * `groupKey` (`agent:<id>|…`), so they fold among themselves only and the agent's watches can
 * tell them from what others did (`ownEvent`) – while it works and after the server started anew.
 */
const agentAtWork = new AsyncLocalStorage<string>();
export const asAgent = <T>(agentId: string, work: () => Promise<T>): Promise<T> =>
  agentAtWork.run(agentId, work);
/** Whether what runs right now is an agent's doing. */
export const agentWorks = (): boolean => agentAtWork.getStore() !== undefined;
const OWN = (agentId: string) => `agent:${agentId}|`;
/** Whether the agent did that itself. */
export const ownEvent = (agentId: string, event: Pick<CloudEventRow, 'groupKey'>): boolean =>
  event.groupKey?.startsWith(OWN(agentId)) ?? false;

export interface NewEvent {
  kind: CloudEventKind;
  actorId: string;
  /** The file or folder it is about; `null` for an area's own events. */
  node: Pick<
    CloudNodeRow,
    'id' | 'workspaceId' | 'areaId' | 'ownerId' | 'parentId' | 'kind'
  > | null;
  workspaceId: string;
  areaId?: string | null;
  name: string;
  detail?: string | null;
  /** Events with the same key fold; default: the node's folder. `null`: never folds. */
  groupKey?: string | null;
}

export async function recordEvent(db: Executor, event: NewEvent, now: Date): Promise<void> {
  const areaId = event.areaId ?? event.node?.areaId ?? null;
  const spaceOwnerId = areaId ? null : (event.node?.ownerId ?? event.actorId);
  const nodeKind: CloudNodeKind | null = event.node?.kind ?? null;
  const agentId = agentAtWork.getStore();
  const said =
    event.groupKey === undefined
      ? event.node
        ? `${event.kind}:${event.node.parentId ?? areaId ?? 'own'}`
        : null
      : event.groupKey;
  // An agent's: marked as its own, and one that never folds stays alone.
  const groupKey = agentId ? `${OWN(agentId)}${said ?? crypto.randomUUID()}` : said;
  if (groupKey) {
    const [last] = await db
      .select({ id: cloudEvents.id, more: cloudEvents.more })
      .from(cloudEvents)
      .where(
        and(
          eq(cloudEvents.workspaceId, event.workspaceId),
          eq(cloudEvents.actorId, event.actorId),
          eq(cloudEvents.groupKey, groupKey),
          gt(cloudEvents.createdAt, new Date(now.getTime() - FOLD_MS)),
        ),
      )
      .orderBy(desc(cloudEvents.createdAt))
      .limit(1);
    if (last) {
      await db
        .update(cloudEvents)
        .set({ more: last.more + 1, createdAt: now })
        .where(eq(cloudEvents.id, last.id));
      return;
    }
  }
  await db.insert(cloudEvents).values({
    id: crypto.randomUUID(),
    workspaceId: event.workspaceId,
    areaId,
    spaceOwnerId,
    nodeId: event.node?.id ?? null,
    actorId: event.actorId,
    kind: event.kind,
    name: event.name,
    nodeKind,
    detail: event.detail ?? null,
    groupKey,
    createdAt: now,
  });
}

export async function toEventDtos(
  db: Executor,
  rows: readonly CloudEventRow[],
): Promise<CloudEvent[]> {
  const authors = await authorsOf(
    db,
    rows.map((row) => row.actorId),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    at: row.createdAt.toISOString(),
    actor: authorIn(authors, row.actorId),
    areaId: row.areaId,
    nodeId: row.nodeId,
    name: row.name,
    nodeKind: row.nodeKind,
    detail: row.detail,
    more: row.more,
  }));
}

/** The newest events of one file or folder. */
export async function nodeEvents(db: Executor, nodeId: string, limit = 30): Promise<CloudEvent[]> {
  const rows = await db
    .select()
    .from(cloudEvents)
    .where(eq(cloudEvents.nodeId, nodeId))
    .orderBy(desc(cloudEvents.createdAt))
    .limit(limit);
  return toEventDtos(db, rows);
}

/**
 * `GET /workspaces/:id/cloud/activity`: of one file, of one area, or everything the caller may
 * see – the areas open to them and their own files.
 */
export async function listActivity(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
  query: { area?: string; node?: string; before?: string; limit: number },
): Promise<CloudEvent[]> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  // Who it was shared with is for those who could change that (as in a file's details).
  const notSharing = notInArray(cloudEvents.kind, [
    'shared',
    'unshared',
    'link_created',
    'link_removed',
  ]);
  let scope: SQL | undefined;
  // An event stays where it was recorded; a file since moved where the caller does not look
  // (a restricted area, someone's own files) takes its history along – gone for good: kept.
  const open = [...ctx.areas.values()].filter((area) => area.access);
  const stillSeen = or(
    isNull(cloudEvents.nodeId),
    and(isNull(cloudNodes.areaId), eq(cloudNodes.ownerId, userId)),
    open.length
      ? inArray(
          cloudNodes.areaId,
          open.map((area) => area.row.id),
        )
      : undefined,
  );
  if (query.node) {
    const { node, access } = await loadNode(deps, userId, query.node);
    scope = eq(cloudEvents.nodeId, node.id);
    if (access === 'view') scope = and(scope, notSharing);
  } else if (query.area) {
    const area = requireArea(ctx, query.area);
    scope = eq(cloudEvents.areaId, query.area);
    if (area.access === 'view') scope = and(scope, notSharing);
  } else {
    const changing = open.filter((area) => area.access !== 'view').map((area) => area.row.id);
    const looking = open.filter((area) => area.access === 'view').map((area) => area.row.id);
    const own = and(isNull(cloudEvents.areaId), eq(cloudEvents.spaceOwnerId, userId));
    scope = or(
      own,
      changing.length ? inArray(cloudEvents.areaId, changing) : undefined,
      looking.length ? and(inArray(cloudEvents.areaId, looking), notSharing) : undefined,
    );
  }
  const rows = await deps.db
    .select({ event: cloudEvents })
    .from(cloudEvents)
    .leftJoin(cloudNodes, eq(cloudNodes.id, cloudEvents.nodeId))
    .where(
      and(
        eq(cloudEvents.workspaceId, workspaceId),
        scope,
        query.node ? undefined : stillSeen,
        query.before ? lt(cloudEvents.createdAt, new Date(query.before)) : undefined,
      ),
    )
    .orderBy(desc(cloudEvents.createdAt))
    .limit(query.limit);
  return toEventDtos(
    deps.db,
    rows.map((row) => row.event),
  );
}

export type { CloudActivityQuery };
