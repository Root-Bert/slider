import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { userIdentities } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, forbidden, notFound } from '../http/errors';
import { inviteMail } from '../mail/mailer';
import type { IdentityInput } from './accounts';
import { sendMail } from './data-requests';

/**
 * A new account through any Nextcloud (`NEXTCLOUD_LOGIN_ANY`): whoever runs a Nextcloud can put
 * any address into it, so the address only counts once its mailbox confirms it. Slider mails a
 * link; using it creates the account like any login with a confirmed address would. Without
 * that, someone could take `chef@firma.de` in Slider before its owner arrives, or pick up an
 * invitation meant for it.
 *
 * Like the data requests (`services/data-requests`), the link carries a signed token (HMAC with
 * `SLIDER_SECRET`) and nothing is stored: identity, address, name, invitation, way back, expiry.
 *
 * The link only works in the browser that started the sign-in: the token carries a hash of that
 * browser's signed cookie (`routes/auth`, `NEXTCLOUD_SIGNUP_COOKIE`). Else someone could put a
 * stranger's address into their own Nextcloud, and the stranger – trusting a mail from Slider –
 * would create an account that the other one's Nextcloud signs into. And it works once: as soon
 * as the identity exists, the link is spent.
 */

/** How long the confirmation link works. */
export const NEXTCLOUD_SIGNUP_TTL_MS = 60 * 60 * 1000;

interface Payload {
  /** Identity subject: `<server>:<Nextcloud user id>`. */
  s: string;
  /** The address to confirm, as Nextcloud sent it. */
  a: string;
  /** Display name. */
  n: string | null;
  /** Invitation token of the link the login started from. */
  i?: string;
  /** Where the browser goes once signed in. */
  r: string;
  /** SHA-256 of the browser key that started the sign-in (base64url). */
  b: string;
  /** Expiry, Unix seconds. */
  e: number;
}

const signingKey = (secret: string) =>
  createHmac('sha256', secret).update('slider:nextcloud-signup:v1').digest();

const sign = (secret: string, body: string) =>
  createHmac('sha256', signingKey(secret)).update(body).digest('base64url');

const browserHash = (browser: string) =>
  createHash('sha256').update(`slider:nextcloud-signup-browser:${browser}`).digest('base64url');

const sameValue = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function nextcloudSignupToken(
  secret: string,
  signup: { identity: IdentityInput; returnTo: string; browser: string; expiresAt: Date },
): string {
  const { identity } = signup;
  const payload: Payload = {
    s: identity.subject,
    a: identity.email ?? '',
    n: identity.name,
    ...(identity.inviteToken ? { i: identity.inviteToken } : {}),
    r: signup.returnTo,
    b: browserHash(signup.browser),
    e: Math.floor(signup.expiresAt.getTime() / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/**
 * The identity of a valid, unexpired, unused token – its address now confirmed – and where to go.
 * `browser`: the key of the browser asking (its signed cookie); it has to be the one that started.
 */
export async function resolveNextcloudSignup(
  deps: AppDeps,
  token: string,
  browser: string | undefined,
): Promise<{ identity: IdentityInput; returnTo: string }> {
  const invalid = () =>
    notFound(
      'Dieser Link ist ungültig oder abgelaufen. Melde dich noch einmal mit deiner Nextcloud an, dann bekommst du einen neuen.',
    );
  const [body, signature] = token.split('.');
  if (!body || !signature) throw invalid();
  const given = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(sign(deps.config.secret, body), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalid();
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
  } catch {
    throw invalid();
  }
  if (payload.e * 1000 <= deps.clock.now().getTime() || !payload.a) throw invalid();
  if (!browser || typeof payload.b !== 'string' || !sameValue(browserHash(browser), payload.b)) {
    throw forbidden(
      'Öffne den Link bitte im selben Browser, in dem du die Anmeldung mit deiner Nextcloud gestartet hast. Nur dort wird dein Konto erstellt.',
    );
  }
  const [used] = await deps.db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, 'nextcloud'), eq(userIdentities.subject, payload.s)));
  if (used) {
    throw new ApiError(
      410,
      'link_expired',
      'Diesen Link hast du schon benutzt, dein Konto ist da. Melde dich einfach mit deiner Nextcloud an.',
    );
  }
  return {
    identity: {
      provider: 'nextcloud',
      subject: payload.s,
      email: payload.a,
      emailVerified: true,
      name: payload.n,
      inviteToken: payload.i ?? null,
    },
    returnTo: payload.r,
  };
}

/** Mails the confirmation link; `false` when the mail could not be sent. */
export async function sendNextcloudSignupMail(
  deps: AppDeps,
  input: { identity: IdentityInput; returnTo: string; server: string; browser: string },
): Promise<boolean> {
  const email = input.identity.email;
  if (!email) return false;
  const token = nextcloudSignupToken(deps.config.secret, {
    identity: input.identity,
    returnTo: input.returnTo,
    browser: input.browser,
    expiresAt: new Date(deps.clock.now().getTime() + NEXTCLOUD_SIGNUP_TTL_MS),
  });
  return sendMail(
    deps,
    inviteMail({
      to: email,
      subject: 'Dein Slider-Konto bestätigen',
      heading: 'Konto erstellen',
      intro: `Du hast dich mit deiner Nextcloud (${new URL(input.server).host}) bei Slider angemeldet. Bestätige noch, dass diese Adresse dir gehört, dann ist dein Konto da.`,
      button: 'Adresse bestätigen',
      url: new URL(`/konto-bestaetigen/${token}`, deps.config.webOrigin).toString(),
      outro:
        'Öffne den Link im selben Browser, in dem du die Anmeldung gestartet hast. Er gilt eine Stunde. Du warst das nicht? Dann ignoriere diese Mail. Ohne den Link entsteht kein Konto.',
      // The address came from a Nextcloud, not from the person in front of Slider.
      legalLinks: true,
    }),
  );
}
