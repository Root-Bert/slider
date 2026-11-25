import { z } from 'zod';
import {
  commentReactionKindSchema,
  type AccountAuthor,
  type Author,
  type CommentReaction,
} from './model';
import type { CloudAreaColor } from './cloud';
import { MAX_MAIL_UPLOADS, mailUploadSchema, type SenderMessageMail } from './mail';
import type { CallBrief } from './calls';
import { attachmentIdsSchema, type Attachment } from './attachments';

/*
 * „Sender“: the workspace's messages. People write to each other – in the channel every area
 * has, in further channels opened inside an area, in groups of a few and person to person – and
 * the agents one sees are conversations of their own (their chat, written to from here).
 * An area's channels are seen by whoever sees the area; a group or a direct conversation by its
 * people only.
 */

/**
 * `area`: the one every area has (named as the area is); `channel`: one more inside an area;
 * `group`: a few people, no area; `direct`: two people; `agent`: a chat with an agent (seen by
 * who sees the agent – its first chat has the agent's id, further ones are opened beside it).
 */
export const SENDER_CHANNEL_KINDS = ['area', 'channel', 'group', 'direct', 'agent'] as const;
export type SenderChannelKind = (typeof SENDER_CHANNEL_KINDS)[number];

export const MAX_SENDER_MESSAGE = 8000;
export const MAX_SENDER_NAME = 60;
export const MAX_SENDER_TOPIC = 240;
/** People of one group, the caller included. */
export const MAX_SENDER_GROUP = 50;
/** Messages one page of a conversation brings. */
export const SENDER_PAGE = 60;

/** A channel's name as typed: lower case, words joined by „-“ („messe-2027“). */
export function channelName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SENDER_NAME);
}

/** A conversation in the side bar. */
export interface SenderChannel {
  id: string;
  kind: SenderChannelKind;
  /** The area's (`area`, `channel`); `null` for groups and direct ones. */
  areaId: string | null;
  /** As shown: the area's name, the channel's, the group's – or the other person's. */
  name: string;
  topic: string;
  /** The other person (`direct`). */
  person: AccountAuthor | null;
  /** The people of a group or direct conversation, the caller included; empty for areas. */
  members: AccountAuthor[];
  /** Messages the caller has not read. */
  unread: number;
  /** Someone wrote the caller's name in one of those. */
  mentioned: boolean;
  /** The caller may write here (the workspace's viewers read along in an area's channels). */
  canWrite: boolean;
  /** The caller may rename it, change its topic, delete it (who opened it; an area's admins). */
  canManage: boolean;
  /**
   * The agents here: an area's own first (`own`, there once first tagged – `@Agent` makes it),
   * then those added („Agent hinzufügen“). Who calls which with `@`: {@link callableHere}.
   */
  agents: SenderChannelAgent[];
  /** When something was last written; the side bar's order within a section. */
  updatedAt: string;
  /** When the caller pinned it („Anpinnen“): it stands above the rest, the latest pinned first. */
  pinnedAt?: string | null;
  /** The caller muted it („Stummschalten“): no count on the app's icon, no notification. */
  muted?: boolean;
}

export interface SenderChannelAgent {
  id: string;
  title: string;
  /** Its owner. */
  userId: string;
  shared: boolean;
  /** The area it stands in; `null`: none. */
  areaId: string | null;
  /** The area's own agent (`@Agent` in its channels), not one added. */
  own?: boolean;
}

/** What an area's own agent is called – and the tag that calls the agent of any conversation. */
export const CONVERSATION_AGENT_TAG = 'Agent';

/** Agents one message sets to work at most. */
export const MAX_AGENTS_CALLED = 3;

/**
 * Whether one may call this agent here with `@` (or add it) – of the agents one sees: in an
 * area's channels that area's shared ones (in the workspace's own area, the workspace's), in a
 * group or a direct conversation those of every area one is in; one's own everywhere.
 */
export const callableHere = (
  agent: { userId: string; shared: boolean; areaId: string | null },
  here: { kind: SenderChannelKind; areaId: string | null; root: boolean },
  me: string,
): boolean =>
  agent.userId === me ||
  here.kind === 'group' ||
  here.kind === 'direct' ||
  (agent.shared && (agent.areaId === here.areaId || (here.root && agent.areaId === null)));

/** A new agent's name here: „Agent“, or „Agent 2“, … where that is taken. */
export function newAgentTitle(taken: Iterable<string>): string {
  const names = new Set([...taken].map((name) => name.trim().toLowerCase()));
  let title = CONVERSATION_AGENT_TAG;
  for (let n = 2; names.has(title.toLowerCase()); n++) title = `${CONVERSATION_AGENT_TAG} ${n}`;
  return title;
}

/** An area in Sender's side bar, its channels under it. */
export interface SenderArea {
  id: string;
  parentId: string | null;
  name: string;
  color: CloudAreaColor;
  root: boolean;
  /** The caller may open channels in it (who may change things there). */
  canCreate: boolean;
  /** Its own channel first, then the others by name. */
  channels: SenderChannel[];
}

/** An agent as a conversation of its own. */
export interface SenderAgent {
  id: string;
  title: string;
  owner: Author;
  /** Where it belongs, as `CloudAgentSummary`'s: its area, and whether it is given to others. */
  areaId: string | null;
  shared: boolean;
  running: boolean;
  /** Answers the caller has not read. */
  unread: number;
  updatedAt: string;
  /** When the caller pinned it, as a conversation's `pinnedAt`. */
  pinnedAt?: string | null;
  /** The caller may delete it (its owner, an admin) – as `CloudAgentSummary.canDelete`. */
  canDelete?: boolean;
}

/** Everything the side bar shows. */
export interface SenderHome {
  areas: SenderArea[];
  groups: SenderChannel[];
  direct: SenderChannel[];
  agents: SenderAgent[];
  /** Everyone of the workspace, to start a conversation or a group with. */
  people: AccountAuthor[];
}

export interface SenderMessage {
  id: string;
  seq: number;
  /** A person; `null` when an agent wrote it or the person is gone. */
  author: AccountAuthor | null;
  /** The agent that wrote it. */
  agent: { id: string; title: string } | null;
  /** It came as a mail (a colleague's, to a mailbox here): its subject. */
  mail?: SenderMessageMail | null;
  text: string;
  /** Files put on it, under its words. */
  attachments?: Attachment[];
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** A call in the conversation, over: shown as one entry that opens its page. */
  call?: CallBrief | null;
  /** 👍 / 👎 / egal, one per person, as on comments. */
  reactions?: CommentReaction[];
  /** „Antworten“: the message it answers, quoted above it. */
  replyTo?: SenderReplyQuote | null;
}

/** A message found by the side bar's search, in any conversation one sees (newest first). */
export interface SenderMessageHit {
  channelId: string;
  messageId: string;
  /** Who wrote it; `null` when the person is gone. */
  name: string | null;
  /** The words around the match. */
  text: string;
  createdAt: string;
}

/** The message another answers, as quoted above it: who, and the start of its words. */
export interface SenderReplyQuote {
  id: string;
  /** A person's or an agent's name; `null` when the person is gone. */
  name: string | null;
  /** Its words, cut short; empty when only files were on it. */
  text: string;
  /** Deleted since: „Nachricht gelöscht“ instead. */
  deleted: boolean;
}

export interface SenderMessagePage {
  channel: SenderChannel;
  messages: SenderMessage[];
  /** Older ones are there: ask with `before` = the first's seq. */
  more: boolean;
  /** What the caller had read before opening it – the „Neu“ line stands after it. */
  readSeq: number;
}

/** What the live stream of a workspace's Sender says. */
export type SenderEvent =
  | { type: 'message'; channelId: string; message: SenderMessage }
  | { type: 'changed'; channelId: string; message: SenderMessage }
  | { type: 'typing'; channelId: string; author: AccountAuthor }
  | { type: 'channels' }
  | { type: 'agent'; agentId: string }
  /** Mail conversations changed (a mail came, one was read): the list is fetched anew. */
  | { type: 'mail'; threadId: string | null }
  /** To-dos one sees changed (one's own, an area's): the lists are fetched anew. */
  | { type: 'todos' }
  /** Calendars or events one sees changed: the calendar is fetched anew. */
  | { type: 'calendar' }
  /** The start's AI look („Aktuell“) was made anew in the background: it is fetched again. */
  | { type: 'triage' }
  /** One's planned messages of a conversation changed (planned, sent, refused): fetched anew. */
  | { type: 'scheduled'; channelId: string };

/**
 * Sender's start („Neuigkeiten“): a conversation with something unread – an area's channel, a
 * group, a direct one, an agent's answers, a mail conversation – with its latest unread line.
 */
export interface SenderUnreadItem {
  kind: 'channel' | 'agent' | 'mail';
  id: string;
  /** Where a channel opens (`kind` channel). */
  channelKind: SenderChannelKind | null;
  areaId: string | null;
  name: string;
  unread: number;
  /** Someone wrote the caller's name in one of those. */
  mentioned: boolean;
  /** The latest unread line: who wrote it (a person's or agent's name; none for a mail's sender
   * line), its words, when. */
  last: { who: string | null; text: string; at: string } | null;
}

export interface SenderUnread {
  items: SenderUnreadItem[];
}

/** One conversation's part of the AI's summary, the conversation named by the server. */
export interface SenderSummaryPart {
  kind: SenderUnreadItem['kind'];
  id: string;
  channelKind: SenderChannelKind | null;
  areaId: string | null;
  name: string;
  text: string;
}

/**
 * „Seit deinem letzten Besuch“: what the AI makes of everything unread – `nothing` when all is
 * read, `off` without the workspace's AI (`reason` says why), `failed` when it gave no answer.
 */
export interface SenderSummary {
  state: 'nothing' | 'off' | 'done' | 'failed';
  /** The oldest unread line's time – „last visit“ is where the caller stopped reading. */
  since: string | null;
  parts: SenderSummaryPart[];
  reason: string | null;
}

/**
 * Sender's start as a to-do list („Aktuell“, and a mailbox's „Übersicht“): everything unread,
 * sorted into what it is – asked of one first, the rest grouped so a whole group is done in one
 * go. Mails go to `requests`/`mail`/`notices`/`newsletters` by the AI where the mailbox lets it
 * read along, else by what the mail says of itself (its list header, a no-reply sender).
 */
export const TRIAGE_GROUPS = [
  'mentions',
  'direct',
  'requests',
  'conversations',
  'agents',
  'mail',
  'notices',
  'newsletters',
  'spam',
] as const;
export type TriageGroupKey = (typeof TRIAGE_GROUPS)[number];

export interface TriageItem {
  item: SenderUnreadItem;
  /** The AI's line about it – what it is, what is wanted; `null` without the AI. */
  line: string | null;
  /** A mail's sender (newsletters are grouped by it). */
  from: { name: string; address: string } | null;
  /** A mail's mailbox. */
  accountId: string | null;
}

export interface TriageGroup {
  key: TriageGroupKey;
  /** The AI's sentence about the whole group; `null` without the AI. */
  summary: string | null;
  items: TriageItem[];
}

/**
 * `ai`: `done` – sorted and told by the AI; `off` – without the workspace's AI (`reason`);
 * `failed` – it gave no answer (sorted without it); `none` – asked without the AI.
 */
export interface SenderTriage {
  ai: 'none' | 'done' | 'off' | 'failed';
  /** One sentence on top: what needs the person now. */
  headline: string | null;
  groups: TriageGroup[];
  /**
   * „Heute und diese Woche“: what the coming days hold – events, to-dos due, and what earlier,
   * read mails say is due (a deadline, an appointment, something promised). Without the AI the
   * events and to-dos alone; Aktuell only, a mailbox's „Übersicht“ has its mails' alone.
   */
  agenda: TriageAgendaItem[];
  reason: string | null;
}

export interface TriageAgendaItem {
  kind: 'event' | 'todo' | 'mail';
  /** The event's, the to-do's or the mail conversation's id. */
  id: string;
  /** The day it is on or due (`YYYY-MM-DD`), when it has one. */
  day: string | null;
  /** When, as one says it („Heute 14:00“, „Freitag“, „bis Donnerstag“). */
  when: string | null;
  text: string;
}

/** „Alle gelesen“: these conversations, agents and mails read at once. */
export const senderTriageReadSchema = z.object({
  items: z
    .array(z.object({ kind: z.enum(['channel', 'agent', 'mail']), id: z.string().min(1).max(100) }))
    .min(1)
    .max(500),
});
export type SenderTriageRead = z.input<typeof senderTriageReadSchema>;

export const senderEditSchema = z.object({
  text: z.string().trim().min(1, 'Schreib etwas.').max(MAX_SENDER_MESSAGE),
});

/** A message: words, files put on it (`attachments`) – or both; one of them at least. */
export const senderPostSchema = senderEditSchema.extend({
  text: z.string().trim().max(MAX_SENDER_MESSAGE),
  attachments: attachmentIdsSchema,
  /** „Antworten“: a message of the same conversation. */
  replyTo: z.string().min(1).optional(),
});

/** Longest ahead a message is planned („Später senden“): a year. */
export const MAX_SCHEDULE_DAYS = 365;

/**
 * A message planned to go later („Später senden“, a right click on „Senden“) – seen by who planned
 * it alone, above their field, until it goes. Then it is posted as if sent that moment: every
 * check again, agents named in it start.
 */
export interface SenderScheduled {
  id: string;
  channelId: string;
  text: string;
  attachments: Attachment[];
  replyTo: string | null;
  sendAt: string;
  /** `failed`: refused when due – `error` says why; kept until sent again or deleted. */
  state: 'waiting' | 'sending' | 'failed';
  error: string | null;
  /** Planned by one's agent: it goes in the agent's name. */
  agent: { id: string; title: string } | null;
}

/** „Später senden“: a message as `senderPostSchema`, and when it goes. */
export const senderScheduleSchema = senderPostSchema.extend({
  sendAt: z.iso.datetime({ offset: true }),
});

export const senderCreateChannelSchema = z.object({
  areaId: z.string().min(1),
  name: z.string().transform(channelName).pipe(z.string().min(1, 'Gib dem Kanal einen Namen.')),
  topic: z.string().trim().max(MAX_SENDER_TOPIC).default(''),
});
export type SenderCreateChannel = z.input<typeof senderCreateChannelSchema>;

export const senderCreateGroupSchema = z.object({
  name: z.string().trim().max(MAX_SENDER_NAME).default(''),
  userIds: z.array(z.string().min(1)).min(1, 'Wähle mindestens eine Person.').max(MAX_SENDER_GROUP),
});
export type SenderCreateGroup = z.input<typeof senderCreateGroupSchema>;

export const senderCreateDirectSchema = z.object({ userId: z.string().min(1) });

export const senderUpdateChannelSchema = z.object({
  name: z.string().max(MAX_SENDER_NAME).optional(),
  topic: z.string().trim().max(MAX_SENDER_TOPIC).optional(),
});
export type SenderUpdateChannel = z.input<typeof senderUpdateChannelSchema>;

/** „Agent hinzufügen“: one of the agents one may call here, or (none named) a new one. */
export const senderAddAgentSchema = z.object({ agentId: z.string().min(1).max(100).optional() });
export type SenderAddAgent = z.input<typeof senderAddAgentSchema>;

export const senderReadSchema = z.object({ seq: z.number().int().min(0) });

/**
 * „Anpinnen“ / „Lösen“ a chat or a mail for oneself: a conversation (`channel`), an agent, a mail
 * conversation (`mail`). Pinned ones stand at the top of their list, the latest pinned first.
 */
export const SENDER_PIN_KINDS = ['channel', 'agent', 'mail'] as const;
export type SenderPinKind = (typeof SENDER_PIN_KINDS)[number];
export const senderPinSchema = z.object({
  kind: z.enum(SENDER_PIN_KINDS),
  id: z.string().min(1).max(100),
  pinned: z.boolean(),
});
export type SenderPin = z.infer<typeof senderPinSchema>;

/** A browser's Web Push subscription (`PushSubscription.toJSON()`), to tell while no tab is open. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(80).max(200), auth: z.string().min(16).max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** „Stummschalten“ / „Laut schalten“ a conversation, for the caller alone. */
export const senderMuteSchema = z.object({ muted: z.boolean() });

/** One's reaction on a message, or none (`null`): another replaces it. */
export const senderReactSchema = z.object({ kind: commentReactionKindSchema.nullable() });

/** The people whose name a text carries after „@“ – the first name will do. */
export function mentionsIn(text: string, people: Iterable<AccountAuthor>): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const person of people) {
    const full = person.name.trim().toLowerCase();
    const first = full.split(/\s+/)[0] ?? '';
    if ([full, first].some((name) => named(lower, name))) found.push(person.id);
  }
  return found;
}

/** „@alle“: everyone in the conversation is named – as if each one's name stood there. */
export const EVERYONE_TAG = 'alle';
export const mentionsAll = (text: string): boolean => named(text.toLowerCase(), EVERYONE_TAG);

/**
 * What may not stand right before the „@“ of a mention (a regex character class's inside, `u`
 * flag): a letter, digit, `.`, `_`, `-` or `+` – there the @ is a mail address's („info@anna.de“).
 * The web's highlighting (`MessageText`) uses the same.
 */
export const MENTION_NOT_AFTER = String.raw`\p{L}\p{N}._+-`;
const NOT_AFTER = new RegExp(`[${MENTION_NOT_AFTER}]`, 'u');

/** `@name` in `lower` (lower case), not in a mail address nor as the start of a longer word. */
const named = (lower: string, name: string): boolean => namedAt(lower, name) !== -1;

/** Where `@name` stands in `lower` (as {@link named}); -1: nowhere. */
function namedAt(lower: string, name: string): number {
  if (!name) return -1;
  const at = `@${name}`;
  let from = lower.indexOf(at);
  while (from !== -1) {
    const before = lower.charAt(from - 1);
    const after = lower.charAt(from + at.length);
    if ((!before || !NOT_AFTER.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after)))
      return from;
    from = lower.indexOf(at, from + 1);
  }
  return -1;
}

/**
 * The agents a message calls by `@` and their name – the longest name first, so „@Agent Recherche“
 * is that one and not „Agent“; of two with one name the first given – and whether a bare
 * `@Agent` is left over (the conversation's own: an area's, or those added).
 */
export function agentsTagged<T extends { title: string }>(
  text: string,
  agents: readonly T[],
): { tagged: T[]; bare: boolean } {
  let lower = text.toLowerCase();
  const tagged: T[] = [];
  const longestFirst = [...agents].sort((a, b) => b.title.trim().length - a.title.trim().length);
  for (const agent of longestFirst) {
    const name = agent.title.trim().toLowerCase();
    let at = namedAt(lower, name);
    if (at === -1) continue;
    tagged.push(agent);
    // Taken: neither a shorter name in it nor a second agent of that name calls on it.
    for (; at !== -1; at = namedAt(lower, name))
      lower = `${lower.slice(0, at)}${' '.repeat(name.length + 1)}${lower.slice(at + name.length + 1)}`;
  }
  return { tagged, bare: named(lower, CONVERSATION_AGENT_TAG.toLowerCase()) };
}

// ── Drafts: what one wrote and did not send, kept for one's account on every device ─────────

/** A draft's words at most – a mail's (`MAX_MAIL_TEXT`), the longest field one writes in. */
export const MAX_DRAFT_TEXT = 100_000;
/** Drafts one person keeps in one workspace at most. */
export const MAX_DRAFTS = 300;

const draftName = z.string().max(500);
const draftId = z.string().min(1).max(200);

/**
 * Where a draft goes – the workspace aside, which its place says: a conversation of Sender's
 * (the key is its id), a mail's answer, an agent's chat, a new agent's order (in an area, or
 * none), a new mail (from which mailbox, to whom, its subject – its words are the draft's text).
 * Names are kept with it for „Entwürfe“: a mail or an area is not in the side bar's data.
 */
export const senderDraftTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conversation') }),
  z.object({
    kind: z.literal('mail'),
    threadId: draftId,
    name: draftName,
    /** Files put on the reply, waiting for it (`MailUpload`). */
    uploads: z.array(mailUploadSchema).max(MAX_MAIL_UPLOADS).default([]),
  }),
  z.object({
    kind: z.literal('agent'),
    agentId: draftId,
    chatId: draftId,
    name: draftName,
    chat: draftName.nullable(),
  }),
  z.object({
    kind: z.literal('agent-new'),
    areaId: draftId.nullable().default(null),
    area: draftName.nullable().default(null),
  }),
  z.object({
    kind: z.literal('mail-new'),
    accountId: z.string().max(200),
    to: z.string().max(5000),
    cc: z.string().max(5000).default(''),
    bcc: z.string().max(5000).default(''),
    subject: z.string().max(500),
    /** Passed on: that mail's attachments go along. */
    forward: z.object({ threadId: draftId, messageId: draftId }).nullable().default(null),
    uploads: z.array(mailUploadSchema).max(MAX_MAIL_UPLOADS).default([]),
  }),
]);
export type SenderDraftTarget = z.input<typeof senderDraftTargetSchema>;

/** A draft's key: a conversation's id, or `mail:…`, `agent:…`, `agent-new:…`, `mail-new:…`. */
export const senderDraftKeySchema = z.string().regex(/^[\w:-]{1,300}$/);

/** A draft kept (`PUT /workspaces/:id/drafts/:key`): the newer one wins (`at`). */
export const senderDraftInputSchema = z.object({
  text: z.string().max(MAX_DRAFT_TEXT),
  target: senderDraftTargetSchema,
  /** When it was written – the server never takes one from its future. */
  at: z.iso.datetime(),
});
export type SenderDraftInput = z.input<typeof senderDraftInputSchema>;

/** One's draft as the server keeps it. */
export interface SenderDraft {
  key: string;
  text: string;
  target: SenderDraftTarget;
  at: string;
}
