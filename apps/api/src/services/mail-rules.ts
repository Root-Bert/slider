import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  type MailAuth,
  type MailRule,
  type MailRuleAdded,
  type MailRuleKind,
  type MailRuleMatch,
} from '@slider/shared';
import { emailHash } from '../crypto/content-crypto';
import {
  mailAccounts,
  mailMessages,
  mailRules,
  mailThreads,
  type MailAccountRow,
  type MailRuleRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { ownThread, tell, threadMessages } from './mail';
import { filterLearn } from './mail-filter';
import { ruleDomain } from './mail-domains';
import { requireRole } from './workspaces/roles';

const ruleDto = (row: MailRuleRow): MailRule => ({
  id: row.id,
  kind: row.kind,
  match: row.match,
  value: row.value,
  createdAt: row.createdAt.toISOString(),
});

/**
 * What one's rules say about a sender: the address rule before the domain's. `trust` counts only
 * where the mail's domain vouched for it (`auth` pass) – a forged sender stays where it lands.
 */
export async function senderRule(
  deps: AppDeps,
  account: Pick<MailAccountRow, 'workspaceId' | 'userId'>,
  address: string,
  auth: MailAuth,
): Promise<MailRuleKind | null> {
  if (!address) return null;
  const domain = ruleDomain(address);
  const hashes = [emailHash(address), ...(domain ? [emailHash(domain)] : [])];
  const rows = await deps.db
    .select({ kind: mailRules.kind, match: mailRules.match })
    .from(mailRules)
    .where(
      and(
        eq(mailRules.workspaceId, account.workspaceId),
        eq(mailRules.userId, account.userId),
        inArray(mailRules.valueHash, hashes),
      ),
    );
  const rule = rows.find((one) => one.match === 'address') ?? rows[0];
  if (!rule) return null;
  return rule.kind === 'trust' && auth !== 'pass' ? null : rule.kind;
}

/** One's rules in a workspace, the latest first. */
export async function listMailRules(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<MailRule[]> {
  await requireRole(deps.db, workspaceId, userId);
  const rows = await deps.db
    .select()
    .from(mailRules)
    .where(and(eq(mailRules.workspaceId, workspaceId), eq(mailRules.userId, userId)));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(ruleDto);
}

/**
 * A rule for the sender of a conversation's latest mail that came in (`POST
 * /mail/threads/:id/rule`) – one per value, a new kind replaces the old. It applies at once to
 * one's conversations whose latest mail came from there: blocked ones go to spam, trusted ones
 * (vouched for) leave it; what its person decided by hand stays.
 */
export async function addMailRule(
  deps: AppDeps,
  userId: string,
  threadId: string,
  input: { kind: MailRuleKind; match: MailRuleMatch },
): Promise<MailRuleAdded> {
  const { thread, account } = await ownThread(deps, userId, threadId);
  const [latest] = await deps.db
    .select({ from: mailMessages.from })
    .from(mailMessages)
    .where(and(eq(mailMessages.threadId, thread.id), eq(mailMessages.outgoing, false)))
    .orderBy(mailMessages.sentAt)
    .then((rows) => rows.slice(-1));
  const address = latest?.from.address.trim().toLowerCase() ?? '';
  if (!address) throw badRequest('In dieser Unterhaltung hat dir niemand geschrieben.');
  if (address === account.address.trim().toLowerCase())
    throw badRequest('Das ist deine eigene Adresse.');
  const value = input.match === 'address' ? address : ruleDomain(address);
  if (!value)
    throw badRequest(
      'Diese Domain gehört einem Mail-Anbieter – dort hat jeder eine Adresse. Regel den Absender allein.',
    );
  if (input.match === 'domain' && value === ruleDomain(account.address))
    throw badRequest('Das ist die Domain deines eigenen Postfachs.');

  const valueHash = emailHash(value);
  const [row] = await deps.db
    .insert(mailRules)
    .values({
      id: crypto.randomUUID(),
      workspaceId: account.workspaceId,
      userId,
      kind: input.kind,
      match: input.match,
      value,
      valueHash,
      createdAt: deps.clock.now(),
    })
    .onConflictDoUpdate({
      target: [mailRules.workspaceId, mailRules.userId, mailRules.match, mailRules.valueHash],
      set: { kind: input.kind, createdAt: deps.clock.now() },
    })
    .returning();
  const moved = await applyRule(deps, account, row!);
  return { rule: ruleDto(row!), moved };
}

/**
 * A rule gone: its sender's mails stay where they lie, their mark goes – unless another of one's
 * rules places them still (the domain's under an address's gone).
 */
export async function deleteMailRule(deps: AppDeps, userId: string, ruleId: string) {
  const [row] = await deps.db.select().from(mailRules).where(eq(mailRules.id, ruleId));
  if (!row || row.userId !== userId) throw notFound('Diese Regel gibt es nicht.');
  await deps.db.delete(mailRules).where(eq(mailRules.id, row.id));
  const unmarked: string[] = [];
  for (const one of await ruleThreads(deps, row, row)) {
    if (!(await senderRule(deps, row, one.address, one.auth))) unmarked.push(one.threadId);
  }
  if (unmarked.length === 0) return;
  const changed = await deps.db
    .update(mailThreads)
    .set({ spamBy: null })
    .where(and(inArray(mailThreads.id, unmarked), eq(mailThreads.spamBy, 'rule')))
    .returning({ id: mailThreads.id });
  for (const one of changed) tell(row, one.id);
}

type RuleOwner = Pick<MailAccountRow, 'workspaceId' | 'userId'>;

/** Conversations a new rule teaches the filter about at most. */
const LEARN_THREADS = 20;

/** One's conversations whose latest mail that came in is from a rule's sender. */
async function ruleThreads(
  deps: AppDeps,
  owner: RuleOwner,
  rule: Pick<MailRuleRow, 'match' | 'value'>,
): Promise<{ threadId: string; address: string; auth: MailAuth }[]> {
  const accounts = await deps.db
    .select({ id: mailAccounts.id })
    .from(mailAccounts)
    .where(
      and(eq(mailAccounts.workspaceId, owner.workspaceId), eq(mailAccounts.userId, owner.userId)),
    );
  if (accounts.length === 0) return [];
  const rows = await deps.db
    .select({
      threadId: mailMessages.threadId,
      from: mailMessages.from,
      auth: mailMessages.auth,
      sentAt: mailMessages.sentAt,
    })
    .from(mailMessages)
    .where(
      and(
        inArray(
          mailMessages.accountId,
          accounts.map((one) => one.id),
        ),
        isNotNull(mailMessages.threadId),
        eq(mailMessages.outgoing, false),
      ),
    );
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const before = latest.get(row.threadId!);
    if (!before || before.sentAt < row.sentAt) latest.set(row.threadId!, row);
  }
  return [...latest.values()]
    .map((row) => ({
      threadId: row.threadId!,
      address: row.from.address.trim().toLowerCase(),
      auth: row.auth,
    }))
    .filter((one) =>
      rule.match === 'address'
        ? one.address === rule.value
        : ruleDomain(one.address) === rule.value,
    );
}

/** A new rule on one's conversations whose latest mail that came in matches it. */
async function applyRule(deps: AppDeps, owner: RuleOwner, rule: MailRuleRow): Promise<number> {
  // Its sender's conversations, as all one's rules now say (an address rule before a domain's).
  const said = new Map<string, MailRuleKind | null>();
  const placed: { threadId: string; spam: boolean }[] = [];
  for (const one of await ruleThreads(deps, owner, rule)) {
    const key = `${one.address}|${one.auth}`;
    if (!said.has(key)) said.set(key, await senderRule(deps, owner, one.address, one.auth));
    const kind = said.get(key);
    if (kind) placed.push({ threadId: one.threadId, spam: kind === 'block' });
  }
  if (placed.length === 0) return 0;
  const threads = await deps.db
    .select({ id: mailThreads.id, spam: mailThreads.spam, spamBy: mailThreads.spamBy })
    .from(mailThreads)
    .where(
      inArray(
        mailThreads.id,
        placed.map((one) => one.threadId),
      ),
    );
  const before = new Map(threads.map((one) => [one.id, one]));
  let moved = 0;
  for (const spam of [true, false]) {
    const ids = placed
      .filter((one) => one.spam === spam && before.get(one.threadId)?.spamBy !== 'person')
      .map((one) => one.threadId)
      .filter((id) => before.has(id));
    if (ids.length === 0) continue;
    await deps.db
      .update(mailThreads)
      .set({ spam, spamBy: 'rule' })
      .where(inArray(mailThreads.id, ids));
    for (const id of ids) {
      if (before.get(id)!.spam !== spam) moved += 1;
      tell(owner, id);
    }
    // A rule set by hand teaches the instance's filter, as a click does – once, for the
    // conversations it places now (its sender's later mails teach nothing).
    for (const id of ids.slice(0, LEARN_THREADS))
      filterLearn(
        deps,
        (await threadMessages(deps, id)).filter((one) => !one.outgoing).slice(-1),
        spam,
      );
  }
  return moved;
}
