import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type {
  CreatedWorkspaceInvite,
  DeckPermissions,
  InviteRole,
  InviteState,
  JoinPreview,
  PendingInvite,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
} from '@slider/shared';
import { hashToken, newSecretToken } from '../auth/session';
import type { Executor } from '../db/client';
import {
  decks,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  type UserRow,
  type WorkspaceInviteRow,
  type WorkspaceRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, forbidden, notFound } from '../http/errors';
import { buttonMail } from '../mail/mailer';
import { fileUrl } from '../storage/blob-storage';
import { deleteDeck } from './decks';
import {
  assertSeatForInvite,
  assertSeatForJoin,
  canCreateWorkspace,
  lockWorkspaceRow,
  OWN_WORKSPACE_LIMIT_MESSAGE,
  planLimit,
  workspaceUsages,
} from './plans';

/**
 * Workspaces, members and invitations (BER-129). In the UI a workspace is an "Organisation"
 * (BER-130); its plan limits live in `./plans`.
 */

/** What reading workspaces with their usage needs. */
type WorkspaceDeps = Pick<AppDeps, 'db' | 'config' | 'clock'>;

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_INVITE_DAYS = 7;
const LINK_INVITE_DAYS = 30;
export const PERSONAL_WORKSPACE_NAME = 'Meine Organisation';

const RANK: Record<WorkspaceRole, number> = { owner: 4, admin: 3, member: 2, reviewer: 1 };
export const atLeast = (role: WorkspaceRole, min: WorkspaceRole) => RANK[role] >= RANK[min];
const stronger = (a: WorkspaceRole, b: WorkspaceRole) => (RANK[a] >= RANK[b] ? a : b);

export const workspaceNotFound = () => notFound('Diese Organisation gibt es nicht (mehr).');
const inviteNotFound = () => notFound('Diese Einladung gibt es nicht.');

/**
 * What a member may do with a deck: reviewers view and comment, members also manage the decks
 * they created, admins and owners manage every deck.
 */
export function deckPermissions(
  role: WorkspaceRole | null,
  deckOwnerId: string,
  userId: string,
): DeckPermissions {
  if (!role) return { canManage: false, canComment: false };
  const canManage = atLeast(role, 'admin') || (role === 'member' && deckOwnerId === userId);
  return { canManage, canComment: true };
}

export async function getRole(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return row?.role ?? null;
}

/** All memberships of a user, by workspace id. */
export async function rolesOf(db: Executor, userId: string): Promise<Map<string, WorkspaceRole>> {
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return new Map(rows.map((row) => [row.workspaceId, row.role]));
}

/**
 * The caller's role in the workspace, or throws: non-members get 404 (no existence leak),
 * members below `min` get 403.
 */
export async function requireRole(
  db: Executor,
  workspaceId: string,
  userId: string,
  min: WorkspaceRole = 'reviewer',
  message = 'Dafür brauchst du mehr Rechte in dieser Organisation.',
): Promise<WorkspaceRole> {
  const role = await getRole(db, workspaceId, userId);
  if (!role) throw workspaceNotFound();
  if (!atLeast(role, min)) throw forbidden(message);
  return role;
}

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
 * Founds an organisation for `userId` (BER-130: on a limited instance one per account, as long
 * as it exists). Joining
 * others by invitation is unlimited.
 */
export async function foundWorkspace(
  deps: Pick<AppDeps, 'db' | 'clock' | 'config'>,
  userId: string,
  name: string,
): Promise<WorkspaceRow> {
  return deps.db.transaction(async (tx) => {
    if (!(await canCreateWorkspace(tx, deps.config, userId)))
      throw planLimit(OWN_WORKSPACE_LIMIT_MESSAGE);
    return createWorkspace(tx, userId, name, deps.clock.now());
  });
}

/** Creates a workspace with `userId` as its owner – no limits; see {@link foundWorkspace}. */
export async function createWorkspace(
  db: Executor,
  userId: string,
  name: string,
  now = new Date(),
): Promise<WorkspaceRow> {
  const [row] = await db
    .insert(workspaces)
    .values({
      id: crypto.randomUUID(),
      name,
      slug: await uniqueSlug(db, name),
      createdAt: now,
      createdBy: userId,
    })
    .returning();
  if (!row) throw new Error('Workspace insert returned no row');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: row.id, userId, role: 'owner', createdAt: now });
  return row;
}

/**
 * The user's first workspace; creates "Meine Organisation" when they have none. Only for the dev
 * owner and the very first account, which adopts the dev owner's decks – everyone else founds or
 * joins an organisation in the onboarding (BER-130).
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
      'Als Reviewer kannst du in dieser Organisation keine Präsentationen anlegen.',
    );
    return workspaceId;
  }
  const [first] = await deps.db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        inArray(workspaceMembers.role, ['owner', 'admin', 'member']),
      ),
    )
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  if (first) return first.id;
  throw badRequest('Erstelle zuerst eine Organisation oder tritt einer bei.');
}

/** Workspace rows with the caller's role → DTOs with member count, plan and usage. */
async function toWorkspaceDtos(
  deps: WorkspaceDeps,
  rows: { workspace: WorkspaceRow; role: WorkspaceRole }[],
): Promise<Workspace[]> {
  const usages = await workspaceUsages(
    deps.db,
    deps.config,
    rows.map((row) => row.workspace),
    deps.clock.now(),
  );
  return rows.map(({ workspace, role }) => {
    const usage = usages.get(workspace.id);
    if (!usage) throw new Error(`No usage for workspace ${workspace.id}`);
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdAt: workspace.createdAt.toISOString(),
      role,
      memberCount: usage.members,
      plan: workspace.plan,
      usage,
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
  return toWorkspaceDtos(deps, rows);
}

export async function getWorkspace(
  deps: WorkspaceDeps,
  userId: string,
  workspaceId: string,
): Promise<Workspace> {
  const role = await requireRole(deps.db, workspaceId, userId);
  const [row] = await deps.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!row) throw workspaceNotFound();
  const [dto] = await toWorkspaceDtos(deps, [{ workspace: row, role }]);
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

/** Owners only. Deletes every deck with its files, then the workspace (members, invites). */
export async function deleteWorkspace(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<void> {
  await requireRole(
    deps.db,
    workspaceId,
    userId,
    'owner',
    'Nur Owner können eine Organisation löschen.',
  );
  const deckRows = await deps.db
    .select({ id: decks.id })
    .from(decks)
    .where(eq(decks.workspaceId, workspaceId));
  for (const deck of deckRows) await deleteDeck(deps, deck.id);
  await deps.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

// ── Members ─────────────────────────────────────────────────────────────────

const toMemberDto = (
  user: UserRow,
  member: { role: WorkspaceRole; createdAt: Date },
): WorkspaceMember => ({
  userId: user.id,
  name: user.name,
  email: user.email,
  color: user.color,
  avatarUrl: user.avatarKey ? fileUrl(user.avatarKey) : null,
  avatarSeed: user.avatarSeed,
  role: member.role,
  joinedAt: member.createdAt.toISOString(),
});

export async function listMembers(
  db: Executor,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  await requireRole(db, workspaceId, userId);
  const rows = await db
    .select({ user: users, member: workspaceMembers })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
  return rows
    .map((row) => toMemberDto(row.user, row.member))
    .sort((a, b) => RANK[b.role] - RANK[a.role]);
}

async function ownerCount(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')));
  return row?.count ?? 0;
}

const lastOwner = () =>
  badRequest('Eine Organisation braucht mindestens einen Owner. Ernenne zuerst jemand anderen.');

/**
 * Admins change roles below owner; only owners appoint or demote owners. Check and write run
 * under the workspace lock, so two owners demoting each other can't leave none.
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
    const actorRole = await requireRole(tx, workspaceId, actorId, 'admin');
    const current = await getRole(tx, workspaceId, targetId);
    if (!current) throw notFound('Diese Person ist nicht Mitglied der Organisation.');
    if ((current === 'owner' || role === 'owner') && actorRole !== 'owner') {
      throw forbidden('Nur Owner können Owner ernennen oder ändern.');
    }
    if (current === 'owner' && role !== 'owner' && (await ownerCount(tx, workspaceId)) <= 1) {
      throw lastOwner();
    }
    await tx
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    const [row] = await tx
      .select({ user: users, member: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
    if (!row) throw notFound();
    return toMemberDto(row.user, row.member);
  });
}

/**
 * Removes a member (admin or more; owners only by owners) or lets someone leave. Their decks
 * stay in the workspace. The last owner can neither leave nor be removed – checked under the
 * workspace lock, so two owners removing each other can't leave none.
 */
export async function removeMember(
  db: Executor,
  actorId: string,
  workspaceId: string,
  targetId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockWorkspaceRow(tx, workspaceId);
    const actorRole = await requireRole(tx, workspaceId, actorId);
    const target = actorId === targetId ? actorRole : await getRole(tx, workspaceId, targetId);
    if (!target) throw notFound('Diese Person ist nicht Mitglied der Organisation.');
    if (actorId !== targetId) {
      if (!atLeast(actorRole, 'admin')) throw forbidden('Nur Admins können Mitglieder entfernen.');
      if (target === 'owner' && actorRole !== 'owner') {
        throw forbidden('Nur Owner können Owner entfernen.');
      }
    }
    if (target === 'owner' && (await ownerCount(tx, workspaceId)) <= 1) throw lastOwner();
    await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetId)),
      );
  });
}

// ── Invitations ─────────────────────────────────────────────────────────────

export function inviteState(row: WorkspaceInviteRow, now: Date): InviteState {
  if (row.revokedAt) return 'revoked';
  if (row.email && row.acceptedAt) return 'used';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'valid';
}

/** `robert@firma.de` → `r…t@firma.de`: enough to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const masked = local.length <= 2 ? `${local[0] ?? ''}…` : `${local[0]}…${local.at(-1)}`;
  return `${masked}@${domain}`;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function toInviteDto(
  row: WorkspaceInviteRow,
  creator: { id: string; name: string } | null,
  now: Date,
): WorkspaceInvite {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    state: inviteState(row, now),
    createdBy: creator,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    useCount: row.useCount,
  };
}

export async function listInvites(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceInvite[]> {
  await requireRole(deps.db, workspaceId, userId, 'admin');
  const rows = await deps.db
    .select({ invite: workspaceInvites, creatorName: users.name })
    .from(workspaceInvites)
    .leftJoin(users, eq(users.id, workspaceInvites.createdBy))
    .where(eq(workspaceInvites.workspaceId, workspaceId))
    .orderBy(sql`${workspaceInvites.createdAt} desc`);
  const now = deps.clock.now();
  return rows.map(({ invite, creatorName }) =>
    toInviteDto(
      invite,
      invite.createdBy && creatorName ? { id: invite.createdBy, name: creatorName } : null,
      now,
    ),
  );
}

export const inviteUrl = (deps: AppDeps, token: string) =>
  new URL(`/join/${token}`, deps.config.webOrigin).toString();

/** Admins invite by e-mail (single use, 7 days) or create a link (multi use, 30 days). */
export async function createInvite(
  deps: AppDeps,
  actor: UserRow,
  workspaceId: string,
  input: { email?: string; role: InviteRole },
): Promise<CreatedWorkspaceInvite> {
  await requireRole(deps.db, workspaceId, actor.id, 'admin', 'Nur Admins können einladen.');
  const email = input.email ? normalizeEmail(input.email) : null;
  if (email) {
    const [member] = await deps.db
      .select({ id: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), sql`lower(${users.email}) = ${email}`),
      );
    if (member) throw badRequest('Diese Person ist schon Mitglied der Organisation.');
  }
  const token = newSecretToken();
  const now = deps.clock.now();
  const days = email ? EMAIL_INVITE_DAYS : LINK_INVITE_DAYS;
  // An e-mail invite reserves a seat (BER-130); links may always be created, joining checks.
  const [row] = await deps.db.transaction(async (tx) => {
    if (email && !(await hasPendingEmailInviteIn(tx, workspaceId, email, now))) {
      await assertSeatForInvite(tx, deps.config, workspaceId, now);
    }
    return tx
      .insert(workspaceInvites)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        email,
        role: input.role,
        tokenHash: hashToken(token),
        createdBy: actor.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + days * DAY_MS),
      })
      .returning();
  });
  if (!row) throw new Error('Invite insert returned no row');
  const url = inviteUrl(deps, token);

  let emailSent = false;
  if (email && deps.mailer.configured) {
    const [workspace] = await deps.db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    try {
      await deps.mailer.send(
        buttonMail({
          to: email,
          subject: `${actor.name} lädt dich zu „${workspace?.name ?? 'Slider'}“ ein`,
          intro: `${actor.name} hat dich in die Slider-Organisation „${workspace?.name ?? ''}“ eingeladen, um Präsentationen zu prüfen und zu kommentieren.`,
          button: 'Einladung annehmen',
          url,
          outro: `Die Einladung gilt ${EMAIL_INVITE_DAYS} Tage und nur für ${email}.`,
        }),
      );
      emailSent = true;
    } catch (error) {
      deps.log.warn(`Invite mail to ${email} failed`, error);
    }
  }
  return {
    invite: toInviteDto(row, { id: actor.id, name: actor.name }, now),
    url,
    emailSent,
  };
}

/** Revoking is idempotent; admins of the invite's workspace only. */
export async function revokeInvite(deps: AppDeps, userId: string, inviteId: string): Promise<void> {
  const [invite] = await deps.db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.id, inviteId));
  if (!invite) throw inviteNotFound();
  await requireRole(
    deps.db,
    invite.workspaceId,
    userId,
    'admin',
    'Nur Admins können Einladungen zurückziehen.',
  );
  if (invite.revokedAt) return;
  await deps.db
    .update(workspaceInvites)
    .set({ revokedAt: deps.clock.now() })
    .where(eq(workspaceInvites.id, inviteId));
}

export async function findInviteByToken(
  db: Executor,
  token: string,
): Promise<WorkspaceInviteRow | null> {
  const [row] = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.tokenHash, hashToken(token)));
  return row ?? null;
}

/** Public preview of `/join/:token`; unknown tokens are 404. */
export async function previewInvite(deps: AppDeps, token: string): Promise<JoinPreview> {
  const invite = await findInviteByToken(deps.db, token);
  if (!invite) throw inviteNotFound();
  const [row] = await deps.db
    .select({ workspaceName: workspaces.name, inviterName: users.name })
    .from(workspaces)
    .leftJoin(users, eq(users.id, invite.createdBy ?? ''))
    .where(eq(workspaces.id, invite.workspaceId));
  if (!row) throw inviteNotFound();
  return {
    workspaceName: row.workspaceName,
    inviterName: row.inviterName ?? null,
    role: invite.role,
    email: invite.email ? maskEmail(invite.email) : null,
    state: inviteState(invite, deps.clock.now()),
  };
}

function requireValidInvite(invite: WorkspaceInviteRow, now: Date): void {
  const state = inviteState(invite, now);
  if (state === 'revoked') {
    throw new ApiError(410, 'link_revoked', 'Diese Einladung wurde zurückgezogen.');
  }
  if (state === 'expired') {
    throw new ApiError(410, 'link_expired', 'Diese Einladung ist abgelaufen.');
  }
  if (state === 'used') {
    throw new ApiError(410, 'invite_used', 'Diese Einladung wurde schon angenommen.');
  }
}

/**
 * Joins `user` through the invite. Idempotent: members keep their role unless the invite grants a
 * stronger one. E-mail invites only work for the invited address.
 */
async function acceptInvite(
  deps: AppDeps,
  user: UserRow,
  invite: WorkspaceInviteRow,
): Promise<Workspace> {
  const now = deps.clock.now();
  const current = await getRole(deps.db, invite.workspaceId, user.id);
  if (invite.email && normalizeEmail(user.email) !== invite.email) {
    if (current) return getWorkspace(deps, user.id, invite.workspaceId);
    throw forbidden(
      `Diese Einladung gilt für ${maskEmail(invite.email)}. Du bist als ${user.email} angemeldet – melde dich mit der eingeladenen Adresse an.`,
    );
  }
  if (inviteState(invite, now) === 'used' && current) {
    return getWorkspace(deps, user.id, invite.workspaceId);
  }
  requireValidInvite(invite, now);

  await deps.db.transaction(async (tx) => {
    if (!current) {
      // Someone with a pending e-mail invite brings their reserved seat, even through a link.
      const reserved =
        Boolean(invite.email) ||
        (await hasPendingEmailInviteIn(tx, invite.workspaceId, normalizeEmail(user.email), now));
      await assertSeatForJoin(tx, deps.config, invite.workspaceId, { reserved, now });
      await tx.insert(workspaceMembers).values({
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
        createdAt: now,
      });
    } else if (stronger(current, invite.role) !== current) {
      await tx
        .update(workspaceMembers)
        .set({ role: invite.role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, invite.workspaceId),
            eq(workspaceMembers.userId, user.id),
          ),
        );
    }
    // Link invites count people who joined through them; e-mail invites are used up.
    if (invite.email || !current) {
      await tx
        .update(workspaceInvites)
        .set({
          ...(invite.email ? { acceptedAt: now } : {}),
          ...(!current ? { useCount: sql`${workspaceInvites.useCount} + 1` } : {}),
        })
        .where(eq(workspaceInvites.id, invite.id));
    }
  });
  return getWorkspace(deps, user.id, invite.workspaceId);
}

export async function joinByToken(deps: AppDeps, user: UserRow, token: string): Promise<Workspace> {
  const invite = await findInviteByToken(deps.db, token);
  if (!invite) throw inviteNotFound();
  return acceptInvite(deps, user, invite);
}

/** Accepting an invite shown in `/me` (`pendingInvites`). */
export async function acceptInviteById(
  deps: AppDeps,
  user: UserRow,
  inviteId: string,
): Promise<Workspace> {
  const [invite] = await deps.db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.id, inviteId));
  if (!invite?.email || invite.email !== normalizeEmail(user.email)) throw inviteNotFound();
  return acceptInvite(deps, user, invite);
}

/** Valid e-mail invites for this address, in workspaces the user is not in yet. */
export async function pendingInvitesFor(
  db: Executor,
  user: Pick<UserRow, 'id' | 'email'>,
  now: Date,
): Promise<PendingInvite[]> {
  const rows = await db
    .select({ invite: workspaceInvites, workspaceName: workspaces.name, inviterName: users.name })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.createdBy))
    .where(
      and(
        eq(workspaceInvites.email, normalizeEmail(user.email)),
        isNull(workspaceInvites.revokedAt),
        isNull(workspaceInvites.acceptedAt),
        gt(workspaceInvites.expiresAt, now),
        sql`not exists (select 1 from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${workspaceInvites.workspaceId} and ${workspaceMembers.userId} = ${user.id})`,
      ),
    )
    .orderBy(asc(workspaceInvites.createdAt));
  return rows.map(({ invite, workspaceName, inviterName }) => ({
    id: invite.id,
    workspaceId: invite.workspaceId,
    workspaceName,
    inviterName: inviterName ?? null,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
  }));
}

/** Whether an e-mail invite for this address is waiting (lets a new account sign up). */
export async function hasPendingEmailInvite(
  db: Executor,
  email: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaceInvites.id })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.email, normalizeEmail(email)),
        isNull(workspaceInvites.revokedAt),
        isNull(workspaceInvites.acceptedAt),
        gt(workspaceInvites.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Whether `email` already holds a seat in this workspace through a pending e-mail invite. */
async function hasPendingEmailInviteIn(
  db: Executor,
  workspaceId: string,
  email: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaceInvites.id })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        eq(workspaceInvites.email, email),
        isNull(workspaceInvites.revokedAt),
        isNull(workspaceInvites.acceptedAt),
        gt(workspaceInvites.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(row);
}
