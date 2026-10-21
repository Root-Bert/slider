import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { migratedSnapshot, migratePostgresAt } from '../src/db/client';

declare module 'vitest' {
  export interface ProvidedContext {
    /** A migrated, empty PGlite as a file (`dumpDataDir`) – see `openTestDatabase`. */
    databaseSnapshot: string;
    /** With `TEST_DATABASE_URL`: a migrated database on that server to copy per test. */
    databaseTemplate: string | null;
  }
}

/**
 * Runs the migrations once per test run instead of once per test file: every test database
 * starts from this snapshot (PGlite) or is copied from this template (Postgres).
 */
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slider-api-db-'));
  const snapshotFile = path.join(dir, 'migrated.tar');
  const snapshot = await migratedSnapshot();
  await writeFile(snapshotFile, new Uint8Array(await snapshot.arrayBuffer()));
  project.provide('databaseSnapshot', snapshotFile);

  const serverUrl = process.env.TEST_DATABASE_URL;
  const admin = async (statement: string) => {
    const client = postgres(serverUrl!, { max: 1, onnotice: () => {} });
    try {
      await client.unsafe(statement);
    } finally {
      await client.end();
    }
  };
  let template: string | null = null;
  if (serverUrl) {
    template = `slider_template_${crypto.randomUUID().replaceAll('-', '')}`;
    await admin(`create database ${template}`);
    const url = new URL(serverUrl);
    url.pathname = `/${template}`;
    await migratePostgresAt(url.toString());
  }
  project.provide('databaseTemplate', template);

  return async () => {
    await rm(dir, { recursive: true, force: true });
    if (template) await admin(`drop database if exists ${template} with (force)`);
  };
}
