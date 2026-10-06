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
}

const DEV_SECRET = 'slider-dev-secret-do-not-use-in-production';
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../.data', import.meta.url));

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
});

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = console.warn,
): Config {
  const parsed = envSchema.parse(env);
  if (!parsed.SLIDER_SECRET) {
    if (parsed.NODE_ENV === 'production')
      throw new Error('SLIDER_SECRET must be set in production.');
    warn('SLIDER_SECRET is not set – using an insecure development secret.');
  }
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    dataDir: parsed.DATA_DIR,
    secret: parsed.SLIDER_SECRET ?? DEV_SECRET,
    webOrigin: parsed.WEB_ORIGIN,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    devOwner: { name: parsed.DEV_OWNER_NAME, email: parsed.DEV_OWNER_EMAIL },
    inviteRateLimit: parsed.INVITE_RATE_LIMIT,
  };
}

export const dataPaths = (config: Pick<Config, 'dataDir'>) => ({
  dbDir: path.join(config.dataDir, 'db'),
  blobsDir: path.join(config.dataDir, 'blobs'),
});
