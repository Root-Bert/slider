import { z } from 'zod';
import type { AccountAuthor, Author } from './model';
import type { CloudAreaColor } from './cloud';
import { MAX_MAIL_UPLOADS, mailUploadSchema, type SenderMessageMail } from './mail';
import type { CallBrief } from './calls';

/*
 * „Sender“: the workspace's messages. People write to each other – in the channel every area
 * has, in further channels opened inside an area, in groups of a few and person to person – and
 * the agents one sees are conversations of their own (their chat, written to from here).
 * An area's channels are seen by whoever sees the area; a group or a direct conversation by its
 * people only.
 */

/**
 * `area`: the one every area has (named as the area is); `channel`: one more inside an area;
 * `group`: a few people, no area; `direct`: two people.
 */
export const SENDER_CHANNEL_KINDS = ['area', 'channel', 'group', 'direct'] as const;
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
   * The agent one tags here with `@`: an area's own (`null` until first tagged – `@Agent` makes
   * it), or the one added to a group or direct conversation, which only its owner calls.
   */
  agent: SenderChannelAgent | null;
  /** When something was last written; the side bar's order within a section. */
  updatedAt: string;
  /** When the caller pinned it („Anpinnen“): it stands above the rest, the latest pinned first. */
  pinnedAt?: string | null;
}

export interface SenderChannelAgent {
  id: string;
  title: string;
  /** Its owner. */
  userId: string;
  shared: boolean;
}

/** What an area's own agent is called – and the tag that calls the agent of any conversation. */
export const CONVERSATION_AGENT_TAG = 'Agent';

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
  running: boolean;
  /** Answers the caller has not read. */
  unread: number;
  updatedAt: string;
  /** When the caller pinned it, as a conversation's `pinnedAt`. */
  pinnedAt?: string | null;
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
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** A call in the conversation, over: shown as one entry that opens its page. */
  call?: CallBrief | null;
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
  | { type: 'calendar' };

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

export const senderPostSchema = z.object({
  text: z.string().trim().min(1, 'Schreib etwas.').max(MAX_SENDER_MESSAGE),
});

export const senderEditSchema = senderPostSchema;

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
  /** A group's or direct conversation's agent: one's own private one, or none (`null`). */
  agentId: z.string().min(1).max(100).nullable().optional(),
});
export type SenderUpdateChannel = z.input<typeof senderUpdateChannelSchema>;

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

/**
 * What may not stand right before the „@“ of a mention (a regex character class's inside, `u`
 * flag): a letter, digit, `.`, `_`, `-` or `+` – there the @ is a mail address's („info@anna.de“).
 * The web's highlighting (`MessageText`) uses the same.
 */
export const MENTION_NOT_AFTER = String.raw`\p{L}\p{N}._+-`;
const NOT_AFTER = new RegExp(`[${MENTION_NOT_AFTER}]`, 'u');

/** `@name` in `lower` (lower case), not in a mail address nor as the start of a longer word. */
function named(lower: string, name: string): boolean {
  if (!name) return false;
  const at = `@${name}`;
  let from = lower.indexOf(at);
  while (from !== -1) {
    const before = lower.charAt(from - 1);
    const after = lower.charAt(from + at.length);
    if ((!before || !NOT_AFTER.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after)))
      return true;
    from = lower.indexOf(at, from + 1);
  }
  return false;
}

/** Whether a message tags the conversation's agent: `@Agent`, or `@` and its name. */
export const tagsAgent = (text: string, title: string | null): boolean => {
  const lower = text.toLowerCase();
  return [CONVERSATION_AGENT_TAG, title ?? ''].some((name) =>
    named(lower, name.trim().toLowerCase()),
  );
};

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
