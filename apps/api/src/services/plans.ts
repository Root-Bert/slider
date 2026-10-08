import { and, count, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PlanId, WorkspaceUsage } from '@slider/shared';
import type { Config } from '../config';
import type { Executor } from '../db/client';
import { decks, workspaceInvites, workspaceMembers, workspaces } from '../db/schema';
import { ApiError } from '../http/errors';

/**
 * Plans and their limits (BER-130) – the one place that knows them. An organisation
 * (`workspaces.plan`) is on a plan; the plan decides how many people and decks fit. Higher
 * plans are new entries here (and in `PLAN_IDS`), no other code changes. No billing yet.
 */

export interface PlanLimits {
  /** Members plus pending e-mail invites; `null` = unlimited. */
  maxMembers: number | null;
  /** Decks per organisation, archived ones included; `null` = unlimited. */
  maxDecks: number | null;
}

export const DEFAULT_PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { maxMembers: 5, maxDecks: 3 },
};

/** Limits of `plan`; unknown plans (e.g. from a newer version) fall back to free. */
export function planLimits(config: Pick<Config, 'plans'>, plan: string): PlanLimits {
  return (config.plans as Record<string, PlanLimits | undefined>)[plan] ?? config.plans.free;
}

export const planLimit = (message: string) => new ApiError(403, 'plan_limit', message);

export const OWN_WORKSPACE_LIMIT_MESSAGE = 'Du hast bereits eine eigene Organisation.';
export const workspaceFullMessage = () =>
  'Diese Organisation ist voll. Bitte die Person, die dich eingeladen hat, einen Platz freizumachen.';
export const seatsFullMessage = (max: number) =>
  `Die Organisation hat bereits ${max} von ${max} Plätzen belegt.`;
export const decksFullMessage = (max: number) =>
  `Im Free-Plan ${max === 1 ? 'ist eine Präsentation' : `sind ${max} Präsentationen`} pro Organisation möglich. Lösche eine, um Platz zu schaffen.`;

// ── Counting ────────────────────────────────────────────────────────────────

/**
 * Pending e-mail invites per workspace (valid, not yet accepted), each address once, ignoring
 * addresses that are members already – those don't need a seat.
 */
async function pendingSeatCounts(
  db: Executor,
  workspaceIds: string[],
  now: Date,
): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: workspaceInvites.workspaceId,
      count: sql<number>`count(distinct ${workspaceInvites.email})::int`,
    })
    .from(workspaceInvites)
    .where(
      and(
        inArray(workspaceInvites.workspaceId, workspaceIds),
        isNotNull(workspaceInvites.email),
        isNull(workspaceInvites.revokedAt),
        isNull(workspaceInvites.acceptedAt),
        gt(workspaceInvites.expiresAt, now),
        sql`not exists (select 1 from workspace_members m join users u on u.id = m.user_id where m.workspace_id = ${workspaceInvites.workspaceId} and lower(u.email) = ${workspaceInvites.email})`,
      ),
    )
    .groupBy(workspaceInvites.workspaceId);
  return new Map(rows.map((row) => [row.id, Number(row.count)]));
}

async function countBy(
  db: Executor,
  table: typeof decks | typeof workspaceMembers,
  workspaceIds: string[],
): Promise<Map<string, number>> {
  if (workspaceIds.length === 0) return new Map();
  const rows = await db
    .select({ id: table.workspaceId, count: count() })
    .from(table)
    .where(inArray(table.workspaceId, workspaceIds))
    .groupBy(table.workspaceId);
  return new Map(rows.map((row) => [row.id, row.count]));
}

/** Usage of each workspace, for the DTOs (`Workspace.usage`). */
export async function workspaceUsages(
  db: Executor,
  config: Pick<Config, 'plans'>,
  rows: { id: string; plan: string }[],
  now: Date,
): Promise<Map<string, WorkspaceUsage>> {
  const ids = rows.map((row) => row.id);
  const [members, deckCounts, pending] = await Promise.all([
    countBy(db, workspaceMembers, ids),
    countBy(db, decks, ids),
    pendingSeatCounts(db, ids, now),
  ]);
  return new Map(
    rows.map((row) => {
      const limits = planLimits(config, row.plan);
      const memberCount = members.get(row.id) ?? 0;
      return [
        row.id,
        {
          members: memberCount,
          seatsUsed: memberCount + (pending.get(row.id) ?? 0),
          maxMembers: limits.maxMembers,
          decks: deckCounts.get(row.id) ?? 0,
          maxDecks: limits.maxDecks,
        },
      ];
    }),
  );
}

// ── Enforcing ───────────────────────────────────────────────────────────────

/**
 * Locks the workspace row until the transaction ends (Postgres `FOR UPDATE`; PGlite runs one
 * transaction at a time anyway), so two requests can't both take the last slot. Returns its limits.
 */
async function lockWorkspace(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
): Promise<PlanLimits | null> {
  const [row] = await tx
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  return row ? planLimits(config, row.plan) : null;
}

/** Before a new deck (upload, link import) – revisions, syncs and inserted slides never count. */
export async function assertDeckSlot(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
): Promise<void> {
  const limits = await lockWorkspace(tx, config, workspaceId);
  if (limits?.maxDecks == null) return;
  const used = (await countBy(tx, decks, [workspaceId])).get(workspaceId) ?? 0;
  if (used >= limits.maxDecks) throw planLimit(decksFullMessage(limits.maxDecks));
}

/** Before a new e-mail invite: it reserves a seat, so members + pending invites must leave one. */
export async function assertSeatForInvite(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  now: Date,
): Promise<void> {
  const limits = await lockWorkspace(tx, config, workspaceId);
  if (limits?.maxMembers == null) return;
  const usage = await workspaceUsages(tx, config, [{ id: workspaceId, plan: 'free' }], now);
  const seats = usage.get(workspaceId)?.seatsUsed ?? 0;
  if (seats >= limits.maxMembers) throw planLimit(seatsFullMessage(limits.maxMembers));
}

/**
 * Before someone joins. An e-mail invite brings its reserved seat (it is among the pending ones),
 * so only the members count; a link invite needs a seat nobody reserved.
 */
export async function assertSeatForJoin(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  { reserved, now }: { reserved: boolean; now: Date },
): Promise<void> {
  const limits = await lockWorkspace(tx, config, workspaceId);
  if (limits?.maxMembers == null) return;
  const usage = (await workspaceUsages(tx, config, [{ id: workspaceId, plan: 'free' }], now)).get(
    workspaceId,
  );
  const taken = reserved ? (usage?.members ?? 0) : (usage?.seatsUsed ?? 0);
  if (taken >= limits.maxMembers) throw planLimit(workspaceFullMessage());
}

/** Whether the user still may found an organisation: one of their own that still exists. */
export async function canCreateWorkspace(db: Executor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ count: count() })
    .from(workspaces)
    .where(eq(workspaces.createdBy, userId));
  return (row?.count ?? 0) === 0;
}
