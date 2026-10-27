import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  MAX_MEDIA_BYTES,
  MAX_UPLOAD_BYTES,
  SIGNUP_MODES,
  type PlanId,
  type SignupMode,
} from '@slider/shared';
import { LIBREOFFICE_TIMEOUT_MS } from './import/libreoffice';
import { PDF_TIMEOUT_MS } from './import/pdf-jobs';
import { DEFAULT_PLAN_LIMITS, UNLIMITED_PLAN, type PlanLimits } from './services/plans';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  /** Holds `db/` (PGlite) and `blobs/` (file storage). */
  dataDir: string;
  /**
   * Signs cookies and login codes, encrypts Microsoft tokens and stored settings. `SLIDER_SECRET`,
   * else (production) generated once into `<dataDir>/secret`.
   */
  secret: string;
  /** The public address (`SLIDER_URL`, formerly `WEB_ORIGIN`), without a trailing slash. */
  webOrigin: string;
  maxUploadBytes: number;
  /**
   * With `auth.devLogin`, every request without a session cookie acts as this person. Whoever
   * claims the instance with the setup token takes over its decks – see `services/accounts`.
   */
  devOwner: { name: string; email: string };
  /** Login, sessions and who may sign up (BER-129). */
  auth: AuthConfig;
  /** Outgoing mail for invitations; `null` until SMTP_URL and MAIL_FROM are set. */
  smtp: SmtpConfig | null;
  /** Where the website's contact form is mailed (`CONTACT_EMAIL`); `null`: the form is off. */
  contactEmail: string | null;
  /** Deletion deadlines (BER-143). */
  retention: RetentionConfig;
  /** Requests per minute and IP on `/api/invites/*`. */
  inviteRateLimit: number;
  /** Entra app for OneDrive/SharePoint links (BER-92); `null` until MS_CLIENT_ID and MS_CLIENT_SECRET are set. */
  microsoft: MicrosoftConfig | null;
  /** Nextcloud as a source (BER-135). */
  nextcloud: NextcloudConfig;
  /**
   * Google Drive as a source (BER-119): on with the Google login. `null` without it (public Google
   * links still import).
   */
  googleDrive: GoogleDriveConfig | null;
  /** Automatic updates of link-imported decks (BER-107). */
  sync: SyncConfig;
  /** Voice and video comments (BER-116). */
  media: MediaConfig;
  /**
   * Whether this instance limits its users at all: the hosted demo does (plans, one own
   * workspace per account, storage), a self-hosted instance doesn't. See
   * {@link isLimitedInstance}.
   */
  limited: boolean;
  /** Limits per plan (BER-130); the free plan's can be overridden by env (self-hosting). */
  plans: Record<PlanId, PlanLimits>;
  /**
   * Stripe for the paid plan (BER-152); `null` without STRIPE_* or on an instance without limits
   * (self-hosting) – then there is no billing at all.
   */
  billing: BillingConfig | null;
  /** Self-hosting: Postgres server, built SPA, reverse proxy. Absent in tests. */
  hosting?: HostingConfig;
  /**
   * `LIBREOFFICE_PATH`: the `soffice` binary that renders slide images of uploads (BER-94).
   * Unset → looked up on the PATH and in /Applications; not installed → SVG previews.
   */
  libreOfficePath?: string | null;
  /**
   * `LIBREOFFICE_TIMEOUT_MS`: how long one conversion may take before the deck falls back to SVG
   * previews. Big decks with many pictures on a small server need more than the default.
   */
  libreOfficeTimeoutMs?: number;
  /**
   * `LIBREOFFICE_WORKERS`: LibreOffices kept running to draw edited slides (`office-pool.ts`) –
   * each a few hundred MB, busy on one core while it draws. `0`: every drawing starts its own.
   */
  libreOfficeWorkers?: number;
  /**
   * `PDF_TIMEOUT_MS`: how long reading one PDF (and drawing its slide images) may take before it
   * is cut off, plus a second per page. A PDF that takes longer fails its import.
   */
  pdfTimeoutMs?: number;
  /**
   * `IMPORT_WORKERS`: how many decks are imported side by side, each with its own LibreOffice
   * (~1 CPU core and up to 1 GB RAM). Imports of one deck always run one after another.
   */
  importWorkers?: number;
  /** Stock photos from Unsplash; `null` (or absent) until UNSPLASH_ACCESS_KEY is set. */
  unsplash?: UnsplashConfig | null;
  /**
   * `AI_ALLOW_INTERNAL_URLS`: a workspace's OpenAI-compatible AI service may sit on an internal
   * address or plain http – a local Ollama or vLLM. Off by default: the server would otherwise
   * reach into its own network for whoever administers a workspace.
   */
  aiAllowInternalUrls?: boolean;
}

export interface UnsplashConfig {
  /** The application's Access Key – only ever used by the server, which searches for everyone. */
  accessKey: string;
}

export interface RetentionConfig {
  /**
   * `DELETE_UNUSED`: accounts and decks nobody used for 18 months are deleted, with reminder mails
   * before if mail is set up. On by default; the instance admin can switch it off (setup page).
   */
  deleteUnused: boolean;
}

export interface BillingConfig {
  /** `sk_…` / `rk_…` (restricted key). */
  secretKey: string;
  /** `whsec_…` of the webhook endpoint `<SLIDER_URL>/api/billing/webhook`. */
  webhookSecret: string;
  /** `price_…` of the paid plan (per workspace, monthly or yearly – decided in Stripe). */
  priceId: string;
}

export interface MediaConfig {
  /**
   * Folder for recordings, separate from the deck blobs so it can live anywhere – a synced or
   * mounted folder, later an R2 bucket. Defaults to `<dataDir>/media`.
   */
  dir: string;
  /** Per recording. */
  maxBytes: number;
}

export interface AuthConfig {
  /**
   * Cookie-less requests act as the dev owner – no login at all. Default: on in development and
   * tests when no login provider is configured; never in production.
   */
  devLogin: boolean;
  /**
   * Who may create an account. Invited people always may, and so may whoever holds the setup
   * token while there is no instance admin yet. Nobody becomes admin by signing up.
   */
  signup: SignupMode;
  /** For `signup: 'domains'`: verified e-mail domains that may sign up, lower-case. */
  signupDomains: string[];
  /** Generic OpenID Connect provider (Authentik, Keycloak, Zitadel, …). */
  oidc: OidcConfig | null;
  /** "Weiter mit Google": the OIDC client with Google's issuer; `null` without GOOGLE_*. */
  google: OidcConfig | null;
  /** Session lifetime; renewed on use (at most once a day). */
  sessionTtlDays: number;
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

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  /** The same callback as the login (`/api/auth/google/callback`): one URI to register. */
  redirectUri: string;
}

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

export const DEFAULT_SYNC_POLL_INTERVAL_MS = 60_000;
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

export interface NextcloudConfig {
  /**
   * `NEXTCLOUD_URL`: the organisation's Nextcloud. People connect it without typing an address,
   * and it may live on an internal address – every other Nextcloud must be public (SSRF).
   */
  server: string | null;
  /**
   * "Weiter mit Nextcloud": an OAuth 2.0 client registered in that Nextcloud (`NEXTCLOUD_CLIENT_ID`,
   * `NEXTCLOUD_CLIENT_SECRET`). Only for the organisation's Nextcloud: OAuth needs a client registered
   * there. Other Nextclouds sign in with `loginAnyServer`.
   */
  login: NextcloudLoginConfig | null;
  /**
   * `NEXTCLOUD_LOGIN_ANY` (default on): "Weiter mit Nextcloud" for any public Nextcloud – the
   * address typed, Login Flow v2, a new account only after the address is confirmed by mail.
   * Not a login of its own for `hasLogin`: it needs mail and leaves the setup page in place.
   */
  loginAnyServer: boolean;
}

export interface NextcloudLoginConfig {
  clientId: string;
  clientSecret: string;
  /** Must match the redirection URI of the client in Nextcloud exactly. */
  redirectUri: string;
}

/** `https://cloud.example.de/index.php/` → `https://cloud.example.de`. */
export const normalizeNextcloudServer = (url: string): string =>
  url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\/index\.php$/, '')
    .replace(/\/+$/, '');

const DEV_SECRET = 'slider-dev-secret-do-not-use-in-production';
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../.data', import.meta.url));
/** `.env` lives in the repo root, so relative paths in it are meant from there – not from `apps/api`. */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const MICROSOFT_CALLBACK_PATH = '/api/auth/microsoft/callback';
export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
export const NEXTCLOUD_CALLBACK_PATH = '/api/auth/nextcloud/callback';
/** Company login of a workspace (BER-162): one redirect URI for all of them. */
export const SSO_CALLBACK_PATH = '/api/auth/sso/callback';
const booleanEnv = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATA_DIR: z.string().min(1).default(DEFAULT_DATA_DIR),
  SLIDER_SECRET: z
    .string()
    .min(32, 'SLIDER_SECRET muss mindestens 32 Zeichen lang sein.')
    .optional(),
  /** The public address; `WEB_ORIGIN` is the older name of the same setting. */
  SLIDER_URL: z.url().optional(),
  WEB_ORIGIN: z.url().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(MAX_UPLOAD_BYTES),
  DEV_OWNER_NAME: z.string().min(1).default('Robert Hofmann'),
  DEV_OWNER_EMAIL: z.email().default('robert@example.org'),
  INVITE_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  MS_TENANT: z.string().optional(),
  NEXTCLOUD_URL: z
    .url({ protocol: /^https?$/, error: 'NEXTCLOUD_URL muss mit https:// oder http:// beginnen.' })
    .optional(),
  NEXTCLOUD_CLIENT_ID: z.string().optional(),
  NEXTCLOUD_CLIENT_SECRET: z.string().optional(),
  NEXTCLOUD_LOGIN_ANY: booleanEnv.default(true),
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
  DELETE_UNUSED: booleanEnv.optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  OIDC_ISSUER: z.url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_LABEL: z.string().min(1).default('Weiter mit SSO'),
  OIDC_SCOPES: z.string().min(1).default('openid profile email'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//, 'SMTP_URL muss mit smtp:// oder smtps:// beginnen.')
    .optional(),
  MAIL_FROM: z.string().min(3).optional(),
  CONTACT_EMAIL: z.email().optional(),
  MEDIA_DIR: z.string().min(1).optional(),
  /** Older name of PLAN_FREE_MAX_STORAGE_BYTES (it counted recordings per deck owner). */
  MEDIA_QUOTA_BYTES: z.coerce.number().int().min(0).optional(),
  MAX_MEDIA_BYTES: z.coerce.number().int().positive().default(MAX_MEDIA_BYTES),
  /** `0` = unlimited. */
  /** Forces the demo's limits on (`true`) or off (`false`); see {@link isLimitedInstance}. */
  SLIDER_DEMO: booleanEnv.optional(),
  PLAN_FREE_MAX_MEMBERS: z.coerce.number().int().min(0).optional(),
  PLAN_FREE_MAX_DECKS: z.coerce.number().int().min(0).optional(),
  /** `0` = unlimited. Every file of a workspace's reviews counts (BER-151). */
  PLAN_FREE_MAX_STORAGE_BYTES: z.coerce.number().int().min(0).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  LIBREOFFICE_PATH: z.string().min(1).optional(),
  LIBREOFFICE_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(LIBREOFFICE_TIMEOUT_MS),
  LIBREOFFICE_WORKERS: z.coerce.number().int().min(0).max(32).default(2),
  PDF_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(PDF_TIMEOUT_MS),
  IMPORT_WORKERS: z.coerce.number().int().min(1).max(16).default(1),
  UNSPLASH_ACCESS_KEY: z.string().min(10).optional(),
  AI_ALLOW_INTERNAL_URLS: booleanEnv.optional(),
});

/** Env value → limit: unset keeps the default, `0` means unlimited (`null`). */
const limitFromEnv = (value: number | undefined, fallback: number | null) =>
  value === undefined ? fallback : value === 0 ? null : value;

/** The hosted demo; every other address is a self-hosted instance. */
export const DEMO_HOSTS = ['slider.bertro.dev'];

/**
 * Limits only apply on the hosted demo, where hosting costs money: recognised by its address,
 * or forced with `SLIDER_DEMO=true`. Every other instance – self-hosted, and development too –
 * runs without limits; the `PLAN_FREE_*` variables still set some
 * explicitly.
 */
export function isLimitedInstance(webOrigin: string, demo: boolean | undefined): boolean {
  return demo ?? DEMO_HOSTS.includes(new URL(webOrigin).hostname);
}

/**
 * https://, or plain http on this machine (localhost, 127.0.0.1, ::1) – the addresses where
 * browsers keep `Secure` cookies.
 */
export function isSecureOrigin(origin: string): boolean {
  const url = new URL(origin);
  if (url.protocol === 'https:') return true;
  const host = url.hostname;
  return (
    url.protocol === 'http:' &&
    (host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '[::1]' ||
      /^127(\.\d{1,3}){3}$/.test(host))
  );
}

/** What the server needs before the database is open: data folder, secret, database. */
export type BootConfig = Pick<Config, 'env' | 'dataDir' | 'secret' | 'hosting'>;

/**
 * The boot part of the config, without the cross-field checks of logins, mail and sign-up: one
 * half of a pair (e.g. GOOGLE_CLIENT_ID) may come from the environment and the other from the
 * setup page. {@link loadConfig} validates the merged settings once the database is open.
 */
export function loadBootConfig(env: NodeJS.ProcessEnv = process.env): BootConfig {
  const parsed = envSchema
    .pick({ NODE_ENV: true, DATA_DIR: true, SLIDER_SECRET: true })
    .parse(stripEmpty(env));
  const dataDir = path.resolve(REPO_ROOT, parsed.DATA_DIR);
  const secret =
    parsed.SLIDER_SECRET ??
    (parsed.NODE_ENV === 'production' ? loadOrCreateSecret(dataDir) : DEV_SECRET);
  return {
    env: parsed.NODE_ENV,
    dataDir,
    secret,
    hosting: loadHostingConfig(env, parsed.NODE_ENV),
  };
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = console.warn,
): Config {
  const parsed = envSchema.parse(stripEmpty(env));
  const dataDir = path.resolve(REPO_ROOT, parsed.DATA_DIR);
  const configuredUrl = parsed.SLIDER_URL ?? parsed.WEB_ORIGIN;
  if (!configuredUrl && parsed.NODE_ENV === 'production') {
    throw new Error(
      'SLIDER_URL must be set in production: the public address, e.g. SLIDER_URL=https://slider.firma.de',
    );
  }
  const webOrigin = (configuredUrl ?? 'http://localhost:5173').replace(/\/+$/, '');
  if (parsed.NODE_ENV === 'production' && !isSecureOrigin(webOrigin)) {
    // Login cookies are `Secure` in production; a browser drops them on a plain-http address,
    // so nobody could ever sign in – and nothing else would say why.
    throw new Error(
      `SLIDER_URL must start with https:// in production (got ${webOrigin}): login cookies are Secure and browsers drop them on http://. Put Slider behind HTTPS, e.g. with the Caddy setup in deploy/.`,
    );
  }
  let secret = parsed.SLIDER_SECRET;
  if (!secret) {
    if (parsed.NODE_ENV === 'production') secret = loadOrCreateSecret(dataDir);
    else warn('SLIDER_SECRET is not set – using an insecure development secret.');
  }
  const microsoft: MicrosoftConfig | null =
    parsed.MS_CLIENT_ID && parsed.MS_CLIENT_SECRET
      ? {
          clientId: parsed.MS_CLIENT_ID,
          clientSecret: parsed.MS_CLIENT_SECRET,
          tenant: parsed.MS_TENANT ?? 'common',
          redirectUri: new URL(MICROSOFT_CALLBACK_PATH, webOrigin).toString(),
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
          redirectUri: new URL(OIDC_CALLBACK_PATH, webOrigin).toString(),
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
          redirectUri: new URL(GOOGLE_CALLBACK_PATH, webOrigin).toString(),
          issuerAliases: ['accounts.google.com'],
          authorizeParams: { prompt: 'select_account' },
        }
      : null;
  const googleDrive: GoogleDriveConfig | null = google
    ? {
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        redirectUri: google.redirectUri,
      }
    : null;
  if (Boolean(parsed.NEXTCLOUD_CLIENT_ID) !== Boolean(parsed.NEXTCLOUD_CLIENT_SECRET)) {
    throw new Error('NEXTCLOUD_CLIENT_ID and NEXTCLOUD_CLIENT_SECRET must be set together.');
  }
  if (parsed.NEXTCLOUD_CLIENT_ID && !parsed.NEXTCLOUD_URL) {
    throw new Error('NEXTCLOUD_CLIENT_ID needs NEXTCLOUD_URL: the Nextcloud people sign in with.');
  }
  const nextcloudLogin: NextcloudLoginConfig | null =
    parsed.NEXTCLOUD_URL && parsed.NEXTCLOUD_CLIENT_ID && parsed.NEXTCLOUD_CLIENT_SECRET
      ? {
          clientId: parsed.NEXTCLOUD_CLIENT_ID,
          clientSecret: parsed.NEXTCLOUD_CLIENT_SECRET,
          redirectUri: new URL(NEXTCLOUD_CALLBACK_PATH, webOrigin).toString(),
        }
      : null;
  if (Boolean(parsed.SMTP_URL) !== Boolean(parsed.MAIL_FROM)) {
    throw new Error('SMTP_URL and MAIL_FROM must be set together.');
  }
  const smtp =
    parsed.SMTP_URL && parsed.MAIL_FROM ? { url: parsed.SMTP_URL, from: parsed.MAIL_FROM } : null;
  const hasLoginProvider = Boolean(microsoft || oidc || google || nextcloudLogin);
  // Production without any login starts anyway: the setup page (`/einrichtung`) configures one.
  if (parsed.NODE_ENV === 'production' && parsed.AUTH_DEV_LOGIN) {
    throw new Error('AUTH_DEV_LOGIN cannot be enabled in production.');
  }
  const devLogin = parsed.NODE_ENV !== 'production' && (parsed.AUTH_DEV_LOGIN ?? !hasLoginProvider);
  const signupDomains = (parsed.SIGNUP_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  if (parsed.SIGNUP === 'domains' && signupDomains.length === 0) {
    throw new Error('SIGNUP=domains needs SIGNUP_DOMAINS, e.g. SIGNUP_DOMAINS=firma.de,firma.com');
  }
  const limited = isLimitedInstance(webOrigin, parsed.SLIDER_DEMO);
  const planDefaults = limited ? DEFAULT_PLAN_LIMITS.free : UNLIMITED_PLAN;
  const stripeKeys = [
    parsed.STRIPE_SECRET_KEY,
    parsed.STRIPE_WEBHOOK_SECRET,
    parsed.STRIPE_PRICE_ID,
  ].filter(Boolean).length;
  if (stripeKeys > 0 && stripeKeys < 3) {
    throw new Error(
      'STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID must be set together.',
    );
  }
  if (stripeKeys === 3 && !limited) {
    warn('STRIPE_* is ignored: this instance has no limits, so there is nothing to pay for.');
  }
  const billing: BillingConfig | null =
    limited && parsed.STRIPE_SECRET_KEY && parsed.STRIPE_WEBHOOK_SECRET && parsed.STRIPE_PRICE_ID
      ? {
          secretKey: parsed.STRIPE_SECRET_KEY,
          webhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
          priceId: parsed.STRIPE_PRICE_ID,
        }
      : null;
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    dataDir,
    secret: secret ?? DEV_SECRET,
    webOrigin,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    devOwner: { name: parsed.DEV_OWNER_NAME, email: parsed.DEV_OWNER_EMAIL },
    auth: {
      devLogin,
      signup: parsed.SIGNUP,
      signupDomains,
      oidc,
      google,
      sessionTtlDays: parsed.SESSION_TTL_DAYS,
    },
    smtp,
    contactEmail: parsed.CONTACT_EMAIL ?? null,
    retention: { deleteUnused: parsed.DELETE_UNUSED ?? true },
    inviteRateLimit: parsed.INVITE_RATE_LIMIT,
    microsoft,
    nextcloud: {
      server: parsed.NEXTCLOUD_URL ? normalizeNextcloudServer(parsed.NEXTCLOUD_URL) : null,
      login: nextcloudLogin,
      loginAnyServer: parsed.NEXTCLOUD_LOGIN_ANY,
    },
    googleDrive,
    sync: { pollIntervalMs: parsed.SYNC_POLL_INTERVAL_MS, debounceMs: parsed.SYNC_DEBOUNCE_MS },
    media: {
      dir: parsed.MEDIA_DIR
        ? path.resolve(REPO_ROOT, expandHome(parsed.MEDIA_DIR))
        : path.join(dataDir, 'media'),
      maxBytes: parsed.MAX_MEDIA_BYTES,
    },
    limited,
    plans: {
      free: {
        maxMembers: limitFromEnv(parsed.PLAN_FREE_MAX_MEMBERS, planDefaults.maxMembers),
        maxDecks: limitFromEnv(parsed.PLAN_FREE_MAX_DECKS, planDefaults.maxDecks),
        maxStorageBytes: limitFromEnv(
          parsed.PLAN_FREE_MAX_STORAGE_BYTES ?? parsed.MEDIA_QUOTA_BYTES,
          planDefaults.maxStorageBytes,
        ),
      },
      paid: limited ? DEFAULT_PLAN_LIMITS.paid : UNLIMITED_PLAN,
    },
    billing,
    hosting: loadHostingConfig(env, parsed.NODE_ENV),
    libreOfficePath: parsed.LIBREOFFICE_PATH
      ? path.resolve(REPO_ROOT, expandHome(parsed.LIBREOFFICE_PATH))
      : null,
    libreOfficeTimeoutMs: parsed.LIBREOFFICE_TIMEOUT_MS,
    libreOfficeWorkers: parsed.LIBREOFFICE_WORKERS,
    pdfTimeoutMs: parsed.PDF_TIMEOUT_MS,
    importWorkers: parsed.IMPORT_WORKERS,
    unsplash: parsed.UNSPLASH_ACCESS_KEY ? { accessKey: parsed.UNSPLASH_ACCESS_KEY } : null,
    aiAllowInternalUrls: parsed.AI_ALLOW_INTERNAL_URLS ?? false,
  };
}

/** `~/Dropbox/slider-media` → the home directory; `.env` does no shell expansion. */
function expandHome(dir: string): string {
  return dir === '~' || dir.startsWith('~/') ? path.join(homedir(), dir.slice(1)) : dir;
}

/** `KEY=` lines in `.env` arrive as empty strings; treat them like unset keys so defaults apply. */
export function stripEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

/** Whether anyone can sign in at all: Microsoft, Google, OIDC or Nextcloud. */
export const hasLogin = (config: Pick<Config, 'microsoft' | 'auth' | 'nextcloud'>): boolean =>
  Boolean(config.microsoft || config.auth.google || config.auth.oidc || config.nextcloud.login);

/**
 * Settings saved on the setup page (`services/instance-settings`) under their env names, merged
 * below the environment: what the environment sets always wins.
 */
export const withStoredSettings = (
  env: NodeJS.ProcessEnv,
  stored: Record<string, string>,
): NodeJS.ProcessEnv => ({ ...stored, ...stripEmpty(env) });

const SECRET_FILE = 'secret';

/**
 * Without `SLIDER_SECRET`, production generates one on the first start and keeps it in the data
 * volume (readable by the server only) – so `docker run` needs no secret at all.
 */
function loadOrCreateSecret(dataDir: string): string {
  const file = path.join(dataDir, SECRET_FILE);
  if (existsSync(file)) {
    const stored = readFileSync(file, 'utf8').trim();
    if (stored.length >= 32) return stored;
    throw new Error(`${file} holds no usable secret (at least 32 characters).`);
  }
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, `${secret}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return secret;
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
