import { createHmac } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { loginPath } from '../auth/login-paths';
import { hashToken, newSecretToken } from '../auth/session';
import { loginLinks, userIdentities } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, forbidden, notFound } from '../http/errors';
import { inviteMail } from '../mail/mailer';
import {
  findUserByEmail,
  linkIdentity,
  normalizeEmail,
  signInWithIdentity,
  signUpBlocked,
  type IdentityInput,
  type SignInResult,
} from './accounts';
import { sendMail } from './data-requests';

/**
 * Login by mail, no password (BER-168): the address typed gets a link, the link signs in – or
 * creates the account under the same rules as any login (`signInWithIdentity`). A new account
 * then adds a passkey for the next time. An account of the address that signs in another way
 * (Microsoft, Google, a passkey …) gets the same link: the mailbox is what its address was
 * confirmed by, and the link adds „E-Mail“ to its logins (`signInWithEmail`). The answer is the
 * same whether an account exists: only the mailbox learns that, from what the mail says.
 *
 * A link works for 15 minutes, once, and only in the browser that asked (the hash of its signed
 * cookie's key is stored with it): someone who types a stranger's address can't use the link
 * the stranger then opens. Only hashes of the token are kept (`login_links`); the hourly
 * retention sweep removes old rows.
 *
 * The mail also carries a six-digit code for when the link opens in another browser – asked for
 * in the desktop app, the mail opens the system browser. The code is typed where the link was
 * asked for and works only there, bound like the link (`redeemEmailCode`).
 */

/** How long a mailed link works. */
export const EMAIL_LOGIN_TTL_MS = 15 * 60 * 1000;

/** The login identity of an address whose mailbox just confirmed it. */
export function emailIdentity(email: string, inviteToken: string | null): IdentityInput {
  const address = normalizeEmail(email);
  return {
    provider: 'email',
    subject: address,
    email: address,
    emailVerified: true,
    name: null,
    inviteToken,
  };
}

/** Whether an account signs in with this address's login links already. */
async function signsInByEmail(deps: Pick<AppDeps, 'db'>, email: string): Promise<boolean> {
  const [known] = await deps.db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(eq(userIdentities.provider, 'email'), eq(userIdentities.subject, normalizeEmail(email))),
    );
  return known !== undefined;
}

/**
 * The code of a link: six digits from the server's secret and the token's hash – nothing more to
 * store, and the hash alone (a database dump) does not give it.
 */
export function emailLoginCode(secret: string, tokenHash: string): string {
  const digest = createHmac('sha256', secret).update(`email-login-code:${tokenHash}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

const USED_MESSAGE =
  'Diesen Link hast du schon benutzt. Fordere auf der Anmeldeseite einen neuen an, falls du nicht mehr angemeldet bist.';

/**
 * Mails what fits the address: a login link (an account of the address, or a new one that may be
 * created), or why there is none – this instance only takes invited people. `false` when the mail
 * could not be sent.
 */
export async function sendEmailLogin(
  deps: AppDeps,
  input: { email: string; returnTo: string; inviteToken: string | null; browser: string },
): Promise<boolean> {
  const email = normalizeEmail(input.email);
  const blocked = (await signsInByEmail(deps, email))
    ? 'account_exists'
    : await signUpBlocked(deps, emailIdentity(email, input.inviteToken));
  // An account of the address signs in by the link, whichever way it signed in so far.
  const known = blocked === 'account_exists';
  const base = { to: email, legalLinks: true };
  const url = (path: string) => new URL(path, deps.config.webOrigin).toString();

  if (blocked && !known) {
    return sendMail(
      deps,
      inviteMail({
        ...base,
        subject: 'Deine Anmeldung bei Office',
        outro: 'Du warst das nicht? Dann ignoriere diese Mail, es ändert sich nichts.',
        heading: 'Noch kein Konto',
        intro:
          'Für diese Adresse gibt es auf dieser Office-Instanz kein Konto, und neue Konten entstehen hier nur mit einer Einladung. Bitte jemanden aus deinem Team, dich in euren Workspace einzuladen.',
        button: 'Zu Office',
        url: url(loginPath()),
      }),
    );
  }

  const token = newSecretToken();
  const tokenHash = hashToken(token);
  const code = emailLoginCode(deps.config.secret, tokenHash);
  const now = deps.clock.now();
  await deps.db.insert(loginLinks).values({
    tokenHash,
    email,
    browserHash: hashToken(input.browser),
    inviteToken: input.inviteToken,
    returnTo: input.returnTo,
    createdAt: now,
    expiresAt: new Date(now.getTime() + EMAIL_LOGIN_TTL_MS),
  });
  return sendMail(
    deps,
    inviteMail({
      ...base,
      subject: known ? 'Bei Office anmelden' : 'Dein Konto erstellen',
      heading: known ? 'Bei Office anmelden' : 'Konto erstellen',
      intro: known
        ? 'Mit diesem Link meldest du dich bei Office an.'
        : 'Mit diesem Link erstellst du dein Konto, ganz ohne Passwort. Danach kannst du einen Passkey anlegen und dich künftig damit anmelden.',
      button: known ? 'Anmelden' : 'Konto erstellen',
      url: url(`/anmelden/${token}`),
      code: {
        label:
          'Öffnet sich der Link in einem anderen Browser, etwa in deiner Mail-App oder aus einer Desktop-App heraus? Dann gib dort, wo du ihn angefordert hast, diesen Code ein:',
        value: code,
      },
      outro:
        'Link und Code gelten 15 Minuten, nur einmal und nur dort, wo du sie angefordert hast. Du warst das nicht? Dann ignoriere diese Mail.',
    }),
  );
}

/**
 * Uses a mailed link: its address, invitation and way back – or why not. `browser`: the key of the
 * browser asking (its signed cookie); it has to be the one that asked for the link.
 */
export async function redeemEmailLogin(
  deps: AppDeps,
  token: string,
  browser: string | undefined,
): Promise<{ email: string; inviteToken: string | null; returnTo: string }> {
  const tokenHash = hashToken(token);
  const browserHash = browser ? hashToken(browser) : null;
  const now = deps.clock.now();
  // Used up only by the browser that asked, unused and in time – in one step, so a double click
  // signs in once.
  const [used] = browserHash
    ? await deps.db
        .update(loginLinks)
        .set({ usedAt: now })
        .where(
          and(
            eq(loginLinks.tokenHash, tokenHash),
            eq(loginLinks.browserHash, browserHash),
            isNull(loginLinks.usedAt),
            gt(loginLinks.expiresAt, now),
          ),
        )
        .returning({
          email: loginLinks.email,
          inviteToken: loginLinks.inviteToken,
          returnTo: loginLinks.returnTo,
        })
    : [];
  if (used) return used;

  // Why not, from the link as it is.
  const [link] = await deps.db.select().from(loginLinks).where(eq(loginLinks.tokenHash, tokenHash));
  if (!link || link.expiresAt <= now) {
    throw notFound(
      'Dieser Link ist ungültig oder abgelaufen. Fordere auf der Anmeldeseite einfach einen neuen an.',
    );
  }
  if (link.usedAt) throw new ApiError(410, 'link_expired', USED_MESSAGE);
  // Another browser: the link stays unused and still works in the right one.
  throw forbidden(
    'Angefordert hast du den Link in einem anderen Browser – Mail-Apps und Desktop-Apps öffnen Links oft in ihrem eigenen. Gib dort, wo du ihn angefordert hast, den Code aus der Mail ein, oder öffne den Link in dem Browser, in dem du ihn angefordert hast.',
  );
}

/**
 * Uses a mailed link by its code, typed in the browser that asked for it (`browser`, its signed
 * cookie's key) – what `redeemEmailLogin` gives, or why not. Only that browser's links count, so a
 * code is no use anywhere else; the route limits the tries.
 */
export async function redeemEmailCode(
  deps: AppDeps,
  code: string,
  browser: string | undefined,
  /** Counts a try at the links of `email`; `false`: too many – they are used up. */
  mayTry: (email: string) => boolean,
  /**
   * Counts a try at `email` for the day; `false`: too many – no code is taken for it, its links
   * stay and the link in the mail still signs in.
   */
  mayTryToday: (email: string) => boolean,
): Promise<{ email: string; inviteToken: string | null; returnTo: string }> {
  const now = deps.clock.now();
  const open = browser
    ? and(
        eq(loginLinks.browserHash, hashToken(browser)),
        isNull(loginLinks.usedAt),
        gt(loginLinks.expiresAt, now),
      )
    : undefined;
  const links = open
    ? await deps.db
        .select({
          tokenHash: loginLinks.tokenHash,
          email: loginLinks.email,
          expiresAt: loginLinks.expiresAt,
        })
        .from(loginLinks)
        .where(open)
    : [];
  // Only the newest mail's code counts for an address: several mails asked for give a guess no
  // more codes to hit.
  const newest = new Map<string, (typeof links)[number]>();
  for (const link of links) {
    const known = newest.get(link.email);
    if (!known || link.expiresAt > known.expiresAt) newest.set(link.email, link);
  }
  const addresses = [...new Set(links.map((link) => link.email))];
  // A new mail each hour would give ten tries more each time – so the tries also count per day,
  // and past them only the link itself signs in.
  if (addresses.some((email) => !mayTryToday(email))) {
    throw new ApiError(
      429,
      'rate_limited',
      'Zu viele falsche Codes für heute. Melde dich bitte über den Link in der Mail an.',
    );
  }
  // Guessing: a fresh browser key per mail asked for would give ten tries each – so the tries
  // count per address, and past them this browser's links are gone (the link in the mail too).
  if (open && addresses.some((email) => !mayTry(email))) {
    await deps.db.update(loginLinks).set({ usedAt: now }).where(open);
    throw new ApiError(
      429,
      'rate_limited',
      'Zu viele falsche Codes. Fordere bitte einen neuen Link an.',
    );
  }
  const match = [...newest.values()].find(
    (link) => emailLoginCode(deps.config.secret, link.tokenHash) === code,
  );
  if (!match) {
    throw badRequest(
      'Der Code stimmt nicht oder ist abgelaufen. Schau in die neueste Mail oder fordere einen neuen an.',
    );
  }
  // Unused still – in one step, so a double submit signs in once.
  const [used] = await deps.db
    .update(loginLinks)
    .set({ usedAt: now })
    .where(and(eq(loginLinks.tokenHash, match.tokenHash), isNull(loginLinks.usedAt)))
    .returning({
      email: loginLinks.email,
      inviteToken: loginLinks.inviteToken,
      returnTo: loginLinks.returnTo,
    });
  if (!used) throw new ApiError(410, 'link_expired', USED_MESSAGE);
  return used;
}

/**
 * Signs in with a used link or code: the address's account, or a new one under the rules of any
 * login. An account of the address that signs in another way is let in too – the mailbox the link
 * went to is what its address was confirmed by – and signs in by mail from then on, as „E-Mail“
 * under „Konto & Anmeldung“. Removing that there does not lock mail out: the next link adds it
 * again.
 */
export async function signInWithEmail(
  deps: AppDeps,
  link: { email: string; inviteToken: string | null },
): Promise<SignInResult> {
  const identity = emailIdentity(link.email, link.inviteToken);
  const result = await signInWithIdentity(deps, identity);
  if (result.ok || result.error !== 'account_exists') return result;
  const existing = await findUserByEmail(deps.db, identity.subject);
  // A blocked account never gets here: `signInWithIdentity` refuses it before `account_exists`.
  if (!existing) return result;
  const linked = await linkIdentity(deps, existing.id, identity);
  return linked.ok ? { ok: true, user: existing, created: false } : linked;
}
