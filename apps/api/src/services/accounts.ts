import { and, count, eq, sql } from 'drizzle-orm';
import { ACCENT_COLORS, type LoginError } from '@slider/shared';
import { advisoryXactLock, type Executor } from '../db/client';
import { userIdentities, users, type IdentityProvider, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import {
  ensurePersonalWorkspace,
  findInviteByToken,
  hasPendingEmailInvite,
  inviteState,
} from './workspaces';

/**
 * Accounts (BER-129): who an identity from a login provider is, and whether it may sign up.
 *
 * Linking rules – never silently merge two accounts:
 * - a known identity (provider + subject) always signs into its account;
 * - the very first login of the instance adopts the dev owner (and its decks) – if
 *   `mayBootstrap` lets this address claim the instance;
 * - a magic link signs into the account with that e-mail – the mail proves the mailbox;
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
  /** The provider vouches for the address (OIDC `email_verified`, Microsoft UPN, magic link). */
  emailVerified: boolean;
  name: string | null;
  /** From a `/join/<token>` return path: lets invited people sign up. */
  inviteToken: string | null;
}

export type SignInResult = { ok: true; user: UserRow } | { ok: false; error: LoginError };

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** `/join/<token>` (optionally with a query) → the token. */
export function inviteTokenFromPath(path: string | undefined): string | null {
  const match = /^\/join\/([\w-]{16,})(?:[/?#]|$)/.exec(path ?? '');
  return match?.[1] ?? null;
}

const emailDomain = (email: string) => email.slice(email.lastIndexOf('@') + 1);

async function findUserByEmail(db: Executor, email: string): Promise<UserRow | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  return row ?? null;
}

async function identityCount(db: Executor, userId?: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(userIdentities)
    .where(userId ? eq(userIdentities.userId, userId) : undefined);
  return row?.count ?? 0;
}

/**
 * Whether a person without an account may create one: an invitation (pending for the address or
 * the link they came through), `SIGNUP=open`, or `SIGNUP=domains` with a verified address.
 */
export async function maySignUp(
  deps: AppDeps,
  email: string,
  emailVerified: boolean,
  inviteToken: string | null,
): Promise<{ allowed: boolean; viaInvite: boolean }> {
  const now = deps.clock.now();
  if (emailVerified && (await hasPendingEmailInvite(deps.db, email, now))) {
    return { allowed: true, viaInvite: true };
  }
  if (inviteToken) {
    const invite = await findInviteByToken(deps.db, inviteToken);
    if (
      invite &&
      inviteState(invite, now) === 'valid' &&
      (!invite.email || (emailVerified && invite.email === email))
    ) {
      return { allowed: true, viaInvite: true };
    }
  }
  const { signup, signupDomains } = deps.config.auth;
  if (signup === 'open') return { allowed: true, viaInvite: false };
  if (signup === 'domains' && emailVerified && signupDomains.includes(emailDomain(email))) {
    return { allowed: true, viaInvite: false };
  }
  return { allowed: false, viaInvite: false };
}

/**
 * Whether this address may create the very first account (instance admin, adopts the dev owner).
 * `BOOTSTRAP_EMAIL` set: only those verified addresses. Unset: anyone in development; in
 * production only who `SIGNUP=open`/`domains` would admit anyway – on a public instance with
 * Microsoft `common` a stranger must not be able to claim it.
 */
export function mayBootstrap(deps: AppDeps, email: string, emailVerified: boolean): boolean {
  const { bootstrapEmails, signup, signupDomains } = deps.config.auth;
  if (bootstrapEmails.length > 0) return emailVerified && bootstrapEmails.includes(email);
  if (deps.config.env !== 'production') return true;
  if (!emailVerified) return false;
  if (signup === 'open') return true;
  return signup === 'domains' && signupDomains.includes(emailDomain(email));
}

/** Whether a magic link may be sent to this address (no mail to people who could not sign in). */
export async function mayReceiveLoginLink(
  deps: AppDeps,
  email: string,
  inviteToken: string | null,
): Promise<boolean> {
  if ((await identityCount(deps.db)) === 0) return mayBootstrap(deps, email, true);
  if (await findUserByEmail(deps.db, email)) return true;
  return (await maySignUp(deps, email, true, inviteToken)).allowed;
}

const randomColor = () => ACCENT_COLORS[Math.floor(Math.random() * ACCENT_COLORS.length)] ?? 'red';

/** Resolves (or creates) the account for a login; see the rules at the top of this file. */
export async function signInWithIdentity(
  deps: AppDeps,
  input: IdentityInput,
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
    return { ok: true, user: known.user };
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
    return { ok: true as const, user };
  };

  // Bootstrap: the first login of the instance claims the dev owner's account and decks. Checked
  // again under a lock, so two simultaneous first logins can't both become instance admin – the
  // later one finds an identity and follows the usual rules.
  if ((await identityCount(db)) === 0) {
    const bootstrapped = await db.transaction(async (tx): Promise<SignInResult | null> => {
      await advisoryXactLock(tx, 'instance-bootstrap');
      if ((await identityCount(tx)) > 0) return null;
      if (!mayBootstrap(deps, email, input.emailVerified)) {
        deps.log.warn(`Bootstrap refused for ${email}: not allowed to claim this instance`);
        return {
          ok: false,
          error:
            !input.emailVerified && mayBootstrap(deps, email, true)
              ? 'email_unverified'
              : 'signup_closed',
        };
      }
      return attach(await bootstrapAccount(deps, tx, input, email), tx);
    });
    if (bootstrapped) return bootstrapped;
  }

  if (!input.emailVerified) return { ok: false, error: 'email_unverified' };

  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (input.provider === 'email') return attach(existing);
    if ((await identityCount(db, existing.id)) > 0) return { ok: false, error: 'account_exists' };
    // An account from before logins existed: it may be claimed like a new sign-up.
    if (!(await maySignUp(deps, email, true, input.inviteToken)).allowed) {
      return { ok: false, error: 'signup_closed' };
    }
    return attach(existing);
  }

  const policy = await maySignUp(deps, email, input.emailVerified, input.inviteToken);
  if (!policy.allowed) return { ok: false, error: 'signup_closed' };
  // No organisation yet (BER-130): the onboarding offers to found one or to join by invitation.
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      name: input.name?.trim() || email.slice(0, email.indexOf('@')),
      email,
      color: randomColor(),
      createdAt: now,
    })
    .returning();
  if (!user) throw new Error('User insert returned no row');
  return attach(user);
}

/**
 * The first account of the instance (instance admin). Adopts the dev owner row when there is
 * one, so the person keeps every deck they created before logins existed.
 */
async function bootstrapAccount(
  deps: AppDeps,
  db: Executor,
  input: IdentityInput,
  email: string,
): Promise<UserRow> {
  const now = deps.clock.now();
  const devOwner = await findUserByEmail(db, normalizeEmail(deps.config.devOwner.email));
  if (devOwner) {
    const taken = email !== normalizeEmail(devOwner.email) && (await findUserByEmail(db, email));
    if (taken) {
      deps.log.warn(
        `Bootstrap: ${email} belongs to another user row; keeping the dev owner address`,
      );
    }
    const [row] = await db
      .update(users)
      .set({
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(taken ? {} : { email }),
        isInstanceAdmin: true,
      })
      .where(eq(users.id, devOwner.id))
      .returning();
    if (!row) throw new Error('Dev owner vanished during bootstrap');
    await ensurePersonalWorkspace(db, row.id, now);
    deps.log.info(`First login: ${email} adopted the dev owner account ${row.id}`);
    return row;
  }
  const [row] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      name: input.name?.trim() || email.slice(0, email.indexOf('@')),
      email,
      color: randomColor(),
      isInstanceAdmin: true,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('User insert returned no row');
  return row;
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
export function listIdentities(db: Executor, userId: string) {
  return db
    .select({
      provider: userIdentities.provider,
      email: userIdentities.email,
      createdAt: userIdentities.createdAt,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .orderBy(userIdentities.createdAt);
}
