import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { MailUnsubscribed } from '@slider/shared';
import { mailMessages, type MailUnsubscribeRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { topField } from '../mail/dkim';
import { unsubscribeOf } from '../mail/unsubscribe';
import { dnsLookup, safeFetch } from '../sources/safe-fetch';
import { loginFor, mailServersOf, ownThread, readMailThread, sendNewMail } from './mail';
import { unsubscribeLink } from './mail-context';

/*
 * „Abbestellen“ for newsletters, many at once: what the sender's `List-Unsubscribe` offers –
 * one click (RFC 8058: a POST, no page) or a mail to its address – is done here; where it only
 * names a page (or the mail only links one), the page is handed back to be opened. Mails kept
 * before 0179 lack the header: it is asked from the server once (`MailServers.headers`).
 */

/** The answer of a one-click POST is not read – a little is enough to know it went. */
const MAX_ANSWER_BYTES = 64 * 1024;

async function unsubscribeHeader(
  deps: AppDeps,
  account: Awaited<ReturnType<typeof ownThread>>['account'],
  message: { id: string; folder: string; uid: number | null },
): Promise<MailUnsubscribeRow | null> {
  const servers = mailServersOf(deps);
  if (!servers.headers || message.uid === null) return null;
  const path =
    account.folders.find((one) => one.key === message.folder)?.path ??
    (message.folder === 'inbox' ? 'INBOX' : null);
  if (!path) return null;
  try {
    const [found] = await servers.headers(
      await loginFor(deps, account),
      [{ path, uid: message.uid }],
      ['list-unsubscribe', 'list-unsubscribe-post'],
    );
    if (!found) return null;
    const row = unsubscribeOf(
      topField(found.header, 'list-unsubscribe'),
      topField(found.header, 'list-unsubscribe-post'),
    );
    if (row)
      await deps.db
        .update(mailMessages)
        .set({ unsubscribe: row })
        .where(eq(mailMessages.id, message.id));
    return row;
  } catch (error) {
    deps.log.info(`Unsubscribe: headers not read: ${String(error)}`);
    return null;
  }
}

async function oneClick(deps: AppDeps, url: string): Promise<boolean> {
  const network = deps.senderLogos ?? {};
  try {
    const { response } = await safeFetch(
      new URL(url),
      {
        fetch: network.fetch ?? globalThis.fetch,
        lookup: network.lookup ?? dnsLookup,
        maxBytes: MAX_ANSWER_BYTES,
      },
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (compatible; Slider)',
        },
        body: 'List-Unsubscribe=One-Click',
      },
    );
    await response.body?.cancel();
    return response.ok;
  } catch (error) {
    deps.log.info(`Unsubscribe: one click failed: ${String(error)}`);
    return false;
  }
}

/**
 * Leaves the list one mail conversation came from. `done`: one click or the mail went – read;
 * `link`: only a page does it (`url` to open) – still unread; `none`: nothing found – read.
 */
export async function unsubscribeMailThread(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  threadId: string,
): Promise<MailUnsubscribed> {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const [latest] = await deps.db
    .select({
      id: mailMessages.id,
      folder: mailMessages.folder,
      uid: mailMessages.uid,
      unsubscribe: mailMessages.unsubscribe,
      html: mailMessages.html,
      text: mailMessages.text,
    })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.threadId, thread.id),
        eq(mailMessages.outgoing, false),
        isNotNull(mailMessages.sentAt),
      ),
    )
    .orderBy(desc(mailMessages.sentAt))
    .limit(1);
  if (!latest) return { threadId, result: 'none', url: null };
  // Never for spam: a click there tells the sender the address is read.
  if (thread.spam) {
    await readMailThread(deps, userId, threadId);
    return { threadId, result: 'none', url: null };
  }
  const header = latest.unsubscribe ?? (await unsubscribeHeader(deps, account, latest));
  if (header?.http && header.oneClick && (await oneClick(deps, header.http))) {
    await readMailThread(deps, userId, threadId);
    return { threadId, result: 'done', url: null };
  }
  if (header?.mailto) {
    const address = new URL(header.mailto);
    const to = decodeURIComponent(address.pathname);
    await sendNewMail(deps, userId, workspaceId, {
      accountId: account.id,
      to: [to],
      cc: [],
      bcc: [],
      subject: address.searchParams.get('subject') || 'unsubscribe',
      text: address.searchParams.get('body') || 'unsubscribe',
      delay: 0,
    });
    await readMailThread(deps, userId, threadId);
    return { threadId, result: 'done', url: null };
  }
  // Only its page does it: left unread, so it stays on the list until that is done.
  const page = header?.http ?? unsubscribeLink(latest);
  if (page) return { threadId, result: 'link', url: page };
  await readMailThread(deps, userId, threadId);
  return { threadId, result: 'none', url: null };
}
