import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import type { Context } from 'hono';
import { ACCOUNT_HEADER } from '@slider/shared';
import { sessions, users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { markActive } from '../services/users';
import { companyLoginRequired } from '../services/workspaces/sso';
import { readCookie, removeCookie, writeCookie } from './cookies';

/**
 * Login sessions (BER-129). The cookie carries 256 random bits; the database only knows their
 * SHA-256, so neither a database dump nor a log line can be replayed as a cookie. In production
 * the browser sees it as `__Host-slider_session` (see ./cookies).
 */
export const SESSION_COOKIE = 'slider_session';
/**
 * The other accounts signed in on this browser: their session tokens, `.`-separated (base64url
 * has none). Signing in while signed in keeps the account one was in here; switching swaps a
 * token with the session cookie – no signing out and in for a second account.
 */
export const ACCOUNTS_COOKIE = 'slider_accounts';
/** Accounts kept beside the one in use; signing in to one more lets go of the oldest. */
export const MAX_OTHER_ACCOUNTS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Sliding expiry, but at most one write per session and day. */
const RENEW_AFTER_MS = DAY_MS;
/**
 * However often it is used, a session ends this long after its login: a cookie that leaked (an
 * old laptop, a shared computer) stops working at some point. Then the browser signs in anew.
 */
export const SESSION_MAX_AGE_MS = 90 * DAY_MS;

/** 256 random bits, URL-safe – for session cookies, magic links and invite links. */
export const newSecretToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const ttlMs = (deps: AppDeps) => deps.config.auth.sessionTtlDays * DAY_MS;

/** When a session used `now` expires: the sliding TTL, capped by {@link SESSION_MAX_AGE_MS}. */
const expiryFrom = (deps: AppDeps, createdAt: Date, now: Date) =>
  new Date(Math.min(now.getTime() + ttlMs(deps), createdAt.getTime() + SESSION_MAX_AGE_MS));

/**
 * The cookie is set when a session comes to this browser and never again: it lives as long as a
 * session ever can ({@link SESSION_MAX_AGE_MS}), the server alone says when one ends. Renewing it
 * with every answer let a request still on its way put its account back over one just switched to.
 */
function setSessionCookie(c: Context, deps: AppDeps, token: string): void {
  writeCookie(c, deps.config, SESSION_COOKIE, token, {
    sameSite: 'Lax',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export const accountBlocked = () =>
  new ApiError(
    403,
    'account_blocked',
    'Dieses Konto wurde von der Person gesperrt, die Office hier betreibt.',
  );

/**
 * A new session for `userId`: its token (to hand out once) and when it expires. A blocked
 * account (BER-167) never gets one – the logins refuse it before with `account_blocked`, this is
 * the last line.
 */
export async function createSession(
  deps: AppDeps,
  userId: string,
  userAgent: string | undefined,
): Promise<{ token: string; now: Date; expiresAt: Date }> {
  const [user] = await deps.db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.blockedAt) throw accountBlocked();
  const token = newSecretToken();
  const now = deps.clock.now();
  const expiresAt = expiryFrom(deps, now, now);
  await deps.db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    userAgent: userAgent?.slice(0, 500) ?? null,
  });
  await markActive(deps.db, userId, now);
  return { token, now, expiresAt };
}

/** The address's workspace allows its company login alone („Nur Firmen-Login“). */
export const companyLoginOnly = () =>
  new ApiError(
    403,
    'sso_required',
    'Für Adressen eurer Firma gilt nur der Firmen-Login. Melde dich mit „Mit Firmen-Login anmelden“ an.',
  );

/**
 * Signs `userId` in on this browser (see {@link createSession}). Another account signed in here
 * stays, to switch back to; this account's older session here ends (not the desktop app's).
 * Any way in but the company login (`companyLogin`) is refused for an address whose workspace
 * allows that alone („Nur Firmen-Login“) – the one place every login passes.
 */
export async function startSession(
  c: Context,
  deps: AppDeps,
  userId: string,
  { companyLogin = false }: { companyLogin?: boolean } = {},
): Promise<void> {
  if (!companyLogin) {
    const [user] = await deps.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (user && (await companyLoginRequired(deps, user.email))) throw companyLoginOnly();
  }
  const previous = readCookie(c, deps.config, SESSION_COOKIE);
  const { token } = await createSession(deps, userId, c.req.header('user-agent'));
  setSessionCookie(c, deps, token);
  await keepAccounts(c, deps, [...(previous ? [previous] : []), ...otherTokens(c, deps)], userId);
}

/** Only what a token looks like, and no more than the cookie ever holds (it is anyone's to send). */
const otherTokens = (c: Context, deps: AppDeps) =>
  (readCookie(c, deps.config, ACCOUNTS_COOKIE) ?? '')
    .split('.', MAX_OTHER_ACCOUNTS + 2)
    .filter((token) => /^[A-Za-z0-9_-]{43}$/.test(token));

/** Live sessions of `tokens` with their accounts, in that order – expired or blocked ones left out. */
async function liveSessions(deps: AppDeps, tokens: readonly string[]) {
  if (tokens.length === 0) return [];
  const now = deps.clock.now();
  const rows = await deps.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        inArray(sessions.tokenHash, tokens.map(hashToken)),
        gt(sessions.expiresAt, now),
        gt(sessions.createdAt, new Date(now.getTime() - SESSION_MAX_AGE_MS)),
        isNull(users.blockedAt),
      ),
    );
  const byHash = new Map(rows.map((row) => [row.session.tokenHash, row]));
  return tokens.flatMap((token) => {
    const row = byHash.get(hashToken(token));
    return row ? [{ token, ...row }] : [];
  });
}

/**
 * The desktop app's sessions (`routes/desktop-login`): held by the app itself, outside any cookie
 * – its pages' cookie only carries a copy, so letting go of one here never ends it.
 */
export const DESKTOP_USER_AGENT = 'Slider Desktop';

/**
 * Writes `tokens` as the other accounts of this browser: live ones, one per account, never the
 * one in use (`activeUserId`). What is let go of – a second session of an account, one account
 * too many – ends, so nothing signed in here outlives its place in the cookie.
 */
async function keepAccounts(
  c: Context,
  deps: AppDeps,
  tokens: readonly string[],
  activeUserId: string,
): Promise<void> {
  const kept: string[] = [];
  const seen = new Set([activeUserId]);
  const ended: string[] = [];
  for (const { token, user, session } of await liveSessions(deps, tokens)) {
    if (seen.has(user.id) || kept.length === MAX_OTHER_ACCOUNTS) {
      if (session.userAgent !== DESKTOP_USER_AGENT) ended.push(session.id);
      continue;
    }
    seen.add(user.id);
    kept.push(token);
  }
  if (ended.length > 0) await deps.db.delete(sessions).where(inArray(sessions.id, ended));
  if (kept.length === 0) removeCookie(c, deps.config, ACCOUNTS_COOKIE);
  else
    writeCookie(c, deps.config, ACCOUNTS_COOKIE, kept.join('.'), {
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });
}

/**
 * The other accounts signed in on this browser – those whose session still lives, one per
 * account, never the one in use. Only read: a cookie written from a list asked for before a
 * switch would undo the switch's.
 */
export async function otherAccounts(c: Context, deps: AppDeps): Promise<UserRow[]> {
  const tokens = otherTokens(c, deps);
  if (tokens.length === 0) return [];
  const active = await loadSessionUser(c, deps, { readOnly: true });
  const seen = new Set(active ? [active.id] : []);
  return (await liveSessions(deps, tokens))
    .filter(({ user }) => !seen.has(user.id) && Boolean(seen.add(user.id)))
    .map(({ user }) => user);
}

/**
 * Signs `userId` out, another account signed in on this browser: its session ends, the one in
 * use stays. `false` if it is not signed in here (any more).
 */
export async function endOtherAccount(c: Context, deps: AppDeps, userId: string): Promise<boolean> {
  const active = await loadSessionUser(c, deps, { readOnly: true });
  const live = await liveSessions(deps, otherTokens(c, deps));
  const gone = live.filter(({ user }) => user.id === userId);
  if (!active || gone.length === 0) return false;
  await deps.db.delete(sessions).where(
    inArray(
      sessions.id,
      gone.map(({ session }) => session.id),
    ),
  );
  await keepAccounts(
    c,
    deps,
    live.filter(({ user }) => user.id !== userId).map(({ token }) => token),
    active.id,
  );
  return true;
}

/**
 * Switches this browser to `userId`, another account signed in here: its session becomes the
 * one in use, the current one waits among the others. `false` if it is not signed in here (any
 * more).
 */
export async function switchAccount(c: Context, deps: AppDeps, userId: string): Promise<boolean> {
  const current = readCookie(c, deps.config, SESSION_COOKIE);
  const others = otherTokens(c, deps);
  const target = (await liveSessions(deps, others)).find(({ user }) => user.id === userId);
  if (!target) return false;
  setSessionCookie(c, deps, target.token);
  await keepAccounts(
    c,
    deps,
    [...(current ? [current] : []), ...others.filter((token) => token !== target.token)],
    userId,
  );
  return true;
}

/** Ends the session of `token` – the desktop app's, which holds it outside any cookie. */
export async function endSessionToken(deps: AppDeps, token: string): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export interface LoadSessionOptions {
  /**
   * Only look: never renew, never set or drop the cookie. For checks on a response that is
   * already being sent (the live stream), where a cookie write would throw.
   */
  readOnly?: boolean;
}

/**
 * The signed-in user, or `null`; renews the session (and its cookie) at most once a day, but
 * never past {@link SESSION_MAX_AGE_MS} after its login.
 */
export async function loadSessionUser(
  c: Context,
  deps: AppDeps,
  { readOnly = false }: LoadSessionOptions = {},
): Promise<UserRow | null> {
  const token = readCookie(c, deps.config, SESSION_COOKIE);
  if (!token) return null;
  const now = deps.clock.now();
  const [row] = await deps.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, now),
        // Sessions from before the cap may still expire later: they end on time all the same.
        gt(sessions.createdAt, new Date(now.getTime() - SESSION_MAX_AGE_MS)),
        // Blocking deletes the sessions too; this also ends one that slipped in meanwhile.
        isNull(users.blockedAt),
      ),
    );
  if (!row) {
    // Expired, logged out elsewhere or unknown: drop the stale cookie – on to another account
    // signed in here, if there is one. Never under a page loaded for an account
    // (`ACCOUNT_HEADER`): it gets 401 and loads anew, and only that load hands over.
    if (readOnly || c.req.header(ACCOUNT_HEADER)) return null;
    removeCookie(c, deps.config, SESSION_COOKIE);
    return nextAccount(c, deps);
  }
  if (readOnly) return row.user;
  if (now.getTime() - row.session.lastSeenAt.getTime() >= RENEW_AFTER_MS) {
    const expiresAt = expiryFrom(deps, row.session.createdAt, now);
    await deps.db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, row.session.id));
    await markActive(deps.db, row.user.id, now);
  }
  return row.user;
}

/** The first other account still signed in here becomes the one in use; `null` if none. */
async function nextAccount(c: Context, deps: AppDeps): Promise<UserRow | null> {
  const [next, ...rest] = await liveSessions(deps, otherTokens(c, deps));
  if (!next) {
    removeCookie(c, deps.config, ACCOUNTS_COOKIE);
    return null;
  }
  setSessionCookie(c, deps, next.token);
  await keepAccounts(
    c,
    deps,
    rest.map(({ token }) => token),
    next.user.id,
  );
  return next.user;
}

/**
 * Ends the session in use on this browser (its account deleted, for one): deletes its row and
 * cookie; another account signed in here takes over.
 */
export async function endSession(c: Context, deps: AppDeps): Promise<void> {
  const token = readCookie(c, deps.config, SESSION_COOKIE);
  if (token) await deps.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  removeCookie(c, deps.config, SESSION_COOKIE);
  await nextAccount(c, deps);
}

/** „Abmelden“: signs every account on this browser out – a shared computer is left clean. */
export async function endAllSessions(c: Context, deps: AppDeps): Promise<void> {
  const tokens = [readCookie(c, deps.config, SESSION_COOKIE), ...otherTokens(c, deps)].filter(
    (token): token is string => Boolean(token),
  );
  if (tokens.length > 0)
    await deps.db.delete(sessions).where(inArray(sessions.tokenHash, tokens.map(hashToken)));
  removeCookie(c, deps.config, SESSION_COOKIE);
  removeCookie(c, deps.config, ACCOUNTS_COOKIE);
}

/**
 * Signs the account out everywhere but in this browser: after it removed a login or a passkey,
 * whoever signed in with that one elsewhere is out too.
 */
export async function endOtherSessions(c: Context, deps: AppDeps, userId: string): Promise<void> {
  const token = readCookie(c, deps.config, SESSION_COOKIE);
  await deps.db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        token ? ne(sessions.tokenHash, hashToken(token)) : undefined,
      ),
    );
}

/** When this browser signed in – `null` without a session (the dev login). */
export async function signedInAt(c: Context, deps: AppDeps): Promise<Date | null> {
  const token = readCookie(c, deps.config, SESSION_COOKIE);
  if (!token) return null;
  const [row] = await deps.db
    .select({ createdAt: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)));
  return row?.createdAt ?? null;
}
