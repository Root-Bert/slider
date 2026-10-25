import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Workspace, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../../db/client';
import { decks, users, workspaceMembers, workspaces, type WorkspaceRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { badRequest, isUniqueViolation } from '../../http/errors';
import { blobKeys, fileUrl } from '../../storage/blob-storage';
import { deleteBlobs, storageBlobs } from '../blob-deletions';
import { deleteDeck } from '../decks';
import { billingNames, toBillingDto } from '../billing';
import { assertMayDeletePaid } from '../billing-owner';
import {
  canCreateWorkspace,
  isOverLimit,
  OWN_WORKSPACE_LIMIT_MESSAGE,
  planLimit,
  workspaceUsages,
} from '../plans';
import { requireRole, workspaceNotFound } from './roles';

/** What reading workspaces with their usage needs. */
type WorkspaceDeps = Pick<AppDeps, 'db' | 'config' | 'clock'>;

export const PERSONAL_WORKSPACE_NAME = 'Mein Workspace';

// ── Workspaces ──────────────────────────────────────────────────────────────

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';

async function uniqueSlug(db: Executor, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (
      await db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(sql`${workspaces.slug} = ${base} or ${workspaces.slug} like ${`${base}-%`}`)
    ).map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Inserts the workspace under the first free slug. Two workspaces of the same name founded at
 * once both see it free: the loser takes the next one (each try in a savepoint, so a clash leaves
 * the caller's transaction usable).
 */
async function insertWithFreeSlug(
  db: Executor,
  values: Omit<typeof workspaces.$inferInsert, 'slug'> & { name: string },
): Promise<WorkspaceRow> {
  for (let attempt = 1; ; attempt++) {
    try {
      const [row] = await db.transaction(async (sp) =>
        sp
          .insert(workspaces)
          .values({ ...values, slug: await uniqueSlug(sp, values.name) })
          .returning(),
      );
      if (!row) throw new Error('Workspace insert returned no row');
      return row;
    } catch (error) {
      if (attempt >= 3 || !isUniqueViolation(error)) throw error;
    }
  }
}

/**
 * Founds a workspace for `userId` (BER-130: on a limited instance one per account, as long
 * as it exists). Joining
 * others by invitation is unlimited.
 */
export async function foundWorkspace(
  deps: Pick<AppDeps, 'db' | 'clock' | 'config'>,
  userId: string,
  name: string,
): Promise<WorkspaceRow> {
  return deps.db.transaction(async (tx) => {
    // The account's row, locked: two requests at once must not both found the one allowed.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    if (!(await canCreateWorkspace(tx, deps.config, userId)))
      throw planLimit(OWN_WORKSPACE_LIMIT_MESSAGE);
    return createWorkspace(tx, userId, name, deps.clock.now());
  });
}

/** Creates a workspace with `userId` as its creator and admin – no limits; see {@link foundWorkspace}. */
export async function createWorkspace(
  db: Executor,
  userId: string,
  name: string,
  now = new Date(),
): Promise<WorkspaceRow> {
  const row = await insertWithFreeSlug(db, {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    createdBy: userId,
    billingOwnerId: userId,
  });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: row.id, userId, role: 'admin', createdAt: now });
  return row;
}

/**
 * The user's first workspace; creates "Mein Workspace" when they have none. Only for the dev
 * owner (and the seed) – everyone else founds or joins a workspace in the onboarding
 * (BER-130).
 */
export async function ensurePersonalWorkspace(
  db: Executor,
  userId: string,
  now = new Date(),
): Promise<string> {
  const [first] = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  if (first) return first.id;
  return (await createWorkspace(db, userId, PERSONAL_WORKSPACE_NAME, now)).id;
}

/**
 * Where a new deck goes: the given workspace (member or more required), else the first one the
 * user may create decks in (old clients send no `workspaceId`).
 */
export async function resolveUploadWorkspace(
  deps: AppDeps,
  userId: string,
  workspaceId: string | undefined,
): Promise<string> {
  if (workspaceId) {
    await requireRole(
      deps.db,
      workspaceId,
      userId,
      'member',
      'Als Reviewer kannst du in diesem Workspace keine Präsentationen anlegen.',
    );
    return workspaceId;
  }
  const [first] = await deps.db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        inArray(workspaceMembers.role, ['admin', 'member']),
        isNull(workspaces.blockedAt),
      ),
    )
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  if (first) return first.id;
  throw badRequest('Erstelle zuerst einen Workspace oder tritt einem bei.');
}

/** Workspace rows with the caller's role → DTOs with member count, plan and usage. */
async function toWorkspaceDtos(
  deps: WorkspaceDeps,
  viewerId: string,
  rows: { workspace: WorkspaceRow; role: WorkspaceRole }[],
): Promise<Workspace[]> {
  const [usages, names] = await Promise.all([
    workspaceUsages(
      deps.db,
      deps.config,
      rows.map((row) => row.workspace),
      deps.clock.now(),
    ),
    billingNames(
      deps.db,
      rows.map((row) => row.workspace),
    ),
  ]);
  return rows.map(({ workspace, role }) => {
    const usage = usages.get(workspace.id);
    if (!usage) throw new Error(`No usage for workspace ${workspace.id}`);
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logoUrl: workspace.logoKey ? fileUrl(workspace.logoKey) : null,
      createdAt: workspace.createdAt.toISOString(),
      role,
      memberCount: usage.members,
      plan: workspace.plan,
      usage,
      billing: toBillingDto(workspace, viewerId, names, deps.config.billing !== null),
      locked: isOverLimit(usage),
      joinDomain: workspace.joinDomain,
      audiencePending: workspace.audiencePending,
      blocked: workspace.blockedAt !== null,
    };
  });
}

/** The user's workspaces in the order they joined them. */
export async function listWorkspaces(deps: WorkspaceDeps, userId: string): Promise<Workspace[]> {
  const rows = await deps.db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaces.name));
  return toWorkspaceDtos(deps, userId, rows);
}

export async function getWorkspace(
  deps: WorkspaceDeps,
  userId: string,
  workspaceId: string,
): Promise<Workspace> {
  const role = await requireRole(deps.db, workspaceId, userId);
  const [row] = await deps.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!row) throw workspaceNotFound();
  const [dto] = await toWorkspaceDtos(deps, userId, [{ workspace: row, role }]);
  if (!dto) throw workspaceNotFound();
  return dto;
}

export async function renameWorkspace(
  deps: WorkspaceDeps,
  userId: string,
  workspaceId: string,
  name: string,
): Promise<Workspace> {
  await requireRole(deps.db, workspaceId, userId, 'admin');
  await deps.db.update(workspaces).set({ name }).where(eq(workspaces.id, workspaceId));
  return getWorkspace(deps, userId, workspaceId);
}

/** PNG, JPEG or WebP by their magic bytes – the browser's `type` is not trusted. */
function logoExtension(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

const LOGO_ADMIN_ONLY = 'Nur Admins können das Logo ändern.';

/** Admins only. Replaces the logo; the old file is removed after the switch. */
export async function setWorkspaceLogo(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  bytes: Uint8Array,
): Promise<Workspace> {
  await requireRole(deps.db, workspaceId, userId, 'admin', LOGO_ADMIN_ONLY);
  const extension = logoExtension(bytes);
  if (!extension) throw badRequest('Das Logo muss ein PNG-, JPEG- oder WebP-Bild sein.');
  const key = blobKeys.workspaceLogo(workspaceId, extension);
  await deps.storage.put(key, bytes);
  await replaceLogoKey(deps, workspaceId, key);
  return getWorkspace(deps, userId, workspaceId);
}

/** Admins only. Back to the monogram. */
export async function removeWorkspaceLogo(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<Workspace> {
  await requireRole(deps.db, workspaceId, userId, 'admin', LOGO_ADMIN_ONLY);
  await replaceLogoKey(deps, workspaceId, null);
  return getWorkspace(deps, userId, workspaceId);
}

async function replaceLogoKey(deps: AppDeps, workspaceId: string, key: string | null) {
  const [row] = await deps.db
    .select({ logoKey: workspaces.logoKey })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  await deps.db.update(workspaces).set({ logoKey: key }).where(eq(workspaces.id, workspaceId));
  // The switch is done: a file that can't go now is retried by the hourly sweep.
  if (row?.logoKey) await deleteBlobs(deps, storageBlobs([row.logoKey]));
}

/**
 * Admins only – while a subscription runs, only the admin paying for it: deleting ends it
 * (BER-154). Deletes every deck with its files, then the workspace (members, invites).
 */
export async function deleteWorkspace(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await requireRole(
    deps.db,
    workspaceId,
    userId,
    'admin',
    'Nur Admins können einen Workspace löschen.',
  );
  await assertMayDeletePaid(deps.db, workspaceId, userId);
  await purgeWorkspace(deps, workspaceId);
}

/** Purges the workspace if nobody is a member any more (its last member deleted their account). */
export async function purgeIfEmpty(deps: AppDeps, workspaceId: string): Promise<void> {
  const [left] = await deps.db
    .select({ members: count() })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  if ((left?.members ?? 0) === 0) await purgeWorkspace(deps, workspaceId);
}

/**
 * Deletes every deck with its files, then the workspace (members, invites) – no role check. A
 * running subscription ends with it: nobody would be left to pay for (BER-152).
 */
export async function purgeWorkspace(deps: AppDeps, workspaceId: string): Promise<void> {
  const [billing] = await deps.db
    .select({ subscriptionId: workspaces.stripeSubscriptionId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (billing?.subscriptionId) {
    // Before anything is deleted: should Stripe be unreachable, the workspace stays to retry.
    await deps.billing?.cancelSubscription(billing.subscriptionId);
  }
  const deckRows = await deps.db
    .select({ id: decks.id })
    .from(decks)
    .where(eq(decks.workspaceId, workspaceId));
  for (const deck of deckRows) await deleteDeck(deps, deck.id);
  await deleteBlobs(deps, [
    { store: 'storage', key: blobKeys.workspacePrefix(workspaceId), prefix: true },
  ]);
  await deps.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}
