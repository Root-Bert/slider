import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { count, eq } from 'drizzle-orm';
import { SECRET_SETUP_KEYS, SETUP_KEYS, type SetupKey } from '@slider/shared';
import { decryptToken, encryptToken } from '../auth/token-crypto';
import type { Executor } from '../db/client';
import { instanceSettings, userIdentities } from '../db/schema';
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

/** Someone has signed in: the first account (instance admin) exists. */
export async function instanceClaimed(db: Executor): Promise<boolean> {
  const [row] = await db.select({ count: count() }).from(userIdentities);
  return (row?.count ?? 0) > 0;
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
