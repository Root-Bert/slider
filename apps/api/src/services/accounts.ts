import { and, count, eq, sql } from 'drizzle-orm';
import { ACCENT_COLORS, emailDomain, type LoginError } from '@slider/shared';
import { advisoryXactLock, type Executor, type Transaction } from '../db/client';
import {
  decks,
  media,
  passkeys,
  userIdentities,
  users,
  workspaceMembers,
  type IdentityProvider,
  type UserRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { isUniqueViolation } from '../http/errors';
import { instanceClaimed, removeSetupToken, setupTokenMatches } from './instance-settings';
import {
  effectiveState,
  findDomainWorkspace,
  findInviteByToken,
  foundAtSignUp,
  hasPendingEmailInvite,
} from './workspaces';
import { vouchesForDomain } from './workspaces/domains';

/**
 * Accounts (BER-129): who an identity from a login provider is, and whether it may sign up.
 *
 * Linking rules – never silently merge two accounts:
 * - a known identity (provider + subject) always signs into its account;
 * - signing in never makes anyone instance admin: a new login creates a normal account under the
 *   `SIGNUP` rules – or, while the instance has no admin yet, for anyone; such an account can do
 *   nothing until it enters the setup token from the server log ({@link claimInstance}, which
 *   also takes over the dev owner's decks; see `auth/instance-gate`);
 * - Microsoft/Google/OIDC attach to an existing account by e-mail only while that account has no
 *   login yet (e.g. created before logins existed); otherwise `account_exists`. Signed in, a
 *   person can link another provider explicitly ({@link linkIdentity}, "Verbinden" on /konto).
 * - Passkeys are no identities: they only sign into accounts that exist (`routes/passkeys`).
 */

export interface IdentityInput {
  provider: IdentityProvider;
  subject: string;
  /** As reported by the provider; `null` if it sent none. */
  email: string | null;
  /** The provider vouches for the address (OIDC `email_verified`, Microsoft UPN). */
  emailVerified: boolean;
  name: string | null;
  /** From a `/join/<token>` return path: lets invited people sign up. */
  inviteToken: string | null;
}

/** `created`: this login is new to the account – just made, or an old account claimed with it. */
export type SignInResult =
  { ok: true; user: UserRow; created: boolean } | { ok: false; error: LoginError };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** `/join/<token>` (optionally with a query) → the token. */
export function inviteTokenFromPath(path: string | undefined): string | null {
  const match = /^\/join\/([\w-]{16,})(?:[/?#]|$)/.exec(path ?? '');
  return match?.[1] ?? null;
}

export async function findUserByEmail(db: Executor, email: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return row ?? null;
}

/** Ways into the account: provider identities and passkeys. */
export async function loginCount(db: Executor, userId: string): Promise<number> {
  const [identities] = await db
    .select({ count: count() })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId));
  const [keys] = await db
    .select({ count: count() })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
  return (identities?.count ?? 0) + (keys?.count ?? 0);
}

/**
 * Whether a person without an account may create one: an invitation (pending for the address or
 * the link they came through), `SIGNUP=open`, `SIGNUP=domains` with a verified address of the
 * list, or `SIGNUP=company` with a verified address at a domain an organisation is opened to
 * (BER-148). `SIGNUP=invite` is only invitations. The domain rules also need the login to vouch
 * for the domain (`domainVouched`, not a personal Microsoft account – `vouchesForDomain`).
 */
export async function maySignUp(
  deps: AppDeps,
  email: string,
  emailVerified: boolean,
  inviteToken: string | null,
  domainVouched = emailVerified,
): Promise<{ allowed: boolean; viaInvite: boolean }> {
  const now = deps.clock.now();
  if (emailVerified && (await hasPendingEmailInvite(deps.db, email, now))) {
    return { allowed: true, viaInvite: true };
  }
  if (inviteToken) {
    const invite = await findInviteByToken(deps.db, inviteToken);
    if (
      invite &&
      (await effectiveState(deps.db, invite, now)) === 'valid' &&
      (!invite.email || (emailVerified && invite.email === email))
    ) {
      return { allowed: true, viaInvite: true };
    }
  }
  const { signup, signupDomains } = deps.config.auth;
  if (signup === 'open') return { allowed: true, viaInvite: false };
  // An organisation opened to the domain invites everyone there – its admins chose so.
  if (
    signup === 'company' &&
    emailVerified &&
    domainVouched &&
    (await findDomainWorkspace(deps, emailDomain(email)))
  ) {
    return { allowed: true, viaInvite: false };
  }
  if (
    signup === 'domains' &&
    emailVerified &&
    domainVouched &&
    signupDomains.includes(emailDomain(email))
  ) {
    return { allowed: true, viaInvite: false };
  }
  return { allowed: false, viaInvite: false };
}

const randomColor = () => ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)] ?? 'red';

/** Resolves (or creates) the account for a login; see the rules at the top of this file. */
export async function signInWithIdentity(
  deps: AppDeps,
  input: IdentityInput,
  retry = true,
): Promise<SignInResult> {
  const { db } = deps;
  const now = deps.clock.now();
  const email = input.email ? normalizeEmail(input.email) : null;

  const [known] = await db
    .select({ user: users })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(
      and(eq(userIdentities.provider, input.provider), eq(userIdentities.subject, input.subject)),
    );
  if (known) {
    if (email) {
      await db
        .update(userIdentities)
        .set({ email })
        .where(
          and(
            eq(userIdentities.provider, input.provider),
            eq(userIdentities.subject, input.subject),
          ),
        );
    }
    if (known.user.blockedAt) return { ok: false, error: 'account_blocked' };
    return { ok: true, user: known.user, created: false };
  }

  if (!email) return { ok: false, error: 'no_email' };
  const attach = async (user: UserRow, executor: Executor = db) => {
    await executor.insert(userIdentities).values({
      provider: input.provider,
      subject: input.subject,
      userId: user.id,
      email,
      createdAt: now,
    });
    return { ok: true as const, user, created: true };
  };

  if (!input.emailVerified) return { ok: false, error: 'email_unverified' };

  const allowed = () => signUpAllowed(deps, email, input);

  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (existing.blockedAt) return { ok: false, error: 'account_blocked' };
    // A passkey is a login too: a passkey-only account is never attached to by e-mail.
    if ((await loginCount(db, existing.id)) > 0) return { ok: false, error: 'account_exists' };
    // An account from before logins existed: it may be claimed like a new sign-up.
    if (!(await allowed())) return { ok: false, error: 'signup_closed' };
    return attach(existing);
  }

  const signup = await allowed();
  if (!signup) return { ok: false, error: 'signup_closed' };
  let user: UserRow;
  try {
    // Account and identity together: a second, simultaneous first login waits for both.
    user = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          name: input.name?.trim() || email.slice(0, email.indexOf('@')),
          email,
          color: randomColor(),
          createdAt: now,
        })
        .returning();
      if (!row) throw new Error('User insert returned no row');
      await attach(row, tx);
      return row;
    });
  } catch (error) {
    // The same new login twice at once (two tabs, a double click): the other one created the
    // account – sign into it like any known identity (once; a second clash is a real error).
    if (!retry || !isUniqueViolation(error)) throw error;
    return signInWithIdentity(deps, input, false);
  }
  const result = { ok: true as const, user, created: true };
  // Invited people land in the inviting organisation (the onboarding offers their invitations);
  // everyone else gets one of their own, unless their company already has one (BER-148).
  if (!signup.viaInvite) await foundAtSignUp(deps, user);
  return result;
}

/**
 * Sign-in through an organisation's company login (BER-162). Its provider vouches for every
 * address at the organisation's domain – proven by a DNS record, so whoever runs the provider
 * runs the domain – and so, unlike other logins, it also signs into an existing account at that
 * domain that signs in another way, and becomes one of its logins. Addresses elsewhere are
 * refused before (`routes/auth`).
 */
export async function signInWithCompanySso(
  deps: AppDeps,
  input: IdentityInput,
  domain: string,
): Promise<SignInResult> {
  const email = input.email ? normalizeEmail(input.email) : null;
  if (!email || emailDomain(email) !== domain) return { ok: false, error: 'sso_domain' };
  const result = await signInWithIdentity(deps, input);
  if (result.ok || result.error !== 'account_exists') return result;
  const existing = await findUserByEmail(deps.db, email);
  // A blocked account never gets here: `signInWithIdentity` refuses it before `account_exists`.
  if (!existing) return result;
  const linked = await linkIdentity(deps, existing.id, input);
  return linked.ok ? { ok: true, user: existing, created: false } : linked;
}

/** `null`: closed; else whether an invitation leads them in. */
async function signUpAllowed(
  deps: AppDeps,
  email: string,
  input: IdentityInput,
): Promise<{ viaInvite: boolean } | null> {
  const signup = await maySignUp(deps, email, true, input.inviteToken, vouchesForDomain(input));
  if (signup.allowed) return { viaInvite: signup.viaInvite };
  // No instance admin yet: anyone may sign up – the new account can't do anything before it
  // enters the setup token (`auth/instance-gate`), and the first one to do so is admin.
  if (deps.config.auth.devLogin || (await instanceClaimed(deps.db))) return null;
  deps.log.info(`Sign-up of ${email} on an unclaimed instance (SIGNUP=${deps.config.auth.signup})`);
  return { viaInvite: false };
}

/**
 * Whether {@link signInWithIdentity} would let this new identity in once its address is
 * confirmed – before a confirmation mail goes out (`services/nextcloud-signup`). `null`: yes.
 */
export async function signUpBlocked(
  deps: AppDeps,
  input: IdentityInput,
): Promise<LoginError | null> {
  if (!input.email) return 'no_email';
  const email = normalizeEmail(input.email);
  const existing = await findUserByEmail(deps.db, email);
  if (existing && (await loginCount(deps.db, existing.id)) > 0) return 'account_exists';
  return (await signUpAllowed(deps, email, input)) ? null : 'signup_closed';
}

export type ClaimResult = { ok: true } | { ok: false; error: 'claimed' | 'invalid_token' };

/**
 * Makes the account instance admin with the one-time setup token from the server log – the only
 * way to become admin. Under a lock, so two claims at once can't both win; the token is gone
 * afterwards (single use). The account takes over the dev owner's decks and organisations when
 * there is one nobody can sign in as (decks made in development before logins existed).
 */
export async function claimInstance(
  deps: AppDeps,
  userId: string,
  token: string | undefined,
): Promise<ClaimResult> {
  const result = await deps.db.transaction(async (tx): Promise<ClaimResult> => {
    await advisoryXactLock(tx, 'instance-bootstrap');
    if (await instanceClaimed(tx)) return { ok: false, error: 'claimed' };
    if (!setupTokenMatches(deps.config.dataDir, token)) {
      return { ok: false, error: 'invalid_token' };
    }
    const [admin] = await tx
      .update(users)
      .set({ isInstanceAdmin: true })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    // The account vanished meanwhile: nobody became admin, so the token stays valid.
    if (!admin) return { ok: false, error: 'invalid_token' };
    await adoptDevOwner(deps, tx, userId);
    return { ok: true };
  });
  if (result.ok) {
    removeSetupToken(deps.config.dataDir);
    deps.log.info(`Instance claimed with the setup token: ${userId} is instance admin`);
  }
  return result;
}

/**
 * The dev owner's decks (and its recordings' quota) move to the new admin, who joins its
 * organisations as admin. Only while nobody can sign in as the dev owner – an account with a login
 * of its own keeps what is its own.
 */
async function adoptDevOwner(deps: AppDeps, tx: Transaction, userId: string): Promise<void> {
  const devOwner = await findUserByEmail(tx, normalizeEmail(deps.config.devOwner.email));
  if (!devOwner || devOwner.id === userId || (await loginCount(tx, devOwner.id)) > 0) return;
  const now = deps.clock.now();
  const memberships = await tx
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, devOwner.id));
  for (const { workspaceId } of memberships) {
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: 'admin', createdAt: now })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role: 'admin' },
      });
  }
  const moved = await tx
    .update(decks)
    // The dev owner's connections are not the new owner's: the decks try the new owner's own.
    // Whoever claims the instance linked them as the dev owner, so they stay the linker.
    .set({
      ownerId: userId,
      linkedById: userId,
      microsoftConnectionId: null,
      nextcloudConnectionId: null,
      googleConnectionId: null,
    })
    .where(eq(decks.ownerId, devOwner.id))
    .returning({ id: decks.id });
  await tx.update(media).set({ ownerId: userId }).where(eq(media.ownerId, devOwner.id));
  if (memberships.length > 0 || moved.length > 0) {
    deps.log.info(
      `Instance claim: ${userId} took over ${moved.length} deck(s) and ${memberships.length} organisation(s) of the dev owner ${devOwner.id}`,
    );
  }
}

/**
 * Links a provider identity to the signed-in account ("Google verbinden" on /konto). Refused
 * when the identity already belongs to someone else – never moves logins between accounts.
 */
export async function linkIdentity(
  deps: AppDeps,
  userId: string,
  input: Pick<IdentityInput, 'provider' | 'subject' | 'email'>,
): Promise<{ ok: true } | { ok: false; error: LoginError }> {
  const [existing] = await deps.db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(eq(userIdentities.provider, input.provider), eq(userIdentities.subject, input.subject)),
    );
  if (existing)
    return existing.userId === userId ? { ok: true } : { ok: false, error: 'account_exists' };
  await deps.db.insert(userIdentities).values({
    provider: input.provider,
    subject: input.subject,
    userId,
    email: input.email ? normalizeEmail(input.email) : null,
    createdAt: deps.clock.now(),
  });
  return { ok: true };
}

/** How the account signs in, oldest first (`GET /me/identities`). */
export async function listIdentities(db: Executor, userId: string) {
  const rows = await db
    .select({
      provider: userIdentities.provider,
      subject: userIdentities.subject,
      email: userIdentities.email,
      createdAt: userIdentities.createdAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .orderBy(userIdentities.createdAt);
  return rows.map(({ subject, ...row }) => ({ id: `${row.provider}:${subject}`, ...row }));
}

export type UnlinkResult = { ok: true } | { ok: false; error: 'not_found' | 'last_login' };

/**
 * Removes a provider login from the account ("Trennen" on /konto). Only while another login
 * identity remains: passkeys don't count, they only sign into an account that has a login. Under
 * the same per-account lock as {@link deletePasskey}, so two unlinks at once can't both see the
 * other as the remaining one. The Microsoft file access stays; it is disconnected on its own
 * (`DELETE /me/microsoft/:id`). Sessions don't record their login, so they stay too.
 */
export async function unlinkIdentity(
  deps: Pick<AppDeps, 'db'>,
  userId: string,
  id: string,
): Promise<UnlinkResult> {
  const split = id.indexOf(':');
  if (split <= 0) return { ok: false, error: 'not_found' };
  const provider = id.slice(0, split) as IdentityProvider;
  const subject = id.slice(split + 1);
  return deps.db.transaction(async (tx): Promise<UnlinkResult> => {
    await advisoryXactLock(tx, `identities:${userId}`);
    const own = await tx
      .select({ provider: userIdentities.provider, subject: userIdentities.subject })
      .from(userIdentities)
      .where(eq(userIdentities.userId, userId));
    if (!own.some((row) => row.provider === provider && row.subject === subject)) {
      return { ok: false, error: 'not_found' };
    }
    if (own.length <= 1) return { ok: false, error: 'last_login' };
    await tx
      .delete(userIdentities)
      .where(
        and(
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, provider),
          eq(userIdentities.subject, subject),
        ),
      );
    return { ok: true };
  });
}

export type RemovePasskeyResult = UnlinkResult;

/**
 * Deletes one of the account's passkeys ("Entfernen" on /konto). Never the last way in – under a
 * per-account lock, so two removals at once (or an unlink, {@link unlinkIdentity}) can't race it.
 * The dev owner in dev-login mode always has a way in.
 */
export async function deletePasskey(
  deps: AppDeps,
  userId: string,
  id: string,
): Promise<RemovePasskeyResult> {
  return deps.db.transaction(async (tx): Promise<RemovePasskeyResult> => {
    await advisoryXactLock(tx, `identities:${userId}`);
    const [row] = await tx
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)));
    if (!row) return { ok: false, error: 'not_found' };
    const devLogin = deps.config.auth.devLogin && userId === deps.ownerId;
    if (!devLogin && (await loginCount(tx, userId)) <= 1) return { ok: false, error: 'last_login' };
    await tx.delete(passkeys).where(eq(passkeys.id, row.id));
    return { ok: true };
  });
}
