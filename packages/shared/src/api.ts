import { z } from 'zod';
import {
  accentColorSchema,
  anchorSchema,
  commentStatusSchema,
  MAX_MEDIA_PEAKS,
  mediaKindSchema,
  rectSchema,
  strokeSchema,
  type Comment,
  type Deck,
  type ReviewLink,
  type Slide,
  type Viewer,
} from './model';
import type { MeLimits, MeUser, PendingInvite, Workspace } from './workspaces';

/**
 * HTTP contract between `apps/web` and `apps/api`.
 * Every route is prefixed with `/api`. Errors always use {@link ApiError}.
 *
 * | Method | Path                                   | Body                       | Response              |
 * |--------|----------------------------------------|----------------------------|-----------------------|
 * | GET    | /me                                    |                            | MeResponse (401 signed out) |
 * | PATCH  | /me                                    | UpdateMeInput              | MeResponse            |
 * | GET    | /decks?workspaceId=                    | (omit: all my workspaces)  | Deck[]                |
 * | POST   | /decks/upload  (multipart `file`, optional `workspaceId`) |         | Deck (201)            |
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
 * | POST   | /decks/:deckId/media-comments (multipart `file` + `comment` JSON) | CreateMediaCommentInput | Comment (201) |
 * | GET    | /decks/:deckId/media-usage             |                            | MediaUsage            |
 * | GET    | /media/:mediaId                        | (Range supported)          | audio/video bytes     |
 * | PUT    | /media/:mediaId/transcript             | UpdateTranscriptInput      | Comment               |
 * | GET    | /decks/:deckId/review-links            |                            | ReviewLink[]          |
 * | POST   | /decks/:deckId/review-links            | CreateReviewLinkInput      | ReviewLink (201)      |
 * | DELETE | /review-links/:linkId                  |                            | 204 (revokes)         |
 * | GET    | /invites/:token                        |                            | InviteInfo            |
 * | POST   | /invites/:token/join                   | JoinInviteInput            | MeResponse (sets cookie) |
 * | POST   | /session/leave                         |                            | 204 (clears guest cookie) |
 * | GET    | /microsoft/file-picker                 |                            | FilePickerSession     |
 * | POST   | /microsoft/file-picker/token           | FilePickerTokenInput       | { token }             |
 * | POST   | /decks/drive-item                      | ImportDriveItemInput       | Deck (201)            |
 * | GET    | /auth/providers                        |                            | AuthProviders         |
 * | GET    | /auth/microsoft/login?returnTo=        | (signed in: connects files) | 302 to Microsoft     |
 * | GET    | /auth/microsoft/callback               |                            | 302 back to the web app |
 * | GET    | /auth/google/login?returnTo=&intent=   | (`intent=connect`: link to me) | 302 to Google     |
 * | GET    | /auth/google/callback                  |                            | 302 back to the web app |
 * | GET    | /auth/oidc/login?returnTo=&intent=     | (`intent=connect`: link to me) | 302 to the SSO provider |
 * | GET    | /auth/oidc/callback                    |                            | 302 back to the web app |
 * | POST   | /auth/email/start                      | StartEmailLoginInput       | 204 (always; mails link + code) |
 * | GET    | /auth/email/verify?token=              |                            | confirm page → POST → 303 |
 * | POST   | /auth/email/code                       | VerifyEmailCodeInput       | LoginResult (sets cookie) |
 * | POST   | /auth/passkey/options                  |                            | WebAuthn request options |
 * | POST   | /auth/passkey/verify                   | VerifyPasskeyLoginInput    | LoginResult (sets cookie) |
 * | GET    | /me/identities                         |                            | LoginIdentity[]       |
 * | GET    | /passkeys                              |                            | Passkey[]             |
 * | POST   | /passkeys/register/options             |                            | WebAuthn creation options |
 * | POST   | /passkeys/register/verify              | VerifyPasskeyRegistrationInput | Passkey (201)     |
 * | PATCH  | /passkeys/:id                          | RenamePasskeyInput         | Passkey               |
 * | DELETE | /passkeys/:id                          |                            | 204                   |
 * | GET    | /dev/mails                             | (development only)         | DevMail[] (newest first) |
 * | POST   | /auth/logout                           |                            | 204 (clears session)  |
 * | GET    | /workspaces                            |                            | Workspace[]           |
 * | POST   | /workspaces                            | CreateWorkspaceInput       | Workspace (201)       |
 * | GET    | /workspaces/:id                        |                            | Workspace             |
 * | PATCH  | /workspaces/:id                        | UpdateWorkspaceInput       | Workspace (admin+)    |
 * | DELETE | /workspaces/:id                        |                            | 204 (owner)           |
 * | GET    | /workspaces/:id/members                |                            | WorkspaceMember[]     |
 * | PATCH  | /workspaces/:id/members/:userId        | UpdateMemberInput          | WorkspaceMember       |
 * | DELETE | /workspaces/:id/members/:userId        |                            | 204 (admin+ or self)  |
 * | GET    | /workspaces/:id/invites                |                            | WorkspaceInvite[]     |
 * | POST   | /workspaces/:id/invites                | CreateWorkspaceInviteInput | CreatedWorkspaceInvite (201) |
 * | DELETE | /workspace-invites/:inviteId           |                            | 204 (revokes)         |
 * | POST   | /workspace-invites/:inviteId/accept    |                            | JoinResult            |
 * | GET    | /join/:token                           |                            | JoinPreview (public)  |
 * | POST   | /join/:token                           |                            | JoinResult            |
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
  'quota_exceeded',
  'unsupported_media',
  'link_revoked',
  'link_expired',
  'invite_used',
  'rate_limited',
  /** A limit of the organisation's plan (members, decks, own organisations) is reached (BER-130). */
  'plan_limit',
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
  /** Signed-in accounts only (BER-129); guests get just `viewer`. */
  user?: MeUser;
  workspaces?: Workspace[];
  pendingInvites?: PendingInvite[];
  /** What the account may still do (BER-130), e.g. found its own organisation. */
  limits?: MeLimits;
}

/** The viewer's own settings: their accent colour (pins, lines, drawings). */
export const updateMeInputSchema = z.object({ color: accentColorSchema });
export type UpdateMeInput = z.infer<typeof updateMeInputSchema>;

export const importLinkInputSchema = z.object({ url: z.url() });
export type ImportLinkInput = z.infer<typeof importLinkInputSchema>;

// ── OneDrive file picker ─────────────────────────────────────────────────────

/** Which OneDrive File Picker v8 to open for the signed-in Microsoft account. */
export const filePickerSessionSchema = z.object({
  account: z.enum(['personal', 'business']),
  /** The resource of the first token (`https://onedrive.live.com/picker` or the OneDrive host). */
  baseUrl: z.string(),
  /** Where the picker form is posted to. */
  pickerUrl: z.string(),
});
export type FilePickerSession = z.infer<typeof filePickerSessionSchema>;

/** The picker's `authenticate` command: a token for `resource`. */
export const filePickerTokenInputSchema = z.object({ resource: z.string().max(2048) });
export type FilePickerTokenInput = z.infer<typeof filePickerTokenInputSchema>;

/** A file picked in the OneDrive file picker (`parentReference.driveId` + `id`). */
export const importDriveItemInputSchema = z.object({
  driveId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  /** Omitted → the first workspace the user may create decks in. */
  workspaceId: z.string().max(100).optional(),
});
export type ImportDriveItemInput = z.infer<typeof importDriveItemInputSchema>;

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

// ── Voice and video comments (BER-116) ─────────────────────────────────────

/** Recordings stop by themselves after five minutes. */
export const MAX_MEDIA_DURATION_MS = 5 * 60_000;
/** Per recording. Five minutes of the recorder's video settings are ~20 MB; this leaves room. */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
/** Storage per account (the deck owner – guests' recordings count towards the deck's owner). */
export const DEFAULT_MEDIA_QUOTA_BYTES = 5 * 1024 ** 3;

/** What browsers' MediaRecorder produces: WebM/Opus (Chrome, Firefox), MP4/AAC (Safari), Ogg. */
export const MEDIA_MIME_TYPES = {
  audio: ['audio/webm', 'audio/ogg', 'audio/mp4'],
  video: ['video/webm', 'video/mp4'],
} as const;

/** `audio/webm;codecs=opus` → `audio/webm`. */
export const baseMimeType = (mimeType: string) => mimeType.split(';')[0]!.trim().toLowerCase();

export const isAllowedMediaMimeType = (kind: 'audio' | 'video', mimeType: string) =>
  (MEDIA_MIME_TYPES[kind] as readonly string[]).includes(baseMimeType(mimeType));

/** The `comment` field of the multipart upload; the recording itself goes in `file`. */
export const createMediaCommentInputSchema = createCommentInputSchema.extend({
  media: z.object({
    kind: mediaKindSchema,
    // A little slack: the recorder stops on a timer, the container may report a few ms more.
    durationMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_MEDIA_DURATION_MS + 5_000),
    peaks: z.array(z.number().min(0).max(1)).max(MAX_MEDIA_PEAKS).default([]),
  }),
});
export type CreateMediaCommentInput = z.input<typeof createMediaCommentInputSchema>;

export const updateTranscriptInputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('done'), transcript: z.string().trim().max(50_000) }),
  z.object({ status: z.literal('failed') }),
]);
export type UpdateTranscriptInput = z.infer<typeof updateTranscriptInputSchema>;

export interface MediaUsage {
  usedBytes: number;
  /** `null` = unlimited (self-hosted). */
  limitBytes: number | null;
}

export const updateCommentInputSchema = z
  .object({
    body: z.string().trim().min(1).max(10_000),
    status: commentStatusSchema,
    /** Moves / resizes the comment's text on the slide ("Text auf Folie"); author only. */
    textBox: rectSchema
      .refine((box) => box.w > 0 && box.h > 0, { message: 'Das Textfeld braucht eine Größe.' })
      .refine((box) => box.x + box.w <= 1 + 1e-6 && box.y + box.h <= 1 + 1e-6, {
        message: 'Das Textfeld muss auf der Folie liegen.',
      }),
  })
  .partial();
export type UpdateCommentInput = z.infer<typeof updateCommentInputSchema>;

/**
 * Review links are view-only (BER-130): commenting is for members of the organisation. Old
 * `comment` links still exist in the database but behave like `view`.
 */
export const createReviewLinkInputSchema = z.object({
  role: z
    .literal('view', {
      error:
        'Links zum Teilen sind nur zum Ansehen. Zum Kommentieren lade die Person in die Organisation ein.',
    })
    .default('view'),
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
