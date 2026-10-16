import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type {
  CreatedWorkspaceInvite,
  InviteRole,
  InviteState,
  JoinPreview,
  JoinResult,
  PendingInvite,
  Workspace,
  WorkspaceInvite,
} from '@slider/shared';
import { hashToken, newSecretToken } from '../../auth/session';
import type { Executor } from '../../db/client';
import {
  decks,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  type UserRow,
  type WorkspaceInviteRow,
} from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError, badRequest, forbidden, notFound } from '../../http/errors';
import { inviteMail } from '../../mail/mailer';
import { fileUrl } from '../../storage/blob-storage';
import { assertSeatForInvite, assertSeatForJoin, lockWorkspaceRow } from '../plans';
import { getRole, requireRole, stronger } from './roles';
import { getWorkspace } from './workspaces';

const DAY_MS = 24 * 60 * 60 * 1000;
/** E-mail invites and links alike. */
const INVITE_DAYS = 7;
const inviteNotFound = () => notFound('Diese Einladung gibt es nicht.');

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

type DeckRef = { id: string; title: string } | null;

function toInviteDto(
  row: WorkspaceInviteRow,
  creator: { id: string; name: string } | null,
  now: Date,
  deck: DeckRef,
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
    deck,
  };
}

export async function listInvites(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceInvite[]> {
  await requireRole(deps.db, workspaceId, userId, 'admin');
  const rows = await deps.db
    .select({ invite: workspaceInvites, creatorName: users.name, deckTitle: decks.title })
    .from(workspaceInvites)
    .leftJoin(users, eq(users.id, workspaceInvites.createdBy))
    .leftJoin(decks, eq(decks.id, workspaceInvites.deckId))
    // Revoked invites are gone for good from the admin's point of view; the row stays only so
    // the link answers `link_revoked`.
    .where(and(eq(workspaceInvites.workspaceId, workspaceId), isNull(workspaceInvites.revokedAt)))
    .orderBy(sql`${workspaceInvites.createdAt} desc`);
  const now = deps.clock.now();
  return rows.map(({ invite, creatorName, deckTitle }) =>
    toInviteDto(
      invite,
      invite.createdBy && creatorName ? { id: invite.createdBy, name: creatorName } : null,
      now,
      invite.deckId && deckTitle !== null ? { id: invite.deckId, title: deckTitle } : null,
    ),
  );
}

export const inviteUrl = (deps: AppDeps, token: string) =>
  new URL(`/join/${token}`, deps.config.webOrigin).toString();

/** Admins invite by e-mail (single use) or create a link (multi use); both valid 7 days. */
export async function createInvite(
  deps: AppDeps,
  actor: UserRow,
  workspaceId: string,
  input: { email?: string; role: InviteRole },
): Promise<CreatedWorkspaceInvite> {
  await requireRole(deps.db, workspaceId, actor.id, 'admin', 'Nur Admins können einladen.');
  return insertInvite(deps, actor, workspaceId, { ...input, deck: null });
}

async function insertInvite(
  deps: AppDeps,
  actor: UserRow,
  workspaceId: string,
  input: { email?: string; role: InviteRole; deck: DeckRef },
): Promise<CreatedWorkspaceInvite> {
  const email = input.email ? normalizeEmail(input.email) : null;
  if (email) {
    const [member] = await deps.db
      .select({ id: users.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), sql`lower(${users.email}) = ${email}`),
      );
    if (member) {
      throw badRequest(
        input.deck
          ? 'Diese Person ist schon in der Organisation und sieht die Präsentation bereits.'
          : 'Diese Person ist schon Mitglied der Organisation.',
      );
    }
  }
  const token = newSecretToken();
  const now = deps.clock.now();
  const days = INVITE_DAYS;
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
        deckId: input.deck?.id ?? null,
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
    // No Reply-To: the inviter's (often private) address stays out of the mail.
    const outro = `Die Einladung gilt ${days} Tage und nur für ${email}.`;
    const shared = { to: email, url, outro };
    try {
      await deps.mailer.send(
        inviteMail(
          input.deck
            ? {
                ...shared,
                subject: `${actor.name} teilt „${input.deck.title}“ mit dir`,
                heading: 'Eine Präsentation für dich',
                intro: `${actor.name} hat die Präsentation „${input.deck.title}“ auf Slider mit dir geteilt.`,
                button: 'Präsentation öffnen',
              }
            : {
                ...shared,
                subject: `${actor.name} lädt dich zu „${workspace?.name ?? 'Slider'}“ ein`,
                heading: 'Du bist eingeladen',
                // Worded for where Slider is heading (AI does the editing), not today's feature set.
                intro: `${actor.name} hat dich zu „${workspace?.name ?? ''}“ auf Slider eingeladen. Dort entstehen eure Präsentationen gemeinsam, von der ersten Idee bis zur fertigen Folie.`,
                button: 'Einladung annehmen',
              },
        ),
      );
      emailSent = true;
    } catch (error) {
      // The invite stands either way – the dialog then shows the link to send by hand.
      deps.log.warn(`Invite mail to ${email} failed`, error);
    }
  }
  return {
    invite: toInviteDto(row, { id: actor.id, name: actor.name }, now, input.deck),
    url,
    emailSent,
  };
}

/** Revoking is idempotent; only admins of the invite's workspace. */
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
    .select({
      workspaceName: workspaces.name,
      workspaceLogoKey: workspaces.logoKey,
      inviterName: users.name,
    })
    .from(workspaces)
    .leftJoin(users, eq(users.id, invite.createdBy ?? ''))
    .where(eq(workspaces.id, invite.workspaceId));
  if (!row) throw inviteNotFound();
  return {
    workspaceName: row.workspaceName,
    workspaceLogoUrl: row.workspaceLogoKey ? fileUrl(row.workspaceLogoKey) : null,
    inviterName: row.inviterName ?? null,
    role: invite.role,
    email: invite.email ? maskEmail(invite.email) : null,
    state: await effectiveState(deps.db, invite, deps.clock.now()),
    deck: await deckRef(deps.db, invite.deckId),
  };
}

async function effectiveState(
  db: Executor,
  invite: WorkspaceInviteRow,
  now: Date,
): Promise<InviteState> {
  const state = inviteState(invite, now);
  return state === 'valid' && !(await creatorIsAdmin(db, invite)) ? 'revoked' : state;
}

/** The shared deck of an invite, if it still exists. */
async function deckRef(db: Executor, deckId: string | null): Promise<DeckRef> {
  if (!deckId) return null;
  const [deck] = await db
    .select({ id: decks.id, title: decks.title })
    .from(decks)
    .where(eq(decks.id, deckId));
  return deck ?? null;
}

/**
 * An invite speaks for its creator: once they are no admin of the workspace any more (removed,
 * left, demoted, account deleted), it counts as revoked – `removeMember` and `updateMemberRole`
 * also revoke the rows themselves.
 */
async function creatorIsAdmin(db: Executor, invite: WorkspaceInviteRow): Promise<boolean> {
  if (!invite.createdBy) return false;
  return (await getRole(db, invite.workspaceId, invite.createdBy)) === 'admin';
}

const linkRevoked = () => new ApiError(410, 'link_revoked', 'Diese Einladung wurde zurückgezogen.');

function requireValidInvite(invite: WorkspaceInviteRow, now: Date): void {
  const state = inviteState(invite, now);
  if (state === 'revoked') throw linkRevoked();
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
    // Read the membership again under the workspace lock: two accepts at once (two tabs, a
    // retried request) must not both insert it.
    await lockWorkspaceRow(tx, invite.workspaceId);
    const member = await getRole(tx, invite.workspaceId, user.id);
    if (!(await creatorIsAdmin(tx, invite))) {
      // Members just land in the workspace; nobody joins or gains a role through it.
      if (member) return;
      throw linkRevoked();
    }
    if (!member) {
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
    } else if (stronger(member, invite.role) !== member) {
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
    if (invite.email || !member) {
      await tx
        .update(workspaceInvites)
        .set({
          ...(invite.email ? { acceptedAt: now } : {}),
          ...(!member ? { useCount: sql`${workspaceInvites.useCount} + 1` } : {}),
        })
        .where(eq(workspaceInvites.id, invite.id));
    }
  });
  return getWorkspace(deps, user.id, invite.workspaceId);
}

/** Joins and says where to go next: the shared deck, if the invite came from sharing one. */
async function join(deps: AppDeps, user: UserRow, invite: WorkspaceInviteRow): Promise<JoinResult> {
  const workspace = await acceptInvite(deps, user, invite);
  const deck = await deckRef(deps.db, invite.deckId);
  return { workspace, deckId: deck?.id ?? null };
}

export async function joinByToken(
  deps: AppDeps,
  user: UserRow,
  token: string,
): Promise<JoinResult> {
  const invite = await findInviteByToken(deps.db, token);
  if (!invite) throw inviteNotFound();
  return join(deps, user, invite);
}

/** Accepting an invite shown in `/me` (`pendingInvites`). */
export async function acceptInviteById(
  deps: AppDeps,
  user: UserRow,
  inviteId: string,
): Promise<JoinResult> {
  const [invite] = await deps.db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.id, inviteId));
  if (!invite?.email || invite.email !== normalizeEmail(user.email)) throw inviteNotFound();
  return join(deps, user, invite);
}

/** SQL twin of `creatorIsAdmin`. */
const createdByAdmin = sql`exists (select 1 from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${workspaceInvites.workspaceId} and ${workspaceMembers.userId} = ${workspaceInvites.createdBy} and ${workspaceMembers.role} = 'admin')`;

/** Valid e-mail invites for this address, in workspaces the user is not in yet. */
export async function pendingInvitesFor(
  db: Executor,
  user: Pick<UserRow, 'id' | 'email'>,
  now: Date,
): Promise<PendingInvite[]> {
  const rows = await db
    .select({
      invite: workspaceInvites,
      workspaceName: workspaces.name,
      inviterName: users.name,
      deckTitle: decks.title,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.createdBy))
    .leftJoin(decks, eq(decks.id, workspaceInvites.deckId))
    .where(
      and(
        eq(workspaceInvites.email, normalizeEmail(user.email)),
        isNull(workspaceInvites.revokedAt),
        isNull(workspaceInvites.acceptedAt),
        gt(workspaceInvites.expiresAt, now),
        createdByAdmin,
        sql`not exists (select 1 from ${workspaceMembers} where ${workspaceMembers.workspaceId} = ${workspaceInvites.workspaceId} and ${workspaceMembers.userId} = ${user.id})`,
      ),
    )
    .orderBy(asc(workspaceInvites.createdAt));
  return rows.map(({ invite, workspaceName, inviterName, deckTitle }) => ({
    id: invite.id,
    workspaceId: invite.workspaceId,
    workspaceName,
    inviterName: inviterName ?? null,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    deck: invite.deckId && deckTitle !== null ? { id: invite.deckId, title: deckTitle } : null,
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
        createdByAdmin,
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
