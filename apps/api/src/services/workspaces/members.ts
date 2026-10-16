import { and, asc, count, eq, isNull } from 'drizzle-orm';
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
import { lockWorkspaceRow } from '../plans';
import { atLeast, getRole, RANK, requireRole } from './roles';

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

async function adminCount(db: Executor, workspaceId: string): Promise<number> {
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
async function revokeInvitesBy(db: Executor, workspaceId: string, userId: string): Promise<void> {
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
    await tx
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    if (current === 'admin' && role !== 'admin') await revokeInvitesBy(tx, workspaceId, targetId);
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
 * Removes a member (admins only) or lets someone leave. Their decks stay in the workspace. The
 * last admin can neither leave nor be removed – unless they leave and name a `successorId`,
 * another member who becomes admin in the same step. Checked under the workspace lock, so two
 * admins removing each other can't leave none.
 */
export async function removeMember(
  db: Executor,
  actorId: string,
  workspaceId: string,
  targetId: string,
  successorId?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
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
      if (successorRole === 'viewer') {
        throw badRequest('Betrachter können die Organisation nicht übernehmen.');
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
    await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    await revokeInvitesBy(tx, workspaceId, targetId);
  });
}
