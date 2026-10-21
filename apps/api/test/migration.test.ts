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
const CLOSE_COLORS_TAG = '0024_merge_close_colors';

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
        ('u-robert', 'Robert', 'robert@example.org', 'red', '2026-01-01'),
        ('u-lena', 'Lena', 'lena@example.org', 'blue', '2026-01-02'),
        ('u-guest', 'Max', 'max@example.org', 'violet', '2026-01-03');
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
      // Founded as owners; 0019 made every owner an admin.
      { user_id: 'u-lena', role: 'admin' },
      { user_id: 'u-robert', role: 'admin' },
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
      INSERT INTO users (id, name, email, color) VALUES ('u-robert', 'Robert', 'robert@example.org', 'red');
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

describe('migrations 0006_passkeys … 0020_drop_email_login', () => {
  it('passkeys go with their account; e-mail logins and open login links are dropped', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: await migrationsBefore(PASSKEYS_TAG) });
    await client.exec(`
      INSERT INTO users (id, name, email, color) VALUES ('u-robert', 'Robert', 'robert@example.org', 'red');
      INSERT INTO user_identities (provider, subject, user_id, email) VALUES ('email', 'robert@example.org', 'u-robert', 'robert@example.org');
      INSERT INTO login_tokens (id, email, token_hash, return_to, expires_at) VALUES ('t1', 'robert@example.org', 'hash', '/', now() + interval '10 minutes');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const { rows: tables } = await client.query<{ name: string | null }>(
      `SELECT to_regclass('login_tokens')::text AS name`,
    );
    expect(tables).toEqual([{ name: null }]);
    const { rows: identities } = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_identities',
    );
    expect(identities[0]?.n).toBe(0);
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

describe('migration 0024_merge_close_colors', () => {
  it('folds pink into violet and lime into green for accounts, comment authors and strokes', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: await migrationsBefore(CLOSE_COLORS_TAG) });
    await client.exec(`
      INSERT INTO users (id, name, email, color) VALUES
        ('u-pink', 'Pia', 'pia@example.org', 'pink'),
        ('u-lime', 'Lio', 'lio@example.org', 'lime'),
        ('u-red', 'Rea', 'rea@example.org', 'red');
      INSERT INTO workspaces (id, name, slug, created_by) VALUES ('w1', 'Team', 'team', 'u-red');
      INSERT INTO decks (id, workspace_id, owner_id, title, file_name, source, import_state)
        VALUES ('d1', 'w1', 'u-red', 'Q4', 'q4.pptx', 'upload', '{"status":"ready"}');
      INSERT INTO comments (id, deck_id, author, body, anchor, strokes, source) VALUES
        ('c1', 'd1', '{"id":"u-pink","name":"Pia","type":"owner","color":"pink"}', 'a',
          '{"type":"point"}',
          '[{"tool":"pen","color":"pink","points":[]},{"tool":"pen","color":"red","points":[]},{"tool":"pen","color":"lime","points":[]}]',
          'slider'),
        ('c2', 'd1', '{"id":"u-red","name":"Rea","type":"owner","color":"red"}', 'b',
          '{"type":"point"}', '[]', 'slider');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const { rows: users } = await client.query<{ id: string; color: string }>(
      'SELECT id, color FROM users ORDER BY id',
    );
    expect(users).toEqual([
      { id: 'u-lime', color: 'green' },
      { id: 'u-pink', color: 'violet' },
      { id: 'u-red', color: 'red' },
    ]);
    const { rows: comments } = await client.query<{ color: string; strokes: string[] }>(
      `SELECT author->>'color' AS color,
         ARRAY(SELECT s->>'color' FROM jsonb_array_elements(strokes) s) AS strokes
       FROM comments ORDER BY id`,
    );
    expect(comments).toEqual([
      { color: 'violet', strokes: ['violet', 'red', 'green'] },
      { color: 'red', strokes: [] },
    ]);
  });
});

describe('migration 0027_slide_indexes', () => {
  it('indexes the slide_id foreign keys that slide deletes cascade through', async () => {
    client = new PGlite();
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_DIR });
    const { rows } = await client.query<{ tablename: string; indexdef: string }>(
      "SELECT tablename, indexdef FROM pg_indexes WHERE tablename IN ('comments', 'slide_versions')",
    );
    const leadingColumns = rows.map(
      (row) => `${row.tablename}.${/\((\w+)/.exec(row.indexdef)?.[1] ?? ''}`,
    );
    expect(leadingColumns).toEqual(
      expect.arrayContaining(['comments.slide_id', 'slide_versions.slide_id']),
    );
  });
});

describe('migration 0028_import_attempts_url_ref', () => {
  it('makes the pasted link the sync reference of plain-URL decks', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: await migrationsBefore('0028_import_attempts_url_ref') });
    await client.exec(`
      INSERT INTO users (id, name, email, color) VALUES ('u1', 'Rea', 'rea@example.org', 'red');
      INSERT INTO workspaces (id, name, slug, created_by) VALUES ('w1', 'Team', 'team', 'u1');
      INSERT INTO decks
        (id, workspace_id, owner_id, title, file_name, source, source_url, source_ref, import_state)
      VALUES
        ('d-url', 'w1', 'u1', 'A', 'a.pptx', 'url',
          'https://github.com/o/r/releases/download/v1/a.pptx',
          'https://release-assets.githubusercontent.com/a.pptx?sig=old', '{"status":"ready"}'),
        ('d-sp', 'w1', 'u1', 'B', 'b.pptx', 'sharepoint', 'https://contoso.sharepoint.com/b.pptx',
          'drives/b!x/items/1', '{"status":"ready"}');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const { rows } = await client.query<{ id: string; source_ref: string }>(
      'SELECT id, source_ref FROM decks ORDER BY id',
    );
    expect(rows).toEqual([
      { id: 'd-sp', source_ref: 'drives/b!x/items/1' },
      { id: 'd-url', source_ref: 'https://github.com/o/r/releases/download/v1/a.pptx' },
    ]);
  });
});

describe('migration 0032_microsoft_connections', () => {
  it('moves each account’s Microsoft connection into its own table and onto its Graph decks', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: await migrationsBefore('0032_microsoft_connections') });
    await client.exec(`
      INSERT INTO users (id, name, email, color, ms_refresh_token, ms_account, ms_subject) VALUES
        ('u-work', 'Rea', 'rea@example.org', 'red', 'v1.enc-work', 'rea@contoso.com', 'oid-rea'),
        ('u-msa', 'Max', 'max@example.org', 'blue', 'v1.enc-msa', 'max@outlook.com', 'abc123'),
        ('u-old', 'Ole', 'ole@example.org', 'green', 'v1.enc-old', 'ole@contoso.com', NULL),
        ('u-none', 'Nia', 'nia@example.org', 'violet', NULL, NULL, NULL);
      INSERT INTO user_identities (provider, subject, user_id, email) VALUES
        ('microsoft', 'tid-1:oid-other', 'u-work', 'rea@fabrikam.com'),
        ('microsoft', 'tid-1:oid-rea', 'u-work', 'rea@contoso.com'),
        ('microsoft', '9188040d:00000000-0000-0000-0000-0000abc123', 'u-msa', 'max@outlook.com');
      INSERT INTO workspaces (id, name, slug, created_by) VALUES ('w1', 'Team', 'team', 'u-work');
      INSERT INTO decks
        (id, workspace_id, owner_id, title, file_name, source, source_ref, import_state)
      VALUES
        ('d-graph', 'w1', 'u-work', 'A', 'a.pptx', 'sharepoint', 'drives/b!x/items/1', '{"status":"ready"}'),
        ('d-anon', 'w1', 'u-work', 'B', 'b.pptx', 'sharepoint', 'https://contoso.sharepoint.com/:p:/s/x', '{"status":"ready"}'),
        ('d-upload', 'w1', 'u-work', 'C', 'c.pptx', 'upload', NULL, '{"status":"ready"}'),
        ('d-none', 'w1', 'u-none', 'D', 'd.pptx', 'onedrive', 'drives/d/items/2', '{"status":"ready"}');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const { rows } = await client.query<Record<string, string | null>>(
      `SELECT user_id, subject, account, tenant_id, identity_subject, refresh_token
       FROM microsoft_connections ORDER BY user_id`,
    );
    expect(rows).toEqual([
      {
        user_id: 'u-msa',
        subject: 'abc123',
        account: 'max@outlook.com',
        // The only Microsoft login of the account.
        tenant_id: '9188040d',
        identity_subject: '9188040d:00000000-0000-0000-0000-0000abc123',
        refresh_token: 'v1.enc-msa',
      },
      {
        user_id: 'u-old',
        subject: 'legacy:u-old',
        account: 'ole@contoso.com',
        tenant_id: null,
        identity_subject: null,
        refresh_token: 'v1.enc-old',
      },
      {
        user_id: 'u-work',
        subject: 'oid-rea',
        account: 'rea@contoso.com',
        // Matched by object id among two Microsoft logins.
        tenant_id: 'tid-1',
        identity_subject: 'tid-1:oid-rea',
        refresh_token: 'v1.enc-work',
      },
    ]);

    const { rows: decks } = await client.query<{ id: string; linked: boolean }>(
      `SELECT d.id, c.user_id IS NOT NULL AS linked FROM decks d
       LEFT JOIN microsoft_connections c ON c.id = d.microsoft_connection_id ORDER BY d.id`,
    );
    expect(decks).toEqual([
      { id: 'd-anon', linked: false },
      { id: 'd-graph', linked: true },
      { id: 'd-none', linked: false },
      { id: 'd-upload', linked: false },
    ]);
    const { rows: columns } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name LIKE 'ms_%'`,
    );
    expect(columns).toEqual([]);
  });
});

describe('migration 0040_workspace_removals_email', () => {
  it('keeps existing removals by account; they outlive it from now on', async () => {
    client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, {
      migrationsFolder: await migrationsBefore('0040_workspace_removals_email'),
    });
    await client.exec(`
      INSERT INTO users (id, name, email, color) VALUES
        ('u-anna', 'Anna', 'anna@firma.de', 'red'), ('u-bert', 'Bert', 'bert@firma.de', 'blue');
      INSERT INTO workspaces (id, name, slug, created_by) VALUES ('w1', 'Firma', 'firma', 'u-anna');
      INSERT INTO workspace_removals (workspace_id, user_id) VALUES ('w1', 'u-bert');
    `);

    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const removals = () =>
      client!.query<{ user_id: string | null; email_hash: string | null }>(
        'SELECT user_id, email_hash FROM workspace_removals',
      );
    // No hash in SQL: the account deletion adds it (`deleteAccount`).
    expect((await removals()).rows).toEqual([{ user_id: 'u-bert', email_hash: null }]);
    await client.exec(`
      UPDATE workspace_removals SET email_hash = 'h' WHERE user_id = 'u-bert';
      DELETE FROM users WHERE id = 'u-bert';
    `);
    expect((await removals()).rows).toEqual([{ user_id: null, email_hash: 'h' }]);
    await client.exec(`DELETE FROM workspaces WHERE id = 'w1'`);
    expect((await removals()).rows).toEqual([]);
  });
});
