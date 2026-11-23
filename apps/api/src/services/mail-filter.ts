import { isIP } from 'node:net';
import MailComposer from 'nodemailer/lib/mail-composer';
import { orgDomain } from '@slider/shared';
import type { MailMessageRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { headerFields } from '../mail/dkim';

/**
 * The instance's spam filter (Rspamd, `deploy/rspamd`, `RSPAMD_URL`): it checks what the
 * mailboxes bring and learns – instance-wide, Bayes in Redis – only from what people decide (the
 * menu's „Als Spam markieren“/„Kein Spam“, their rules), never from the AI or itself.
 */

/** Rspamd's word on a mail: spam or not, and its strongest reasons (symbols, highest first). */
export interface FilterVerdict {
  spam: boolean;
  symbols: string[];
}

/** Reasons kept with a conversation the filter moved – shown as words in its mark's tooltip. */
const MAX_SYMBOLS = 6;
const CHECK_MS = 10_000;
const LEARN_MS = 15_000;
/** What one decision teaches at most: a conversation's latest mails that came in. */
const LEARN_PER_DECISION = 5;

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // Documentation, benchmarking, multicast and reserved.
  /^192\.0\.[02]\./,
  /^198\.(1[89])\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^(22[4-9]|2[3-5]\d)\./,
];

/** An address on the internet – not a private, local or link-local one. */
export function isPublicIp(ip: string): boolean {
  // An IPv4 address written as IPv6 (`::ffff:10.0.0.1`) is that IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return isPublicIp(mapped);
  const kind = isIP(ip);
  if (kind === 4) return !PRIVATE_V4.some((range) => range.test(ip));
  if (kind === 6) {
    const low = ip.toLowerCase();
    return !(low === '::1' || low === '::' || /^f[cd]/.test(low) || /^fe[89ab]/.test(low));
  }
  return false;
}

interface Hop {
  index: number;
  from: string | null;
  ip: string | null;
  by: string | null;
}

function hopOf(value: string, index: number): Hop {
  const by = /\bby\s+([^\s;()]+)/i.exec(value)?.[1]?.toLowerCase() ?? null;
  const fromPart = value.split(/\bby\s/i)[0] ?? '';
  const from = /^\s*from\s+([^\s;()]+)/i.exec(fromPart)?.[1]?.toLowerCase() ?? null;
  const ip = /\[(?:ipv6:)?([0-9a-f:.]+)\]/i.exec(fromPart)?.[1] ?? null;
  return { index, from, ip: ip && isIP(ip) ? ip : null, by };
}

/** A server's name (`mx.google.com`) – not an address or an id (Gmail's `by 2002:a05:…`). */
const named = (host: string | null): host is string =>
  !!host && !isIP(host) && !host.includes(':') && host.includes('.');

const firmOf = (host: string | null) => (named(host) ? orgDomain(host.replace(/\.$/, '')) : null);

/**
 * Where a mail came from, as the mailbox's provider wrote it on top: the address of the server
 * that handed it over, and its name. Only fields the provider added count – the run of
 * `Received` fields from the top whose receiving server is the provider's (`by`), down to the
 * first from outside it, and a `Received-SPF` (`client-ip`) or `Authentication-Results` („sender
 * IP is …“) above that one; what lies below anyone can write. `null`: not to be told.
 */
export function senderHop(raw: Uint8Array): { ip: string; helo: string | null } | null {
  const fields = headerFields(raw);
  const hops = fields
    .map((field, index) => (field.name === 'received' ? hopOf(field.value, index) : null))
    .filter((hop): hop is Hop => hop !== null);
  // The topmost named hop is the provider's: every server taking a mail by SMTP writes its
  // `Received` on top (RFC 5321 4.4). Were one ever missing, a forged clean address gains a sender
  // nothing – told no address, Rspamd skips the same checks.
  // Hops at the top without a server's name are the provider's own (Gmail's last step).
  let top = 0;
  while (top < hops.length && !named(hops[top]!.by)) top += 1;
  const provider = firmOf(hops[top]?.by ?? null);
  if (!provider) return null;
  const chain = hops.slice(0, top);
  for (const hop of hops.slice(top)) {
    if (firmOf(hop.by) !== provider) break;
    chain.push(hop);
  }
  // Where it entered: the first server from outside the provider – hops below it anyone wrote.
  const entry = chain.find((hop) => hop.from && firmOf(hop.from) !== provider) ?? chain.at(-1)!;
  const above = fields.slice(0, entry.index);
  const spf = above.find((field) => field.name === 'received-spf')?.value ?? '';
  const spfIp = /\bclient-ip=([0-9a-f:.]+)/i.exec(spf)?.[1];
  if (spfIp && isPublicIp(spfIp))
    return { ip: spfIp, helo: /\bhelo=([^\s;]+)/i.exec(spf)?.[1] ?? entry.from };
  const results = above.find((field) => field.name === 'authentication-results')?.value ?? '';
  const resultIp = /\bsender ip is ([0-9a-f:.]+)/i.exec(results)?.[1];
  if (resultIp && isPublicIp(resultIp)) return { ip: resultIp, helo: entry.from };
  return entry.ip && isPublicIp(entry.ip) ? { ip: entry.ip, helo: entry.from } : null;
}

/** The address a mail came back to (`Return-Path`), else its From. */
function envelopeFrom(raw: Uint8Array, from: string): string {
  const path = headerFields(raw).find((field) => field.name === 'return-path')?.value ?? '';
  return /<([^<>\s]*@[^<>\s]+)>/.exec(path)?.[1] ?? from;
}

/** Rspamd's word on a mail that arrived, where one is set up – `null`: none, or no answer. */
export async function filterCheck(
  deps: AppDeps,
  raw: Uint8Array,
  envelope: { from: string; rcpt: string },
): Promise<FilterVerdict | null> {
  const url = deps.config.rspamdUrl;
  if (!url) return null;
  const hop = senderHop(raw);
  const headers: Record<string, string> = {
    From: envelopeFrom(raw, envelope.from),
    Rcpt: envelope.rcpt,
    ...(hop ? { IP: hop.ip } : {}),
    ...(hop?.helo ? { Helo: hop.helo } : {}),
  };
  try {
    const response = await fetch(new URL('/checkv2', url), {
      method: 'POST',
      body: raw,
      headers,
      signal: AbortSignal.timeout(CHECK_MS),
    });
    if (!response.ok) {
      deps.log.warn('Mail: Rspamd refused a check', { status: response.status });
      return null;
    }
    const verdict = (await response.json()) as {
      action?: string;
      symbols?: Record<string, { score?: number }>;
    };
    const spam =
      verdict.action === 'reject' ||
      verdict.action === 'add header' ||
      verdict.action === 'rewrite subject';
    const symbols = Object.entries(verdict.symbols ?? {})
      .filter(([, one]) => (one.score ?? 0) > 0)
      .sort(([, a], [, b]) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, MAX_SYMBOLS)
      .map(([name]) => name);
    return { spam, symbols };
  } catch (error) {
    deps.log.warn('Mail: Rspamd did not answer', { error });
    return null;
  }
}

/** Where Rspamd learns: its controller (`RSPAMD_CONTROLLER_URL`, else `RSPAMD_URL` on 11334). */
function controllerUrl(deps: AppDeps): string | null {
  const { rspamdUrl, rspamdControllerUrl, rspamdPassword } = deps.config;
  if (!rspamdPassword) return null;
  if (rspamdControllerUrl) return rspamdControllerUrl;
  if (!rspamdUrl) return null;
  const url = new URL(rspamdUrl);
  url.port = '11334';
  return url.toString();
}

type Learned = Pick<
  MailMessageRow,
  'from' | 'to' | 'cc' | 'subject' | 'text' | 'html' | 'messageId' | 'sentAt' | 'outgoing'
>;

/** A mail as Rspamd reads it, built again from what is kept (the raw mail is not). */
async function rebuilt(mail: Learned): Promise<Buffer> {
  const person = (one: { name: string; address: string }) =>
    one.name ? { name: one.name, address: one.address } : one.address;
  const composer = new MailComposer({
    from: person(mail.from),
    to: mail.to.map(person),
    cc: mail.cc.map(person),
    subject: mail.subject,
    date: mail.sentAt,
    messageId: mail.messageId,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });
  return new Promise<Buffer>((resolve, reject) =>
    composer.compile().build((error, message) => (error ? reject(error) : resolve(message))),
  );
}

/**
 * Teaches Rspamd what a person decided about a conversation – its latest mails that came in, as
 * spam or not. In the background: the click does not wait, a refusal (already learned, no
 * controller) only goes to the log.
 */
export function filterLearn(deps: AppDeps, mails: readonly Learned[], spam: boolean): void {
  const url = controllerUrl(deps);
  const password = deps.config.rspamdPassword;
  const taught = mails.filter((mail) => !mail.outgoing).slice(-LEARN_PER_DECISION);
  if (!url || !password || taught.length === 0) return;
  const work = async () => {
    for (const mail of taught) {
      try {
        const response = await fetch(new URL(spam ? '/learnspam' : '/learnham', url), {
          method: 'POST',
          body: new Uint8Array(await rebuilt(mail)),
          headers: { Password: password },
          signal: AbortSignal.timeout(LEARN_MS),
        });
        // 208: learned so before – nothing to say.
        if (!response.ok && response.status !== 208)
          deps.log.warn('Mail: Rspamd did not learn', { status: response.status });
      } catch (error) {
        deps.log.warn('Mail: Rspamd did not learn', { error });
        return;
      }
    }
  };
  // In the background (tests wait for it); without a worker as a loose promise.
  if (deps.background) deps.background.run(work);
  else void work();
}
