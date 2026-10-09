import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Driver-agnostic: PGlite (real Postgres compiled to WASM) for `bun run dev` and tests, a
 * Postgres server via `DATABASE_URL` in production. Same Drizzle schema, same migrations.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything queries can run on: the database or an open transaction. */
export type Executor = Database | Transaction;

/**
 * Serialises everyone who takes the same `key` until the transaction ends (Postgres advisory
 * lock; works on PGlite too). For check-then-write races that have no single row to lock.
 */
export async function advisoryXactLock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface DatabaseHandle {
  db: Database;
  close(): Promise<void>;
}

export const isPostgresUrl = (value: string) => /^postgres(ql)?:\/\//i.test(value);

/**
 * Opens and migrates the database:
 * - a `postgres://…` URL → that Postgres server,
 * - a directory → a file-backed PGlite there,
 * - nothing → an in-memory PGlite (tests).
 */
export async function openDatabase(location?: string): Promise<DatabaseHandle> {
  if (location && isPostgresUrl(location)) return openPostgres(location);
  if (location) await mkdir(location, { recursive: true });
  const client = location ? new PGlite(location) : new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => client.close() };
}

async function openPostgres(url: string): Promise<DatabaseHandle> {
  // Migrations get their own single connection, so their notices don't flood the pool.
  const migrationClient = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migratePostgres(drizzlePostgres({ client: migrationClient }), {
      migrationsFolder: MIGRATIONS_DIR,
    });
  } finally {
    await migrationClient.end();
  }
  const client = postgres(url, { max: 10 });
  const db = drizzlePostgres({ client, schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
