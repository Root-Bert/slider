import { and, asc, count, eq, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  DELETED_ACCOUNT_NAME,
  type Author,
  type SuccessorChoice,
  type WorkspaceRole,
} from '@slider/shared';
import { emailHash } from '../crypto/content-crypto';
import type { Executor } from '../db/client';
import {
  cloudAgents,
  cloudConnections,
  cloudNodes,
  comments,
  deckBoardItems,
  deckMaterials,
  decks,
  documentComments,
  googleConnections,
  integrationKeys,
  materialQuestions,
  media,
  loginLinks,
  mailAccounts,
  nextcloudConnections,
  pdfComments,
  senderChannels,
  senderMessages,
  senderScheduled,
  showRuns,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaceRemovals,
  workspaces,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { inviteMail } from '../mail/mailer';
import { runInBackground } from '../background-work';
import { blobKeys } from '../storage/blob-storage';
import {
  deckBlobs,
  deleteNotedBlobs,
  mailBlobs,
  noteBlobs,
  storageBlobs,
  type BlobDeletion,
} from './blob-deletions';
import { measureDeckFiles } from './deck-storage';
import { anonymiseCalls } from './call-records';
import { cancelSubscriptions, isRenewing, reassignBillingOwner } from './billing-owner';
import { revokeCloudConnection } from './cloud-connections';
import { revokeGoogleGrant } from './retired-connections';
import { lockWorkspaceRow } from './plans';
import { departDecks } from './workspaces/departure';
import { revokeInvitesBy } from './workspaces/members';
import { getRole, RANK, VIEWER_LAST_RESORT } from './workspaces/roles';
import { purgeIfEmpty } from './workspaces/workspaces';
import { dropAgentChats } from './agent-chats';
import { dropAttachmentRows } from './attachments';
import { unsentPlanFiles } from './purge-attachments';

/**
 * Deleting an account (BER-145, rules from the deletion concept BER-143). Nothing personal stays
 * behind except what other people need to keep working:
 *
 * - Workspaces the person is alone in are deleted with all their decks: only the last member
 *   takes a workspace along.
 * - In shared workspaces they leave like `removeMember`: their linked decks are deleted, their
 *   uploads pass to the workspace owner (`departDecks`, BER-165). The same for decks still theirs
 *   in workspaces they left earlier; with nobody there, those are deleted.
 * - Their comments in other people's decks stay, anonymised: no name, no avatar, a fresh id
 *   that leads nowhere (`DELETED_ACCOUNT_NAME`). @mentions of them read the same. Voice and video
 *   recordings and images (drawn, pasted or picked) can't be anonymised (voice, face, what a
 *   screenshot shows) and are deleted; the comment text stays. So are the recordings of their
 *   rehearsals (`show_runs.recorded_by`); the run's timings stay. Calls they were in
 *   (`call_records`) read as the deleted account; one they were alone in with an agent goes.
 * - Invitations to their address are deleted; logins, passkeys, sessions, Microsoft connections
 *   (and tokens), mailboxes and memberships go with the account row (`on delete cascade`) – the
 *   mailboxes' attachments after it (`mailBlobs`).
 *
 * Where they are the only admin of a workspace with others, someone else becomes admin
 * first: whom the person chose when they delete themselves (`successors`, one per such
 * workspace – see {@link successorChoices}), or, for unused accounts deleted without anyone
 * (`'automatic'`), the longest-standing member with the highest role. Viewers (guests) are the last
 * resort: one takes over only if nobody else is left. Refused for the only instance admin: the
 * instance needs one – and, deleting oneself, while paying for a workspace others work in:
 * paying is handed over first ({@link assertNotPaying}). An erasure asked for by mail (`erasure`)
 * is not held up by that – the person may not be able to sign in to hand over: their
 * subscription ends, the next billing owner gets the grace, as for unused accounts.
 * Backups keep the data until they rotate out – see `docs/self-hosting.md`.
 */
export async function deleteAccount(
  deps: AppDeps,
  userId: string,
  successors: Successors,
  /** Only if not used since (the unused-account sweep): else nothing happens, `false`. */
  unusedSince?: Date,
  /** `erasure`: confirmed through a data-request link (GDPR erasure), paying or not. */
  options: { erasure?: boolean } = {},
): Promise<boolean> {
  const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
  if (!user) throw notFound('Dieses Konto gibt es nicht.');
  if (deps.config.auth.devLogin && userId === deps.ownerId) {
    throw badRequest('Das Konto des Dev-Logins kann nicht gelöscht werden.');
  }
  if (user.isInstanceAdmin && !(await hasOtherInstanceAdmin(deps.db, userId))) {
    throw badRequest(
      'Dieses Konto ist der einzige Instanz-Admin und kann nicht gelöscht werden: die Instanz braucht einen Admin.',
    );
  }

  const memberships = await membershipsOf(deps.db, userId);
  // Their rows go with the account (Microsoft and Google connections of before too); the app
  // passwords at Nextcloud, Google's grants left and the OAuth tokens of their connections in
  // Cloud („Verbindungen“) are revoked after.
  const nextcloud = await deps.db
    .select()
    .from(nextcloudConnections)
    .where(eq(nextcloudConnections.userId, userId));
  const google = await deps.db
    .select({ id: googleConnections.id, refreshToken: googleConnections.refreshToken })
    .from(googleConnections)
    .where(eq(googleConnections.userId, userId));
  const connections = await deps.db
    .select()
    .from(cloudConnections)
    .where(eq(cloudConnections.userId, userId));
  // Checked before anything is deleted.
  const handOverPayingFirst = successors !== 'automatic' && !options.erasure;
  if (handOverPayingFirst) {
    for (const m of memberships.filter((m) => m.members > 1)) {
      await assertNotPaying(deps.db, m, userId);
    }
  }
  const chosen = new Map<string, string>();
  for (const m of memberships.filter(needsSuccessor)) {
    if (successors === 'automatic') continue;
    const candidates = await candidatesOf(deps.db, m.workspaceId, userId);
    const successorId = successors[m.workspaceId];
    if (!successorId) throw badRequest(`Wähle für „${m.name}“, wer dort Admin wird.`);
    if (!candidates.some((c) => c.userId === successorId)) {
      throw badRequest(
        (await getRole(deps.db, m.workspaceId, successorId)) === 'viewer'
          ? VIEWER_LAST_RESORT
          : `Die gewählte Person ist nicht Mitglied von „${m.name}“.`,
      );
    }
    chosen.set(m.workspaceId, successorId);
  }

  const result = await deps.db.transaction(async (tx) => {
    if (unusedSince) {
      // Locked: a sign-in or "Konto behalten" now waits, and one just before counts.
      const [unused] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), lt(users.lastActiveAt, justAfter(unusedSince))))
        .for('update');
      if (!unused) return null;
    }
    const promoted: { workspaceId: string; workspaceName: string; userId: string }[] = [];
    const cancelled: (string | null)[] = [];
    // Workspaces they are alone in go after the transaction: should it fail, nothing is lost.
    // Counted again under the lock – whoever joined meanwhile makes it a shared one – and they
    // close now (`closeWorkspace`), so nobody joins one that is about to go.
    const solo: string[] = [];
    const shared = memberships.filter((m) => m.members > 1);
    for (const membership of memberships.filter((m) => m.members === 1)) {
      const { workspaceId } = membership;
      await lockWorkspaceRow(tx, workspaceId);
      const [now] = await tx
        .select({ members: count() })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspaceId));
      const members = now?.members ?? 0;
      if (members > 1) {
        shared.push({ ...membership, members });
        continue;
      }
      solo.push(workspaceId);
      await closeWorkspace(tx, workspaceId);
    }
    for (const read of shared) {
      const { workspaceId } = read;
      await lockWorkspaceRow(tx, workspaceId);
      // Counted again under the lock: another admin deleting their account at the same time may
      // have left them the only one – then they are asked like below, rather than failing.
      const membership = { ...read, ...(await countsOf(tx, workspaceId)) };
      // The others left meanwhile: it goes like one they are alone in.
      if (membership.members <= 1) {
        solo.push(workspaceId);
        await closeWorkspace(tx, workspaceId);
        continue;
      }
      if (handOverPayingFirst) await assertNotPaying(tx, membership, userId);
      if (needsSuccessor(membership)) {
        const candidates = await candidatesOf(tx, workspaceId, userId);
        let successorId = chosen.get(workspaceId);
        // Changed since the check above – someone joined a workspace they were alone in, the
        // chosen person left, or a viewer was chosen and now someone else is there: only the sweep
        // picks an admin itself, a person deleting themselves is asked again, rather than having
        // chosen someone they never saw.
        if (successorId && !candidates.some((c) => c.userId === successorId)) {
          successorId = undefined;
        }
        if (!successorId && successors !== 'automatic') {
          throw badRequest(`Wähle für „${membership.name}“, wer dort Admin wird.`);
        }
        successorId ??= candidates[0]?.userId;
        // Counted above: there is someone else.
        if (!successorId) throw new Error(`Workspace ${workspaceId} has no other member`);
        await makeAdmin(tx, workspaceId, successorId);
        promoted.push({ workspaceId, workspaceName: membership.name, userId: successorId });
      }
      await revokeInvitesBy(tx, workspaceId, userId);
      // Paid by them: the role passes on, their subscription ends (BER-154).
      const handover = await reassignBillingOwner(tx, workspaceId, userId, new Date());
      cancelled.push(handover.cancelSubscriptionId);
    }

    // Every deck still theirs – in the workspaces above, those they left earlier and those
    // they are alone in – goes as on leaving: linked ones are deleted, uploads pass to the
    // workspace owner; with nobody there, deleted too.
    const orphaned: string[] = [];
    const owned = await tx
      .selectDistinct({ workspaceId: decks.workspaceId })
      .from(decks)
      .where(eq(decks.ownerId, userId));
    for (const { workspaceId } of owned) {
      const { deleted } = await departDecks(tx, { workspaceId, leaverId: userId });
      orphaned.push(...deleted);
    }

    const recordings = await tx
      .delete(media)
      .where(eq(media.uploaderId, userId))
      .returning({ key: media.storageKey, deckId: media.deckId });

    // Their rehearsals' recordings too (voice, face); the run's timings stay with the deck.
    const runs = await tx
      .select({ key: showRuns.recordingKey, deckId: showRuns.deckId })
      .from(showRuns)
      .where(and(eq(showRuns.recordedBy, userId), isNotNull(showRuns.recordingKey)));
    if (runs.length > 0) {
      await tx
        .update(showRuns)
        .set({ recordingKey: null })
        .where(and(eq(showRuns.recordedBy, userId), isNotNull(showRuns.recordingKey)));
    }

    const touched = new Set(recordings.map((r) => r.deckId));
    const anonymised = await anonymiseComments(tx, user.id, user.name, memberships);
    for (const deckId of anonymised.decks) touched.add(deckId);
    // AI keys they set show who set them by a copy of the name: it reads like a comment's.
    await tx
      .update(integrationKeys)
      .set({ setByName: DELETED_ACCOUNT_NAME })
      .where(eq(integrationKeys.setById, userId));
    await tx
      .update(workspaces)
      .set({ aiKeySetByName: DELETED_ACCOUNT_NAME })
      .where(eq(workspaces.aiKeySetById, userId));

    await tx
      .delete(workspaceInvites)
      .where(sql`lower(${workspaceInvites.email}) = ${user.email.toLowerCase()}`);
    // Mailed login links to the address (BER-168): one could create the account again.
    await tx.delete(loginLinks).where(eq(loginLinks.email, user.email.toLowerCase()));
    // Removals stay, by the hash of the address only (`user_id` set null): signing up again
    // mustn't lift them. Rows from before the hash get it now.
    await tx
      .update(workspaceRemovals)
      .set({ emailHash: emailHash(user.email) })
      .where(and(eq(workspaceRemovals.userId, userId), isNull(workspaceRemovals.emailHash)));
    // Their mailboxes go with the row; the attachments kept of them after the commit.
    const mailboxes = await tx
      .select({ id: mailAccounts.id })
      .from(mailAccounts)
      .where(eq(mailAccounts.userId, userId));
    // Their agents go with the row, their chats with them – and the files in those chats.
    const agentFiles = await dropAgentChats(
      tx,
      inArray(
        senderChannels.agentId,
        tx.select({ id: cloudAgents.id }).from(cloudAgents).where(eq(cloudAgents.userId, userId)),
      ),
    );
    // What they planned and did not send yet goes unsent, its files with it.
    const planned = await tx
      .delete(senderScheduled)
      .where(eq(senderScheduled.userId, userId))
      .returning({ id: senderScheduled.id, attachments: senderScheduled.attachments });
    const agentBlobs = await dropAttachmentRows(tx, [
      ...agentFiles,
      ...(await unsentPlanFiles(tx, planned)),
    ]);
    await tx.delete(users).where(eq(users.id, userId));
    // Their files go after the commit – noted here with the rows, so that a crash in between
    // leaves them to the hourly sweep rather than nowhere.
    const runKeys = runs.flatMap((run) => (run.key ? [{ key: run.key, deckId: run.deckId }] : []));
    const blobs: BlobDeletion[] = [
      ...recordings.map((r) => ({ store: 'media' as const, key: r.key, prefix: false })),
      ...storageBlobs(runKeys.map((run) => run.key)),
      ...orphaned.flatMap((deckId) => deckBlobs(blobKeys.deckPrefix(deckId))),
      ...mailBlobs(mailboxes.map((row) => row.id)),
      // Their picture (`users/<id>/pictures/`, services/user-pictures.ts).
      { store: 'storage', key: `users/${userId}/`, prefix: true },
      ...agentBlobs,
    ];
    await noteBlobs(tx, blobs);
    return {
      blobs,
      runs: runKeys,
      touched,
      promoted,
      solo,
      cancelled,
    };
  });
  if (!result) return false;

  await cancelSubscriptions(deps, result.cancelled);
  // The account is gone now: files that can't be deleted yet stay noted for the hourly sweep.
  await deleteNotedBlobs(deps, result.blobs);
  for (const deckId of new Set(result.runs.map((run) => run.deckId))) {
    await measureDeckFiles(deps, deckId).catch((error: unknown) =>
      deps.log.warn(`Measuring deck ${deckId} after deleting recordings failed: ${String(error)}`),
    );
  }
  // Full access to someone's files must not outlive their account (best effort, logged) – asked
  // of the services in the background, each up to 15 s, after the files here are gone.
  runInBackground(deps, async () => {
    for (const row of nextcloud) {
      await deps.nextcloud
        .revoke(row)
        .catch((error: unknown) => deps.log.warn(`Revoking Nextcloud ${row.id}: ${String(error)}`));
    }
    const network = { secret: deps.config.secret, log: deps.log, fetch: deps.ssoNetwork?.fetch };
    for (const grant of google) await revokeGoogleGrant(network, grant);
    for (const row of connections) await revokeCloudConnection(deps, row);
  });
  // Left over on an error here, `purgeEmptyWorkspaces` in the hourly sweep finishes the job.
  for (const workspaceId of result.solo) {
    await purgeIfEmpty(deps, workspaceId).catch((error: unknown) =>
      deps.log.error(`Deleting account ${userId}: workspace ${workspaceId} failed`, error),
    );
  }
  for (const deckId of result.touched) deps.live?.commentsChanged(deckId);
  await tellNewAdmins(deps, user.name, successors === 'automatic', result.promoted);
  return true;
}

/**
 * `date` plus a millisecond, to compare with a stored timestamp: Postgres keeps microseconds, a
 * `Date` read from it only milliseconds.
 */
export const justAfter = (date: Date) => new Date(date.getTime() + 1);

/**
 * Whoever became admin hears it by mail – also so a deletion through someone else's mailbox
 * (hacked, forwarded) doesn't go unnoticed. Best effort.
 */
async function tellNewAdmins(
  deps: AppDeps,
  name: string,
  unused: boolean,
  promoted: readonly { workspaceId: string; workspaceName: string; userId: string }[],
): Promise<void> {
  if (!deps.mailer.configured) return;
  for (const { workspaceId, workspaceName, userId } of promoted) {
    const [admin] = await deps.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (!admin) continue;
    const message = inviteMail({
      to: admin.email,
      url: new URL(`/w/${workspaceId}`, deps.config.webOrigin).toString(),
      subject: `Du bist jetzt Admin von „${workspaceName}“`,
      heading: `Du bist jetzt Admin von „${workspaceName}“`,
      intro: unused
        ? `Das Konto von ${name} wurde gelöscht, weil es lange nicht genutzt wurde. Du warst am längsten dabei und bist jetzt Admin des Workspace; die hochgeladenen Präsentationen von ${name} dort gehören jetzt dir, die verknüpften wurden gelöscht.`
        : `${name} hat das Konto gelöscht und dich als neuen Admin des Workspace bestimmt. Die hochgeladenen Präsentationen von ${name} dort gehören jetzt dir, die verknüpften wurden gelöscht.`,
      button: 'Workspace öffnen',
      outro:
        'Kam das unerwartet? Frag bei der Person nach oder wende dich an den Betreiber dieser Office-Instanz.',
    });
    await deps.mailer.send(message).catch((error: unknown) => {
      deps.log.warn(`Mail to the new admin ${userId} failed: ${String(error)}`);
    });
  }
}

interface Membership {
  workspaceId: string;
  name: string;
  role: WorkspaceRole;
  members: number;
  admins: number;
}

async function membershipsOf(db: Executor, userId: string): Promise<Membership[]> {
  const rows = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      name: workspaces.name,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId));
  return Promise.all(
    rows.map(async (row) => ({ ...row, ...(await countsOf(db, row.workspaceId)) })),
  );
}

/** How many members and admins a workspace has. */
async function countsOf(db: Executor, workspaceId: string) {
  const [counts] = await db
    .select({
      members: count(),
      admins: sql<number>`count(*) filter (where ${workspaceMembers.role} = 'admin')`.mapWith(
        Number,
      ),
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return { members: counts?.members ?? 0, admins: counts?.admins ?? 0 };
}

/**
 * Whoever pays for a workspace others work in hands paying over before deleting their
 * account – like leaving it (`assertBillingOwnerMayGo`): deleting would end the subscription. An
 * account unused for long (`'automatic'`) goes anyway; the next billing owner gets the grace.
 */
async function assertNotPaying(
  db: Executor,
  membership: Pick<Membership, 'workspaceId' | 'name'>,
  userId: string,
): Promise<void> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, membership.workspaceId));
  if (row?.billingOwnerId === userId && isRenewing(row)) {
    throw badRequest(
      `Du bezahlst für „${membership.name}“. Übergib zuerst die Zahlung an einen anderen Admin (unter „Nutzung“), dann kannst du dein Konto löschen.`,
    );
  }
}

/** Who becomes admin where the person was the only one: chosen, or picked automatically. */
export type Successors = 'automatic' | Readonly<Record<string, string>>;

const needsSuccessor = (m: Membership) => m.role === 'admin' && m.admins === 1 && m.members > 1;

/**
 * Who could become admin of a workspace: its other members, highest role first, then
 * longest-standing. Viewers (guests) only as the last resort, when nobody else is left – like
 * `removeMember`. A workspace goes only with its last member.
 */
async function candidatesOf(db: Executor, workspaceId: string, leaverId: string) {
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      name: users.name,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), ne(workspaceMembers.userId, leaverId)),
    )
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaceMembers.userId));
  const ranked = rows.sort((a, b) => RANK[b.role] - RANK[a.role]);
  const others = ranked.filter((row) => row.role !== 'viewer');
  return others.length > 0 ? others : ranked;
}

/**
 * The workspaces where the person is the only admin among others, with who could take over –
 * deleting oneself asks to choose one each (BER-145), a viewer only where nobody else is left.
 */
export async function successorChoices(db: Executor, userId: string): Promise<SuccessorChoice[]> {
  const memberships = await membershipsOf(db, userId);
  const choices = await Promise.all(
    memberships.filter(needsSuccessor).map(async (m) => ({
      workspaceId: m.workspaceId,
      workspaceName: m.name,
      candidates: await candidatesOf(db, m.workspaceId, userId),
    })),
  );
  return choices.filter((choice) => choice.candidates.length > 0);
}

/**
 * A workspace about to go with the account: invitations end and it is no company's any more,
 * so nobody gets in – by invite or by domain – before it is purged after the transaction.
 */
async function closeWorkspace(tx: Executor, workspaceId: string) {
  await tx.delete(workspaceInvites).where(eq(workspaceInvites.workspaceId, workspaceId));
  await tx.update(workspaces).set({ joinDomain: null }).where(eq(workspaces.id, workspaceId));
}

async function makeAdmin(tx: Executor, workspaceId: string, userId: string) {
  await tx
    .update(workspaceMembers)
    .set({ role: 'admin' })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
}

async function hasOtherInstanceAdmin(db: Executor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isInstanceAdmin, true), ne(users.id, userId)))
    .limit(1);
  return row !== undefined;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrites the person's comments to a deleted author – a fresh id per deletion, so nothing links
 * them to the account or to each other across accounts – and their @mentions in the decks of
 * the workspaces they are or were in. Returns the decks whose comments changed and the id they now carry.
 */
async function anonymiseComments(
  tx: Executor,
  userId: string,
  name: string,
  memberships: readonly Membership[],
): Promise<{ decks: string[]; authorId: string }> {
  const deleted: Author = {
    id: `deleted:${crypto.randomUUID()}`,
    name: DELETED_ACCOUNT_NAME,
    type: 'deleted',
    color: 'deleted',
  };
  const authored = await tx
    .update(comments)
    .set({ author: deleted })
    .where(sql`${comments.author}->>'id' = ${userId}`)
    .returning({ deckId: comments.deckId });
  await tx.update(comments).set({ resolvedBy: deleted.id }).where(eq(comments.resolvedBy, userId));
  // What they put on decks' material pages stays, under the same deleted author.
  await tx
    .update(deckMaterials)
    .set({ author: deleted })
    .where(sql`${deckMaterials.author}->>'id' = ${userId}`);
  await tx
    .update(deckBoardItems)
    .set({ author: deleted })
    .where(sql`${deckBoardItems.author}->>'id' = ${userId}`);
  // Their replies under notes there (`material_questions.author`; `user_id` goes null).
  await tx
    .update(materialQuestions)
    .set({ author: deleted })
    .where(sql`${materialQuestions.author}->>'id' = ${userId}`);
  const touched = new Set(authored.map((row) => row.deckId));

  // Mentions are plain `@Name` text (BER-105). Too short a name would match other words. Also
  // where they once were: workspaces they were removed from, and where they wrote.
  const removedFrom = await tx
    .select({ workspaceId: workspaceRemovals.workspaceId })
    .from(workspaceRemovals)
    .where(eq(workspaceRemovals.userId, userId));
  const wroteIn = touched.size
    ? await tx
        .selectDistinct({ workspaceId: decks.workspaceId })
        .from(decks)
        .where(inArray(decks.id, [...touched]))
    : [];
  const workspaceIds = [
    ...new Set([...memberships, ...removedFrom, ...wroteIn].map((row) => row.workspaceId)),
  ];
  if (name.trim().length >= 2 && workspaceIds.length > 0) {
    const mention = `@${name}`;
    const pattern = new RegExp(`${escapeRegExp(mention)}(?![\\p{L}\\p{N}])`, 'gu');
    const candidates = await tx
      .select({ id: comments.id, deckId: comments.deckId, body: comments.body })
      .from(comments)
      .innerJoin(decks, eq(decks.id, comments.deckId))
      // Bodies are encrypted at rest (BER-149): SQL can't search them, the pattern below does.
      .where(and(inArray(decks.workspaceId, workspaceIds), ne(comments.body, '')));
    for (const row of candidates) {
      const body = row.body.replace(pattern, `@${DELETED_ACCOUNT_NAME}`);
      if (body === row.body) continue;
      await tx.update(comments).set({ body }).where(eq(comments.id, row.id));
      touched.add(row.deckId);
    }
    // The same in Writer's and Reader's comments on the workspaces' files.
    for (const table of [documentComments, pdfComments]) {
      const fileId = table === documentComments ? documentComments.documentId : pdfComments.pdfId;
      const rows = await tx
        .select({ id: table.id, body: table.body })
        .from(table)
        .innerJoin(cloudNodes, eq(cloudNodes.id, fileId))
        .where(and(inArray(cloudNodes.workspaceId, workspaceIds), ne(table.body, '')));
      for (const row of rows) {
        const body = row.body.replace(pattern, `@${DELETED_ACCOUNT_NAME}`);
        if (body !== row.body) await tx.update(table).set({ body }).where(eq(table.id, row.id));
      }
    }
  }
  await anonymiseSender(tx, userId, name, deleted.id);
  // Calls they were in read as the deleted account; one alone with an agent goes.
  await anonymiseCalls(tx, userId, deleted.id, name);
  return { decks: [...touched], authorId: deleted.id };
}

/**
 * Sender: the messages that count them among their `mentions` (Sender records them in every
 * conversation, `mentionsIn`) – found by SQL, so only those are read. There `@Vor Nachname` and
 * `@Vorname` read as the deleted author, unless they begin the name of someone else the message
 * mentions (`@Anna Schmidt` beside a deleted Anna Berg, a living namesake); their id leaves
 * `mentions`. A direct conversation's key (the two ids) takes the deleted id.
 */
async function anonymiseSender(tx: Executor, userId: string, name: string, deletedId: string) {
  const full = name.trim();
  const first = full.split(/\s+/)[0] ?? '';
  const rows = await tx
    .select({ id: senderMessages.id, text: senderMessages.text, mentions: senderMessages.mentions })
    .from(senderMessages)
    .where(sql`${senderMessages.mentions} @> ${JSON.stringify([userId])}::jsonb`);
  const othersIds = [...new Set(rows.flatMap((row) => row.mentions))].filter((id) => id !== userId);
  const names = new Map(
    othersIds.length > 0
      ? (
          await tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, othersIds))
        ).map((row) => [row.id, row.name.trim().toLowerCase()])
      : [],
  );
  const boundary = /[\p{L}\p{N}]/u;
  /** `@word` replaced where no other mentioned person's name (full or first) starts there. */
  const rewrite = (text: string, word: string, others: readonly string[]) => {
    if (word.length < 2) return text;
    const pattern = new RegExp(`@${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'giu');
    return text.replace(pattern, (match, offset: number) => {
      const here = text.slice(offset + 1).toLowerCase();
      const theirs = others.some(
        (other) =>
          other.length >= word.length &&
          here.startsWith(other) &&
          !boundary.test(here.charAt(other.length)),
      );
      return theirs ? match : `@${DELETED_ACCOUNT_NAME}`;
    });
  };
  for (const row of rows) {
    const mentions = row.mentions.filter((id) => id !== userId);
    const others = mentions.flatMap((id) => {
      const other = names.get(id);
      return other ? [other, other.split(/\s+/)[0] ?? other] : [];
    });
    const text = rewrite(rewrite(row.text, full, others), first, others);
    await tx.update(senderMessages).set({ text, mentions }).where(eq(senderMessages.id, row.id));
  }
  await tx
    .update(senderChannels)
    .set({ directKey: sql`replace(${senderChannels.directKey}, ${userId}, ${deletedId})` })
    .where(sql`${senderChannels.directKey} like ${`%${userId}%`}`);
}
