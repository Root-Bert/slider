import { inArray } from 'drizzle-orm';
import {
  AI_RUNNING_LIMIT_MS,
  rectArea,
  shapeRefForRect,
  type AiProposal,
  type Anchor,
  type Slide,
  type Viewer,
  type VoiceCommand,
  type VoiceItem,
  type VoiceLive,
  type VoiceItemState,
  type VoiceSegmentMeta,
  type VoiceSegmentResult,
  type VoiceSession,
} from '@slider/shared';
import { requireDeckAccess } from '../../auth/access';
import { aiProposals, type DeckRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError, badRequest, forbidden, notFound } from '../../http/errors';
import { deckDesign, uniqueGuides } from '../ai-context';
import {
  applyQuickProposal,
  asksForVariant,
  cancelProposal,
  createProposal,
  QuickMisfit,
  revertProposal,
} from '../ai-proposals';
import {
  failureMessage,
  isProviderError,
  liveTranscriptionToken,
  providerName,
  refusesKey,
  runToolCall,
  transcribe,
  type AiConnection,
} from '../ai-providers';
import { createComment, deleteComment, updateComment } from '../comments';
import { editTarget, fileSlides } from '../edits';
import {
  markKeyRefused,
  workspaceAiConnection,
  workspaceLiveConnection,
  workspaceVoiceConnection,
} from '../integration-keys';
import { listSlides } from '../slides';
import {
  isArtefact,
  MAX_COMMENT_CHARS,
  readActions,
  ROUTER_SYSTEM,
  ROUTER_TOOL,
  routerPrompt,
  type RouterAction,
  type RouterEditing,
  type RouterItem,
} from './router';
import {
  placesAgree,
  quickOperations,
  quickSummary,
  readQuickEdits,
  type QuickEdit,
} from './quick-edits';

/*
 * A session of speaking to the AI (see `@slider/shared` voice). Kept in memory: it lives as long
 * as the person speaks; the comments it makes are ordinary comments in the database. A server
 * restart ends it – the browser starts a new one.
 */

/** A session nobody used this long is gone. */
const IDLE_LIMIT_MS = 30 * 60_000;
/** Sessions one account may have at once (other tabs, other decks). */
const MAX_SESSIONS_PER_USER = 3;
/** Pieces and commands a session hands back – the latest. */
const SEGMENTS_SHOWN = 30;
const COMMAND_TTL_MS = 60_000;
/** How often a request to the AI is looked at while the next one of its slide waits. */
const PROPOSAL_POLL_MS = 1_000;
/** Pieces transcribed at once per session (they come one after another anyway). */
const TRANSCRIBE_TIMEOUT_MS = 90_000;
/** What the router may write. */
const ROUTER_MAX_TOKENS = 4_000;
/** The deck's design (margins, colours) told the router is read again after this long. */
const DESIGN_TTL_MS = 60_000;
/** The words speech recognition is told to expect, at most this long. */
const MAX_PROMPT_CHARS = 600;
/** Words of a review speech to text should know – German, with the English design words mixed in. */
const VOCABULARY = [
  'Slider',
  'Folie',
  'Slide',
  'Präsentation',
  'Kommentar',
  'Titel',
  'Überschrift',
  'fett',
  'kursiv',
  'größer',
  'kleiner',
  'Schrift',
  'Font',
  'Farbe',
  'Bild',
  'Diagramm',
  'Shapes',
  'alignen',
  'ausrichten',
  'zentrieren',
  'horizontal',
  'vertikal',
  'Abstand',
  'verteilen',
  'Layout',
];

interface SegmentRecord extends Omit<VoiceSegmentResult, 'seqs'> {
  startMs: number;
  endMs: number;
  /** The slide in front when it ended. */
  slideId: string | null;
  /** The pieces heard together with it (itself first) – its text stands for all of them. */
  seqs: number[];
  /** How long speech to text took for it, ms. */
  heardMs?: number;
}

/** A piece waiting for speech to text. */
interface WaitingPiece {
  meta: VoiceSegmentMeta;
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
  slideId: string | null;
  /** Where on the slide, in words for the router. */
  place: string;
  /** The elements it is about (none: the slide as a whole, or between slides). */
  elements: string[];
  text: string;
  /** Plain changes the router gave with it: made at once, without the AI at work. */
  edits: QuickEdit[] | null;
  /** Its request to the AI is done (made at once, or the AI finished). */
  settled: boolean;
  /** `draft` until finished; then queued, asked (`asked`), or a comment only. */
  phase: 'draft' | 'queued' | 'asked' | 'comment' | 'dropped' | 'failed';
  proposalId: string | null;
  note: string | null;
  segments: number[];
  hasRecording: boolean;
  /** Its additions (replies) not yet asked about: they are asked with it. */
  additions: ItemRecord[];
  /** Taken up by an addition asked after it (its own request was stopped for that). */
  supersededBy: ItemRecord | null;
  createdAt: Date;
}

interface Session {
  id: string;
  deck: DeckRow;
  viewer: Viewer;
  aiEdits: boolean;
  aiEditsReason: string | null;
  /** Who turns the speech into text, by name. */
  speechService: string;
  items: ItemRecord[];
  segments: SegmentRecord[];
  commands: { id: number; command: VoiceCommand; at: number }[];
  /** Pieces are decided on one after another, in the order they came. */
  chain: Promise<void>;
  /**
   * Pieces waiting for speech to text while it hears others: heard together next, in one
   * request – a slow speech to text (one on the server's own CPU) never falls further behind.
   */
  waiting: WaitingPiece[];
  hearing: boolean;
  /**
   * Requests to the AI at work or waiting: one about the same elements of a slide as an earlier
   * one (or about the slide as a whole) waits for it – it sees what that one changed –, others
   * go at once, side by side.
   */
  jobs: Job[];
  /** Changes made at once go one after another (each in a second or two). */
  quickChain: Promise<void>;
  /** The deck's design as last read, for the router. */
  design: { at: number; value: Pick<RouterEditing, 'margins' | 'guides' | 'palette'> } | null;
  pending: number;
  ended: boolean;
  lastUsed: number;
}

interface Job {
  slideId: string;
  /** `null`: the slide as a whole. */
  elements: ReadonlySet<string> | null;
  done: Promise<void>;
}

const sessions = new Map<string, Session>();
let commandCount = 0;

/** Sessions nobody used for a while: gone. */
function sweep(now: number) {
  for (const [id, session] of sessions) {
    if (now - session.lastUsed > IDLE_LIMIT_MS) sessions.delete(id);
  }
}

function sessionOf(deps: AppDeps, viewer: Viewer, sessionId: string): Session {
  const now = deps.clock.now().getTime();
  sweep(now);
  const session = sessions.get(sessionId);
  if (!session) throw notFound('Diese Sprech-Sitzung ist vorbei. Bitte neu starten.');
  if (session.viewer.author.id !== viewer.author.id)
    throw forbidden('Das ist nicht deine Sitzung.');
  session.lastUsed = now;
  return session;
}

/**
 * sessionOf, and its person may still comment on the deck – removed from it meanwhile, the
 * session ends: no more of the workspace's speech and AI keys spent, no slide titles read.
 */
async function usableSessionOf(deps: AppDeps, viewer: Viewer, sessionId: string): Promise<Session> {
  const session = sessionOf(deps, viewer, sessionId);
  try {
    await requireDeckAccess(deps, viewer, session.deck.id, 'comment');
  } catch (error) {
    sessions.delete(session.id);
    throw error;
  }
  return session;
}

// ── Starting ─────────────────────────────────────────────────────────────

/**
 * Starts speaking to the AI on a deck: needs the right to comment, speech to text and an AI in
 * the workspace (it decides what the speech is). Whether finished comments also go to the AI
 * depends on the right to edit the deck.
 */
export async function startVoiceSession(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<VoiceSession> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'comment');
  const [speech, ai] = await Promise.all([
    workspaceVoiceConnection(deps, deck.workspaceId),
    workspaceAiConnection(deps, deck.workspaceId),
  ]);
  if (!speech.connection) throw new ApiError(409, 'speech_not_configured', speech.error);
  if (!ai.connection) throw new ApiError(409, 'ai_not_configured', ai.error);
  let aiEditsReason: string | null = null;
  try {
    await editTarget(deps, viewer, deckId);
  } catch (error) {
    aiEditsReason =
      error instanceof ApiError && error.status !== 404 && error.status !== 403
        ? `${error.message} Deine Kommentare bleiben Kommentare.`
        : 'Die KI ändern lassen kann nur, wer die Präsentation verwaltet – deine Kommentare bleiben Kommentare.';
  }

  const now = deps.clock.now().getTime();
  sweep(now);
  const own = [...sessions.values()]
    .filter((session) => session.viewer.author.id === viewer.author.id)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  // The oldest of too many goes – a tab closed without ending its session.
  while (own.length >= MAX_SESSIONS_PER_USER) sessions.delete(own.shift()!.id);
  const session: Session = {
    id: crypto.randomUUID(),
    deck,
    viewer,
    aiEdits: aiEditsReason === null,
    aiEditsReason,
    speechService: providerName(speech.connection),
    items: [],
    segments: [],
    commands: [],
    chain: Promise.resolve(),
    waiting: [],
    hearing: false,
    jobs: [],
    quickChain: Promise.resolve(),
    design: null,
    pending: 0,
    ended: false,
    lastUsed: now,
  };
  sessions.set(session.id, session);
  if (session.aiEdits) {
    // The file's slides read ahead (and remembered): the first piece need not wait for them.
    void editTarget(deps, viewer, deckId)
      .then((target) => fileSlides(deps, target.revision.pptxKey))
      .catch(() => undefined);
  }
  return toDto(deps, session);
}

export async function getVoiceSession(
  deps: AppDeps,
  viewer: Viewer,
  sessionId: string,
): Promise<VoiceSession> {
  return toDto(deps, await usableSessionOf(deps, viewer, sessionId));
}

// ── The words live ───────────────────────────────────────────────────────

/** Words the live stream is told to listen for, at most (Mistral's limit). */
const MAX_LIVE_TERMS = 100;

/**
 * Where the browser streams the microphone to show the words as they are spoken – a token for the
 * workspace's `live` key, asked anew for each connection. `null` without one, or when the service
 * gives none: then only what `voice` heard of the pieces is shown.
 */
export async function liveVoiceToken(
  deps: AppDeps,
  viewer: Viewer,
  sessionId: string,
): Promise<VoiceLive> {
  const session = await usableSessionOf(deps, viewer, sessionId);
  if (session.ended) return null;
  const live = await workspaceLiveConnection(deps, session.deck.workspaceId);
  if (!live || live.connection.provider !== 'mistral') return null;
  const slides = await listSlides(deps.db, session.deck);
  const terms = [
    ...new Set(
      [...VOCABULARY, session.deck.title, ...slides.map((slide) => slide.title ?? '')]
        .map((term) => term.replace(/\s+/g, ' ').trim())
        .filter((term) => term && term.length <= 100),
    ),
  ].slice(0, MAX_LIVE_TERMS);
  try {
    const token = await liveTranscriptionToken(deps, live.connection);
    return { provider: 'mistral', ...token, terms };
  } catch (error) {
    if (refusesKey(error)) {
      await markKeyRefused(deps, live.keyId, 'Der Dienst hat den Key abgelehnt.');
    }
    deps.log.warn('Voice: no live transcription token', error);
    return null;
  }
}

// ── A piece of speech ────────────────────────────────────────────────────

/**
 * A piece of speech: heard as soon as speech to text is free – together with the others that
 * waited meanwhile – and decided on after the pieces before it. Answers once it is decided on,
 * with the session as it is then.
 */
export async function addVoiceSegment(
  deps: AppDeps,
  viewer: Viewer,
  sessionId: string,
  meta: VoiceSegmentMeta,
  audio: Uint8Array,
): Promise<VoiceSession> {
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
    slideId: meta.context.activeSlideId,
    seqs: [meta.seq],
    heard: false,
  };
  session.segments.push(record);
  session.segments.sort((a, b) => a.seq - b.seq);
  session.pending += 1;
  const live = meta.liveText?.trim();
  if (live) {
    // The live words are there already: decided on at once, after the pieces before – speech to
    // text only makes them accurate afterwards (the caption, the raw words the AI reads).
    record.text = live;
    const step = session.chain.then(() =>
      decideOn(deps, session, record, meta, live).finally(() => {
        session.pending -= 1;
      }),
    );
    session.chain = step;
    session.waiting.push({ meta, audio, record, done: () => undefined, decided: true });
    hearNext(deps, session);
    await step;
    return toDto(deps, session);
  }
  await new Promise<void>((done) => {
    session.waiting.push({ meta, audio, record, done, decided: false });
    hearNext(deps, session);
  });
  return toDto(deps, session);
}

/** A piece's words decided on – nothing when they are no words, why when it fails. */
async function decideOn(
  deps: AppDeps,
  session: Session,
  record: SegmentRecord,
  meta: VoiceSegmentMeta,
  text: string,
) {
  try {
    if (isArtefact(text)) {
      record.status = 'empty';
      return;
    }
    const decidingAt = Date.now();
    const actions = await decide(deps, session, record, meta, text);
    deps.log.info(
      `Voice ${session.id}: ${(meta.endMs - meta.startMs) / 1000} s of speech ${record.heard ? `heard in ${record.heardMs ?? '?'} ms` : 'decided on its live words'}, decided in ${Date.now() - decidingAt} ms: ${actions.join(', ') || 'nothing'}`,
    );
  } catch (error) {
    record.status = 'failed';
    record.heard = true;
    record.error = await problemOf(deps, session, error);
  }
}

/** The pieces waiting, heard as one, once speech to text is free; decided on in turn. */
function hearNext(deps: AppDeps, session: Session) {
  if (session.hearing || session.waiting.length === 0) return;
  session.hearing = true;
  // Heard together: pieces of one kind – decided on already, or waiting for their words.
  session.waiting.sort((a, b) => a.meta.seq - b.meta.seq);
  const kind = session.waiting[0]!.decided;
  const count = session.waiting.findIndex((piece) => piece.decided !== kind);
  const batch = session.waiting.splice(0, count === -1 ? session.waiting.length : count);
  const first = batch[0]!;
  const others = batch.slice(1);
  // Heard together: the first piece's record stands for all of them.
  for (const piece of others) {
    session.segments = session.segments.filter((segment) => segment !== piece.record);
    first.record.seqs.push(piece.meta.seq);
  }
  first.record.endMs = batch.at(-1)!.meta.endMs;
  const meta = mergedMeta(batch.map((piece) => piece.meta));
  first.record.slideId = meta.context.activeSlideId;
  const hearingAt = Date.now();
  const heard = hear(deps, session, meta, joinedWav(batch.map((piece) => piece.audio))).then(
    (text) => {
      first.record.heardMs = Date.now() - hearingAt;
      return text;
    },
  );
  void heard
    .catch(() => undefined)
    .finally(() => {
      session.hearing = false;
      hearNext(deps, session);
    });
  const { record } = first;
  if (kind) {
    // Decided on its live words: the accurate text takes their place – or, when speech to text
    // fails, the live words stay.
    const live = batch.map((piece) => piece.meta.liveText?.trim() ?? '').join(' ');
    record.text = live;
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
      await decideOn(deps, session, record, meta, text);
    } catch (error) {
      record.status = 'failed';
      record.heard = true;
      record.error = await problemOf(deps, session, error);
    } finally {
      session.pending -= batch.length;
    }
  });
  session.chain = step;
  void step.finally(() => {
    for (const piece of batch) piece.done();
  });
}

/** Several pieces' context as one: the slides and pointer places summed, the last pick. */
function mergedMeta(metas: readonly VoiceSegmentMeta[]): VoiceSegmentMeta {
  if (metas.length === 1) return metas[0]!;
  const slides: { slideId: string; ms: number }[] = [];
  const pointer = new Map<string, VoiceSegmentMeta['context']['pointer'][number]>();
  for (const { context } of metas) {
    for (const entry of context.slides) {
      const known = slides.find((slide) => slide.slideId === entry.slideId);
      if (known) known.ms += entry.ms;
      else slides.push({ ...entry });
    }
    for (const entry of context.pointer) {
      const key = `${entry.slideId}\u0000${entry.shapeId ?? ''}`;
      const known = pointer.get(key);
      pointer.set(key, known ? { ...known, ms: known.ms + entry.ms } : { ...entry });
    }
  }
  const last = metas.at(-1)!;
  return {
    seq: metas[0]!.seq,
    startMs: metas[0]!.startMs,
    endMs: last.endMs,
    context: {
      slides,
      pointer: [...pointer.values()].sort((a, b) => b.ms - a.ms).slice(0, 20),
      selection: metas.findLast((meta) => meta.context.selection)?.context.selection ?? null,
      activeSlideId: last.context.activeSlideId,
    },
  };
}

/** Its text, by the workspace's speech to text, told the words the deck uses. */
async function hear(
  deps: AppDeps,
  session: Session,
  meta: VoiceSegmentMeta,
  audio: Uint8Array,
): Promise<string> {
  const speech = await workspaceVoiceConnection(deps, session.deck.workspaceId);
  if (!speech.connection) throw new ApiError(409, 'speech_not_configured', speech.error);
  session.speechService = providerName(speech.connection);
  const slides = await listSlides(deps.db, session.deck);
  const inFront = new Set(meta.context.slides.map((entry) => entry.slideId));
  const titles = slides
    .filter((slide) => inFront.has(slide.id) && slide.title)
    .map((slide) => slide.title!.replace(/\s+/g, ' ').trim());
  // What was said just before carries on: the same language, the same names.
  const before = session.segments
    .filter((segment) => segment.seq < meta.seq && segment.status === 'done')
    .at(-1)?.text;
  const prompt = [
    `${VOCABULARY.join(', ')}.`,
    session.deck.title,
    ...titles,
    before ? before.slice(-200) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_PROMPT_CHARS);
  try {
    return await transcribe(
      deps,
      speech.connection,
      { bytes: audio, name: `speech-${meta.seq}.wav`, type: 'audio/wav' },
      {
        prompt,
        terms: [...VOCABULARY, session.deck.title, ...titles],
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
        feature: 'voice',
      },
    );
  } catch (error) {
    if (refusesKey(error)) {
      await markKeyRefused(deps, speech.keyId, 'Der Dienst hat den Key abgelehnt.');
    }
    throw new SpeechProblem(error, speech.connection);
  }
}

/** Speech to text failed: said so, with the service's name. */
class SpeechProblem extends Error {
  constructor(
    override readonly cause: unknown,
    readonly connection: AiConnection,
  ) {
    super('speech to text failed');
  }
}

/** Why a piece came to nothing, for the person – in German. */
async function problemOf(deps: AppDeps, session: Session, error: unknown): Promise<string> {
  if (error instanceof SpeechProblem) {
    if (!isProviderError(error.cause)) deps.log.warn('Voice: piece not transcribed', error.cause);
    return `Nicht verstanden: ${failureMessage(error.cause, error.connection)}`;
  }
  if (error instanceof ApiError) return error.message;
  if (!isProviderError(error)) deps.log.warn(`Voice session ${session.id}: piece failed`, error);
  const ai = await workspaceAiConnection(deps, session.deck.workspaceId);
  return ai.connection
    ? failureMessage(error, ai.connection)
    : 'Da ist etwas schiefgelaufen. Bitte nochmal sagen.';
}

/** What the piece is – asked of the fast model – and done. */
async function decide(
  deps: AppDeps,
  session: Session,
  record: SegmentRecord,
  meta: VoiceSegmentMeta,
  text: string,
): Promise<string[]> {
  const ai = await workspaceAiConnection(deps, session.deck.workspaceId);
  if (!ai.connection) throw new ApiError(409, 'ai_not_configured', ai.error);
  const slides = await listSlides(deps.db, session.deck);
  const editing = await editingFor(deps, session, slides, meta);
  const numberOf = new Map(slides.map((slide, index) => [slide.id, index + 1]));
  const states = await proposalStates(deps, session);
  const items: RouterItem[] = session.items
    .filter((item) => item.phase !== 'dropped')
    .map((item) => ({
      label: item.label,
      slideNumber: item.slideId ? (numberOf.get(item.slideId) ?? null) : null,
      place: item.parent ? `addition to ${item.parent.label}` : item.place,
      text: item.text,
      status: statusWords(stateOf(item, states)),
    }));
  const history = session.segments
    .filter((segment) => segment.seq < record.seq && segment.status === 'done' && segment.text)
    .map((segment) => ({
      slideNumber: segment.slideId ? (numberOf.get(segment.slideId) ?? null) : null,
      text: segment.text,
    }));
  let input: unknown;
  try {
    input = await runToolCall(deps, ai.connection, {
      system: ROUTER_SYSTEM,
      tool: ROUTER_TOOL,
      user: routerPrompt({
        deckTitle: session.deck.title,
        slides,
        context: meta.context,
        items,
        history,
        text,
        durationMs: Math.max(0, meta.endMs - meta.startMs),
        editing,
      }),
      maxTokens: ROUTER_MAX_TOKENS,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
  } catch (error) {
    if (refusesKey(error)) {
      await markKeyRefused(deps, ai.keyId, 'Der Dienst hat den Key abgelehnt.');
    }
    throw error;
  }
  const actions = readActions(input);
  for (const action of actions) {
    try {
      await act(deps, session, action, record, meta, slides);
    } catch (error) {
      // One action that cannot be done (a comment deleted meanwhile) leaves the others.
      if (!(error instanceof ApiError)) throw error;
      record.error = error.message;
    }
  }
  return actions.map((action) =>
    [action.type, action.item, action.finished ? 'finished' : '', action.edits ? 'edits' : '']
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * What the router needs to give edits: the slides in front as the editor knows them, the page
 * and its design – `null` when the AI may not change the deck, or the file is not the deck's
 * slides as the session knows them (a new version came meanwhile).
 */
async function editingFor(
  deps: AppDeps,
  session: Session,
  slides: readonly Slide[],
  meta: VoiceSegmentMeta,
): Promise<RouterEditing | null> {
  if (!session.aiEdits) return null;
  try {
    const target = await editTarget(deps, session.viewer, session.deck.id);
    if (target.revision.id !== session.deck.currentRevisionId) return null;
    const file = await fileSlides(deps, target.revision.pptxKey);
    if (file.slides.length !== slides.length) return null;
    const inFront = new Set(meta.context.slides.map((entry) => entry.slideId));
    const editable = new Map(
      slides.flatMap((slide, index) =>
        inFront.has(slide.id) && file.slides[index]
          ? [[slide.id, file.slides[index]!] as const]
          : [],
      ),
    );
    const page = { width: file.pageSize.width, height: file.pageSize.height };
    const now = Date.now();
    if (!session.design || now - session.design.at > DESIGN_TTL_MS) {
      const design = await deckDesign(deps, target, {
        pageIds: file.slides.map((slide) => slide.pageId),
        guides: async () =>
          uniqueGuides(file.layoutGuides.flatMap((guides) => guides ?? file.snapLines)),
      });
      const grid = design.grid;
      session.design = {
        at: now,
        value: {
          margins: grid
            ? {
                left: (grid.columns.margin / page.width) * 100,
                right: (grid.columns.margin / page.width) * 100,
                top: (grid.rows.margin / page.height) * 100,
                bottom: (grid.rows.margin / page.height) * 100,
              }
            : null,
          guides: design.guides.map((guide) => ({
            orientation: guide.orientation,
            position: guide.position * 100,
          })),
          palette: design.palette,
        },
      };
    }
    return { slides: editable, page, ...session.design.value };
  } catch (error) {
    // Without it the router still makes comments – the AI does every change then.
    if (!(error instanceof ApiError)) deps.log.warn(`Voice ${session.id}: no edit context`, error);
    return null;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────

async function act(
  deps: AppDeps,
  session: Session,
  action: RouterAction,
  record: SegmentRecord,
  meta: VoiceSegmentMeta,
  slides: readonly Slide[],
) {
  const item = action.item ? itemByLabel(session, action.item) : null;
  switch (action.type) {
    case 'new': {
      if (!action.text) return;
      const created = await newItem(deps, session, action, meta, slides);
      if (!created) return;
      created.segments.push(...record.seqs);
      if (action.finished) finish(deps, session, created, readQuickEdits(action.edits));
      return;
    }
    case 'continue': {
      if (!item || !action.text) return;
      // Still a draft: the comment says it all now. Finished already: it is an addition.
      if (item.phase !== 'draft') return addTo(deps, session, item, action, record);
      await setText(deps, session, item, action.text);
      for (const seq of record.seqs) if (!item.segments.includes(seq)) item.segments.push(seq);
      if (action.finished) finish(deps, session, item, readQuickEdits(action.edits));
      return;
    }
    case 'finish': {
      if (item) finish(deps, session, item);
      return;
    }
    case 'add_to': {
      if (!item || !action.text) return;
      return addTo(deps, session, item, action, record);
    }
    // Taking back draws the slides anew: the next pieces need not wait for it.
    case 'drop': {
      if (item) inBackground(deps, session, drop(deps, session, item));
      return;
    }
    case 'undo': {
      if (item) inBackground(deps, session, undo(deps, session, item));
      return;
    }
    case 'go_to_slide': {
      const slide = action.slide ? slides[action.slide - 1] : undefined;
      if (slide) command(deps, session, { type: 'goToSlide', slideId: slide.id });
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

function command(deps: AppDeps, session: Session, voiceCommand: VoiceCommand) {
  const at = deps.clock.now().getTime();
  session.commands.push({ id: (commandCount += 1), command: voiceCommand, at });
}

const clipText = (text: string) => text.slice(0, MAX_COMMENT_CHARS);

/** A new comment where the router put it: on an element, on the slide, or between slides. */
async function newItem(
  deps: AppDeps,
  session: Session,
  action: RouterAction,
  meta: VoiceSegmentMeta,
  slides: readonly Slide[],
): Promise<ItemRecord | null> {
  const placed = placeOf(action, meta, slides);
  if (!placed) return null;
  const comment = await createComment(deps, session.viewer, session.deck.id, {
    slideId: placed.slideId,
    parentId: null,
    body: clipText(action.text!),
    anchor: placed.anchor,
    strokes: [],
  });
  const item: ItemRecord = {
    label: `K${session.items.length + 1}`,
    commentId: comment.id,
    threadId: comment.id,
    parent: null,
    slideId: placed.slideId ?? placed.queueSlideId,
    place: placed.place,
    elements: placed.elements,
    text: comment.body,
    edits: null,
    settled: false,
    phase: 'draft',
    proposalId: null,
    note: null,
    segments: [],
    hasRecording: false,
    additions: [],
    supersededBy: null,
    createdAt: deps.clock.now(),
  };
  session.items.push(item);
  return item;
}

interface Placement {
  /** The comment's slide (`null` between slides). */
  slideId: string | null;
  /** The slide its requests to the AI queue on. */
  queueSlideId: string | null;
  anchor: Anchor;
  place: string;
  elements: string[];
}

/** Room around the marked elements, as a share of the slide. */
const MARK_PAD = 0.012;

/**
 * Where a new comment goes. On elements: a box around all of them (a little room around), tied
 * to the largest, so it follows them; on the slide; or between slides.
 */
function placeOf(
  action: RouterAction,
  meta: VoiceSegmentMeta,
  slides: readonly Slide[],
): Placement | null {
  if (action.gap_after !== null && action.gap_after !== undefined) {
    const after = action.gap_after > 0 ? slides[action.gap_after - 1] : undefined;
    const before = slides[action.gap_after];
    if (!after && !before) return null;
    return {
      slideId: null,
      queueSlideId: (after ?? before)!.id,
      anchor: { type: 'gap', afterSlideId: after?.id ?? null, beforeSlideId: before?.id ?? null },
      place: 'between slides',
      elements: [],
    };
  }
  const slide =
    (action.slide ? slides[action.slide - 1] : undefined) ??
    slides.find((candidate) => candidate.id === meta.context.activeSlideId);
  if (!slide) return null;
  const ids = new Set([...(action.elements ?? []), ...(action.element ? [action.element] : [])]);
  const shapes = slide.shapes.filter((candidate) => ids.has(candidate.id));
  if (shapes.length === 0) {
    return {
      slideId: slide.id,
      queueSlideId: slide.id,
      anchor: { type: 'slide' },
      place: 'the slide',
      elements: [],
    };
  }
  const left = Math.max(0, Math.min(...shapes.map((shape) => shape.bbox.x)) - MARK_PAD);
  const top = Math.max(0, Math.min(...shapes.map((shape) => shape.bbox.y)) - MARK_PAD);
  const right = Math.min(
    1,
    Math.max(...shapes.map((shape) => shape.bbox.x + shape.bbox.w)) + MARK_PAD,
  );
  const bottom = Math.min(
    1,
    Math.max(...shapes.map((shape) => shape.bbox.y + shape.bbox.h)) + MARK_PAD,
  );
  const rect = { x: left, y: top, w: right - left, h: bottom - top };
  const largest = shapes.reduce((best, shape) =>
    rectArea(shape.bbox) > rectArea(best.bbox) ? shape : best,
  );
  return {
    slideId: slide.id,
    queueSlideId: slide.id,
    anchor: { type: 'rect', rect, shapeRef: shapeRefForRect(largest, rect) },
    place: `on ${shapes.length === 1 ? 'element' : 'elements'} ${shapes.map((shape) => shape.id).join(', ')}`,
    elements: shapes.map((shape) => shape.id),
  };
}

async function setText(deps: AppDeps, session: Session, item: ItemRecord, text: string) {
  const body = clipText(text);
  if (body === item.text) return;
  await updateComment(deps, session.viewer, item.commentId, { body });
  item.text = body;
}

/** An addition to a finished comment: a reply in its thread, asked about with it. */
async function addTo(
  deps: AppDeps,
  session: Session,
  target: ItemRecord,
  action: RouterAction,
  record: SegmentRecord,
) {
  // Additions go to the comment itself, not to another addition.
  const root = target.parent ?? target;
  // An addition still being said takes the new words.
  const open = root.additions.find((addition) => addition.phase === 'draft');
  if (open) {
    await setText(deps, session, open, `${open.text} ${action.text}`.trim());
    for (const seq of record.seqs) if (!open.segments.includes(seq)) open.segments.push(seq);
    if (action.finished !== false) finish(deps, session, open, readQuickEdits(action.edits));
    return;
  }
  const reply = await createComment(deps, session.viewer, session.deck.id, {
    slideId: null,
    parentId: root.threadId,
    body: clipText(action.text!),
    anchor: { type: 'slide' },
    strokes: [],
  });
  const item: ItemRecord = {
    label: `K${session.items.length + 1}`,
    commentId: reply.id,
    threadId: root.threadId,
    parent: root,
    slideId: root.slideId,
    place: root.place,
    elements: root.elements,
    text: reply.body,
    edits: null,
    settled: false,
    phase: 'draft',
    proposalId: null,
    note: null,
    segments: [...record.seqs],
    hasRecording: false,
    additions: [],
    supersededBy: null,
    createdAt: deps.clock.now(),
  };
  session.items.push(item);
  root.additions.push(item);
  // An addition is mostly said in one go; one cut off stays open for the next piece.
  if (action.finished !== false) finish(deps, session, item, readQuickEdits(action.edits));
}

/**
 * A comment said completely: made at once when the router gave plain `edits` for it, else to
 * the AI – after the earlier requests about the same elements.
 */
function finish(
  deps: AppDeps,
  session: Session,
  item: ItemRecord,
  edits: QuickEdit[] | null = null,
) {
  if (item.phase !== 'draft') return;
  // A variant asked for is a slide more: the AI's (add_variant), never edits of the slide itself.
  if (asksForVariant(item.text)) edits = null;
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
    // Its comment's change made, the addition as plain: made at once on top of it.
    if (edits && root.settled) {
      root.supersededBy = item;
      item.phase = 'queued';
      quick(deps, session, item, edits);
      return;
    }
    // Asked already and still at work: stopped, and asked again with the addition.
    if (root.proposalId && root.phase === 'asked') {
      root.supersededBy = item;
      if (!root.settled) {
        void cancelProposal(deps, session.viewer, session.deck.id, root.proposalId).catch(() => {
          // Done meanwhile: the addition is asked on top of its change.
        });
      }
    }
  }
  item.phase = 'queued';
  if (edits && !root) {
    quick(deps, session, item, edits);
    return;
  }
  enqueue(deps, session, root ?? item, () => ask(deps, session, item));
}

/**
 * Makes a comment's plain edits at once – after the session's other changes made so, not after
 * the AI at work: a request said next is made while it still works. Edits that no longer fit
 * the deck (an element gone, one the editor cannot change so) leave the request to the AI.
 */
function quick(deps: AppDeps, session: Session, item: ItemRecord, edits: QuickEdit[]) {
  item.edits = edits;
  const step = session.quickChain.then(async () => {
    if (item.phase !== 'queued') return;
    const startedAt = Date.now();
    try {
      const target = await editTarget(deps, session.viewer, session.deck.id);
      const file = await fileSlides(deps, target.revision.pptxKey);
      const margins = session.design?.value.margins;
      if (!placesAgree(edits, `${item.text} ${heardText(session, item)}`)) {
        throw new QuickMisfit('Die Richtung passt nicht zum Gesagten.');
      }
      // New elements go on the comment's slide – the file's slide at its place.
      const on = edits.some((edit) => edit.add || edit.copy_of)
        ? (await listSlides(deps.db, session.deck)).findIndex((slide) => slide.id === item.slideId)
        : 0;
      if (on === -1) throw new QuickMisfit('Die Folie ist nicht mehr da.');
      const operations = quickOperations(
        edits,
        file.slides,
        margins
          ? {
              left: margins.left / 100,
              top: margins.top / 100,
              right: 1 - margins.right / 100,
              bottom: 1 - margins.bottom / 100,
            }
          : null,
        { page: file.pageSize, on },
      );
      if (!operations) throw new QuickMisfit('Nicht als einfache Änderung machbar.');
      const proposal = await applyQuickProposal(
        deps,
        session.viewer,
        session.deck.id,
        { commentId: item.commentId, operations, summary: quickSummary(edits) },
        { heard: new Map([[item.commentId, heardText(session, item)]]) },
      );
      item.phase = 'asked';
      item.proposalId = proposal.id;
      item.settled = true;
      deps.log.info(
        `Voice ${session.id}: ${item.label} changed at once in ${Date.now() - startedAt} ms`,
      );
    } catch (error) {
      if (!(error instanceof QuickMisfit) && !(error instanceof ApiError)) throw error;
      // The AI does it – the whole request, after the earlier ones about the same elements.
      deps.log.info(`Voice ${session.id}: ${item.label} to the AI – ${error.message}`);
      item.edits = null;
      enqueue(deps, session, item.parent ?? item, () => ask(deps, session, item));
    }
  });
  session.quickChain = step.catch((error: unknown) => {
    deps.log.warn(`Voice session ${session.id}: not changed at once`, error);
    item.phase = 'failed';
    item.note = 'Die Änderung ließ sich nicht machen.';
  });
}

/**
 * A request to the AI, once the earlier ones about the same elements of its slide (or about the
 * slide as a whole) are done – others at work meanwhile go on beside it.
 */
function enqueue(deps: AppDeps, session: Session, item: ItemRecord, work: () => Promise<void>) {
  const slideId = item.slideId ?? 'deck';
  const elements = item.elements.length > 0 ? new Set(item.elements) : null;
  const overlaps = (other: Job) =>
    other.slideId === slideId &&
    (other.elements === null ||
      elements === null ||
      [...elements].some((id) => other.elements!.has(id)));
  const before = session.jobs.filter(overlaps).map((job) => job.done);
  const job: Job = {
    slideId,
    elements,
    done: Promise.all(before)
      .then(work)
      .catch((error: unknown) => deps.log.warn(`Voice session ${session.id}: AI not asked`, error)),
  };
  session.jobs.push(job);
  void job.done.finally(() => {
    session.jobs = session.jobs.filter((other) => other !== job);
  });
}

/** Asks the AI for an item – its latest addition is the request, the thread the context. */
async function ask(deps: AppDeps, session: Session, item: ItemRecord) {
  if (item.phase !== 'queued') return;
  const additions = item.parent
    ? []
    : item.additions.filter((addition) => addition.phase === 'queued');
  // Additions still being said wait: the request is asked once they are finished.
  const asking = additions.at(-1) ?? item;
  try {
    // What was heard, word for word, next to the cleaned-up comment: where the router misread a
    // misheard word, the AI may still see what was meant.
    const heard = new Map(
      [item, ...additions].map((said) => [said.commentId, heardText(session, said)] as const),
    );
    const proposal = await createProposal(
      deps,
      session.viewer,
      session.deck.id,
      { commentId: asking.commentId },
      { heard },
    );
    for (const asked of [item, ...additions]) {
      asked.phase = 'asked';
      asked.proposalId = proposal.id;
    }
    const startedAt = Date.now();
    await settled(deps, proposal.id);
    for (const asked of [item, ...additions]) asked.settled = true;
    deps.log.info(
      `Voice ${session.id}: ${item.label} done by the AI in ${Date.now() - startedAt} ms`,
    );
  } catch (error) {
    const note = error instanceof ApiError ? error.message : 'Die KI konnte nicht gefragt werden.';
    for (const asked of [item, ...additions]) {
      asked.phase = 'failed';
      asked.note = note;
    }
    if (!(error instanceof ApiError)) throw error;
  }
}

/** Waits until a request to the AI is done – the next one of its slide sees its change. */
async function settled(deps: AppDeps, proposalId: string) {
  const until = Date.now() + AI_RUNNING_LIMIT_MS + 60_000;
  while (Date.now() < until) {
    const [row] = await deps.db
      .select({ status: aiProposals.status })
      .from(aiProposals)
      .where(inArray(aiProposals.id, [proposalId]));
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
async function takeBackAll(deps: AppDeps, session: Session, proposalIds: readonly string[]) {
  if (proposalIds.length === 0) return;
  const rows = await deps.db
    .select({ id: aiProposals.id, status: aiProposals.status })
    .from(aiProposals)
    .where(inArray(aiProposals.id, [...proposalIds]));
  for (const id of proposalIds) {
    const status = rows.find((row) => row.id === id)?.status;
    if (status === 'running') {
      await cancelProposal(deps, session.viewer, session.deck.id, id).catch(() => undefined);
    } else if (status === 'applied') {
      await revertProposal(deps, session.viewer, session.deck.id, id);
    }
  }
}

/**
 * „Vergiss das“: the comment goes – the AI stopped first if it works on it, its changes (and
 * those of its additions) taken back if it made some.
 */
async function drop(deps: AppDeps, session: Session, item: ItemRecord) {
  const proposalIds = proposalsOf(item);
  // Gone for the session at once: not asked about any more, not named to the router.
  item.phase = 'dropped';
  for (const addition of item.additions) addition.phase = 'dropped';
  await takeBackAll(deps, session, proposalIds);
  await deleteComment(deps, session.viewer, item.commentId).catch((error: unknown) => {
    if (!(error instanceof ApiError)) throw error;
  });
}

/** „Mach das rückgängig“: the changes of the comment (and of its additions) taken back. */
async function undo(deps: AppDeps, session: Session, item: ItemRecord) {
  await takeBackAll(deps, session, proposalsOf(item));
}

// ── Pauses and the end ───────────────────────────────────────────────────

/**
 * The person paused for a while (or ends): comments still being said are finished – after the
 * pieces still on their way, which may go on with them.
 */
export async function flushVoiceSession(
  deps: AppDeps,
  viewer: Viewer,
  sessionId: string,
  { end = false }: { end?: boolean } = {},
): Promise<VoiceSession> {
  const session = await usableSessionOf(deps, viewer, sessionId);
  const step = session.chain.then(() => {
    for (const item of session.items) finish(deps, session, item);
    if (end) session.ended = true;
  });
  session.chain = step;
  await step;
  return toDto(deps, session);
}

// ── Recordings ───────────────────────────────────────────────────────────

/** What speech recognition heard of an item, as it heard it. */
function heardText(session: Session, item: ItemRecord): string {
  // Pieces heard together share one text: it comes once.
  return [
    ...new Set(
      item.segments.map(
        (seq) => session.segments.find((segment) => segment.seqs.includes(seq))?.text ?? '',
      ),
    ),
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** The item of a session a recording is for, with the text of its pieces. */
export function voiceItemForRecording(
  deps: AppDeps,
  viewer: Viewer,
  sessionId: string,
  commentId: string,
): { transcript: string; markRecorded: () => void } {
  const session = sessionOf(deps, viewer, sessionId);
  const item = session.items.find((candidate) => candidate.commentId === commentId);
  if (!item || item.phase === 'dropped')
    throw notFound('Diesen Kommentar gibt es in der Sitzung nicht.');
  return {
    transcript: heardText(session, item),
    markRecorded: () => {
      item.hasRecording = true;
    },
  };
}

// ── The answer ───────────────────────────────────────────────────────────

/** The status of the session's requests to the AI, by id. */
async function proposalStates(
  deps: AppDeps,
  session: Session,
): Promise<Map<string, AiProposal['status']>> {
  const ids = [
    ...new Set(session.items.flatMap((item) => (item.proposalId ? [item.proposalId] : []))),
  ];
  if (ids.length === 0) return new Map();
  const rows = await deps.db
    .select({ id: aiProposals.id, status: aiProposals.status, error: aiProposals.error })
    .from(aiProposals)
    .where(inArray(aiProposals.id, ids));
  return new Map(rows.map((row) => [row.id, row.status]));
}

function stateOf(
  item: ItemRecord,
  states: ReadonlyMap<string, AiProposal['status']>,
): VoiceItemState {
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
      if (status === 'ready') return 'answered';
      if (status === 'reverted') return 'reverted';
      return 'failed';
    }
  }
}

const STATUS_WORDS: Record<VoiceItemState, string> = {
  draft: 'being said',
  queued: 'finished, waiting for the AI',
  working: 'finished, the AI works on it',
  applied: 'finished, the AI changed the slides',
  answered: 'finished, the AI answered without a change',
  comment: 'finished (a comment only)',
  failed: 'finished, the AI failed',
  dropped: 'taken back',
  reverted: 'finished, its change taken back',
};
const statusWords = (state: VoiceItemState) => STATUS_WORDS[state];

async function toDto(deps: AppDeps, session: Session): Promise<VoiceSession> {
  const states = await proposalStates(deps, session);
  const now = deps.clock.now().getTime();
  session.commands = session.commands.filter((entry) => now - entry.at < COMMAND_TTL_MS);
  const items: VoiceItem[] = session.items.map((item) => ({
    commentId: item.commentId,
    threadId: item.threadId,
    slideId: item.slideId,
    text: item.text,
    state: stateOf(item, states),
    proposalId: (item.supersededBy ?? item).proposalId,
    note: item.note,
    segments: item.segments,
    hasRecording: item.hasRecording,
    createdAt: item.createdAt.toISOString(),
  }));
  return {
    id: session.id,
    deckId: session.deck.id,
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

/**
 * The samples of the WAV the browser makes of a piece (`RIFF….WAVE`, 16-bit PCM, mono) and its
 * rate – `null` for anything else.
 */
function pcmOf(bytes: Uint8Array): { rate: number; data: Uint8Array } | null {
  const text = (offset: number, value: string) =>
    [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (bytes.byteLength < 44 || !text(0, 'RIFF') || !text(8, 'WAVE')) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const size = view.getUint32(offset + 4, true);
    if (text(offset, 'fmt ')) {
      const pcm = view.getUint16(offset + 8, true) === 1;
      const mono = view.getUint16(offset + 10, true) === 1;
      const bits = view.getUint16(offset + 22, true) === 16;
      if (!pcm || !mono || !bits) return null;
      rate = view.getUint32(offset + 12, true);
    } else if (text(offset, 'data')) {
      if (!rate) return null;
      return {
        rate,
        data: bytes.subarray(offset + 8, Math.min(bytes.byteLength, offset + 8 + size)),
      };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Pieces as one WAV, a short silence between them. */
function joinedWav(pieces: readonly Uint8Array[]): Uint8Array {
  if (pieces.length === 1) return pieces[0]!;
  const parts = pieces.map((piece) => pcmOf(piece)!);
  const rate = parts[0]!.rate;
  const gap = Math.round(rate * 0.3) * 2;
  const length =
    parts.reduce((total, part) => total + part.data.byteLength, 0) + gap * (parts.length - 1);
  const bytes = new Uint8Array(44 + length);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      bytes[offset + index] = value.charCodeAt(index);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, length, true);
  let offset = 44;
  for (const [index, part] of parts.entries()) {
    if (index > 0) offset += gap;
    bytes.set(part.data, offset);
    offset += part.data.byteLength;
  }
  return bytes;
}

/** For tests: no session left over. */
export function endAllVoiceSessions() {
  sessions.clear();
}
