import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNotNull,
  lt,
  min,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  INSTANCE_PAGE_SIZE,
  intervalMs,
  stretchMs,
  type InstanceBucket,
  type InstanceHistory,
  type InstanceListQuery,
  type InstanceOverview,
  type InstanceTimeline,
  type InstanceTimelineQuery,
  type InstanceUser,
  type InstanceUserList,
  type InstanceWorkspace,
  type InstanceWorkspaceList,
  type PlanId,
} from '@slider/shared';
import type { Viewer } from '@slider/shared';
import type { Executor } from '../db/client';
import {
  decks,
  sessions,
  users,
  workspaceMembers,
  workspaces,
  type WorkspaceRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, forbidden, notFound } from '../http/errors';
import { fileUrl } from '../storage/blob-storage';
import { isPaying } from './billing-owner';
import { countBy } from './plans';
import { DAY_MS } from './retention-rules';
import { emptyBreakdown, totalBytes, workspaceStorage } from './workspace-storage';

/**
 * The instance admin's dashboard (BER-167): how big the instance is, and the accounts and
 * organisations on it – to block them, or to put an organisation on the paid plan without Stripe
 * (paid by invoice, a partner). Organisations show sizes only, never what is in them.
 */

type AdminDeps = Pick<AppDeps, 'db' | 'config' | 'clock' | 'log'>;

/** Whether the caller is the instance admin (`users.is_instance_admin`). */
export async function isInstanceAdmin(db: Executor, viewer: Viewer | null): Promise<boolean> {
  if (viewer?.kind !== 'owner') return false;
  const [row] = await db
    .select({ admin: users.isInstanceAdmin })
    .from(users)
    .where(eq(users.id, viewer.author.id));
  return row?.admin === true;
}

/** Throws unless the caller is the instance admin. */
export async function requireInstanceAdmin(
  db: Executor,
  viewer: Viewer,
  message = 'Das darf nur der Instanz-Admin.',
): Promise<void> {
  if (!(await isInstanceAdmin(db, viewer))) throw forbidden(message);
}

/** Organisations can be put on a plan only where the plans differ in anything. */
const plansDiffer = (config: AppDeps['config']) =>
  JSON.stringify(config.plans.free) !== JSON.stringify(config.plans.paid);

/** "Active" on the tiles; the activity bar adds a week and a quarter. */
const ACTIVE_DAYS = 30;

/** At most this many stretches on the history strip. */
const HISTORY_STRETCHES = 200;
/** The strip reaches back at least this far, also on a young instance. */
const HISTORY_MIN_DAYS = 31;

/** Organisations listed as the largest. */
const LARGEST = 5;

/** `count(*) filter (where …)` – several counts of one table in one query. */
const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})::int`;

async function firstAccountAt(db: Executor): Promise<Date | null> {
  const [row] = await db.select({ first: min(users.createdAt) }).from(users);
  return row?.first ?? null;
}

/** Rows created in `[start, end)`, per stretch (0 = oldest). */
async function createdPerBucket(
  db: Executor,
  column: typeof users.createdAt | typeof workspaces.createdAt | typeof decks.createdAt,
  start: Date,
  end: Date,
  bucketMs: number,
): Promise<Map<number, number>> {
  // Raw SQL takes the time as text: the postgres-js driver can't send a Date there (PGlite can).
  const bucket = sql<number>`floor(extract(epoch from (${column} - ${start.toISOString()}::timestamptz)) * 1000 / ${bucketMs})::int`;
  const rows = await db
    .select({ bucket, count: count() })
    .from(column.table)
    .where(and(gte(column, start), lt(column, end)))
    // By position: the parameters make the expression a different one in `group by`.
    .groupBy(sql`1`);
  return new Map(rows.map((row) => [Number(row.bucket), row.count]));
}

/** Accounts, organisations and reviews created per stretch of `[start, start + n × stretch)`. */
async function timelineOf(
  db: Executor,
  start: Date,
  stretchMs: number,
  stretches: number,
): Promise<InstanceBucket[]> {
  const end = new Date(start.getTime() + stretches * stretchMs);
  const [newUsers, newWorkspaces, newDecks] = await Promise.all([
    createdPerBucket(db, users.createdAt, start, end, stretchMs),
    createdPerBucket(db, workspaces.createdAt, start, end, stretchMs),
    createdPerBucket(db, decks.createdAt, start, end, stretchMs),
  ]);
  return Array.from({ length: stretches }, (_, index) => ({
    start: new Date(start.getTime() + index * stretchMs).toISOString(),
    users: newUsers.get(index) ?? 0,
    workspaces: newWorkspaces.get(index) ?? 0,
    decks: newDecks.get(index) ?? 0,
  }));
}

/**
 * Everything since the first account – at least {@link HISTORY_MIN_DAYS} back – in whole-day
 * stretches, at most {@link HISTORY_STRETCHES}, ending now: the strip the window slides over.
 */
export async function instanceHistory(deps: AdminDeps): Promise<InstanceHistory> {
  const now = deps.clock.now().getTime();
  const first = (await firstAccountAt(deps.db))?.getTime() ?? now;
  const days = Math.max(HISTORY_MIN_DAYS, Math.ceil((now - first) / DAY_MS));
  const stretchDays = Math.max(1, Math.ceil(days / HISTORY_STRETCHES));
  const stretches = Math.ceil(days / stretchDays);
  const from = new Date(now - stretches * stretchDays * DAY_MS);
  return {
    from: from.toISOString(),
    to: new Date(now).toISOString(),
    stretchDays,
    buckets: await timelineOf(deps.db, from, stretchDays * DAY_MS, stretches),
  };
}

/**
 * What was created in the window of `interval` ending at `to` (now without it), in the interval's
 * stretches. The browser ends a window on a full hour or at midnight, so `to` may lie a little
 * ahead: the stretches still to come are empty.
 */
export async function instanceTimeline(
  deps: AdminDeps,
  { interval, to }: InstanceTimelineQuery,
): Promise<InstanceTimeline> {
  const end = to ? Date.parse(to) : deps.clock.now().getTime();
  const start = new Date(end - intervalMs(interval));
  const step = stretchMs(interval);
  return {
    from: start.toISOString(),
    to: new Date(end).toISOString(),
    buckets: await timelineOf(deps.db, start, step, Math.round(intervalMs(interval) / step)),
  };
}

/** The instance as it is now: counts, storage and the largest organisations. */
export async function instanceOverview(deps: AdminDeps): Promise<InstanceOverview> {
  const now = deps.clock.now().getTime();
  const ago = (days: number) => new Date(now - days * DAY_MS);
  const [[people], [orgs], [deckCount], all] = await Promise.all([
    deps.db
      .select({
        total: count(),
        active: countWhere(gt(users.lastActiveAt, ago(ACTIVE_DAYS))),
        activeWeek: countWhere(gt(users.lastActiveAt, ago(7))),
        activeQuarter: countWhere(gt(users.lastActiveAt, ago(90))),
        blocked: countWhere(isNotNull(users.blockedAt)),
      })
      .from(users),
    deps.db
      .select({
        total: count(),
        paid: countWhere(eq(workspaces.plan, 'paid')),
        granted: countWhere(isNotNull(workspaces.planGrantedAt)),
        blocked: countWhere(isNotNull(workspaces.blockedAt)),
      })
      .from(workspaces),
    deps.db.select({ total: count() }).from(decks),
    deps.db
      .select({ id: workspaces.id, name: workspaces.name, logoKey: workspaces.logoKey })
      .from(workspaces),
  ]);
  const storage = await workspaceStorage(
    deps.db,
    all.map((row) => row.id),
  );
  const sum = emptyBreakdown();
  for (const part of storage.values()) {
    for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += part[key];
  }
  const largest = all
    .map((row) => {
      const files = storage.get(row.id);
      return { ...row, storageBytes: files ? totalBytes(files) : 0 };
    })
    .filter((row) => row.storageBytes > 0)
    .sort((a, b) => b.storageBytes - a.storageBytes || a.name.localeCompare(b.name, 'de'))
    .slice(0, LARGEST)
    .map((row) => ({
      id: row.id,
      name: row.name,
      logoUrl: row.logoKey ? fileUrl(row.logoKey) : null,
      storageBytes: row.storageBytes,
    }));
  return {
    users: {
      total: people?.total ?? 0,
      active: people?.active ?? 0,
      activeWeek: people?.activeWeek ?? 0,
      activeQuarter: people?.activeQuarter ?? 0,
      blocked: people?.blocked ?? 0,
    },
    workspaces: {
      total: orgs?.total ?? 0,
      paid: orgs?.paid ?? 0,
      granted: orgs?.granted ?? 0,
      blocked: orgs?.blocked ?? 0,
    },
    decks: deckCount?.total ?? 0,
    largest,
    storage: sum,
    plans: plansDiffer(deps.config),
  };
}

/** `%`, `_` and `\` match themselves in the search. */
const containing = (q: string) => `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

// ── Accounts ────────────────────────────────────────────────────────────────

const workspaceCount = sql<number>`(select count(*) from ${workspaceMembers} where ${workspaceMembers.userId} = ${users.id})::int`;

function toInstanceUser(row: {
  user: typeof users.$inferSelect;
  workspaceCount: number;
}): InstanceUser {
  const { user } = row;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    color: user.color,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt.toISOString(),
    workspaceCount: row.workspaceCount,
    isInstanceAdmin: user.isInstanceAdmin,
    blockedAt: user.blockedAt?.toISOString() ?? null,
  };
}

export async function listInstanceUsers(
  { db }: AdminDeps,
  { q, offset }: InstanceListQuery,
): Promise<InstanceUserList> {
  const where = q
    ? or(ilike(users.name, containing(q)), ilike(users.email, containing(q)))
    : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select({ user: users, workspaceCount })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), users.id)
      .limit(INSTANCE_PAGE_SIZE)
      .offset(offset),
    db.select({ total: count() }).from(users).where(where),
  ]);
  return { users: rows.map(toInstanceUser), total: total?.total ?? 0 };
}

/**
 * Blocks or unblocks an account. Blocked, it signs in nowhere and its sessions end at once (open
 * live views notice within half a minute); data and memberships stay. Not the instance admin.
 */
export async function setUserBlocked(
  deps: AdminDeps,
  adminId: string,
  userId: string,
  blocked: boolean,
): Promise<InstanceUser> {
  if (userId === adminId) throw badRequest('Dein eigenes Konto kannst du nicht sperren.');
  const updated = await deps.db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user) throw notFound('Dieses Konto gibt es nicht (mehr).');
    if (user.isInstanceAdmin) throw badRequest('Den Instanz-Admin kann man nicht sperren.');
    if (blocked === (user.blockedAt !== null)) return;
    await tx
      .update(users)
      .set({ blockedAt: blocked ? deps.clock.now() : null })
      .where(eq(users.id, userId));
    if (blocked) await tx.delete(sessions).where(eq(sessions.userId, userId));
    return true;
  });
  if (updated)
    deps.log.info(`Instance admin ${blocked ? 'blocked' : 'unblocked'} account ${userId}`);
  const [row] = await deps.db
    .select({ user: users, workspaceCount })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw notFound('Dieses Konto gibt es nicht (mehr).');
  return toInstanceUser(row);
}

// ── Organisations ───────────────────────────────────────────────────────────

async function toInstanceWorkspaces(
  db: Executor,
  rows: WorkspaceRow[],
): Promise<InstanceWorkspace[]> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  // Counted like the plan limits count them (`plans`).
  const [memberCounts, deckCountOf, storage] = await Promise.all([
    countBy(db, workspaceMembers, ids),
    countBy(db, decks, ids),
    workspaceStorage(db, ids),
  ]);
  return rows.map((row) => {
    const files = storage.get(row.id);
    return {
      id: row.id,
      name: row.name,
      logoUrl: row.logoKey ? fileUrl(row.logoKey) : null,
      joinDomain: row.joinDomain,
      createdAt: row.createdAt.toISOString(),
      plan: row.plan,
      planGranted: row.planGrantedAt !== null,
      subscribed: isPaying(row),
      memberCount: memberCounts.get(row.id) ?? 0,
      deckCount: deckCountOf.get(row.id) ?? 0,
      storageBytes: files ? totalBytes(files) : 0,
      blockedAt: row.blockedAt?.toISOString() ?? null,
    };
  });
}

export async function listInstanceWorkspaces(
  { db }: AdminDeps,
  { q, offset }: InstanceListQuery,
): Promise<InstanceWorkspaceList> {
  const where = q
    ? or(ilike(workspaces.name, containing(q)), ilike(workspaces.joinDomain, containing(q)))
    : undefined;
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(workspaces)
      .where(where)
      .orderBy(desc(workspaces.createdAt), workspaces.id)
      .limit(INSTANCE_PAGE_SIZE)
      .offset(offset),
    db.select({ total: count() }).from(workspaces).where(where),
  ]);
  return { workspaces: await toInstanceWorkspaces(db, rows), total: total?.total ?? 0 };
}

async function instanceWorkspace(db: Executor, workspaceId: string): Promise<InstanceWorkspace> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const [dto] = row ? await toInstanceWorkspaces(db, [row]) : [];
  if (!dto) throw notFound('Diese Organisation gibt es nicht (mehr).');
  return dto;
}

/**
 * Blocks or unblocks an organisation. Blocked, nobody opens it or joins it, its company login is
 * off, and its members can only leave; nothing is deleted. Open live views end within half a
 * minute (their access check).
 */
export async function setWorkspaceBlocked(
  deps: AdminDeps,
  workspaceId: string,
  blocked: boolean,
): Promise<InstanceWorkspace> {
  const [row] = await deps.db
    .update(workspaces)
    .set({
      blockedAt: blocked
        ? sql`coalesce(${workspaces.blockedAt}, ${deps.clock.now().toISOString()}::timestamptz)`
        : null,
    })
    .where(eq(workspaces.id, workspaceId))
    .returning({ id: workspaces.id });
  if (!row) throw notFound('Diese Organisation gibt es nicht (mehr).');
  deps.log.info(`Instance admin ${blocked ? 'blocked' : 'unblocked'} workspace ${workspaceId}`);
  return instanceWorkspace(deps.db, workspaceId);
}

/**
 * Puts an organisation on a plan by hand: `paid` grants it without Stripe (a running payment
 * grace ends with it), `free` takes it back. Not while a Stripe subscription runs – then its
 * billing owner decides – and only where the plans differ.
 */
export async function setWorkspacePlan(
  deps: AdminDeps,
  workspaceId: string,
  plan: PlanId,
): Promise<InstanceWorkspace> {
  if (!plansDiffer(deps.config)) {
    throw badRequest('Auf dieser Instanz haben alle Organisationen dieselben Limits.');
  }
  await deps.db.transaction(async (tx) => {
    // Locked like `lockWorkspaceRow`: a checkout landing meanwhile waits.
    const [row] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for('update');
    if (!row) throw notFound('Diese Organisation gibt es nicht (mehr).');
    if (isPaying(row)) {
      throw badRequest(
        'Für diese Organisation läuft ein Abo. Den Plan ändert dann nur, wer dafür bezahlt.',
      );
    }
    const settled = { downgradeAt: null, downgradeReason: null, downgradeNotices: 0 };
    await tx
      .update(workspaces)
      .set(
        plan === 'paid'
          ? { plan, planGrantedAt: row.planGrantedAt ?? deps.clock.now(), ...settled }
          : { plan, planGrantedAt: null, ...settled },
      )
      .where(eq(workspaces.id, workspaceId));
  });
  deps.log.info(`Instance admin put workspace ${workspaceId} on ${plan}`);
  return instanceWorkspace(deps.db, workspaceId);
}
