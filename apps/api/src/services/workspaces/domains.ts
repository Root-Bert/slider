import { and, count, eq, gt, isNull, or } from 'drizzle-orm';
import freeEmailDomains from 'free-email-domains';
import {
  domainJoinAllowed,
  emailDomain,
  isCompanyDomain,
  type DomainWorkspace,
  type JoinResult,
  type Workspace,
  type WorkspaceRole,
} from '@slider/shared';
import {
  userIdentities,
  workspaceInvites,
  workspaceMembers,
  workspaceRemovals,
  workspaces,
  type UserRow,
  type WorkspaceRow,
} from '../../db/schema';
import { emailHash } from '../../crypto/content-crypto';
import type { Executor } from '../../db/client';
import type { AppDeps } from '../../deps';
import { ApiError, badRequest, forbidden, isUniqueViolation } from '../../http/errors';
import { fileUrl } from '../../storage/blob-storage';
import { assertSeatForJoin, lockWorkspaceRow } from '../plans';
import { getRole, requireRole, stronger, workspaceNotFound } from './roles';
import { createWorkspace, getWorkspace, PERSONAL_WORKSPACE_NAME } from './workspaces';

/**
 * Company organisations (BER-148), like Slack: an organisation opened to a domain is found by
 * everyone signing in with a verified address there, and they may join it as members. Addresses
 * count as verified: accounts are only created from addresses the login provider vouches for
 * (`services/accounts`) – but the domain only counts when a login vouches for it too
 * ({@link domainVerified}: not a personal Microsoft account). Mail providers' domains never belong to a company. Someone an admin
 * removed comes back only with an invitation (`workspace_removals`).
 * With `SIGNUP=invite` all of this is off: only invitations lead into organisations.
 */

type DomainDeps = Pick<AppDeps, 'db' | 'config'>;

const domainJoinOff = (deps: Pick<AppDeps, 'config'>) =>
  !domainJoinAllowed(deps.config.auth.signup);

/**
 * The maintained list of free and disposable mail providers (~15 000 domains, `free-email-domains`)
 * on top of the shared short list, which the web app uses only as a hint: this is the check that
 * counts – a company organisation opened to `hotmail.co.uk` would be open to everyone.
 */
const FREE_MAIL = new Set<string>(freeEmailDomains);
export const isCompanyMailDomain = (domain: string) =>
  isCompanyDomain(domain) && !FREE_MAIL.has(domain);

/**
 * Microsoft's tenant of personal accounts: its `preferred_username` is whatever address the
 * account was registered with – no directory vouches for the domain (an ex-employee's personal
 * account under `name@firma.de` would still be one).
 */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** Whether a login's provider vouches for the domain of its address, not just the address. */
export const vouchesForDomain = (identity: { provider: string; subject: string }) =>
  // Nextcloud lets people set their own address (see `routes/auth` `nextcloudIdentity`).
  identity.provider !== 'nextcloud' &&
  !(
    identity.provider === 'microsoft' &&
    identity.subject.startsWith(`${MICROSOFT_CONSUMER_TENANT}:`)
  );

/**
 * Whether the account's domain counts for company organisations: one of its logins vouches for
 * it ({@link vouchesForDomain}) with an address there. Accounts without logins (from before
 * logins existed, dev login) keep counting.
 */
export async function domainVerified(db: Executor, user: UserRow): Promise<boolean> {
  const logins = await db
    .select({
      provider: userIdentities.provider,
      subject: userIdentities.subject,
      email: userIdentities.email,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, user.id));
  const domain = emailDomain(user.email);
  return (
    logins.length === 0 ||
    logins.some(
      (login) => vouchesForDomain(login) && !!login.email && emailDomain(login.email) === domain,
    )
  );
}

/**
 * The removal entry of `user` in the organisation: by account, or by the hash of the address –
 * so deleting the account and signing up again with it doesn't lift it.
 */
const removalOf = (workspaceId: string, user: Pick<UserRow, 'id' | 'email'>) =>
  and(
    eq(workspaceRemovals.workspaceId, workspaceId),
    or(
      eq(workspaceRemovals.userId, user.id),
      eq(workspaceRemovals.emailHash, emailHash(user.email)),
    ),
  );

const wasRemoved = async (db: Executor, workspaceId: string, user: Pick<UserRow, 'id' | 'email'>) =>
  (
    await db
      .select({ workspaceId: workspaceRemovals.workspaceId })
      .from(workspaceRemovals)
      .where(removalOf(workspaceId, user))
      .limit(1)
  ).length > 0;

/**
 * Whether an admin removed `user` after `since`: an invite link from before the removal – maybe
 * the very one they joined with – must not bring them back.
 */
export const removedSince = async (
  db: Executor,
  workspaceId: string,
  user: Pick<UserRow, 'id' | 'email'>,
  since: Date,
) =>
  (
    await db
      .select({ workspaceId: workspaceRemovals.workspaceId })
      .from(workspaceRemovals)
      .where(and(removalOf(workspaceId, user), gt(workspaceRemovals.createdAt, since)))
      .limit(1)
  ).length > 0;

/**
 * Admins remove `user`: back only with an invitation. Replaces an older entry of theirs. `now`
 * from the app's clock, like the invites it is compared with ({@link removedSince}) – not the
 * database's, which may run apart.
 */
export async function recordRemoval(
  tx: Executor,
  workspaceId: string,
  user: Pick<UserRow, 'id' | 'email'>,
  now: Date,
): Promise<void> {
  await liftRemoval(tx, workspaceId, user);
  await tx
    .insert(workspaceRemovals)
    .values({ workspaceId, userId: user.id, emailHash: emailHash(user.email), createdAt: now });
}

/** Invited back into the organisation: the entry ends, by account and by address. */
export async function liftRemoval(
  tx: Executor,
  workspaceId: string,
  user: Pick<UserRow, 'id' | 'email'>,
): Promise<void> {
  await tx.delete(workspaceRemovals).where(removalOf(workspaceId, user));
}

/** The organisation opened to `domain`, if any (and joining by domain is on). */
export async function findDomainWorkspace(
  { db, config }: DomainDeps,
  domain: string,
): Promise<WorkspaceRow | null> {
  if (domainJoinOff({ config }) || !isCompanyMailDomain(domain)) return null;
  // A blocked one (BER-167) takes nobody in: nobody finds it, signs up or logs in through it.
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.joinDomain, domain), isNull(workspaces.blockedAt)));
  return row ?? null;
}

/**
 * For `GET /me`: the company organisation of the user's domain, unless they are in it or were
 * removed from it.
 */
export async function domainWorkspaceFor(
  deps: DomainDeps,
  user: UserRow,
): Promise<DomainWorkspace | null> {
  const { db } = deps;
  const workspace = await findDomainWorkspace(deps, emailDomain(user.email));
  if (!workspace || (await getRole(db, workspace.id, user.id))) return null;
  if (!(await domainVerified(db, user))) return null;
  if (await wasRemoved(db, workspace.id, user)) return null;
  const [members] = await db
    .select({ count: count() })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspace.id));
  return {
    id: workspace.id,
    name: workspace.name,
    logoUrl: workspace.logoKey ? fileUrl(workspace.logoKey) : null,
    domain: workspace.joinDomain ?? '',
    memberCount: members?.count ?? 0,
  };
}

/**
 * Joins the company organisation of the user's domain as member – or with the stronger role of a
 * pending e-mail invite to it, which is used up (it held a seat). Idempotent for members.
 * Someone removed by an admin needs such an invite.
 */
export async function joinByDomain(
  deps: AppDeps,
  user: UserRow,
  workspaceId: string,
): Promise<JoinResult> {
  const now = deps.clock.now();
  const domain = emailDomain(user.email);
  // A mail provider's domain never opens an organisation – also not one opened to it before the
  // list of providers grew (`join_domain` may still hold e.g. `web.de`).
  if (domainJoinOff(deps) || !isCompanyMailDomain(domain)) throw joinNeedsInvite();
  if (!(await domainVerified(deps.db, user))) throw joinNeedsInvite();
  await deps.db.transaction(async (tx) => {
    if (!(await lockWorkspaceRow(tx, workspaceId))) throw workspaceNotFound();
    if (await getRole(tx, workspaceId, user.id)) return;
    const [row] = await tx
      .select({ joinDomain: workspaces.joinDomain, blockedAt: workspaces.blockedAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    // A blocked organisation (BER-167) takes nobody in.
    if (!row?.joinDomain || row.joinDomain !== domain || row.blockedAt) {
      throw joinNeedsInvite();
    }
    const pending = await tx
      .select({
        id: workspaceInvites.id,
        role: workspaceInvites.role,
        deckId: workspaceInvites.deckId,
      })
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.email, user.email.toLowerCase()),
          isNull(workspaceInvites.revokedAt),
          isNull(workspaceInvites.acceptedAt),
          gt(workspaceInvites.expiresAt, now),
        ),
      );
    // Only an invitation to the organisation brings someone removed back, not a deck share.
    const invitedBack = pending.some((invite) => !invite.deckId);
    if (!invitedBack && (await wasRemoved(tx, workspaceId, user))) {
      throw joinNeedsInvite();
    }
    await assertSeatForJoin(tx, deps.config, workspaceId, { reserved: pending.length > 0, now });
    const role = pending.reduce<WorkspaceRole>(
      (best, invite) => stronger(best, invite.role),
      'member',
    );
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId: user.id, role, createdAt: now });
    for (const invite of pending) {
      await tx
        .update(workspaceInvites)
        .set({ acceptedAt: now })
        .where(eq(workspaceInvites.id, invite.id));
    }
    await liftRemoval(tx, workspaceId, user);
  });
  return { workspace: await getWorkspace(deps, user.id, workspaceId), deckId: null };
}

const joinNeedsInvite = () =>
  forbidden('Dieser Organisation kannst du nur mit einer Einladung beitreten.');

const domainTaken = (domain: string) =>
  new ApiError(
    409,
    'domain_taken',
    `Für ${domain} gibt es schon eine Organisation. Tritt ihr bei, statt eine zweite zu öffnen.`,
  );

/**
 * Admins only. Opens the organisation to the admin's own domain (`enabled`) or makes it private.
 * Either answers the sign-up question (`audiencePending`).
 */
export async function setWorkspaceDomain(
  deps: AppDeps,
  user: UserRow,
  workspaceId: string,
  enabled: boolean,
): Promise<Workspace> {
  await requireRole(
    deps.db,
    workspaceId,
    user.id,
    'admin',
    'Nur Admins können den Beitritt per Domain ändern.',
  );
  const domain = emailDomain(user.email);
  if (enabled && domainJoinOff(deps)) {
    throw badRequest(
      'Auf dieser Instanz kommt man nur mit einer Einladung in eine Organisation (SIGNUP=invite).',
    );
  }
  if (enabled && !isCompanyMailDomain(domain)) {
    throw badRequest(
      `${domain} ist ein E-Mail-Anbieter, keine Firma – dafür lässt sich der Beitritt nicht öffnen.`,
    );
  }
  if (enabled && !(await domainVerified(deps.db, user))) {
    throw badRequest(
      `Mit einem privaten Microsoft-Konto lässt sich ${domain} nicht bestätigen – melde dich mit dem Firmenkonto an, um den Beitritt zu öffnen.`,
    );
  }
  try {
    await deps.db
      .update(workspaces)
      .set({ joinDomain: enabled ? domain : null, audiencePending: false })
      .where(eq(workspaces.id, workspaceId));
  } catch (error) {
    if (isUniqueViolation(error)) throw domainTaken(domain);
    throw error;
  }
  return getWorkspace(deps, user.id, workspaceId);
}

/** `firma.de` → `Firma`, `mail.firma.co.uk` → `Firma`. */
export function nameFromDomain(domain: string): string {
  const labels = domain.split('.');
  let index = labels.length - 2;
  if (index > 0 && ['co', 'com', 'org', 'net', 'ac', 'gv', 'or'].includes(labels[index] ?? '')) {
    index -= 1;
  }
  const label = labels[Math.max(index, 0)] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Some organisation – a blocked one too – is opened to the domain. */
async function domainInUse(db: Executor, domain: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.joinDomain, domain))
    .limit(1);
  return row !== undefined;
}

/**
 * A new account (not invited) gets an organisation of its own right away – unless the company
 * of its domain already has one, which the onboarding offers to join. A mail provider's address
 * gets a private one; a company address one named after the company, whose admin is asked
 * whether it is private or the company's.
 */
export async function foundAtSignUp(deps: AppDeps, user: UserRow): Promise<void> {
  const domain = emailDomain(user.email);
  // Only a company address a login vouches for, on an instance with joining by domain, gets the
  // question.
  const company =
    isCompanyMailDomain(domain) && !domainJoinOff(deps) && (await domainVerified(deps.db, user));
  const existing = company ? await findDomainWorkspace(deps, domain) : null;
  if (existing && !(await wasRemoved(deps.db, existing.id, user))) return;
  // Removed from the company's (an earlier account with this address), or the company's is
  // blocked (BER-167): no offer to join it, so a private one of their own – the domain is taken.
  const companyOwn = company && !existing && !(await domainInUse(deps.db, domain));
  await deps.db.transaction(async (tx) => {
    const workspace = await createWorkspace(
      tx,
      user.id,
      companyOwn ? nameFromDomain(domain) : PERSONAL_WORKSPACE_NAME,
      deps.clock.now(),
    );
    if (companyOwn) {
      await tx
        .update(workspaces)
        .set({ audiencePending: true })
        .where(eq(workspaces.id, workspace.id));
    }
  });
}
