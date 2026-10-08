import { serve } from '@hono/node-server';
import { openPptx } from '@slider/pptx';
import { createApp } from './app';
import { MicrosoftTokens } from './auth/microsoft';
import { OidcClient } from './auth/oidc';
import { systemClock } from './clock';
import { dataPaths, loadConfig } from './config';
import { openDatabase } from './db/client';
import { findInterruptedImports, importDeck } from './import/import-deck';
import { createOfficePdf } from './import/office-pages';
import { InProcessQueue, type ImportJob } from './import/queue';
import { consoleLogger as log } from './logger';
import { createMailer } from './mail/mailer';
import { upsertUser } from './services/users';
import { ensurePersonalWorkspace } from './services/workspaces';
import { createSourceAdapters } from './sources/source-adapter';
import { FsBlobStorage } from './storage/fs-blob-storage';
import { SyncScheduler } from './sync/scheduler';
import { SyncService } from './sync/sync-service';

async function main(): Promise<void> {
  const config = loadConfig();
  const { dbDir, blobsDir } = dataPaths(config);
  const clock = systemClock;
  // Self-hosting: a Postgres server when DATABASE_URL is set, else PGlite in the data folder.
  const database = await openDatabase(config.hosting?.databaseUrl ?? dbDir);
  const { db } = database;
  const storage = new FsBlobStorage(blobsDir);
  // Recordings (BER-116) in their own folder – `MEDIA_DIR` may point at any linked folder.
  const media = new FsBlobStorage(config.media.dir);

  // Without a login (dev only), every request acts as the dev owner; see `auth/viewer`.
  const owner = config.auth.devLogin ? await upsertUser(db, config.devOwner) : null;
  if (owner) {
    await ensurePersonalWorkspace(db, owner.id, clock.now());
    log.info(`No login configured – every visitor acts as ${owner.email} (AUTH_DEV_LOGIN).`);
  }
  const oidc = config.auth.oidc ? new OidcClient(config.auth.oidc, clock) : null;
  const mailer = createMailer(config.smtp, log);

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

  const sources = createSourceAdapters({ config, tokens: microsoft });
  const officePdf = createOfficePdf(sources, log);
  const queue = new InProcessQueue<ImportJob>(
    (job) => importDeck({ db, storage, openPptx, clock, log, officePdf }, job),
    log,
  );
  for (const job of await findInterruptedImports(db)) {
    log.info(`Resuming interrupted ${job.kind ?? 'initial'} import of deck ${job.deckId}`);
    queue.enqueue(job);
  }

  const sync = new SyncService({ db, storage, sources, queue, clock, log, config });
  const app = createApp({
    config,
    db,
    storage,
    media,
    queue,
    sources,
    microsoft,
    clock,
    log,
    sync,
    oidc,
    mailer,
    ownerId: owner?.id ?? null,
  });
  const scheduler = new SyncScheduler({ db, clock, log, sync, config });
  if (config.sync.pollIntervalMs > 0) scheduler.start();
  else log.info('Automatic updates of linked decks are off (SYNC_POLL_INTERVAL_MS=0).');
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    log.info(
      `Slider API listening on http://localhost:${info.port} (data: ${config.dataDir}, media: ${config.media.dir})`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down…`);
    scheduler.stop();
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
