import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { SECRET_SETUP_KEYS, SETUP_KEYS, type SetupKey } from '@slider/shared';
import { decryptToken, encryptToken } from '../auth/token-crypto';
import type { Executor } from '../db/client';
import { instanceSettings, users } from '../db/schema';
import {
  hasLogin,
  loadConfig,
  stripEmpty,
  withStoredSettings,
  type BootConfig,
  type Config,
} from '../config';
import type { Logger } from '../logger';

/**
 * Settings from the setup page (`/einrichtung`): stored under their env names and merged below the
 * environment on start (`withStoredSettings` in `config`). Changing them restarts the server.
 */

const PURPOSE = 'instance-settings';
const KNOWN = new Set<string>(SETUP_KEYS);
const SECRET = new Set<string>(SECRET_SETUP_KEYS);

/**
 * What the setup page may see of a value: nothing of a secret – except `SMTP_URL`, whose server,
 * port and user are shown without the password.
 */
export function visibleSetting(key: SetupKey, value: string | null): string | null {
  if (value === null || !SECRET.has(key)) return value;
  return key === 'SMTP_URL' ? withoutPassword(value) : null;
}

/**
 * An `SMTP_URL` from the page without a password (password left empty to keep it) gets the
 * stored one back – only for the same server, port and user: never sent to a newly entered host.
 */
export function keepSmtpPassword(next: string, stored: string | undefined): string {
  const incoming = parseUrl(next);
  const previous = stored ? parseUrl(stored) : null;
  if (!incoming || !previous || incoming.password || !previous.password) return next;
  if (!incoming.username || incoming.username !== previous.username) return next;
  // `host` includes the port; without one the scheme decides it.
  if (incoming.host !== previous.host || incoming.protocol !== previous.protocol) return next;
  incoming.password = previous.password;
  return incoming.toString();
}

function withoutPassword(value: string): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  url.password = '';
  return url.toString().replace(/\/$/, '');
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** All stored settings, secrets decrypted. Unreadable ones (another SLIDER_SECRET) are skipped. */
export async function readStoredSettings(
  db: Executor,
  secret: string,
  log?: Logger,
): Promise<Partial<Record<SetupKey, string>>> {
  const rows = await db.select().from(instanceSettings);
  const settings: Partial<Record<SetupKey, string>> = {};
  for (const row of rows) {
    if (!KNOWN.has(row.key)) continue;
    const key = row.key as SetupKey;
    if (!SECRET.has(key)) {
      settings[key] = row.value;
      continue;
    }
    try {
      settings[key] = await decryptToken(secret, row.value, PURPOSE);
    } catch {
      log?.warn(`Stored setting ${key} cannot be decrypted (SLIDER_SECRET changed?) – ignored.`);
    }
  }
  return settings;
}

/** A string sets the value, `null` (or an empty string) removes it; secrets are encrypted. */
export async function saveStoredSettings(
  db: Executor,
  secret: string,
  changes: Partial<Record<SetupKey, string | null>>,
  now: Date,
): Promise<void> {
  for (const [key, value] of Object.entries(changes) as [SetupKey, string | null][]) {
    if (!value) {
      await db.delete(instanceSettings).where(eq(instanceSettings.key, key));
      continue;
    }
    const stored = SECRET.has(key) ? await encryptToken(secret, value, PURPOSE) : value;
    await db
      .insert(instanceSettings)
      .values({ key, value: stored, updatedAt: now })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value: stored, updatedAt: now } });
  }
}

/**
 * An instance admin exists. Only entering the setup token while signed in makes an account
 * admin (`claimInstance` in `services/accounts`) – signing in alone never does, so accounts may
 * exist on an unclaimed instance. The admin flag counts however the admin signs in (passkeys
 * only, every provider unlinked): no fresh setup token, no second claim.
 */
export async function instanceClaimed(db: Executor): Promise<boolean> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isInstanceAdmin, true))
    .limit(1);
  return admin !== undefined;
}

// ── Setup token ─────────────────────────────────────────────────────────────────────────────

const TOKEN_FILE = 'setup-token';

/**
 * The one-time token that opens the setup page and makes a signed-in account instance admin,
 * until an instance admin exists. Kept in the data volume so it survives the restart after saving;
 * removed when it is used to claim the instance. A new one is made on the next start while the
 * instance is still unclaimed.
 */
export function ensureSetupToken(dataDir: string): string {
  const existing = readSetupToken(dataDir);
  if (existing) return existing;
  mkdirSync(dataDir, { recursive: true });
  const token = randomBytes(24).toString('base64url');
  writeFileSync(path.join(dataDir, TOKEN_FILE), `${token}\n`, { mode: 0o600 });
  return token;
}

export function readSetupToken(dataDir: string): string | null {
  try {
    return readFileSync(path.join(dataDir, TOKEN_FILE), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function removeSetupToken(dataDir: string): void {
  rmSync(path.join(dataDir, TOKEN_FILE), { force: true });
}

/** Constant-time, also in the length: both sides are hashed before they are compared. */
function digestsMatch(expected: string, given: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

export function setupTokenMatches(dataDir: string, given: string | undefined): boolean {
  const expected = readSetupToken(dataDir);
  if (!expected || !given) return false;
  return digestsMatch(expected, given);
}

/**
 * While no instance admin exists, the log says where to go and shows the setup token – on every
 * start, also when the logins come from the environment only and the setup page was never used.
 * The token stands on its own line, never in a URL (proxy logs, browser history, referrers).
 * With dev login (development only) one info line: the dev owner acts without signing in.
 */
export async function announceSetup(config: Config, db: Executor, log: Logger): Promise<void> {
  if (await instanceClaimed(db)) {
    removeSetupToken(config.dataDir);
    if (!hasLogin(config) && !config.auth.devLogin) {
      log.warn('No login is configured. The instance admin can set one up at /einrichtung.');
    }
    return;
  }
  if (config.env === 'test') return;
  const token = ensureSetupToken(config.dataDir);
  const url = `${config.webOrigin}/einrichtung`;
  if (config.auth.devLogin) {
    log.info(`Setup page: ${url} · ${SETUP_TOKEN_LINE}${token}`);
    return;
  }
  const steps = hasLogin(config)
    ? [
        ' Slider has no instance admin yet. Sign in at',
        '',
        `   ${config.webOrigin}`,
        '',
        ' – Slider asks every account for the setup token below until someone',
        ' enters it. Whoever does becomes the admin of this instance.',
      ]
    : [
        ' Slider is not set up yet. Open',
        '',
        `   ${url}`,
        '',
        ' and enter the setup token there to configure the login. Then sign in',
        ' and enter it once more to become the admin of this instance.',
      ];
  log.warn(
    [
      '',
      '────────────────────────────────────────────────────────────────────',
      ...steps,
      '',
      `   ${SETUP_TOKEN_LINE}${token}`,
      '',
      ' (Shown until an instance admin exists. Keep it private.)',
      '────────────────────────────────────────────────────────────────────',
    ].join('\n'),
  );
}

/** Precedes the token in the log – scripts (`scripts/smoke-image.sh`) look for it. */
export const SETUP_TOKEN_LINE = 'Setup token: ';

/**
 * `BOOTSTRAP_EMAIL` named who could become admin by signing in. It is gone: only the setup token
 * makes an account admin. An instance that still sets it (environment, or saved by an older setup
 * page) gets one info line saying so.
 */
async function noticeBootstrapEmail(
  env: NodeJS.ProcessEnv,
  db: Executor,
  config: Config,
  log: Logger,
): Promise<void> {
  const fromEnv = stripEmpty(env)['BOOTSTRAP_EMAIL'] !== undefined;
  const stored = await db
    .select({ key: instanceSettings.key })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, LEGACY_BOOTSTRAP_EMAIL));
  if (!fromEnv && stored.length === 0) return;
  log.info(
    `BOOTSTRAP_EMAIL is ignored: signing in no longer makes anyone instance admin. To claim this instance, sign in, open ${config.webOrigin}/einrichtung and enter the setup token from this log.`,
  );
}

const LEGACY_BOOTSTRAP_EMAIL = 'BOOTSTRAP_EMAIL';

/**
 * The environment plus the settings saved on the setup page. Broken stored settings are skipped
 * (the environment alone then has to be complete).
 */
export async function loadInstanceConfig(
  env: NodeJS.ProcessEnv,
  boot: BootConfig,
  db: Executor,
  log: Logger,
): Promise<Config> {
  const config = await mergeStoredSettings(env, boot, db, log);
  await noticeBootstrapEmail(env, db, config, log);
  return config;
}

async function mergeStoredSettings(
  env: NodeJS.ProcessEnv,
  boot: BootConfig,
  db: Executor,
  log: Logger,
): Promise<Config> {
  const stored = await readStoredSettings(db, boot.secret, log);
  if (Object.keys(stored).length === 0) return loadConfig(env);
  try {
    const config = loadConfig(withStoredSettings(env, stored));
    log.info(`Settings from the setup page: ${Object.keys(stored).join(', ')}`);
    return config;
  } catch (error) {
    log.error('The settings saved on the setup page are invalid – starting without them', error);
    return loadConfig(env);
  }
}
