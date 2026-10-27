import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
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
import { sql } from 'drizzle-orm';
import type {
  AccentColor,
  AiProposalStatus,
  AiProvider,
  Anchor,
  DeckEditSource,
  DowngradeReason,
  Author,
  CommentReactionKind,
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
  SlideOperation,
  SlideRenderer,
  StockPhoto,
  Stroke,
  SyncErrorCode,
  SyncSummary,
  WorkspaceRole,
} from '@slider/shared';
import { encryptedJson, encryptedJsonList, encryptedText } from './encrypted-columns';
import type { PdfMaker } from '../import/pdf-maker';

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
  /**
   * A version too big for the storage left (`storage_full`): its token and size, so later checks
   * do not download it again until there is room for that many bytes.
   */
  storageBlocked?: { token: string; bytes: number } | null;
  /**
   * The cloud's file changed while the deck has edits not saved yet (BER-180): its token. The
   * new version is not imported over the edits; saving decides. Cleared by saving.
   */
  cloudChangedToken?: string | null;
}

/** `decks.files_bytes`: what a review's files take up in blob storage, by kind. */
export interface DeckFilesBytes {
  originals: number;
  slideImages: number;
  other: number;
}

/** Slide diff of a revision against the one before (BER-108). */
export interface RevisionDiffRecord {
  previousRevisionId: string;
  slides: {
    slideId: string;
    status: SlideDiffStatus;
    moved: boolean;
    confidence: number;
    matchedBy: 'sourceId' | 'sldId' | 'content' | null;
    position: number;
    previousPosition: number | null;
    /** Hidden / shown again in this revision; absent when that did not change (and in old rows). */
    hiddenChanged?: 'hidden' | 'shown';
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
  /** Instance admin (BER-129): claimed with the setup token, never by signing in. */
  isInstanceAdmin: boolean('is_instance_admin').notNull().default(false),
  createdAt: createdAt(),
  /**
   * Last use of Slider (login, or a request on a session – renewed at most daily). Unused
   * accounts are deleted after 18 months, with reminder mails before (BER-147).
   */
  lastActiveAt: timestamptz('last_active_at').notNull().defaultNow(),
  /** Reminder mails sent since the last use (`services/inactive-accounts`); 0 while in use. */
  inactivityNotices: integer('inactivity_notices').notNull().default(0),
  /** When the last of those went out. */
  inactivityNoticeAt: timestamptz('inactivity_notice_at'),
  /**
   * Blocked by the instance admin (BER-167): signs in nowhere, its sessions are gone. Its data
   * and memberships stay; unblocking lets it in again.
   */
  blockedAt: timestamptz('blocked_at'),
});

/**
 * Microsoft accounts connected for OneDrive/SharePoint access – several per Slider account.
 * Each holds that account's refresh token; linked decks remember which one they sync through
 * (`decks.microsoft_connection_id`). At most {@link MAX_ACCOUNTS_PER_MICROSOFT} Slider accounts
 * share one Microsoft account (`subject`).
 */
export const microsoftConnections = pgTable(
  'microsoft_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Microsoft Graph id of the account (`/me` `id`). `legacy:<user id>` for a connection from
     * before it was recorded – the next connect of that Slider account takes it over.
     */
    subject: text('subject').notNull(),
    /** Mail or UPN, for display. */
    account: text('account'),
    /** Directory (`tid`) of the account, when the ID token told. */
    tenantId: text('tenant_id'),
    /** `user_identities.subject` (`<tid>:<oid>`) of the same account, when known. */
    identitySubject: text('identity_subject'),
    /**
     * AES-GCM encrypted (`auth/token-crypto`). `null` once Microsoft refused it (revoked,
     * expired): the connection stays, so signing in with that account again revives its decks.
     */
    refreshToken: text('refresh_token'),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
  },
  (t) => [
    unique('microsoft_connections_user_subject_unique').on(t.userId, t.subject),
    index('microsoft_connections_subject_idx').on(t.subject),
  ],
);

/**
 * Nextcloud accounts connected for file access (BER-135), several per Slider account (one per
 * server and Nextcloud user). Login Flow v2 hands out an app password: it has no scopes – full
 * access as that person – so it is stored encrypted and only ever used for reading
 * (`sources/nextcloud`). Linked decks remember which one they sync through
 * (`decks.nextcloud_connection_id`).
 */
export const nextcloudConnections = pgTable(
  'nextcloud_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Origin plus the path Nextcloud runs under, no trailing slash. */
    serverUrl: text('server_url').notNull(),
    /** What the person typed on the login page (name or mail) – shown in Slider. */
    loginName: text('login_name').notNull(),
    /** The Nextcloud user id: WebDAV paths are `/remote.php/dav/files/<id>/…`. */
    ncUserId: text('nc_user_id').notNull(),
    /**
     * AES-GCM encrypted (`auth/token-crypto`, own purpose). `null` once Nextcloud refused it
     * (revoked under Settings → Security): connecting the same account again revives its decks.
     */
    appPassword: text('app_password'),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
  },
  (t) => [
    unique('nextcloud_connections_user_server_account_unique').on(
      t.userId,
      t.serverUrl,
      t.ncUserId,
    ),
  ],
);

/**
 * Google accounts connected for Google Drive (BER-119), several per Slider account. Google grants
 * only `drive.file`: the files the person picked in Google's picker. Linked decks remember which
 * one they sync through (`decks.google_connection_id`).
 */
export const googleConnections = pgTable(
  'google_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Google's `sub` of the account. */
    subject: text('subject').notNull(),
    /** The Google address, for display. */
    account: text('account'),
    /**
     * AES-GCM encrypted (`auth/token-crypto`, own purpose). `null` once Google refused it (access
     * removed, expired): connecting the same account again revives its decks.
     */
    refreshToken: text('refresh_token'),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
  },
  (t) => [unique('google_connections_user_subject_unique').on(t.userId, t.subject)],
);

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
 * the configured issuer), `nextcloud` (`<server>:<user id>` of the organisation's Nextcloud) or
 * `email` (the lower-case address, login link by mail – BER-168). One account may have several.
 * Passkeys are not identities – they live in `passkeys` and never create accounts.
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

/** `sso`: a workspace's own company login (BER-162), subject `<workspace id>:<sub>`. */
export type IdentityProvider = 'microsoft' | 'google' | 'oidc' | 'nextcloud' | 'sso' | 'email';

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

/**
 * Mailed login links (BER-168, `services/email-login`): 15 minutes, single use, only in the
 * browser that asked. Only hashes of the link's token and of that browser's key are kept.
 */
export const loginLinks = pgTable('login_links', {
  /** SHA-256 of the token in the link (hex). */
  tokenHash: text('token_hash').primaryKey(),
  /** Lower-case address the link was sent to. */
  email: text('email').notNull(),
  /** SHA-256 of the signed cookie's key of the browser that asked (hex). */
  browserHash: text('browser_hash').notNull(),
  /** From a `/join/<token>` return path: lets invited people sign up. */
  inviteToken: text('invite_token'),
  returnTo: text('return_to').notNull(),
  createdAt: createdAt(),
  expiresAt: timestamptz('expires_at').notNull(),
  usedAt: timestamptz('used_at'),
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
  /**
   * Company workspace (BER-148): people with a verified address at this (lower-case) domain
   * find it and may join as members. `null`: private. One workspace per domain.
   */
  joinDomain: text('join_domain').unique(),
  /** Founded at sign-up, its admins not yet asked whether it is private or the company's. */
  audiencePending: boolean('audience_pending').notNull().default(false),
  /**
   * The one admin who pays (BER-154), apart from the admin role; the founder at first. Passes
   * on by itself when they leave (`services/billing-owner`).
   */
  billingOwnerId: text('billing_owner_id').references((): AnyPgColumn => users.id, {
    onDelete: 'set null',
  }),
  /** Admin the billing owner asked to take over paying; effective once they paid (BER-154). */
  billingTransferToId: text('billing_transfer_to_id').references((): AnyPgColumn => users.id, {
    onDelete: 'set null',
  }),
  billingTransferAt: timestamptz('billing_transfer_at'),
  /** Stripe customer of the billing owner for this workspace (BER-152). */
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  /** Stripe's subscription status (`active`, `past_due`, `canceled`, …). */
  subscriptionStatus: text('subscription_status'),
  currentPeriodEnd: timestamptz('current_period_end'),
  /** Cancelled to the end of the period: free from `current_period_end` on. */
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  /**
   * Paid without a working payment (BER-155): falls back to free at this time unless someone
   * pays. The hourly sweep reminds the admins and switches (`services/downgrade`).
   */
  downgradeAt: timestamptz('downgrade_at'),
  downgradeReason: text('downgrade_reason').$type<DowngradeReason>(),
  /** Reminder mails sent for the current `downgrade_at` (first, 7 days in, 1 day before). */
  downgradeNotices: integer('downgrade_notices').notNull().default(0),
  /**
   * Paid without Stripe, granted by the instance admin (BER-167), e.g. paid by invoice. Only
   * without a running subscription; checkout is closed meanwhile.
   */
  planGrantedAt: timestamptz('plan_granted_at'),
  /**
   * Blocked by the instance admin (BER-167): nobody opens it, nobody joins; its members can
   * still leave. Nothing is deleted for it.
   */
  blockedAt: timestamptz('blocked_at'),
  /**
   * The Anthropic API key of the workspace's AI (BER-183): sealed, never sent to a browser.
   * Set and removed by admins; every member's AI requests run on it.
   */
  aiApiKey: encryptedText('workspaces', 'ai_api_key'),
  /** `sk-ant-…AbCd` – what the settings show of the key. */
  aiKeyHint: text('ai_key_hint'),
  aiKeySetById: text('ai_key_set_by_id').references((): AnyPgColumn => users.id, {
    onDelete: 'set null',
  }),
  aiKeySetByName: text('ai_key_set_by_name'),
  aiKeySetAt: timestamptz('ai_key_set_at'),
  /** Why Anthropic refused the key last (removed, no credit, …); `null` while it works. */
  aiKeyError: text('ai_key_error'),
});

/** Stripe events already handled – webhooks arrive at least once, some twice (BER-152). */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  createdAt: createdAt(),
});

/**
 * A workspace's own company login (BER-162): its OpenID Connect provider, for people at its
 * company domain (`workspaces.join_domain`). Works only once a DNS TXT record proved the domain
 * (`verified_domain` equal to `join_domain`) – changing the domain turns it off by itself.
 */
export const workspaceSso = pgTable('workspace_sso', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Without a trailing slash, like the instance's `OIDC_ISSUER`. */
  issuer: text('issuer').notNull(),
  clientId: text('client_id').notNull(),
  clientSecret: encryptedText('workspace_sso', 'client_secret').notNull(),
  /** Expected in the TXT record `_slider-sso.<domain>` as `slider-sso=<token>`. */
  verifyToken: text('verify_token').notNull(),
  /** The domain the TXT record was found for, and when. */
  verifiedDomain: text('verified_domain'),
  verifiedAt: timestamptz('verified_at'),
  createdAt: createdAt(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
export type WorkspaceSsoRow = typeof workspaceSso.$inferSelect;

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
 * A font a workspace uploaded – one face (family, weight, italic) each. Slides of its decks are
 * drawn in it: LibreOffice gets it embedded in the file or in a font folder of its own, the live
 * editor loads it. The bytes live in the blob store; the metrics are LibreOffice's (hhea).
 */
export const workspaceFonts = pgTable(
  'workspace_fonts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The family a deck names it by (the file's typographic family). */
    family: text('family').notNull(),
    weight: integer('weight').notNull(),
    italic: boolean('italic').notNull(),
    format: text('format').$type<'ttf' | 'otf'>().notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    upm: integer('upm').notNull(),
    ascent: integer('ascent').notNull(),
    descent: integer('descent').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedById: text('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The deck (its title then) the face was taken from, as the file brought it; `null`: uploaded.
     * Encrypted at rest, like the deck's title.
     */
    sourceFile: encryptedText('workspace_fonts', 'source_file'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('workspace_fonts_face_idx').on(t.workspaceId, t.family, t.weight, t.italic)],
);
export type WorkspaceFontRow = typeof workspaceFonts.$inferSelect;

/**
 * The API keys of a workspace's AI: its admins store several – Anthropic, OpenAI, Gemini or a
 * service speaking OpenAI's API – and set one active; every member's AI requests run on that one,
 * with its model. Keys are sealed and never sent to a browser.
 */
export const workspaceAiKeys = pgTable(
  'workspace_ai_keys',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<AiProvider>().notNull(),
    /** The service's address – only for `custom`. */
    baseUrl: text('base_url'),
    apiKey: encryptedText('workspace_ai_keys', 'api_key').notNull(),
    /** `sk-…AbCd` – what the settings show of the key. */
    hint: text('hint').notNull(),
    model: text('model').notNull(),
    active: boolean('active').notNull().default(false),
    setById: text('set_by_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    setByName: text('set_by_name'),
    setAt: timestamptz('set_at').notNull(),
    /** Why the provider refused the key last (removed, no credit, …); `null` while it works. */
    error: text('error'),
  },
  (t) => [
    index('workspace_ai_keys_workspace_idx').on(t.workspaceId),
    // One active key per workspace at most.
    uniqueIndex('workspace_ai_keys_active_idx')
      .on(t.workspaceId)
      .where(sql`${t.active}`),
  ],
);
export type WorkspaceAiKeyRow = typeof workspaceAiKeys.$inferSelect;

/**
 * People an admin removed from a workspace: they don't come back by domain (`joinByDomain`),
 * only with an invitation – joining by one ends the entry. Leaving on one's own leaves none.
 * Also by a keyed hash of the address (`emailHash`): deleting the account and signing up again
 * must not lift it, so the row outlives the account (`user_id` set null) and goes with the
 * workspace. Rows from before the hash have none until their account is deleted.
 */
export const workspaceRemovals = pgTable(
  'workspace_removals',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    emailHash: text('email_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('workspace_removals_user_idx').on(t.workspaceId, t.userId),
    uniqueIndex('workspace_removals_email_idx').on(t.workspaceId, t.emailHash),
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
    /** The deck that was shared; `null` for plain workspace invites. */
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
    /**
     * Who linked or uploaded the file; uploads keep it when they pass to the workspace owner
     * (`services/workspaces/departure`). `null` once they are deleted.
     */
    linkedById: text('linked_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Access is decided by membership in this workspace (BER-129). */
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Encrypted at rest (BER-149), like the file name. */
    title: encryptedText('decks', 'title').notNull(),
    fileName: encryptedText('decks', 'file_name').notNull(),
    source: text('source').$type<DeckSource>().notNull(),
    /**
     * The link the deck was imported from (`null` for uploads); encrypted at rest (BER-149), it
     * often names the file.
     */
    sourceUrl: encryptedText('decks', 'source_url'),
    /**
     * Provider reference for re-sync: Graph `drives/{d}/items/{i}` or the final file URL. Stays
     * plaintext: it is looked up as a key.
     */
    sourceRef: text('source_ref'),
    /**
     * Who worked on the linked file, by name, most recent first – as the source tells: everyone
     * in its version history, its owner, whoever shared it, its creator. Shown as participants
     * and suggested for `@`. Read at import and with every new revision; `null` until first read
     * (uploads, decks linked before it was recorded), `[]` when the source could not tell.
     */
    sourceContributors: jsonb('source_contributors').$type<string[]>(),
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
    /**
     * The owner's Microsoft account the deck syncs through. `null` for uploads, anonymous links,
     * decks linked before several accounts existed and after a disconnect – then the owner's
     * connections are tried in turn and the first with access is remembered.
     */
    microsoftConnectionId: text('microsoft_connection_id').references(
      (): AnyPgColumn => microsoftConnections.id,
      { onDelete: 'set null' },
    ),
    /**
     * The owner's Nextcloud account the deck syncs through (BER-135). `null` for public shares
     * and after a disconnect – then the owner's accounts at the same server are tried.
     */
    nextcloudConnectionId: text('nextcloud_connection_id').references(
      (): AnyPgColumn => nextcloudConnections.id,
      { onDelete: 'set null' },
    ),
    /**
     * The owner's Google account the deck syncs through (BER-119). `null` for public links and
     * after a disconnect – then the owner's other Google accounts are tried.
     */
    googleConnectionId: text('google_connection_id').references(
      (): AnyPgColumn => googleConnections.id,
      { onDelete: 'set null' },
    ),
    /**
     * Reminder mails to the owner before an unused deck is deleted (`services/unused-decks`,
     * BER-143); they count only while nobody opened or changed it since `deletion_notice_at`.
     */
    deletionNotices: integer('deletion_notices').notNull().default(0),
    deletionNoticeAt: timestamptz('deletion_notice_at'),
    /**
     * Bytes of its files in blob storage – originals, slide images, the rest – measured after
     * every import and prune (`services/workspace-storage`, BER-151), so a workspace's storage
     * adds up without a `stat` per file. Recordings count from `media.size_bytes`. `null` until
     * first measured.
     */
    filesBytes: jsonb('files_bytes').$type<DeckFilesBytes>(),
    /**
     * Since when only selected accounts may open the deck (`deck_access_grants`), besides its
     * owner and the workspace admins; `null` = every member of the workspace may.
     */
    restrictedAt: timestamptz('restricted_at'),
    /**
     * When its oldest picture of the editor still kept was stored (`decks/<id>/edit-images/`);
     * `null` = none. The hourly job removes old ones (`services/old-edit-images`) by this, without
     * looking at every deck.
     */
    editImagesSince: timestamptz('edit_images_since'),
  },
  (t) => [
    index('decks_owner_updated_idx').on(t.ownerId, t.updatedAt),
    index('decks_edit_images_since_idx')
      .on(t.editImagesSince)
      .where(sql`${t.editImagesSince} is not null`),
    index('decks_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
    index('decks_microsoft_connection_idx').on(t.microsoftConnectionId),
    index('decks_nextcloud_connection_idx').on(t.nextcloudConnectionId),
    index('decks_google_connection_idx').on(t.googleConnectionId),
    // For the `on delete set null` of deleted revisions and folders: no scan of every deck.
    index('decks_current_revision_idx').on(t.currentRevisionId),
    index('decks_folder_idx').on(t.folderId),
  ],
);

/**
 * Who may open a restricted deck (`decks.restricted_at`) besides its owner and the workspace
 * admins. Rows are kept while the restriction is off, so turning it on again restores the list.
 * Keyed to the membership: leaving or being removed from the workspace takes the grant along.
 */
export const deckAccessGrants = pgTable(
  'deck_access_grants',
  {
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    /** Always the deck's workspace (decks never move between workspaces). */
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.deckId, t.userId] }),
    foreignKey({
      name: 'deck_access_grants_member_fk',
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete('cascade'),
    // For the cascade from `workspace_members`; the deck lists look up by the primary key.
    index('deck_access_grants_member_idx').on(t.workspaceId, t.userId),
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
    /**
     * SHA-256 (hex) of the original file, to skip re-imports of identical bytes – the file as it
     * came, also when it was turned into a PDF (a Word file, a picture).
     */
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
     * Who made the PDF this revision's file became (`import/pdf-maker`): Office or Google
     * (`office`), or LibreOffice. Its pages are the slide images under that renderer instead of
     * `pdf`; `null` for a PowerPoint, a PDF as it came, or a picture.
     */
    pdfRenderer: text('pdf_renderer').$type<PdfMaker>(),
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
    /**
     * When "Alles außer der neuesten Version löschen" removed this (older) revision's stored files
     * – original and slide images, unless a newer revision still uses them. Its rows, slides and
     * comments stay. `null` while its files are there.
     */
    filesDeletedAt: timestamptz('files_deleted_at'),
    /**
     * Storage held for this revision while it is imported (BER-151): the original's size,
     * recorded under the workspace lock in the same transaction whose storage check let it in.
     * A deck is measured (`decks.files_bytes`) only after its import, so without this two uploads
     * at once would both fit into the same rest. The workspace's storage counts it as an
     * original until the measurement after the import takes over the real sizes and clears it
     * (`measureDeckFiles`); a revision removed on failure takes it along. Slide images rendered
     * meanwhile are not reserved – the original is the one size known up front. `null` = nothing
     * held.
     */
    reservedBytes: integer('reserved_bytes'),
    /**
     * Edits made in Slider on top of the revision's file (BER-180), see `deck_edits`: the one
     * the revision shows now (`pptx_key` is its file) – 0 = the file as it came …
     */
    editSeq: integer('edit_seq').notNull().default(0),
    /** … and the one last saved back to the deck's cloud (0 = nothing saved since it came). */
    savedSeq: integer('saved_seq').notNull().default(0),
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
    /**
     * `revisionId:xml:id` of its `draw:page` once an edit in Slider removed or added it (BER-183):
     * the slide a page coming back (undo, redo) is, comments and all.
     */
    pageId: text('page_id'),
    createdAt: createdAt(),
  },
  (t) => [index('slides_deck_idx').on(t.deckId), index('slides_page_idx').on(t.deckId, t.pageId)],
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
    /** Encrypted at rest (BER-149), like `shapes` – the slide's text. */
    title: encryptedText('slide_versions', 'title'),
    layoutName: text('layout_name'),
    /** Hash of the slide text: guessable for short texts, so encrypted too (BER-149). */
    textHash: encryptedText('slide_versions', 'text_hash'),
    imageKey: text('image_key').notNull(),
    thumbnailKey: text('thumbnail_key').notNull(),
    aspectRatio: doublePrecision('aspect_ratio').notNull(),
    shapes: encryptedJson<Shape[]>('slide_versions', 'shapes').notNull().default([]),
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
     * The slide's id in its source, kept across exports: Google Slides' `objectId` (BER-157).
     * `null` for every other source, and for Google decks whose ids could not be read.
     */
    sourceSlideId: text('source_slide_id'),
    /**
     * What drew `image_key` (BER-94): Office's PDF, LibreOffice's PDF, or the in-house SVG
     * preview. `svg` means a better renderer was tried and failed; `null` means the SVG preview
     * and nothing better tried yet (rows from before this column, uploads without LibreOffice) –
     * those are re-rendered in the background once a better renderer is available.
     * `render_hash` stays the hash of the SVG preview either way.
     */
    renderer: text('renderer').$type<SlideRenderer>(),
    /** Its image or thumbnail was deleted with the files of older versions (`revisions.files_deleted_at`). */
    filesDeleted: boolean('files_deleted').notNull().default(false),
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

/**
 * The edit history of a revision edited in Slider (BER-180): one file snapshot per step, so undo
 * and redo give back exactly the file of that step. `seq` 0 is the file as it came; the
 * revision's `edit_seq` says which step it shows. A new edit after an undo drops the steps
 * beyond it.
 */
export const deckEdits = pgTable(
  'deck_edits',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    /** The whole file after this step. */
    fileKey: text('file_key').notNull(),
    operations: encryptedJsonList<SlideOperation>('deck_edits', 'operations').notNull(),
    source: text('source').$type<DeckEditSource>().notNull(),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [unique('deck_edits_revision_seq_unique').on(t.revisionId, t.seq)],
);

/**
 * A slide the AI changed, by its page id (`xml:id` of its `draw:page`, which stays with it when
 * slides move): rewritten or added (its XML before and after), moved, or removed.
 */
export interface AiSlideChange {
  pageId: string;
  /** 0-based position afterwards (before, if removed) – for the order of the list. */
  index: number;
  /** Its `draw:page` XML; `null` where it is not there (added: before, removed: after). */
  before: string | null;
  after: string | null;
  /** Its 0-based positions; slides not in the change keep their order around them. */
  beforeIndex: number | null;
  afterIndex: number | null;
  /** The styles the AI added (all of them, on every change). */
  styles: string[];
  /**
   * Pictures `after` shows that are not in the file before: from the comment thread (`mediaId`)
   * or stock photos (`imageId`, an edit picture of the deck) – put into the file on applying.
   */
  pictures?: ({ path: string; mediaId: string } | { path: string; imageId: string })[];
  /** The stock photo the AI put on this slide, and its other choices. */
  stock?: AiStockPhotos;
}

/** A stock photo as stored: with the address that reports it as used to Unsplash. */
export interface StockPhotoRecord extends StockPhoto {
  downloadLocation: string;
}

/** The AI's stock photo on a slide (see `services/stock-photos`). */
export interface AiStockPhotos {
  /** Its path in the file now, and its edit picture (to put it in again). */
  path: string;
  imageId: string;
  /** The frame's id, if the editor knows it, and its width / height (every choice is cut to it). */
  elementId: string | null;
  aspect: number | null;
  chosenId: string;
  /** The AI's choice first. */
  candidates: StockPhotoRecord[];
  /** Photos already reported to Unsplash as used. */
  reported: string[];
}

/**
 * What the AI did, asked from a comment (BER-183): it rewrites slides of the deck's ODP and
 * applies them right away as an edit step; the change can be taken back and applied again.
 */
export const aiProposals = pgTable(
  'ai_proposals',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    revisionId: text('revision_id')
      .notNull()
      .references(() => revisions.id, { onDelete: 'cascade' }),
    slideId: text('slide_id')
      .notNull()
      .references(() => slides.id, { onDelete: 'cascade' }),
    /** The comment that asked for it (⌘↵); its thread is the conversation with the AI. */
    commentId: text('comment_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    prompt: encryptedText('ai_proposals', 'prompt').notNull(),
    status: text('status').$type<AiProposalStatus>().notNull(),
    /** The edit step the proposal was made on. */
    baseSeq: integer('base_seq').notNull(),
    summary: encryptedText('ai_proposals', 'summary'),
    error: text('error'),
    /** The edit step that applied it. */
    appliedSeq: integer('applied_seq'),
    /** The slides it rewrote – taking it back puts `before` again, applying again `after`. */
    changes: encryptedJsonList<AiSlideChange>('ai_proposals', 'changes').notNull().default([]),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('ai_proposals_deck_idx').on(t.deckId, t.createdAt),
    index('ai_proposals_comment_idx').on(t.commentId),
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
    /** Encrypted at rest (BER-149); blank stays blank. */
    body: encryptedText('comments', 'body').notNull(),
    anchor: jsonb('anchor').$type<Anchor>().notNull(),
    /** Encrypted at rest (BER-149), text placed on the slide included; empty stays `[]`. */
    strokes: encryptedJsonList<Stroke>('comments', 'strokes').notNull().default([]),
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
 * Reactions to comments (👍 / 👎 / egal): one per account and comment. They go with the comment
 * and with the account – unlike comments, a deleted account leaves no anonymous reactions behind.
 */
export const commentReactions = pgTable(
  'comment_reactions',
  {
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Snapshot of the author at reaction time, like `comments.author`. */
    author: jsonb('author').$type<Author>().notNull(),
    kind: text('kind').$type<CommentReactionKind>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.userId] }),
    // Account deletion and export find someone's reactions.
    index('comment_reactions_user_idx').on(t.userId),
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
     * the SHA-256 of its trimmed text – not the text itself, and encrypted at rest (BER-149), since
     * a short text could be guessed from its hash – and its creation time. `null` for tombstones
     * from before they were recorded.
     */
    slideId: text('slide_id'),
    parentId: text('parent_id'),
    bodyHash: encryptedText('deleted_pptx_comments', 'body_hash'),
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
    /**
     * The deck owner at upload time. Storage counts per workspace now (BER-151, through the
     * deck), so this only records who owned the deck.
     */
    ownerId: text('owner_id').notNull(),
    /** `Author.id` of whoever recorded it. */
    uploaderId: text('uploader_id').notNull(),
    kind: text('kind').$type<MediaKind | 'image'>().notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms').notNull(),
    peaks: jsonb('peaks').$type<number[]>().notNull().default([]),
    /** Order of a comment's images (0, 1, …); always 0 for a recording. */
    position: integer('position').notNull().default(0),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('media_comment_kind_position_idx').on(t.commentId, t.kind, t.position),
    index('media_owner_idx').on(t.ownerId),
    index('media_deck_idx').on(t.deckId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type MicrosoftConnectionRow = typeof microsoftConnections.$inferSelect;
export type NextcloudConnectionRow = typeof nextcloudConnections.$inferSelect;
export type GoogleConnectionRow = typeof googleConnections.$inferSelect;
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

/**
 * Files that should be gone but whose deletion failed (storage unreachable, …): retried by the
 * hourly sweep until it works (`blob-deletions`), so nothing deleted stays on disk (BER-143).
 */
export const blobDeletions = pgTable(
  'blob_deletions',
  {
    store: text('store', { enum: ['storage', 'media'] }).notNull(),
    key: text('key').notNull(),
    /** `key` is a prefix: everything under it goes. */
    prefix: boolean('prefix').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.store, t.key] })],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type DeckRow = typeof decks.$inferSelect;
export type DeckFolderRow = typeof deckFolders.$inferSelect;
export type DeckAccessGrantRow = typeof deckAccessGrants.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type SlideVersionRow = typeof slideVersions.$inferSelect;
/** Who drew a slide image – see `slide_versions.renderer`. */
export type { SlideRenderer };
export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
export type CommentReactionRow = typeof commentReactions.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
