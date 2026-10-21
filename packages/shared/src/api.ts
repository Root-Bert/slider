import { z } from 'zod';
import {
  accentColorSchema,
  anchorSchema,
  commentStatusSchema,
  MAX_MEDIA_PEAKS,
  mediaKindSchema,
  pointSchema,
  rectSchema,
  shapeRefSchema,
  strokeSchema,
  type Comment,
  type Deck,
  type Slide,
  type Viewer,
  type WorkspaceRole,
} from './model';
import type { DomainWorkspace, MeLimits, MeUser, PendingInvite, Workspace } from './workspaces';

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
 * | GET    | /decks/:deckId/slides/:slideId/versions |                           | SlideVersionView[] (newest first) |
 * | GET    | /decks/:deckId/comments                |                            | Comment[] (flat)      |
 * | POST   | /decks/:deckId/comments                | CreateCommentInput         | Comment (201)         |
 * | PATCH  | /comments/:commentId                   | UpdateCommentInput         | Comment               |
 * | DELETE | /comments/:commentId                   |                            | 204                   |
 * | POST   | /decks/:deckId/media-comments (multipart `file` and/or `image` + `comment` JSON) | CreateMediaCommentInput | Comment (201) |
 * | GET    | /decks/:deckId/media-usage             |                            | MediaUsage            |
 * | GET    | /media/:mediaId                        | (Range supported)          | audio/video/PNG bytes |
 * | GET    | /microsoft/file-picker?connectionId=   |                            | FilePickerSession     |
 * | POST   | /microsoft/file-picker/token           | FilePickerTokenInput       | { token }             |
 * | POST   | /decks/drive-item                      | ImportDriveItemInput       | Deck (201)            |
 * | GET    | /nextcloud/settings                    |                            | NextcloudSettings     |
 * | POST   | /nextcloud/login                       | StartNextcloudLoginInput   | NextcloudLoginStart   |
 * | POST   | /nextcloud/login/:id/poll              |                            | NextcloudLoginPoll    |
 * | GET    | /nextcloud/:connectionId/files?path=   |                            | NextcloudListing      |
 * | GET    | /nextcloud/:connectionId/shared        |                            | NextcloudListing      |
 * | GET    | /nextcloud/:connectionId/search?q=     |                            | NextcloudListing      |
 * | GET    | /nextcloud/:connectionId/preview/:fileId |                          | image bytes           |
 * | POST   | /decks/nextcloud-item                  | ImportNextcloudItemInput   | Deck (201)            |
 * | POST   | /decks/google-item                     | ImportGoogleItemInput      | Deck (201)            |
 * | GET    | /auth/providers                        |                            | AuthProviders         |
 * | GET    | /auth/microsoft/login?returnTo=&connection= | (signed in: connects files; `connection` preselects that account) | 302 to Microsoft |
 * | GET    | /auth/microsoft/callback               |                            | 302 back to the web app |
 * | GET    | /auth/google/login?returnTo=&intent=   | (`intent=connect`: link to me) | 302 to Google    |
 * | GET    | /auth/google/drive?returnTo=&connection= | (signed in: connects Google Drive) | 302 to Google |
 * | GET    | /auth/google/pick?returnTo=&fileId=&connection= | (signed in: Google's picker page) | 302 to Google |
 * | GET    | /auth/google/callback                  |                            | 302 back to the web app |
 * | GET    | /auth/oidc/login?returnTo=&intent=     | (`intent=connect`: link to me) | 302 to the SSO provider |
 * | GET    | /auth/oidc/callback                    |                            | 302 back to the web app |
 * | POST   | /auth/sso/discover                     | DiscoverSsoInput           | SsoLogin (404: none for the address) |
 * | GET    | /auth/sso/login?organisation=&returnTo= | (an organisation's company login) | 302 to its provider |
 * | GET    | /auth/sso/callback                     |                            | 302 back to the web app |
 * | GET    | /auth/nextcloud/login?returnTo=&intent= | (the organisation's Nextcloud, OAuth 2.0) | 302 to Nextcloud |
 * | GET    | /auth/nextcloud/callback               |                            | 302 back to the web app |
 * | POST   | /auth/nextcloud/flow                   | StartNextcloudSignInInput  | NextcloudLoginStart (sets cookie) |
 * | POST   | /auth/nextcloud/flow/:id/poll          |                            | NextcloudSignInPoll   |
 * | POST   | /auth/nextcloud/confirm                | ConfirmNextcloudSignUpInput | LoginResult (sets cookie) |
 * | POST   | /auth/email/start                      | StartEmailLoginInput       | 204 (mails a login link) |
 * | POST   | /auth/email/confirm                    | ConfirmEmailLoginInput     | EmailLoginResult (sets cookie) |
 * | POST   | /auth/passkey/options                  |                            | WebAuthn request options |
 * | POST   | /auth/passkey/verify                   | VerifyPasskeyLoginInput    | LoginResult (sets cookie) |
 * | GET    | /me/microsoft                          |                            | MicrosoftConnection[] |
 * | DELETE | /me/microsoft/:id                      | (decks syncing through it → auth_required) | 204 |
 * | GET    | /me/nextcloud                          |                            | NextcloudConnection[] |
 * | DELETE | /me/nextcloud/:id                      | (revokes the app password at Nextcloud) | DisconnectNextcloudResult |
 * | GET    | /me/google                             |                            | GoogleConnection[]    |
 * | DELETE | /me/google/:id                         | (revokes the grant at Google) | 204                |
 * | GET    | /me/identities                         |                            | LoginIdentity[]       |
 * | GET    | /passkeys                              |                            | Passkey[]             |
 * | POST   | /passkeys/register/options             |                            | WebAuthn creation options |
 * | POST   | /passkeys/register/verify              | VerifyPasskeyRegistrationInput | Passkey (201)     |
 * | PATCH  | /passkeys/:id                          | RenamePasskeyInput         | Passkey               |
 * | DELETE | /passkeys/:id                          |                            | 204                   |
 * | POST   | /auth/logout                           |                            | 204 (clears session)  |
 * | GET    | /workspaces                            |                            | Workspace[]           |
 * | POST   | /workspaces                            | CreateWorkspaceInput       | Workspace (201)       |
 * | GET    | /workspaces/:id                        |                            | Workspace             |
 * | PATCH  | /workspaces/:id                        | UpdateWorkspaceInput       | Workspace (admin+)    |
 * | DELETE | /workspaces/:id                        |                            | 204 (owner)           |
 * | PUT    | /workspaces/:id/logo                   | multipart `file` (PNG/JPEG/WebP) | Workspace (admin) |
 * | DELETE | /workspaces/:id/logo                   |                            | Workspace (admin)     |
 * | PUT    | /workspaces/:id/domain                 | UpdateWorkspaceDomainInput | Workspace (admin)     |
 * | POST   | /workspaces/:id/domain-join            |                            | JoinResult            |
 * | GET    | /workspaces/:id/sso                    |                            | WorkspaceSso (admin)  |
 * | PUT    | /workspaces/:id/sso                    | UpdateWorkspaceSsoInput    | WorkspaceSso (admin)  |
 * | POST   | /workspaces/:id/sso/verify             | (checks the DNS TXT record) | WorkspaceSso (admin) |
 * | DELETE | /workspaces/:id/sso                    |                            | 204 (admin)           |
 * | GET    | /workspaces/:id/usage                  |                            | WorkspaceUsageDetails (members) |
 * | POST   | /workspaces/:id/billing/checkout       |                            | BillingRedirect (billing owner) |
 * | POST   | /workspaces/:id/billing/portal         |                            | BillingRedirect (billing owner) |
 * | POST   | /workspaces/:id/billing/transfer       | BillingTransferInput       | WorkspaceUsageDetails (billing owner) |
 * | DELETE | /workspaces/:id/billing/transfer       |                            | WorkspaceUsageDetails (owner or asked admin) |
 * | POST   | /workspaces/:id/billing/transfer/accept |                           | BillingTransferAcceptResult (asked admin) |
 * | POST   | /billing/webhook                       | Stripe event (signed)      | 200                   |
 * | GET    | /workspaces/:id/members                |                            | WorkspaceMember[]     |
 * | PATCH  | /workspaces/:id/members/:userId        | UpdateMemberInput          | WorkspaceMember       |
 * | DELETE | /workspaces/:id/members/:userId        | ?successor=<userId>        | 204 (admin+ or self)  |
 * | GET    | /workspaces/:id/members/:userId/departure | ?successor=<userId>     | MemberDeparture (admin+ or self) |
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
  /** The file needs a connected Nextcloud account at `nextcloudServer` (BER-135). */
  'nextcloud_login_required',
  /** The file needs a connected Google account, or one that picked it in Google's picker (BER-119). */
  'google_login_required',
  /** Google Drive is not set up on this server (no Google login). */
  'google_not_configured',
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
  /**
   * The organisation is on the free plan and over one of its limits (members, reviews, storage):
   * reading, deleting and upgrading work, creating does not until it fits again (BER-155).
   */
  'plan_over_limit',
  /** Older versions' files can't be deleted while a version is imported or rendered. */
  'storage_busy',
  /**
   * No instance admin yet: a signed-in account has to enter the setup token from the server log
   * first (`POST /setup/claim`); until then every other route answers with this (403).
   */
  'instance_unclaimed',
  /** Another organisation is already opened to this e-mail domain (BER-148). */
  'domain_taken',
  /** The website's contact form is off: no `CONTACT_EMAIL` or no SMTP. */
  'contact_unavailable',
  /** A mail (the login link, BER-168) could not be sent just now; trying again may work. */
  'mail_failed',
  /** The instance admin blocked the organisation (BER-167): only leaving it still works. */
  'workspace_blocked',
  /** The instance admin blocked the account (BER-167): it can't sign in. */
  'account_blocked',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    /** With `microsoft_login_required`: where to send the browser to sign in (relative to the web origin). */
    loginUrl?: string;
    /** With `nextcloud_login_required`: the Nextcloud to connect (`POST /nextcloud/login`). */
    nextcloudServer?: string;
    /**
     * With `google_login_required`: the file to hand to Slider in Google's picker – it only sees
     * files a person picked there.
     */
    googleFileId?: string;
  };
}

/** Upload limit from BER-91. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export interface MeResponse {
  viewer: Viewer;
  /** Absent only if the account vanished mid-request. */
  user?: MeUser;
  workspaces?: Workspace[];
  pendingInvites?: PendingInvite[];
  /** The company organisation of the viewer's e-mail domain, if they are not in it (BER-148). */
  domainWorkspace?: DomainWorkspace | null;
  /** What the account may still do (BER-130), e.g. found its own organisation. */
  limits?: MeLimits;
  /**
   * `false`: the instance has no admin yet and this account must enter the setup token
   * (`POST /setup/claim`) before anything else – every other route answers `instance_unclaimed`.
   * Always `true` for the dev owner of the dev login (development without a login).
   */
  instanceClaimed: boolean;
}

/** Longest name a person can give themselves (`PATCH /me`). */
export const USER_NAME_MAX = 80;

/**
 * The viewer's own settings: their accent colour (pins, lines, drawings) and the name others see
 * (BER-145: people correct it themselves). Either or both.
 */
export const updateMeInputSchema = z
  .object({
    color: accentColorSchema.optional(),
    name: z.string().trim().min(1, 'Der Name darf nicht leer sein.').max(USER_NAME_MAX).optional(),
  })
  .refine((input) => input.color !== undefined || input.name !== undefined, {
    message: 'Nichts zu ändern.',
  });
export type UpdateMeInput = z.infer<typeof updateMeInputSchema>;

/**
 * Privacy policy and imprint of the instance (BER-141): Markdown kept by the instance admin,
 * shown at `/datenschutz` and `/impressum` and linked from every public page and mail.
 * `null`: not written yet – then the links are hidden.
 */
export interface LegalTexts {
  privacy: string | null;
  imprint: string | null;
}

const legalTextSchema = z
  .string()
  .max(100_000)
  .nullable()
  .transform((text) => (text?.trim() ? text : null));
export const updateLegalTextsInputSchema = z.object({
  privacy: legalTextSchema,
  imprint: legalTextSchema,
});
export type UpdateLegalTextsInput = z.input<typeof updateLegalTextsInputSchema>;

/**
 * Data requests without login (BER-146): someone enters their address on `/datenanfrage`, Slider
 * mails a link to exactly that address – having the mailbox is the proof of identity. The link
 * (`/daten/:token`) downloads the copy or confirms the deletion; `keep` comes from the reminder
 * mails of unused accounts (BER-147) and keeps the account.
 */
export const DATA_REQUEST_PURPOSES = ['export', 'delete', 'keep'] as const;
export type DataRequestPurpose = (typeof DATA_REQUEST_PURPOSES)[number];

export const createDataRequestInputSchema = z.object({
  email: z.email('Bitte eine gültige E-Mail-Adresse eingeben.').max(320),
  purpose: z.enum(['export', 'delete']),
});
export type CreateDataRequestInput = z.infer<typeof createDataRequestInputSchema>;

/**
 * The website's contact form (`POST /contact`): mailed to `CONTACT_EMAIL`, a reply goes to
 * `email`. `website` is a field people never see – only bots fill it in.
 */
export const contactMessageInputSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.email('Bitte eine gültige E-Mail-Adresse eingeben.').max(320),
  message: z.string().trim().min(1, 'Bitte eine Nachricht eingeben.').max(5000),
  website: z.string().max(500).optional(),
});
export type ContactMessageInput = z.infer<typeof contactMessageInputSchema>;

/** What a data request link leads to (`GET /data-requests/:token`). */
export interface DataRequestInfo {
  purpose: DataRequestPurpose;
  email: string;
  /** `false`: no account, only invitations to the address. */
  hasAccount: boolean;
  expiresAt: string;
}

/**
 * Who becomes admin, per organisation where the deleted account was the only admin among others
 * (workspace id → member id). Deleting oneself asks for one each (BER-145).
 */
export const successorsSchema = z.record(z.string().max(100), z.string().max(100)).default({});

/** An organisation that needs a new admin before the account can be deleted. */
export interface SuccessorChoice {
  workspaceId: string;
  workspaceName: string;
  /** Other members, highest role first, then longest-standing. */
  candidates: { userId: string; name: string; role: WorkspaceRole }[];
}

export const confirmDataDeletionInputSchema = z.object({ successors: successorsSchema });
export type ConfirmDataDeletionInput = z.infer<typeof confirmDataDeletionInputSchema>;

/**
 * Deleting an account (`DELETE /me`, BER-145): the person types their e-mail address to confirm,
 * so a stray click or a stolen session in an open tab can't delete it in one go.
 */
export const deleteAccountInputSchema = z.object({
  confirmEmail: z.string().max(320),
  successors: successorsSchema,
});
export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;

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
export const filePickerTokenInputSchema = z.object({
  resource: z.string().max(2048),
  /** The Microsoft connection the picker runs with; omitted → the most recently used one. */
  connectionId: z.string().max(100).optional(),
});
export type FilePickerTokenInput = z.infer<typeof filePickerTokenInputSchema>;

/** A file picked in the OneDrive file picker (`parentReference.driveId` + `id`). */
export const importDriveItemInputSchema = z.object({
  driveId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200),
  /** Omitted → the first workspace the user may create decks in. */
  workspaceId: z.string().max(100).optional(),
  /** The Microsoft connection the picker ran with; omitted → the most recently used one. */
  connectionId: z.string().max(100).optional(),
});
export type ImportDriveItemInput = z.infer<typeof importDriveItemInputSchema>;

export const updateDeckInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    archived: z.boolean(),
    /** Moves the deck into a folder of its workspace; `null` takes it out. */
    folderId: z.string().max(100).nullable(),
  })
  .partial();
export type UpdateDeckInput = z.infer<typeof updateDeckInputSchema>;

export const deckFolderInputSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type DeckFolderInput = z.infer<typeof deckFolderInputSchema>;

/** Longest comment text; the comment fields stop there too. */
export const MAX_COMMENT_BODY_LENGTH = 10_000;

export const createCommentInputSchema = z.object({
  slideId: z.string().nullable(),
  parentId: z.string().nullable().default(null),
  body: z.string().trim().max(MAX_COMMENT_BODY_LENGTH),
  anchor: anchorSchema,
  strokes: z.array(strokeSchema).max(50).default([]),
});
export type CreateCommentInput = z.input<typeof createCommentInputSchema>;

// ── Voice and video comments (BER-116) ─────────────────────────────────────

/** Recordings stop by themselves after five minutes. */
export const MAX_MEDIA_DURATION_MS = 5 * 60_000;
/** Per recording. Five minutes of the recorder's video settings are ~20 MB; this leaves room. */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

/** What browsers' MediaRecorder produces: WebM/Opus (Chrome, Firefox), MP4/AAC (Safari), Ogg. */
export const MEDIA_MIME_TYPES = {
  audio: ['audio/webm', 'audio/ogg', 'audio/mp4'],
  video: ['video/webm', 'video/mp4'],
} as const;

/** A drawn image (PNG from the composer's canvas); a full-screen sketch is well below this. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** `audio/webm;codecs=opus` → `audio/webm`. */
export const baseMimeType = (mimeType: string) => mimeType.split(';')[0]!.trim().toLowerCase();

export const isAllowedMediaMimeType = (kind: 'audio' | 'video', mimeType: string) =>
  (MEDIA_MIME_TYPES[kind] as readonly string[]).includes(baseMimeType(mimeType));

/**
 * The `comment` field of the multipart upload; the recording goes in `file`, a drawn image in
 * `image`. `media` describes the recording – present exactly when `file` is sent.
 */
export const createMediaCommentInputSchema = createCommentInputSchema.extend({
  media: z
    .object({
      kind: mediaKindSchema,
      // A little slack: the recorder stops on a timer, the container may report a few ms more.
      durationMs: z
        .number()
        .int()
        .min(1)
        .max(MAX_MEDIA_DURATION_MS + 5_000),
      peaks: z.array(z.number().min(0).max(1)).max(MAX_MEDIA_PEAKS).default([]),
    })
    .optional(),
});
export type CreateMediaCommentInput = z.input<typeof createMediaCommentInputSchema>;

/** Storage of the deck's organisation (BER-151): every file of its reviews counts. */
export interface MediaUsage {
  usedBytes: number;
  /** `null` = unlimited (self-hosted). */
  limitBytes: number | null;
}

export const updateCommentInputSchema = z
  .object({
    /**
     * May go empty when the comment keeps other content – a recording, an image or a drawing;
     * the API checks that (a text-only comment needs text).
     */
    body: z.string().trim().max(MAX_COMMENT_BODY_LENGTH),
    status: commentStatusSchema,
    /** Moves / resizes the comment's text on the slide ("Text auf Folie"); author only. */
    textBox: rectSchema
      .refine((box) => box.w > 0 && box.h > 0, { message: 'Das Textfeld braucht eine Größe.' })
      .refine((box) => box.x + box.w <= 1 + 1e-6 && box.y + box.h <= 1 + 1e-6, {
        message: 'Das Textfeld muss auf der Folie liegen.',
      }),
    /** Moves / resizes the comment's box on the slide; author only, rect anchors only. */
    anchor: z.object({
      type: z.literal('rect'),
      rect: rectSchema
        .refine((box) => box.w > 0 && box.h > 0, { message: 'Die Box braucht eine Größe.' })
        .refine((box) => box.x + box.w <= 1 + 1e-6 && box.y + box.h <= 1 + 1e-6, {
          message: 'Die Box muss auf der Folie liegen.',
        }),
      shapeRef: shapeRefSchema.nullable(),
    }),
    /** Moves a drawing (strokes and anchor) or a pin by this shift, kept on the slide; author only. */
    move: z.object({ dx: z.number().min(-1).max(1), dy: z.number().min(-1).max(1) }),
    /**
     * Removes the comment's drawing / text on the slide, the comment stays; author only. `pin`:
     * where its point goes when its box was that drawing or text, else `null` (the anchor stays).
     */
    removeMarks: z.object({ pin: pointSchema.nullable() }),
  })
  .partial();
export type UpdateCommentInput = z.infer<typeof updateCommentInputSchema>;

/** Convenience aliases so consumers import everything from one place. */
export type DeckResponse = Deck;
export type SlidesResponse = Slide[];
export type CommentsResponse = Comment[];
