import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import {
  MAIL_VERDICTS,
  type MailAuth,
  type MailContext,
  type MailContextDocument,
  type MailContextEvent,
  type MailContextFiling,
  type MailContextLink,
  type MailVerdict,
  cloudNameSchema,
  MAX_EVENT_LOCATION,
  MAX_EVENT_TITLE,
} from '@slider/shared';
import {
  mailAccounts,
  mailMessages,
  mailThreads,
  type MailAccountRow,
  type MailMessageRow,
  type MailThreadRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { CONTENT_IS_NOT_INSTRUCTION, todayForPrompt } from './ai-prompt-parts';
import { anthropicClient, quickModelOf, runToolCall, type AiConnection } from './ai-providers';
import { zonedToUtc } from './calendar/ical';
import { createEvent } from './calendars';
import { ancestorsOf, cloudContext, type CloudCtx } from './cloud/context';
import { storeUpload } from './cloud/files';
import { createFolder, searchNodes } from './cloud/nodes';
import { findByName, resolveTarget, siblingsIn } from './cloud/tree';
import { workspaceAiConnection } from './integration-keys';
import { ATTACHMENTS_ARE_DATA, attachmentsText } from './mail-attachment-text';
import { freshPart, getMailThread, mailAttachment, onNewMail, threadMessages } from './mail';
import { orgDomain } from './mail-insights';
import { senderLive } from './sender';

/*
 * What the AI makes of a mail conversation, shown to its right: what it is about, whether it is
 * spam or phishing, what to do, which files of the workspace belong to it, and where its
 * attachments could go in Cloud – there with one click („Ablegen“).
 */

const MAX_MAIL_CHARS = 8_000;
const MAX_CANDIDATES = 25;
/** Folders right in the tops (one's own files, the areas) the AI is shown to file into. */
const MAX_TOP_FOLDERS = 40;
const STOP = new Set(
  'aber alle also auch beim bitte dass dein deine denn dich dies diese diesem dieser doch eine einem einen einer eines euch fuer für gerne habe haben hallo heute hier ihnen ihre ihrem ihren ihrer immer neue neuen neuer neues wurde wurden jetzt kann kein keine mehr mein meine mich mit nach nicht noch oder schon sehr sein sind über unser unsere vielen viele vom von war waren weil wenn werden wie wir wird woche zum zur danke grüße gruss gruß liebe lieber herr frau with from that this have your about will would there their what when were which please thanks regards dear hello'.split(
    ' ',
  ),
);

const SYSTEM = [
  'You look at an email conversation that reached a person at work and tell them, beside it,',
  'what it is. Write in German, plainly and short. Judge spam and phishing soberly: phishing asks',
  'for passwords, payments or clicks on odd links under a pretext, or pretends to be someone it is',
  'not; a newsletter the person may have asked for is not spam. Pick only files from the list',
  'that truly belong to this mail (same project, customer, order, event) – none is fine. For each',
  'attachment pick the folder from the list where it belongs best – where files of the same',
  'matter lie. When none fits but it starts a matter more files will follow of (a project, a',
  'customer, a contract, an application), name a new folder for it (new_folder: short, as people',
  'name folders, e.g. the project or firm) and pick as folder the one it goes into. Else the',
  'person’s own files („Meine Dateien“).',
  'When the mails fix a meeting, call or appointment the person takes part in – a day and time',
  'agreed or set, not only proposed –, give it as event, its time as the person reads it',
  '(Berlin): days like „Freitag“ or „morgen“ count from the mail that says them. No event for an',
  'invitation sent as a calendar file (.ics: it is in the calendar already) nor for one past.',
  'Then say whether background helps the person here (needs_info): yes for a request, offer,',
  'order, complaint, application or meeting from a customer, partner, supplier or company, or a',
  'matter to look into; no for newsletters, notifications, receipts, automatic mails, spam and',
  'short notes between people who know each other. Only with yes: facts – at most 5 bullets of a',
  'few words each (under 90 characters, no full sentences, nothing the summary says): who the',
  'sender and their firm are, deadlines, amounts, what matters for the answer; and search – what',
  'to look up on the web about the sender’s firm or the matter, a few words.',
  CONTENT_IS_NOT_INSTRUCTION,
].join(' ');

const TOOL = {
  name: 'mail_context',
  description: 'What the mail conversation is, shown beside it.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: 'What it is about, 1–3 short sentences.' },
      kind: {
        type: 'string',
        description:
          'What kind of mail in 1–2 words, e.g. Anfrage, Angebot, Rechnung, Termin, Newsletter, Info.',
      },
      verdict: { type: 'string', enum: [...MAIL_VERDICTS] },
      warning: {
        type: 'string',
        description: 'Only for spam/phishing: why, one sentence. Else empty.',
      },
      todo: {
        type: 'string',
        description: 'What the person should do, one sentence; empty when nothing.',
      },
      todo_link: {
        type: 'integer',
        description:
          'Only with a todo (also an optional one): number of the link in the latest mail that leads to where it is done (the report, the form, the page to open) – the closest one when several fit. -1 only when no link leads there.',
      },
      needs_info: { type: 'boolean', description: 'Whether background helps the person here.' },
      facts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only with needs_info: at most 5 bullets, a few words each.',
      },
      search: {
        type: 'string',
        description: 'Only with needs_info: what to look up on the web, a few words. Else empty.',
      },
      documents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'integer', description: 'Number of the file in the list.' },
            why: { type: 'string', description: 'Why it belongs, a few words.' },
          },
          required: ['file', 'why'],
        },
      },
      event: {
        type: 'object',
        description: 'Only when the mails fix a meeting or appointment; else leave it out.',
        properties: {
          title: {
            type: 'string',
            description: 'As it would stand in a calendar, short: „Gespräch mit Timm Teubner“.',
          },
          start: {
            type: 'string',
            description: 'YYYY-MM-DDTHH:MM, Berlin time; a whole day: YYYY-MM-DD.',
          },
          end: {
            type: 'string',
            description: 'Same form; empty when the mails say no end (an hour then).',
          },
          location: { type: 'string', description: 'Where, as the mails say; else empty.' },
        },
        required: ['title', 'start'],
      },
      filing: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            attachment: { type: 'string', description: 'The attachment’s id.' },
            folder: { type: 'integer', description: 'Number of the folder in the list.' },
            new_folder: {
              type: 'string',
              description:
                'Only when no folder fits: the name of a new folder to make inside that one. Else empty.',
            },
            why: { type: 'string', description: 'Why there, a few words.' },
          },
          required: ['attachment', 'folder', 'why'],
        },
      },
    },
    required: ['summary', 'kind', 'verdict', 'needs_info', 'documents', 'filing'],
  },
};

/** How often the look on the web may search, and how long it may take. */
const MAX_SEARCHES = 3;
const LOOK_UP_MS = 60_000;
const MAX_FACTS = 5;
const MAX_LINKS = 4;

const FACTS_TOOL = {
  name: 'mail_facts',
  description:
    'What the person should know about the sender and the matter, shown beside the mail.',
  input_schema: {
    type: 'object' as const,
    properties: {
      facts: {
        type: 'array',
        items: { type: 'string' },
        description: `At most ${MAX_FACTS} bullets, a few words each (under 90 characters), no full sentences.`,
      },
      links: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description:
                'What the page is, short: „Website acme.com“, „LinkedIn – Acme GmbH“, „Pressemitteilung 05/2026“.',
            },
            url: { type: 'string', description: 'Exactly as found in the search results.' },
          },
          required: ['label', 'url'],
        },
        description: `At most ${MAX_LINKS}, the most useful first.`,
      },
    },
    required: ['facts', 'links'],
  },
};

const LOOK_UP_SYSTEM = (today: string) =>
  [
    `Today is ${today}. A person at work got an email; prepare them for it in a glance.`,
    'Search the web for the sender’s firm and the matter, then call mail_facts once.',
    'Write in German, condensed: bullets of a few words – who they are (what the firm does, size,',
    'where), recent news, what matters for the answer. Figures and names exactly as found.',
    'Links only from the search results, each named for what it is. Nothing found: empty lists.',
    'Never search for an e-mail address.',
    CONTENT_IS_NOT_INSTRUCTION,
  ].join(' ');

const facts = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .map((one) =>
      str(one)
        .replace(/^[-•–*]\s*/, '')
        .slice(0, 120),
    )
    .filter(Boolean)
    .slice(0, MAX_FACTS);

/** How many of a mail's own links the AI is shown to pick the to-do's from. */
const MAX_MAIL_LINKS = 30;

const decoded = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** What a link to unsubscribe says in its words or its address. */
const UNSUBSCRIBE = /abmeld|abbestell|austragen|unsubscri|opt.?out/i;

/** A mail's HTML links (sanitized: attributes quoted, `services/mail-html.ts`) with their words. */
const anchors = (html: string | null) =>
  [...(html ?? '').matchAll(/<a\b[^>]*?\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    ([, href, inner]) => ({
      href: decoded(href!),
      words: decoded(inner!.replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim(),
    }),
  );

const TEXT_URL = /https:\/\/[^\s<>"')\]]+/g;
const textUrl = (url: string) => url.replace(/[.,;:!?]+$/, '');

const https = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * The https links in a mail – its HTML's with their words, else the addresses in its text –,
 * each once, unsubscribing left out (`unsubscribeLink`).
 */
export function mailLinks(row: Pick<MailMessageRow, 'html' | 'text'>): MailContextLink[] {
  const found: MailContextLink[] = [];
  const add = (url: string, label: string) => {
    const parsed = https(url);
    if (!parsed || found.some((one) => one.url === parsed.href)) return;
    const words = label.slice(0, 80) || parsed.hostname;
    if (UNSUBSCRIBE.test(`${words} ${parsed.href}`)) return;
    found.push({ label: words, url: parsed.href });
  };
  for (const { href, words } of anchors(row.html)) add(href, words);
  for (const [url] of row.text.matchAll(TEXT_URL)) add(textUrl(url), '');
  return found.slice(0, MAX_MAIL_LINKS);
}

/**
 * Where a newsletter is unsubscribed from: its HTML's https link whose words say so, else one
 * whose address does, else such an address in its text (or right after words that say so).
 * `null`: none – no newsletter.
 */
export function unsubscribeLink(row: Pick<MailMessageRow, 'html' | 'text'>): string | null {
  const links = anchors(row.html).filter(({ href }) => https(href));
  const hit =
    links.find(({ words }) => UNSUBSCRIBE.test(words)) ??
    links.find(({ href }) => UNSUBSCRIBE.test(href));
  if (hit) return https(hit.href)!.href;
  for (const found of row.text.matchAll(TEXT_URL)) {
    const before = row.text.slice(Math.max(0, found.index - 80), found.index);
    const url = https(textUrl(found[0]));
    if (url && UNSUBSCRIBE.test(`${before} ${url.href}`)) return url.href;
  }
  return null;
}

/**
 * The links a to-do may point to: all of the mail's where its domain vouched for it (`auth` pass);
 * else – unconfirmed, never denied – only those to the From domain's own site, which lead there
 * even from a forger (search.google.com from …@google.com); none passing an address on (an open
 * redirect: `google.com/url?q=…`).
 */
export function todoLinks(
  row: Pick<MailMessageRow, 'html' | 'text' | 'auth' | 'from'>,
): MailContextLink[] {
  const all = mailLinks(row);
  if (row.auth === 'pass') return all;
  if (row.auth === 'fail') return [];
  const site = orgDomain(row.from.address.split('@')[1] ?? '');
  if (!site.includes('.')) return [];
  return all.filter((link) => {
    const url = new URL(link.url);
    const host = url.hostname.toLowerCase();
    if (host !== site && !host.endsWith(`.${site}`)) return false;
    return ![...url.searchParams.values()].some((value) => /^(?:https?:)?\/\/|^www\./i.test(value));
  });
}

function links(value: unknown): MailContextLink[] {
  const found: MailContextLink[] = [];
  for (const one of Array.isArray(value) ? value : []) {
    const label = str((one as { label?: unknown }).label).slice(0, 80);
    const url = str((one as { url?: unknown }).url);
    try {
      const parsed = new URL(url);
      if (!label || !['http:', 'https:'].includes(parsed.protocol)) continue;
      if (found.some((other) => other.url === parsed.href)) continue;
      found.push({ label, url: parsed.href });
    } catch {
      // Not an address: left out.
    }
  }
  return found.slice(0, MAX_LINKS);
}

/**
 * Looks the sender and the matter up on the web – where the workspace's AI is Anthropic's itself
 * (its own web search, as on a deck's material): bullets and named links, or `null`.
 */
async function lookUp(
  deps: AppDeps,
  connection: AiConnection,
  question: string,
): Promise<{ facts: string[]; links: MailContextLink[] } | null> {
  if (connection.provider !== 'anthropic' || connection.baseUrl !== null) return null;
  const client = anthropicClient(deps, connection.apiKey);
  const model = quickModelOf(connection);
  const signal = AbortSignal.timeout(LOOK_UP_MS);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: question }];
  for (let turn = 0; turn < 3; turn += 1) {
    const message = await client.beta.messages.create(
      {
        model,
        max_tokens: 1500,
        system: LOOK_UP_SYSTEM(todayForPrompt(deps.clock.now())),
        tools: [
          { type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES },
          FACTS_TOOL,
        ],
        messages,
      },
      { signal },
    );
    connection.meter?.({
      feature: 'summary',
      model: message.model || model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    });
    const call = message.content.find(
      (block) => block.type === 'tool_use' && block.name === FACTS_TOOL.name,
    );
    if (call?.type === 'tool_use') {
      const input = call.input as { facts?: unknown; links?: unknown };
      return { facts: facts(input.facts), links: links(input.links) };
    }
    // A long search paused the turn: sent again as it is, it goes on.
    if (message.stop_reason !== 'pause_turn') return null;
    messages.push({ role: 'assistant', content: message.content });
  }
  return null;
}

/** Words worth looking for in the files: from the subject, the attachments, the sender's firm. */
const FREE_MAIL = [
  'gmail',
  'googlemail',
  'outlook',
  'hotmail',
  'icloud',
  'gmx',
  'web',
  'yahoo',
  't-online',
  'posteo',
];

/** The firm's domain of an address – none for a free mail provider's. */
const firmDomainOf = (address: string) => {
  const domain = address.split('@')[1]?.toLowerCase() ?? '';
  const firm = domain.split('.').slice(-2, -1)[0] ?? '';
  return firm.length >= 3 && !FREE_MAIL.includes(firm) ? domain : '';
};

const withoutAddresses = (text: string) =>
  text
    .replace(/[^\s<>()"',;:@]+@[^\s<>()"',;:@]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What goes to the web search: the sender's name and firm, the matter – never an e-mail
 * address (a search engine is no place for whom the person writes with).
 */
export function lookUpQuestion(
  from: { name: string; address: string } | null,
  subject: string,
  summary: string,
  search: string,
): string {
  const sender = from
    ? [withoutAddresses(from.name), firmDomainOf(from.address)].filter(Boolean).join(', ')
    : '';
  return [
    `Absender: ${sender || 'unbekannt'}`,
    `Betreff: ${withoutAddresses(subject)}`,
    `Worum es geht: ${withoutAddresses(summary)}`,
    `Nachschlagen: ${withoutAddresses(search) || sender}`,
  ].join('\n');
}

export function searchWords(subject: string, attachments: string[], from: string): string[] {
  const firm = (from.split('@')[1] ?? '').split('.').slice(-2, -1)[0] ?? '';
  const words = [subject, ...attachments.map((name) => name.replace(/\.[a-z0-9]+$/i, ''))]
    .join(' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !STOP.has(word.toLowerCase()) && !/^\d+$/.test(word));
  if (firm.length >= 3 && !FREE_MAIL.includes(firm)) words.unshift(firm);
  return [...new Set(words.map((word) => word.toLowerCase()))].slice(0, 6);
}

const asking = new Map<string, { again: boolean }>();

/** Has the AI look at a conversation (anew) – in the background; one at a time per conversation. */
export function askMailContext(deps: AppDeps, threadId: string): void {
  const current = asking.get(threadId);
  if (current) {
    current.again = true;
    return;
  }
  const state = { again: true };
  asking.set(threadId, state);
  const work = async () => {
    try {
      while (state.again) {
        state.again = false;
        await lookAt(deps, threadId);
      }
    } catch (error) {
      deps.log.info(`Mail context not made: ${String(error)}`);
      await deps.db
        .update(mailThreads)
        .set({ contextState: 'failed' })
        .where(eq(mailThreads.id, threadId));
      await tellThread(deps, threadId);
    } finally {
      asking.delete(threadId);
    }
  };
  if (deps.background) deps.background.run(work);
  else void work();
}

/** Mails the AI looks at by itself per mailbox and hour – strangers' mails cannot spend the
 * workspace's AI without end; past it, a conversation is looked at when asked. */
const MAX_LOOKS_PER_HOUR = 30;
/** The provider's spam folder has a share of its own: a flood there takes none of the inbox's. */
const MAX_SPAM_LOOKS_PER_HOUR = 15;
const looks = new Map<string, number[]>();

function mayLookBySelf(key: string, max: number, now: number): boolean {
  const recent = (looks.get(key) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  const allowed = recent.length < max;
  if (allowed) recent.push(now);
  looks.set(key, recent);
  return allowed;
}

// A new mail in a conversation: the AI looks at it – in the provider's spam folder too, whether
// it is spam after all; not one the filter, the AI or its person put into spam before.
onNewMail((deps, threadId) => {
  void (async () => {
    const [thread] = await deps.db
      .select({
        accountId: mailThreads.accountId,
        spam: mailThreads.spam,
        spamBy: mailThreads.spamBy,
        contextState: mailThreads.contextState,
        aiReads: mailAccounts.aiReads,
      })
      .from(mailThreads)
      .innerJoin(mailAccounts, eq(mailAccounts.id, mailThreads.accountId))
      .where(eq(mailThreads.id, threadId));
    // Its person turned the AI's reading off: looked at only when asked.
    if (!thread?.aiReads) return;
    const providers = thread.spam && thread.spamBy === 'server';
    if (thread.spam && !providers && thread.contextState === 'none') return;
    const now = deps.clock.now().getTime();
    if (
      providers
        ? mayLookBySelf(`${thread.accountId}:spam`, MAX_SPAM_LOOKS_PER_HOUR, now)
        : mayLookBySelf(thread.accountId, MAX_LOOKS_PER_HOUR, now)
    )
      askMailContext(deps, threadId);
  })();
});

/**
 * Where the AI's verdict puts a conversation: spam or phishing from someone never answered goes
 * out of the way; what the provider put into spam comes back to the inbox when the AI finds it
 * fine and the latest mail's domain vouched for its sender. Both marked `ai`, to be checked; what
 * its person decided (by hand or by a rule for the sender) stays. `null`: it stays where it is.
 */
export function spamAfterLook(
  thread: Pick<MailThreadRow, 'spam' | 'spamBy'>,
  verdict: MailVerdict,
  answered: boolean,
  lastAuth: MailAuth | null,
): Pick<MailThreadRow, 'spam' | 'spamBy'> | null {
  if (thread.spamBy === 'person' || thread.spamBy === 'rule') return null;
  if (verdict !== 'ok' && !answered && !thread.spam) return { spam: true, spamBy: 'ai' };
  if (verdict === 'ok' && thread.spam && thread.spamBy === 'server' && lastAuth === 'pass')
    return { spam: false, spamBy: 'ai' };
  return null;
}

async function owner(deps: AppDeps, threadId: string) {
  const [row] = await deps.db
    .select({ thread: mailThreads, account: mailAccounts })
    .from(mailThreads)
    .innerJoin(mailAccounts, eq(mailAccounts.id, mailThreads.accountId))
    .where(eq(mailThreads.id, threadId));
  return row ?? null;
}

async function tellThread(deps: AppDeps, threadId: string) {
  const found = await owner(deps, threadId);
  if (!found || !senderLive.open(found.account.workspaceId)) return;
  senderLive.publish(found.account.workspaceId, new Set([found.account.userId]), {
    type: 'mail',
    threadId,
  });
}

interface Place {
  areaId: string | null;
  parentId: string | null;
  place: string;
}

/** Files that could belong to the mail, and the folders they lie in (plus the areas). */
async function candidates(deps: AppDeps, account: MailAccountRow, words: string[]) {
  const ctx = await cloudContext(deps.db, account.workspaceId, account.userId);
  const areaName = (areaId: string | null) =>
    areaId ? (ctx.areas.get(areaId)?.row.name ?? 'Bereich') : 'Meine Dateien';
  const files = new Map<
    string,
    { id: string; name: string; place: string; snippet: string; parent: Place }
  >();
  const folders = new Map<string, Place>();
  const may = (areaId: string | null) =>
    areaId === null || ['edit', 'manage'].includes(ctx.areas.get(areaId)?.access ?? '');
  for (const word of words) {
    if (files.size >= MAX_CANDIDATES) break;
    const found = await searchNodes(deps, account.userId, account.workspaceId, {
      q: word,
      limit: 8,
      in: 'all',
    });
    for (const node of found.nodes) {
      if (node.kind === 'folder' && may(node.areaId) && !folders.has(`${node.areaId}:${node.id}`)) {
        const above = await ancestorsOf(deps.db, node);
        folders.set(`${node.areaId}:${node.id}`, {
          areaId: node.areaId,
          parentId: node.id,
          place: [areaName(node.areaId), ...above.reverse().map((one) => one.name), node.name].join(
            ' / ',
          ),
        });
      }
      if (node.kind !== 'file' || files.has(node.id) || files.size >= MAX_CANDIDATES) continue;
      const above = await ancestorsOf(deps.db, node);
      const place = [areaName(node.areaId), ...above.reverse().map((folder) => folder.name)].join(
        ' / ',
      );
      files.set(node.id, {
        id: node.id,
        name: node.name,
        place,
        snippet: (found.snippets?.[node.id] ?? '').slice(0, 160),
        parent: { areaId: node.areaId, parentId: node.parentId, place },
      });
    }
  }
  for (const file of files.values())
    if (may(file.parent.areaId))
      folders.set(`${file.parent.areaId}:${file.parent.parentId}`, file.parent);
  // The tops and the folders right in them – what is there already, to see whether one fits or a
  // new one is due.
  // One's own files first: the shared budget never leaves them out.
  const own: Place = { areaId: null, parentId: null, place: 'Meine Dateien' };
  const tops: Place[] = [own];
  for (const [areaId, entry] of ctx.areas)
    if (may(areaId) && entry.access) tops.push({ areaId, parentId: null, place: entry.row.name });
  let inTops = 0;
  for (const top of tops) {
    folders.set(`${top.areaId}:null`, top);
    const inside = await siblingsIn(deps.db, {
      workspaceId: account.workspaceId,
      areaId: top.areaId,
      ownerId: top.areaId ? null : account.userId,
      parentId: null,
    });
    for (const folder of inside) {
      if (folder.kind !== 'folder' || inTops >= MAX_TOP_FOLDERS) continue;
      inTops += 1;
      folders.set(`${top.areaId}:${folder.id}`, {
        areaId: top.areaId,
        parentId: folder.id,
        place: `${top.place} / ${folder.name}`,
      });
    }
  }
  // One's own files last: where an attachment goes when the AI names no folder.
  folders.delete('null:null');
  folders.set('null:null', own);
  return { files: [...files.values()], folders: [...folders.values()] };
}

/** When a mail was sent as its person read it – the weekday too, so „Freitag“ in it resolves. */
const SENT = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function conversationText(rows: MailMessageRow[]): string {
  const lines = rows.map((row) => {
    const who = row.outgoing
      ? 'Die Person selbst'
      : `${row.from.name || row.from.address} <${row.from.address}>`;
    const auth = row.outgoing ? '' : ` [Absender-Domain bestätigt: ${row.auth}]`;
    return `--- ${SENT.format(row.sentAt)} von ${who}${auth}\nBetreff: ${row.subject}\n${freshPart(row.text) || row.text}`;
  });
  let text = lines.join('\n\n');
  if (text.length > MAX_MAIL_CHARS) text = `…${text.slice(-MAX_MAIL_CHARS)}`;
  return text;
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * The meeting as the AI gave it, as a calendar takes it – `null`: none, a time that is none, or
 * one past (`now`).
 */
export function mailEvent(value: unknown, now: Date): Omit<MailContextEvent, 'eventId'> | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { title?: unknown; start?: unknown; end?: unknown; location?: unknown };
  const title = str(raw.title).replace(/\s+/g, ' ').slice(0, MAX_EVENT_TITLE);
  const start = str(raw.start);
  const form = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?)?$/;
  if (!title || !form.test(start)) return null;
  const given = str(raw.end);
  const end = form.test(given) ? given : null;
  const location = str(raw.location).slice(0, MAX_EVENT_LOCATION);
  const day = (text: string) => !text.includes('T');
  if (day(start)) {
    // A whole day (or days): the end as a calendar keeps it, the day after the last.
    if (end && !day(end)) return null;
    const last = end ?? start;
    const after = new Date(Date.parse(`${last}T00:00:00Z`) + 24 * 60 * 60 * 1000);
    if (Number.isNaN(after.getTime()) || last < start || after.getTime() <= now.getTime())
      return null;
    return { title, location, allDay: true, start, end: after.toISOString().slice(0, 10) };
  }
  if (end && day(end)) return null;
  const from = berlinTime(start);
  const to = end ? berlinTime(end) : from + 60 * 60 * 1000;
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to <= now.getTime()) return null;
  return {
    title,
    location,
    allDay: false,
    start: new Date(from).toISOString(),
    end: new Date(to).toISOString(),
  };
}

/** `YYYY-MM-DDTHH:MM[:SS]` as read in Berlin (or with its own offset) – NaN for none. */
function berlinTime(text: string): number {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(text)) return Date.parse(text);
  const [date = '', clock = ''] = text.split('T');
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const [hour = NaN, minute = NaN, second = 0] = clock.split(':').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return NaN;
  return zonedToUtc(Date.UTC(year, month - 1, day, hour, minute, second), 'Europe/Berlin');
}

/** A new folder's name as the AI gave it – `null`: none, or not one a folder may have. */
export function newFolderName(value: unknown): string | null {
  const name = str(value).replace(/\s+/g, ' ');
  if (!name || name.length > 60) return null;
  const parsed = cloudNameSchema.safeParse(name);
  return parsed.success ? parsed.data : null;
}

/** The folder called `name` right in a place (names compare without case), if there is one. */
export async function folderNamed(
  deps: AppDeps,
  ctx: CloudCtx,
  place: { areaId: string | null; parentId: string | null },
  name: string,
) {
  const target = await resolveTarget(deps, ctx, place, 'edit');
  const found = findByName(await siblingsIn(deps.db, target.place), name);
  return found?.kind === 'folder' ? found : null;
}

/**
 * Per conversation, one change of what is kept of it at a time (`context`, its attachments'
 * notes): each reads it afresh and writes it whole, so two at once (two attachments filed, a
 * meeting put in from two tabs, the AI's look ending) would undo one another.
 */
const changing = new Map<string, Promise<unknown>>();
function oneAtATime<T>(threadId: string, work: () => Promise<T>): Promise<T> {
  const run = (changing.get(threadId) ?? Promise.resolve()).catch(() => {}).then(work);
  changing.set(threadId, run);
  const done = () => {
    if (changing.get(threadId) === run) changing.delete(threadId);
  };
  run.then(done, done);
  return run;
}

async function lookAt(deps: AppDeps, threadId: string): Promise<void> {
  const found = await owner(deps, threadId);
  if (!found) return;
  const { thread, account } = found;
  const { connection } = await workspaceAiConnection(deps, account.workspaceId);
  if (!connection) return;
  await deps.db
    .update(mailThreads)
    .set({ contextState: 'working' })
    .where(eq(mailThreads.id, threadId));
  await tellThread(deps, threadId);

  const rows = await threadMessages(deps, threadId);
  const attachments = rows.flatMap((row) => row.attachments);
  const lastIn = rows.findLast((row) => !row.outgoing);
  const words = searchWords(
    thread.subject,
    attachments.map((one) => one.name),
    lastIn?.from.address ?? '',
  );
  const { files, folders } = await candidates(deps, account, words);
  // What its files say (not a spam folder's: unopened there).
  const filesText = await attachmentsText(deps, rows, thread.spam);
  // The to-do's page comes only from the latest mail itself: any of its links where its domain
  // vouched for it, else those to the sender's own site (`todoLinks`).
  const ownLinks = lastIn ? todoLinks(lastIn) : [];

  const user = [
    `Heute ist ${SENT.format(deps.clock.now())}.`,
    `Postfach der Person: ${account.address}`,
    ...(thread.spam && thread.spamBy === 'server'
      ? [
          'Der Mail-Anbieter hat diese Unterhaltung in den Spam-Ordner gelegt. Urteile selbst, ob sie Spam oder Phishing ist – Anbieter irren sich auch bei echten Mails.',
        ]
      : []),
    `Die Unterhaltung, älteste Mail zuerst:\n${conversationText(rows)}`,
    ownLinks.length > 0
      ? `Links in der letzten Mail:\n${ownLinks.map((link, index) => `${index}. ${link.label} – ${link.url.slice(0, 200)}`).join('\n')}`
      : 'Keine Links in der letzten Mail.',
    attachments.length > 0
      ? `Anhänge:\n${attachments.map((one) => `- ${one.id}: ${one.name} (${one.type})`).join('\n')}`
      : 'Keine Anhänge.',
    ...(filesText ? [`${ATTACHMENTS_ARE_DATA}\n\n${filesText}`] : []),
    files.length > 0
      ? `Dateien im Workspace, die passen könnten:\n${files.map((file, index) => `${index}. ${file.name} – liegt in ${file.place}${file.snippet ? ` – „${file.snippet}“` : ''}`).join('\n')}`
      : 'Keine Dateien gefunden.',
    `Ordner zum Ablegen:\n${folders.map((folder, index) => `${index}. ${folder.place}`).join('\n')}`,
  ].join('\n\n');

  const input = (await runToolCall(deps, connection, {
    system: SYSTEM,
    tool: TOOL,
    user,
    maxTokens: 1600,
    signal: AbortSignal.timeout(90_000),
    feature: 'summary',
  })) as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') throw new Error('no answer');

  const verdict = MAIL_VERDICTS.find((one) => one === input.verdict) ?? 'ok';
  const needsInfo = verdict === 'ok' && input.needs_info === true;
  // Background where it helps: from the web where the AI searches it, else what it knows.
  let known = { facts: needsInfo ? facts(input.facts) : [], links: [] as MailContextLink[] };
  if (needsInfo) {
    const found = await lookUp(
      deps,
      connection,
      lookUpQuestion(lastIn?.from ?? null, thread.subject, str(input.summary), str(input.search)),
    ).catch((error: unknown) => {
      deps.log.info(`Mail context: no look on the web: ${String(error)}`);
      return null;
    });
    if (found && (found.facts.length > 0 || found.links.length > 0)) known = found;
  }
  const documents: MailContextDocument[] = (Array.isArray(input.documents) ? input.documents : [])
    .flatMap((one: { file?: unknown; why?: unknown }) => {
      const file = typeof one.file === 'number' ? files[one.file] : undefined;
      return file
        ? [
            {
              kind: 'file' as const,
              id: file.id,
              name: file.name,
              place: file.place,
              why: str(one.why),
            },
          ]
        : [];
    })
    .filter((one, index, all) => all.findIndex((other) => other.id === one.id) === index)
    .slice(0, 6);
  const before = thread.context?.filing ?? [];
  const filing: MailContextFiling[] = attachments.map((attachment) => {
    const picked = (Array.isArray(input.filing) ? input.filing : []).find(
      (one: { attachment?: unknown }) => one.attachment === attachment.id,
    ) as { folder?: unknown; new_folder?: unknown; why?: unknown } | undefined;
    const folder =
      (typeof picked?.folder === 'number' ? folders[picked.folder] : undefined) ?? folders.at(-1)!;
    return {
      attachmentId: attachment.id,
      areaId: folder.areaId,
      parentId: folder.parentId,
      place: folder.place,
      newFolder: newFolderName(picked?.new_folder),
      why: str(picked?.why),
      nodeId: before.find((one) => one.attachmentId === attachment.id)?.nodeId ?? null,
    };
  });
  // A meeting the mails fix – not on spam, not one an invitation's calendar file brings; put into
  // the calendar already as long as its time stays.
  const invited = attachments.some(
    (one) => /^text\/calendar/i.test(one.type) || /\.ics$/i.test(one.name),
  );
  const meeting =
    verdict === 'ok' && !thread.spam && !invited ? mailEvent(input.event, deps.clock.now()) : null;
  const context: MailContext = {
    summary: str(input.summary).slice(0, 600),
    kind: str(input.kind).slice(0, 40) || 'Mail',
    verdict,
    warning: verdict === 'ok' ? null : str(input.warning).slice(0, 300) || null,
    todo: str(input.todo).slice(0, 300) || null,
    todoLink:
      verdict === 'ok' && str(input.todo) && typeof input.todo_link === 'number'
        ? (ownLinks[input.todo_link] ?? null)
        : null,
    needsInfo,
    facts: known.facts,
    links: known.links,
    documents,
    filing,
    event: null,
  };
  // Into spam or out of the provider's (the person can take it back) – as it lies now: its person
  // may have decided while the AI looked.
  await oneAtATime(threadId, async () => {
    const [now] = await deps.db
      .select({ spam: mailThreads.spam, spamBy: mailThreads.spamBy, context: mailThreads.context })
      .from(mailThreads)
      .where(eq(mailThreads.id, threadId));
    const was = now?.context?.event ?? thread.context?.event;
    context.event = meeting
      ? { ...meeting, eventId: was && was.start === meeting.start ? was.eventId : null }
      : null;
    // Filed while the AI looked: it stays filed.
    const filed = now?.context?.filing ?? [];
    context.filing = context.filing.map((one) => ({
      ...one,
      nodeId:
        one.nodeId ?? filed.find((each) => each.attachmentId === one.attachmentId)?.nodeId ?? null,
    }));
    const moved = now
      ? spamAfterLook(
          now,
          verdict,
          rows.some((row) => row.outgoing),
          lastIn?.auth ?? null,
        )
      : null;
    await deps.db
      .update(mailThreads)
      .set({ context, contextState: 'done', ...moved })
      .where(eq(mailThreads.id, threadId));
  });
  await tellThread(deps, threadId);
}

/**
 * Puts an attachment into Cloud: where the person said, else where the AI said, else into their
 * own files. A file of that name there already: both are kept.
 */
export function fileMailAttachment(
  deps: AppDeps,
  userId: string,
  threadId: string,
  input: {
    attachmentId: string;
    areaId?: string | null;
    parentId?: string | null;
    newFolder?: string | null;
  },
): Promise<{ nodeId: string; name: string }> {
  // One at a time: two filed into the same new folder find one folder, both stay noted.
  return oneAtATime(threadId, () => fileAttachment(deps, userId, threadId, input));
}

async function fileAttachment(
  deps: AppDeps,
  userId: string,
  threadId: string,
  input: Parameters<typeof fileMailAttachment>[3],
): Promise<{ nodeId: string; name: string }> {
  const thread = await getMailThread(deps, userId, threadId);
  const found = await owner(deps, threadId);
  if (!found) throw notFound('Diese Mail gibt es nicht.');
  const attachment = await mailAttachment(deps, userId, threadId, input.attachmentId);
  const said = thread.context?.filing.find((one) => one.attachmentId === input.attachmentId);
  const picked = input.areaId !== undefined || input.parentId !== undefined;
  let areaId = picked ? (input.areaId ?? null) : (said?.areaId ?? null);
  let parentId = picked ? (input.parentId ?? null) : (said?.parentId ?? null);
  const newFolder = picked ? (input.newFolder ?? null) : (said?.newFolder ?? null);
  if (newFolder) {
    // The folder the AI would start: the one of that name there by now (the attachment before
    // made it), else made – beside a file of that name as „Name 2“.
    const workspaceId = found.account.workspaceId;
    const ctx = await cloudContext(deps.db, workspaceId, userId);
    const folder =
      (await folderNamed(deps, ctx, { areaId, parentId }, newFolder)) ??
      (await createFolder(deps, userId, workspaceId, {
        name: newFolder,
        numbered: true,
        areaId,
        parentId,
      }));
    areaId = folder.areaId;
    parentId = folder.id;
  }
  const bytes = attachment.bytes;
  const { node } = await storeUpload(
    deps,
    userId,
    found.account.workspaceId,
    {
      name: attachment.name,
      keepBoth: true,
      ...(parentId ? { parentId } : areaId ? { areaId } : {}),
    },
    {
      data: (async function* () {
        yield bytes;
      })(),
      size: bytes.byteLength,
      mimeType: attachment.type,
    },
  ).catch((error: unknown) => {
    if (error instanceof Error && 'status' in error) throw error;
    throw badRequest('Der Anhang ließ sich nicht ablegen.');
  });
  // Noted on the attachment: the AI panel puts the next one from that firm into the same folder.
  const rows = await threadMessages(deps, threadId);
  const row = rows.find((one) => one.attachments.some((each) => each.id === input.attachmentId));
  if (row)
    await deps.db
      .update(mailMessages)
      .set({
        attachments: row.attachments.map((one) =>
          one.id === input.attachmentId ? { ...one, nodeId: node.id } : one,
        ),
      })
      .where(eq(mailMessages.id, row.id));
  if (thread.context) {
    const filing = thread.context.filing.map((one) =>
      one.attachmentId === input.attachmentId ? { ...one, nodeId: node.id } : one,
    );
    await deps.db
      .update(mailThreads)
      .set({ context: { ...thread.context, filing } })
      .where(eq(mailThreads.id, threadId));
  }
  await tellThread(deps, threadId);
  return { nodeId: node.id, name: node.name };
}

/**
 * „Termin anlegen“: the meeting the AI found in a conversation, into a calendar the person may
 * edit – noted on the conversation, so the button becomes the event.
 */
export function addMailEvent(deps: AppDeps, userId: string, threadId: string, calendarId: string) {
  // One at a time: a second ask (another tab) finds the event there and is refused.
  return oneAtATime(threadId, () => addEvent(deps, userId, threadId, calendarId));
}

async function addEvent(deps: AppDeps, userId: string, threadId: string, calendarId: string) {
  const thread = await getMailThread(deps, userId, threadId);
  const event = thread.context?.event;
  if (!thread.context || !event) throw notFound('Zu dieser Mail gibt es keinen Termin.');
  if (event.eventId) throw badRequest('Der Termin steht schon im Kalender.');
  const made = await createEvent(deps, userId, {
    calendarId,
    title: event.title,
    location: event.location,
    notes: `Aus der Mail „${thread.subject}“`,
    allDay: event.allDay,
    start: event.start,
    end: event.end,
  });
  await deps.db
    .update(mailThreads)
    .set({ context: { ...thread.context, event: { ...event, eventId: made.id } } })
    .where(eq(mailThreads.id, threadId));
  await tellThread(deps, threadId);
  return made;
}
