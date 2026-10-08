import { z } from 'zod';
import {
  accentColorSchema,
  anchorSchema,
  commentStatusSchema,
  reviewLinkRoleSchema,
  strokeSchema,
  type Comment,
  type Deck,
  type ReviewLink,
  type Slide,
  type Viewer,
} from './model';

/**
 * HTTP contract between `apps/web` and `apps/api`.
 * Every route is prefixed with `/api`. Errors always use {@link ApiError}.
 *
 * | Method | Path                                   | Body                       | Response              |
 * |--------|----------------------------------------|----------------------------|-----------------------|
 * | GET    | /me                                    |                            | MeResponse            |
 * | PATCH  | /me                                    | UpdateMeInput              | MeResponse            |
 * | GET    | /decks                                 |                            | Deck[]                |
 * | POST   | /decks/upload  (multipart field `file`)|                            | Deck (201)            |
 * | POST   | /decks/link                            | ImportLinkInput            | Deck (201) / ApiError |
 * | GET    | /decks/:deckId                         |                            | Deck                  |
 * | PATCH  | /decks/:deckId                         | UpdateDeckInput            | Deck                  |
 * | DELETE | /decks/:deckId                         |                            | 204                   |
 * | GET    | /decks/:deckId/slides                  |                            | Slide[]               |
 * | GET    | /decks/:deckId/status                  |                            | DeckStatus (poll)     |
 * | POST   | /decks/:deckId/sync                    |                            | SyncResult            |
 * | GET    | /decks/:deckId/revisions               |                            | Revision[] (newest first) |
 * | POST   | /decks/:deckId/revisions (multipart `file`, uploads only) |         | SyncResult            |
 * | GET    | /decks/:deckId/revisions/:revisionId/diff (`latest` ok) |           | RevisionDiff          |
 * | GET    | /decks/:deckId/deleted-slides          |                            | DeletedSlide[]        |
 * | GET    | /decks/:deckId/comments                |                            | Comment[] (flat)      |
 * | POST   | /decks/:deckId/comments                | CreateCommentInput         | Comment (201)         |
 * | PATCH  | /comments/:commentId                   | UpdateCommentInput         | Comment               |
 * | DELETE | /comments/:commentId                   |                            | 204                   |
 * | GET    | /decks/:deckId/review-links            |                            | ReviewLink[]          |
 * | POST   | /decks/:deckId/review-links            | CreateReviewLinkInput      | ReviewLink (201)      |
 * | DELETE | /review-links/:linkId                  |                            | 204 (revokes)         |
 * | GET    | /invites/:token                        |                            | InviteInfo            |
 * | POST   | /invites/:token/join                   | JoinInviteInput            | MeResponse (sets cookie) |
 * | POST   | /session/leave                         |                            | 204 (clears guest cookie) |
 * | GET    | /auth/microsoft/login?returnTo=        |                            | 302 to Microsoft      |
 * | GET    | /auth/microsoft/callback               |                            | 302 back to the web app |
 *
 * Binary files (slide images, thumbnails, avatars) are served from `/files/*`.
 */

export const API_PREFIX = '/api';

export const ERROR_CODES = [
  'bad_request',
  'not_found',
  'forbidden',
  'unauthorized',
  'unsupported_link',
  'microsoft_login_required',
  'microsoft_not_configured',
  'microsoft_consent_required',
  'source_forbidden',
  'source_not_found',
  'source_unreachable',
  'not_a_powerpoint',
  'file_too_large',
  'conflict',
  'link_revoked',
  'link_expired',
  'rate_limited',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    /** With `microsoft_login_required`: where to send the browser to sign in (relative to the web origin). */
    loginUrl?: string;
  };
}

/** Upload limit from BER-91. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export interface MeResponse {
  viewer: Viewer;
}

/** The viewer's own settings: their accent colour (pins, lines, drawings). */
export const updateMeInputSchema = z.object({ color: accentColorSchema });
export type UpdateMeInput = z.infer<typeof updateMeInputSchema>;

export const importLinkInputSchema = z.object({ url: z.url() });
export type ImportLinkInput = z.infer<typeof importLinkInputSchema>;

export const updateDeckInputSchema = z
  .object({ title: z.string().trim().min(1).max(200), archived: z.boolean() })
  .partial();
export type UpdateDeckInput = z.infer<typeof updateDeckInputSchema>;

export const createCommentInputSchema = z.object({
  slideId: z.string().nullable(),
  parentId: z.string().nullable().default(null),
  body: z.string().trim().max(10_000),
  anchor: anchorSchema,
  strokes: z.array(strokeSchema).max(50).default([]),
});
export type CreateCommentInput = z.input<typeof createCommentInputSchema>;

export const updateCommentInputSchema = z
  .object({ body: z.string().trim().min(1).max(10_000), status: commentStatusSchema })
  .partial();
export type UpdateCommentInput = z.infer<typeof updateCommentInputSchema>;

export const createReviewLinkInputSchema = z.object({
  role: reviewLinkRoleSchema.default('comment'),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
});
export type CreateReviewLinkInput = z.input<typeof createReviewLinkInputSchema>;

export interface InviteInfo {
  deckTitle: string;
  slideCount: number;
  thumbnailUrl: string | null;
  ownerName: string;
  role: ReviewLink['role'];
  participants: Deck['participants'];
}

export const joinInviteInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().optional(),
});
export type JoinInviteInput = z.infer<typeof joinInviteInputSchema>;

/** Convenience aliases so consumers import everything from one place. */
export type DeckResponse = Deck;
export type SlidesResponse = Slide[];
export type CommentsResponse = Comment[];
