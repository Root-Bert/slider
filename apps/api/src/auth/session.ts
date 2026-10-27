import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { Context } from 'hono';
import { sessions, users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { markActive } from '../services/users';
import { readCookie, removeCookie, writeCookie } from './cookies';

/**
 * Login sessions (BER-129). The cookie carries 256 random bits; the database only knows their
 * SHA-256, so neither a database dump nor a log line can be replayed as a cookie. In production
 * the browser sees it as `__Host-slider_session` (see ./cookies).
 */
export const SESSION_COOKIE = 'slider_session';
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

function setSessionCookie(
  c: Context,
  deps: AppDeps,
  token: string,
  { now, expiresAt }: { now: Date; expiresAt: Date },
): void {
  writeCookie(c, deps.config, SESSION_COOKIE, token, {
    sameSite: 'Lax',
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  });
}

export const accountBlocked = () =>
  new ApiError(
    403,
    'account_blocked',
    'Dieses Konto wurde von der Person gesperrt, die Slider hier betreibt.',
  );

/**
 * Signs `userId` in on this browser. A blocked account (BER-167) never gets a session – the
 * logins refuse it before with `account_blocked`, this is the last line.
 */
export async function startSession(c: Context, deps: AppDeps, userId: string): Promise<void> {
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
    userAgent: c.req.header('user-agent')?.slice(0, 500) ?? null,
  });
  await markActive(deps.db, userId, now);
  setSessionCookie(c, deps, token, { now, expiresAt });
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
    // Expired, logged out elsewhere or unknown: drop the stale cookie.
    if (!readOnly) removeCookie(c, deps.config, SESSION_COOKIE);
    return null;
  }
  if (readOnly) return row.user;
  if (now.getTime() - row.session.lastSeenAt.getTime() >= RENEW_AFTER_MS) {
    const expiresAt = expiryFrom(deps, row.session.createdAt, now);
    await deps.db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, row.session.id));
    await markActive(deps.db, row.user.id, now);
    setSessionCookie(c, deps, token, { now, expiresAt });
  }
  return row.user;
}

/** Logs this browser out: deletes the session row and the cookie. */
export async function endSession(c: Context, deps: AppDeps): Promise<void> {
  const token = readCookie(c, deps.config, SESSION_COOKIE);
  if (token) await deps.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  removeCookie(c, deps.config, SESSION_COOKIE);
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
