import { z } from 'zod';
import type { SlideOperation } from './editing';
import { pointSchema, type Author } from './model';

/**
 * Realtime in the viewer (BER-104): who is in a deck right now, on which slide, where their
 * pointer is, which comment they have open – and a nudge when comments changed. Server → client over SSE
 * (`GET /decks/:deckId/live`), client → server as small posts (`POST /live/:connectionId`).
 */

const liveId = z.string().min(1).max(200);

/**
 * Pointer position over a slide, normalised to its box (like comment anchors) – every viewer
 * lays the deck out for its own window, so plain pixels would land elsewhere. Off the slides the
 * cursor is hidden.
 */
export const liveCursorSchema = z.object({ slideId: liveId, point: pointSchema });
export type LiveCursor = z.infer<typeof liveCursorSchema>;

// ── Typing together (`@slider/shared/live-text`) ────────────────────────────

/** Largest update one post may carry (base64): a long paste of the most text an element holds. */
export const MAX_LIVE_TEXT_UPDATE = 512 * 1024;

const base64 = z
  .string()
  .max(MAX_LIVE_TEXT_UPDATE)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);

/**
 * The way a shared text is kept (`@slider/shared/live-text`): an editor and the server type
 * together only when they agree on it – an editor from before an update types alone until reloaded.
 */
export const LIVE_TEXT_VERSION = 2;

/**
 * One editor typing in a text (its open text box): a tab may open the same text twice for a
 * moment (closed and opened again), each joins and leaves on its own.
 */
const liveTextMember = z.string().min(1).max(100);

/** What a shared text started from (`liveTextDoc`'s `start`): equal ones merge. */
const liveTextStart = z.string().max(40);

/** `POST /live/:key/text/:elementId/join` – an editor starts typing in a text with the others. */
export const liveTextJoinInputSchema = z.object({
  version: z.literal(LIVE_TEXT_VERSION),
  member: liveTextMember,
  /** What the editor's text started from (`liveTextDoc`'s `start`). */
  start: liveTextStart,
  /** What the editor's text has (a Y state vector): only the rest comes back. */
  state: base64,
});

export const liveTextJoinSchema = z.object({
  /**
   * The shared text (a Y update): what `state` does not have yet – all of it when it started
   * from another `start` than the editor's (the file changed meanwhile).
   */
  update: z.string(),
  /** What the shared text started from: the editor's start, or another (its text is carried over). */
  start: liveTextStart,
  /** What the shared text has (a Y state vector): the editor sends only the rest. */
  state: z.string(),
});
export type LiveTextJoin = z.infer<typeof liveTextJoinSchema>;

/** `POST /live/:key/text/:elementId` – what this editor typed (a Y update). */
export const liveTextUpdateInputSchema = z.object({ member: liveTextMember, update: base64 });

/** `POST /live/:key/text/:elementId/leave` – that editor stopped typing in the text. */
export const liveTextLeaveInputSchema = z.object({ member: liveTextMember });

/**
 * Where someone's caret is in the text they type in: Y relative positions (base64), which stay
 * on their character whatever is typed around it.
 */
export const liveTextCaretSchema = z.object({
  elementId: z.string().min(1).max(100),
  anchor: base64.max(1000),
  head: base64.max(1000),
});
export type LiveTextCaret = z.infer<typeof liveTextCaretSchema>;

/** Where an element someone drags is right now (shares of the slide, degrees) – no step yet. */
export const liveDragSchema = z.object({
  elementId: z.string().min(1).max(100),
  x: z.number().min(-10).max(10),
  y: z.number().min(-10).max(10),
  w: z.number().min(0).max(20),
  h: z.number().min(0).max(20),
  rotation: z.number().min(-720).max(720),
});
export type LiveDrag = z.infer<typeof liveDragSchema>;

/** What a viewer reports about itself. */
export const livePresenceInputSchema = z.object({
  activeSlideId: liveId.nullable(),
  /** `null`: the pointer is not over a slide. */
  cursor: liveCursorSchema.nullable(),
  /** The comment thread they have selected (expanded card or thread panel). */
  focusedThreadId: liveId.nullable(),
  /** Their caret in the text they type in; `null` (or left out): they type in none. */
  textCaret: liveTextCaretSchema.nullable().default(null),
  /** The element they have picked in Bearbeiten; `null` (or left out): none. */
  picked: z.string().min(1).max(100).nullable().default(null),
  /** The element they drag, resize or turn, where it is now; `null` (or left out): none. */
  drag: liveDragSchema.nullable().default(null),
});
export type LivePresenceInput = z.infer<typeof livePresenceInputSchema>;

/** One open viewer (a browser tab) – the same person may be here twice. */
export interface LivePeer extends LivePresenceInput {
  /** Public id of the connection – not the secret key its own `hello` carries. */
  connectionId: string;
  author: Author;
}

export type LiveEvent =
  /**
   * First event of a stream: your connection's secret key (for posting presence and goodbye; the
   * others know you by a different, public id) and who is here.
   */
  | { type: 'hello'; connectionId: string; peers: LivePeer[] }
  /** Someone joined, moved, switched slides or opened a comment. */
  | { type: 'peer'; peer: LivePeer }
  | { type: 'leave'; connectionId: string }
  /** Comments of the deck changed (new, edited, resolved, deleted) – refetch them. */
  | { type: 'comments' }
  /**
   * The deck was edited in Slider (BER-180): its slides and edit state changed – refetch them. A
   * new step brings what it did (`step`): the editors there show it at once, before the refetch.
   */
  | { type: 'slides'; step?: LiveStep }
  /** An AI proposal of the deck started, finished or was taken (BER-183) – refetch them. */
  | { type: 'proposals' }
  /** Someone typed in a text others type in too: a Y update of its shared text. */
  | { type: 'text'; elementId: string; update: string };

/** A new step as the editors see it at once: its number, its operations, whose edit it was. */
export interface LiveStep {
  seq: number;
  operations: SlideOperation[];
  /** The editor's own id for the edit (`clientEditId`) – its own tab knows it; `null`: the AI's. */
  clientEditId: string | null;
}

/** SSE event name all {@link LiveEvent}s are sent under. */
export const LIVE_EVENT = 'live';

/** Clients re-post their presence this often while idle, so the server knows they're still there. */
export const LIVE_HEARTBEAT_MS = 15_000;
