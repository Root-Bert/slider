import { z } from 'zod';
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

/** What a viewer reports about itself. */
export const livePresenceInputSchema = z.object({
  activeSlideId: liveId.nullable(),
  /** `null`: the pointer is not over a slide. */
  cursor: liveCursorSchema.nullable(),
  /** The comment thread they have selected (expanded card or thread panel). */
  focusedThreadId: liveId.nullable(),
});
export type LivePresenceInput = z.infer<typeof livePresenceInputSchema>;

/** One open viewer (a browser tab) – the same person may be here twice. */
export interface LivePeer extends LivePresenceInput {
  connectionId: string;
  author: Author;
}

export type LiveEvent =
  /** First event of a stream: your connection id (the key for posting presence) and who is here. */
  | { type: 'hello'; connectionId: string; peers: LivePeer[] }
  /** Someone joined, moved, switched slides or opened a comment. */
  | { type: 'peer'; peer: LivePeer }
  | { type: 'leave'; connectionId: string }
  /** Comments of the deck changed (new, edited, resolved, deleted) – refetch them. */
  | { type: 'comments' };

/** SSE event name all {@link LiveEvent}s are sent under. */
export const LIVE_EVENT = 'live';

/** Clients re-post their presence this often while idle, so the server knows they're still there. */
export const LIVE_HEARTBEAT_MS = 15_000;
