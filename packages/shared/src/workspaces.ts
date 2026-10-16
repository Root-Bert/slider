import { z } from 'zod';
import { accentColorSchema, workspaceRoleSchema } from './model';

/**
 * Accounts, login and workspaces (BER-129). Routes are listed in the contract table in `api.ts`.
 */

// ── Login ───────────────────────────────────────────────────────────────────

/** How new accounts may be created: only by invitation, by anyone, or by verified company domains. */
export const SIGNUP_MODES = ['invite', 'open', 'domains'] as const;
export const signupModeSchema = z.enum(SIGNUP_MODES);
export type SignupMode = z.infer<typeof signupModeSchema>;

export const loginProviderSchema = z.object({
  id: z.enum(['microsoft', 'google', 'oidc']),
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
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];

/**
 * Answer of the passkey login: where the browser goes next – `returnTo`
 * when signed in (session cookie set), or `/login?error=…` when the account may not sign in.
 */
export const loginResultSchema = z.object({ redirectTo: z.string() });
export type LoginResult = z.infer<typeof loginResultSchema>;

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

/** `GET /me/identities` – how the account signs in (besides passkeys). */
export const loginIdentitySchema = z.object({
  /** `<provider>:<subject>` – for `DELETE /me/identities/:id`. */
  id: z.string(),
  provider: z.enum(['microsoft', 'google', 'oidc']),
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
  /** A Microsoft refresh token is stored – OneDrive/SharePoint links can be imported. */
  microsoftConnected: z.boolean(),
});
export type MeUser = z.infer<typeof meUserSchema>;

// ── Plans (BER-130) ─────────────────────────────────────────────────────────

/** Plans an organisation can be on. Only `free` for now; higher plans get their own limits. */
export const PLAN_IDS = ['free'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/**
 * What an organisation uses of its plan. `seatsUsed` = members + pending e-mail invites (a sent
 * invite reserves a seat). `max*` is `null` for unlimited (self-hosted instances may lift limits).
 */
export const workspaceUsageSchema = z.object({
  members: z.number().int(),
  seatsUsed: z.number().int(),
  maxMembers: z.number().int().nullable(),
  decks: z.number().int(),
  maxDecks: z.number().int().nullable(),
});
export type WorkspaceUsage = z.infer<typeof workspaceUsageSchema>;

/** `GET /me` → `limits`. */
export const meLimitsSchema = z.object({
  /** Every account may found one organisation of its own (joining others is unlimited). */
  canCreateWorkspace: z.boolean(),
});
export type MeLimits = z.infer<typeof meLimitsSchema>;

// ── Workspaces ──────────────────────────────────────────────────────────────

/** A workspace is called "Organisation" in the UI (BER-130). */
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
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceNameSchema = z.string().trim().min(1).max(80);
export const createWorkspaceInputSchema = z.object({ name: workspaceNameSchema });
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export const updateWorkspaceInputSchema = z.object({ name: workspaceNameSchema });
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

/** `PUT /workspaces/:id/logo` (multipart, field `file`): PNG, JPEG or WebP up to this size. */
export const WORKSPACE_LOGO_MAX_BYTES = 1024 * 1024;
export const WORKSPACE_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

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
