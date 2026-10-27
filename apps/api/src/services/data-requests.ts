import { createHmac, timingSafeEqual } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import type { DataRequestPurpose } from '@slider/shared';
import { users, workspaceInvites, workspaces, type UserRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, notFound } from '../http/errors';
import { inviteMail, type MailMessage } from '../mail/mailer';
import { deleteAccount, type Successors } from './account-deletion';
import { normalizeEmail } from './accounts';
import { maskEmail } from './workspaces/invites';

/**
 * Data requests without login (BER-146). Anyone may ask for a copy of the data stored about an
 * address, or for its deletion – but only whoever has that mailbox gets anywhere: Slider mails a
 * link to exactly that address and does nothing else. Having the mailbox is the proof of
 * identity (DSGVO Art. 12 (6)); nothing more is asked, nothing is done by hand.
 *
 * The answer to a request never tells whether there is an account: a mail goes out when there is
 * an account or an invitation to the address, else nothing happens.
 *
 * The link carries a signed token (HMAC with `SLIDER_SECRET`): purpose, address, expiry and the
 * account if there is one. Nothing is stored. For an account the address must still be its
 * address when the link is used.
 */

/**
 * How long a link works: a copy a week, a deletion a day – a forwarded or forgotten mail must
 * not be able to delete an account (and choose a new admin) long after.
 */
export const DATA_REQUEST_TTL_MS: Record<'export' | 'delete', number> = {
  export: 7 * 24 * 60 * 60 * 1000,
  delete: 24 * 60 * 60 * 1000,
};

interface Payload {
  p: DataRequestPurpose;
  /** Lower-case address. */
  a: string;
  /** The account, if the address has one. */
  u?: string;
  /** Expiry, Unix seconds. */
  e: number;
}

const signingKey = (secret: string) =>
  createHmac('sha256', secret).update('slider:data-requests:v1').digest();

const sign = (secret: string, body: string) =>
  createHmac('sha256', signingKey(secret)).update(body).digest('base64url');

export function dataRequestToken(
  secret: string,
  request: { purpose: DataRequestPurpose; email: string; userId?: string; expiresAt: Date },
): string {
  const payload: Payload = {
    p: request.purpose,
    a: normalizeEmail(request.email),
    ...(request.userId ? { u: request.userId } : {}),
    e: Math.floor(request.expiresAt.getTime() / 1000),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

export interface ResolvedDataRequest {
  purpose: DataRequestPurpose;
  email: string;
  /** `null`: no account – the request is about invitations to the address. */
  user: UserRow | null;
  expiresAt: Date;
}

/** A valid, unexpired token whose account (if any) still has the address. */
export async function resolveDataRequest(
  deps: AppDeps,
  token: string,
): Promise<ResolvedDataRequest> {
  const invalid = () =>
    notFound(
      'Dieser Link ist ungültig oder abgelaufen. Fordere auf der Seite „Datenanfrage“ einen neuen an.',
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
  const expiresAt = new Date(payload.e * 1000);
  if (expiresAt.getTime() <= deps.clock.now().getTime()) throw invalid();
  if (!payload.u) {
    if (payload.p === 'keep') throw invalid();
    return { purpose: payload.p, email: payload.a, user: null, expiresAt };
  }
  const [user] = await deps.db.select().from(users).where(eq(users.id, payload.u));
  if (!user || normalizeEmail(user.email) !== payload.a) throw invalid();
  return { purpose: payload.p, email: payload.a, user, expiresAt };
}

const MAILS: Record<'export' | 'delete', Omit<Parameters<typeof inviteMail>[0], 'to' | 'url'>> = {
  export: {
    subject: 'Deine Daten aus Slider',
    heading: 'Deine Daten herunterladen',
    intro:
      'Für diese Adresse wurde eine Kopie der Daten angefragt, die Slider speichert. Über den Button lädst du sie als ZIP herunter.',
    button: 'Daten herunterladen',
    outro:
      'Der Link gilt 7 Tage. Du hast nichts angefragt? Dann ignoriere diese Mail. Ohne den Link kommt niemand an die Daten.',
  },
  delete: {
    subject: 'Daten in Slider löschen',
    heading: 'Löschung bestätigen',
    intro:
      'Für diese Adresse wurde die Löschung der Daten angefragt, die Slider speichert. Gelöscht wird erst, wenn du es über den Button bestätigst.',
    button: 'Löschung ansehen und bestätigen',
    outro:
      'Der Link gilt 24 Stunden. Du hast nichts angefragt? Dann ignoriere diese Mail, es bleibt alles, wie es ist.',
  },
};

/** Throws when the instance can't send mail: then no request can be answered automatically. */
export function assertMailConfigured(deps: AppDeps): void {
  if (!deps.mailer.configured) {
    throw new ApiError(
      503,
      'internal',
      'Diese Slider-Instanz kann keine E-Mails senden. Melde dich an und nutze „Konto & Anmeldung“, oder wende dich an den Betreiber.',
    );
  }
}

/**
 * `POST /data-requests`: mails the link to `email` if Slider stores anything about it (an
 * account or invitations), else does nothing – the caller answers the same either way.
 */
export async function requestData(
  deps: AppDeps,
  email: string,
  purpose: 'export' | 'delete',
): Promise<void> {
  assertMailConfigured(deps);
  const address = normalizeEmail(email);
  const [user] = await deps.db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${address}`)
    .limit(1);
  if (!user && (await invitesTo(deps, address)).length === 0) return;
  const now = deps.clock.now();
  const token = dataRequestToken(deps.config.secret, {
    purpose,
    email: address,
    userId: user?.id,
    expiresAt: new Date(now.getTime() + DATA_REQUEST_TTL_MS[purpose]),
  });
  // Not awaited: how long the mail server takes would tell whether the address is known.
  void sendMail(
    deps,
    inviteMail({ to: user?.email ?? address, url: dataRequestUrl(deps, token), ...MAILS[purpose] }),
  );
}

export const dataRequestUrl = (deps: AppDeps, token: string) =>
  new URL(`/daten/${token}`, deps.config.webOrigin).toString();

/** Best effort: a failed mail is logged; the caller's answer doesn't change. */
export async function sendMail(deps: AppDeps, message: MailMessage): Promise<boolean> {
  try {
    await deps.mailer.send(message);
    return true;
  } catch (error) {
    // Masked: the log keeps no stranger's full address.
    deps.log.warn(`Mail to ${maskEmail(message.to)} failed: ${String(error)}`);
    return false;
  }
}

export async function invitesTo(deps: AppDeps, address: string) {
  return deps.db
    .select({ invite: workspaceInvites, workspace: workspaces.name, invitedBy: users.name })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.createdBy))
    .where(sql`lower(${workspaceInvites.email}) = ${address}`)
    .orderBy(asc(workspaceInvites.createdAt));
}

/** Invitations to an address, as they appear in a copy of the data. */
export const inviteEntries = (rows: Awaited<ReturnType<typeof invitesTo>>) =>
  rows.map(({ invite, workspace, invitedBy }) => ({
    email: invite.email,
    workspace,
    role: invite.role,
    invitedBy,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
  }));

/** The copy for an address without account: its invitations. */
export async function exportInvites(
  deps: AppDeps,
  address: string,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const rows = await invitesTo(deps, address);
  const zip = new JSZip();
  zip.file(
    'LIESMICH.txt',
    `Deine Daten aus Slider\n\nZu ${address} gibt es kein Konto. Gespeichert sind nur Einladungen an diese Adresse (einladungen.json).\n`,
  );
  zip.file('einladungen.json', `${JSON.stringify(inviteEntries(rows), null, 2)}\n`);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { fileName: `slider-daten-${deps.clock.now().toISOString().slice(0, 10)}.zip`, bytes };
}

/** Confirmed deletion: the account (with everything `deleteAccount` covers) or the invitations. */
export async function deleteRequested(
  deps: AppDeps,
  request: ResolvedDataRequest,
  successors: Successors,
): Promise<void> {
  if (request.user) {
    // Paying for a workspace doesn't hold it up: signing in to hand over may be impossible.
    await deleteAccount(deps, request.user.id, successors, undefined, { erasure: true });
    return;
  }
  await deps.db
    .delete(workspaceInvites)
    .where(sql`lower(${workspaceInvites.email}) = ${request.email}`);
}
