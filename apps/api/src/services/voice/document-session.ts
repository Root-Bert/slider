import { eq, inArray } from 'drizzle-orm';
import {
  AI_RUNNING_LIMIT_MS,
  aiNameOf,
  writerText,
  type DocumentVoiceCommand,
  type DocumentVoiceInfo,
  type DocumentVoiceItem,
  type DocumentVoiceSegmentMeta,
  type DocumentVoiceSession,
  type Viewer,
  type VoiceItemState,
  type VoiceLive,
  type VoiceSegmentResult,
  type WriterAiState,
  type WriterBlock,
  type WriterDocument,
} from '@slider/shared';
import { requireOwner } from '../../auth/access';
import { documentAiProposals, workspaces } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError, badRequest, forbidden, notFound } from '../../http/errors';
import { providerName, refusesKey, runToolCall } from '../ai-providers';
import { moveDocumentAi, startDocumentAi, stopDocumentAi } from '../document-ai';
import {
  createDocumentComment,
  deleteDocumentComment,
  documentOf,
  openDocument,
  updateDocumentComment,
  type DocumentLive,
} from '../documents';
import {
  markKeyRefused,
  workspaceAiConnection,
  workspaceVoiceConnection,
} from '../integration-keys';
import {
  anchorFor,
  DOCUMENT_ROUTER_SYSTEM,
  DOCUMENT_ROUTER_TOOL,
  documentRouterPrompt,
  paragraphsIn,
  readDocumentActions,
  type DocumentRouterAction,
  type DocumentRouterItem,
} from './document-router';
import { isArtefact, MAX_COMMENT_CHARS } from './router';
import {
  joinedWav,
  liveTokenFor,
  pcmOf,
  SpeechProblem,
  transcribePiece,
  voiceProblem,
} from './session';

/*
 * A session of speaking to the AI over a text document (`session.ts` is the same for a deck;
 * see `@slider/shared` voice). Kept in memory: it lives as long as the person speaks; the
 * comments it makes are the document's ordinary comments, each finished one handed to the
 * document's AI (`document-ai.ts`). A server restart ends it – the browser starts a new one.
 */

/** A session nobody used this long is gone. */
const IDLE_LIMIT_MS = 30 * 60_000;
/** Sessions one account may have at once (other tabs, other documents). */
const MAX_SESSIONS_PER_USER = 3;
/** Pieces a session hands back – the latest. */
const SEGMENTS_SHOWN = 30;
const COMMAND_TTL_MS = 60_000;
/** How often a request to the AI is looked at while the next one waits. */
const PROPOSAL_POLL_MS = 1_000;
/** The person's other requests are at work (`document-ai` lets a few run at once): tried again. */
const BUSY_TRIES = 30;
const BUSY_WAIT_MS = 2_000;
const DECIDE_TIMEOUT_MS = 90_000;
const ROUTER_MAX_TOKENS = 4_000;
/** Words of going through a text speech to text should know. */
const VOCABULARY = [
  'Writer',
  'Dokument',
  'Absatz',
  'Satz',
  'Abschnitt',
  'Überschrift',
  'Kommentar',
  'Einleitung',
  'Fazit',
  'Zusammenfassung',
  'kürzen',
  'umformulieren',
  'streichen',
  'ergänzen',
  'Aufzählung',
  'Tabelle',
  'Zitat',
  'fett',
  'kursiv',
  'Tonfall',
  'Rechtschreibung',
];
const EDITORS_ONLY =
  'Die KI ändert den Text nur, wo du selbst schreiben kannst. Deine Kommentare bleiben Kommentare.';
const REVIEWERS_ONLY = 'Kommentieren können hier Prüfende, Mitglieder und Admins.';

interface SegmentRecord extends Omit<VoiceSegmentResult, 'seqs'> {
  startMs: number;
  endMs: number;
  /** The pieces heard together with it (itself first) – its text stands for all of them. */
  seqs: number[];
  /** How long speech to text took for it, ms. */
  heardMs?: number;
}

/** A piece waiting for speech to text. */
interface WaitingPiece {
  meta: DocumentVoiceSegmentMeta;
  audio: Uint8Array;
  record: SegmentRecord;
  /** Settles once it is decided on. */
  done: () => void;
  /** Decided on already, on the live words: only its accurate text is wanted. */
  decided: boolean;
}

interface ItemRecord {
  label: string;
  commentId: string;
  threadId: string;
  /** A reply in the thread of an earlier item (`add_to`): that item. */
  parent: ItemRecord | null;
  paragraphId: string;
  /** Where it stands, in words for the router. */
  place: string;
  text: string;
  /** Its request to the AI is done. */
  settled: boolean;
  /** `draft` until finished; then queued, asked (`asked`), or a comment only. */
  phase: 'draft' | 'queued' | 'asked' | 'comment' | 'dropped' | 'failed';
  proposalId: string | null;
  note: string | null;
  segments: number[];
  /** Its additions (replies): asked with it, or after it. */
  additions: ItemRecord[];
  /** Taken up by an addition asked after it (its own request was stopped for that). */
  supersededBy: ItemRecord | null;
  createdAt: Date;
}

interface Session {
  id: string;
  documentId: string;
  workspaceId: string;
  title: string;
  userId: string;
  aiEdits: boolean;
  aiEditsReason: string | null;
  /** Who turns the speech into text, by name. */
  speechService: string;
  /** The document's headings as last read: names speech to text is told to expect. */
  headings: string[];
  items: ItemRecord[];
  segments: SegmentRecord[];
  commands: { id: number; command: DocumentVoiceCommand; at: number }[];
  /** Pieces are decided on one after another, in the order they came. */
  chain: Promise<void>;
  /** Pieces waiting for speech to text while it hears others: heard together next. */
  waiting: WaitingPiece[];
  hearing: boolean;
  /**
   * Requests to the AI go one after another: each reads the whole text and rewrites paragraphs
   * of it, so the next one must see what the one before wrote.
   */
  asking: Promise<void>;
  pending: number;
  ended: boolean;
  lastUsed: number;
}

const sessions = new Map<string, Session>();
let commandCount = 0;

/** Whether a session's id is a document's – the routes serve both kinds under one address. */
export const isDocumentVoiceSession = (sessionId: string): boolean => sessions.has(sessionId);

function sweep(now: number) {
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > IDLE_LIMIT_MS) sessions.delete(id);
  }
}

function userOf(viewer: Viewer): string {
  requireOwner(viewer);
  return viewer.author.id;
}

/** What the person may do in the document now: comment (else no session), write (else no AI). */
function rightsIn(document: WriterDocument): { aiEdits: boolean; aiEditsReason: string | null } {
  if (!document.permissions.canComment) throw forbidden(REVIEWERS_ONLY);
  const aiEdits = document.permissions.canEdit;
  return { aiEdits, aiEditsReason: aiEdits ? null : EDITORS_ONLY };
}

/**
 * The session, its person still allowed to comment on the document – asked anew with every
 * call: removed from it meanwhile (or the document deleted), the session ends, no more of the
 * workspace's speech and AI keys spent.
 */
async function usableSessionOf(deps: AppDeps, viewer: Viewer, sessionId: string): Promise<Session> {
  const userId = userOf(viewer);
  const now = deps.clock.now().getTime();
  sweep(now);
  const session = sessions.get(sessionId);
  if (!session) throw notFound('Diese Sprech-Sitzung ist vorbei. Bitte neu starten.');
  if (session.userId !== userId) throw forbidden('Das ist nicht deine Sitzung.');
  session.lastUsed = now;
  try {
    const document = await documentOf(deps, userId, session.documentId);
    Object.assign(session, rightsIn(document), { title: document.title });
  } catch (error) {
    sessions.delete(session.id);
    throw error;
  }
  return session;
}

// ── Starting ─────────────────────────────────────────────────────────────

/** The document's AI by name, and whether it is there to speak to. */
export async function documentVoiceInfo(
  deps: AppDeps,
  viewer: Viewer,
  documentId: string,
): Promise<DocumentVoiceInfo> {
  const document = await documentOf(deps, userOf(viewer), documentId);
  const [[workspace], ai] = await Promise.all([
    deps.db
      .select({ aiName: workspaces.aiName })
      .from(workspaces)
      .where(eq(workspaces.id, document.workspaceId)),
    workspaceAiConnection(deps, document.workspaceId),
  ]);
  return {
    name: aiNameOf(workspace?.aiName),
    available: Boolean(ai.connection) && document.permissions.canComment,
  };
}

/**
 * Starts speaking to the AI in a document: needs the right to comment, speech to text and an AI
 * in the workspace (it decides what the speech is). Whether finished comments also go to the AI
 * depends on the right to write in the document.
 */
export async function startDocumentVoiceSession(
  deps: AppDeps,
  viewer: Viewer,
  documentId: string,
): Promise<DocumentVoiceSession> {
  const userId = userOf(viewer);
  const document = await documentOf(deps, userId, documentId);
  const rights = rightsIn(document);
  const [speech, ai] = await Promise.all([
    workspaceVoiceConnection(deps, document.workspaceId),
    workspaceAiConnection(deps, document.workspaceId),
  ]);
  if (!speech.connection) throw new ApiError(409, 'speech_not_configured', speech.error);
  if (!ai.connection) throw new ApiError(409, 'ai_not_configured', ai.error);

  const now = deps.clock.now().getTime();
  sweep(now);
  const own = [...sessions.values()]
    .filter((session) => session.userId === userId)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  // The oldest of too many goes – a tab closed without ending its session.
  while (own.length >= MAX_SESSIONS_PER_USER) sessions.delete(own.shift()!.id);
  const session: Session = {
    id: crypto.randomUUID(),
    documentId: document.id,
    workspaceId: document.workspaceId,
    title: document.title,
    userId,
    ...rights,
    speechService: providerName(speech.connection),
    headings: [],
    items: [],
    segments: [],
    commands: [],
    chain: Promise.resolve(),
    waiting: [],
    hearing: false,
    asking: Promise.resolve(),
    pending: 0,
    ended: false,
    lastUsed: now,
  };
  sessions.set(session.id, session);
  return toDto(deps, session);
}

export async function getDocumentVoiceSession(
  deps: AppDeps,
  viewer: Viewer,
  sessionId: string,
): Promise<DocumentVoiceSession> {
  return toDto(deps, await usableSessionOf(deps, viewer, sessionId));
}

/** Where the browser streams the microphone to show the words as they are spoken (`liveTokenFor`). */
export async function liveDocumentVoiceToken(
  deps: AppDeps,
  viewer: Viewer,
  sessionId: string,
): Promise<VoiceLive> {
  const session = await usableSessionOf(deps, viewer, sessionId);
  if (session.ended) return null;
  return liveTokenFor(deps, session.workspaceId, [
    ...VOCABULARY,
    session.title,
    ...session.headings,
  ]);
}

// ── A piece of speech ────────────────────────────────────────────────────

/**
 * A piece of speech: heard as soon as speech to text is free – together with the others that
 * waited meanwhile – and decided on after the pieces before it. Answers once it is decided on,
 * with the session as it is then.
 */
export async function addDocumentVoiceSegment(
  deps: AppDeps,
  live: DocumentLive,
  viewer: Viewer,
  sessionId: string,
  meta: DocumentVoiceSegmentMeta,
  audio: Uint8Array,
): Promise<DocumentVoiceSession> {
  const session = await usableSessionOf(deps, viewer, sessionId);
  if (session.ended) throw badRequest('Diese Sprech-Sitzung ist beendet.');
  if (!pcmOf(audio)) throw badRequest('Die Aufnahme muss eine WAV-Datei (16 Bit, mono) sein.');
  if (session.segments.some((segment) => segment.seqs.includes(meta.seq))) {
    // Sent twice (a retry after a lost answer): the first counts.
    return toDto(deps, session);
  }
  const record: SegmentRecord = {
    seq: meta.seq,
    text: '',
    status: 'done',
    error: null,
    startMs: meta.startMs,
    endMs: meta.endMs,
    seqs: [meta.seq],
    heard: false,
  };
  session.segments.push(record);
  session.segments.sort((a, b) => a.seq - b.seq);
  session.pending += 1;
  const liveText = meta.liveText?.trim();
  if (liveText) {
    // The live words are there already: decided on at once, after the pieces before – speech to
    // text only makes them accurate afterwards (the caption).
    record.text = liveText;
    const step = session.chain.then(() =>
      decideOn(deps, live, session, record, meta, liveText).finally(() => {
        session.pending -= 1;
      }),
    );
    session.chain = step;
    session.waiting.push({ meta, audio, record, done: () => undefined, decided: true });
    hearNext(deps, live, session);
    await step;
    return toDto(deps, session);
  }
  await new Promise<void>((done) => {
    session.waiting.push({ meta, audio, record, done, decided: false });
    hearNext(deps, live, session);
  });
  return toDto(deps, session);
}

/** A piece's words decided on – nothing when they are no words, why when it fails. */
async function decideOn(
  deps: AppDeps,
  live: DocumentLive,
  session: Session,
  record: SegmentRecord,
  meta: DocumentVoiceSegmentMeta,
  text: string,
) {
  try {
    if (isArtefact(text)) {
      record.status = 'empty';
      return;
    }
    const decidingAt = Date.now();
    const actions = await decide(deps, live, session, record, meta, text);
    deps.log.info(
      `Voice ${session.id} (document): ${(meta.endMs - meta.startMs) / 1000} s of speech ${record.heard ? `heard in ${record.heardMs ?? '?'} ms` : 'decided on its live words'}, decided in ${Date.now() - decidingAt} ms: ${actions.join(', ') || 'nothing'}`,
    );
  } catch (error) {
    record.status = 'failed';
    record.heard = true;
    record.error = await voiceProblem(deps, session.id, session.workspaceId, error);
  }
}

/** The pieces waiting, heard as one, once speech to text is free; decided on in turn. */
function hearNext(deps: AppDeps, live: DocumentLive, session: Session) {
  if (session.hearing || session.waiting.length === 0) return;
  session.hearing = true;
  // Heard together: pieces of one kind – decided on already, or waiting for their words.
  session.waiting.sort((a, b) => a.meta.seq - b.meta.seq);
  const kind = session.waiting[0]!.decided;
  const count = session.waiting.findIndex((piece) => piece.decided !== kind);
  const batch = session.waiting.splice(0, count === -1 ? session.waiting.length : count);
  const first = batch[0]!;
  // Heard together: the first piece's record stands for all of them.
  for (const piece of batch.slice(1)) {
    session.segments = session.segments.filter((segment) => segment !== piece.record);
    first.record.seqs.push(piece.meta.seq);
  }
  first.record.endMs = batch.at(-1)!.meta.endMs;
  const meta = mergedMeta(batch.map((piece) => piece.meta));
  const hearingAt = Date.now();
  // What was said just before carries on: the same language, the same names.
  const before = session.segments
    .filter((segment) => segment.seq < meta.seq && segment.status === 'done')
    .at(-1)?.text;
  const heard = transcribePiece(
    deps,
    session.workspaceId,
    { seq: meta.seq, audio: joinedWav(batch.map((piece) => piece.audio)) },
    { vocabulary: VOCABULARY, names: [session.title, ...session.headings.slice(0, 20)], before },
    (service) => {
      session.speechService = service;
    },
  ).then((text) => {
    first.record.heardMs = Date.now() - hearingAt;
    return text;
  });
  void heard
    .catch(() => undefined)
    .finally(() => {
      session.hearing = false;
      hearNext(deps, live, session);
    });
  const { record } = first;
  if (kind) {
    // Decided on its live words: the accurate text takes their place – or, when speech to text
    // fails, the live words stay.
    record.text = batch.map((piece) => piece.meta.liveText?.trim() ?? '').join(' ');
    void heard
      .then((text) => {
        if (text.trim()) record.text = text;
      })
      .catch((error: unknown) => {
        if (!(error instanceof SpeechProblem)) deps.log.warn('Voice: piece not heard', error);
      })
      .finally(() => {
        record.heard = true;
      });
    return;
  }
  const step = session.chain.then(async () => {
    try {
      const text = await heard;
      record.text = text;
      record.heard = true;
      await decideOn(deps, live, session, record, meta, text);
    } catch (error) {
      record.status = 'failed';
      record.heard = true;
      record.error = await voiceProblem(deps, session.id, session.workspaceId, error);
    } finally {
      session.pending -= batch.length;
    }
  });
  session.chain = step;
  void step.finally(() => {
    for (const piece of batch) piece.done();
  });
}

/** Several pieces' context as one: the paragraphs and pointer places summed, the last pick. */
function mergedMeta(metas: readonly DocumentVoiceSegmentMeta[]): DocumentVoiceSegmentMeta {
  if (metas.length === 1) return metas[0]!;
  const summed = (lists: readonly { paragraphId: string; ms: number }[][]) => {
    const total = new Map<string, number>();
    for (const list of lists) {
      for (const entry of list) {
        total.set(entry.paragraphId, (total.get(entry.paragraphId) ?? 0) + entry.ms);
      }
    }
    return [...total].map(([paragraphId, ms]) => ({ paragraphId, ms: Math.min(ms, 600_000) }));
  };
  const last = metas.at(-1)!;
  return {
    seq: metas[0]!.seq,
    startMs: metas[0]!.startMs,
    endMs: last.endMs,
    context: {
      paragraphs: summed(metas.map((meta) => meta.context.paragraphs)).slice(0, 120),
      pointer: summed(metas.map((meta) => meta.context.pointer))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 20),
      selection: metas.findLast((meta) => meta.context.selection)?.context.selection ?? null,
    },
  };
}

/** What the piece is – asked of the fast model – and done. */
async function decide(
  deps: AppDeps,
  live: DocumentLive,
  session: Session,
  record: SegmentRecord,
  meta: DocumentVoiceSegmentMeta,
  text: string,
): Promise<string[]> {
  const ai = await workspaceAiConnection(deps, session.workspaceId);
  if (!ai.connection) throw new ApiError(409, 'ai_not_configured', ai.error);
  const { blocks } = (await openDocument(deps, session.userId, session.documentId)).content;
  session.headings = paragraphsIn(blocks)
    .filter((block) => block.kind === 'title' || block.kind === 'heading')
    .map((block) => writerText(block).replace(/\s+/g, ' ').trim())
    .filter((heading) => heading && heading.length <= 100)
    .slice(0, 60);
  const states = await proposalStates(deps, session);
  const items: DocumentRouterItem[] = session.items
    .filter((item) => item.phase !== 'dropped')
    .map((item) => ({
      label: item.label,
      place: item.parent ? `addition to ${item.parent.label}` : item.place,
      text: item.text,
      status: STATUS_WORDS[stateOf(item, states)],
    }));
  const history = session.segments
    .filter((segment) => segment.seq < record.seq && segment.status === 'done' && segment.text)
    .map((segment) => segment.text);
  let input: unknown;
  try {
    input = await runToolCall(deps, ai.connection, {
      system: DOCUMENT_ROUTER_SYSTEM,
      tool: DOCUMENT_ROUTER_TOOL,
      user: documentRouterPrompt({
        title: session.title,
        blocks,
        context: meta.context,
        items,
        history,
        text,
        durationMs: Math.max(0, meta.endMs - meta.startMs),
      }),
      maxTokens: ROUTER_MAX_TOKENS,
      signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
    });
  } catch (error) {
    if (refusesKey(error)) {
      await markKeyRefused(deps, ai.keyId, 'Der Dienst hat den Key abgelehnt.');
    }
    throw error;
  }
  const actions = readDocumentActions(input);
  for (const action of actions) {
    try {
      await act(deps, live, session, action, record, meta, blocks);
    } catch (error) {
      // One action that cannot be done (a comment deleted meanwhile) leaves the others.
      if (!(error instanceof ApiError)) throw error;
      record.error = error.message;
    }
  }
  return actions.map((action) =>
    [action.type, action.item, action.finished ? 'finished' : ''].filter(Boolean).join(' '),
  );
}

// ── Actions ──────────────────────────────────────────────────────────────

async function act(
  deps: AppDeps,
  live: DocumentLive,
  session: Session,
  action: DocumentRouterAction,
  record: SegmentRecord,
  meta: DocumentVoiceSegmentMeta,
  blocks: readonly WriterBlock[],
) {
  const item = action.item ? itemByLabel(session, action.item) : null;
  switch (action.type) {
    case 'new': {
      if (!action.text) return;
      const created = await newItem(deps, live, session, action, meta, blocks);
      if (!created) return;
      created.segments.push(...record.seqs);
      if (action.finished) finish(deps, live, session, created);
      return;
    }
    case 'continue': {
      if (!item || !action.text) return;
      // Still a draft: the comment says it all now. Finished already: it is an addition.
      if (item.phase !== 'draft') return addTo(deps, live, session, item, action, record);
      await setText(deps, live, session, item, action.text);
      for (const seq of record.seqs) if (!item.segments.includes(seq)) item.segments.push(seq);
      if (action.finished) finish(deps, live, session, item);
      return;
    }
    case 'finish': {
      if (item) finish(deps, live, session, item);
      return;
    }
    case 'add_to': {
      if (!item || !action.text) return;
      return addTo(deps, live, session, item, action, record);
    }
    // Taking back writes the text anew: the next pieces need not wait for it.
    case 'drop': {
      if (item) inBackground(deps, session, drop(deps, live, session, item));
      return;
    }
    case 'undo': {
      if (item) inBackground(deps, session, takeBackAll(deps, live, session, proposalsOf(item)));
      return;
    }
    case 'scroll_to': {
      const paragraphId = action.paragraph?.trim();
      if (paragraphId && paragraphsIn(blocks).some((block) => block.id === paragraphId)) {
        command(deps, session, { type: 'scrollTo', paragraphId });
      }
      return;
    }
    case 'stop_session': {
      command(deps, session, { type: 'stop' });
      return;
    }
  }
}

function inBackground(deps: AppDeps, session: Session, work: Promise<void>) {
  work.catch((error: unknown) => {
    if (!(error instanceof ApiError)) deps.log.warn(`Voice session ${session.id}: not done`, error);
  });
}

function itemByLabel(session: Session, label: string): ItemRecord | null {
  const wanted = label.trim().toUpperCase();
  return session.items.find((item) => item.label === wanted && item.phase !== 'dropped') ?? null;
}

function command(deps: AppDeps, session: Session, voiceCommand: DocumentVoiceCommand) {
  const at = deps.clock.now().getTime();
  session.commands.push({ id: (commandCount += 1), command: voiceCommand, at });
}

const clipText = (text: string) => text.slice(0, MAX_COMMENT_CHARS);

/**
 * The paragraph a new comment is about: the one the router named; without (or with one that is
 * not there) the one with the caret or the picked words, the one the pointer rested on longest,
 * the one longest in the window.
 */
function paragraphFor(
  action: DocumentRouterAction,
  meta: DocumentVoiceSegmentMeta,
  blocks: readonly WriterBlock[],
) {
  const all = paragraphsIn(blocks);
  const { context } = meta;
  const longest = [...context.paragraphs].sort((a, b) => b.ms - a.ms)[0];
  const candidates = [
    action.paragraph?.trim(),
    context.selection?.paragraphId,
    context.pointer[0]?.paragraphId,
    longest?.paragraphId,
  ];
  for (const id of candidates) {
    const block = id ? all.find((each) => each.id === id) : undefined;
    if (block) return block;
  }
  return null;
}

const newRecord = (
  deps: AppDeps,
  session: Session,
  values: Pick<ItemRecord, 'commentId' | 'threadId' | 'parent' | 'paragraphId' | 'place' | 'text'>,
): ItemRecord => ({
  label: `K${session.items.length + 1}`,
  ...values,
  settled: false,
  phase: 'draft',
  proposalId: null,
  note: null,
  segments: [],
  additions: [],
  supersededBy: null,
  createdAt: deps.clock.now(),
});

/** A new comment at the words the router named (`anchorFor`). */
async function newItem(
  deps: AppDeps,
  live: DocumentLive,
  session: Session,
  action: DocumentRouterAction,
  meta: DocumentVoiceSegmentMeta,
  blocks: readonly WriterBlock[],
): Promise<ItemRecord | null> {
  const block = paragraphFor(action, meta, blocks);
  if (!block) return null;
  const anchor = anchorFor(
    { id: block.id, text: writerText(block) },
    action.quote,
    meta.context.selection,
  );
  const whole = anchor.start === 0 && anchor.end === writerText(block).length;
  const comment = await createDocumentComment(deps, live, session.userId, session.documentId, {
    id: crypto.randomUUID(),
    parentId: null,
    body: clipText(action.text!),
    anchor,
  });
  const item = newRecord(deps, session, {
    commentId: comment.id,
    threadId: comment.id,
    parent: null,
    paragraphId: block.id,
    place: whole
      ? `paragraph ${block.id}`
      : `paragraph ${block.id}, on „${anchor.quote.slice(0, 80)}“`,
    text: comment.body,
  });
  session.items.push(item);
  return item;
}

async function setText(
  deps: AppDeps,
  live: DocumentLive,
  session: Session,
  item: ItemRecord,
  text: string,
) {
  const body = clipText(text);
  if (body === item.text) return;
  await updateDocumentComment(deps, live, session.userId, item.commentId, { body });
  item.text = body;
}

/** An addition to a finished comment: a reply in its thread, asked about with it. */
async function addTo(
  deps: AppDeps,
  live: DocumentLive,
  session: Session,
  target: ItemRecord,
  action: DocumentRouterAction,
  record: SegmentRecord,
) {
  // Additions go to the comment itself, not to another addition.
  const root = target.parent ?? target;
  // An addition still being said takes the new words.
  const open = root.additions.find((addition) => addition.phase === 'draft');
  if (open) {
    await setText(deps, live, session, open, `${open.text} ${action.text}`.trim());
    for (const seq of record.seqs) if (!open.segments.includes(seq)) open.segments.push(seq);
    if (action.finished !== false) finish(deps, live, session, open);
    return;
  }
  const reply = await createDocumentComment(deps, live, session.userId, session.documentId, {
    id: crypto.randomUUID(),
    parentId: root.threadId,
    body: clipText(action.text!),
    anchor: null,
  });
  const item = newRecord(deps, session, {
    commentId: reply.id,
    threadId: root.threadId,
    parent: root,
    paragraphId: root.paragraphId,
    place: root.place,
    text: reply.body,
  });
  item.segments.push(...record.seqs);
  session.items.push(item);
  root.additions.push(item);
  // An addition is mostly said in one go; one cut off stays open for the next piece.
  if (action.finished !== false) finish(deps, live, session, item);
}

/** A comment said completely: to the AI, after the session's earlier requests. */
function finish(deps: AppDeps, live: DocumentLive, session: Session, item: ItemRecord) {
  if (item.phase !== 'draft') return;
  if (!session.aiEdits) {
    item.phase = 'comment';
    item.note = session.aiEditsReason;
    return;
  }
  const root = item.parent;
  if (root) {
    // Its comment not asked yet: asked with it, its latest addition the request.
    if (root.phase === 'draft' || root.phase === 'queued') {
      item.phase = 'queued';
      return;
    }
    // Asked already and still at work: stopped, and asked again with the addition, which then
    // shows for both. Done already: the addition is asked on top of its change.
    if (root.proposalId && root.phase === 'asked' && !root.settled) {
      void stopDocumentAi(deps, live, session.userId, root.proposalId).then(
        (stopped) => {
          if (stopped.status === 'stopped') root.supersededBy = item;
        },
        () => undefined,
      );
    }
  }
  item.phase = 'queued';
  session.asking = session.asking
    .then(() => ask(deps, live, session, item))
    .catch((error: unknown) => deps.log.warn(`Voice session ${session.id}: AI not asked`, error));
}

/** Asks the AI for an item – its latest addition is the request, the thread the context. */
async function ask(deps: AppDeps, live: DocumentLive, session: Session, item: ItemRecord) {
  if (item.phase !== 'queued') return;
  const additions = item.parent
    ? []
    : item.additions.filter((addition) => addition.phase === 'queued');
  const asking = additions.at(-1) ?? item;
  const all = [item, ...additions];
  try {
    const proposalId = crypto.randomUUID();
    for (let tries = 0; ; tries += 1) {
      try {
        await startDocumentAi(deps, live, session.userId, session.documentId, {
          id: proposalId,
          commentId: asking.commentId,
        });
        break;
      } catch (error) {
        const busy = error instanceof ApiError && error.status === 429;
        if (!busy || tries >= BUSY_TRIES || item.phase !== 'queued') throw error;
        await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_MS));
      }
    }
    for (const asked of all) {
      // Taken back while it waited: stays so.
      if (asked.phase === 'queued') asked.phase = 'asked';
      asked.proposalId = proposalId;
    }
    const startedAt = Date.now();
    await settled(deps, proposalId);
    for (const asked of all) asked.settled = true;
    deps.log.info(
      `Voice ${session.id} (document): ${item.label} done by the AI in ${Date.now() - startedAt} ms`,
    );
  } catch (error) {
    const note = error instanceof ApiError ? error.message : 'Die KI konnte nicht gefragt werden.';
    for (const asked of all) {
      if (asked.phase === 'dropped') continue;
      asked.phase = 'failed';
      asked.note = note;
    }
    if (!(error instanceof ApiError)) throw error;
  }
}

/** Waits until a request to the AI is done – the next one sees its change. */
async function settled(deps: AppDeps, proposalId: string) {
  const until = Date.now() + AI_RUNNING_LIMIT_MS + 60_000;
  while (Date.now() < until) {
    const [row] = await deps.db
      .select({ status: documentAiProposals.status })
      .from(documentAiProposals)
      .where(eq(documentAiProposals.id, proposalId));
    if (!row || row.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, PROPOSAL_POLL_MS));
  }
}

/**
 * The requests to the AI an item made – itself and, for a comment, its additions –, newest
 * first, each once (an addition asked together with its comment shares its request).
 */
function proposalsOf(item: ItemRecord): string[] {
  const said = [item, ...item.additions].filter((each) => each.phase === 'asked');
  return [...new Set(said.flatMap((each) => (each.proposalId ? [each.proposalId] : [])))].reverse();
}

/** Each request stopped if still at work, its change taken back if it made one – newest first. */
async function takeBackAll(
  deps: AppDeps,
  live: DocumentLive,
  session: Session,
  proposalIds: readonly string[],
) {
  if (proposalIds.length === 0) return;
  const rows = await deps.db
    .select({ id: documentAiProposals.id, status: documentAiProposals.status })
    .from(documentAiProposals)
    .where(inArray(documentAiProposals.id, [...proposalIds]));
  for (const id of proposalIds) {
    const status = rows.find((row) => row.id === id)?.status;
    if (status === 'running') {
      await stopDocumentAi(deps, live, session.userId, id).catch(() => undefined);
    } else if (status === 'applied') {
      await moveDocumentAi(deps, live, session.userId, id, 'revert');
    }
  }
}

/**
 * „Vergiss das“: the comment goes – the AI stopped first if it works on it, its changes (and
 * those of its additions) taken back if it made some.
 */
async function drop(deps: AppDeps, live: DocumentLive, session: Session, item: ItemRecord) {
  const proposalIds = proposalsOf(item);
  // Gone for the session at once: not asked about any more, not named to the router.
  item.phase = 'dropped';
  for (const addition of item.additions) addition.phase = 'dropped';
  await takeBackAll(deps, live, session, proposalIds);
  await deleteDocumentComment(deps, live, session.userId, item.commentId).catch(
    (error: unknown) => {
      if (!(error instanceof ApiError)) throw error;
    },
  );
}

// ── Pauses and the end ───────────────────────────────────────────────────

/**
 * The person paused for a while (or ends): comments still being said are finished – after the
 * pieces still on their way, which may go on with them.
 */
export async function flushDocumentVoiceSession(
  deps: AppDeps,
  live: DocumentLive,
  viewer: Viewer,
  sessionId: string,
  { end = false }: { end?: boolean } = {},
): Promise<DocumentVoiceSession> {
  const session = await usableSessionOf(deps, viewer, sessionId);
  const step = session.chain.then(() => {
    for (const item of session.items) finish(deps, live, session, item);
    if (end) session.ended = true;
  });
  session.chain = step;
  await step;
  return toDto(deps, session);
}

// ── The answer ───────────────────────────────────────────────────────────

/** The status of the session's requests to the AI, by id. */
async function proposalStates(
  deps: AppDeps,
  session: Session,
): Promise<Map<string, WriterAiState>> {
  const ids = [
    ...new Set(session.items.flatMap((item) => (item.proposalId ? [item.proposalId] : []))),
  ];
  if (ids.length === 0) return new Map();
  const rows = await deps.db
    .select({ id: documentAiProposals.id, status: documentAiProposals.status })
    .from(documentAiProposals)
    .where(inArray(documentAiProposals.id, ids));
  return new Map(rows.map((row) => [row.id, row.status]));
}

function stateOf(item: ItemRecord, states: ReadonlyMap<string, WriterAiState>): VoiceItemState {
  // Taken up by an addition: shows how that one goes.
  if (item.supersededBy) return stateOf(item.supersededBy, states);
  switch (item.phase) {
    case 'draft':
      return 'draft';
    case 'queued':
      return 'queued';
    case 'comment':
      return 'comment';
    case 'dropped':
      return 'dropped';
    case 'failed':
      return 'failed';
    case 'asked': {
      const status = item.proposalId ? states.get(item.proposalId) : undefined;
      if (status === 'running') return 'working';
      if (status === 'applied') return 'applied';
      if (status === 'answered') return 'answered';
      if (status === 'reverted') return 'reverted';
      return 'failed';
    }
  }
}

const STATUS_WORDS: Record<VoiceItemState, string> = {
  draft: 'being said',
  queued: 'finished, waiting for the AI',
  working: 'finished, the AI works on it',
  applied: 'finished, the AI changed the text',
  answered: 'finished, the AI answered without a change',
  comment: 'finished (a comment only)',
  failed: 'finished, the AI failed',
  dropped: 'taken back',
  reverted: 'finished, its change taken back',
};

async function toDto(deps: AppDeps, session: Session): Promise<DocumentVoiceSession> {
  const states = await proposalStates(deps, session);
  const now = deps.clock.now().getTime();
  session.commands = session.commands.filter((entry) => now - entry.at < COMMAND_TTL_MS);
  const items: DocumentVoiceItem[] = session.items.map((item) => ({
    commentId: item.commentId,
    threadId: item.threadId,
    paragraphId: item.paragraphId,
    text: item.text,
    state: stateOf(item, states),
    proposalId: (item.supersededBy ?? item).proposalId,
    note: item.note,
    segments: item.segments,
    createdAt: item.createdAt.toISOString(),
  }));
  return {
    id: session.id,
    documentId: session.documentId,
    aiEdits: session.aiEdits,
    aiEditsReason: session.aiEditsReason,
    speechService: session.speechService,
    items,
    segments: session.segments.slice(-SEGMENTS_SHOWN).map((segment) => ({
      seq: segment.seq,
      text: segment.text,
      status: segment.status,
      error: segment.error,
      seqs: [...segment.seqs],
      heard: segment.heard,
    })),
    commands: session.commands.map(({ id, command: voiceCommand }) => ({
      id,
      command: voiceCommand,
    })),
    pending: session.pending,
    ended: session.ended,
  };
}

/** For tests: no session left over. */
export function endAllDocumentVoiceSessions() {
  sessions.clear();
}
