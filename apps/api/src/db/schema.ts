import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  timestamp,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  AccentColor,
  Anchor,
  Author,
  CommentSource,
  CommentStatus,
  DeckSource,
  Guide,
  ImportState,
  MediaKind,
  RevisionStatus,
  RevisionTrigger,
  Shape,
  SlideDiffStatus,
  SlideRenderer,
  Stroke,
  SyncErrorCode,
  SyncSummary,
  WorkspaceRole,
} from '@slider/shared';

/**
 * Database schema (BER-90). Designed for revisions from day one:
 * a `slide` is Slider's stable identity across revisions, a `slide_version` is
 * how that slide looks in one revision of the PPTX.
 */

/** Automatic update bookkeeping per deck (BER-107); `{}` until the first check. ISO timestamps. */
export interface DeckSyncStateRow {
  lastCheckedAt?: string;
  nextCheckAt?: string;
  lastSyncAt?: string;
  lastSyncError?: { code: SyncErrorCode; message: string; at: string } | null;
  consecutiveFailures?: number;
  /** A changed token waiting for PowerPoint to stop autosaving (debounce). */
  pending?: { token: string; firstSeenAt: string; lastChangedAt: string } | null;
  importingRevisionId?: string | null;
  /** Token of a file that failed to import; not downloaded again until the token changes. */
  failedToken?: string | null;
  /**
   * Failed imports of one file version in a row (not parse errors). Counted apart from failed
   * source checks, which `consecutiveFailures` counts too: an outage before an edit must not use
   * up the import's attempts.
   */
  importFailures?: { token: string | null; count: number } | null;
  /** Last check through the content hash (sources without ETag/cTag). */
  lastContentCheckAt?: string;
}

/** Slide diff of a revision against the one before (BER-108). */
export interface RevisionDiffRecord {
  previousRevisionId: string;
  slides: {
    slideId: string;
    status: SlideDiffStatus;
    moved: boolean;
    confidence: number;
    matchedBy: 'sldId' | 'content' | null;
    position: number;
    previousPosition: number | null;
  }[];
  deleted: { slideId: string; previousPosition: number; confidence: number }[];
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();

/** Everyone with an account. PowerPoint authors don't need a row. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  color: text('color').$type<AccentColor>().notNull(),
  /** Microsoft refresh token for OneDrive/SharePoint links, AES-GCM encrypted (`auth/token-crypto`). */
  msRefreshToken: text('ms_refresh_token'),
  /** The Microsoft account it belongs to (mail or UPN), for display. */
  msAccount: text('ms_account'),
  /** Microsoft Graph id of that account – at most {@link MAX_ACCOUNTS_PER_MICROSOFT} share one. */
  msSubject: text('ms_subject'),
  /** The first account of the instance (BER-129). */
  isInstanceAdmin: boolean('is_instance_admin').notNull().default(false),
  createdAt: createdAt(),
});

/**
 * Login sessions (BER-129). The cookie holds a random token; only its SHA-256 is stored, so a
 * leaked database cannot be replayed as cookies.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * How an account signs in: `microsoft` (`<tid>:<oid>`), `google` (Google `sub`), `oidc` (`sub` of
 * the configured issuer) or `email` (the lower-case address, magic link or code). One account may
 * have several. Passkeys are not identities – they live in `passkeys` and never create accounts.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    provider: text('provider').$type<IdentityProvider>().notNull(),
    subject: text('subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The address the provider reported at the last login. */
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.subject] }),
    index('user_identities_user_idx').on(t.userId),
  ],
);

export type IdentityProvider = 'microsoft' | 'google' | 'oidc';

/**
 * WebAuthn passkeys (discoverable credentials). They sign into an existing account only; the
 * public key and the signature counter are all the server keeps.
 */
export const passkeys = pgTable(
  'passkeys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Credential id, base64url. */
    credentialId: text('credential_id').notNull().unique(),
    /** COSE public key, base64url. */
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: jsonb('transports').$type<string[]>(),
    /** `singleDevice` or `multiDevice` (synced, e.g. iCloud Keychain, Google Password Manager). */
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
);

/** Pending WebAuthn challenges (5 minutes, single use); a signed cookie names the row. */
export const authChallenges = pgTable('auth_challenges', {
  id: text('id').primaryKey(),
  purpose: text('purpose').$type<'passkey_register' | 'passkey_login'>().notNull(),
  /** Registration only: the account the passkey is for. */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  challenge: text('challenge').notNull(),
  createdAt: createdAt(),
  expiresAt: timestamptz('expires_at').notNull(),
});

/** A team space: decks belong to a workspace, people to workspaces with a role (BER-129). */
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
  /** Who founded it; every account may found one (BER-130). */
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  /** `PlanId` – decides the limits (members, decks); see `services/plans`. */
  plan: text('plan').notNull().default('free'),
  /** Uploaded logo in blob storage (`workspaces/<id>/logo-<uuid>.<ext>`); `null` shows the monogram. */
  logoKey: text('logo_key'),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<WorkspaceRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

/**
 * E-mail invites (`email` set, single use) and invite links (`email` null, multi use). Sharing a
 * deck is an invite too (`deck_id` set, role `viewer`): joining leads to that deck.
 */
export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email'),
    role: text('role').$type<WorkspaceRole>().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    revokedAt: timestamptz('revoked_at'),
    useCount: integer('use_count').notNull().default(0),
    /** The deck that was shared; `null` for plain organisation invites. */
    deckId: text('deck_id').references(() => decks.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('workspace_invites_workspace_idx').on(t.workspaceId),
    index('workspace_invites_deck_idx').on(t.deckId),
  ],
);

/** Folders to sort a workspace's decks into; one level, shared by the whole workspace. */
export const deckFolders = pgTable(
  'deck_folders',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('deck_folders_workspace_idx').on(t.workspaceId)],
);

export const decks = pgTable(
  'decks',
  {
    id: text('id').primaryKey(),
    /** Who created the deck; their Microsoft login is used to keep a linked deck in sync. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    /** Access is decided by membership in this workspace (BER-129). */
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    fileName: text('file_name').notNull(),
    source: text('source').$type<DeckSource>().notNull(),
    /** The link the deck was imported from (`null` for uploads). */
    sourceUrl: text('source_url'),
    /** Provider reference for re-sync: Graph `drives/{d}/items/{i}` or the final file URL. */
    sourceRef: text('source_ref'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    archivedAt: timestamptz('archived_at'),
    importState: jsonb('import_state').$type<ImportState>().notNull(),
    currentRevisionId: text('current_revision_id').references((): AnyPgColumn => revisions.id, {
      onDelete: 'set null',
    }),
    /** Polling, debounce and error state of the automatic update (BER-107). */
    syncState: jsonb('sync_state').$type<DeckSyncStateRow>().notNull().default({}),
    /** Last time someone opened the deck; only decks active in the last 7 days are polled. */
    lastViewedAt: timestamptz('last_viewed_at'),
    /** The folder it is sorted into; `null` = not in a folder. Deleting the folder keeps the deck. */
    folderId: text('folder_id').references(() => deckFolders.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('decks_owner_updated_idx').on(t.ownerId, t.updatedAt),
    index('decks_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
  ],
);

export const revisions = pgTable(
  'revisions',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    createdAt: createdAt(),
    /** Original PPTX; `null` only for demo data that never had a file. */
    pptxKey: text('pptx_key'),
    slideWidthEmu: integer('slide_width_emu'),
    slideHeightEmu: integer('slide_height_emu'),
    /** Graph cTag/eTag or HTTP ETag of the source file this revision was made from (BER-107). */
    sourceChangeToken: text('source_change_token'),
    /** `pending` while a sync import runs; the deck keeps showing its current revision. */
    status: text('status').$type<RevisionStatus>().notNull().default('ready'),
    /** What created the revision; `null` for revisions from before BER-107. */
    trigger: text('trigger').$type<RevisionTrigger>(),
    /** SHA-256 (hex) of the original file, to skip re-imports of identical bytes. */
    contentSha256: text('content_sha256'),
    /** Who last saved the file, else its creator (PPTX core properties) – shown as a participant. */
    fileAuthor: text('file_author'),
    /** Slide diff against the previous revision; `null` for revision 1. */
    diff: jsonb('diff').$type<RevisionDiffRecord>(),
    summary: jsonb('summary').$type<SyncSummary>(),
    /**
     * Why Office's PDF was tried and not used for the slide images (BER-94), e.g. a file too big
     * for Microsoft's conversion; `null` when Office drew them or was not tried.
     */
    officeFailure: text('office_failure'),
    /**
     * Import runs of this revision that started and never finished – the process died (OOM
     * kill, native crash). Back to 0 when a run ends; past the limit the import gives up
     * instead of crash-looping the server on every start.
     */
    importAttempts: integer('import_attempts').notNull().default(0),
    /**
     * `FINGERPRINT_VERSION` of the code that computed this revision's slide hashes; `null` for
     * revisions from before it was recorded. A sync rebuilds the hashes from the file only when
     * it differs from the current version.
     */
    fingerprintVersion: integer('fingerprint_version'),
  },
  (t) => [
    unique('revisions_deck_number_unique').on(t.deckId, t.number),
    index('revisions_deck_status_idx').on(t.deckId, t.status),
  ],
);

export const slides = pgTable(
  'slides',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [index('slides_deck_idx').on(t.deckId)],
);

export const slideVersions = pgTable(
  'slide_versions',
  {
    id: text('id').primaryKey(),
    slideId: text('slide_id')
      .notNull()
      .references(() => slides.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    pptxSldId: integer('pptx_sld_id'),
    hidden: boolean('hidden').notNull().default(false),
    title: text('title'),
    layoutName: text('layout_name'),
    textHash: text('text_hash'),
    imageKey: text('image_key').notNull(),
    thumbnailKey: text('thumbnail_key').notNull(),
    aspectRatio: doublePrecision('aspect_ratio').notNull(),
    shapes: jsonb('shapes').$type<Shape[]>().notNull().default([]),
    /** PowerPoint drawing guides; empty for rows imported before they were read. */
    guides: jsonb('guides').$type<Guide[]>().notNull().default([]),
    /** SHA-256 of the rendered image, for slide matching (BER-108); filled lazily for old rows. */
    renderHash: text('render_hash'),
    /**
     * `ParsedSlide.contentHash`: what the SVG preview cannot see (charts, SmartArt, media, fills),
     * compared next to `render_hash` (BER-108). `null` for rows from before it.
     */
    contentHash: text('content_hash'),
    /** `p14:creationId` of the slide (unsigned 32 bit), tells a reused sldId apart. */
    creationId: bigint('creation_id', { mode: 'number' }),
    /**
     * What drew `image_key` (BER-94): Office's PDF, LibreOffice's PDF, or the in-house SVG
     * preview. `svg` means a better renderer was tried and failed; `null` means the SVG preview
     * and nothing better tried yet (rows from before this column, uploads without LibreOffice) –
     * those are re-rendered in the background once a better renderer is available.
     * `render_hash` stays the hash of the SVG preview either way.
     */
    renderer: text('renderer').$type<SlideRenderer>(),
  },
  (t) => [
    unique('slide_versions_revision_slide_unique').on(t.revisionId, t.slideId),
    index('slide_versions_revision_position_idx').on(t.revisionId, t.position),
    // Deleting slides cascades here row by row; also slide history and orphan cleanup.
    index('slide_versions_slide_idx').on(t.slideId),
    // Which images a re-render may delete (`rerender`: still used by another version?).
    index('slide_versions_image_key_idx').on(t.imageKey),
    index('slide_versions_thumbnail_key_idx').on(t.thumbnailKey),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    /** `null` for gap comments. */
    slideId: text('slide_id').references(() => slides.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => comments.id, { onDelete: 'cascade' }),
    /** Snapshot of the author at write time; PowerPoint authors have no `users` row. */
    author: jsonb('author').$type<Author>().notNull(),
    body: text('body').notNull(),
    anchor: jsonb('anchor').$type<Anchor>().notNull(),
    strokes: jsonb('strokes').$type<Stroke[]>().notNull().default([]),
    status: text('status').$type<CommentStatus>().notNull().default('open'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamptz('resolved_at'),
    source: text('source').$type<CommentSource>().notNull(),
    /** Id in the source file, so re-importing PowerPoint comments is idempotent (BER-114). */
    externalId: text('external_id'),
    /** PowerPoint comments: the status last seen in the file, to tell PPT changes from Slider ones. */
    externalStatus: text('external_status').$type<CommentStatus>(),
    /** PowerPoint comments deleted in the file are kept and flagged, never deleted (BER-114). */
    removedInSourceAt: timestamptz('removed_in_source_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('comments_deck_source_external_unique').on(t.deckId, t.source, t.externalId),
    index('comments_deck_created_idx').on(t.deckId, t.createdAt),
    index('comments_parent_idx').on(t.parentId),
    // Deleting slides cascades here row by row; also comment counts per slide.
    index('comments_slide_idx').on(t.slideId),
  ],
);

/**
 * PowerPoint comments deleted in Slider (tombstones): the next import of the file must not bring
 * them back, though they are still in it. Replies are keyed `<root>/<reply>` like `external_id`.
 */
export const deletedPptxComments = pgTable(
  'deleted_pptx_comments',
  {
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    deletedAt: timestamptz('deleted_at').notNull().defaultNow(),
    /**
     * What recognises a legacy comment again after PowerPoint for Microsoft 365 turned it into a
     * modern one with a new id (see `takeOverLegacy`): its slide, its parent comment (Slider id),
     * the SHA-256 of its trimmed text – not the text itself – and its creation time. `null` for
     * tombstones from before they were recorded.
     */
    slideId: text('slide_id'),
    parentId: text('parent_id'),
    bodyHash: text('body_hash'),
    commentCreatedAt: timestamptz('comment_created_at'),
  },
  (t) => [primaryKey({ columns: [t.deckId, t.externalId] })],
);

/**
 * A voice or video recording attached to a comment (BER-116), or the image drawn for it (`image`) –
 * at most one of each per comment. The bytes live in the media store.
 */
export const media = pgTable(
  'media',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    /** The deck owner at upload time – the storage quota is counted per owner. */
    ownerId: text('owner_id').notNull(),
    /** `Author.id` of whoever recorded it. */
    uploaderId: text('uploader_id').notNull(),
    kind: text('kind').$type<MediaKind | 'image'>().notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms').notNull(),
    peaks: jsonb('peaks').$type<number[]>().notNull().default([]),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('media_comment_kind_idx').on(t.commentId, t.kind),
    index('media_owner_idx').on(t.ownerId),
    index('media_deck_idx').on(t.deckId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
/**
 * Settings saved on the setup page (`/einrichtung`), keyed by their env name (`MS_CLIENT_ID`, …).
 * Secrets (`*_SECRET`) are AES-GCM encrypted with SLIDER_SECRET. The environment
 * always wins over these rows – see `services/instance-settings`.
 */
export const instanceSettings = pgTable('instance_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type DeckRow = typeof decks.$inferSelect;
export type DeckFolderRow = typeof deckFolders.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type SlideVersionRow = typeof slideVersions.$inferSelect;
/** Who drew a slide image – see `slide_versions.renderer`. */
export type { SlideRenderer };
export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
export type MediaRow = typeof media.$inferSelect;
