import { serve } from '@hono/node-server';
import { openPptx } from '@slider/pptx';
import { createApp } from './app';
import { MicrosoftTokens } from './auth/microsoft';
import { systemClock } from './clock';
import { dataPaths, loadConfig } from './config';
import { openDatabase } from './db/client';
import { hasDecks, seedDemoData } from './db/seed';
import { findInterruptedImports, importDeck } from './import/import-deck';
import { InProcessQueue, type ImportJob } from './import/queue';
import { consoleLogger as log } from './logger';
import { upsertUser } from './services/users';
import { createSourceAdapters } from './sources/source-adapter';
import { FsBlobStorage } from './storage/fs-blob-storage';

async function main(): Promise<void> {
  const config = loadConfig();
  const { dbDir, blobsDir } = dataPaths(config);
  const clock = systemClock;
  const database = await openDatabase(dbDir);
  const { db } = database;
  const storage = new FsBlobStorage(blobsDir);

  if (!(await hasDecks(db))) {
    await seedDemoData({ db, storage, clock, owner: config.devOwner });
    log.info('Empty database – seeded demo data.');
  }
  const owner = await upsertUser(db, config.devOwner);

  const queue = new InProcessQueue<ImportJob>(
    (job) => importDeck({ db, storage, openPptx, clock, log }, job),
    log,
  );
  for (const job of await findInterruptedImports(db)) {
    log.info(`Resuming interrupted import of deck ${job.deckId}`);
    queue.enqueue(job);
  }

  const microsoft = new MicrosoftTokens({
    config: config.microsoft,
    secret: config.secret,
    db,
    clock,
    log,
  });
  if (!config.microsoft) {
    log.info(
      'Microsoft login is not configured (MS_CLIENT_ID/MS_CLIENT_SECRET) – OneDrive/SharePoint links need it.',
    );
  }

  const app = createApp({
    config,
    db,
    storage,
    queue,
    sources: createSourceAdapters({ config, tokens: microsoft }),
    microsoft,
    clock,
    log,
    ownerId: owner.id,
  });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    log.info(`Slider API listening on http://localhost:${info.port} (data: ${config.dataDir})`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down…`);
    server.close(async () => {
      // Interrupted imports are picked up again on the next start.
      await database.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  log.error('Failed to start the Slider API', error);
  process.exit(1);
});
