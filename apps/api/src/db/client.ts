import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

/**
 * PGlite is real Postgres compiled to WASM: zero setup for `npm run dev`, and the same
 * Drizzle pg schema and migrations move to a Postgres server later.
 */
export type Database = PgliteDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything queries can run on: the database or an open transaction. */
export type Executor = Database | Transaction;

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface DatabaseHandle {
  db: Database;
  close(): Promise<void>;
}

/** Opens (and migrates) a file-backed database, or an in-memory one when `dataDir` is omitted. */
export async function openDatabase(dataDir?: string): Promise<DatabaseHandle> {
  if (dataDir) await mkdir(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => client.close() };
}
