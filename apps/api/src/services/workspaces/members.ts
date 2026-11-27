import { and, asc, count, eq, inArray, isNull, ne, notExists, or } from 'drizzle-orm';
import type { Attachment, WorkspaceMember, WorkspaceRole } from '@slider/shared';
import type { Executor } from '../../db/client';
import {
  calendarFeeds,
  cloudAreaMembers,
  cloudAgents,
  cloudAreas,
  cloudConnections,
  cloudShares,
  mailAccounts,
  senderChannelAgents,
  senderChannels,
  senderDrafts,
  senderMembers,
  senderPins,
  senderScheduled,
  todoMilestones,
  todoProjects,
  todos,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  type CloudConnectionRow,
  type UserRow,
} from '../../db/schema';
import { badRequest, forbidden, notFound } from '../../http/errors';
import { assertBillingOwnerMayGo, reassignBillingOwner } from '../billing-owner';
import { audienceShrank } from '../call-audience';
import { lockWorkspaceRow } from '../plans';
import { attachmentsOf, unsentPlanFiles } from '../purge-attachments';
import { departDecks } from './departure';
import { maskEmail } from './invites';
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
  // Also in a blocked workspace (BER-167): leaving it may need a successor from this list.
  const role = await requireRole(db, workspaceId, userId, 'viewer', undefined, {
    allowBlocked: true,
  });
  const rows = await db
    .select({ user: users, member: workspaceMembers, creatorId: workspaces.createdBy })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
  // Full addresses for admins (inviting, roles) and one's own; others recognise colleagues by
  // the masked one – a guest invited to one deck doesn't get everyone's address.
  const seesAddresses = role === 'admin';
  return rows
    .map((row) => {
      const member = toMemberDto(row.user, row.member, row.creatorId);
      return seesAddresses || row.user.id === userId
        ? member
        : { ...member, email: maskEmail(member.email) };
    })
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
  badRequest('Ein Workspace braucht mindestens einen Admin. Ernenne zuerst jemand anderen.');

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
    if (!current) throw notFound('Diese Person ist nicht Mitglied des Workspace.');
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
      // The billing owner must be an admin (BER-154): a free workspace's role moves on.
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
 * role of a free workspace passes on. Returns the subscription to cancel should the billing
 * owner still go with one (`cancelSubscriptions`, after the commit) and the deleted decks, whose
 * files go after the commit too (`deleteDeckFiles`) – as do the attachments of their mailboxes in
 * the workspace, which go with them (`mailBlobs`) – and the sign-ins of their connections in
 * Cloud there, handed back to the services (`revokeCloudConnection`). `now`: the app's clock.
 */
export async function removeMember(
  db: Executor,
  actorId: string,
  workspaceId: string,
  targetId: string,
  successorId?: string,
  now = new Date(),
): Promise<{
  cancelSubscriptionId: string | null;
  deletedDeckIds: string[];
  deletedMailAccountIds: string[];
  deletedConnections: CloudConnectionRow[];
  /** Files on their to-dos and the conversations left empty: removed after the commit. */
  deletedAttachments: Attachment[];
}> {
  const removal = await db.transaction(async (tx) => {
    await lockWorkspaceRow(tx, workspaceId);
    // Leaving works in a blocked workspace too (BER-167); removing others does not.
    const actorRole = await requireRole(tx, workspaceId, actorId, 'viewer', undefined, {
      allowBlocked: actorId === targetId,
    });
    const target = actorId === targetId ? actorRole : await getRole(tx, workspaceId, targetId);
    if (!target) throw notFound('Diese Person ist nicht Mitglied des Workspace.');
    if (actorId !== targetId) {
      if (!atLeast(actorRole, 'admin')) throw forbidden('Nur Admins können Mitglieder entfernen.');
      if (successorId) throw badRequest('Einen Nachfolger ernennt nur, wer selbst geht.');
    }
    if (successorId && actorRole === 'admin') {
      if (successorId === actorId) throw badRequest('Wähle jemand anderen als Nachfolger.');
      const successorRole = await getRole(tx, workspaceId, successorId);
      if (!successorRole) throw notFound('Der Nachfolger ist nicht Mitglied des Workspace.');
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
    // Their calendar link ends – invited again, the old one does not open it.
    await tx
      .delete(calendarFeeds)
      .where(and(eq(calendarFeeds.workspaceId, workspaceId), eq(calendarFeeds.userId, targetId)));
    // Cloud: out of the areas' lists and what was shared with them – back in the workspace
    // later, they see what everyone sees, not what they once did.
    await tx
      .delete(cloudAreaMembers)
      .where(
        and(
          eq(cloudAreaMembers.userId, targetId),
          inArray(
            cloudAreaMembers.areaId,
            tx
              .select({ id: cloudAreas.id })
              .from(cloudAreas)
              .where(eq(cloudAreas.workspaceId, workspaceId)),
          ),
        ),
      );
    await tx
      .delete(cloudShares)
      .where(
        and(
          eq(cloudShares.workspaceId, workspaceId),
          eq(cloudShares.kind, 'user'),
          eq(cloudShares.userId, targetId),
        ),
      );
    // The public links they made go too: a link is a key they still hold.
    await tx
      .delete(cloudShares)
      .where(
        and(
          eq(cloudShares.workspaceId, workspaceId),
          eq(cloudShares.kind, 'link'),
          eq(cloudShares.createdBy, targetId),
        ),
      );
    // Their mailboxes here stop syncing: their mail is not the workspace's.
    const mailboxes = await tx
      .delete(mailAccounts)
      .where(and(eq(mailAccounts.workspaceId, workspaceId), eq(mailAccounts.userId, targetId)))
      .returning({ id: mailAccounts.id });
    // So do their connections in Cloud here: their agents work there as them, for the workspace.
    const connections = await tx
      .delete(cloudConnections)
      .where(
        and(eq(cloudConnections.workspaceId, workspaceId), eq(cloudConnections.userId, targetId)),
      )
      .returning();
    // Sender: out of their groups and direct conversations here – back later, they don't read
    // what was written while they were gone. A direct one stays with the other person, its pair
    // freed for a new one; one left without people goes, as when the last one leaves a group.
    const left = await tx
      .delete(senderMembers)
      .where(
        and(
          eq(senderMembers.userId, targetId),
          inArray(
            senderMembers.channelId,
            tx
              .select({ id: senderChannels.id })
              .from(senderChannels)
              .where(
                and(
                  eq(senderChannels.workspaceId, workspaceId),
                  inArray(senderChannels.kind, ['group', 'direct']),
                ),
              ),
          ),
        ),
      )
      .returning({ channelId: senderMembers.channelId });
    // Their own private agents go out of the conversations with them (`leaveGroup`).
    await tx.delete(senderChannelAgents).where(
      inArray(
        senderChannelAgents.agentId,
        tx
          .select({ id: cloudAgents.id })
          .from(cloudAgents)
          .where(
            and(
              eq(cloudAgents.workspaceId, workspaceId),
              eq(cloudAgents.userId, targetId),
              eq(cloudAgents.shared, false),
            ),
          ),
      ),
    );
    // Their own to-dos here go (nobody else sees them, they could no longer reach them); the
    // area's they were to do stay, without them.
    const ownTodos = await tx
      .delete(todos)
      .where(and(eq(todos.workspaceId, workspaceId), eq(todos.ownerId, targetId)))
      .returning({ attachments: todos.attachments });
    // The files on them go after the commit (`deleteAttachments`), as those of the conversations
    // left empty below.
    const files: Attachment[] = ownTodos.flatMap((each) => each.attachments ?? []);
    // And the milestones and projects of their own (none of an area): kept, their names showed
    // again on coming back.
    for (const table of [todoMilestones, todoProjects])
      await tx
        .delete(table)
        .where(
          and(
            eq(table.workspaceId, workspaceId),
            eq(table.ownerId, targetId),
            isNull(table.areaId),
          ),
        );
    await tx
      .update(todos)
      .set({ assigneeId: null })
      .where(and(eq(todos.workspaceId, workspaceId), eq(todos.assigneeId, targetId)));
    // What they wrote here and did not send, and what they pinned here, goes too – kept for a
    // workspace they no longer read, nobody could see or delete it (mail pins go with the mail).
    await tx
      .delete(senderDrafts)
      .where(and(eq(senderDrafts.workspaceId, workspaceId), eq(senderDrafts.userId, targetId)));
    // What they planned here („Später senden“) goes unsent, with its files.
    const planned = await tx
      .delete(senderScheduled)
      .where(
        and(eq(senderScheduled.workspaceId, workspaceId), eq(senderScheduled.userId, targetId)),
      )
      .returning({ id: senderScheduled.id, attachments: senderScheduled.attachments });
    files.push(...(await unsentPlanFiles(tx, planned)));
    await tx
      .delete(senderPins)
      .where(
        and(
          eq(senderPins.userId, targetId),
          or(
            inArray(
              senderPins.channelId,
              tx
                .select({ id: senderChannels.id })
                .from(senderChannels)
                .where(eq(senderChannels.workspaceId, workspaceId)),
            ),
            inArray(
              senderPins.agentId,
              tx
                .select({ id: cloudAgents.id })
                .from(cloudAgents)
                .where(eq(cloudAgents.workspaceId, workspaceId)),
            ),
          ),
        ),
      );
    const conversations = left.map((row) => row.channelId);
    if (conversations.length > 0) {
      await tx
        .update(senderChannels)
        .set({ directKey: null })
        .where(and(inArray(senderChannels.id, conversations), eq(senderChannels.kind, 'direct')));
      const empty = await tx
        .select({ id: senderChannels.id })
        .from(senderChannels)
        .where(
          and(
            inArray(senderChannels.id, conversations),
            notExists(
              tx
                .select({ one: senderMembers.userId })
                .from(senderMembers)
                .where(eq(senderMembers.channelId, senderChannels.id)),
            ),
          ),
        );
      if (empty.length > 0) {
        const ids = empty.map((each) => each.id);
        files.push(...(await attachmentsOf(tx, { channelIds: ids })));
        await tx.delete(senderChannels).where(inArray(senderChannels.id, ids));
      }
    }
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
    return {
      cancelSubscriptionId: handover.cancelSubscriptionId,
      deletedDeckIds: deleted,
      deletedMailAccountIds: mailboxes.map((row) => row.id),
      deletedConnections: connections,
      deletedAttachments: files,
    };
  });
  // Out of the workspace's calls too, quiet as they may be.
  audienceShrank(workspaceId);
  return removal;
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
