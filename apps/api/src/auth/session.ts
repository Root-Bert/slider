import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sessions, users, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';

/**
 * Login sessions (BER-129). The cookie carries 256 random bits; the database only knows their
 * SHA-256, so neither a database dump nor a log line can be replayed as a cookie.
 */
export const SESSION_COOKIE = 'slider_session';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Sliding expiry, but at most one write per session and day. */
const RENEW_AFTER_MS = DAY_MS;

/** 256 random bits, URL-safe – for session cookies, magic links and invite links. */
export const newSecretToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const ttlMs = (deps: AppDeps) => deps.config.auth.sessionTtlDays * DAY_MS;

function setSessionCookie(c: Context, deps: AppDeps, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: deps.config.env === 'production',
    maxAge: Math.floor(ttlMs(deps) / 1000),
  });
}

/** Signs `userId` in on this browser. */
export async function startSession(c: Context, deps: AppDeps, userId: string): Promise<void> {
  const token = newSecretToken();
  const now = deps.clock.now();
  await deps.db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + ttlMs(deps)),
    userAgent: c.req.header('user-agent')?.slice(0, 500) ?? null,
  });
  setSessionCookie(c, deps, token);
}

/** The signed-in user, or `null`; renews the session (and its cookie) at most once a day. */
export async function loadSessionUser(c: Context, deps: AppDeps): Promise<UserRow | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const now = deps.clock.now();
  const [row] = await deps.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));
  if (!row) {
    // Expired, logged out elsewhere or unknown: drop the stale cookie.
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return null;
  }
  if (now.getTime() - row.session.lastSeenAt.getTime() >= RENEW_AFTER_MS) {
    await deps.db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + ttlMs(deps)) })
      .where(eq(sessions.id, row.session.id));
    setSessionCookie(c, deps, token);
  }
  return row.user;
}

/** Logs this browser out: deletes the session row and the cookie. */
export async function endSession(c: Context, deps: AppDeps): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deps.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
