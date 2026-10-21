import { and, count, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PlanId, WorkspaceUsage } from '@slider/shared';
import type { Config } from '../config';
import type { Executor } from '../db/client';
import { decks, workspaceInvites, workspaceMembers, workspaces } from '../db/schema';
import { ApiError } from '../http/errors';
import { emptyBreakdown, totalBytes, workspaceStorage } from './workspace-storage';

/**
 * Plans and their limits (BER-130, BER-152) – the one place that knows them. An organisation
 * (`workspaces.plan`) is on a plan; the plan decides how many people, decks and bytes fit.
 * Billing (Stripe) only switches `workspaces.plan` (`services/billing`). An organisation over a
 * limit – free again after paying, see `services/downgrade` – is locked: reading, deleting and
 * upgrading work, creating does not ({@link assertWithinLimits}, BER-155).
 */

export interface PlanLimits {
  /** Members plus pending e-mail invites; `null` = unlimited. */
  maxMembers: number | null;
  /** Decks per organisation, archived ones included; `null` = unlimited. */
  maxDecks: number | null;
  /** Every file of its reviews, recordings included (BER-151); `null` = unlimited. */
  maxStorageBytes: number | null;
}

export const GIGABYTE = 1024 ** 3;

export const DEFAULT_PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: { maxMembers: 5, maxDecks: 3, maxStorageBytes: 2 * GIGABYTE },
  paid: { maxMembers: 100, maxDecks: null, maxStorageBytes: 100 * GIGABYTE },
};

/** Self-hosted instances: no limits at all. */
export const UNLIMITED_PLAN: PlanLimits = {
  maxMembers: null,
  maxDecks: null,
  maxStorageBytes: null,
};

/** Limits of `plan`; unknown plans (e.g. from a newer version) fall back to free. */
export function planLimits(config: Pick<Config, 'plans'>, plan: string): PlanLimits {
  return (config.plans as Record<string, PlanLimits | undefined>)[plan] ?? config.plans.free;
}

export const planLimit = (message: string) => new ApiError(403, 'plan_limit', message);

/**
 * Company login per organisation (BER-162): part of the paid plan where plans limit anything
 * (the hosted instance); self-hosted instances have it for every organisation.
 */
export const ssoAvailable = (config: Pick<Config, 'limited'>, plan: string) =>
  !config.limited || plan === 'paid';

export const OWN_WORKSPACE_LIMIT_MESSAGE = 'Du hast bereits eine eigene Organisation.';
export const workspaceFullMessage = () =>
  'Diese Organisation ist voll. Bitte die Person, die dich eingeladen hat, einen Platz freizumachen.';
export const seatsFullMessage = (max: number) =>
  `Die Organisation hat bereits ${max} von ${max} Plätzen belegt.`;
export const decksFullMessage = (max: number) =>
  `Im Free-Plan ${max === 1 ? 'ist eine Review' : `sind ${max} Reviews`} pro Organisation möglich. Lösche eine, um Platz zu schaffen.`;

/** `2 GB`, `1,5 GB` – German number format. */
export const formatGigabytes = (bytes: number) =>
  `${(bytes / GIGABYTE).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;

export const storageFullMessage = (max: number) =>
  `Der Speicher der Organisation ist voll (${formatGigabytes(max)}). Lösche Reviews, ältere Versionen oder Aufnahmen, um Platz zu schaffen.`;

/** What is over the plan's limits, e.g. `["7 von 5 Personen"]`; empty when everything fits. */
export function overLimitParts(usage: WorkspaceUsage): string[] {
  const parts: string[] = [];
  if (usage.maxMembers !== null && usage.seatsUsed > usage.maxMembers)
    parts.push(`${usage.seatsUsed} von ${usage.maxMembers} Personen`);
  if (usage.maxDecks !== null && usage.decks > usage.maxDecks)
    parts.push(`${usage.decks} von ${usage.maxDecks} Reviews`);
  if (usage.maxStorageBytes !== null && usage.storageBytes > usage.maxStorageBytes)
    parts.push(
      `${formatGigabytes(usage.storageBytes)} von ${formatGigabytes(usage.maxStorageBytes)} Speicher`,
    );
  return parts;
}

/** Over a limit: locked (BER-155). Ends by itself once everything fits or someone pays. */
export const isOverLimit = (usage: WorkspaceUsage) => overLimitParts(usage).length > 0;

export const planOverLimit = (usage: WorkspaceUsage) =>
  new ApiError(
    403,
    'plan_over_limit',
    `Die Organisation liegt über dem Limit ihres Plans (${overLimitParts(usage).join(', ')}). Lesen, Löschen und Exportieren gehen weiter, Neues erst wieder, wenn alles ins Limit passt: Personen entfernen, Einladungen zurückziehen, Reviews oder Aufnahmen löschen – oder auf den Paid-Plan upgraden.`,
  );

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
  const [members, deckCounts, pending, storage] = await Promise.all([
    countBy(db, workspaceMembers, ids),
    countBy(db, decks, ids),
    pendingSeatCounts(db, ids, now),
    workspaceStorage(db, ids),
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
          storageBytes: totalBytes(storage.get(row.id) ?? emptyBreakdown()),
          maxStorageBytes: limits.maxStorageBytes,
        },
      ];
    }),
  );
}

// ── Enforcing ───────────────────────────────────────────────────────────────

/**
 * Locks the workspace row until the transaction ends (Postgres `FOR UPDATE`; PGlite runs one
 * transaction at a time anyway). Everything that checks a count and then writes against the
 * workspace (seats, decks, owners, media quota) takes this first, so two requests serialise.
 * Returns the row's plan, or null when the workspace is gone.
 */
export async function lockWorkspaceRow(
  tx: Executor,
  workspaceId: string,
): Promise<{ plan: string } | null> {
  const [row] = await tx
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for('update');
  return row ?? null;
}

/** The workspace's usage under its own plan; `null` when it is gone. */
async function usageOf(
  db: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  plan: string,
  now: Date,
): Promise<WorkspaceUsage | null> {
  return (
    (await workspaceUsages(db, config, [{ id: workspaceId, plan }], now)).get(workspaceId) ?? null
  );
}

/**
 * {@link lockWorkspaceRow}, returning the workspace's usage – so two requests can't both take the
 * last slot. Throws `plan_over_limit` while the workspace is locked (BER-155).
 */
async function lockedUsage(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  now: Date,
): Promise<WorkspaceUsage | null> {
  const row = await lockWorkspaceRow(tx, workspaceId);
  if (!row) return null;
  const usage = await usageOf(tx, config, workspaceId, row.plan, now);
  if (usage && isOverLimit(usage)) throw planOverLimit(usage);
  return usage;
}

/**
 * Before anything new is created in the workspace – a comment, a reply, a sync (BER-155): throws
 * `plan_over_limit` while it is over a limit. Reading, deleting and upgrading never ask.
 */
export async function assertWithinLimits(
  db: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  now = new Date(),
): Promise<void> {
  const [row] = await db
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!row) return;
  const usage = await usageOf(db, config, workspaceId, row.plan, now);
  if (usage && isOverLimit(usage)) throw planOverLimit(usage);
}

/**
 * Before a new deck (upload, link import) – revisions, syncs and inserted slides never count
 * against the deck limit. `addBytes`: the file about to be stored, against the storage limit.
 */
export async function assertDeckSlot(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  { addBytes = 0, now = new Date() }: { addBytes?: number; now?: Date } = {},
): Promise<void> {
  const usage = await lockedUsage(tx, config, workspaceId, now);
  if (!usage) return;
  if (usage.maxDecks !== null && usage.decks >= usage.maxDecks)
    throw planLimit(decksFullMessage(usage.maxDecks));
  assertStorageFits(usage, addBytes);
}

function assertStorageFits(usage: WorkspaceUsage, addBytes: number): void {
  if (usage.maxStorageBytes === null) return;
  // Full storage refuses even an empty addition: nothing new while at the limit.
  if (
    usage.storageBytes + addBytes > usage.maxStorageBytes ||
    usage.storageBytes >= usage.maxStorageBytes
  )
    throw planLimit(storageFullMessage(usage.maxStorageBytes));
}

/**
 * Before storing a file in the workspace that is no new deck – a new version, a recording, an
 * image (BER-151). Takes the workspace lock, so two uploads can't share the rest.
 */
export async function assertStorageFor(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  addBytes: number,
  now = new Date(),
): Promise<void> {
  const usage = await lockedUsage(tx, config, workspaceId, now);
  if (usage) assertStorageFits(usage, addBytes);
}

/** Before a new e-mail invite: it reserves a seat, so members + pending invites must leave one. */
export async function assertSeatForInvite(
  tx: Executor,
  config: Pick<Config, 'plans'>,
  workspaceId: string,
  now: Date,
): Promise<void> {
  const usage = await lockedUsage(tx, config, workspaceId, now);
  if (usage?.maxMembers == null) return;
  if (usage.seatsUsed >= usage.maxMembers) throw planLimit(seatsFullMessage(usage.maxMembers));
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
  const row = await lockWorkspaceRow(tx, workspaceId);
  if (!row) return;
  const usage = await usageOf(tx, config, workspaceId, row.plan, now);
  if (usage?.maxMembers == null) return;
  const taken = reserved ? usage.members : usage.seatsUsed;
  if (taken >= usage.maxMembers) throw planLimit(workspaceFullMessage());
}

/**
 * Whether the user still may found an organisation – only limited on a limited instance (the
 * demo); self-hosted, anyone may found as many as they like. "Own" means founded by the user
 * (`createdBy`), whoever owns it now: handing it over doesn't free the slot, only deleting it does.
 */
export async function canCreateWorkspace(
  db: Executor,
  config: Pick<Config, 'limited'>,
  userId: string,
): Promise<boolean> {
  if (!config.limited) return true;
  const [row] = await db
    .select({ count: count() })
    .from(workspaces)
    .where(eq(workspaces.createdBy, userId));
  return (row?.count ?? 0) === 0;
}
