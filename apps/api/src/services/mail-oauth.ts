import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import {
  MAIL_OAUTH_LABELS,
  type MailCheckFailure,
  type MailOAuthProvider,
  type MailOAuthResult,
  type MailOAuthStart,
} from '@slider/shared';
import { readSignedCookie, removeCookie, writeSignedCookie } from '../auth/cookies';
import { createPkce } from '../auth/microsoft';
import type { OptionalViewerEnv } from '../auth/viewer';
import { mailAccounts } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import {
  exchangeMailCode,
  holdMailToken,
  mailAuthorizeUrl,
  mailOAuthConfigured,
  MailOAuthError,
  type MailTokens,
} from '../mail/oauth';
import { MailCheckError, type MailLogin } from '../mail/servers';
import { cloudContext } from './cloud/context';
import { accountDto, later, mailServersOf, syncMailAccount, tellMailbox } from './mail';

/*
 * „Mit Microsoft/Google anmelden“ for a mailbox: the page asks for the provider's sign-in page
 * (`startMailOAuth`), the provider sends the browser back to the login's registered redirect URI
 * – the login's callback hands a state starting `mail.` here (`finishMailOAuth`) – and the page
 * reads how it ended (`mailOAuthResult`).
 *
 * A sign-in in progress lives here in memory for 10 minutes: bound to the signed-in person and
 * workspace, to this browser (a signed cookie with the state) and used once – a state seen again
 * is refused. One API process holds them; a restart in between asks to sign in again.
 */

export const MAIL_OAUTH_COOKIE = 'slider_mail_oauth';
const STATE_PREFIX = 'mail.';
const TTL_MS = 10 * 60_000;

interface Pending {
  provider: MailOAuthProvider;
  userId: string;
  workspaceId: string;
  accountId: string | null;
  name: string;
  label: string;
  aiReads: boolean;
  verifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: number;
}

const pending = new Map<string, Pending>();
/** States already come back: a second time is refused (replay). */
const spent = new Map<string, Pending>();
const outcomes = new Map<string, { userId: string; result: MailOAuthResult; expiresAt: number }>();

export const isMailOAuthState = (state: string | undefined): state is string =>
  !!state && state.startsWith(STATE_PREFIX);

function sweep(now: number) {
  for (const map of [pending, spent, outcomes])
    for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
}

/** Same-origin paths only (as the login's `safeReturnTo`). */
const ownPath = (value: string) =>
  value.startsWith('/') &&
  !value.startsWith('//') &&
  !value.includes('\\') &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : '/';

/** The provider's page to sign in at, for a new mailbox or one whose sign-in ended. */
export async function startMailOAuth(
  deps: AppDeps,
  c: Context,
  userId: string,
  workspaceId: string,
  input: MailOAuthStart & { provider: MailOAuthProvider },
): Promise<string> {
  await cloudContext(deps.db, workspaceId, userId);
  const label = MAIL_OAUTH_LABELS[input.provider];
  if (!mailOAuthConfigured(deps.config, input.provider)) {
    throw new ApiError(
      503,
      'bad_request',
      `Die Anmeldung mit ${label} ist auf diesem Server nicht eingerichtet – trag dein Postfach mit Adresse und Passwort ein.`,
    );
  }
  // Only pre-fills the provider's page; the address saved is the one the provider names.
  let hint = input.address;
  if (input.accountId) {
    const [row] = await deps.db
      .select()
      .from(mailAccounts)
      .where(eq(mailAccounts.id, input.accountId));
    if (!row || row.userId !== userId || row.workspaceId !== workspaceId)
      throw notFound('Dieses Postfach gibt es nicht.');
    if (row.auth !== input.provider)
      throw badRequest(`Dieses Postfach meldet sich nicht über ${label} an.`);
    hint = row.address;
  }
  const now = deps.clock.now().getTime();
  sweep(now);
  const pkce = await createPkce();
  const state = `${STATE_PREFIX}${pkce.state}`;
  pending.set(state, {
    provider: input.provider,
    userId,
    workspaceId,
    accountId: input.accountId ?? null,
    name: input.name ?? '',
    label: input.label ?? '',
    aiReads: input.aiReads ?? true,
    verifier: pkce.verifier,
    nonce: pkce.nonce,
    returnTo: ownPath(input.returnTo),
    expiresAt: now + TTL_MS,
  });
  await writeSignedCookie(c, deps.config, MAIL_OAUTH_COOKIE, state, {
    sameSite: 'Lax',
    maxAge: TTL_MS / 1000,
  });
  return mailAuthorizeUrl(deps.config, input.provider, { ...pkce, state }, hint);
}

/** Why the provider sent the person back without a code, in a sentence they can act on. */
function refusedText(provider: MailOAuthProvider, error: string, description = '') {
  const label = MAIL_OAUTH_LABELS[provider];
  const text = `${error} ${description}`;
  if (/AADSTS(65001|90094|90095)\b|admin_policy_enforced|admin (approval|consent)/i.test(text))
    return `Bei ${label} muss erst die IT deiner Firma Slider den Zugriff aufs Postfach erlauben. Bis dahin geht es mit Adresse und Passwort, wo die Firma das zulässt.`;
  if (error === 'access_denied')
    return `Bei ${label} wurde der Zugriff aufs Postfach nicht erlaubt – ohne ihn kann Slider keine Mails lesen und senden. Versuch es noch einmal und stimm dort zu.`;
  return `Die Anmeldung bei ${label} hat nicht geklappt. Versuch es noch einmal.`;
}

/** The provider's code (`AADSTS…`), never its whole description (traces, ids). */
const codeOf = (error: string, description = '') =>
  [error, /AADSTS\d+/.exec(description)?.[0]].filter(Boolean).join(' ');

/**
 * Back from the provider (through the login's callback): checks the state, trades the code for
 * the tokens, signs in to both servers with them and keeps the mailbox – or says why not.
 * Always a redirect to the page it started on, with `?anmeldung=<id>`.
 */
export async function finishMailOAuth(deps: AppDeps, c: Context<OptionalViewerEnv>) {
  const query = c.req.query();
  const state = query['state'] ?? '';
  const cookie = await readSignedCookie(c, deps.config, MAIL_OAUTH_COOKIE);
  removeCookie(c, deps.config, MAIL_OAUTH_COOKIE);
  const now = deps.clock.now().getTime();
  const flow = pending.get(state);
  pending.delete(state);

  const toPage = (path: string, outcome?: string) => {
    const url = new URL(ownPath(path), deps.config.webOrigin);
    if (outcome) url.searchParams.set('anmeldung', outcome);
    // Never anywhere but the web app.
    return c.redirect(
      url.origin === new URL(deps.config.webOrigin).origin ? url.toString() : deps.config.webOrigin,
      302,
    );
  };
  const tell = (of: Pending, result: MailOAuthResult) => {
    const id = crypto.randomUUID();
    outcomes.set(id, { userId: of.userId, result, expiresAt: now + TTL_MS });
    return toPage(of.returnTo, id);
  };
  const fail = (of: Pending, error: string, mailCheck?: Omit<MailCheckFailure, 'via'>) =>
    tell(of, {
      ok: false,
      provider: of.provider,
      name: of.name,
      label: of.label,
      aiReads: of.aiReads,
      accountId: of.accountId,
      error,
      ...(mailCheck ? { mailCheck: { ...mailCheck, via: of.provider } } : {}),
    });
  const again = (of: Pending) =>
    `Die Anmeldung bei ${MAIL_OAUTH_LABELS[of.provider]} ist abgelaufen oder schon verwendet. Starte sie noch einmal.`;

  if (!flow) {
    // Seen before (a replay, the back button): refused; never seen: nothing to say where.
    const used = spent.get(state);
    return used ? fail(used, again(used), { step: 'oauth-consent' }) : toPage('/');
  }
  spent.set(state, flow);
  const viewer = c.var.viewer;
  if (
    cookie !== state ||
    flow.expiresAt <= now ||
    viewer?.kind !== 'owner' ||
    viewer.author.id !== flow.userId
  ) {
    return fail(flow, again(flow), { step: 'oauth-consent' });
  }
  const label = MAIL_OAUTH_LABELS[flow.provider];
  if (query['error']) {
    deps.log.warn(`Mail sign-in with ${flow.provider} refused: ${query['error']}`);
    return fail(flow, refusedText(flow.provider, query['error'], query['error_description']), {
      step: 'oauth-consent',
      serverSays: codeOf(query['error'], query['error_description']),
    });
  }
  if (!query['code'])
    return fail(flow, refusedText(flow.provider, 'failed'), { step: 'oauth-consent' });

  let signedIn: Awaited<ReturnType<typeof exchangeMailCode>>;
  try {
    signedIn = await exchangeMailCode(deps, flow.provider, query['code'], flow);
  } catch (error) {
    // Only the code of the refusal is logged – the answer never holds a token then.
    deps.log.warn(
      `Mail sign-in with ${flow.provider} failed: ${error instanceof MailOAuthError ? error.code : error instanceof Error ? error.name : 'error'}`,
    );
    return fail(flow, refusedText(flow.provider, 'failed'), {
      step: 'oauth-consent',
      ...(error instanceof MailOAuthError ? { serverSays: error.code } : {}),
    });
  }
  const { address } = signedIn;
  if (!address) {
    return fail(
      flow,
      `${label} hat keine bestätigte E-Mail-Adresse zu diesem Konto genannt – melde dich mit dem Konto des Postfachs an.`,
      { step: 'oauth-account' },
    );
  }

  // Signed in anew: the same account. A new one already here (same person, workspace,
  // address): that one signs in anew.
  const mine = await deps.db
    .select()
    .from(mailAccounts)
    .where(
      and(eq(mailAccounts.userId, flow.userId), eq(mailAccounts.workspaceId, flow.workspaceId)),
    );
  const existing = flow.accountId
    ? mine.find((row) => row.id === flow.accountId)
    : mine.find((row) => row.auth === flow.provider && row.address.toLowerCase() === address);
  if (flow.accountId && !existing) return fail(flow, 'Dieses Postfach gibt es nicht mehr.');
  if (existing && existing.address.toLowerCase() !== address) {
    return fail(
      flow,
      `Bei ${label} hast du dich als ${address} angemeldet – dieses Postfach ist ${existing.address}. Melde dich mit ${existing.address} an.`,
      { step: 'oauth-account' },
    );
  }
  try {
    await cloudContext(deps.db, flow.workspaceId, flow.userId);
  } catch {
    return fail(flow, 'Du bist nicht mehr in diesem Workspace.');
  }

  const login: MailLogin = {
    address,
    name: existing?.name ?? (flow.name || address),
    ...signedIn.servers,
    username: address,
    password: '',
    accessToken: signedIn.accessToken,
  };
  try {
    await mailServersOf(deps).check(login);
  } catch (error) {
    if (error instanceof MailCheckError) return fail(flow, error.message, error.failure);
    return fail(flow, error instanceof Error ? error.message : String(error), {
      step: 'imap-server',
    });
  }
  const row = await keep(deps, flow, login, signedIn, existing?.id ?? null);
  return tell(flow, { ok: true, account: accountDto(row), renewed: !!existing });
}

async function keep(
  deps: AppDeps,
  flow: Pending,
  login: MailLogin,
  tokens: MailTokens,
  existingId: string | null,
) {
  const now = deps.clock.now();
  const [row] = existingId
    ? await deps.db
        .update(mailAccounts)
        .set({
          refreshToken: tokens.refreshToken,
          ...(flow.accountId ? {} : { aiReads: flow.aiReads }),
          state: 'ok',
          error: null,
          updatedAt: now,
        })
        .where(eq(mailAccounts.id, existingId))
        .returning()
    : await deps.db
        .insert(mailAccounts)
        .values({
          id: crypto.randomUUID(),
          workspaceId: flow.workspaceId,
          userId: flow.userId,
          address: login.address,
          name: login.name,
          label: flow.label || null,
          imapHost: login.imapHost,
          imapPort: login.imapPort,
          imapSecure: login.imapSecure,
          smtpHost: login.smtpHost,
          smtpPort: login.smtpPort,
          smtpSecure: login.smtpSecure,
          username: login.username,
          password: '',
          auth: flow.provider,
          refreshToken: tokens.refreshToken,
          aiReads: flow.aiReads,
          state: 'ok',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
  if (!row) throw new Error('Mail account write returned nothing');
  holdMailToken(row.id, tokens);
  tellMailbox(row);
  later(deps, () => syncMailAccount(deps, row.id));
  return row;
}

/** How a sign-in ended, for whoever started it. */
export function mailOAuthResult(deps: AppDeps, userId: string, id: string): MailOAuthResult {
  const found = outcomes.get(id);
  if (!found || found.userId !== userId || found.expiresAt <= deps.clock.now().getTime())
    throw notFound('Diese Anmeldung ist vorbei.');
  return found.result;
}
