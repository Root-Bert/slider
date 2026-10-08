import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));
const WORKSPACES_TAG = '0004_workspaces';
const PLANS_TAG = '0005_plans';
const PASSKEYS_TAG = '0006_passkeys';

let client: PGlite | null = null;
let tmp: string | null = null;
afterEach(async () => {
  await client?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
  client = null;
  tmp = null;
});

/** The migrations folder as it was before `tag` (journal cut before that migration). */
async function migrationsBefore(tag: string): Promise<string> {
  tmp = await mkdtemp(path.join(tmpdir(), 'slider-migrations-'));
  await cp(MIGRATIONS_DIR, tmp, { recursive: true });
  const journalPath = path.join(tmp, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === tag);
  expect(cut).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, cut);
  await writeFile(journalPath, JSON.stringify(journal));
  return tmp;
}

describe('migration 0004_workspaces', () => {
  it('gives every deck owner a workspace and moves their decks into it', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: await migrationsBefore(WORKSPACES_TAG) });

    await client.exec(`
      INSERT INTO users (id, name, email, color, created_at) VALUES
        ('u-robert', 'Robert', 'robert@q4-team.de', 'red', '2026-01-01'),
        ('u-lena', 'Lena', 'lena@q4-team.de', 'blue', '2026-01-02'),
        ('u-guest', 'Max', 'max@q4-team.de', 'violet', '2026-01-03');
      INSERT INTO decks (id, owner_id, title, file_name, source, import_state) VALUES
        ('d1', 'u-robert', 'Q4', 'q4.pptx', 'upload', '{"status":"ready"}'),
        ('d2', 'u-robert', 'Q3', 'q3.pptx', 'upload', '{"status":"ready"}'),
        ('d3', 'u-lena', 'Pitch', 'pitch.pptx', 'upload', '{"status":"ready"}');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const { rows: workspaces } = await client.query<{
      id: string;
      slug: string;
      created_by: string;
      name: string;
    }>('SELECT id, slug, created_by, name FROM workspaces ORDER BY slug');
    expect(workspaces.map((w) => [w.name, w.slug, w.created_by])).toEqual([
      ['Mein Workspace', 'mein-workspace', 'u-robert'],
      ['Mein Workspace', 'mein-workspace-2', 'u-lena'],
    ]);
    const { rows: members } = await client.query<{ user_id: string; role: string }>(
      'SELECT user_id, role FROM workspace_members ORDER BY user_id',
    );
    expect(members).toEqual([
      { user_id: 'u-lena', role: 'owner' },
      { user_id: 'u-robert', role: 'owner' },
    ]);
    const byCreator = new Map(workspaces.map((w) => [w.created_by, w.id]));
    const { rows: decks } = await client.query<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM decks ORDER BY id',
    );
    expect(decks).toEqual([
      { id: 'd1', workspace_id: byCreator.get('u-robert') },
      { id: 'd2', workspace_id: byCreator.get('u-robert') },
      { id: 'd3', workspace_id: byCreator.get('u-lena') },
    ]);
    // The column is NOT NULL from now on.
    await expect(
      client.exec(
        `INSERT INTO decks (id, owner_id, title, file_name, source, import_state) VALUES ('d4', 'u-lena', 'x', 'x.pptx', 'upload', '{}')`,
      ),
    ).rejects.toThrow(/workspace_id/);
    const { rows: admins } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE is_instance_admin',
    );
    expect(admins[0]?.n).toBe(0);
  });
});

describe('migration 0005_plans', () => {
  it('puts existing organisations on the free plan and keeps everything else', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: await migrationsBefore(PLANS_TAG) });
    await client.exec(`
      INSERT INTO users (id, name, email, color) VALUES ('u-robert', 'Robert', 'robert@q4-team.de', 'red');
      INSERT INTO workspaces (id, name, slug, created_by) VALUES ('w1', 'Mein Workspace', 'mein-workspace', 'u-robert');
      INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('w1', 'u-robert', 'owner');
      INSERT INTO decks (id, owner_id, workspace_id, title, file_name, source, import_state) VALUES
        ('d1', 'u-robert', 'w1', 'Q4', 'q4.pptx', 'upload', '{"status":"ready"}'),
        ('d2', 'u-robert', 'w1', 'Q3', 'q3.pptx', 'upload', '{"status":"ready"}'),
        ('d3', 'u-robert', 'w1', 'Q2', 'q2.pptx', 'upload', '{"status":"ready"}'),
        ('d4', 'u-robert', 'w1', 'Q1', 'q1.pptx', 'upload', '{"status":"ready"}');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const { rows } = await client.query<{ id: string; name: string; plan: string }>(
      'SELECT id, name, plan FROM workspaces',
    );
    expect(rows).toEqual([{ id: 'w1', name: 'Mein Workspace', plan: 'free' }]);
    // Decks above the limit stay.
    const { rows: deckRows } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM decks',
    );
    expect(deckRows[0]?.n).toBe(4);
    await client.exec(`INSERT INTO workspaces (id, name, slug) VALUES ('w2', 'Neu', 'neu')`);
    const { rows: fresh } = await client.query<{ plan: string }>(
      `SELECT plan FROM workspaces WHERE id = 'w2'`,
    );
    expect(fresh[0]?.plan).toBe('free');
  });
});

describe('migration 0006_passkeys', () => {
  it('only adds: open login links keep working, without a code', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: await migrationsBefore(PASSKEYS_TAG) });
    await client.exec(`
      INSERT INTO users (id, name, email, color) VALUES ('u-robert', 'Robert', 'robert@q4-team.de', 'red');
      INSERT INTO user_identities (provider, subject, user_id, email) VALUES ('email', 'robert@q4-team.de', 'u-robert', 'robert@q4-team.de');
      INSERT INTO login_tokens (id, email, token_hash, return_to, expires_at) VALUES ('t1', 'robert@q4-team.de', 'hash', '/', now() + interval '10 minutes');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const { rows } = await client.query<{ code_hash: string | null; code_attempts: number }>(
      `SELECT code_hash, code_attempts FROM login_tokens WHERE id = 't1'`,
    );
    expect(rows).toEqual([{ code_hash: null, code_attempts: 0 }]);
    await client.exec(`
      INSERT INTO passkeys (id, user_id, credential_id, public_key, device_type, name)
        VALUES ('p1', 'u-robert', 'cred', 'key', 'singleDevice', 'Passkey');
      DELETE FROM users WHERE id = 'u-robert';
    `);
    const { rows: left } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM passkeys',
    );
    expect(left[0]?.n).toBe(0);
  });
});
