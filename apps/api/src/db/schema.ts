import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
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
  ImportState,
  MediaKind,
  ReviewLinkRole,
  RevisionStatus,
  RevisionTrigger,
  Shape,
  SlideDiffStatus,
  Stroke,
  SyncErrorCode,
  SyncSummary,
  TranscriptStatus,
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

/** The owner and other known people. Guests and PowerPoint authors don't need a row. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  color: text('color').$type<AccentColor>().notNull(),
  avatarKey: text('avatar_key'),
  /** Microsoft refresh token for OneDrive/SharePoint links, AES-GCM encrypted (`auth/token-crypto`). */
  msRefreshToken: text('ms_refresh_token'),
  /** The Microsoft account it belongs to (mail or UPN), for display. */
  msAccount: text('ms_account'),
  createdAt: createdAt(),
});

export const decks = pgTable(
  'decks',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
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
  },
  (t) => [index('decks_owner_updated_idx').on(t.ownerId, t.updatedAt)],
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
    /** Slide diff against the previous revision; `null` for revision 1. */
    diff: jsonb('diff').$type<RevisionDiffRecord>(),
    summary: jsonb('summary').$type<SyncSummary>(),
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
    /** SHA-256 of the rendered image, for slide matching (BER-108); filled lazily for old rows. */
    renderHash: text('render_hash'),
  },
  (t) => [
    unique('slide_versions_revision_slide_unique').on(t.revisionId, t.slideId),
    index('slide_versions_revision_position_idx').on(t.revisionId, t.position),
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
    /** Snapshot of the author at write time; guests and PowerPoint authors have no `users` row. */
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
  ],
);

/** A voice or video recording attached to a comment (BER-116). The bytes live in the media store. */
export const media = pgTable(
  'media',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    commentId: text('comment_id')
      .notNull()
      .unique()
      .references(() => comments.id, { onDelete: 'cascade' }),
    /** The deck owner at upload time – the storage quota is counted per owner. */
    ownerId: text('owner_id').notNull(),
    /** `Author.id` of whoever recorded it; only they may set the transcript. */
    uploaderId: text('uploader_id').notNull(),
    kind: text('kind').$type<MediaKind>().notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms').notNull(),
    peaks: jsonb('peaks').$type<number[]>().notNull().default([]),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    transcript: text('transcript'),
    transcriptStatus: text('transcript_status')
      .$type<TranscriptStatus>()
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [index('media_owner_idx').on(t.ownerId), index('media_deck_idx').on(t.deckId)],
);

export const reviewLinks = pgTable(
  'review_links',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    role: text('role').$type<ReviewLinkRole>().notNull(),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('review_links_deck_idx').on(t.deckId)],
);

export const guestSessions = pgTable(
  'guest_sessions',
  {
    id: text('id').primaryKey(),
    reviewLinkId: text('review_link_id')
      .notNull()
      .references(() => reviewLinks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    color: text('color').$type<AccentColor>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('guest_sessions_review_link_idx').on(t.reviewLinkId)],
);

export type UserRow = typeof users.$inferSelect;
export type DeckRow = typeof decks.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type SlideVersionRow = typeof slideVersions.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
export type MediaRow = typeof media.$inferSelect;
export type ReviewLinkRow = typeof reviewLinks.$inferSelect;
export type GuestSessionRow = typeof guestSessions.$inferSelect;
