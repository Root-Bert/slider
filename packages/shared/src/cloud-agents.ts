import { z } from 'zod';
import { MAX_MATERIAL_CHAT_MESSAGE, type MaterialChatAnswerState } from './material-chat';
import type { Author } from './model';
import { attachmentIdsSchema } from './attachments';
import type { SenderMessage } from './sender';

/*
 * „Agenten“ in Cloud: an order to the workspace's AI that works across files on the server –
 * nothing needs to be on anyone's computer. Each agent is a place to work on one thing, kept, its
 * owner's alone until they share it with the workspace: then everyone in it sees who else is
 * there and writes along in its one chat, with one desk. It works with the rights of the person
 * who wrote, nothing more, in the files, documents and presentations themselves, at once: its desk
 * („Schreibtisch“) lists what it did there, and each of it is taken back from there. In the other
 * apps (to-dos, calendar, messages, mail) it acts as the person would; what cannot be undone or
 * reaches out waits for their „Bestätigen“. It keeps a memory („Gedächtnis“, one per agent – a
 * shared agent's its members see and change) and follows its „Anweisungen“.
 */

/** Characters of one file an agent writes. */
export const MAX_CLOUD_AGENT_FILE_CHARS = 400_000;
/** Things on one agent's desk. */
export const MAX_CLOUD_AGENT_FILES = 400;

export const cloudAgentInputSchema = z.object({
  /** May stay empty where files are put on it. */
  text: z.string().trim().max(MAX_MATERIAL_CHAT_MESSAGE, 'Die Nachricht ist zu lang.'),
  /** Files put on it (`@slider/shared` attachments): the agent reads them. */
  attachments: attachmentIdsSchema,
  /** Which of the agent's chats; left out: its first. */
  chatId: z.string().min(1).max(100).optional(),
  /** The writer's time zone („Europe/Berlin“): the clock a time in the order is meant on. */
  zone: z.string().min(1).max(64).optional(),
  /** Written beside one of the writer's mails („KI zur Mail“): the agent is told which one. */
  mailThreadId: z.string().min(1).max(100).optional(),
  /** „Antworten“: a message of that chat, quoted above it (the agent is told it too). */
  replyTo: z.string().min(1).max(100).optional(),
  /** Written under an overview: the agent is told what it shows now (`CloudAgentOverview`). */
  overview: z
    .object({
      of: z.enum(['sender', 'cloud']),
      mailbox: z.string().min(1).max(100).optional(),
    })
    .optional(),
});
/**
 * The overview a question or an order was written under – Sender's „Aktuell“ (`sender`), one
 * mailbox's „Übersicht“ (`sender` with its `mailbox`), Cloud's „Für dich“ (`cloud`). The server
 * tells the agent what it shows at that moment, by id, with each message (its chat keeps the
 * person's words alone) – in one's own private agent only.
 */
export type CloudAgentOverview = NonNullable<z.infer<typeof cloudAgentInputSchema>['overview']>;
/** One of an agent's chats (left out: its first) – to stop it, or to say one is typing there. */
export const cloudAgentChatRefSchema = z.object({ chatId: z.string().min(1).max(100).optional() });
/**
 * A run where it was called in a conversation (`@Agent`): keyed `<agent>:<channel>`, apart from
 * the agent's chats (their ids no `:`) – nothing of it is kept in them.
 */
export const isTagChat = (chatId: string) => chatId.includes(':');
export type CloudAgentInput = z.input<typeof cloudAgentInputSchema>;
/**
 * `PATCH /cloud/agents/:id`: where it stands (`areaId`: in an area, or in none) and who sees it
 * – its owner alone, or (`shared`) everyone who sees that area, in none the workspace.
 */
export const cloudAgentShareSchema = z.object({
  shared: z.boolean(),
  areaId: z.string().min(1).max(100).nullable().optional(),
});
export type CloudAgentShare = z.input<typeof cloudAgentShareSchema>;
/** An agent's name: what its chat is about, as a heading. */
export const CLOUD_AGENT_TITLE_MAX = 60;
/** `PATCH /cloud/agents/:id/title`: its owner names it – the agent names it no more. */
/** A file of an agent's memory („Gedächtnis“), on its page: everyone who works with it sees it. */
export interface CloudAgentMemory {
  /** Under `/memories`, e.g. `/memories/team.md`. */
  path: string;
  content: string;
  /** Who changed it last (by hand, or whose run the agent wrote it in); `null`: gone. */
  updatedBy: string | null;
  updatedAt: string;
}

/** Characters of one file of an agent's memory. */
export const MAX_CLOUD_AGENT_MEMORY_FILE = 20_000;

/** A person changes a file of an agent's memory; an empty text deletes it. */
export const cloudAgentMemorySchema = z.object({
  path: z.string().trim().min(1).max(200),
  content: z.string().max(MAX_CLOUD_AGENT_MEMORY_FILE),
});

/** The most an agent's „Anweisungen“ may say. */
export const MAX_CLOUD_AGENT_INSTRUCTIONS = 8000;
export const cloudAgentInstructionsSchema = z.object({
  instructions: z.string().trim().max(MAX_CLOUD_AGENT_INSTRUCTIONS),
});

export const cloudAgentTitleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Gib dem Agenten einen Namen.')
    .max(CLOUD_AGENT_TITLE_MAX, `Höchstens ${CLOUD_AGENT_TITLE_MAX} Zeichen.`),
});
/**
 * `POST /workspaces/:id/cloud/agents`: the order, the area the new agent stands in and whether it
 * is given to that area's people (in none the workspace's) – an order written in an area or the
 * workspace is theirs from the start, one under „Agenten“ › „Meine“ its owner's alone.
 */
export const cloudAgentOrderSchema = cloudAgentInputSchema
  .pick({ text: true, attachments: true, zone: true, mailThreadId: true, overview: true })
  .extend({
    areaId: z.string().min(1).max(100).nullable().optional(),
    shared: z.boolean().optional(),
  });
export type CloudAgentOrder = z.input<typeof cloudAgentOrderSchema>;

/** How often a repeated order runs: every day, Monday to Friday, or once a week. */
export const CLOUD_AGENT_REPEATS = ['day', 'weekdays', 'week'] as const;
/** When it runs: at a time of day on the clock of the person's time zone. */
export const cloudAgentRepeatRuleSchema = z.object({
  every: z.enum(CLOUD_AGENT_REPEATS),
  /** `HH:MM`, 24 hours. */
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Of `week`: the day, `0` Sunday to `6` Saturday. */
  day: z.number().int().min(0).max(6).optional(),
  /** An IANA time zone („Europe/Berlin“): the browser's when it was set. */
  zone: z.string().min(1).max(64),
});
export type CloudAgentRepeatRule = z.infer<typeof cloudAgentRepeatRuleSchema>;
/**
 * `PUT /cloud/agents/:id/repeat`: the order the agent takes up again by itself, and when – or
 * `null` to end that. Its owner's alone; each run is a message of theirs in the first chat.
 */
export const cloudAgentRepeatInputSchema = z.object({
  repeat: cloudAgentRepeatRuleSchema
    .extend({
      text: z.string().trim().min(1).max(MAX_MATERIAL_CHAT_MESSAGE, 'Der Auftrag ist zu lang.'),
    })
    .nullable(),
});
export type CloudAgentRepeatInput = z.infer<typeof cloudAgentRepeatInputSchema>['repeat'];
/**
 * What an agent keeps an eye on, to work by itself when it changes: everything in an area, a
 * folder with all in it, one file, or who an area's people are.
 */
export const CLOUD_AGENT_WATCH_KINDS = ['area', 'folder', 'file', 'people'] as const;
export type CloudAgentWatchKind = (typeof CLOUD_AGENT_WATCH_KINDS)[number];
/** One thing watched, and what the agent does when it changes – set by the agent from its order. */
export interface CloudAgentWatch {
  id: string;
  on: CloudAgentWatchKind;
  /** The area (`area`, `people`), folder or file. */
  targetId: string;
  /** What that was called when the watch was set. */
  name: string;
  /** What to do then, in the person's words. */
  text: string;
  /** Seconds it must have been quiet there before the agent starts; left out: the usual. */
  quiet?: number;
  /**
   * Collecting: nothing starts at a change – at this moment the agent works once, with all that
   * happened until then, and the watch ends.
   */
  until?: string;
  /** What happened before this moment it has worked on already. */
  since?: string;
}
/** How long a watch waits for quiet when the order names nothing, in seconds. */
export const CLOUD_AGENT_WATCH_QUIET = 20;
/**
 * What an agent has noticed where it watches and not yet worked on – told as it stands there
 * waiting, so its person sees that it saw: files on their way up, what happened, when it starts.
 */
export interface CloudAgentWatching {
  watchId: string;
  /** What is watched, by its name. */
  name: string;
  /** Files being uploaded there right now, by name. */
  uploading: string[];
  /** What happened there, oldest first, in words – the last few. */
  seen: string[];
  /** How many things happened in all. */
  count: number;
  /**
   * Milliseconds until it starts by itself, counted from this answer; `null`: not before
   * something else ends (an upload, the work it is at) or happens.
   */
  startsIn: number | null;
  /** It collects until this moment (the watch's `until`) instead of waiting for quiet. */
  until: string | null;
}
/**
 * An answer the agent offers to a question of its own, written into its message as
 * `[[choice:…]]`: shown as a button under it – a click sends it as the person's answer.
 */
export const CLOUD_AGENT_CHOICE = /\[\[choice:([^\]\n]{1,120})\]\]/g;
/** Things one agent watches. */
export const MAX_CLOUD_AGENT_WATCHES = 8;
/**
 * `PATCH /cloud/agents/:id/auto`: its owner pauses what the agent does by itself (the repeated
 * order and its watches stay, nothing runs), takes one watch away, or has it start at once on what
 * it has seen.
 */
export const cloudAgentAutoSchema = z.object({
  paused: z.boolean().optional(),
  removeWatch: z.string().min(1).max(100).optional(),
  /** Not waited any longer: it starts now on what it has seen where it watches. */
  startNow: z.boolean().optional(),
});
export type CloudAgentAuto = z.input<typeof cloudAgentAutoSchema>;

/** The repeated order as the agent carries it: with when it runs next. */
export type CloudAgentRepeat = NonNullable<CloudAgentRepeatInput> & { nextRunAt: string };

/**
 * What lies on the desk: a new file or another version of one that is there, a new folder, a
 * file or folder to be moved, renamed or deleted, a new presentation, or the agent's changed
 * copy of one (`deck-change`).
 */
export type CloudAgentFileKind =
  'new' | 'change' | 'folder' | 'move' | 'rename' | 'delete' | 'deck' | 'deck-change';
/**
 * `taken`: done – an agent does what it does at once, in the files and presentations
 * themselves. `discarded`: taken back by its person. `open`: from before that, when things
 * waited on the desk to be taken over.
 */
export type CloudAgentFileStatus = 'open' | 'taken' | 'discarded';
/**
 * What it takes to take a thing back: the version a changed file had before and the one the
 * agent made, where a moved thing lay, the changes Slider's AI made to a presentation's slides.
 * A new name's old one is the row's `content`; a new thing and a deleted one need nothing.
 */
export interface CloudAgentUndo {
  from?: string | null;
  to?: string | null;
  parentId?: string | null;
  areaId?: string | null;
  proposals?: string[];
}

export interface CloudAgentFile {
  id: string;
  name: string;
  kind: CloudAgentFileKind;
  status: CloudAgentFileStatus;
  /** Its text's length – `0` for what has no text to show. */
  chars: number;
  /** Where it goes when taken over, in words („Meine Dateien“, „Vertrieb › Angebote“). */
  where: string;
  /** What it is called now – of what is to be renamed, and of a changed presentation. */
  from: string | null;
  /** The file or folder it is about (gone meanwhile: `null`), or what it became. */
  nodeId: string | null;
  /** The presentation to look at: the new one, or the agent's copy. */
  deckId: string | null;
  /** Its person can take it back („Zurücknehmen“): done by the agent, and there is a way back. */
  undoable: boolean;
  /**
   * Its picture: that presentation's first slide (for the agent's person), or the small picture
   * of the file it is about, once drawn – a link whoever may see the file can load. `null`: none.
   */
  thumbnailUrl: string | null;
  updatedAt: string;
}

/**
 * A message in an agent's chat: a Sender message (its chat is a conversation, kind `agent`) –
 * shown by the same list, reacted to, answered, changed as any – and what only an agent's has.
 */
export interface CloudAgentMessage extends SenderMessage {
  role: 'user' | 'assistant';
  /** The agent's: `answering` while it works; `null` for a person's. */
  state: MaterialChatAnswerState | 'answering' | null;
  error: string | null;
  /** What the agent asked to be confirmed while it wrote this answer: a card each under it. */
  asks?: CloudAgentAsk[];
  /** What it did with its tools for this answer, in order – the model is told them too. */
  steps?: CloudAgentStep[];
}

/** One thing an agent did with a tool for an answer, as its activity named it. */
export interface CloudAgentStep {
  /** „Liest eine Datei“. */
  label: string;
  /** The app the tool belongs to – its mark beside the label. */
  app: string | null;
  /** It was refused or failed. */
  failed: boolean;
}

/**
 * „Bestätigen“ or „Abbrechen“: something an agent wants done that cannot be undone or reaches
 * out (delete, send, a public link) waits in its chat until the person confirms it.
 */
export const CLOUD_AGENT_ASK_STATES = ['open', 'done', 'cancelled', 'failed'] as const;
export type CloudAgentAskState = (typeof CLOUD_AGENT_ASK_STATES)[number];

export interface CloudAgentAsk {
  id: string;
  /** What is to be done, as a question („„Angebot.pdf“ löschen?“). */
  text: string;
  /** The button that does it („Löschen“, „Senden“). */
  verb: string;
  /** What the card says once it is done („Gelöscht“). */
  doneWord: string;
  state: CloudAgentAskState;
  /** What came of it, done or failed. */
  result: string | null;
  /** Whose rights it runs with: only they confirm it. */
  by: Author;
  /** The viewer may confirm or cancel it. */
  mine: boolean;
}

export const cloudAgentAskDecision = z.object({ confirm: z.boolean() });

/** One chat of an agent: everyone the agent is shared with sees all of them. */
export interface CloudAgentChat {
  /** The first chat has the agent's id. */
  id: string;
  title: string;
  startedBy: Author;
  /** How far the viewer had read it when asked: the „Neu“ line stands after it. */
  readSeq: number;
  running: boolean;
  /** It stopped in the middle of its work (the server started anew): write to it to go on. */
  interrupted: boolean;
  messages: CloudAgentMessage[];
  /** What it does right now („Liest eine Datei“). */
  doing: string | null;
  /** It does that in Slider (a presentation read, built, changed): shown with Slider's mark. */
  doingIn?: 'slider' | null;
  /** Who else is writing a message here right now. */
  typing: Author[];
  /** How full the model's context was at its last turn here; `null`: it has not worked here yet. */
  context: CloudAgentContext | null;
}

/** How much the model read at an agent's last turn in a chat, of how much it can. */
export interface CloudAgentContext {
  tokens: number;
  /** The model's window; `null`: the service does not say. */
  window: number | null;
  model: string | null;
  at: string;
}

export interface CloudAgentSummary {
  id: string;
  /** The start of its order. */
  title: string;
  /** The beginning of what it said last, in plain words – `null` while it has said nothing. */
  summary: string | null;
  /** Who gave the order: the agent works with their rights. */
  owner: Author;
  /** Others read along – its area's people, in no area the workspace; otherwise its owner only. */
  shared: boolean;
  /** The area it stands in; `null`: none. */
  areaId: string | null;
  /** The caller's own: only they share it and take its files over. */
  mine: boolean;
  /** The caller may write to it and open chats in it: members and admins who see it. */
  canWrite: boolean;
  /** The caller may delete it: their own, or they are an admin of the workspace. */
  canDelete: boolean;
  running: boolean;
  /** It stopped in the middle of its work (the server started anew): write to it to go on. */
  interrupted: boolean;
  /** Things lying on its desk, not yet taken over. */
  openFiles: number;
  /** Files in its memory („Gedächtnis“) – shared, it starts without them (asked first). */
  memoryFiles: number;
  /** The first of them, as put there – what the agent made or changed, to see at a glance. */
  desk: Pick<CloudAgentFile, 'id' | 'name' | 'kind' | 'nodeId' | 'thumbnailUrl'>[];
  /** The order it takes up again by itself, and when; `null`: it works when written to. */
  repeat: CloudAgentRepeat | null;
  /** What it watches, to work by itself when that changes. */
  watches: CloudAgentWatch[];
  /** Its owner paused what it does by itself: nothing runs until taken back. */
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CloudAgentDetail extends CloudAgentSummary {
  /** How its owner wants it to work („Anweisungen“) – in its prompt each run. */
  instructions: string;
  /** What it keeps across its chats („Gedächtnis“) – one for everyone who works with it. */
  memories: CloudAgentMemory[];
  /** Its chats, the first first. */
  chats: CloudAgentChat[];
  /** Who else has the agent open right now. */
  here: Author[];
  files: CloudAgentFile[];
  /** What it has noticed where it watches and waits to work on – its owner's to see. */
  watching: CloudAgentWatching[];
}

/** A desk file's text – and, for a change, the original's as it is now. */
export interface CloudAgentFileContent {
  name: string;
  content: string;
  original: string | null;
}
