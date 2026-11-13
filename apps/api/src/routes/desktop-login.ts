import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  desktopCodeInputSchema,
  desktopLogoutInputSchema,
  desktopTokenInputSchema,
  type DesktopCode,
  type DesktopToken,
} from '@slider/shared';
import { createSession, endSessionToken } from '../auth/session';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { assertWithinLimit, clientAddress, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { userEmail } from '../services/users';

/*
 * The server's half of signing the desktop app in (BER-201, `@slider/shared` desktop.ts). The
 * code is signed, not stored: who, for which PKCE challenge, until when. It goes through the
 * system's URL handler, so anything could read it on the way – it is worth nothing without the
 * verifier, which never leaves the desktop's local server. Each code is taken once.
 */

/** Long enough to click „Öffnen“ in the browser's prompt, short enough to be useless when found. */
const CODE_TTL_MS = 5 * 60_000;

interface CodeClaims {
  /** The user. */
  u: string;
  /** The PKCE challenge. */
  c: string;
  /** Expires, epoch ms. */
  e: number;
  /** Makes each code its own (taken once). */
  n: string;
}

const sign = (secret: string, payload: string) =>
  createHmac('sha256', `desktop-code:${secret}`).update(payload).digest('base64url');

export function desktopCode(secret: string, claims: CodeClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

function readCode(secret: string, code: string): CodeClaims | null {
  const [payload, signature, ...rest] = code.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as CodeClaims;
  } catch {
    return null;
  }
}

const invalidCode = () =>
  new ApiError(400, 'invalid_code', 'Die Anmeldung ist abgelaufen – bitte in der App neu starten.');

export function desktopLoginRoutes(deps: AppDeps) {
  /** Codes taken, until they expire anyway. */
  const taken = new Map<string, number>();
  const trades = fixedWindow({ limit: 20, windowMs: 60_000, clock: deps.clock });
  // Middleware on the route itself: a `use()` here would close every route mounted after.
  const signedIn = new Hono<ViewerEnv>().post(
    '/auth/desktop/code',
    viewerMiddleware(deps),
    async (c) => {
      const { challenge } = await readJson(c, desktopCodeInputSchema);
      const code = desktopCode(deps.config.secret, {
        u: c.var.viewer.author.id,
        c: challenge,
        e: deps.clock.now().getTime() + CODE_TTL_MS,
        n: randomBytes(9).toString('base64url'),
      });
      return c.json<DesktopCode>({ code });
    },
  );

  const open = new Hono()
    .post('/auth/desktop/token', async (c) => {
      assertWithinLimit(
        c,
        trades.hit(clientAddress(c)),
        'Zu viele Anmeldeversuche – bitte kurz warten.',
      );
      const { code, verifier } = await readJson(c, desktopTokenInputSchema);
      const claims = readCode(deps.config.secret, code);
      const now = deps.clock.now().getTime();
      for (const [nonce, expires] of taken) if (expires < now) taken.delete(nonce);
      if (!claims || claims.e < now || taken.has(claims.n)) throw invalidCode();
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== claims.c) throw invalidCode();
      taken.set(claims.n, claims.e);
      const [user] = await deps.db.select().from(users).where(eq(users.id, claims.u));
      if (!user) throw invalidCode();
      const { token } = await createSession(deps, user.id, 'Slider Desktop');
      return c.json<DesktopToken>({
        token,
        account: {
          name: user.name,
          email: await userEmail(deps.db, user.id),
          color: user.color,
        },
      });
    })
    .post('/auth/desktop/logout', async (c) => {
      const { token } = await readJson(c, desktopLogoutInputSchema);
      await endSessionToken(deps, token);
      return c.body(null, 204);
    });

  return new Hono().route('/', open).route('/', signedIn);
}
