import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import { SECRET_SETUP_KEYS, SETUP_KEYS, type SetupKey } from '@slider/shared';
import { decryptToken, encryptToken } from '../auth/token-crypto';
import type { Executor } from '../db/client';
import { instanceSettings, userIdentities, users } from '../db/schema';
import { hasLogin, loadConfig, withStoredSettings, type BootConfig, type Config } from '../config';
import type { Logger } from '../logger';

/**
 * Settings from the setup page (`/einrichtung`): stored under their env names and merged below the
 * environment on start (`withStoredSettings` in `config`). Changing them restarts the server.
 */

const PURPOSE = 'instance-settings';
const KNOWN = new Set<string>(SETUP_KEYS);
const SECRET = new Set<string>(SECRET_SETUP_KEYS);

export const isSecretSetting = (key: SetupKey) => SECRET.has(key);

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
 * Someone has signed in: the first account (instance admin) exists. The admin flag counts on its
 * own, so an admin who later signs in with passkeys only (every provider unlinked) keeps the
 * instance claimed – no fresh setup token, no second bootstrap.
 */
export async function instanceClaimed(db: Executor): Promise<boolean> {
  const [identity] = await db.select({ count: count() }).from(userIdentities);
  if ((identity?.count ?? 0) > 0) return true;
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
 * The one-time token that opens the setup page before the first account exists. Kept in the data
 * volume so it survives the restart after saving; removed once the instance is claimed.
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

export function setupTokenMatches(dataDir: string, given: string | undefined): boolean {
  const expected = readSetupToken(dataDir);
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Until the first account exists, the log shows the one-time link to the setup page – the only
 * way in when no login is configured yet. Also with dev login (development only): the setup page
 * points there, so the link must exist.
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
  const url = `${config.webOrigin}/einrichtung#token=${token}`;
  if (config.auth.devLogin) {
    // Development acts as the dev owner anyway; the link is only for trying the setup page.
    log.info(`Setup page (until the first account exists): ${url}`);
    return;
  }
  log.warn(
    [
      '',
      '────────────────────────────────────────────────────────────────────',
      ' Slider is not set up yet. Open this link to configure the login',
      ' and become the admin of this instance:',
      '',
      `   ${url}`,
      '',
      ' (Shown until the first account exists. Keep it private.)',
      '────────────────────────────────────────────────────────────────────',
    ].join('\n'),
  );
}

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
