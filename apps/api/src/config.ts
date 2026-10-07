import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from '@slider/shared';

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  /** Holds `db/` (PGlite) and `blobs/` (file storage). */
  dataDir: string;
  /** Signs the guest session cookie. */
  secret: string;
  webOrigin: string;
  maxUploadBytes: number;
  /** Until Microsoft login exists (BER-92), every request without a guest cookie acts as this person. */
  devOwner: { name: string; email: string };
  /** Requests per minute and IP on `/api/invites/*`. */
  inviteRateLimit: number;
  /** Entra app for OneDrive/SharePoint links (BER-92); `null` until MS_CLIENT_ID and MS_CLIENT_SECRET are set. */
  microsoft: MicrosoftConfig | null;
  /** Automatic updates of link-imported decks (BER-107). */
  sync: SyncConfig;
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
});

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
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    dataDir: path.resolve(REPO_ROOT, parsed.DATA_DIR),
    secret: parsed.SLIDER_SECRET ?? DEV_SECRET,
    webOrigin: parsed.WEB_ORIGIN,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    devOwner: { name: parsed.DEV_OWNER_NAME, email: parsed.DEV_OWNER_EMAIL },
    inviteRateLimit: parsed.INVITE_RATE_LIMIT,
    microsoft:
      parsed.MS_CLIENT_ID && parsed.MS_CLIENT_SECRET
        ? {
            clientId: parsed.MS_CLIENT_ID,
            clientSecret: parsed.MS_CLIENT_SECRET,
            tenant: parsed.MS_TENANT ?? 'common',
            redirectUri:
              parsed.MS_REDIRECT_URI ??
              new URL(MICROSOFT_CALLBACK_PATH, parsed.WEB_ORIGIN).toString(),
          }
        : null,
    sync: { pollIntervalMs: parsed.SYNC_POLL_INTERVAL_MS, debounceMs: parsed.SYNC_DEBOUNCE_MS },
  };
}

/** `KEY=` lines in `.env` arrive as empty strings; treat them like unset keys so defaults apply. */
function stripEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

export const dataPaths = (config: Pick<Config, 'dataDir'>) => ({
  dbDir: path.join(config.dataDir, 'db'),
  blobsDir: path.join(config.dataDir, 'blobs'),
});
