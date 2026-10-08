import { and, desc, eq, lt } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import {
  loginIdentitySchema,
  renamePasskeyInputSchema,
  verifyPasskeyLoginInputSchema,
  verifyPasskeyRegistrationInputSchema,
  type LoginIdentity,
  type LoginResult,
  type Passkey,
} from '@slider/shared';
import {
  CHALLENGE_TTL_MS,
  defaultPasskeyName,
  relyingParty,
  RP_NAME,
  simpleWebAuthn,
} from '../auth/passkeys';
import { startSession } from '../auth/session';
import {
  clearGuestCookie,
  optionalViewerMiddleware,
  unauthorized,
  type OptionalViewerEnv,
} from '../auth/viewer';
import { authChallenges, passkeys, users } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { listIdentities } from '../services/accounts';
import { safeReturnTo } from './auth';

type Purpose = (typeof authChallenges.$inferSelect)['purpose'];
type PasskeyRow = typeof passkeys.$inferSelect;

/** One cookie per ceremony; it only names the challenge row, which is used up on verify. */
const CHALLENGE_COOKIES: Record<Purpose, string> = {
  passkey_register: 'slider_passkey_register',
  passkey_login: 'slider_passkey_login',
};
const COOKIE_PATH = '/api';

const toPasskey = (row: PasskeyRow): Passkey => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  synced: row.deviceType === 'multiDevice' || row.backedUp,
});

/**
 * Passkeys (WebAuthn): register them while signed in (`/passkeys/*`), sign in with them
 * (`/auth/passkey/*`). A passkey only ever signs into an account that exists – the account came
 * from Microsoft, Google, SSO or e-mail first – so sign-up rules never apply here.
 */
export function passkeysRoutes(deps: AppDeps) {
  const { config } = deps;
  const webauthn = deps.webauthn ?? simpleWebAuthn;
  const viewer = optionalViewerMiddleware(deps);
  const optionsLimit = rateLimit({ limit: 60, windowMs: 60_000, clock: deps.clock });
  const verifyLimit = rateLimit({ limit: 30, windowMs: 60_000, clock: deps.clock });

  /** The signed-in account (session or dev login); guests and anonymous callers get 401. */
  const accountId = (c: Context<OptionalViewerEnv>) => {
    const current = c.var.viewer;
    if (current?.kind !== 'owner') throw unauthorized();
    return current.author.id;
  };

  const storeChallenge = async (
    c: Context,
    purpose: Purpose,
    challenge: string,
    userId: string | null,
  ) => {
    const now = deps.clock.now();
    // Abandoned ceremonies: tidy up on the way.
    await deps.db.delete(authChallenges).where(lt(authChallenges.expiresAt, now));
    const id = crypto.randomUUID();
    await deps.db.insert(authChallenges).values({
      id,
      purpose,
      userId,
      challenge,
      createdAt: now,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    });
    await setSignedCookie(c, CHALLENGE_COOKIES[purpose], id, config.secret, {
      path: COOKIE_PATH,
      httpOnly: true,
      sameSite: 'Strict',
      secure: config.env === 'production',
      maxAge: CHALLENGE_TTL_MS / 1000,
    });
  };

  /** Takes the pending challenge – single use: the row is deleted whether or not it verifies. */
  const takeChallenge = async (c: Context, purpose: Purpose) => {
    const name = CHALLENGE_COOKIES[purpose];
    const id = await getSignedCookie(c, config.secret, name);
    deleteCookie(c, name, { path: COOKIE_PATH });
    if (!id) return null;
    const [row] = await deps.db
      .delete(authChallenges)
      .where(and(eq(authChallenges.id, id), eq(authChallenges.purpose, purpose)))
      .returning();
    if (!row || row.expiresAt.getTime() <= deps.clock.now().getTime()) return null;
    return row;
  };

  const expired = () =>
    badRequest('Die Passkey-Anfrage ist abgelaufen. Bitte versuche es noch einmal.');

  const ownPasskey = async (userId: string, id: string) => {
    const [row] = await deps.db
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)));
    if (!row) throw notFound('Diesen Passkey gibt es nicht (mehr).');
    return row;
  };

  const { rpID, origin } = relyingParty(config);

  return (
    new Hono<OptionalViewerEnv>()
      // ── Connected logins ───────────────────────────────────────────────
      .get('/me/identities', viewer, async (c) => {
        const rows = await listIdentities(deps.db, accountId(c));
        return c.json<LoginIdentity[]>(
          rows.map((row) =>
            loginIdentitySchema.parse({ ...row, createdAt: row.createdAt.toISOString() }),
          ),
        );
      })

      // ── Managing passkeys (signed in) ──────────────────────────────────
      .get('/passkeys', viewer, async (c) => {
        const rows = await deps.db
          .select()
          .from(passkeys)
          .where(eq(passkeys.userId, accountId(c)))
          .orderBy(desc(passkeys.createdAt));
        return c.json<Passkey[]>(rows.map(toPasskey));
      })

      .post('/passkeys/register/options', optionsLimit, viewer, async (c) => {
        const userId = accountId(c);
        const [user] = await deps.db.select().from(users).where(eq(users.id, userId));
        if (!user) throw unauthorized();
        const existing = await deps.db
          .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
          .from(passkeys)
          .where(eq(passkeys.userId, userId));
        const options = await webauthn.generateRegistrationOptions({
          rpName: RP_NAME,
          rpID,
          userName: user.email,
          userDisplayName: user.name,
          userID: new TextEncoder().encode(user.id),
          attestationType: 'none',
          // One passkey per authenticator and account.
          excludeCredentials: existing.map((row) => ({
            id: row.credentialId,
            transports: row.transports ?? undefined,
          })),
          authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'preferred',
          },
        });
        await storeChallenge(c, 'passkey_register', options.challenge, userId);
        return c.json(options);
      })

      .post('/passkeys/register/verify', verifyLimit, viewer, async (c) => {
        const userId = accountId(c);
        const input = await readJson(c, verifyPasskeyRegistrationInputSchema);
        const challenge = await takeChallenge(c, 'passkey_register');
        if (!challenge || challenge.userId !== userId) throw expired();
        let verification: Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>;
        try {
          verification = await webauthn.verifyRegistrationResponse({
            response: input.response as unknown as RegistrationResponseJSON,
            expectedChallenge: challenge.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: false,
          });
        } catch (error) {
          deps.log.warn('Passkey registration failed', error);
          throw badRequest('Der Passkey konnte nicht gespeichert werden.');
        }
        if (!verification.verified) {
          throw badRequest('Der Passkey konnte nicht gespeichert werden.');
        }
        const { credential, credentialDeviceType, credentialBackedUp } =
          verification.registrationInfo;
        const [taken] = await deps.db
          .select({ id: passkeys.id })
          .from(passkeys)
          .where(eq(passkeys.credentialId, credential.id));
        if (taken) throw badRequest('Dieser Passkey ist schon gespeichert.');
        const responseTransports = (
          input.response['response'] as { transports?: unknown } | undefined
        )?.transports;
        const transports = Array.isArray(responseTransports)
          ? responseTransports.filter((t): t is string => typeof t === 'string')
          : (credential.transports ?? null);
        const [row] = await deps.db
          .insert(passkeys)
          .values({
            id: crypto.randomUUID(),
            userId,
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString('base64url'),
            counter: credential.counter,
            transports,
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
            name: input.name ?? defaultPasskeyName(c.req.header('user-agent')),
            createdAt: deps.clock.now(),
          })
          .returning();
        if (!row) throw new Error('Passkey insert returned no row');
        return c.json<Passkey>(toPasskey(row), 201);
      })

      .patch('/passkeys/:id', viewer, async (c) => {
        const row = await ownPasskey(accountId(c), c.req.param('id'));
        const { name } = await readJson(c, renamePasskeyInputSchema);
        const [updated] = await deps.db
          .update(passkeys)
          .set({ name })
          .where(eq(passkeys.id, row.id))
          .returning();
        return c.json<Passkey>(toPasskey(updated ?? row));
      })

      .delete('/passkeys/:id', viewer, async (c) => {
        const row = await ownPasskey(accountId(c), c.req.param('id'));
        await deps.db.delete(passkeys).where(eq(passkeys.id, row.id));
        return c.body(null, 204);
      })

      // ── Signing in with a passkey ──────────────────────────────────────
      /** No `allowCredentials`: the browser offers every discoverable passkey for this site. */
      .post('/auth/passkey/options', optionsLimit, async (c) => {
        const options = await webauthn.generateAuthenticationOptions({
          rpID,
          userVerification: 'preferred',
        });
        await storeChallenge(c, 'passkey_login', options.challenge, null);
        return c.json(options);
      })

      .post('/auth/passkey/verify', verifyLimit, async (c) => {
        const input = await readJson(c, verifyPasskeyLoginInputSchema);
        const challenge = await takeChallenge(c, 'passkey_login');
        if (!challenge) throw expired();
        const response = input.response as unknown as AuthenticationResponseJSON;
        const [row] =
          typeof response.id === 'string'
            ? await deps.db.select().from(passkeys).where(eq(passkeys.credentialId, response.id))
            : [];
        if (!row) {
          throw badRequest(
            'Diesen Passkey kennt Slider nicht (mehr). Melde dich anders an und lege ihn unter „Konto & Anmeldung“ neu an.',
          );
        }
        let verification: Awaited<ReturnType<typeof webauthn.verifyAuthenticationResponse>>;
        try {
          verification = await webauthn.verifyAuthenticationResponse({
            response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
              id: row.credentialId,
              publicKey: new Uint8Array(Buffer.from(row.publicKey, 'base64url')),
              counter: row.counter,
              transports: row.transports ?? undefined,
            },
            requireUserVerification: false,
          });
        } catch (error) {
          deps.log.warn('Passkey login failed', error);
          throw badRequest('Die Anmeldung mit dem Passkey hat nicht geklappt.');
        }
        if (!verification.verified) {
          throw badRequest('Die Anmeldung mit dem Passkey hat nicht geklappt.');
        }
        const { newCounter, credentialBackedUp } = verification.authenticationInfo;
        await deps.db
          .update(passkeys)
          .set({ counter: newCounter, backedUp: credentialBackedUp, lastUsedAt: deps.clock.now() })
          .where(eq(passkeys.id, row.id));
        clearGuestCookie(c);
        await startSession(c, deps, row.userId);
        return c.json<LoginResult>({
          redirectTo: safeReturnTo(input.returnTo, '/'),
        });
      })
  );
}
