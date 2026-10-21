import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../src/db/client';
import { users } from '../src/db/schema';
import { upsertUser } from '../src/services/users';

/**
 * Runs against a real Postgres server (production setup, `DATABASE_URL`) only when
 * `TEST_DATABASE_URL` points at a throwaway database, e.g.
 * `TEST_DATABASE_URL=postgres://localhost:55432/slider_test bun run test`. Skipped otherwise;
 * everything else runs on in-memory PGlite.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Postgres server (TEST_DATABASE_URL)', () => {
  let handle: DatabaseHandle;
  beforeAll(async () => {
    // Twice: migrations must be idempotent across restarts.
    await (await openDatabase(url)).close();
    handle = await openDatabase(url);
  });
  afterAll(() => handle?.close());

  it('migrates and answers queries', async () => {
    const result = await handle.db.execute(sql`select 1 as one`);
    expect(result).toBeTruthy();
  });

  it('runs the same queries as PGlite: upsert, count, transactions', async () => {
    const email = `pg-test-${crypto.randomUUID()}@example.com`;
    const user = await upsertUser(handle.db, { name: 'Test', email });
    const again = await upsertUser(handle.db, { name: 'Renamed', email, color: 'blue' });
    expect(again.id).toBe(user.id);
    expect(again.name).toBe('Renamed');
    expect(again.createdAt).toBeInstanceOf(Date);

    const [row] = await handle.db.select({ n: count() }).from(users).where(eq(users.email, email));
    expect(row?.n).toBe(1);

    await expect(
      handle.db.transaction(async (tx) => {
        await tx.update(users).set({ name: 'Rolled back' }).where(eq(users.id, user.id));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const [after] = await handle.db.select().from(users).where(eq(users.id, user.id));
    expect(after?.name).toBe('Renamed');

    await handle.db.delete(users).where(eq(users.id, user.id));
  });
});
