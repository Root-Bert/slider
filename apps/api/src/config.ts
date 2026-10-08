import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  DEFAULT_MEDIA_QUOTA_BYTES,
  MAX_MEDIA_BYTES,
  MAX_UPLOAD_BYTES,
  SIGNUP_MODES,
  type PlanId,
  type SignupMode,
} from '@slider/shared';
import { DEFAULT_PLAN_LIMITS, type PlanLimits } from './services/plans';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  /** Holds `db/` (PGlite) and `blobs/` (file storage). */
  dataDir: string;
  /** Signs the guest session cookie. */
  secret: string;
  webOrigin: string;
  maxUploadBytes: number;
  /**
   * With `auth.devLogin`, every request without a guest or session cookie acts as this person.
   * The first real login adopts this account (and its decks) – see `services/accounts`.
   */
  devOwner: { name: string; email: string };
  /** Login, sessions and who may sign up (BER-129). */
  auth: AuthConfig;
  /** Outgoing mail for magic links and invitations; `null` until SMTP_URL and MAIL_FROM are set. */
  smtp: SmtpConfig | null;
  /** Requests per minute and IP on `/api/invites/*`. */
  inviteRateLimit: number;
  /** Entra app for OneDrive/SharePoint links (BER-92); `null` until MS_CLIENT_ID and MS_CLIENT_SECRET are set. */
  microsoft: MicrosoftConfig | null;
  /** Automatic updates of link-imported decks (BER-107). */
  sync: SyncConfig;
  /** Voice and video comments (BER-116). */
  media: MediaConfig;
  /** Limits per plan (BER-130); the free plan's can be overridden by env (self-hosting). */
  plans: Record<PlanId, PlanLimits>;
  /** Self-hosting: Postgres server, built SPA, reverse proxy. Absent in tests. */
  hosting?: HostingConfig;
  /**
   * `LIBREOFFICE_PATH`: the `soffice` binary that renders slide images of uploads (BER-94).
   * Unset → looked up on the PATH and in /Applications; not installed → SVG previews.
   */
  libreOfficePath?: string | null;
}

export interface MediaConfig {
  /**
   * Folder for recordings, separate from the deck blobs so it can live anywhere – a synced or
   * mounted folder, later an R2 bucket. Defaults to `<dataDir>/media`.
   */
  dir: string;
  /** Storage per deck owner; recordings by guests count towards the owner of the deck. */
  quotaBytes: number;
  /** Per recording. */
  maxBytes: number;
}

export interface AuthConfig {
  /**
   * Cookie-less requests act as the dev owner – no login at all. Default: on in development and
   * tests when no login provider is configured; never in production.
   */
  devLogin: boolean;
  /** Who may create an account (the very first account and invited people always may). */
  signup: SignupMode;
  /** For `signup: 'domains'`: verified e-mail domains that may sign up, lower-case. */
  signupDomains: string[];
  /** Generic OpenID Connect provider (Authentik, Keycloak, Zitadel, …). */
  oidc: OidcConfig | null;
  /** "Weiter mit Google": built on the OIDC client with Google's issuer; `null` without GOOGLE_*. */
  google: OidcConfig | null;
  /** Session lifetime; renewed on use (at most once a day). */
  sessionTtlDays: number;
  /**
   * `BOOTSTRAP_EMAIL`: the (verified) addresses that may create the very first account, which
   * becomes instance admin and adopts the dev owner. Lower-case. Empty: anyone in development;
   * in production only who `SIGNUP` would admit anyway – see `services/accounts`.
   */
  bootstrapEmails: string[];
}

export interface OidcConfig {
  /** Discovery runs against `${issuer}/.well-known/openid-configuration`. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Button text on the login page. */
  label: string;
  scopes: string;
  redirectUri: string;
  /** Further spellings of the issuer in ID tokens (Google also sends `accounts.google.com`). */
  issuerAliases?: string[];
  /** Extra authorize parameters, e.g. `prompt=select_account`. */
  authorizeParams?: Record<string, string>;
}

export const GOOGLE_ISSUER = 'https://accounts.google.com';

export interface SmtpConfig {
  /** e.g. `smtps://user:pass@mail.example.com:465` */
  url: string;
  /** e.g. `Slider <slider@example.com>` */
  from: string;
}

export interface SyncConfig {
  /** How often link decks are checked for changes; `0` turns polling off (manual sync still works). */
  pollIntervalMs: number;
  /** Quiet time after the last change before a new revision is imported (PowerPoint autosaves). */
  debounceMs: number;
}

export const DEFAULT_SYNC_POLL_INTERVAL_MS = 120_000;
export const DEFAULT_SYNC_DEBOUNCE_MS = 60_000;
export const MIN_SYNC_POLL_INTERVAL_MS = 10_000;

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  /** `common` = any work/school directory plus personal accounts. */
  tenant: string;
  /** Must match a redirect URI of the app registration exactly. */
  redirectUri: string;
}

const DEV_SECRET = 'slider-dev-secret-do-not-use-in-production';
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../.data', import.meta.url));
/** `.env` lives in the repo root, so relative paths in it are meant from there – not from `apps/api`. */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MICROSOFT_CALLBACK_PATH = '/api/auth/microsoft/callback';
const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';
const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
const booleanEnv = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATA_DIR: z.string().min(1).default(DEFAULT_DATA_DIR),
  SLIDER_SECRET: z
    .string()
    .min(32, 'SLIDER_SECRET muss mindestens 32 Zeichen lang sein.')
    .optional(),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(MAX_UPLOAD_BYTES),
  DEV_OWNER_NAME: z.string().min(1).default('Robert Hofmann'),
  DEV_OWNER_EMAIL: z.email().default('robert@q4-team.de'),
  INVITE_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  MS_TENANT: z.string().optional(),
  MS_REDIRECT_URI: z.url().optional(),
  SYNC_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .refine((ms) => ms === 0 || ms >= MIN_SYNC_POLL_INTERVAL_MS, {
      message: `SYNC_POLL_INTERVAL_MS muss 0 (aus) oder mindestens ${MIN_SYNC_POLL_INTERVAL_MS} sein.`,
    })
    .default(DEFAULT_SYNC_POLL_INTERVAL_MS),
  SYNC_DEBOUNCE_MS: z.coerce.number().int().min(0).default(DEFAULT_SYNC_DEBOUNCE_MS),
  AUTH_DEV_LOGIN: booleanEnv.optional(),
  SIGNUP: z.enum(SIGNUP_MODES).default('open'),
  SIGNUP_DOMAINS: z.string().optional(),
  BOOTSTRAP_EMAIL: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_LABEL: z.string().min(1).default('Weiter mit SSO'),
  OIDC_SCOPES: z.string().min(1).default('openid profile email'),
  OIDC_REDIRECT_URI: z.url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//, 'SMTP_URL muss mit smtp:// oder smtps:// beginnen.')
    .optional(),
  MAIL_FROM: z.string().min(3).optional(),
  MEDIA_DIR: z.string().min(1).optional(),
  MEDIA_QUOTA_BYTES: z.coerce.number().int().positive().default(DEFAULT_MEDIA_QUOTA_BYTES),
  MAX_MEDIA_BYTES: z.coerce.number().int().positive().default(MAX_MEDIA_BYTES),
  /** `0` = unlimited. */
  PLAN_FREE_MAX_MEMBERS: z.coerce.number().int().min(0).optional(),
  PLAN_FREE_MAX_DECKS: z.coerce.number().int().min(0).optional(),
  LIBREOFFICE_PATH: z.string().min(1).optional(),
});

/** Env value → limit: unset keeps the default, `0` means unlimited (`null`). */
const limitFromEnv = (value: number | undefined, fallback: number | null) =>
  value === undefined ? fallback : value === 0 ? null : value;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = console.warn,
): Config {
  const parsed = envSchema.parse(stripEmpty(env));
  if (!parsed.SLIDER_SECRET) {
    if (parsed.NODE_ENV === 'production')
      throw new Error('SLIDER_SECRET must be set in production.');
    warn('SLIDER_SECRET is not set – using an insecure development secret.');
  }
  const dataDir = path.resolve(REPO_ROOT, parsed.DATA_DIR);
  const microsoft: MicrosoftConfig | null =
    parsed.MS_CLIENT_ID && parsed.MS_CLIENT_SECRET
      ? {
          clientId: parsed.MS_CLIENT_ID,
          clientSecret: parsed.MS_CLIENT_SECRET,
          tenant: parsed.MS_TENANT ?? 'common',
          redirectUri:
            parsed.MS_REDIRECT_URI ??
            new URL(MICROSOFT_CALLBACK_PATH, parsed.WEB_ORIGIN).toString(),
        }
      : null;
  const oidc: OidcConfig | null =
    parsed.OIDC_ISSUER && parsed.OIDC_CLIENT_ID && parsed.OIDC_CLIENT_SECRET
      ? {
          issuer: parsed.OIDC_ISSUER.replace(/\/+$/, ''),
          clientId: parsed.OIDC_CLIENT_ID,
          clientSecret: parsed.OIDC_CLIENT_SECRET,
          label: parsed.OIDC_LABEL,
          scopes: parsed.OIDC_SCOPES,
          redirectUri:
            parsed.OIDC_REDIRECT_URI ?? new URL(OIDC_CALLBACK_PATH, parsed.WEB_ORIGIN).toString(),
        }
      : null;
  if (parsed.OIDC_ISSUER && !oidc) {
    throw new Error('OIDC_ISSUER needs OIDC_CLIENT_ID and OIDC_CLIENT_SECRET.');
  }
  if (Boolean(parsed.GOOGLE_CLIENT_ID) !== Boolean(parsed.GOOGLE_CLIENT_SECRET)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.');
  }
  const google: OidcConfig | null =
    parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET
      ? {
          issuer: GOOGLE_ISSUER,
          clientId: parsed.GOOGLE_CLIENT_ID,
          clientSecret: parsed.GOOGLE_CLIENT_SECRET,
          label: 'Weiter mit Google',
          scopes: 'openid email profile',
          redirectUri:
            parsed.GOOGLE_REDIRECT_URI ??
            new URL(GOOGLE_CALLBACK_PATH, parsed.WEB_ORIGIN).toString(),
          issuerAliases: ['accounts.google.com'],
          authorizeParams: { prompt: 'select_account' },
        }
      : null;
  if (Boolean(parsed.SMTP_URL) !== Boolean(parsed.MAIL_FROM)) {
    throw new Error('SMTP_URL and MAIL_FROM must be set together.');
  }
  const smtp =
    parsed.SMTP_URL && parsed.MAIL_FROM ? { url: parsed.SMTP_URL, from: parsed.MAIL_FROM } : null;
  const hasLoginProvider = Boolean(microsoft || oidc || google || smtp);
  if (parsed.NODE_ENV === 'production') {
    if (!hasLoginProvider) {
      throw new Error(
        'No login is configured: set MS_CLIENT_ID/MS_CLIENT_SECRET, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET or SMTP_URL/MAIL_FROM.',
      );
    }
    if (parsed.AUTH_DEV_LOGIN) throw new Error('AUTH_DEV_LOGIN cannot be enabled in production.');
  }
  const devLogin = parsed.NODE_ENV !== 'production' && (parsed.AUTH_DEV_LOGIN ?? !hasLoginProvider);
  const signupDomains = (parsed.SIGNUP_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  if (parsed.SIGNUP === 'domains' && signupDomains.length === 0) {
    throw new Error('SIGNUP=domains needs SIGNUP_DOMAINS, e.g. SIGNUP_DOMAINS=firma.de,firma.com');
  }
  const bootstrapEmails = (parsed.BOOTSTRAP_EMAIL ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const invalidBootstrap = bootstrapEmails.filter((email) => !z.email().safeParse(email).success);
  if (invalidBootstrap.length > 0) {
    throw new Error(`BOOTSTRAP_EMAIL contains invalid addresses: ${invalidBootstrap.join(', ')}`);
  }
  if (parsed.NODE_ENV === 'production' && bootstrapEmails.length === 0) {
    warn(
      [
        '!!! BOOTSTRAP_EMAIL is not set !!!',
        'The first login of this instance becomes instance admin. Without BOOTSTRAP_EMAIL that first',
        parsed.SIGNUP === 'invite'
          ? 'account cannot be created at all (SIGNUP=invite). Set BOOTSTRAP_EMAIL=you@example.com.'
          : `account may be claimed by anyone SIGNUP=${parsed.SIGNUP} admits. Set BOOTSTRAP_EMAIL=you@example.com.`,
        '(Harmless once the first account exists.)',
      ].join('\n'),
    );
  }
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    dataDir,
    secret: parsed.SLIDER_SECRET ?? DEV_SECRET,
    webOrigin: parsed.WEB_ORIGIN,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    devOwner: { name: parsed.DEV_OWNER_NAME, email: parsed.DEV_OWNER_EMAIL },
    auth: {
      devLogin,
      signup: parsed.SIGNUP,
      signupDomains,
      oidc,
      google,
      sessionTtlDays: parsed.SESSION_TTL_DAYS,
      bootstrapEmails,
    },
    smtp,
    inviteRateLimit: parsed.INVITE_RATE_LIMIT,
    microsoft,
    sync: { pollIntervalMs: parsed.SYNC_POLL_INTERVAL_MS, debounceMs: parsed.SYNC_DEBOUNCE_MS },
    media: {
      dir: parsed.MEDIA_DIR
        ? path.resolve(REPO_ROOT, expandHome(parsed.MEDIA_DIR))
        : path.join(dataDir, 'media'),
      quotaBytes: parsed.MEDIA_QUOTA_BYTES,
      maxBytes: parsed.MAX_MEDIA_BYTES,
    },
    plans: {
      ...DEFAULT_PLAN_LIMITS,
      free: {
        maxMembers: limitFromEnv(parsed.PLAN_FREE_MAX_MEMBERS, DEFAULT_PLAN_LIMITS.free.maxMembers),
        maxDecks: limitFromEnv(parsed.PLAN_FREE_MAX_DECKS, DEFAULT_PLAN_LIMITS.free.maxDecks),
      },
    },
    hosting: loadHostingConfig(env, parsed.NODE_ENV),
    libreOfficePath: parsed.LIBREOFFICE_PATH
      ? path.resolve(REPO_ROOT, expandHome(parsed.LIBREOFFICE_PATH))
      : null,
  };
}

/** `~/Dropbox/slider-media` → the home directory; `.env` does no shell expansion. */
function expandHome(dir: string): string {
  return dir === '~' || dir.startsWith('~/') ? path.join(homedir(), dir.slice(1)) : dir;
}

/** `KEY=` lines in `.env` arrive as empty strings; treat them like unset keys so defaults apply. */
function stripEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

export const dataPaths = (config: Pick<Config, 'dataDir'>) => ({
  dbDir: path.join(config.dataDir, 'db'),
  blobsDir: path.join(config.dataDir, 'blobs'),
});

// ── Self-hosting ────────────────────────────────────────────────────────────────────────────

export interface HostingConfig {
  /** `postgres://…` → a Postgres server; `null` → PGlite in `<dataDir>/db`. */
  databaseUrl: string | null;
  /** Built web app (`apps/web/dist`) served by the API itself; `null` → API only (dev: Vite). */
  webDistDir: string | null;
  /** Behind a reverse proxy (Caddy): take the client address from `X-Forwarded-For`. */
  trustProxy: boolean;
}

const hostingEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//i, 'DATABASE_URL muss mit postgres:// beginnen.')
    .optional(),
  WEB_DIST_DIR: z.string().min(1).optional(),
  TRUST_PROXY: z
    .enum(['0', '1', 'false', 'true'])
    .transform((value) => value === '1' || value === 'true')
    .optional(),
});

function loadHostingConfig(env: NodeJS.ProcessEnv, nodeEnv: Config['env']): HostingConfig {
  const parsed = hostingEnvSchema.parse(stripEmpty(env));
  const webDist = parsed.WEB_DIST_DIR ?? (nodeEnv === 'production' ? 'apps/web/dist' : null);
  return {
    databaseUrl: parsed.DATABASE_URL ?? null,
    webDistDir: webDist ? path.resolve(REPO_ROOT, webDist) : null,
    trustProxy: parsed.TRUST_PROXY ?? false,
  };
}
