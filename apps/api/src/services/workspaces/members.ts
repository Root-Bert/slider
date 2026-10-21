import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import type { WorkspaceMember, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../../db/client';
import {
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  type UserRow,
} from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../http/errors';
import { assertBillingOwnerMayGo, reassignBillingOwner } from '../billing-owner';
import { lockWorkspaceRow } from '../plans';
import { departDecks } from './departure';
import { recordRemoval } from './domains';
import { atLeast, getRole, RANK, requireRole, VIEWER_LAST_RESORT } from './roles';

// ── Members ─────────────────────────────────────────────────────────────────

const toMemberDto = (
  user: UserRow,
  member: { role: WorkspaceRole; createdAt: Date },
  creatorId: string | null,
): WorkspaceMember => ({
  userId: user.id,
  name: user.name,
  email: user.email,
  color: user.color,
  role: member.role,
  isCreator: user.id === creatorId,
  joinedAt: member.createdAt.toISOString(),
});

export async function listMembers(
  db: Executor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  await requireRole(db, workspaceId, userId);
  const rows = await db
    .select({ user: users, member: workspaceMembers, creatorId: workspaces.createdBy })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
  return rows
    .map((row) => toMemberDto(row.user, row.member, row.creatorId))
    .sort((a, b) => RANK[b.role] - RANK[a.role]);
}

export async function adminCount(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'admin')));
  return row?.count ?? 0;
}

/**
 * Withdraws the open invites someone created here, once they are no admin of the workspace any
 * more (removed, left or demoted): their links must not let them – or anyone they handed one to –
 * back in. `acceptInvite` also refuses invites whose creator is no admin, for older rows.
 */
export async function revokeInvitesBy(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await db
    .update(workspaceInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        eq(workspaceInvites.createdBy, userId),
        isNull(workspaceInvites.revokedAt),
        isNull(workspaceInvites.acceptedAt),
      ),
    );
}

const lastAdmin = () =>
  badRequest('Eine Organisation braucht mindestens einen Admin. Ernenne zuerst jemand anderen.');

/**
 * Admins change every role, their own and other admins' too. Check and write run under the
 * workspace lock, so two admins demoting each other can't leave none.
 */
export async function updateMemberRole(
  db: Executor,
  actorId: string,
  workspaceId: string,
  targetId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> {
  return db.transaction(async (tx) => {
    await lockWorkspaceRow(tx, workspaceId);
    await requireRole(tx, workspaceId, actorId, 'admin');
    const current = await getRole(tx, workspaceId, targetId);
    if (!current) throw notFound('Diese Person ist nicht Mitglied der Organisation.');
    if (current === 'admin' && role !== 'admin' && (await adminCount(tx, workspaceId)) <= 1) {
      throw lastAdmin();
    }
    // Whoever pays for a running subscription stays admin until someone else pays (BER-154).
    if (current === 'admin' && role !== 'admin')
      await assertBillingOwnerMayGo(tx, workspaceId, targetId, actorId === targetId);
    await tx
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    if (current === 'admin' && role !== 'admin') {
      await revokeInvitesBy(tx, workspaceId, targetId);
      // The billing owner must be an admin (BER-154): a free organisation's role moves on.
      await reassignBillingOwner(tx, workspaceId, targetId, new Date());
    }
    const [row] = await tx
      .select({ user: users, member: workspaceMembers, creatorId: workspaces.createdBy })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    if (!row) throw notFound();
    return toMemberDto(row.user, row.member, row.creatorId);
  });
}

/**
 * Removes a member (admins only) or lets someone leave. Their linked decks are deleted, their
 * uploads pass to the workspace owner (`departDecks`, BER-165). Someone removed comes back only with an invitation, not by domain
 * (`workspace_removals`). The last admin can neither leave nor be removed – unless they leave and name a `successorId`,
 * another member who becomes admin in the same step – a viewer only if nobody else is left
 * (`VIEWER_LAST_RESORT`). Checked under the workspace lock, so two
 * admins removing each other can't leave none. Whoever pays for a running subscription neither
 * leaves nor is removed before handing over paying (`assertBillingOwnerMayGo`); the billing
 * role of a free organisation passes on. Returns the subscription to cancel should the billing
 * owner still go with one (`cancelSubscriptions`, after the commit) and the deleted decks, whose
 * files go after the commit too (`deleteDeckFiles`). `now`: the app's clock.
 */
export async function removeMember(
  db: Executor,
  actorId: string,
  workspaceId: string,
  targetId: string,
  successorId?: string,
  now = new Date(),
): Promise<{ cancelSubscriptionId: string | null; deletedDeckIds: string[] }> {
  return db.transaction(async (tx) => {
    await lockWorkspaceRow(tx, workspaceId);
    const actorRole = await requireRole(tx, workspaceId, actorId);
    const target = actorId === targetId ? actorRole : await getRole(tx, workspaceId, targetId);
    if (!target) throw notFound('Diese Person ist nicht Mitglied der Organisation.');
    if (actorId !== targetId) {
      if (!atLeast(actorRole, 'admin')) throw forbidden('Nur Admins können Mitglieder entfernen.');
      if (successorId) throw badRequest('Einen Nachfolger ernennt nur, wer selbst geht.');
    }
    if (successorId && actorRole === 'admin') {
      if (successorId === actorId) throw badRequest('Wähle jemand anderen als Nachfolger.');
      const successorRole = await getRole(tx, workspaceId, successorId);
      if (!successorRole) throw notFound('Der Nachfolger ist nicht Mitglied der Organisation.');
      if (successorRole === 'viewer' && (await hasNonViewer(tx, workspaceId, actorId))) {
        throw badRequest(VIEWER_LAST_RESORT);
      }
      await tx
        .update(workspaceMembers)
        .set({ role: 'admin' })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, successorId),
          ),
        );
    } else if (successorId) {
      throw forbidden('Nur Admins können Admins ernennen.');
    }
    if (target === 'admin' && (await adminCount(tx, workspaceId)) <= 1) throw lastAdmin();
    // Nor does whoever pays for a running subscription go, until someone else pays (BER-154).
    await assertBillingOwnerMayGo(tx, workspaceId, targetId, actorId === targetId);
    await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    await revokeInvitesBy(tx, workspaceId, targetId);
    // Removed by an admin: back only with an invitation, not by domain. Leaving blocks nothing.
    // Also by their address, which outlasts the account (`workspace_removals`).
    if (actorId !== targetId) {
      const [removed] = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, targetId));
      if (removed) await recordRemoval(tx, workspaceId, removed, now);
    }
    // Paid by them: someone else becomes billing owner; their subscription ends (BER-154).
    const handover = await reassignBillingOwner(tx, workspaceId, targetId, new Date());
    // After that: their uploads go to the (new) billing owner.
    const { deleted } = await departDecks(tx, { workspaceId, leaverId: targetId });
    return { cancelSubscriptionId: handover.cancelSubscriptionId, deletedDeckIds: deleted };
  });
}

/** Someone besides `exceptId` who is more than a viewer. */
async function hasNonViewer(tx: Executor, workspaceId: string, exceptId: string) {
  const [row] = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        ne(workspaceMembers.userId, exceptId),
        ne(workspaceMembers.role, 'viewer'),
      ),
    )
    .limit(1);
  return row !== undefined;
}
