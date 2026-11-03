import { z } from 'zod';

/**
 * Live comments on the product website (bertro.dev/slider): visitors see each other's pointers
 * and leave short comments anywhere on a page. Nothing is stored – a comment lives
 * {@link SITE_COMMENT_TTL_MS} after the last time someone touched it (opened, hovered, answered).
 * Server → browser over SSE (`GET /site-live?page=…`), browser → server as small posts
 * (`POST /site-live/:key`). The website imports only the types (no zod in its bundle).
 */

/** How long a comment stays without anyone touching it. */
export const SITE_COMMENT_TTL_MS = 30_000;
export const SITE_COMMENT_MAX_LENGTH = 280;
/** How often an open page says it is still there; silent for 2.5 × this, it is dropped. */
export const SITE_HEARTBEAT_MS = 20_000;
export const SITE_NAME_MAX_LENGTH = 24;
/** The page's sections a position is relative to (`data-live` on the website). */
const anchor = z.string().regex(/^[a-z0-9-]{1,40}$/);
/** Share of the anchor's box, so every window size puts it on the same spot. */
const share = z.number().min(-0.5).max(1.5);
const siteColor = z.enum(['blue', 'violet', 'green', 'yellow', 'cyan']);
export type SiteColor = z.infer<typeof siteColor>;

const name = z.string().trim().min(1).max(SITE_NAME_MAX_LENGTH);
const text = z.string().trim().min(1).max(SITE_COMMENT_MAX_LENGTH);

export const siteLiveInputSchema = z.discriminatedUnion('type', [
  /** The pointer moved; `a: null` = off every section (hidden for the others). */
  z.object({ type: z.literal('move'), a: anchor.nullable(), x: share, y: share }),
  /** `w`/`h`: a box drawn from (x, y), as shares of the section like the corner. */
  z.object({
    type: z.literal('comment'),
    a: anchor,
    x: share,
    y: share,
    w: z.number().min(0).max(2).optional(),
    h: z.number().min(0).max(2).optional(),
    text,
  }),
  z.object({ type: z.literal('reply'), id: z.string().max(40), text }),
  /** Someone opened, hovered or types under a comment: it stays another full TTL. */
  z.object({ type: z.literal('touch'), id: z.string().max(40) }),
  z.object({ type: z.literal('name'), name }),
  /** Still here (every {@link SITE_HEARTBEAT_MS}): closed streams aren't always reported. */
  z.object({ type: z.literal('here') }),
  z.object({ type: z.literal('bye') }),
]);
export type SiteLiveInput = z.infer<typeof siteLiveInputSchema>;

export interface SiteVisitor {
  id: string;
  name: string;
  color: SiteColor;
}

export interface SiteReply {
  id: string;
  by: SiteVisitor;
  text: string;
}

export interface SiteComment {
  id: string;
  by: SiteVisitor;
  a: string;
  x: number;
  y: number;
  /** Size of the box drawn around what is meant; none for a plain pin. */
  w?: number;
  h?: number;
  text: string;
  replies: SiteReply[];
  /** Milliseconds left until it goes (the browser counts down from its own clock). */
  left: number;
}

export interface SitePointer {
  id: string;
  a: string | null;
  x: number;
  y: number;
}

export type SiteLiveEvent =
  /** First event on a stream: who you are, who is here, what is said. `key` signs your posts. */
  | {
      type: 'hello';
      key: string;
      you: SiteVisitor;
      visitors: SiteVisitor[];
      pointers: SitePointer[];
      comments: SiteComment[];
    }
  | { type: 'join'; visitor: SiteVisitor }
  | { type: 'leave'; id: string }
  | { type: 'move'; pointer: SitePointer }
  | { type: 'comment'; comment: SiteComment }
  | { type: 'reply'; id: string; reply: SiteReply; left: number }
  | { type: 'touch'; id: string; left: number }
  | { type: 'gone'; id: string };

/** The visitor query of the stream: the page (without language) and the name kept in the browser. */
export const siteLiveQuerySchema = z.object({
  page: z.string().regex(/^\/[a-z0-9/-]{0,80}$/),
  name: name.optional(),
  color: siteColor.optional(),
});
