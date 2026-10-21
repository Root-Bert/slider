/** What the command-line checks (`check:office`, `check:google-comments`) share. */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataPaths, loadConfig, withStoredSettings, type Config } from '../config';
import { openDatabase, type Database } from '../db/client';
import type { Logger } from '../logger';
import { readStoredSettings } from '../services/instance-settings';

export const quietLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** The environment plus the settings saved on the setup page, like `server.ts`. */
export async function fullConfig(boot: Config, db: Database): Promise<Config> {
  const stored = await readStoredSettings(db, boot.secret, quietLog);
  return Object.keys(stored).length === 0
    ? boot
    : loadConfig(withStoredSettings(process.env, stored), () => {});
}

/**
 * Postgres directly; PGlite as a copy, since only one process may open it – a running server is
 * not disturbed, and whatever the check writes (a renewed refresh token) only lands in the copy.
 */
export async function openToolDb(
  boot: Config,
): Promise<{ db: Database; cleanup: () => Promise<void> }> {
  if (boot.hosting?.databaseUrl) {
    const handle = await openDatabase(boot.hosting.databaseUrl);
    return { db: handle.db, cleanup: () => handle.close() };
  }
  const copy = await mkdtemp(join(tmpdir(), 'slider-check-'));
  await cp(dataPaths(boot).dbDir, copy, { recursive: true });
  const handle = await openDatabase(copy);
  return {
    db: handle.db,
    cleanup: async () => {
      await handle.close();
      await rm(copy, { recursive: true, force: true });
    },
  };
}
