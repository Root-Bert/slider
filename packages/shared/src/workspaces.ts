import { z } from 'zod';
import { accentColorSchema, workspaceRoleSchema } from './model';

/**
 * Accounts, login and workspaces (BER-129). Routes are listed in the contract table in `api.ts`.
 */

// ── Login ───────────────────────────────────────────────────────────────────

/**
 * How new accounts may be created: only by invitation, by anyone, by verified addresses of the
 * instance's `SIGNUP_DOMAINS`, or (`company`, BER-148) by invitation or through a workspace
 * opened to one's company domain.
 */
export const SIGNUP_MODES = ['invite', 'open', 'domains', 'company'] as const;
export const signupModeSchema = z.enum(SIGNUP_MODES);
export type SignupMode = z.infer<typeof signupModeSchema>;

/**
 * Whether workspaces can be opened to a company domain (BER-148). `invite` means only
 * invitations lead anywhere – no workspace is found or joined by domain.
 */
export const domainJoinAllowed = (signup: SignupMode) => signup !== 'invite';

export const loginProviderSchema = z.object({
  id: z.enum(['microsoft', 'google', 'oidc', 'nextcloud']),
  /** Button text, e.g. "Weiter mit Microsoft". */
  label: z.string(),
  /** Both are browser redirects: send the browser to `${loginUrl}?returnTo=<path>`. */
  kind: z.literal('redirect'),
  loginUrl: z.string(),
});
export type LoginProvider = z.infer<typeof loginProviderSchema>;

/** `GET /auth/providers` – what the login page offers. */
export const authProvidersSchema = z.object({
  providers: z.array(loginProviderSchema),
  /** Development only: requests without a session act as the dev owner, no login needed. */
  devLogin: z.boolean(),
  signup: signupModeSchema,
  /** No login works yet: the login page points to the setup link in the server log. */
  needsSetup: z.boolean(),
  /**
   * No instance admin yet, and this browser hasn't typed in the setup token: nobody may sign in
   * or up – the login page points to `/einrichtung`.
   */
  setupPending: z.boolean(),
  /**
   * "Weiter mit Nextcloud" for any Nextcloud: the address typed, then Login Flow v2
   * (`POST /auth/nextcloud/flow`). Next to a `nextcloud` provider it is the way for other ones.
   */
  nextcloudAnyServer: z.boolean(),
  /**
   * Google Drive as a source (BER-119): Google's file picker on /neu. Needs the Google login's
   * client; Google links that anyone may open work without it.
   */
  googleDrive: z.boolean(),
  /**
   * Some workspace has its own company login (BER-162): the login page offers "Mit
   * Firmen-Login" – the address typed finds it (`POST /auth/sso/discover`).
   */
  sso: z.boolean(),
  /**
   * "Mit E-Mail fortfahren" (BER-168): a link by mail signs in or creates the account, no
   * password. Only where the server sends mail (`POST /auth/email/start`).
   */
  emailLogin: z.boolean(),
});
export type AuthProviders = z.infer<typeof authProvidersSchema>;

/**
 * `?error=` on `/login` after a failed sign-in:
 * `signup_closed` (no account and no invitation), `account_exists` (the e-mail belongs to an
 * account that signs in another way), `no_email`/`email_unverified` (the provider sent no usable
 * address), `admin_consent`/`denied`/`failed`,
 * `account_limit` (the Microsoft account is already connected to two Slider accounts).
 */
export const LOGIN_ERRORS = [
  'signup_closed',
  'account_exists',
  'no_email',
  'email_unverified',
  'admin_consent',
  'denied',
  'failed',
  'account_limit',
  /** A new account through any Nextcloud needs its address confirmed by mail, and this instance sends none. */
  'mail_unavailable',
  /** The workspace's company login is off (deleted, domain changed, plan). */
  'sso_unavailable',
  /** The company login sent an address outside the workspace's domain. */
  'sso_domain',
  /** Too many sign-in attempts from this client address; it may try again in a few minutes. */
  'rate_limited',
  /** The instance admin blocked the account (BER-167). */
  'account_blocked',
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

/**
 * Answer of the passkey login: where the browser goes next – `returnTo`
 * when signed in (session cookie set), or `/login?error=…` when the account may not sign in.
 */
export const loginResultSchema = z.object({ redirectTo: z.string() });
export type LoginResult = z.infer<typeof loginResultSchema>;

/** `POST /auth/email/start`: mails a login link to the address (BER-168). Always `204`. */
export const startEmailLoginInputSchema = z.object({
  email: z.email('Bitte gib eine gültige E-Mail-Adresse ein.').max(254),
  returnTo: z.string().max(2048).optional(),
});
export type StartEmailLoginInput = z.infer<typeof startEmailLoginInputSchema>;

/** `POST /auth/email/confirm`: the token from the mailed link. */
export const confirmEmailLoginInputSchema = z.object({ token: z.string().min(1).max(200) });
export type ConfirmEmailLoginInput = z.infer<typeof confirmEmailLoginInputSchema>;

/** Signed in (session cookie set) – `newAccount`: the link just created it. */
export const emailLoginResultSchema = loginResultSchema.extend({ newAccount: z.boolean() });
export type EmailLoginResult = z.infer<typeof emailLoginResultSchema>;

// ── Passkeys ────────────────────────────────────────────────────────────────

export const passkeySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Synced across devices (iCloud Keychain, Google Password Manager, 1Password, …). */
  synced: z.boolean(),
});
export type Passkey = z.infer<typeof passkeySchema>;

export const passkeyNameSchema = z.string().trim().min(1).max(60);

/** `response` is the JSON of `navigator.credentials.create()` (`@simplewebauthn/browser`). */
export const verifyPasskeyRegistrationInputSchema = z.object({
  response: z.record(z.string(), z.unknown()),
  name: passkeyNameSchema.optional(),
});
export type VerifyPasskeyRegistrationInput = z.infer<typeof verifyPasskeyRegistrationInputSchema>;

export const renamePasskeyInputSchema = z.object({ name: passkeyNameSchema });
export type RenamePasskeyInput = z.infer<typeof renamePasskeyInputSchema>;

/** `response` is the JSON of `navigator.credentials.get()`. */
export const verifyPasskeyLoginInputSchema = z.object({
  response: z.record(z.string(), z.unknown()),
  returnTo: z.string().max(2048).optional(),
});
export type VerifyPasskeyLoginInput = z.infer<typeof verifyPasskeyLoginInputSchema>;

// ── Connected logins ────────────────────────────────────────────────────────

/** `GET /me/identities` – how the account signs in (besides passkeys). Logins can't be removed. */
export const loginIdentitySchema = z.object({
  /** `<provider>:<subject>`. */
  id: z.string(),
  /** `sso`: a workspace's own company login (BER-162); `email`: login link by mail (BER-168). */
  provider: z.enum(['microsoft', 'google', 'oidc', 'nextcloud', 'sso', 'email']),
  /** The address the provider reported at the last login. */
  email: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type LoginIdentity = z.infer<typeof loginIdentitySchema>;

// ── Account ─────────────────────────────────────────────────────────────────

export const meUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  color: accentColorSchema,
  isInstanceAdmin: z.boolean(),
  /** At least one Microsoft account is connected – OneDrive/SharePoint links can be imported. */
  microsoftConnected: z.boolean(),
  /** How many Microsoft accounts are connected (`GET /me/microsoft` lists them). */
  microsoftConnections: z.number().int(),
});
export type MeUser = z.infer<typeof meUserSchema>;

/** `GET /me/microsoft` – a Microsoft account connected for OneDrive/SharePoint access. */
export const microsoftConnectionSchema = z.object({
  id: z.string(),
  /** Mail or UPN of the Microsoft account; `null` if Microsoft did not tell. */
  account: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** Reviews that keep themselves up to date through this account. */
  deckCount: z.number().int(),
  /** Microsoft refused its sign-in (revoked, expired): connect it again. */
  needsReconnect: z.boolean(),
});
export type MicrosoftConnection = z.infer<typeof microsoftConnectionSchema>;

// ── Plans (BER-130, BER-152) ────────────────────────────────────────────────

/**
 * Plans a workspace can be on: `free`, and `paid` – billed per workspace through Stripe,
 * never per seat (BER-152).
 */
export const PLAN_IDS = ['free', 'paid'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/**
 * What a workspace uses of its plan. `seatsUsed` = members + pending e-mail invites (a sent
 * invite reserves a seat). `max*` is `null` for unlimited (self-hosted instances may lift limits).
 * `storageBytes` counts every file of its reviews: originals, slide images, recordings (BER-151).
 */
export const workspaceUsageSchema = z.object({
  members: z.number().int(),
  seatsUsed: z.number().int(),
  maxMembers: z.number().int().nullable(),
  decks: z.number().int(),
  maxDecks: z.number().int().nullable(),
  storageBytes: z.number().int(),
  maxStorageBytes: z.number().int().nullable(),
});
export type WorkspaceUsage = z.infer<typeof workspaceUsageSchema>;

/** Bytes per kind of file a workspace stores (BER-151) – the "Nutzung" page's bar. */
export const storageBreakdownSchema = z.object({
  /** Images drawn in comments. */
  images: z.number().int().nonnegative(),
  videos: z.number().int().nonnegative(),
  /** Voice comments. */
  audio: z.number().int().nonnegative(),
  /** The PowerPoint files of every version. */
  originals: z.number().int().nonnegative(),
  /** Slide images and thumbnails. */
  slideImages: z.number().int().nonnegative(),
  other: z.number().int().nonnegative(),
});
export type StorageBreakdown = z.infer<typeof storageBreakdownSchema>;
export const STORAGE_CATEGORIES = [
  'originals',
  'slideImages',
  'images',
  'videos',
  'audio',
  'other',
] as const satisfies readonly (keyof StorageBreakdown)[];
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

/**
 * Why a paid workspace is about to fall back to free (BER-155): a payment failed, the person
 * paying left and nobody added a payment method yet, or the subscription was cancelled.
 */
export const DOWNGRADE_REASONS = ['payment_failed', 'owner_changed', 'canceled'] as const;
export const downgradeReasonSchema = z.enum(DOWNGRADE_REASONS);
export type DowngradeReason = z.infer<typeof downgradeReasonSchema>;

const personSchema = z.object({ id: z.string(), name: z.string() });

/**
 * Billing of a workspace (BER-152, BER-154). Exactly one admin pays – the billing owner –
 * apart from the admin role. `enabled` is false without Stripe (self-hosting): no billing at all.
 */
export const workspaceBillingSchema = z.object({
  enabled: z.boolean(),
  owner: personSchema.nullable(),
  /** The caller is the billing owner: only they see checkout and the customer portal. */
  isOwner: z.boolean(),
  /** Stripe's subscription status (`active`, `past_due`, …); `null` without a subscription. */
  status: z.string().nullable(),
  /** Next renewal of an active subscription (not during the trial, see `trialEndsAt`). */
  renewsAt: z.iso.datetime().nullable(),
  /**
   * Never had a subscription: the first checkout starts with 14 days of Paid, no payment method
   * needed. Without one by then, the workspace simply stays on Free.
   */
  trialAvailable: z.boolean(),
  /** End of the running trial; `null` outside a trial. */
  trialEndsAt: z.iso.datetime().nullable(),
  /** Cancelled to the end of the period: free from then on. */
  endsAt: z.iso.datetime().nullable(),
  /** Paid workspace without a working payment: free from then on unless someone pays. */
  downgradeAt: z.iso.datetime().nullable(),
  downgradeReason: downgradeReasonSchema.nullable(),
  /** The billing owner asked this admin to take over paying; effective once they pay. */
  transfer: z.object({ to: personSchema, requestedAt: z.iso.datetime() }).nullable(),
  /**
   * Paid granted by the instance admin, without Stripe (BER-167): nothing to pay or manage here.
   */
  granted: z.boolean(),
});
export type WorkspaceBilling = z.infer<typeof workspaceBillingSchema>;

/** `GET /workspaces/:id/usage` (members) – the "Nutzung" page of one workspace. */
export const workspaceUsageDetailsSchema = z.object({
  workspaceId: z.string(),
  plan: z.string(),
  usage: workspaceUsageSchema,
  storage: storageBreakdownSchema,
  billing: workspaceBillingSchema,
  /** Free and over a limit: only reading, deleting and upgrading work (BER-155). */
  locked: z.boolean(),
});
export type WorkspaceUsageDetails = z.infer<typeof workspaceUsageDetailsSchema>;

/** Stripe Checkout or customer portal to send the browser to. */
export const billingRedirectSchema = z.object({ url: z.string() });
export type BillingRedirect = z.infer<typeof billingRedirectSchema>;

/** `POST /workspaces/:id/billing/transfer`: the admin who should pay from now on. */
export const billingTransferInputSchema = z.object({ userId: z.string().min(1) });
export type BillingTransferInput = z.infer<typeof billingTransferInputSchema>;

/**
 * `POST /workspaces/:id/billing/transfer/accept`: on a paid workspace the checkout where the
 * new owner adds their payment method (`url`); on a free one the handover is done (`url: null`).
 */
export const billingTransferAcceptResultSchema = z.object({
  url: z.string().nullable(),
  details: workspaceUsageDetailsSchema,
});
export type BillingTransferAcceptResult = z.infer<typeof billingTransferAcceptResultSchema>;

/** `GET /me` → `limits`. */
export const meLimitsSchema = z.object({
  /** Every account may found one workspace of its own (joining others is unlimited). */
  canCreateWorkspace: z.boolean(),
  /** Workspaces can be opened to a company domain on this instance (`SIGNUP` is not `invite`). */
  domainJoin: z.boolean(),
});
export type MeLimits = z.infer<typeof meLimitsSchema>;

// ── Workspaces ──────────────────────────────────────────────────────────────

/** A workspace – "Workspace" in the UI too (BER-130). */
export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** Uploaded logo; `null` shows the monogram. Only admins change it. */
  logoUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** The caller's role. */
  role: workspaceRoleSchema,
  memberCount: z.number().int(),
  /** Usually a {@link PlanId}; a string so older clients survive new plans. */
  plan: z.string(),
  usage: workspaceUsageSchema,
  billing: workspaceBillingSchema,
  /** Free and over a limit: only reading, deleting and upgrading work (BER-155). */
  locked: z.boolean(),
  /**
   * Company workspace (BER-148): everyone with a verified address at this domain finds it and
   * may join as member. `null`: private – only invitations lead in.
   */
  joinDomain: z.string().nullable(),
  /**
   * Founded automatically at sign-up and nobody said yet whether it is private or the company's:
   * its admins are asked once.
   */
  audiencePending: z.boolean(),
  /**
   * Blocked by the instance admin (BER-167): listed so its members know, but it opens nowhere –
   * only leaving works.
   */
  blocked: z.boolean(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceNameSchema = z.string().trim().min(1).max(80);
export const createWorkspaceInputSchema = z.object({ name: workspaceNameSchema });
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export const updateWorkspaceInputSchema = z.object({ name: workspaceNameSchema });
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

/**
 * `PUT /workspaces/:id/domain` (admins): `enabled` opens the workspace to the admin's own
 * e-mail domain, `false` makes it private again. Either answers the sign-up question.
 */
export const updateWorkspaceDomainInputSchema = z.object({ enabled: z.boolean() });
export type UpdateWorkspaceDomainInput = z.infer<typeof updateWorkspaceDomainInputSchema>;

/** `GET /me` → `domainWorkspace`: the company workspace of the viewer's domain, not joined yet. */
export const domainWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  domain: z.string(),
  memberCount: z.number().int(),
});
export type DomainWorkspace = z.infer<typeof domainWorkspaceSchema>;

/**
 * Mail providers anyone can get an address at: their domains never stand for a company, so
 * nobody can open a workspace to them (BER-148). Only the most common ones – enough for the
 * web app's hints; the API checks against a maintained list of all of them (`isCompanyMailDomain`).
 */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.de',
  'outlook.at',
  'outlook.fr',
  'hotmail.com',
  'hotmail.de',
  'hotmail.co.uk',
  'hotmail.fr',
  'live.com',
  'live.de',
  'live.co.uk',
  'msn.com',
  'yahoo.com',
  'yahoo.de',
  'yahoo.co.uk',
  'yahoo.fr',
  'ymail.com',
  'mail.com',
  'mail.de',
  'qq.com',
  '163.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'aol.de',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.de',
  'gmx.net',
  'gmx.at',
  'gmx.ch',
  'gmx.com',
  'web.de',
  't-online.de',
  'freenet.de',
  'posteo.de',
  'posteo.net',
  'mailbox.org',
  'arcor.de',
  'online.de',
  'email.de',
  'vodafone.de',
  'yandex.com',
  'mail.ru',
  'zoho.com',
  'tutanota.com',
  'tuta.io',
  'fastmail.com',
]);

/** The lower-case domain of an address (`name@Firma.de` → `firma.de`). */
export const emailDomain = (email: string) =>
  email
    .slice(email.lastIndexOf('@') + 1)
    .trim()
    .toLowerCase();

/** A domain a workspace can be opened to: not a mail provider's. */
export const isCompanyDomain = (domain: string) =>
  domain.includes('.') && !FREEMAIL_DOMAINS.has(domain);

/** `PUT /workspaces/:id/logo` (multipart, field `file`): PNG, JPEG or WebP up to this size. */
export const WORKSPACE_LOGO_MAX_BYTES = 1024 * 1024;
export const WORKSPACE_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** `POST /workspaces/:id/fonts` (multipart, field `files`, several): TTF or OTF files, or zips of them. */
export const WORKSPACE_FONT_MAX_BYTES = 20 * 1024 ** 2;
/** All files of one upload together. */
export const WORKSPACE_FONT_UPLOAD_MAX_BYTES = 80 * 1024 ** 2;
/** Faces one workspace may have. */
export const WORKSPACE_FONT_MAX_FACES = 200;

/**
 * A font a workspace uploaded – or took from a deck that brought it along – one face of a
 * family: its decks are drawn in it. `url` loads the file; the metrics (in font units) are how
 * LibreOffice lays it out.
 */
export const workspaceFontSchema = z.object({
  id: z.string(),
  family: z.string(),
  weight: z.union([z.literal(400), z.literal(700)]),
  italic: z.boolean(),
  url: z.string(),
  upm: z.number().int().positive(),
  ascent: z.number().int(),
  descent: z.number().int(),
  sizeBytes: z.number().int().nonnegative(),
  /** The deck the face was taken from (the font came embedded in its file); `null`: uploaded. */
  sourceFile: z.string().nullable().default(null),
});
export type WorkspaceFont = z.infer<typeof workspaceFontSchema>;

/** `POST /workspaces/:id/fonts`: the workspace's fonts now, and the files that were no font. */
export const workspaceFontUploadSchema = z.object({
  fonts: z.array(workspaceFontSchema),
  /** A file that could not be taken, and why (German). */
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
});
export type WorkspaceFontUpload = z.infer<typeof workspaceFontUploadSchema>;

export const workspaceMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  color: accentColorSchema,
  role: workspaceRoleSchema,
  /** Founded the workspace – can't be given or taken, only shown. */
  isCreator: z.boolean(),
  joinedAt: z.iso.datetime(),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/**
 * `GET /workspaces/:id/members/:userId/departure` (BER-165): what happens to someone's decks when
 * they leave or are removed – shown before they go. Linked decks are deleted (Slider reads their
 * files with the owner's accounts); uploads pass to `heir`, the workspace owner. `?successor=`
 * as on the `DELETE`.
 */
export const memberDepartureSchema = z.object({
  heir: z.object({ userId: z.string(), name: z.string() }).nullable(),
  deleted: z.array(z.object({ id: z.string(), title: z.string() })),
  transferred: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type MemberDeparture = z.infer<typeof memberDepartureSchema>;

export const updateMemberInputSchema = z.object({ role: workspaceRoleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;

/**
 * Invitations hand out every role. `viewer` is what sharing a deck hands out: there are no
 * guests, everyone looking is a member.
 */
export const inviteRoleSchema = workspaceRoleSchema;
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const INVITE_STATES = ['valid', 'expired', 'revoked', 'used'] as const;
export const inviteStateSchema = z.enum(INVITE_STATES);
export type InviteState = z.infer<typeof inviteStateSchema>;

export const workspaceInviteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  /** `null`: a link anyone may use (until it expires or is revoked); else single-use for this address. */
  email: z.string().nullable(),
  role: inviteRoleSchema,
  state: inviteStateSchema,
  createdBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  useCount: z.number().int(),
  /** Invites from the former deck sharing (removed): joining leads to this deck. */
  deck: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;

export const createWorkspaceInviteInputSchema = z.object({
  /** Omit for a link invite. */
  email: z.email().max(320).optional(),
  role: inviteRoleSchema.default('member'),
});
export type CreateWorkspaceInviteInput = z.input<typeof createWorkspaceInviteInputSchema>;

/** `POST /workspaces/:id/invites` – the only time the plain link is visible. */
export const createdWorkspaceInviteSchema = z.object({
  invite: workspaceInviteSchema,
  /** `${SLIDER_URL}/join/<token>` */
  url: z.string(),
  /** The invitation went out by mail (SMTP configured); otherwise the link is sent by hand. */
  emailSent: z.boolean(),
});
export type CreatedWorkspaceInvite = z.infer<typeof createdWorkspaceInviteSchema>;

/** `GET /join/:token` – public preview of an invite link. */
export const joinPreviewSchema = z.object({
  workspaceName: z.string(),
  workspaceLogoUrl: z.string().nullable(),
  inviterName: z.string().nullable(),
  role: inviteRoleSchema,
  /** E-mail invites: the address, masked (`r…t@firma.de`); `null` for link invites. */
  email: z.string().nullable(),
  state: inviteStateSchema,
  /** The shared deck, for invites created by sharing one. */
  deck: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type JoinPreview = z.infer<typeof joinPreviewSchema>;

/** E-mail invites for the signed-in address, shown in `GET /me`. */
export const pendingInviteSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  inviterName: z.string().nullable(),
  role: inviteRoleSchema,
  expiresAt: z.iso.datetime(),
  /** The shared deck, for invites created by sharing one. */
  deck: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type PendingInvite = z.infer<typeof pendingInviteSchema>;

/** Response of `POST /join/:token` and `POST /workspace-invites/:id/accept`. */
export const joinResultSchema = z.object({
  workspace: workspaceSchema,
  /** Set when the invite shared a deck that still exists: open it next. */
  deckId: z.string().nullable(),
});
export type JoinResult = z.infer<typeof joinResultSchema>;

/**
 * An open tab posts `POST /workspaces/:id/presence` this often while visible; it answers with
 * the other members online right now (the header's avatars).
 */
export const WORKSPACE_PRESENCE_POLL_MS = 20_000;
