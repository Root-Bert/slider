import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import {
  API_PREFIX,
  MAIL_SYNC_MINUTES,
  mailFolderList,
  MAX_MAIL_ATTACHED_BYTES,
  MAX_MAIL_UPLOAD_BYTES,
} from '@slider/shared';
import type {
  MailAccount,
  MailAccountInput,
  MailAuth,
  MailContext,
  MailMessage,
  MailPerson,
  MailSync,
  MailThread,
  MailThreadSummary,
  MailUpload,
} from '@slider/shared';
import {
  mailAccounts,
  mailMessages,
  mailThreads,
  mailUploads,
  users,
  workspaceMembers,
  type MailAccountRow,
  type MailAttachmentRow,
  type MailInlineImageRow,
  type MailMessageRow,
  type MailThreadRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { alignedWith, dkimDomains, topField } from '../mail/dkim';
import { ApiError, badRequest, notFound } from '../http/errors';
import {
  MailCheckError,
  MAX_RAW_BYTES,
  realMailServers,
  type FetchedMail,
  type MailLogin,
  type MailServers,
  type SeenFlag,
  type SeenMark,
} from '../mail/servers';
import { forgetMailToken, mailAccessToken, MailSignInNeeded } from '../mail/oauth';
import { cloudContext } from './cloud/context';
import { requireRole } from './workspaces/roles';
import { postFromMail, senderLive } from './sender';
import { deleteBlobs, storageBlobs } from './blob-deletions';
import {
  fetchMailImage,
  INLINE_IMAGE_TYPES,
  keptMailHtml,
  mailHtmlDocument,
  mailHtmlView,
  MAX_MAIL_IMAGE_BYTES,
} from './mail-html';

/*
 * Mail in Sender: a person's mailboxes in a workspace, read every minute. A colleague's mail –
 * from an address of someone in the workspace, vouched for by its domain – goes into their direct
 * conversation; every other mail into a mail conversation of its own, beside the chats.
 */

/** An attachment larger than this is not kept (the mail still is, naming it). */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** A mailbox whose last round failed is tried again only this long after. */
const RETRY_FAILED_MS = 10 * 60_000;
/** The words of a list row: enough for its longest „Vorschau“ (3 lines, `/einstellungen` › Mail). */
const SNIPPET = 400;
/** The pictures a mail's HTML shows from itself, at most. */
const MAX_INLINE_IMAGES = 30;
/** A mailbox reads its inbox's latest mails again for their HTML only right after a good round. */
const HTML_READ_WITHIN_MS = 60 * 60_000;

export const mailServersOf = (deps: Pick<AppDeps, 'mailServers'>): MailServers =>
  deps.mailServers ?? realMailServers;

// ── Mailboxes ──────────────────────────────────────────────────────────────

export function accountDto(row: MailAccountRow): MailAccount {
  return {
    id: row.id,
    address: row.address,
    name: row.name,
    label: row.label || null,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapSecure: row.imapSecure,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    username: row.username,
    signIn: row.auth,
    state: row.state,
    error: row.error,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    aiReads: row.aiReads,
    folders: mailFolderList(row.folders),
  };
}

/**
 * Where new mail arrives: the inbox, and the server's spam folder. Only what came in there counts
 * as new (unread), is read by the AI by itself, goes to a colleague's chat; what is first seen in
 * another folder (Gesendet, Archiv, one's own …) is taken in quietly – it was there before.
 */
const ARRIVES = ['inbox', 'spam'];

const loginOf = (row: MailLogin): MailLogin => ({
  address: row.address,
  name: row.name,
  imapHost: row.imapHost,
  imapPort: row.imapPort,
  imapSecure: row.imapSecure,
  smtpHost: row.smtpHost,
  smtpPort: row.smtpPort,
  smtpSecure: row.smtpSecure,
  username: row.username,
  password: row.password,
});

/**
 * How the servers are signed in to: the password, or – signed in through the provider – an
 * access token (`MailSignInNeeded` once the provider ended the sign-in).
 */
async function loginFor(deps: AppDeps, row: MailAccountRow): Promise<MailLogin> {
  if (row.auth === 'password') return loginOf(row);
  return { ...loginOf(row), password: '', accessToken: await mailAccessToken(deps, row) };
}

async function ownAccount(deps: AppDeps, userId: string, accountId: string) {
  const [row] = await deps.db.select().from(mailAccounts).where(eq(mailAccounts.id, accountId));
  if (!row || row.userId !== userId) throw notFound('Dieses Postfach gibt es nicht.');
  // Only while one is in its workspace, and not while that is blocked (BER-167).
  await requireRole(deps.db, row.workspaceId, userId);
  return row;
}

export async function listMailAccounts(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<MailAccount[]> {
  await cloudContext(deps.db, workspaceId, userId);
  const rows = await deps.db
    .select()
    .from(mailAccounts)
    .where(and(eq(mailAccounts.workspaceId, workspaceId), eq(mailAccounts.userId, userId)))
    .orderBy(mailAccounts.createdAt);
  return rows.map(accountDto);
}

async function checked(deps: AppDeps, login: MailLogin) {
  try {
    await mailServersOf(deps).check(login);
  } catch (error) {
    // The form shows the step where it stopped and what the server said.
    if (error instanceof MailCheckError)
      throw new ApiError(400, 'bad_request', error.message, { mailCheck: error.failure });
    throw badRequest(error instanceof Error ? error.message : String(error));
  }
}

/** Adds a mailbox once both servers let it in; its latest mails come at once. */
export async function addMailAccount(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  input: MailAccountInput,
): Promise<MailAccount> {
  await cloudContext(deps.db, workspaceId, userId);
  const { label, ...rest } = input;
  const login = { ...rest, name: input.name || input.address };
  await checked(deps, login);
  const now = deps.clock.now();
  const [row] = await deps.db
    .insert(mailAccounts)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      userId,
      ...login,
      label: label || null,
      state: 'ok',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('Mail account insert returned nothing');
  later(deps, () => syncMailAccount(deps, row.id));
  return accountDto(row);
}

/** Changes a mailbox; a change of its sign-in or servers is tried before it is kept. */
/** Server names are the same whatever their case. */
const sameServer = (one: string | number, other: string | number) =>
  String(one).trim().toLowerCase() === String(other).trim().toLowerCase();

export async function updateMailAccount(
  deps: AppDeps,
  userId: string,
  accountId: string,
  { label, ...patch }: Partial<MailAccountInput>,
): Promise<MailAccount> {
  const row = await ownAccount(deps, userId, accountId);
  // Its own name: trimmed by the schema; empty is its default again.
  const named = label !== undefined ? { label: label || null } : {};
  if (row.auth !== 'password') {
    // Signed in through the provider: address, servers and sign-in are its – only the name and
    // whether the AI reads along change here (ports and TLS fill in by default: not looked at).
    const fixed = (['address', 'imapHost', 'smtpHost', 'username', 'password'] as const).some(
      (key) => patch[key] !== undefined && !sameServer(patch[key], row[key]),
    );
    if (fixed)
      throw badRequest(
        'Dieses Postfach meldet sich über seinen Anbieter an – Adresse und Server stehen fest.',
      );
    const [saved] = await deps.db
      .update(mailAccounts)
      .set({
        ...(patch.name !== undefined ? { name: patch.name || row.address } : {}),
        ...(patch.aiReads !== undefined ? { aiReads: patch.aiReads } : {}),
        ...named,
        updatedAt: deps.clock.now(),
      })
      .where(eq(mailAccounts.id, accountId))
      .returning();
    if (!saved) throw notFound('Dieses Postfach gibt es nicht.');
    return accountDto(saved);
  }
  // The kept password goes to no other server: whoever moves the mailbox types it again.
  const moves = (['imapHost', 'imapPort', 'smtpHost', 'smtpPort'] as const).some(
    (key) => patch[key] !== undefined && !sameServer(patch[key], row[key]),
  );
  if (moves && !patch.password)
    throw badRequest('Der Server ändert sich – gib das Passwort noch einmal ein.');
  const next = { ...loginOf(row), ...patch };
  const reaches = (
    [
      'imapHost',
      'imapPort',
      'imapSecure',
      'smtpHost',
      'smtpPort',
      'smtpSecure',
      'username',
      'password',
      'address',
    ] as const
  ).some((key) => patch[key] !== undefined && patch[key] !== row[key]);
  if (reaches) await checked(deps, next);
  const [saved] = await deps.db
    .update(mailAccounts)
    .set({
      ...next,
      ...named,
      ...(reaches ? { state: 'ok' as const, error: null } : {}),
      updatedAt: deps.clock.now(),
    })
    .where(eq(mailAccounts.id, accountId))
    .returning();
  if (!saved) throw notFound('Dieses Postfach gibt es nicht.');
  if (reaches) later(deps, () => syncMailAccount(deps, saved.id));
  return accountDto(saved);
}

/**
 * Signs in to both servers as the mailbox is kept, changing nothing – the form's check, for an
 * agent (`check_mailbox`); refused as the form is (`mailCheck`).
 */
export async function checkMailAccount(deps: AppDeps, userId: string, accountId: string) {
  const row = await ownAccount(deps, userId, accountId);
  await checked(deps, await loginFor(deps, row));
}

/** Deletes a mailbox here – its mails here and their attachments; on the server all stays. */
export async function deleteMailAccount(deps: AppDeps, userId: string, accountId: string) {
  const row = await ownAccount(deps, userId, accountId);
  // Its refresh token goes with the row, its access token from memory.
  await deps.db.delete(mailAccounts).where(eq(mailAccounts.id, accountId));
  forgetMailToken(accountId);
  await deps.storage.deletePrefix(`mail/${accountId}/`);
  tell(row, null);
}

// ── Reading ────────────────────────────────────────────────────────────────

const working = new Set<string>();

/** In the background (tests wait for it); without a worker as a loose promise. */
export function later(deps: AppDeps, work: () => Promise<void>) {
  if (deps.background) deps.background.run(work);
  else void work();
}

/** Reads what came to a mailbox since the last time; a failure is kept on it, not thrown. */
export async function syncMailAccount(deps: AppDeps, accountId: string): Promise<void> {
  if (working.has(accountId)) return;
  working.add(accountId);
  try {
    const [row] = await deps.db.select().from(mailAccounts).where(eq(mailAccounts.id, accountId));
    if (!row) return;
    let fetched: Awaited<ReturnType<MailServers['fetch']>>;
    // Once, since mails keep their HTML: the inbox read as the first time (its latest mails), the
    // ones known already get their HTML (`ingestMail`). Only right after a good round – what came
    // since is then among those latest few.
    const htmlRead =
      !row.htmlRead &&
      row.state === 'ok' &&
      !!row.lastSyncAt &&
      deps.clock.now().getTime() - row.lastSyncAt.getTime() < HTML_READ_WITHIN_MS;
    const { inbox: _inbox, ...withoutInbox } = row.sync;
    try {
      fetched = await mailServersOf(deps).fetch(
        await loginFor(deps, row),
        htmlRead ? withoutInbox : row.sync,
      );
    } catch (error) {
      // The provider ended the sign-in: marked already, nothing tried until signed in anew.
      if (error instanceof MailSignInNeeded) {
        if (row.state !== 'signin') tell(row, null);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await deps.db
        .update(mailAccounts)
        .set({ state: 'error', error: message, lastSyncAt: deps.clock.now() })
        .where(eq(mailAccounts.id, accountId));
      if (row.state !== 'error' || row.error !== message) tell(row, null);
      return;
    }
    // A folder numbered anew on the server (UIDVALIDITY): its old UIDs name other mails now.
    const renumbered = ARRIVES.filter(
      (key) =>
        row.sync[key] &&
        fetched.state[key] &&
        row.sync[key].validity !== fetched.state[key].validity,
    );
    if (renumbered.length > 0)
      await deps.db
        .update(mailMessages)
        .set({ uid: null, seenPending: false })
        .where(
          and(eq(mailMessages.accountId, accountId), inArray(mailMessages.folder, renumbered)),
        );
    const touched = new Set<string>();
    const arrived = new Set<string>();
    for (const mail of fetched.mails) {
      try {
        const thread = await ingestMail(deps, row, mail);
        if (thread) touched.add(thread);
        if (thread && ARRIVES.includes(mail.folder)) arrived.add(thread);
      } catch (error) {
        deps.log.warn('Mail: a mail could not be read', { accountId, error });
      }
    }
    await deps.db
      .update(mailAccounts)
      .set({
        sync: fetched.state,
        ...(fetched.folders ? { folders: fetched.folders } : {}),
        // A mailbox without an inbox read yet reads it whole the first time anyway.
        ...(htmlRead || !row.sync.inbox ? { htmlRead: true } : {}),
        state: 'ok',
        error: null,
        lastSyncAt: deps.clock.now(),
      })
      .where(eq(mailAccounts.id, accountId));
    // Its folders changed, a known mail found in one more of them: the lists are fetched anew.
    const foldersChanged =
      !!fetched.folders && JSON.stringify(fetched.folders) !== JSON.stringify(row.folders);
    // Read or unread on the server meanwhile – so here too; and what was read here goes there.
    const flagged = await mirrorSeen(deps, accountId, fetched.flags ?? []);
    await pushSeen(deps, accountId);
    if (row.state !== 'ok' || foldersChanged || fetched.mails.length > 0 || flagged.size > 0)
      tell(row, null);
    for (const threadId of touched) {
      tell(row, threadId);
      if (arrived.has(threadId)) afterMail?.(deps, threadId);
    }
    for (const threadId of flagged) if (!touched.has(threadId)) tell(row, threadId);
  } finally {
    working.delete(accountId);
  }
}

/**
 * The server's read state of mails read before: read or unread there (a mail program, the phone)
 * – so here, unless changed here and not set there yet (`seen_pending`). Returns the
 * conversations that changed.
 */
async function mirrorSeen(
  deps: AppDeps,
  accountId: string,
  flags: readonly SeenFlag[],
): Promise<Set<string>> {
  const changed = new Set<string>();
  for (const seen of [true, false])
    for (const folder of new Set(flags.map((one) => one.folder))) {
      const uids = flags
        .filter((one) => one.folder === folder && one.seen === seen)
        .map((one) => one.uid);
      for (let at = 0; at < uids.length; at += 500) {
        const rows = await deps.db
          .update(mailMessages)
          .set({ seen })
          .where(
            and(
              eq(mailMessages.accountId, accountId),
              eq(mailMessages.folder, folder),
              inArray(mailMessages.uid, uids.slice(at, at + 500)),
              eq(mailMessages.seen, !seen),
              eq(mailMessages.seenPending, false),
            ),
          )
          .returning({ threadId: mailMessages.threadId });
        for (const one of rows) if (one.threadId) changed.add(one.threadId);
      }
    }
  return changed;
}

const marking = new Set<string>();

/**
 * Read here → read on the server too (`\Seen`, in the mail's folder by its UID), in the
 * background: the page never waits. What does not get there (the server away, the sign-in ended)
 * stays `seen_pending` and goes with the next round.
 */
export async function pushSeen(deps: AppDeps, accountId: string): Promise<void> {
  const servers = mailServersOf(deps);
  if (!servers.mark || marking.has(accountId)) return;
  marking.add(accountId);
  try {
    const [row] = await deps.db.select().from(mailAccounts).where(eq(mailAccounts.id, accountId));
    if (!row || row.state === 'signin') return;
    const pending = await deps.db
      .select({
        id: mailMessages.id,
        folder: mailMessages.folder,
        uid: mailMessages.uid,
        seen: mailMessages.seen,
      })
      .from(mailMessages)
      .where(and(eq(mailMessages.accountId, accountId), eq(mailMessages.seenPending, true)))
      .limit(500);
    if (pending.length === 0) return;
    const pathOf = new Map(row.folders.map((one) => [one.key, one.path]));
    if (!pathOf.has('inbox')) pathOf.set('inbox', 'INBOX');
    const keyOf = (one: SeenMark) => `${one.path}\n${one.uid}\n${one.seen}`;
    const marks = pending.flatMap((one) => {
      const path = pathOf.get(one.folder);
      return path && one.uid !== null ? [{ id: one.id, path, uid: one.uid, seen: one.seen }] : [];
    });
    const done = new Set(
      marks.length > 0
        ? (
            await servers.mark(
              await loginFor(deps, row),
              marks.map(({ path, uid, seen }) => ({ path, uid, seen })),
            )
          ).map(keyOf)
        : [],
    );
    // Set there – or its folder is gone from the server (its folders known): nothing to set.
    const settled = pending.filter((one) => {
      const mark = marks.find((each) => each.id === one.id);
      return mark ? done.has(keyOf(mark)) : row.folders.length > 0;
    });
    for (const seen of [true, false]) {
      const ids = settled.filter((one) => one.seen === seen).map((one) => one.id);
      if (ids.length > 0)
        await deps.db
          .update(mailMessages)
          .set({ seenPending: false })
          // Changed again meanwhile: that goes next.
          .where(and(inArray(mailMessages.id, ids), eq(mailMessages.seen, seen)));
    }
  } catch (error) {
    if (!(error instanceof MailSignInNeeded))
      deps.log.warn('Mail: the read state did not get to the server', { accountId, error });
  } finally {
    marking.delete(accountId);
  }
}

/** Set by the AI's part (`mail-context`): a mail conversation got a new mail. */
let afterMail: ((deps: AppDeps, threadId: string) => void) | null = null;
export function onNewMail(run: (deps: AppDeps, threadId: string) => void) {
  afterMail = run;
}

/** How often one's mailboxes are read (`MAIL_SYNC_MINUTES`; never set: every round). */
export async function mailSyncOf(deps: AppDeps, userId: string): Promise<MailSync> {
  const [row] = await deps.db
    .select({ minutes: users.mailSyncMinutes })
    .from(users)
    .where(eq(users.id, userId));
  const minutes = MAIL_SYNC_MINUTES.find((each) => each === row?.minutes) ?? 1;
  return { minutes };
}

export async function setMailSync(
  deps: AppDeps,
  userId: string,
  minutes: number,
): Promise<MailSync> {
  await deps.db
    .update(users)
    .set({ mailSyncMinutes: minutes === 1 ? null : minutes })
    .where(eq(users.id, userId));
  return mailSyncOf(deps, userId);
}

/** Every mailbox, one after the other – the clock's round; a failed one waits a while. */
export async function syncAllMail(deps: AppDeps): Promise<void> {
  const rows = await deps.db
    .select({
      id: mailAccounts.id,
      state: mailAccounts.state,
      lastSyncAt: mailAccounts.lastSyncAt,
      every: users.mailSyncMinutes,
    })
    .from(mailAccounts)
    .innerJoin(users, eq(users.id, mailAccounts.userId));
  const now = deps.clock.now().getTime();
  for (const row of rows) {
    // Waiting for its person to sign in anew: never tried by itself.
    if (row.state === 'signin') continue;
    // Its person reads it when they ask, or less often than every round (a little early is fine:
    // the clock's rounds are a minute apart).
    if (row.every === 0) continue;
    if (row.every && row.lastSyncAt && now - row.lastSyncAt.getTime() < row.every * 60_000 - 30_000)
      continue;
    if (row.state === 'error' && row.lastSyncAt && now - row.lastSyncAt.getTime() < RETRY_FAILED_MS)
      continue;
    await syncMailAccount(deps, row.id);
  }
}

/** A mailbox kept or signed in anew elsewhere (`mail-oauth`): its person's list is fetched anew. */
export const tellMailbox = (row: Pick<MailAccountRow, 'workspaceId' | 'userId'>) => tell(row, null);

/** Whoever has the mailbox sees the change at once (their mail list is fetched anew). */
function tell(row: Pick<MailAccountRow, 'workspaceId' | 'userId'>, threadId: string | null) {
  if (!senderLive.open(row.workspaceId)) return;
  senderLive.publish(row.workspaceId, new Set([row.userId]), { type: 'mail', threadId });
}

function people(value: AddressObject | AddressObject[] | undefined): MailPerson[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((group) => group.value)
    .flatMap((one) => (one.group ? one.group : [one]))
    .filter((one) => !!one.address)
    .map((one) => ({ address: (one.address ?? '').toLowerCase(), name: one.name || '' }));
}

/**
 * Providers whose receiving server writes the topmost `Authentication-Results` of every mail it
 * takes in: read through their own IMAP, that header is theirs, whatever a sender wrote below
 * it. Their customers' mails often carry no signature of the sender's own domain (Google signs
 * with gappssmtp.com, Microsoft with onmicrosoft.com) or Exchange rewrites them so it breaks.
 * Microsoft names no server (authserv-id) in it.
 */
const PROVIDER_RESULTS: readonly { hosts: readonly string[]; servers: RegExp }[] = [
  { hosts: ['imap.gmail.com', 'imap.googlemail.com'], servers: /^mx\.google\.com$/ },
  {
    hosts: ['outlook.office365.com', 'outlook.office.com', 'imap-mail.outlook.com'],
    servers: /^$|(^|\.)(outlook|office365)\.com$/,
  },
];

/** Whether the mailbox's provider says in its topmost header: DMARC passed for the From domain. */
export function providerVouches(topResults: string, imapHost: string, fromAddress: string) {
  const provider = PROVIDER_RESULTS.find((one) => one.hosts.includes(imapHost.toLowerCase()));
  if (!provider || !fromAddress) return false;
  const text = topResults.toLowerCase();
  const head = (text.split(';')[0] ?? '').trim();
  const server = head.includes('=') ? '' : (head.split(/\s/)[0] ?? '');
  if (!provider.servers.test(server)) return false;
  const said = /\bdmarc=pass\b[^;]*?\bheader\.from=([a-z0-9.-]+)/.exec(text)?.[1];
  return !!said && said === (fromAddress.split('@')[1] ?? '').toLowerCase();
}

/**
 * How the sender's domain vouched for a mail. `pass`: a DKIM signature of the From address's
 * own domain this server verified (`dkimDomains`), or – read from Gmail's or Microsoft's IMAP –
 * their topmost header saying DMARC passed (`providerVouches`). Never a header elsewhere, which
 * anyone can write where the provider adds none. `fail`: the topmost header says DMARC failed – a
 * warning; a soft SPF result or a list's broken second signature is no reason.
 */
export function authOf(
  topResults: string,
  fromAddress: string,
  signedBy: readonly string[],
  providerSays = false,
): MailAuth {
  if (fromAddress && signedBy.some((domain) => alignedWith(fromAddress, domain))) return 'pass';
  if (providerSays) return 'pass';
  if (/\bdmarc=fail\b/.test(topResults.toLowerCase())) return 'fail';
  return 'none';
}

/** What a mail says new: without the quoted mails below („Am … schrieb …:“, „> …“). */
export function freshPart(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (line, index) =>
      /^(am|on)\s.+(schrieb|wrote)[^:]*:\s*$/i.test(line.trim()) ||
      /^-{2,}\s*(original message|ursprüngliche nachricht|weitergeleitete nachricht)/i.test(
        line.trim(),
      ) ||
      (/^(von|from):\s/i.test(line.trim()) &&
        index > 0 &&
        lines[index - 1]?.trim() === '' &&
        /^(gesendet|sent|date|datum):/i.test(lines[index + 1]?.trim() ?? '')) ||
      (line.startsWith('>') &&
        lines.slice(index).every((rest) => rest.startsWith('>') || !rest.trim())),
  );
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

/** The subject without „Re:“, „AW:“, „Fwd:“ in front – what a conversation is called. */
export function bareSubject(subject: string): string {
  return subject.replace(/^(\s*(re|aw|wg|fwd?|antw)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();
}

/** Rspamd's word on a mail, where one is set up: `true` – spam. */
async function rspamdSays(deps: AppDeps, raw: Uint8Array, from: string): Promise<boolean> {
  const url = deps.config.rspamdUrl;
  if (!url) return false;
  try {
    const response = await fetch(new URL('/checkv2', url), {
      method: 'POST',
      body: raw,
      headers: { From: from },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const verdict = (await response.json()) as { action?: string };
    return (
      verdict.action === 'reject' ||
      verdict.action === 'add header' ||
      verdict.action === 'rewrite subject'
    );
  } catch (error) {
    deps.log.warn('Mail: Rspamd did not answer', { error });
    return false;
  }
}

/** The workspace's people with these addresses (lower case) – address → their id. */
async function colleaguesByAddress(
  deps: AppDeps,
  workspaceId: string,
  addresses: Iterable<string>,
): Promise<Map<string, string>> {
  const wanted = [...new Set([...addresses].map((one) => one.toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const rows = await deps.db
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        sql`lower(${users.email}) in (${sql.join(
          wanted.map((one) => sql`${one}`),
          sql`, `,
        )})`,
      ),
    );
  return new Map(rows.map((row) => [row.email.toLowerCase(), row.id]));
}

/**
 * The colleague a mail is a chat message from: someone of the workspace (not the mailbox's own
 * person) who wrote it to the mailbox alone or with colleagues only. With anyone from outside on
 * it, it stays a mail conversation – shown as mail (`mailThreadKind`).
 */
async function colleagueOf(
  deps: AppDeps,
  account: MailAccountRow,
  from: string,
  others: readonly MailPerson[],
) {
  const own = account.address.toLowerCase();
  const rest = others.map((one) => one.address).filter((address) => address !== own);
  const known = await colleaguesByAddress(deps, account.workspaceId, [from, ...rest]);
  const id = known.get(from.toLowerCase());
  if (!id || id === account.userId) return null;
  return rest.every((address) => known.has(address)) ? id : null;
}

/**
 * Who is on each conversation (from all its mails) but one's own mailboxes – colleagues with
 * their id, known once for all.
 */
async function peopleOn(
  deps: AppDeps,
  scope: { workspaceId: string; userId: string; own: ReadonlySet<string> },
  rows: readonly Pick<MailMessageRow, 'threadId' | 'from' | 'to' | 'cc' | 'auth'>[],
): Promise<Map<string, MailPerson[]>> {
  const byThread = new Map<string, Map<string, MailPerson>>();
  // A colleague only as who signed a mail here: an address in To/Cc, or a From no domain vouched
  // for, could be anyone's – it stays someone from outside.
  const vouched = new Set<string>();
  for (const row of rows) {
    if (!row.threadId) continue;
    if (row.auth === 'pass' && row.from.address) vouched.add(`${row.threadId} ${row.from.address}`);
    const on = byThread.get(row.threadId) ?? new Map<string, MailPerson>();
    for (const one of [row.from, ...row.to, ...row.cc]) {
      if (!one.address || scope.own.has(one.address)) continue;
      const known = on.get(one.address);
      if (!known || (!known.name && one.name)) on.set(one.address, { ...one });
    }
    byThread.set(row.threadId, on);
  }
  const addresses = [...byThread.values()].flatMap((on) => [...on.keys()]);
  const known = await colleaguesByAddress(deps, scope.workspaceId, addresses);
  return new Map(
    [...byThread].map(([threadId, on]) => [
      threadId,
      [...on.values()].map((one) => {
        const signed = vouched.has(`${threadId} ${one.address}`);
        const id = signed ? (known.get(one.address) ?? null) : null;
        return {
          ...one,
          userId: id === scope.userId ? null : id,
          ...(signed && { vouched: true }),
        };
      }),
    ]),
  );
}

async function keepAttachments(deps: AppDeps, account: MailAccountRow, parsed: ParsedMail) {
  const kept: MailAttachmentRow[] = [];
  for (const attachment of parsed.attachments) {
    // Pictures inside the text (signatures, logos) are no attachments one would keep.
    if (attachment.related || (attachment.contentDisposition === 'inline' && attachment.cid))
      continue;
    if (attachment.size > MAX_ATTACHMENT_BYTES) continue;
    const id = crypto.randomUUID();
    const key = `mail/${account.id}/${id}`;
    await deps.storage.put(key, new Uint8Array(attachment.content));
    kept.push({
      id,
      name: attachment.filename || 'Anhang',
      type: attachment.contentType || 'application/octet-stream',
      size: attachment.size,
      key,
    });
  }
  return kept;
}

/** The pictures the mail's HTML shows from itself (`cid:`), kept in the blob store. */
async function keepInlineImages(
  deps: AppDeps,
  account: MailAccountRow,
  parsed: ParsedMail,
  html: string | null,
) {
  const kept: MailInlineImageRow[] = [];
  if (!html) return kept;
  for (const attachment of parsed.attachments) {
    const cid = attachment.cid?.replace(/^<|>$/g, '');
    if (
      !cid ||
      kept.length >= MAX_INLINE_IMAGES ||
      kept.some((one) => one.cid === cid) ||
      !INLINE_IMAGE_TYPES.includes(attachment.contentType) ||
      attachment.size > MAX_MAIL_IMAGE_BYTES ||
      !html.includes(`cid:${cid}`)
    )
      continue;
    const id = crypto.randomUUID();
    const key = `mail/${account.id}/${id}`;
    await deps.storage.put(key, new Uint8Array(attachment.content));
    kept.push({ id, cid, type: attachment.contentType, size: attachment.size, key });
  }
  return kept;
}

/**
 * Takes one mail in: known already – nothing; a colleague's, vouched for – into the chat with
 * them; else into its conversation (the one it answers, or a new one). Returns the conversation.
 */
export async function ingestMail(
  deps: AppDeps,
  account: MailAccountRow,
  mail: FetchedMail,
): Promise<string | null> {
  if (mail.raw.byteLength > MAX_RAW_BYTES) return null;
  const parsed = await simpleParser(Buffer.from(mail.raw), { skipImageLinks: true });
  const messageId =
    parsed.messageId ??
    `<${createHash('sha256').update(mail.raw).digest('hex').slice(0, 32)}@slider>`;
  const [known] = await deps.db
    .select({
      id: mailMessages.id,
      folder: mailMessages.folder,
      folders: mailMessages.folders,
      uid: mailMessages.uid,
      seen: mailMessages.seen,
      seenPending: mailMessages.seenPending,
      noHtml: sql<boolean>`${mailMessages.html} is null`,
    })
    .from(mailMessages)
    .where(and(eq(mailMessages.accountId, account.id), eq(mailMessages.messageId, messageId)));
  if (known) {
    // Kept before mails kept their HTML (read again once, `htmlRead`): it gets it now.
    const html = known.noHtml && parsed.html ? keptMailHtml(parsed.html) : null;
    const inline = await keepInlineImages(deps, account, parsed, html);
    const inlineBytes = inline.reduce((sum, one) => sum + one.size, 0);
    // Known already (sent from here, a copy, another label): it lies in this folder too; read
    // there, it is read here (never unread by a copy); its inbox numbered anew: its new UID.
    const change = {
      ...(!known.folders.includes(mail.folder) ? { folders: [...known.folders, mail.folder] } : {}),
      ...(mail.seen && !known.seen && !known.seenPending ? { seen: true } : {}),
      ...(known.folder === mail.folder && ARRIVES.includes(mail.folder) && known.uid !== mail.uid
        ? { uid: mail.uid }
        : {}),
      ...(html
        ? {
            html,
            inlineImages: inline,
            attachmentBytes: sql`${mailMessages.attachmentBytes} + ${inlineBytes}`,
          }
        : {}),
    };
    if (Object.keys(change).length > 0)
      await deps.db.update(mailMessages).set(change).where(eq(mailMessages.id, known.id));
    return null;
  }
  const arrives = ARRIVES.includes(mail.folder);

  const from = people(parsed.from)[0] ?? { address: '', name: '' };
  const to = people(parsed.to);
  const cc = people(parsed.cc);
  const subject = (parsed.subject ?? '').trim();
  const text = (parsed.text ?? '').trim();
  const sentAt =
    parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : deps.clock.now();
  // One's own only where one's own mails lie (sent, a folder of one's own): a From with one's
  // address in the inbox or spam is anyone's to write – checked as every mail that arrives, never
  // read at once, never the person's words to the AI.
  const outgoing = from.address === account.address.toLowerCase() && !arrives;
  const topResults = topField(mail.raw, 'authentication-results');
  const auth = authOf(
    topResults,
    from.address,
    outgoing ? [] : await dkimDomains(mail.raw, deps.mailDns),
    !outgoing && providerVouches(topResults, account.imapHost, from.address),
  );
  const spam =
    mail.folder === 'spam' ||
    (mail.folder === 'inbox' && !outgoing && (await rspamdSays(deps, mail.raw, from.address)));
  const references = [
    ...(Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : []),
  ];
  const inReplyTo = parsed.inReplyTo ?? null;
  const attachments = await keepAttachments(deps, account, parsed);
  const html = parsed.html ? keptMailHtml(parsed.html) : null;
  const inlineImages = await keepInlineImages(deps, account, parsed, html);
  // Kept files whose mail does not get in (the mailbox deleted meanwhile, kept twice) go again.
  const unkeep = () =>
    deleteBlobs(deps, storageBlobs([...attachments, ...inlineImages].map((one) => one.key)));
  try {
    const row = {
      id: crypto.randomUUID(),
      accountId: account.id,
      folder: mail.folder,
      folders: [mail.folder],
      uid: mail.uid,
      messageId,
      inReplyTo,
      references,
      from,
      to,
      cc,
      subject,
      text,
      html,
      inlineImages,
      attachments,
      attachmentBytes: [...attachments, ...inlineImages].reduce((sum, one) => sum + one.size, 0),
      auth,
      outgoing,
      // As on the server; what one wrote, or found in another folder, is read.
      seen: outgoing || !arrives || mail.seen === true,
      sentAt,
      createdAt: deps.clock.now(),
    };

    const colleague =
      mail.folder === 'inbox' && !spam && !outgoing && auth === 'pass' && from.address
        ? await colleagueOf(deps, account, from.address, [...to, ...cc])
        : null;
    if (colleague) {
      const said = freshPart(text) || text;
      const named =
        attachments.length > 0
          ? `\n\n${attachments.length === 1 ? 'Anhang' : 'Anhänge'}: ${attachments.map((one) => one.name).join(', ')}`
          : '';
      const message = await postFromMail(deps, {
        fromUserId: colleague,
        toUserId: account.userId,
        workspaceId: account.workspaceId,
        subject: bareSubject(subject),
        text: `${said}${named}`,
      });
      const [added] = await deps.db
        .insert(mailMessages)
        .values({ ...row, threadId: null, senderMessageId: message.id })
        .onConflictDoNothing()
        .returning({ id: mailMessages.id });
      if (!added) await unkeep();
      return null;
    }

    const answered = [inReplyTo, ...references].filter((id): id is string => !!id);
    const [earlier] =
      answered.length > 0
        ? await deps.db
            .select({ threadId: mailMessages.threadId })
            .from(mailMessages)
            .where(
              and(
                eq(mailMessages.accountId, account.id),
                inArray(mailMessages.messageId, answered),
                isNotNull(mailMessages.threadId),
              ),
            )
            .limit(1)
        : [];
    let threadId = earlier?.threadId ?? null;
    if (threadId) {
      await deps.db
        .update(mailThreads)
        .set({ lastAt: sql`greatest(${mailThreads.lastAt}, ${sentAt.toISOString()}::timestamptz)` })
        .where(eq(mailThreads.id, threadId));
    } else {
      threadId = crypto.randomUUID();
      await deps.db.insert(mailThreads).values({
        id: threadId,
        accountId: account.id,
        subject: bareSubject(subject) || '(ohne Betreff)',
        spam,
        lastAt: sentAt,
        // What one sent oneself is read, and what was in another folder before.
        readAt: outgoing || !arrives ? deps.clock.now() : null,
        createdAt: deps.clock.now(),
      });
    }
    const [added] = await deps.db
      .insert(mailMessages)
      .values({ ...row, threadId })
      .onConflictDoNothing()
      .returning({ id: mailMessages.id });
    if (!added) await unkeep();
    return threadId;
  } catch (error) {
    await unkeep();
    throw error;
  }
}

// ── Conversations ──────────────────────────────────────────────────────────

function messageDto(row: MailMessageRow): MailMessage {
  return {
    id: row.id,
    from: row.from,
    to: row.to,
    cc: row.cc,
    subject: row.subject,
    text: row.text,
    sentAt: row.sentAt.toISOString(),
    outgoing: row.outgoing,
    auth: row.auth,
    attachments: row.attachments.map(({ id, name, type, size }) => ({ id, name, type, size })),
    ...(row.html ? { html: true } : {}),
    ...(row.outgoing && row.bcc.length > 0 ? { bcc: row.bcc } : {}),
    ...(row.sendState
      ? {
          outbox: {
            state: row.sendState,
            at: (row.sendAt ?? row.sentAt).toISOString(),
            error: row.sendError,
          },
        }
      : {}),
  };
}

/** The other side of a mail: who sent it, or – sent from here – whom it went to. */
const otherSide = (row: Pick<MailMessageRow, 'outgoing' | 'from' | 'to'>): MailPerson =>
  row.outgoing ? (row.to[0] ?? row.from) : row.from;

/** A mail that came in where new mail arrives (`ARRIVES`), or was written here. */
const arrivedHere = sql`(${mailMessages.folder} in ('inbox', 'spam') or ${mailMessages.uid} is null)`;

/** Which conversations a list shows: one mailbox's, one folder's (by its key). */
export interface MailThreadFilter {
  accountId?: string | undefined;
  folder?: string | undefined;
}

/**
 * A person's mail conversations in a workspace, newest first. Without a folder: the side bar's –
 * what came in to the inbox or the spam folder, or was written here, and spam. A folder: the
 * conversations with a mail in it (not spam) – `inbox` those of the side bar but spam, `spam`
 * every one marked spam (by the server's folder, the AI or its person).
 */
export async function listMailThreads(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  filter: MailThreadFilter = {},
): Promise<MailThreadSummary[]> {
  await cloudContext(deps.db, workspaceId, userId);
  const has = (condition: ReturnType<typeof sql>) =>
    sql`exists (select 1 from ${mailMessages} where ${mailMessages.threadId} = ${mailThreads.id} and ${condition})`;
  const { folder } = filter;
  const inFolder =
    folder === undefined
      ? sql`(${mailThreads.spam} or ${has(arrivedHere)})`
      : folder === 'spam'
        ? sql`${mailThreads.spam}`
        : folder === 'inbox'
          ? sql`(not ${mailThreads.spam} and ${has(arrivedHere)})`
          : sql`(not ${mailThreads.spam} and ${has(sql`${mailMessages.folders} @> ${JSON.stringify([folder])}::jsonb`)})`;
  const threads = await deps.db
    .select({ thread: mailThreads })
    .from(mailThreads)
    .innerJoin(mailAccounts, eq(mailAccounts.id, mailThreads.accountId))
    .where(
      and(
        eq(mailAccounts.workspaceId, workspaceId),
        eq(mailAccounts.userId, userId),
        filter.accountId ? eq(mailAccounts.id, filter.accountId) : undefined,
        inFolder,
      ),
    )
    .orderBy(desc(mailThreads.lastAt))
    .limit(200);
  if (threads.length === 0) return [];
  const ids = threads.map((row) => row.thread.id);
  const latest = await deps.db
    .selectDistinctOn([mailMessages.threadId])
    .from(mailMessages)
    .where(inArray(mailMessages.threadId, ids))
    .orderBy(mailMessages.threadId, desc(mailMessages.sentAt));
  const byThread = new Map(latest.map((row) => [row.threadId, row]));
  const counts = await deps.db
    .select({ threadId: mailMessages.threadId, count: sql<number>`count(*)::int` })
    .from(mailMessages)
    .where(
      and(
        inArray(mailMessages.threadId, ids),
        eq(mailMessages.outgoing, false),
        inArray(mailMessages.folder, ARRIVES),
        eq(mailMessages.seen, false),
      ),
    )
    .groupBy(mailMessages.threadId);
  const unread = new Map(counts.map((row) => [row.threadId, row.count]));
  // Who is on each – from all its mails.
  const everyone = await deps.db
    .select({
      threadId: mailMessages.threadId,
      from: mailMessages.from,
      to: mailMessages.to,
      cc: mailMessages.cc,
      auth: mailMessages.auth,
    })
    .from(mailMessages)
    .where(inArray(mailMessages.threadId, ids));
  const own = await deps.db
    .select({ address: mailAccounts.address })
    .from(mailAccounts)
    .where(and(eq(mailAccounts.workspaceId, workspaceId), eq(mailAccounts.userId, userId)));
  const peopleOf = await peopleOn(
    deps,
    { workspaceId, userId, own: new Set(own.map((row) => row.address.toLowerCase())) },
    everyone,
  );
  return threads.flatMap(({ thread }) => {
    const last = byThread.get(thread.id);
    if (!last) return [];
    return [
      {
        id: thread.id,
        accountId: thread.accountId,
        subject: thread.subject,
        person: otherSide(last),
        people: peopleOf.get(thread.id) ?? [],
        snippet: (freshPart(last.text) || last.text).replace(/\s+/g, ' ').slice(0, SNIPPET),
        unread: unread.get(thread.id) ?? 0,
        spam: thread.spam,
        updatedAt: thread.lastAt.toISOString(),
      },
    ];
  });
}

/** A conversation and its mailbox, for its person alone (anyone else: 404). */
export async function ownThread(deps: AppDeps, userId: string, threadId: string) {
  const [found] = await deps.db
    .select({ thread: mailThreads, account: mailAccounts })
    .from(mailThreads)
    .innerJoin(mailAccounts, eq(mailAccounts.id, mailThreads.accountId))
    .where(eq(mailThreads.id, threadId));
  if (!found || found.account.userId !== userId) throw notFound('Diese Mail gibt es nicht.');
  await requireRole(deps.db, found.account.workspaceId, userId);
  return found;
}

export async function threadMessages(deps: AppDeps, threadId: string) {
  return deps.db
    .select()
    .from(mailMessages)
    .where(eq(mailMessages.threadId, threadId))
    .orderBy(mailMessages.sentAt);
}

/** What the AI made before it said whether it helps and what to know: it showed, so it still does. */
const withDefaults = (
  context: Partial<MailContext> & Omit<MailContext, 'needsInfo' | 'facts' | 'links'>,
): MailContext => ({
  ...context,
  needsInfo: context.needsInfo ?? true,
  facts: context.facts ?? [],
  links: context.links ?? [],
});

function threadDto(
  thread: MailThreadRow,
  account: MailAccountRow,
  rows: MailMessageRow[],
  people: MailPerson[],
): MailThread {
  return {
    id: thread.id,
    account: { id: account.id, address: account.address },
    subject: thread.subject,
    people,
    spam: thread.spam,
    messages: rows.map(messageDto),
    context: thread.context ? withDefaults(thread.context) : null,
    contextState: thread.contextState,
  };
}

export async function getMailThread(
  deps: AppDeps,
  userId: string,
  threadId: string,
): Promise<MailThread> {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const rows = await threadMessages(deps, threadId);
  const people = await peopleOn(
    deps,
    { workspaceId: account.workspaceId, userId, own: new Set([account.address.toLowerCase()]) },
    rows,
  );
  return threadDto(thread, account, rows, people.get(thread.id) ?? []);
}

/** Read: nothing new in it any more – here at once, on the server in the background. */
export async function readMailThread(deps: AppDeps, userId: string, threadId: string) {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const now = deps.clock.now();
  await deps.db.update(mailThreads).set({ readAt: now }).where(eq(mailThreads.id, thread.id));
  await markThreadSeen(deps, account, thread.id);
  tell(account, thread.id);
}

/**
 * Unread again, as a mail program does it: its latest mail that came in is new once more – the
 * count is back, and on the server too (`pushSeen`). One that never came in (only one's own) stays.
 */
export async function unreadMailThread(deps: AppDeps, userId: string, threadId: string) {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const [latest] = await deps.db
    .select({ id: mailMessages.id, uid: mailMessages.uid })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.threadId, thread.id),
        eq(mailMessages.outgoing, false),
        inArray(mailMessages.folder, ARRIVES),
      ),
    )
    .orderBy(desc(mailMessages.sentAt))
    .limit(1);
  if (!latest) return;
  await deps.db
    .update(mailMessages)
    .set({ seen: false, seenPending: latest.uid !== null })
    .where(eq(mailMessages.id, latest.id));
  await deps.db.update(mailThreads).set({ readAt: null }).where(eq(mailThreads.id, thread.id));
  if (latest.uid !== null) later(deps, () => pushSeen(deps, account.id));
  tell(account, thread.id);
}

/** Its mails read; those from the server set read there too (`pushSeen`, in the background). */
async function markThreadSeen(deps: AppDeps, account: MailAccountRow, threadId: string) {
  const marked = await deps.db
    .update(mailMessages)
    .set({ seen: true, seenPending: sql`${mailMessages.uid} is not null` })
    .where(and(eq(mailMessages.threadId, threadId), eq(mailMessages.seen, false)))
    .returning({ uid: mailMessages.uid });
  if (marked.some((one) => one.uid !== null)) later(deps, () => pushSeen(deps, account.id));
}

/** Spam, or not after all – it moves out of the way (or back). */
export async function markMailSpam(deps: AppDeps, userId: string, threadId: string, spam: boolean) {
  const { thread, account } = await ownThread(deps, userId, threadId);
  await deps.db.update(mailThreads).set({ spam }).where(eq(mailThreads.id, thread.id));
  tell(account, thread.id);
}

/** Deletes a mail conversation here (on the server it stays). */
export async function deleteMailThread(deps: AppDeps, userId: string, threadId: string) {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const rows = await threadMessages(deps, thread.id);
  await deps.db.delete(mailThreads).where(eq(mailThreads.id, thread.id));
  for (const row of rows)
    for (const one of [...row.attachments, ...row.inlineImages]) await deps.storage.delete(one.key);
  tell(account, null);
}

const reSubject = (subject: string) =>
  /^\s*(re|aw)\s*:/i.test(subject) ? subject : `Re: ${subject}`;

/** A mail written here, as it goes into the outbox. */
interface Outgoing {
  to: MailPerson[];
  cc: MailPerson[];
  bcc: MailPerson[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  /** Kept for it already (a forwarded mail's, copied): they go along. */
  attachments: MailAttachmentRow[];
}

/** A `sending` mail this long ago: the server stopped while it went – whether it did is unclear. */
const SENDING_LOST_MS = 5 * 60 * 1000;

/**
 * Into the outbox: in the conversation at once (read, its time now), out after `delay` seconds
 * (`sendDueMail`) – taken back meanwhile (`takeBackMail`), it never goes. Without a delay it goes
 * right away, and refused it is not kept: the caller says why and keeps the words.
 */
async function queueMail(
  deps: AppDeps,
  account: MailAccountRow,
  threadId: string,
  mail: Outgoing,
  delay: number,
): Promise<MailMessage> {
  const now = deps.clock.now();
  // Its own `Message-ID`, given to the server: the copy in „Gesendet“ is known as this one.
  const domain = account.address.split('@')[1] || 'slider.local';
  const [row] = await deps.db
    .insert(mailMessages)
    .values({
      id: crypto.randomUUID(),
      accountId: account.id,
      threadId,
      folder: 'sent',
      folders: ['sent'],
      uid: null,
      messageId: `<${crypto.randomUUID()}@${domain}>`,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      from: { address: account.address.toLowerCase(), name: account.name },
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments,
      attachmentBytes: mail.attachments.reduce((sum, one) => sum + one.size, 0),
      auth: 'pass',
      outgoing: true,
      seen: true,
      sendState: 'queued',
      sendAt: new Date(now.getTime() + delay * 1000),
      sentAt: now,
      createdAt: now,
    })
    .returning();
  if (!row) throw new Error('Mail insert returned nothing');
  await deps.db
    .update(mailThreads)
    .set({ lastAt: now, readAt: now })
    .where(eq(mailThreads.id, threadId));
  // Answered: what it answers is read.
  await markThreadSeen(deps, account, threadId);
  if (delay === 0) {
    const error = await sendQueued(deps, row.id);
    if (error !== null) {
      // Refused at once: gone again – its files wait on the mail being written, to send again.
      await deps.db.delete(mailMessages).where(eq(mailMessages.id, row.id));
      await backToUploads(deps, account, row.attachments);
      tell(account, threadId);
      throw badRequest(error);
    }
  }
  tell(account, threadId);
  const [kept] = await deps.db.select().from(mailMessages).where(eq(mailMessages.id, row.id));
  return messageDto(kept ?? row);
}

/**
 * Sends one queued mail – taken first (`sending`), so it never goes twice. Returns why it did not
 * go (kept `failed` with that), `null` once it went or was no longer queued.
 */
async function sendQueued(deps: AppDeps, id: string): Promise<string | null> {
  const [row] = await deps.db
    .update(mailMessages)
    .set({ sendState: 'sending' })
    .where(and(eq(mailMessages.id, id), eq(mailMessages.sendState, 'queued')))
    .returning();
  if (!row) return null;
  const [account] = await deps.db
    .select()
    .from(mailAccounts)
    .where(eq(mailAccounts.id, row.accountId));
  if (!account) return null;
  try {
    const attachments = [];
    for (const one of row.attachments) {
      const bytes = await deps.storage.get(one.key);
      if (bytes) attachments.push({ name: one.name, type: one.type, content: bytes });
    }
    const sent = await mailServersOf(deps).send(await loginFor(deps, account), {
      messageId: row.messageId,
      to: row.to.map((one) => one.address),
      cc: row.cc.map((one) => one.address),
      bcc: row.bcc.map((one) => one.address),
      subject: row.subject,
      text: row.text,
      inReplyTo: row.inReplyTo,
      references: row.references,
      attachments,
    });
    await deps.db
      .update(mailMessages)
      .set({
        sendState: null,
        sendAt: null,
        sendError: null,
        sentAt: deps.clock.now(),
        ...(sent.messageId && sent.messageId !== row.messageId
          ? { messageId: sent.messageId }
          : {}),
      })
      .where(eq(mailMessages.id, row.id));
    tell(account, row.threadId);
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await deps.db
      .update(mailMessages)
      .set({ sendState: 'failed', sendError: reason.slice(0, 500) })
      .where(eq(mailMessages.id, row.id));
    tell(account, row.threadId);
    return reason;
  }
}

/**
 * The outbox's round (`server.ts`, every few seconds): what is due goes out, one after the other;
 * one left `sending` by a stopped server is `failed` – whether it went is unclear.
 */
export async function sendDueMail(deps: AppDeps): Promise<void> {
  const now = deps.clock.now();
  await deps.db
    .update(mailMessages)
    .set({
      sendState: 'failed',
      sendError: 'Unklar, ob sie rausging – sieh in „Gesendet“ nach, bevor du sie erneut sendest.',
    })
    .where(
      and(
        eq(mailMessages.sendState, 'sending'),
        lte(mailMessages.sendAt, new Date(now.getTime() - SENDING_LOST_MS)),
      ),
    );
  const due = await deps.db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(and(eq(mailMessages.sendState, 'queued'), lte(mailMessages.sendAt, now)))
    .orderBy(mailMessages.sendAt)
    .limit(25);
  for (const { id } of due) await sendQueued(deps, id);
}

/** A mail in one of one's own conversations. */
async function ownMessage(deps: AppDeps, userId: string, threadId: string, messageId: string) {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const [row] = await deps.db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.id, messageId), eq(mailMessages.threadId, thread.id)));
  if (!row) throw notFound('Diese Mail gibt es nicht.');
  return { thread, account, row };
}

/**
 * Takes a mail back out of the outbox before it goes (or after it failed): gone from the
 * conversation – and a conversation it started with it. Returns what it said, for the field.
 */
export async function takeBackMail(
  deps: AppDeps,
  userId: string,
  threadId: string,
  messageId: string,
) {
  const { thread, account, row } = await ownMessage(deps, userId, threadId, messageId);
  if (row.sendState !== 'queued' && row.sendState !== 'failed')
    throw badRequest('Diese Mail ist schon unterwegs.');
  const [taken] = await deps.db
    .delete(mailMessages)
    .where(
      and(
        eq(mailMessages.id, row.id),
        inArray(mailMessages.sendState, ['queued', 'failed'] as const),
      ),
    )
    .returning();
  if (!taken) throw badRequest('Diese Mail ist schon unterwegs.');
  // Its files back on the mail being written, as they were put on it.
  const uploads = await backToUploads(deps, account, taken.attachments);
  const left = await threadMessages(deps, thread.id);
  const gone = left.length === 0;
  if (gone) await deps.db.delete(mailThreads).where(eq(mailThreads.id, thread.id));
  tell(account, gone ? null : thread.id);
  return {
    text: taken.text,
    subject: taken.subject,
    to: taken.to.map((one) => one.address),
    cc: taken.cc.map((one) => one.address),
    bcc: taken.bcc.map((one) => one.address),
    uploads,
    threadGone: gone,
  };
}

/** A mail that did not go: into the outbox again, out right away. */
export async function sendMailAgain(
  deps: AppDeps,
  userId: string,
  threadId: string,
  messageId: string,
) {
  const { row } = await ownMessage(deps, userId, threadId, messageId);
  if (row.sendState !== 'failed') throw badRequest('Diese Mail ist nicht hängen geblieben.');
  await deps.db
    .update(mailMessages)
    .set({ sendState: 'queued', sendAt: deps.clock.now(), sendError: null })
    .where(and(eq(mailMessages.id, row.id), eq(mailMessages.sendState, 'failed')));
  const error = await sendQueued(deps, row.id);
  if (error !== null) throw badRequest(error);
}

/** Addresses as one typed them: with the name the conversation knows them by. */
function peopleFor(addresses: string[], known: MailPerson[]): MailPerson[] {
  const seen = new Set<string>();
  return addresses.flatMap((typed) => {
    const address = typed.toLowerCase();
    if (seen.has(address)) return [];
    seen.add(address);
    return [{ address, name: known.find((one) => one.address === address)?.name ?? '' }];
  });
}

/** Answers a mail conversation – its last mail's sender, or everyone on it, or whom one set. */
export async function replyMail(
  deps: AppDeps,
  userId: string,
  threadId: string,
  input: {
    text: string;
    all: boolean;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    uploads?: string[];
    delay: number;
  },
): Promise<MailMessage> {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const rows = await threadMessages(deps, thread.id);
  const last = rows.findLast((row) => !row.outgoing && !row.sendState) ?? rows.at(-1);
  if (!last) throw badRequest('Diese Unterhaltung hat keine Mail.');
  const self = account.address.toLowerCase();
  const known = rows.flatMap((row) => [row.from, ...row.to, ...row.cc]);
  let to: MailPerson[];
  let cc: MailPerson[];
  if (input.to) {
    to = peopleFor(input.to, known);
    cc = peopleFor(input.cc ?? [], known).filter(
      (one) => !to.some((t) => t.address === one.address),
    );
  } else {
    to = last.outgoing ? last.to : [last.from];
    const seen = new Set([self, ...to.map((one) => one.address)]);
    cc = input.all
      ? [...last.to, ...last.cc].filter(
          (one) => !seen.has(one.address) && (seen.add(one.address), true),
        )
      : [];
  }
  if (to.length === 0) throw badRequest('Gib an, an wen sie geht.');
  const attachments = await takeUploads(deps, account, input.uploads ?? []);
  try {
    return await queueMail(
      deps,
      account,
      thread.id,
      {
        to,
        cc,
        bcc: peopleFor(input.bcc ?? [], known),
        subject: reSubject(last.subject || thread.subject),
        text: input.text,
        inReplyTo: last.messageId,
        references: [...last.references, last.messageId].slice(-20),
        attachments,
      },
      input.delay,
    );
  } catch (error) {
    // Not queued (refused is handled there): the files wait on the mail being written again.
    if (!(error instanceof ApiError)) await backToUploads(deps, account, attachments);
    throw error;
  }
}

/** Copies of a mail's attachments for one passing it on – each mail owns its own. */
async function copiedAttachments(
  deps: AppDeps,
  userId: string,
  account: MailAccountRow,
  from: { threadId: string; messageId: string },
): Promise<MailAttachmentRow[]> {
  const { row } = await ownMessage(deps, userId, from.threadId, from.messageId);
  const copies: MailAttachmentRow[] = [];
  for (const one of row.attachments) {
    const bytes = await deps.storage.get(one.key);
    if (!bytes) continue;
    const id = crypto.randomUUID();
    const key = `mail/${account.id}/${id}`;
    await deps.storage.put(key, bytes);
    copies.push({ id, name: one.name, type: one.type, size: one.size, key });
  }
  return copies;
}

// ── Files put on a mail being written ───────────────────────────────────────────────────────

/** A file's name as it may stand in a mail: no path, no control characters, not too long. */
function uploadName(name: string) {
  const bare = name.split(/[\\/]/).pop() ?? '';
  return (
    bare
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 200) || 'Datei'
  );
}

/** Puts a file on a mail being written from this mailbox – it waits there until the mail goes. */
export async function uploadMailFile(
  deps: AppDeps,
  userId: string,
  accountId: string,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<MailUpload> {
  const account = await ownAccount(deps, userId, accountId);
  if (file.bytes.byteLength === 0) throw badRequest('Diese Datei ist leer.');
  if (file.bytes.byteLength > MAX_MAIL_UPLOAD_BYTES) {
    throw badRequest('Diese Datei ist zu groß – höchstens 20 MB je Datei.');
  }
  const id = crypto.randomUUID();
  const key = `mail/${account.id}/${id}`;
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream';
  const name = uploadName(file.name);
  await deps.storage.put(key, file.bytes);
  await deps.db.insert(mailUploads).values({
    id,
    accountId: account.id,
    name,
    type,
    size: file.bytes.byteLength,
    key,
    createdAt: deps.clock.now(),
  });
  return { id, name, type, size: file.bytes.byteLength };
}

/** Takes a file off the mail being written: gone, bytes and all. */
export async function dropMailUpload(deps: AppDeps, userId: string, uploadId: string) {
  const [found] = await deps.db
    .select({ upload: mailUploads, account: mailAccounts })
    .from(mailUploads)
    .innerJoin(mailAccounts, eq(mailAccounts.id, mailUploads.accountId))
    .where(eq(mailUploads.id, uploadId));
  if (!found || found.account.userId !== userId) return;
  await deps.db.delete(mailUploads).where(eq(mailUploads.id, uploadId));
  await deps.storage.delete(found.upload.key);
}

/**
 * The files put on a mail, taken for it as it is queued – each once (a second send of the same
 * finds them gone). One missing, or all together too big: none taken.
 */
async function takeUploads(
  deps: AppDeps,
  account: MailAccountRow,
  ids: readonly string[],
): Promise<MailAttachmentRow[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  // Put on while another of one's mailboxes was picked: they go along all the same.
  const own = deps.db
    .select({ id: mailAccounts.id })
    .from(mailAccounts)
    .where(eq(mailAccounts.userId, account.userId));
  const taken = await deps.db
    .delete(mailUploads)
    .where(and(inArray(mailUploads.id, wanted), inArray(mailUploads.accountId, own)))
    .returning();
  const size = taken.reduce((sum, one) => sum + one.size, 0);
  if (taken.length !== wanted.length || size > MAX_MAIL_ATTACHED_BYTES) {
    if (taken.length > 0) await deps.db.insert(mailUploads).values(taken);
    throw badRequest(
      taken.length !== wanted.length
        ? 'Ein Anhang ist nicht mehr da – häng ihn bitte noch einmal an.'
        : 'Die Anhänge sind zusammen zu groß – höchstens 25 MB.',
    );
  }
  // Their bytes under the mailbox they go from (gone with it); in the order they were put on.
  const rows: MailAttachmentRow[] = [];
  for (const id of wanted) {
    const one = taken.find((each) => each.id === id);
    if (!one) continue;
    let key = one.key;
    if (one.accountId !== account.id) {
      const bytes = await deps.storage.get(one.key);
      key = `mail/${account.id}/${one.id}`;
      if (bytes) await deps.storage.put(key, bytes);
      await deps.storage.delete(one.key);
    }
    rows.push({ id: one.id, name: one.name, type: one.type, size: one.size, key });
  }
  return rows;
}

/** A mail's attachments back on the mail being written (taken back, or refused). */
async function backToUploads(
  deps: AppDeps,
  account: MailAccountRow,
  attachments: readonly MailAttachmentRow[],
): Promise<MailUpload[]> {
  if (attachments.length === 0) return [];
  const now = deps.clock.now();
  await deps.db
    .insert(mailUploads)
    .values(attachments.map((one) => ({ ...one, accountId: account.id, createdAt: now })))
    .onConflictDoNothing();
  return attachments.map(({ id, name, type, size }) => ({ id, name, type, size }));
}

/** Files put on a mail that never went: gone after seven days (the hourly retention job). */
export async function sweepMailUploads(deps: AppDeps): Promise<void> {
  const before = new Date(deps.clock.now().getTime() - 7 * 86_400_000);
  const old = await deps.db
    .delete(mailUploads)
    .where(lt(mailUploads.createdAt, before))
    .returning({ key: mailUploads.key });
  for (const one of old) await deps.storage.delete(one.key);
}

/** A new mail from one of one's mailboxes – a conversation of its own (passed on: with its attachments). */
export async function sendNewMail(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  input: {
    accountId: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string;
    forward?: { threadId: string; messageId: string };
    uploads?: string[];
    delay: number;
  },
): Promise<{ threadId: string; message: MailMessage }> {
  // A member of the workspace in the address, writing from one of their mailboxes there.
  await cloudContext(deps.db, workspaceId, userId);
  const account = await ownAccount(deps, userId, input.accountId);
  if (account.workspaceId !== workspaceId) throw notFound('Dieses Postfach gibt es nicht.');
  const uploaded = await takeUploads(deps, account, input.uploads ?? []);
  const forwarded = input.forward
    ? await copiedAttachments(deps, userId, account, input.forward).catch(
        async (error: unknown) => {
          await backToUploads(deps, account, uploaded);
          throw error;
        },
      )
    : [];
  const attachments = [...forwarded, ...uploaded];
  if (attachments.reduce((sum, one) => sum + one.size, 0) > MAX_MAIL_ATTACHED_BYTES) {
    await backToUploads(deps, account, uploaded);
    for (const one of forwarded) await deps.storage.delete(one.key);
    throw badRequest('Die Anhänge sind zusammen zu groß – höchstens 25 MB.');
  }
  const now = deps.clock.now();
  const threadId = crypto.randomUUID();
  await deps.db.insert(mailThreads).values({
    id: threadId,
    accountId: account.id,
    subject: input.subject || '(ohne Betreff)',
    lastAt: now,
    readAt: now,
    createdAt: now,
  });
  const to = peopleFor(input.to, []);
  try {
    const message = await queueMail(
      deps,
      account,
      threadId,
      {
        to,
        cc: peopleFor(input.cc, []).filter((one) => !to.some((t) => t.address === one.address)),
        bcc: peopleFor(input.bcc, []),
        subject: input.subject,
        text: input.text,
        inReplyTo: null,
        references: [],
        attachments,
      },
      input.delay,
    );
    return { threadId, message };
  } catch (error) {
    await deps.db.delete(mailThreads).where(eq(mailThreads.id, threadId));
    // Not queued (refused is handled there): the files wait on the mail being written again.
    if (!(error instanceof ApiError)) {
      await backToUploads(deps, account, uploaded);
      for (const one of forwarded) await deps.storage.delete(one.key);
    }
    throw error;
  }
}

/** An attachment's bytes, for its owner. */
export async function mailAttachment(
  deps: AppDeps,
  userId: string,
  threadId: string,
  attachmentId: string,
) {
  await ownThread(deps, userId, threadId);
  // Also a picture the mail's HTML shows from itself (`cid:`).
  const found = (await threadMessages(deps, threadId))
    .flatMap((row) => [
      ...row.attachments,
      ...row.inlineImages.map((one) => ({ ...one, name: one.cid })),
    ])
    .find((one) => one.id === attachmentId);
  if (!found) throw notFound('Diesen Anhang gibt es nicht.');
  const bytes = await deps.storage.get(found.key);
  if (!bytes) throw notFound('Diesen Anhang gibt es nicht mehr.');
  return { ...found, bytes };
}

// ── A mail as it looks (its HTML, `services/mail-html.ts`) ────────────────────

/** The outside pictures a mail's HTML shows, per mail – what the proxy fetches for it alone. */
const remoteOf = new Map<string, string[]>();
const REMEMBERED = 200;

async function htmlOf(deps: AppDeps, userId: string, threadId: string, messageId: string) {
  await ownThread(deps, userId, threadId);
  const [row] = await deps.db
    .select({ html: mailMessages.html, inlineImages: mailMessages.inlineImages })
    .from(mailMessages)
    .where(and(eq(mailMessages.id, messageId), eq(mailMessages.threadId, threadId)));
  if (!row?.html) throw notFound('Diese Mail gibt es nicht.');
  return { html: row.html, inlineImages: row.inlineImages };
}

/**
 * The proxy's key for one picture of one mail: only the page asked for with its pictures names it.
 * Without it, CSS that slipped past the cleaning (`image-set("image?src=…")`, an escaped `url`) –
 * allowed by the frame's `img-src 'self'` – would have the server fetch a tracker unasked.
 */
const pictureKey = (deps: AppDeps, userId: string, messageId: string, src: string) =>
  createHmac('sha256', deps.config.secret)
    .update(`slider:mail-image:v1\n${userId}\n${messageId}\n${src}`)
    .digest('base64url')
    .slice(0, 22);

function viewOf(
  deps: AppDeps,
  userId: string,
  threadId: string,
  messageId: string,
  kept: { html: string; inlineImages: MailInlineImageRow[] },
  images: boolean,
) {
  const thread = `${API_PREFIX}/mail/threads/${encodeURIComponent(threadId)}`;
  const view = mailHtmlView(
    kept.html,
    (cid) => {
      const one = kept.inlineImages.find((each) => each.cid === cid);
      return one ? `${thread}/attachments/${one.id}` : null;
    },
    images
      ? (url) =>
          `${thread}/messages/${encodeURIComponent(messageId)}/image?src=${encodeURIComponent(url)}&k=${pictureKey(deps, userId, messageId, url)}`
      : null,
  );
  if (remoteOf.size >= REMEMBERED) remoteOf.delete(remoteOf.keys().next().value!);
  remoteOf.set(`${threadId}/${messageId}`, view.remote);
  return view;
}

/**
 * A mail's HTML as the frame's page, for its owner: pictures from outside only with `images`, and
 * then through {@link mailImage}; how many it leaves out is in the page.
 */
export async function mailHtmlPage(
  deps: AppDeps,
  userId: string,
  threadId: string,
  messageId: string,
  images: boolean,
): Promise<string> {
  const kept = await htmlOf(deps, userId, threadId, messageId);
  const view = viewOf(deps, userId, threadId, messageId, kept, images);
  return mailHtmlDocument(view.body, view.remote.length);
}

/**
 * A picture from outside a mail shows, fetched by the server for its owner – only one that mail
 * names (no open proxy), and only with the key its page gave it when asked for with its pictures
 * (`key`). `null`: it did not come or is no picture.
 */
export async function mailImage(
  deps: AppDeps,
  userId: string,
  threadId: string,
  messageId: string,
  src: string,
  key: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  await ownThread(deps, userId, threadId);
  const expected = Buffer.from(pictureKey(deps, userId, messageId, src));
  const given = Buffer.from(key);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw notFound('Dieses Bild gibt es in der Mail nicht.');
  const remote =
    remoteOf.get(`${threadId}/${messageId}`) ??
    viewOf(deps, userId, threadId, messageId, await htmlOf(deps, userId, threadId, messageId), true)
      .remote;
  if (!remote.includes(src)) throw notFound('Dieses Bild gibt es in der Mail nicht.');
  return fetchMailImage(deps, src);
}
