import {
  bigint,
  check,
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
  Attachment,
  SenderFileFiling,
  CloudAreaColor,
  ReaderAnchor,
  ReaderMarkBody,
  CloudAreaVisibility,
  CloudAgentFileKind,
  ApiSettings,
  CloudConnectionKind,
  CloudConnectionState,
  CloudConnectionTool,
  CloudAgentRepeatRule,
  CloudAgentWatch,
  CloudAgentUndo,
  CloudAgentFileStatus,
  CloudEventKind,
  CloudNodeKind,
  CloudShareRole,
  ShowRun,
  AppConnectionKind,
  MaterialChatAnswerState,
  MaterialQuestionKind,
  MaterialQuestionState,
  AccentColor,
  AiFeature,
  AiProposalStatus,
  IntegrationKind,
  IntegrationProvider,
  Anchor,
  DeckEditSource,
  DeckTemplate,
  DowngradeReason,
  Author,
  CommentReactionKind,
  CommentSource,
  CommentStatus,
  DeckSource,
  Guide,
  ImportState,
  MediaKind,
  MaterialKind,
  DeckCreationStatus,
  DeckKind,
  OutlineSlide,
  MaterialReadState,
  MaterialSheet,
  BoardItemKind,
  RevisionStatus,
  RevisionTrigger,
  Shape,
  SlideDiffStatus,
  SlideOperation,
  SlideRenderer,
  SlideTransition,
  StockPhoto,
  Stroke,
  SyncErrorCode,
  SyncSummary,
  TemplateColor,
  TranscriptStatus,
  WorkspaceRole,
  WriterAiState,
  WriterAnchor,
  WriterOperation,
  SenderChannelKind,
  Author as CallPerson,
  CallRecordLine,
  CallRecordNotes,
  CallRecordNotesState,
  CallRecordOrder,
  SenderMessageMail,
  SenderDraftTarget,
  MailAccountState,
  MailSignIn,
  MailAuth,
  MailFolderRole,
  MailContext,
  MailSummary,
  MailContextState,
  MailSpamBy,
  MailRuleKind,
  MailRuleMatch,
  MailPerson,
  TodoPriority,
  TodoSource,
  TodoStatus,
} from '@slider/shared';
import { encryptedJson, encryptedJsonList, encryptedText } from './encrypted-columns';
import type { PdfMaker } from '../import/pdf-maker';

/**
 * Database schema (BER-90). Designed for revisions from day one:
 * a `slide` is Slider's stable identity across revisions, a `slide_version` is
 * how that slide looks in one revision of the PPTX.
 */

/** Automatic update bookkeeping per deck (BER-107); `{}` until the first check. ISO timestamps. */
/**
 * The last pull of a linked deck from its source. Pulls happen only by hand ("Neu rendern");
 * keys of the automatic polling from before are still in older rows and ignored.
 */
export interface DeckSyncStateRow {
  lastCheckedAt?: string;
  lastSyncAt?: string;
  lastSyncError?: { code: SyncErrorCode; message: string; at: string } | null;
  importingRevisionId?: string | null;
  /**
   * A version too big for the storage left (`storage_full`): its token and size, so the next
   * pull does not download it again until there is room for that many bytes.
   */
  storageBlocked?: { token: string; bytes: number } | null;
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
    /** `sourceId`: only in old rows – Google Slides' `objectId` (BER-157, retired). */
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
  /**
   * The voice agents speak with in the calls where this person called them or brought them in
   * (a Mistral voice's slug, personal settings); `null`: a German one.
   */
  callVoice: text('call_voice'),
  /**
   * How often this person's mailboxes are read from their servers, in minutes (Einstellungen ›
   * Mail › Aktualisieren): `null` the clock's round, every minute; 0 only when asked.
   */
  mailSyncMinutes: integer('mail_sync_minutes'),
});

/**
 * Retired with OneDrive/SharePoint: Microsoft accounts once connected for file access. Nothing
 * adds rows any more – `retireFileConnections` deletes what is left at start; the table stays
 * for that cleanup only.
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
 * Retired with Google Drive (BER-119): Google accounts once connected for file access. Nothing
 * adds rows any more – `retireFileConnections` revokes each grant at Google and deletes the row
 * at start; the table stays for that cleanup only.
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
 * AI apps that registered themselves to sign in over OAuth (RFC 7591 – Claude, ChatGPT …): a
 * public client (PKCE, no secret) with the addresses it may be sent back to. Its name is what it
 * calls itself – shown to the person it asks, beside where it goes back to.
 */
export const appClients = pgTable('app_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  createdAt: createdAt(),
});

/**
 * An AI app let into an account over MCP („KI-Apps“ on `/konto`): over OAuth (`client_id`, a
 * short-lived access token renewed with its refresh token) or a token made by its person (no
 * expiry, until removed). Only the tokens' SHA-256 is kept, like `sessions`. `workspace_id`:
 * only that workspace; `null`: all of the account's.
 */
export const appConnections = pgTable(
  'app_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AppConnectionKind>().notNull(),
    clientId: text('client_id'),
    name: text('name').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    accessHash: text('access_hash').notNull().unique(),
    /** `null`: a token made by hand, valid until removed. */
    accessExpiresAt: timestamptz('access_expires_at'),
    refreshHash: text('refresh_hash').unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamptz('last_used_at'),
  },
  (t) => [index('app_connections_user_idx').on(t.userId)],
);

/** An OAuth code handed back to an app, swapped for its tokens once, within minutes. */
export const appCodes = pgTable('app_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  /** PKCE: SHA-256 of the app's verifier, base64url. */
  codeChallenge: text('code_challenge').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  createdAt: createdAt(),
});

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
  /** What its admins named the AI; `null`: `KI`. */
  aiName: text('ai_name'),
  /** An agent writes along in every call and sends notes and tasks afterwards (admins turn it off). */
  callNotes: boolean('call_notes').notNull().default(true),
  /** How its agents look (`AGENT_AVATAR_STYLES`), picked by its admins. */
  agentAvatars: text('agent_avatars').notNull().default('flowers'),
  /**
   * Per kind, the model it runs the instance's key on, where the instance lets it pick one – for
   * that key only: once the instance sets another active, the instance's model applies again.
   * `createModel` (AI): the one a deck is created on, `quickModel` (AI) the one of quick
   * requests; each left out: the instance's.
   */
  integrationModels: jsonb('integration_models')
    .$type<
      Partial<
        Record<
          IntegrationKind,
          { keyId: string; model?: string; createModel?: string; quickModel?: string }
        >
      >
    >()
    .notNull()
    .default({}),
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

/** A word an account said is right („Passt so“): the spell check no longer marks it, anywhere. */
export const userWords = pgTable(
  'user_words',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.word] })],
);

/** A word someone said is right in a deck of the workspace: not marked for anyone in it. */
export const workspaceWords = pgTable(
  'workspace_words',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    word: text('word').notNull(),
    addedById: text('added_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.word] })],
);

/** A layout of a design, as stored: its pictures in the blob store. */
export interface WorkspaceMasterLayoutRow {
  name: string | null;
  master: string | null;
  imageKey: string;
  thumbnailKey: string;
}

/**
 * A company design a workspace uploaded as slide masters, a template (`.otp`, `.potx`): the
 * file as kept, and a picture of each layout – drawn by LibreOffice with placeholders saying
 * "Titel" and "Text", or as Slider's own preview without it. All under
 * `workspaces/<id>/masters/<masterId>/`.
 */
export const workspaceMasters = pgTable(
  'workspace_masters',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The file's name without its extension. Encrypted at rest, like a deck's title. */
    name: encryptedText('workspace_masters', 'name').notNull(),
    format: text('format').$type<'pptx' | 'odp'>().notNull(),
    fileKey: text('file_key').notNull(),
    /** The file and the layout pictures together. */
    sizeBytes: integer('size_bytes').notNull(),
    aspectRatio: doublePrecision('aspect_ratio').notNull(),
    /** Encrypted at rest: the layout names come from the file. */
    layouts: encryptedJson<WorkspaceMasterLayoutRow[]>('workspace_masters', 'layouts').notNull(),
    uploadedById: text('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Designed in Slider: the template deck (`decks.is_template`) it is edited in. */
    draftDeckId: text('draft_deck_id').references((): AnyPgColumn => decks.id, {
      onDelete: 'set null',
    }),
    /** Its colours – the only ones decks made from it offer. Set where it is designed. */
    colors: jsonb('colors').$type<TemplateColor[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index('workspace_masters_workspace_idx').on(t.workspaceId)],
);
export type WorkspaceMasterRow = typeof workspaceMasters.$inferSelect;

/**
 * The API keys of the integrations – the AI's models, speech to text, photos: per kind, the
 * instance (`workspaceId` null) and each workspace store several and set one active. A workspace
 * without an active key of a kind uses the instance's, as far as the instance's rule for it lets
 * it (`integration-keys`). Keys are sealed and never sent to a browser.
 */
export const integrationKeys = pgTable(
  'integration_keys',
  {
    id: text('id').primaryKey(),
    /** `null`: the instance's own. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<IntegrationKind>().notNull(),
    provider: text('provider').$type<IntegrationProvider>().notNull(),
    /** The service's address – for `custom`, or one changed from the usual. */
    baseUrl: text('base_url'),
    // Sealed under the table's first name: the keys stored then still open.
    apiKey: encryptedText('workspace_ai_keys', 'api_key').notNull(),
    /** `sk-…AbCd` – what the settings show of the key. */
    hint: text('hint').notNull(),
    /** The model it runs on; empty for photos. */
    model: text('model').notNull(),
    /** AI only: the model a deck is created on („Präsentation erstellen“); `null`: `model`. */
    createModel: text('create_model'),
    /** AI only: the model of quick requests (`runToolCall`); `null`: `defaultQuickModel`. */
    quickModel: text('quick_model'),
    active: boolean('active').notNull().default(false),
    setById: text('set_by_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    setByName: text('set_by_name'),
    setAt: timestamptz('set_at').notNull(),
    /** Why the service refused the key last (removed, no credit, …); `null` while it works. */
    error: text('error'),
  },
  (t) => [
    index('integration_keys_workspace_idx').on(t.workspaceId),
    // One active key per kind and workspace at most – and per kind for the instance.
    uniqueIndex('integration_keys_active_idx')
      .on(t.workspaceId, t.kind)
      .where(sql`${t.active} AND ${t.workspaceId} IS NOT NULL`),
    uniqueIndex('integration_keys_instance_active_idx')
      .on(t.kind)
      .where(sql`${t.active} AND ${t.workspaceId} IS NULL`),
  ],
);
export type IntegrationKeyRow = typeof integrationKeys.$inferSelect;

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
    /** Who created the deck; their Nextcloud connection keeps a linked deck in sync. */
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
    /** In the trash since then, put there by `deletedBy` (plain id – the row outlives the account). */
    deletedAt: timestamptz('deleted_at'),
    deletedBy: text('deleted_by'),
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
     * Where it lies in Cloud: the file that stands for it there (`services/deck-places.ts`).
     * Its folder says who sees the deck – one's own files: its owner alone. `null`: no place yet
     * (decks from before), open to the workspace as ever.
     */
    cloudNodeId: text('cloud_node_id').references((): AnyPgColumn => cloudNodes.id, {
      onDelete: 'set null',
    }),
    /**
     * Retired with OneDrive/SharePoint: the Microsoft account an old deck synced through. Always
     * `null` once `retireFileConnections` ran; the column stays for that cleanup only.
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
     * Retired with Google Drive (BER-119): the Google account an old deck synced through. Always
     * `null` once `retireFileConnections` ran; the column stays for that cleanup only.
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
    /**
     * The workspace's design (`workspace_masters`) the deck is built on: made from it, or found
     * in its file on import (`linkDeckMaster`). The editor offers its layouts. `null` = none.
     */
    masterId: text('master_id').references((): AnyPgColumn => workspaceMasters.id, {
      onDelete: 'set null',
    }),
    /**
     * A template being designed in the editor, no review: left out of the projects, their
     * search and the plan's deck count. Its slides are the layouts; `template_design` keeps what
     * the file cannot say yet (layout names, placeholders, guides).
     */
    isTemplate: boolean('is_template').notNull().default(false),
    /** Encrypted at rest: the layout names are the members' words. `null` for a review. */
    templateDesign: encryptedJson<DeckTemplate>('decks', 'template_design'),
    /** Its own colours beside its template's („Eigene“ in the colour pickers), `#rrggbb`. */
    customColors: jsonb('custom_colors').$type<string[]>().notNull().default([]),
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
    uniqueIndex('decks_cloud_node_idx').on(t.cloudNodeId),
    index('decks_folder_idx').on(t.folderId),
    index('decks_master_idx').on(t.masterId),
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
     * Retired with Office's PDF (BER-94): why it was tried and not used, on old rows only. Nothing
     * writes or reads it any more.
     */
    officeFailure: text('office_failure'),
    /**
     * Who made the PDF this revision's file became (`import/pdf-maker`): LibreOffice (`office`
     * only on old rows, from OneDrive and Google Drive). Its pages are the slide images under that
     * renderer instead of `pdf`; `null` for a PowerPoint, a PDF as it came, or a picture.
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
    /**
     * A variant of another slide of the revision (made in the editor, `slider:variant-of` in the
     * ODP): that slide's id. It shows above that slide, not in the deck.
     */
    variantOf: text('variant_of'),
    /**
     * How the slide comes in when presenting (ODP's page transition), for every viewer of the slide
     * show; `null`: none Slider plays, or not read yet (rows from before it, PPTX and PDF).
     */
    transition: text('transition').$type<SlideTransition>(),
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
     * Retired with Google Slides (BER-157): its `objectId`, set only on old rows of Google decks.
     * Nothing writes or reads it any more; the column stays for those rows.
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
    /**
     * The editor's own id for the edit this step made (`ApplyEditInput.clientEditId`): the same
     * edit sent again – a retry, a reload, after a restart of the server too – is found by it
     * and not applied twice.
     */
    clientEditId: text('client_edit_id'),
    /**
     * What the step left out (`FileChange.dropped`): operations that did not fit – or, taking a
     * step back, slides someone changed the same way since. The same edit sent again gets it
     * back; `null` on steps from before it was kept (counted then from `operations`).
     */
    dropped: integer('dropped'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('deck_edits_revision_seq_unique').on(t.revisionId, t.seq),
    uniqueIndex('deck_edits_client_edit_idx')
      .on(t.deckId, t.clientEditId)
      .where(sql`${t.clientEditId} is not null`),
  ],
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
  /**
   * Layouts the AI took in from the workspace's templates (all of them, on every change) – taken
   * into the file on applying, before the slides that name them.
   */
  layouts?: AiTakenLayout[];
}

/** A template's layout the AI took into its copy of the deck. */
export interface AiTakenLayout {
  /** The workspace's template (`workspace_masters.id`) and its master page. */
  template: string;
  master: string;
  /** The master page's name in the AI's copy – the slides name it so. */
  as: string;
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
    /** Its reply asks the people something about the request: the thread stays open. */
    asks: boolean('asks').notNull().default(false),
    error: text('error'),
    /** The edit step that applied it. */
    appliedSeq: integer('applied_seq'),
    /**
     * That step's row (`deck_edits.id`): a step undone and replaced by another makes another
     * row at the same `seq` – only the id tells the proposal's own step from it. `null` on
     * proposals applied before it was kept.
     */
    appliedEditId: text('applied_edit_id'),
    /** The slides it rewrote – taking it back puts `before` again, applying again `after`. */
    changes: encryptedJsonList<AiSlideChange>('ai_proposals', 'changes').notNull().default([]),
    /**
     * Its card closed („Erledigt“) – for everyone, like a thread's done state (`comments`); set
     * on a variant's answer, which has no thread. `null`: open.
     */
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamptz('resolved_at'),
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
    /**
     * Roots only: where the thread stands, in short, once it asked the AI more than three times –
     * written by the AI after each further request settles (`thread-summaries.ts`). Encrypted.
     */
    aiSummary: encryptedText('comments', 'ai_summary'),
    aiSummaryAt: timestamptz('ai_summary_at'),
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

/** Reactions to the AI's answers (👍 / 👎 / egal), as `commentReactions`: one per account and answer. */
export const aiProposalReactions = pgTable(
  'ai_proposal_reactions',
  {
    proposalId: text('proposal_id')
      .notNull()
      .references(() => aiProposals.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Snapshot of the author at reaction time, like `comments.author`. */
    author: jsonb('author').$type<Author>().notNull(),
    kind: text('kind').$type<CommentReactionKind>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.proposalId, t.userId] }),
    // Account deletion and export find someone's reactions.
    index('ai_proposal_reactions_user_idx').on(t.userId),
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
    /** What a recording says (`transcriptStatus` `done`); made on the server after the upload. */
    transcript: encryptedText('media', 'transcript'),
    transcriptStatus: text('transcript_status').$type<TranscriptStatus>().notNull().default('none'),
    /** The transcript in short, made when the comment goes to the AI; shown in its place. */
    transcriptSummary: encryptedText('media', 'transcript_summary'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('media_comment_kind_position_idx').on(t.commentId, t.kind, t.position),
    index('media_owner_idx').on(t.ownerId),
    index('media_deck_idx').on(t.deckId),
  ],
);

/**
 * Files on a deck's material page „Material“ (`services/materials.ts`). Never part of the
 * deck's file: the ODP, exports and the slide count never see them. The bytes lie in the media
 * store under the deck's prefix (gone with the deck); their text, once read, in
 * `material_chunks`. Where a card lies on the board (`x`, `y`) and how big (`w`, `h`) in board
 * units; `expanded` for a card opened up on the board (later).
 */
export const deckMaterials = pgTable(
  'deck_materials',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id').references(() => decks.id, { onDelete: 'cascade' }),
    /** A Writer document's board instead of a deck's: exactly one of the two is set. */
    documentId: text('document_id').references(() => cloudNodes.id, { onDelete: 'cascade' }),
    /** Snapshot of who put it down, like `comments.author`. */
    author: jsonb('author').$type<Author>().notNull(),
    /** The file's name; encrypted at rest (BER-149). */
    name: encryptedText('deck_materials', 'name').notNull(),
    kind: text('kind').$type<MaterialKind>().notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    /** A small JPEG of it (first PDF page, the picture itself) in the media store. */
    previewKey: text('preview_key'),
    sha256: text('sha256').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w').notNull(),
    h: doublePrecision('h').notNull(),
    expanded: boolean('expanded').notNull().default(false),
    /** Came from a folder on the board (`deck_board_items` kind `folder`): that folder. */
    folderId: text('folder_id'),
    /** How far its text is read (`MaterialReadState`). */
    readState: text('read_state').$type<MaterialReadState>().notNull().default('none'),
    /** The beginning of its text (or its sheets), for the AI's list. Encrypted. */
    summary: encryptedText('deck_materials', 'summary'),
    /** Pages of a PDF or document, slides of a presentation, sheets of a spreadsheet. */
    pages: integer('pages'),
    /** A spreadsheet's sheets with their sizes; encrypted, empty stays `[]`. */
    sheets: encryptedJsonList<MaterialSheet>('deck_materials', 'sheets').notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('deck_materials_deck_idx').on(t.deckId, t.createdAt),
    index('deck_materials_document_idx').on(t.documentId, t.createdAt),
    check('deck_materials_owner_check', sql`num_nonnulls(${t.deckId}, ${t.documentId}) = 1`),
  ],
);

/** Notes and links on a deck's material page, beside its files. */
export const deckBoardItems = pgTable(
  'deck_board_items',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id').references(() => decks.id, { onDelete: 'cascade' }),
    /** A Writer document's board instead of a deck's: exactly one of the two is set. */
    documentId: text('document_id').references(() => cloudNodes.id, { onDelete: 'cascade' }),
    author: jsonb('author').$type<Author>().notNull(),
    kind: text('kind').$type<BoardItemKind>().notNull(),
    /** A note's text, a link's title. Encrypted; blank stays blank. */
    text: encryptedText('deck_board_items', 'text').notNull(),
    /** A link's address; encrypted. */
    url: encryptedText('deck_board_items', 'url'),
    /**
     * A note's things on the board (files, links, notes – their ids). None: a note on its own,
     * `x`…`h` its box (a sticker). One: the note is beside it, no box. Several: its box drawn round
     * them. It goes with the last of them (`deleteBoardItem`).
     */
    boundIds: jsonb('bound_ids').$type<string[]>().notNull().default([]),
    /** A note's or frame's colour of its own; `null`: its author's. */
    color: text('color').$type<AccentColor>(),
    /** A sticker's rich text (Lexical's editor state); `text` holds it as Markdown. Sealed. */
    rich: encryptedJson<unknown>('deck_board_items', 'rich'),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w').notNull(),
    h: doublePrecision('h').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('deck_board_items_deck_idx').on(t.deckId, t.createdAt),
    index('deck_board_items_document_idx').on(t.documentId, t.createdAt),
    check('deck_board_items_owner_check', sql`num_nonnulls(${t.deckId}, ${t.documentId}) = 1`),
  ],
);

/**
 * A note's thread on the material page, as a comment's on a slide: the note itself asked with ⌘↵
 * (`note` – its text the question, at most one, first) and the replies written under it (`reply`
 * – a person's text, the AI asked or not), each with the AI's answer if it was asked (Markdown
 * with citations of the board's files). Gone with the note; seen by everyone who sees the board,
 * like the note. Encrypted like every content (BER-149).
 */
export const materialQuestions = pgTable(
  'material_questions',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id').references(() => decks.id, { onDelete: 'cascade' }),
    /** A Writer document's board instead of a deck's: exactly one of the two is set. */
    documentId: text('document_id').references(() => cloudNodes.id, { onDelete: 'cascade' }),
    /** The note asked (`deck_board_items`): its answer goes with it. */
    noteId: text('note_id')
      .notNull()
      .references(() => deckBoardItems.id, { onDelete: 'cascade' }),
    /** Who asked; `null` once their account is gone – the answer stays with the note. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** `note`: the note asked; `reply`: a reply under it. */
    kind: text('kind').$type<MaterialQuestionKind>().notNull().default('note'),
    /** Who wrote a reply, as it is shown (`null` for the note asked – the note's author shows). */
    author: jsonb('author').$type<Author>(),
    question: encryptedText('material_questions', 'question').notNull(),
    answer: encryptedText('material_questions', 'answer').notNull(),
    /** `null`: a reply the AI was not asked about. */
    state: text('state').$type<MaterialQuestionState>(),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('material_questions_note_idx').on(t.noteId, t.createdAt),
    index('material_questions_deck_idx').on(t.deckId, t.createdAt),
    index('material_questions_document_idx').on(t.documentId, t.createdAt),
    check('material_questions_owner_check', sql`num_nonnulls(${t.deckId}, ${t.documentId}) = 1`),
  ],
);
export type MaterialQuestionRow = typeof materialQuestions.$inferSelect;

/**
 * A person's chat with the AI on the material page (✨, `services/material-chat.ts`): theirs
 * only, kept until they delete it, gone with the deck or their account. Encrypted like every
 * content (BER-149).
 */
export const materialChats = pgTable(
  'material_chats',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id').references(() => decks.id, { onDelete: 'cascade' }),
    /** A Writer document's board instead of a deck's: exactly one of the two is set. */
    documentId: text('document_id').references(() => cloudNodes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The start of its first message. */
    title: encryptedText('material_chats', 'title').notNull(),
    createdAt: createdAt(),
    /** Its latest message: the list sorts by it. */
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('material_chats_deck_user_idx').on(t.deckId, t.userId, t.updatedAt),
    index('material_chats_document_idx').on(t.documentId, t.userId, t.updatedAt),
    check('material_chats_owner_check', sql`num_nonnulls(${t.deckId}, ${t.documentId}) = 1`),
  ],
);
export type MaterialChatRow = typeof materialChats.$inferSelect;

/** A chat's messages in order (`seq`): the person's and the AI's answers, as they ended. */
export const materialChatMessages = pgTable(
  'material_chat_messages',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => materialChats.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    text: encryptedText('material_chat_messages', 'text').notNull(),
    /** Files put on it (`services/attachments.ts`), in their order. */
    attachments: encryptedJsonList<Attachment>('material_chat_messages', 'attachments')
      .notNull()
      .default([]),
    /** How the AI's answer ended; `null` for the person's message. */
    state: text('state').$type<MaterialChatAnswerState>(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('material_chat_messages_chat_seq_idx').on(t.chatId, t.seq)],
);

/**
 * The text of a file on the board, in pieces of a few thousand characters (a PDF page, a part of
 * a long one, a block of a sheet's rows) – what the AI reads and searches (`material-tools.ts`).
 * Encrypted at rest like every content (BER-149), so the search reads and compares the pieces
 * of one deck in the server, not in SQL.
 */
export const materialChunks = pgTable(
  'material_chunks',
  {
    materialId: text('material_id')
      .notNull()
      .references(() => deckMaterials.id, { onDelete: 'cascade' }),
    deckId: text('deck_id').references(() => decks.id, { onDelete: 'cascade' }),
    /** A Writer document's board instead of a deck's: exactly one of the two is set. */
    documentId: text('document_id').references(() => cloudNodes.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    /** The page (1-based) it is from; `null` for a sheet or a text file. */
    page: integer('page'),
    /** The sheet it is from; encrypted. */
    sheet: encryptedText('material_chunks', 'sheet'),
    text: encryptedText('material_chunks', 'text').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.materialId, t.seq] }),
    index('material_chunks_deck_idx').on(t.deckId),
    index('material_chunks_document_idx').on(t.documentId),
    check('material_chunks_owner_check', sql`num_nonnulls(${t.deckId}, ${t.documentId}) = 1`),
  ],
);

/**
 * A new deck built by the AI from the prompt on Folie 1 (`services/deck-creation`): offered when
 * a deck is made blank, then what was asked and how far the run got. One per deck.
 */
export const deckCreations = pgTable('deck_creations', {
  deckId: text('deck_id')
    .primaryKey()
    .references(() => decks.id, { onDelete: 'cascade' }),
  status: text('status').$type<DeckCreationStatus>().notNull(),
  kind: text('kind').$type<DeckKind>(),
  pages: integer('pages'),
  /** The workspace's template (`workspace_masters`) asked for; `null`: Slider's own look. */
  templateId: text('template_id'),
  /** What the deck is to be about, as typed or said; encrypted. */
  description: encryptedText('deck_creations', 'description'),
  outline: encryptedJson<OutlineSlide[]>('deck_creations', 'outline'),
  built: integer('built').notNull().default(0),
  /**
   * The deck's edit step when it was last idle with nothing built (offered, or ended before a
   * slide): any step since means someone started on the deck, and the prompt no longer shows.
   */
  idleSeq: integer('idle_seq').notNull().default(0),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});
export type DeckCreationRow = typeof deckCreations.$inferSelect;

export type UserRow = typeof users.$inferSelect;
export type NextcloudConnectionRow = typeof nextcloudConnections.$inferSelect;
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

/**
 * Every request to an AI service (`ai-usage`): what it used (tokens, audio, pictures) – for the
 * instance dashboard. Never what was asked or answered. Outlives the workspace and the key
 * (set null): the instance still paid for it.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    at: timestamptz('at').notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    keyId: text('key_id').references(() => integrationKeys.id, { onDelete: 'set null' }),
    /** Ran on the instance's key – the instance pays – not on one of the workspace's own. */
    instanceKey: boolean('instance_key').notNull(),
    feature: text('feature').$type<AiFeature>().notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    audioSeconds: doublePrecision('audio_seconds').notNull().default(0),
    images: integer('images').notNull().default(0),
  },
  (t) => [index('ai_usage_at_idx').on(t.at)],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type DeckRow = typeof decks.$inferSelect;
export type DeckFolderRow = typeof deckFolders.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type SlideVersionRow = typeof slideVersions.$inferSelect;
export type DeckEditRow = typeof deckEdits.$inferSelect;
/** Who drew a slide image – see `slide_versions.renderer`. */
export type { SlideRenderer };
export type CommentRow = typeof comments.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type DeckMaterialRow = typeof deckMaterials.$inferSelect;
export type DeckBoardItemRow = typeof deckBoardItems.$inferSelect;

/** Completed presentations; at most five per deck, recording in the deck's blob folder. */
export const showRuns = pgTable(
  'show_runs',
  {
    id: text('id').primaryKey(),
    deckId: text('deck_id').notNull(),
    at: timestamptz('at').notNull(),
    summary: encryptedJson<ShowRun>('show_runs', 'summary').notNull(),
    recordingKey: text('recording_key'),
    /** Who saved the run: their recording is theirs (data export, deleted with the account). */
    recordedBy: text('recorded_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('show_runs_deck_idx').on(table.deckId),
    foreignKey({
      columns: [table.deckId],
      foreignColumns: [decks.id],
      name: 'show_runs_deck_id_fkey',
    }).onDelete('cascade'),
  ],
);

// ── Cloud: the workspace's files ────────────────────────────────────────────

/**
 * An area („Bereich“) of a workspace's files: a team's place with a colour and people, in place
 * of a folder tree someone has to keep. `visibility` `workspace`: everyone in the workspace sees
 * it; `members`: only the people named for it (`cloud_area_members`) and the workspace's admins.
 */
export const cloudAreas = pgTable(
  'cloud_areas',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * The area it lies under in the side bar („Unterbereich“); `null`: at the top. Only where it
     * is listed: its people, its visibility and its files are its own.
     */
    parentId: text('parent_id').references((): AnyPgColumn => cloudAreas.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    color: text('color').$type<CloudAreaColor>().notNull(),
    visibility: text('visibility').$type<CloudAreaVisibility>().notNull().default('workspace'),
    /** Order in the side bar; new ones go last. */
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The workspace itself as an area, one each, there from the start: called as the workspace
     * is, open to it, its people are the workspace's. Not deleted, not renamed; the other areas
     * are listed under it.
     */
    root: boolean('root').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('cloud_areas_workspace_idx').on(t.workspaceId),
    uniqueIndex('cloud_areas_root_idx')
      .on(t.workspaceId)
      .where(sql`${t.root}`),
  ],
);
export type CloudAreaRow = typeof cloudAreas.$inferSelect;

/** The people of an area, and what they do there („Leitung Vertrieb“). */
export const cloudAreaMembers = pgTable(
  'cloud_area_members',
  {
    areaId: text('area_id')
      .notNull()
      .references(() => cloudAreas.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.areaId, t.userId] }),
    index('cloud_area_members_user_idx').on(t.userId),
  ],
);

/**
 * A file or a folder. In an area (`area_id`) or, without one, in its owner's own files („Meine
 * Dateien“ – nobody else sees them unless shared). The name is encrypted at rest like a deck's
 * title, so listing, sorting and searching by name happen in the server, not in SQL.
 *
 * A file's bytes are its versions (`cloud_versions`); `size_bytes` is the current one's.
 * Deleted: `deleted_at` on it and on everything in it, `deleted_root_id` naming what was deleted
 * (itself, or the folder that took it along) – restoring brings back exactly that.
 */
export const cloudNodes = pgTable(
  'cloud_nodes',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'cascade' }),
    /** A folder's own colour (an accent or `#rrggbb`); `null`: the plain one. */
    color: text('color').$type<CloudAreaColor>(),
    /**
     * Who put it there. In one's own files also whose it is; `null` once that account is gone –
     * such files of nobody are cleared by the sweep.
     */
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    parentId: text('parent_id').references((): AnyPgColumn => cloudNodes.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').$type<CloudNodeKind>().notNull(),
    name: encryptedText('cloud_nodes', 'name').notNull(),
    /** Lower case, without the dot; `''` for none and for folders. Plain: filters count by it. */
    extension: text('extension').notNull().default(''),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    currentVersionId: text('current_version_id'),
    versionCount: integer('version_count').notNull().default(0),
    /** The small picture of the current version: not tried, there, or not possible. */
    thumbnail: text('thumbnail').$type<'none' | 'ready' | 'failed'>().notNull().default('none'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamptz('deleted_at'),
    deletedBy: text('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    deletedRootId: text('deleted_root_id'),
    /**
     * When it last changed for someone keeping a copy (name, place, bytes, deleted): set by a
     * trigger from the database's clock, never by the code – `services/cloud/sync.ts` reads it.
     */
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
    /**
     * Where it lay before it last moved (area, owner, folder): set by a trigger, never by the
     * code. A computer is told to drop it from there only if it could see it there.
     */
    leftAreaId: text('left_area_id'),
    leftOwnerId: text('left_owner_id'),
    leftParentId: text('left_parent_id'),
  },
  (t) => [
    index('cloud_nodes_changed_idx').on(t.workspaceId, t.changedAt, t.id),
    index('cloud_nodes_parent_idx').on(t.parentId),
    index('cloud_nodes_workspace_idx').on(t.workspaceId, t.deletedAt),
    index('cloud_nodes_area_idx').on(t.areaId),
    index('cloud_nodes_owner_idx').on(t.ownerId),
    index('cloud_nodes_deleted_root_idx').on(t.deletedRootId),
  ],
);
export type CloudNodeRow = typeof cloudNodes.$inferSelect;

/**
 * Files and folders that are gone for good, written by a trigger when their row goes (also with
 * their area or workspace – hence no foreign keys). A computer keeping copies learns from it what
 * to drop; rows go after `CLOUD_REMOVED_DAYS`.
 */
export const cloudRemoved = pgTable(
  'cloud_removed',
  {
    nodeId: text('node_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    removedAt: timestamptz('removed_at').notNull().defaultNow(),
    /** Where it lay (by the trigger): told only to who could see it there. */
    areaId: text('area_id'),
    ownerId: text('owner_id'),
    parentId: text('parent_id'),
    /** `false`: removed before the place was kept (0145) – told to everyone, as then. */
    placeKnown: boolean('place_known').notNull().default(false),
  },
  (t) => [index('cloud_removed_workspace_idx').on(t.workspaceId, t.removedAt)],
);

/**
 * One version („Fassung“) of a file: its bytes in blob storage under
 * `workspaces/<id>/cloud/<nodeId>/<versionId>`. Every upload over a file makes one; older ones
 * without a name go after `CLOUD_VERSION_DAYS`.
 */
export const cloudVersions = pgTable(
  'cloud_versions',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    /** As the node's: storage adds up per workspace without a join. */
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type'),
    /** A named version stays for good. */
    label: encryptedText('cloud_versions', 'label'),
    /** Made by bringing this earlier version back. */
    restoredFrom: integer('restored_from'),
    /** The PDF drawn of an office file to show it: not tried, there, or not possible. */
    preview: text('preview').$type<'none' | 'ready' | 'failed'>().notNull().default('none'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('cloud_versions_node_number_idx').on(t.nodeId, t.number),
    index('cloud_versions_workspace_idx').on(t.workspaceId),
  ],
);
export type CloudVersionRow = typeof cloudVersions.$inferSelect;

/**
 * „Mit Stern“: each person's own. Out of the app for now – nothing reads or writes it; the table
 * stays so the stars set so far are there when it comes back.
 */
export const cloudStars = pgTable(
  'cloud_stars',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nodeId] })],
);

/** „Anpinnen“: the folders each person keeps in the side bar. */
export const cloudPins = pgTable(
  'cloud_pins',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nodeId] })],
);

/** What each person opened last – „Zuletzt“. */
export const cloudRecents = pgTable(
  'cloud_recents',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    at: timestamptz('at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.nodeId] }),
    index('cloud_recents_user_idx').on(t.userId, t.at),
  ],
);

/**
 * A file or folder shared beyond where it lies: with a member of the workspace (`user`), or by
 * a link anyone holding it opens (`link`) – read only, until `expires_at`. Of a link only the
 * hash is looked up; the link itself is kept sealed so it can be copied again.
 */
export const cloudShares = pgTable(
  'cloud_shares',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    nodeId: text('node_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'user' | 'link'>().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<CloudShareRole>().notNull().default('view'),
    tokenHash: text('token_hash').unique(),
    token: encryptedText('cloud_shares', 'token'),
    expiresAt: timestamptz('expires_at'),
    /** A link: how often it was opened. */
    opens: integer('opens').notNull().default(0),
    /** A person's share: when they first saw it in „Geteilt“. */
    seenAt: timestamptz('seen_at'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('cloud_shares_node_idx').on(t.nodeId),
    index('cloud_shares_user_idx').on(t.userId),
    index('cloud_shares_workspace_idx').on(t.workspaceId),
  ],
);
export type CloudShareRow = typeof cloudShares.$inferSelect;

/**
 * What happened to the files („Aktivität“). Names as they were then, sealed. An event in
 * someone's own files carries `space_owner_id`: only they (and whoever the file is shared with)
 * see it. Several of a kind at once (twelve files dropped) fold into one (`more`, `group_key`).
 */
export const cloudEvents = pgTable(
  'cloud_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'cascade' }),
    spaceOwnerId: text('space_owner_id').references(() => users.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').references(() => cloudNodes.id, { onDelete: 'set null' }),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').$type<CloudEventKind>().notNull(),
    name: encryptedText('cloud_events', 'name').notNull(),
    nodeKind: text('node_kind').$type<CloudNodeKind>(),
    detail: encryptedText('cloud_events', 'detail'),
    more: integer('more').notNull().default(0),
    groupKey: text('group_key'),
    createdAt: createdAt(),
  },
  (t) => [
    index('cloud_events_workspace_idx').on(t.workspaceId, t.createdAt),
    index('cloud_events_node_idx').on(t.nodeId, t.createdAt),
  ],
);
export type CloudEventRow = typeof cloudEvents.$inferSelect;

/**
 * „Agenten“ (`cloud-agents.ts` in shared): an order to the AI that works across the workspace's
 * files, kept as a chat everyone in the workspace sees. It works as `user_id`, who gave it.
 */
export const cloudAgents = pgTable(
  'cloud_agents',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The start of its first message, or what it named its chat (`name_chat`). */
    title: encryptedText('cloud_agents', 'title').notNull(),
    /** Its owner named it: the agent names it no more. */
    named: boolean('named').notNull().default(false),
    /** Its owner's alone until they share it: with its area (`areaId`), or the workspace. */
    shared: boolean('shared').notNull().default(false),
    /**
     * The area it stands in. `shared` there: everyone who sees that area sees it; otherwise
     * its owner's alone, in that area. `null`: its owner's, or – `shared` – the workspace's.
     * An area deleted, it is its owner's alone again (`deleteArea`).
     */
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'set null' }),
    /** The rhythm of an order it takes up again by itself; `null`: it works when written to. */
    repeat: jsonb('repeat').$type<CloudAgentRepeatRule>(),
    /** That order's words. */
    repeatText: encryptedText('cloud_agents', 'repeat_text'),
    /** When it runs next: the server looks for those that are due. */
    nextRunAt: timestamptz('next_run_at'),
    /** What it keeps an eye on to work by itself (`cloud-agent-auto.ts`); `null`: nothing. */
    watches: jsonb('watches').$type<CloudAgentWatch[]>(),
    /** Changes up to here are dealt with – or its own: what it did while working is no news. */
    watchedAt: timestamptz('watched_at'),
    /** Its owner paused what it does by itself: the repeated order and the watches stay. */
    paused: boolean('paused').notNull().default(false),
    createdAt: createdAt(),
    /** Its latest message: the list sorts by it. */
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('cloud_agents_workspace_idx').on(t.workspaceId, t.updatedAt),
    index('cloud_agents_next_run_idx').on(t.nextRunAt),
    index('cloud_agents_area_idx').on(t.areaId),
  ],
);
export type CloudAgentRow = typeof cloudAgents.$inferSelect;

/**
 * The chats of an agent: several people (and several chats) work on the same thing, with one
 * desk. The first has the agent's own id and its title (`title` null); further ones are opened
 * beside it and seen by everyone the agent is shared with.
 */
export const cloudAgentChats = pgTable(
  'cloud_agent_chats',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => cloudAgents.id, { onDelete: 'cascade' }),
    /** Who opened it. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** What it is about; `null`: the start of its first message (the first chat: the agent's). */
    title: encryptedText('cloud_agent_chats', 'title'),
    createdAt: createdAt(),
  },
  (t) => [index('cloud_agent_chats_agent_idx').on(t.agentId, t.createdAt)],
);
export type CloudAgentChatRow = typeof cloudAgentChats.$inferSelect;

/** An agent's messages in order (`seq`): the people's and the agent's answers, as they ended. */
export const cloudAgentMessages = pgTable(
  'cloud_agent_messages',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => cloudAgents.id, { onDelete: 'cascade' }),
    chatId: text('chat_id')
      .notNull()
      .references(() => cloudAgentChats.id, { onDelete: 'cascade' }),
    /** Who wrote it (a person's message); gone or from before chats were shared: `null`. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** A note the agent of another chat of this agent left here (`role` assistant). */
    fromChatId: text('from_chat_id'),
    /** A call with the agent (`role` assistant): one entry, its text what the agent remembers of it. */
    callId: text('call_id').references((): AnyPgColumn => callRecords.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    text: encryptedText('cloud_agent_messages', 'text').notNull(),
    /** Files put on it (`services/attachments.ts`), in their order. */
    attachments: encryptedJsonList<Attachment>('cloud_agent_messages', 'attachments')
      .notNull()
      .default([]),
    /** How the agent's answer ended; `null` for the person's message. */
    state: text('state').$type<MaterialChatAnswerState>(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cloud_agent_messages_agent_seq_idx').on(t.agentId, t.seq)],
);

/**
 * A call that is over, as it was written down (`services/call-records.ts`): who was in it, every
 * turn – people's and the agent's –, what was sent to agents, and the notes the AI writes once
 * after it. A conversation's call is seen by who sees the conversation; one's own call with an
 * agent stands in its chat (`cloud_agent_messages.call_id`) and is seen by who sees the agent.
 * `person_ids`: who was in it, plain (export, deletion); names and words are sealed.
 */
export const callRecords = pgTable(
  'call_records',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').references(() => senderChannels.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => cloudAgents.id, { onDelete: 'cascade' }),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'set null' }),
    kind: text('kind').$type<SenderChannelKind>().notNull(),
    title: encryptedText('call_records', 'title').notNull(),
    startedBy: text('started_by').references(() => users.id, { onDelete: 'set null' }),
    personIds: jsonb('person_ids').$type<string[]>().notNull().default([]),
    people: encryptedJson<CallPerson[]>('call_records', 'people').notNull(),
    lines: encryptedJson<CallRecordLine[]>('call_records', 'lines').notNull(),
    orders: encryptedJsonList<CallRecordOrder>('call_records', 'orders').notNull(),
    notes: encryptedJson<CallRecordNotes>('call_records', 'notes'),
    notesState: text('notes_state').$type<CallRecordNotesState>().notNull().default('pending'),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('call_records_channel_idx').on(t.channelId),
    index('call_records_agent_idx').on(t.agentId),
  ],
);
export type CallRecordRow = typeof callRecords.$inferSelect;

/**
 * An agent's desk („Desktop“): what it wrote and what it wants done, apart from the files until
 * the person takes it over. `node_id`: the file or folder it is about (changed, moved, renamed,
 * deleted), later what a new one became; a new one and a move say where to (`parent_id`,
 * `area_id`, `desk_parent_id`, none: the person's own files).
 */
export const cloudAgentFiles = pgTable(
  'cloud_agent_files',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => cloudAgents.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<CloudAgentFileKind>().notNull(),
    status: text('status').$type<CloudAgentFileStatus>().notNull().default('open'),
    name: encryptedText('cloud_agent_files', 'name').notNull(),
    content: encryptedText('cloud_agent_files', 'content').notNull(),
    nodeId: text('node_id').references(() => cloudNodes.id, { onDelete: 'set null' }),
    parentId: text('parent_id').references(() => cloudNodes.id, { onDelete: 'set null' }),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'set null' }),
    /** A folder on this desk the thing goes into, instead of a place in the files. */
    deskParentId: text('desk_parent_id'),
    /** The presentation the agent works on: a new one, or its copy of `original_deck_id`. */
    deckId: text('deck_id').references(() => decks.id, { onDelete: 'set null' }),
    originalDeckId: text('original_deck_id').references(() => decks.id, { onDelete: 'set null' }),
    /** Done at once by the agent, and how its person takes it back; `null`: no way back. */
    undo: jsonb('undo').$type<CloudAgentUndo>(),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('cloud_agent_files_agent_idx').on(t.agentId, t.createdAt)],
);
export type CloudAgentFileRow = typeof cloudAgentFiles.$inferSelect;

/** How a connection signs in: a key the person gave, or what OAuth keeps for it. */
export interface CloudConnectionAuth {
  /** A key the person gave – an API's token, header key or password. */
  token?: string;
  /** An API's user, with its password in `token` (`basic`). */
  user?: string;
  /** The client the service registered for this connection, its tokens, as the MCP SDK reads them. */
  client?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  /** A sign-in under way: the PKCE verifier and the `state` its way back must bring. */
  verifier?: string;
  state?: string;
  /** Where the service's sign-in lives, as found when one was started. */
  discovery?: Record<string, unknown>;
}

/**
 * „Verbindungen“: a service outside (an MCP server by its address, or – `kind` `api` – a plain
 * HTTP API by its base address) a person connected so that their agents work there too. It is
 * that person's – their sign-in – in one workspace; whoever writes to an agent has their own at
 * hand, never another's. `tools`: what the service offered when last asked (an API's operations
 * from its OpenAPI description). `may_change`: the person said agents may change things there,
 * not only read. `api`: an API's sign-in kind and description; its secret lies in `auth`.
 */
export const cloudConnections = pgTable(
  'cloud_connections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: encryptedText('cloud_connections', 'name').notNull(),
    url: encryptedText('cloud_connections', 'url').notNull(),
    kind: text('kind').$type<CloudConnectionKind>().notNull().default('mcp'),
    api: encryptedJson<ApiSettings>('cloud_connections', 'api'),
    auth: encryptedJson<CloudConnectionAuth>('cloud_connections', 'auth').notNull(),
    state: text('state').$type<CloudConnectionState>().notNull(),
    error: text('error'),
    tools: encryptedJson<CloudConnectionTool[]>('cloud_connections', 'tools').notNull(),
    mayChange: boolean('may_change').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('cloud_connections_person_idx').on(t.workspaceId, t.userId)],
);
export type CloudConnectionRow = typeof cloudConnections.$inferSelect;

// ── Writer: text documents ──────────────────────────────────────────────────
/*
 * A document is a file in Cloud (`cloud_nodes`, an .odt): its bytes, versions, place, rights and
 * trash are Cloud's. These tables hold what Writer adds – the count of its steps, what was
 * written in the last minutes (one version, not one per keystroke), and the comments.
 */
export const documents = pgTable('documents', {
  nodeId: text('node_id')
    .primaryKey()
    .references(() => cloudNodes.id, { onDelete: 'cascade' }),
  /** Counts the steps written into it: who has it open hears each with its number. */
  editSeq: integer('edit_seq').notNull().default(0),
  /** The version Writer made last, by whom and since when: further typing replaces it. */
  draftVersionId: text('draft_version_id'),
  draftBy: text('draft_by').references(() => users.id, { onDelete: 'set null' }),
  draftAt: timestamptz('draft_at'),
});
export type DocumentRow = typeof documents.$inferSelect;

/** Steps written, by the id their browser gave them: one sent twice is written once. */
export const documentEdits = pgTable(
  'document_edits',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    clientEditId: text('client_edit_id').notNull(),
    seq: integer('seq').notNull(),
    dropped: jsonb('dropped').$type<number[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('document_edits_client_idx').on(t.documentId, t.clientEditId)],
);

export const documentComments = pgTable(
  'document_comments',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => documentComments.id, {
      onDelete: 'cascade',
    }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: encryptedText('document_comments', 'body').notNull(),
    /** Files put on it (`services/attachments.ts`), in their order. */
    attachments: encryptedJsonList<Attachment>('document_comments', 'attachments')
      .notNull()
      .default([]),
    /** Where it points; `null` on an answer. */
    anchor: encryptedJson<WriterAnchor>('document_comments', 'anchor'),
    status: text('status').$type<'open' | 'done'>().notNull().default('open'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamptz('resolved_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('document_comments_document_idx').on(t.documentId, t.createdAt)],
);
export type DocumentCommentRow = typeof documentComments.$inferSelect;

/** Reactions to a text document's comments (👍 / 👎 / egal), as `commentReactions`. */
export const documentCommentReactions = pgTable(
  'document_comment_reactions',
  {
    commentId: text('comment_id')
      .notNull()
      .references(() => documentComments.id, { onDelete: 'cascade' }),
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
    index('document_comment_reactions_user_idx').on(t.userId),
  ],
);

/** A comment handed to the AI and what came of it (`services/document-ai`). */
export const documentAiProposals = pgTable(
  'document_ai_proposals',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    commentId: text('comment_id')
      .notNull()
      .references(() => documentComments.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').$type<WriterAiState>().notNull().default('running'),
    summary: encryptedText('document_ai_proposals', 'summary').notNull().default(''),
    error: text('error'),
    /** The steps that take its change back, and the ones that apply it again. */
    undo: encryptedJson<WriterOperation[]>('document_ai_proposals', 'undo'),
    redo: encryptedJson<WriterOperation[]>('document_ai_proposals', 'redo'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('document_ai_proposals_document_idx').on(t.documentId, t.createdAt)],
);
export type DocumentAiProposalRow = typeof documentAiProposals.$inferSelect;

// ── Reader: PDFs ────────────────────────────────────────────────────────────
/*
 * A PDF is a file in Cloud and stays as it came. These tables hold what Reader lays over it:
 * what was filled in (`pdf_marks`), the comments, what the AI did under them, and the signatures
 * a person keeps to put down again.
 */

/** One thing filled in on a PDF: a form field's value, or text, a tick, a signature on a page. */
export const pdfMarks = pgTable(
  'pdf_marks',
  {
    pdfId: text('pdf_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    /** The browser's id; a form field's is `field:<name>`, one per field. */
    id: text('id').notNull(),
    body: encryptedJson<ReaderMarkBody>('pdf_marks', 'body').notNull(),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pdfId, t.id] })],
);
export type PdfMarkRow = typeof pdfMarks.$inferSelect;

export const pdfComments = pgTable(
  'pdf_comments',
  {
    id: text('id').primaryKey(),
    pdfId: text('pdf_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => pdfComments.id, {
      onDelete: 'cascade',
    }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: encryptedText('pdf_comments', 'body').notNull(),
    /** Files put on it (`services/attachments.ts`), in their order. */
    attachments: encryptedJsonList<Attachment>('pdf_comments', 'attachments').notNull().default([]),
    /** Where it points; `null` on an answer. */
    anchor: encryptedJson<ReaderAnchor>('pdf_comments', 'anchor'),
    status: text('status').$type<'open' | 'done'>().notNull().default('open'),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamptz('resolved_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('pdf_comments_pdf_idx').on(t.pdfId, t.createdAt)],
);
export type PdfCommentRow = typeof pdfComments.$inferSelect;

/** A mark as it stood before and after the AI filled it in: `null` is none. */
export interface PdfAiChange {
  id: string;
  before: ReaderMarkBody | null;
  after: ReaderMarkBody | null;
}

/** A comment handed to the AI and what came of it (`services/pdf-ai`). */
export const pdfAiProposals = pgTable(
  'pdf_ai_proposals',
  {
    id: text('id').primaryKey(),
    pdfId: text('pdf_id')
      .notNull()
      .references(() => cloudNodes.id, { onDelete: 'cascade' }),
    commentId: text('comment_id')
      .notNull()
      .references(() => pdfComments.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').$type<WriterAiState>().notNull().default('running'),
    summary: encryptedText('pdf_ai_proposals', 'summary').notNull().default(''),
    error: text('error'),
    changes: encryptedJsonList<PdfAiChange>('pdf_ai_proposals', 'changes').notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('pdf_ai_proposals_pdf_idx').on(t.pdfId, t.createdAt)],
);
export type PdfAiProposalRow = typeof pdfAiProposals.$inferSelect;

/** Signatures a person keeps, to put down on any PDF again. */
export const readerSignatures = pgTable(
  'reader_signatures',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    image: encryptedText('reader_signatures', 'image').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('reader_signatures_user_idx').on(t.userId, t.createdAt)],
);
export type ReaderSignatureRow = typeof readerSignatures.$inferSelect;

/**
 * Sender's conversations (`packages/shared/src/sender.ts`): an area's own channel (`area`, one
 * each, made when first listed), further channels inside an area (`channel`), groups and
 * direct conversations. Who sees an area sees its channels; a group's or a direct one's people
 * are `sender_members`.
 */
export const senderChannels = pgTable(
  'sender_channels',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<SenderChannelKind>().notNull(),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'cascade' }),
    /** A channel's or group's; `''` for an area's own (it carries the area's) and direct ones. */
    name: text('name').notNull().default(''),
    topic: text('topic').notNull().default(''),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** A direct conversation's two people, sorted and joined: one per pair. */
    directKey: text('direct_key'),
    /**
     * An area's own agent, tagged with `@Agent` in its channels (made when first tagged); `null`
     * in groups and direct ones – the agents added anywhere are `sender_channel_agents`.
     */
    agentId: text('agent_id').references(() => cloudAgents.id, { onDelete: 'set null' }),
    /** The seq of its latest message. */
    lastSeq: integer('last_seq').notNull().default(0),
    createdAt: createdAt(),
    /** Its latest message: the side bar sorts by it. */
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('sender_channels_workspace_idx').on(t.workspaceId),
    uniqueIndex('sender_channels_area_idx')
      .on(t.areaId)
      .where(sql`${t.kind} = 'area'`),
    uniqueIndex('sender_channels_direct_idx').on(t.workspaceId, t.directKey),
  ],
);
export type SenderChannelRow = typeof senderChannels.$inferSelect;

/**
 * The people of a group or direct conversation – and, for every conversation, how far a person
 * has read (an area's channel gets its row when first read).
 */
export const senderMembers = pgTable(
  'sender_members',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => senderChannels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readSeq: integer('read_seq').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('sender_members_user_idx').on(t.userId),
  ],
);

/** A conversation's messages in order (`seq`), by a person or an agent. */
export const senderMessages = pgTable(
  'sender_messages',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => senderChannels.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    agentId: text('agent_id').references(() => cloudAgents.id, { onDelete: 'set null' }),
    text: encryptedText('sender_messages', 'text').notNull(),
    /** Files put on it (`services/attachments.ts`), in their order. */
    attachments: encryptedJsonList<Attachment>('sender_messages', 'attachments')
      .notNull()
      .default([]),
    /** It came as a colleague's mail to a mailbox here (`mail_messages`): its subject. */
    mail: encryptedJson<SenderMessageMail>('sender_messages', 'mail'),
    /** Those whose name it carries („@Anna“): their unread count says so. */
    mentions: jsonb('mentions').$type<string[]>().notNull().default([]),
    editedAt: timestamptz('edited_at'),
    /** Deleted by its author: the place stays („Gelöscht“), the words go. */
    deletedAt: timestamptz('deleted_at'),
    /** A call in the conversation, over: the entry that opens its page (`call_records`). */
    callId: text('call_id').references((): AnyPgColumn => callRecords.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sender_messages_channel_seq_idx').on(t.channelId, t.seq)],
);
export type SenderMessageRow = typeof senderMessages.$inferSelect;

/** How far a person has read an agent's answers in Sender (its messages' seq). */
export const senderAgentReads = pgTable(
  'sender_agent_reads',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => cloudAgents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readSeq: integer('read_seq').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.userId] })],
);

/**
 * The agents added to a conversation („Agent hinzufügen“, migration 0170): shown in its head and
 * first under @. Who calls one with @ is the same rule as for any agent (`callableHere`): who
 * sees it, where it may be called – added or not.
 */
export const senderChannelAgents = pgTable(
  'sender_channel_agents',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => senderChannels.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => cloudAgents.id, { onDelete: 'cascade' }),
    addedBy: text('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.agentId] }),
    index('sender_channel_agents_agent_idx').on(t.agentId),
  ],
);

// ── Mail: a person's mailboxes, woven into Sender ───────────────────────────

/**
 * Where a mailbox's folders were read up to (IMAP `UIDVALIDITY` and the next UID); `modseq`: the
 * folder's change counter then (CONDSTORE, only where mails count unread) – the next round asks
 * the read state only of what changed since.
 */
export interface MailSyncState {
  [folder: string]: { validity: string; next: number; modseq?: string };
}

/** A folder of a mailbox as kept: its key (a special one's role, else its path), name, role. */
export interface MailFolderEntry {
  key: string;
  path: string;
  name: string;
  role: MailFolderRole | null;
}

/**
 * A mailbox of a person in a workspace: IMAP to read, SMTP to send. Its sign-in is theirs alone,
 * sealed. `sync`: how far each read folder is read.
 */
export const mailAccounts = pgTable(
  'mail_accounts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    address: encryptedText('mail_accounts', 'address').notNull(),
    name: encryptedText('mail_accounts', 'name').notNull(),
    /** What its person called it („Arbeit“); `null`: its default name (`mailboxLabels`). */
    label: encryptedText('mail_accounts', 'label'),
    /**
     * What stands under every mail it sends (0165), plain text; `null`: none. Added on sending
     * (`queueMail`), so agents' mails carry it too.
     */
    signature: encryptedText('mail_accounts', 'signature'),
    imapHost: text('imap_host').notNull(),
    imapPort: integer('imap_port').notNull(),
    imapSecure: boolean('imap_secure').notNull(),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull(),
    smtpSecure: boolean('smtp_secure').notNull(),
    username: encryptedText('mail_accounts', 'username').notNull(),
    /** Empty for a mailbox signed in through its provider (`auth` not `password`). */
    password: encryptedText('mail_accounts', 'password').notNull(),
    /**
     * `password`, or `microsoft` / `google`: „Mit Microsoft/Google anmelden“ (OAuth, XOAUTH2 to
     * IMAP and SMTP – `mail/oauth.ts`).
     */
    auth: text('auth').$type<MailSignIn>().notNull().default('password'),
    /**
     * The provider's refresh token, sealed like the password; `null` once the provider refused
     * it (state `signin`: its person signs in anew). The access token lives in memory only.
     */
    refreshToken: encryptedText('mail_accounts', 'refresh_token'),
    state: text('state').$type<MailAccountState>().notNull().default('new'),
    error: text('error'),
    sync: jsonb('sync').$type<MailSyncState>().notNull().default({}),
    /** Its folders as the last round found them (`mail/servers.ts` `foldersToRead`), in order. */
    folders: jsonb('folders').$type<MailFolderEntry[]>().notNull().default([]),
    /** Whether the workspace's AI reads each new mail by itself (`mail-context`). */
    aiReads: boolean('ai_reads').notNull().default(true),
    /**
     * Its inbox's latest mails read once more since mails keep their HTML (0151): `ingestMail`
     * fills it in for those known already (`syncMailAccount`).
     */
    htmlRead: boolean('html_read').notNull().default(false),
    /**
     * No mailbox, only its calendars (0161): „Google/Microsoft Kalender verbinden“ – the
     * provider's tokens for its calendars alone, no IMAP/SMTP – or a mailbox removed in Post
     * while its calendars stayed (a password account keeps its password for CalDAV). Never read
     * for mail, never among the mailboxes; its calendars show as a mailbox's do
     * (`calendar/mail-calendars.ts`).
     */
    calendarOnly: boolean('calendar_only').notNull().default(false),
    /**
     * Its calendars stand in the calendar (0164) – an account's uses come and go apart: off
     * („Kalender › Konten“ › „Entfernen“), its calendars are dropped and never read; off with no
     * mailbox either (`calendarOnly`), the row is deleted.
     */
    withCalendars: boolean('with_calendars').notNull().default(true),
    lastSyncAt: timestamptz('last_sync_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('mail_accounts_person_idx').on(t.workspaceId, t.userId)],
);
export type MailAccountRow = typeof mailAccounts.$inferSelect;

/**
 * A mail conversation: the mails that answer one another (by `Message-ID`, `In-Reply-To`,
 * `References`). `read_at`: when its person last read or answered it here (what is unread is each
 * mail's `seen`). `context`: what the AI made of it (shown to its right).
 */
export const mailThreads = pgTable(
  'mail_threads',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => mailAccounts.id, { onDelete: 'cascade' }),
    subject: encryptedText('mail_threads', 'subject').notNull(),
    spam: boolean('spam').notNull().default(false),
    /** Who said spam – or, `ai` with `spam` false, took it out of the provider's spam. */
    spamBy: text('spam_by').$type<MailSpamBy>(),
    /** Why the instance's filter moved it (`spam_by` filter): Rspamd's strongest symbols. */
    spamSymbols: jsonb('spam_symbols').$type<string[]>(),
    lastAt: timestamptz('last_at').notNull(),
    readAt: timestamptz('read_at'),
    context: encryptedJson<MailContext>('mail_threads', 'context'),
    contextState: text('context_state').$type<MailContextState>().notNull().default('none'),
    createdAt: createdAt(),
  },
  (t) => [index('mail_threads_account_idx').on(t.accountId, t.lastAt)],
);
export type MailThreadRow = typeof mailThreads.$inferSelect;

/**
 * One's own rule for a sender in a workspace (`MailRule`): `value` the address or domain, sealed;
 * `value_hash` its keyed hash (`emailHash`) – how a mail's sender finds it, one rule per value.
 */
export const mailRules = pgTable(
  'mail_rules',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MailRuleKind>().notNull(),
    match: text('match').$type<MailRuleMatch>().notNull(),
    value: encryptedText('mail_rules', 'value').notNull(),
    valueHash: text('value_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mail_rules_value_idx').on(t.workspaceId, t.userId, t.match, t.valueHash)],
);
export type MailRuleRow = typeof mailRules.$inferSelect;

/** An attachment as kept: its bytes lie under `key` in the blob store. */
export interface MailAttachmentRow {
  id: string;
  name: string;
  type: string;
  size: number;
  key: string;
  /** Put into Cloud from the AI panel – that file (`mail-insights`: where the next one goes). */
  nodeId?: string;
}

/**
 * A picture the mail's HTML shows from the mail itself (`cid:`) – no attachment one files; its
 * bytes lie under `key` in the blob store, served by the attachment route.
 */
export interface MailInlineImageRow {
  id: string;
  /** Its `Content-ID`, without the angle brackets. */
  cid: string;
  type: string;
  size: number;
  key: string;
}

/**
 * A mail read from (or sent through) a mailbox. A colleague's that went into a chat has no
 * conversation here (`thread_id` null) but the chat's message (`sender_message_id`) – read again,
 * it is known and not posted twice.
 */
export const mailMessages = pgTable(
  'mail_messages',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => mailAccounts.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => mailThreads.id, { onDelete: 'cascade' }),
    senderMessageId: text('sender_message_id').references(() => senderMessages.id, {
      onDelete: 'set null',
    }),
    /** Where it came in first: a folder's key (`inbox`, `spam`, `sent` … or its path). */
    folder: text('folder').notNull(),
    /** Every folder it lies in – a mail can lie in several (Gmail's labels, a copy). */
    folders: jsonb('folders').$type<string[]>().notNull().default([]),
    uid: integer('uid'),
    /** Its `Message-ID` header – how answers find it. */
    messageId: text('message_id').notNull(),
    inReplyTo: text('in_reply_to'),
    references: jsonb('references').$type<string[]>().notNull().default([]),
    from: encryptedJson<MailPerson>('mail_messages', 'from').notNull(),
    to: encryptedJsonList<MailPerson>('mail_messages', 'to').notNull(),
    cc: encryptedJsonList<MailPerson>('mail_messages', 'cc').notNull(),
    subject: encryptedText('mail_messages', 'subject').notNull(),
    text: encryptedText('mail_messages', 'text').notNull(),
    /**
     * Its HTML part, sanitized (`services/mail-html.ts`) – shown as the mail looks; the text stays
     * what the AI, search and answers read. `null`: none, or too large. Before 0151 none.
     */
    html: encryptedText('mail_messages', 'html'),
    /** The pictures its HTML shows from the mail itself (`cid:`). */
    inlineImages: encryptedJsonList<MailInlineImageRow>('mail_messages', 'inline_images')
      .notNull()
      .default(sql`'[]'::jsonb`),
    attachments: encryptedJsonList<MailAttachmentRow>('mail_messages', 'attachments').notNull(),
    /**
     * Their bytes and the inline pictures', in the clear for the workspace's storage
     * (`workspace-storage`); 0 before 0136.
     */
    attachmentBytes: bigint('attachment_bytes', { mode: 'number' }).notNull().default(0),
    auth: text('auth').$type<MailAuth>().notNull().default('none'),
    outgoing: boolean('outgoing').notNull().default(false),
    /**
     * Read – as on the server (`\Seen`, asked each round), or read here. Unread counts only where
     * new mail arrives (inbox/spam); what one wrote or found in another folder is read.
     */
    seen: boolean('seen').notNull().default(false),
    /** Read or unread here, not yet set on the server (by `folder` + `uid`) – the next round tries. */
    seenPending: boolean('seen_pending').notNull().default(false),
    /** Its blind copies – only on a mail written here (a received one never shows them). */
    bcc: encryptedJsonList<MailPerson>('mail_messages', 'bcc')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Written here and still in the outbox (`services/mail-outbox.ts`): `queued` until `sendAt`
     * (taken back meanwhile, it goes), `sending` while it goes out, `failed` with `sendError` –
     * sent again or taken back. `null`: sent, or received.
     */
    sendState: text('send_state').$type<'queued' | 'sending' | 'failed'>(),
    sendAt: timestamptz('send_at'),
    sendError: text('send_error'),
    sentAt: timestamptz('sent_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('mail_messages_account_message_idx').on(t.accountId, t.messageId),
    index('mail_messages_outbox_idx')
      .on(t.sendAt)
      .where(sql`${t.sendState} is not null`),
    index('mail_messages_thread_idx').on(t.threadId, t.sentAt),
    index('mail_messages_seen_pending_idx')
      .on(t.accountId)
      .where(sql`${t.seenPending}`),
  ],
);
export type MailMessageRow = typeof mailMessages.$inferSelect;

/**
 * What the AI wrote about a mail conversation in its panel (`services/mail-insights.ts`), for its
 * person: kept while the latest mail is `version`, so opening it again asks the model nothing;
 * dropped after 14 days by the retention job, with the conversation and with the account.
 */
export const mailInsights = pgTable(
  'mail_insights',
  {
    threadId: text('thread_id')
      .primaryKey()
      .references(() => mailThreads.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    payload: encryptedJson<MailSummary>('mail_insights', 'payload').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('mail_insights_created_idx').on(t.createdAt)],
);

/**
 * A file put on a mail being written (`POST /mail/accounts/:id/uploads`): it waits until the mail
 * goes and becomes its attachment; never sent, gone after seven days (`sweepMailUploads`). Its
 * bytes lie under the mailbox (`mail/<account>/`), gone with it.
 */
export const mailUploads = pgTable(
  'mail_uploads',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => mailAccounts.id, { onDelete: 'cascade' }),
    name: encryptedText('mail_uploads', 'name').notNull(),
    type: text('type').notNull(),
    size: integer('size').notNull(),
    key: text('key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('mail_uploads_created_idx').on(t.createdAt)],
);

/**
 * A file put on something written – a message, an order to an agent, a question to the AI, a
 * comment, a to-do, an event (`services/attachments.ts`). Up at once, it waits as its writer's
 * own (`taken_at` null) until what it is on is sent and takes it; never taken, gone after seven
 * days. What took it keeps its name, type and size beside its words (`attachments` there); the
 * bytes lie under the workspace (`workspaces/<id>/attachments/<id>`) and go with it.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: encryptedText('attachments', 'name').notNull(),
    type: text('type').notNull(),
    size: integer('size').notNull(),
    key: text('key').notNull(),
    takenAt: timestamptz('taken_at'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_waiting_idx').on(t.takenAt, t.createdAt)],
);
export type AttachmentRow = typeof attachments.$inferSelect;

/**
 * A file sent in a conversation (`services/sender-files.ts`): its conversation's „Dateien“, where
 * it lies in Cloud – an area's chat puts it into the area's „Chat-Dateien“ at once, elsewhere it
 * lies there once filed (`node_id`) – and where the AI would put it (`filing`). Gone with its
 * message, its conversation, its attachment.
 */
export const senderFiles = pgTable(
  'sender_files',
  {
    /** The upload's id – or, for a Cloud file or folder a message points to, the node's id. */
    attachmentId: text('attachment_id').notNull(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => senderChannels.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => senderMessages.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    nodeId: text('node_id').references(() => cloudNodes.id, { onDelete: 'set null' }),
    filing: encryptedJson<SenderFileFiling>('sender_files', 'filing'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.attachmentId] }),
    index('sender_files_channel_idx').on(t.channelId, t.createdAt),
    index('sender_files_node_idx').on(t.nodeId),
  ],
);
export type SenderFileRow = typeof senderFiles.$inferSelect;

/**
 * What a person wrote and did not send – in a conversation, to an agent, as a mail – kept for
 * their account, so it waits on every device (`services/drafts.ts`). Theirs alone: no one else
 * reads it, not even the workspace's admins. `key`: the client's (a conversation's id, `mail:…`,
 * `agent:…`, `agent-new:…`, `mail-new:…`); the newer `updated_at` wins.
 */
export const senderDrafts = pgTable(
  'sender_drafts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** Where it goes (`conversation`, `mail`, `agent`, `agent-new`, `mail-new`) – the list's sort. */
    kind: text('kind').$type<SenderDraftTarget['kind']>().notNull(),
    /** Its place and names (an agent's, a mail's subject, an address), sealed like its words. */
    target: encryptedJson<SenderDraftTarget>('sender_drafts', 'target').notNull(),
    text: encryptedText('sender_drafts', 'text').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [uniqueIndex('sender_drafts_person_key_idx').on(t.userId, t.workspaceId, t.key)],
);
export type SenderDraftRow = typeof senderDrafts.$inferSelect;

/**
 * „Anpinnen“ in Sender (`services/sender-pins.ts`): what a person keeps at the top of their lists
 * – a conversation, an agent (both in the chats), a mail conversation (in the mail list) – the
 * latest pinned first. Exactly one of the three; theirs alone, gone with them and with it.
 */
export const senderPins = pgTable(
  'sender_pins',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').references(() => senderChannels.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => cloudAgents.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => mailThreads.id, { onDelete: 'cascade' }),
    pinnedAt: timestamptz('pinned_at').notNull(),
  },
  (t) => [
    uniqueIndex('sender_pins_channel_idx').on(t.userId, t.channelId),
    uniqueIndex('sender_pins_agent_idx').on(t.userId, t.agentId),
    uniqueIndex('sender_pins_thread_idx').on(t.userId, t.threadId),
    check(
      'sender_pins_target_check',
      sql`num_nonnulls(${t.channelId}, ${t.agentId}, ${t.threadId}) = 1`,
    ),
  ],
);

/**
 * A milestone (`@slider/shared` todos): a point a place's to-dos lead to, by a date – an area's
 * (whoever may edit there changes it) or, without an area, its owner's alone, as to-dos are.
 */
export const todoMilestones = pgTable(
  'todo_milestones',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    name: encryptedText('todo_milestones', 'name').notNull(),
    /** `YYYY-MM-DD`. */
    dueOn: text('due_on'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('todo_milestones_area_idx').on(t.areaId),
    index('todo_milestones_owner_idx').on(t.ownerId),
  ],
);
export type TodoMilestoneRow = typeof todoMilestones.$inferSelect;

/**
 * A to-do (`@slider/shared` todos): an area's – whoever sees the area sees and, editing there,
 * changes it – or, without an area, its owner's alone. Title, words and where it came from are
 * encrypted at rest; numbered per workspace („#12“).
 */
export const todos = pgTable(
  'todos',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'cascade' }),
    /** One's own (no area): whose; goes with their account. */
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: encryptedText('todos', 'title').notNull(),
    description: encryptedText('todos', 'description').notNull(),
    /** Files put on it (`services/attachments.ts`), in their order. */
    attachments: encryptedJsonList<Attachment>('todos', 'attachments').notNull().default([]),
    status: text('status').$type<TodoStatus>().notNull().default('todo'),
    priority: integer('priority').$type<TodoPriority>().notNull().default(0),
    assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** An agent sent on it (`sendAgentOnTodo`): it works on it, its avatar beside it. */
    assigneeAgentId: text('assignee_agent_id').references(() => cloudAgents.id, {
      onDelete: 'set null',
    }),
    /** `YYYY-MM-DD`: work on it begins (its bar's start on the timeline). */
    startOn: text('start_on'),
    /** `YYYY-MM-DD`. */
    dueOn: text('due_on'),
    milestoneId: text('milestone_id').references(() => todoMilestones.id, {
      onDelete: 'set null',
    }),
    source: encryptedJson<TodoSource>('todos', 'source'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdByAgent: text('created_by_agent').references(() => cloudAgents.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('todos_number_idx').on(t.workspaceId, t.number),
    index('todos_area_idx').on(t.areaId),
    index('todos_owner_idx').on(t.ownerId),
    index('todos_assignee_idx').on(t.assigneeId),
    index('todos_milestone_idx').on(t.milestoneId),
  ],
);
export type TodoRow = typeof todos.$inferSelect;

/**
 * Calendars (`@slider/shared` calendar): an area's (each area has one, made when first looked at
 * – `parent_id` null, no mail account), one's private one (`owner_id`, no area), sub-calendars
 * under either (`parent_id`, area and owner taken over from the one above), and a mail account's
 * (`mail_account_id`, the provider's `remote_id`; their events are read live, never kept here).
 */
/** What a mail account's calendar lets its person do in Slider (`calendars.remote_rights`). */
export interface MailCalendarRights {
  /** Events made, changed, deleted. */
  events: boolean;
  /** Renamed, coloured. */
  rename: boolean;
  /** Deleted at the provider, or only taken off one's list there (someone else's). */
  drop: 'delete' | 'remove' | null;
  /** New calendars may be made in its account. */
  create: boolean;
  /** Something its provider would let is kept back by an older sign-in: signing in anew asks. */
  regrant: boolean;
}

export const calendars = pgTable(
  'calendars',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    areaId: text('area_id').references(() => cloudAreas.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => calendars.id, {
      onDelete: 'cascade',
    }),
    mailAccountId: text('mail_account_id').references(() => mailAccounts.id, {
      onDelete: 'cascade',
    }),
    /** A mail account's calendar at its provider (CalDAV: its URL, often with the address). */
    remoteId: encryptedText('calendars', 'remote_id'),
    /** Empty for an area's own (it is called as the area) and one's private one („Privat“). */
    name: encryptedText('calendars', 'name').notNull(),
    /** `null`: the area's colour (an area's own), blue (private). */
    color: text('color'),
    /**
     * A mail account's calendar (0163): what may be done with it there – its provider's word and
     * what the sign-in lets (`calendar/mail-calendars.ts`); `null`: everything may be tried.
     */
    remoteRights: jsonb('remote_rights').$type<MailCalendarRights>(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('calendars_workspace_idx').on(t.workspaceId),
    index('calendars_parent_idx').on(t.parentId),
    // One own calendar per area and one private per person: two asking at once make one.
    uniqueIndex('calendars_area_root_idx')
      .on(t.areaId)
      .where(sql`${t.parentId} IS NULL AND ${t.mailAccountId} IS NULL AND ${t.areaId} IS NOT NULL`),
    uniqueIndex('calendars_private_root_idx')
      .on(t.workspaceId, t.ownerId)
      .where(
        sql`${t.parentId} IS NULL AND ${t.mailAccountId} IS NULL AND ${t.areaId} IS NULL AND ${t.ownerId} IS NOT NULL`,
      ),
  ],
);
export type CalendarRow = typeof calendars.$inferSelect;

/** An event in one of Slider's own calendars (a mail calendar's stay at the provider). */
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    title: encryptedText('calendar_events', 'title').notNull(),
    location: encryptedText('calendar_events', 'location').notNull(),
    notes: encryptedText('calendar_events', 'notes').notNull(),
    /** Files put on it (`services/attachments.ts`), in their order. */
    attachments: encryptedJsonList<Attachment>('calendar_events', 'attachments')
      .notNull()
      .default([]),
    allDay: boolean('all_day').notNull().default(false),
    /** All-day: the days' midnights in UTC (the end exclusive), so ranges compare alike. */
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('calendar_events_calendar_idx').on(t.calendarId, t.startsAt),
    index('calendar_events_range_idx').on(t.workspaceId, t.startsAt, t.endsAt),
  ],
);
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
