import { and, desc, eq, inArray } from 'drizzle-orm';
import type { MailPerson } from '@slider/shared';
import { mailAccounts, mailMessages, mailThreads } from '../db/schema';
import type { AppDeps } from '../deps';
import { cloudContext } from './cloud/context';

/*
 * Whom one can write to, as a mail program offers it while an address is typed: the people of
 * one's own mail in the workspace – those one wrote to first (each mail a weight), then those who
 * wrote and whose domain vouched for them – the latest first. Never a spam conversation's, a
 * mailbox's own address or a machine's (no-reply). Read from the latest mails (their addresses are
 * encrypted, so not searched in the database); the client filters as one types – no request a key.
 */

/** Mails looked through, the latest first. */
const MAILS_READ = 3000;
/** Addresses handed out, the best first. */
export const MAX_ADDRESS_BOOK = 400;

const MACHINE =
  /^(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|newsletter)\b|[+-]bounces?\b/i;

export async function mailAddressBook(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<MailPerson[]> {
  await cloudContext(deps.db, workspaceId, userId);
  const accounts = await deps.db
    .select({ id: mailAccounts.id, address: mailAccounts.address })
    .from(mailAccounts)
    .where(and(eq(mailAccounts.workspaceId, workspaceId), eq(mailAccounts.userId, userId)));
  if (accounts.length === 0) return [];
  const own = new Set(accounts.map((one) => one.address.toLowerCase()));
  const rows = await deps.db
    .select({
      from: mailMessages.from,
      to: mailMessages.to,
      cc: mailMessages.cc,
      bcc: mailMessages.bcc,
      outgoing: mailMessages.outgoing,
      auth: mailMessages.auth,
    })
    .from(mailMessages)
    .innerJoin(mailThreads, eq(mailThreads.id, mailMessages.threadId))
    .where(
      and(
        inArray(
          mailMessages.accountId,
          accounts.map((one) => one.id),
        ),
        eq(mailThreads.spam, false),
      ),
    )
    .orderBy(desc(mailMessages.sentAt))
    .limit(MAILS_READ);
  const known = new Map<string, { person: MailPerson; score: number; order: number }>();
  const add = (person: MailPerson, weight: number) => {
    const address = person.address.trim();
    const key = address.toLowerCase();
    if (!address.includes('@') || own.has(key) || MACHINE.test(key)) return;
    const name = person.name.trim();
    const was = known.get(key);
    if (was) {
      was.score += weight;
      if (!was.person.name && name) was.person = { address: was.person.address, name };
    } else known.set(key, { person: { address, name }, score: weight, order: known.size });
  };
  for (const row of rows) {
    if (row.outgoing) for (const person of [...row.to, ...row.cc, ...row.bcc]) add(person, 3);
    // Someone writing in: only one their domain vouched for (anyone can write any From).
    else if (row.auth === 'pass') add(row.from, 1);
  }
  return [...known.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_ADDRESS_BOOK)
    .map((one) => one.person);
}
