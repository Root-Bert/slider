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
import { createLibreOfficePdf, findSoffice } from './import/libreoffice';
import { InProcessQueue, type ImportJob } from './import/queue';
import { RenderProgress } from './import/render-progress';
import { scheduleRerenderBackfill } from './import/rerender';
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
  const google = config.auth.google ? new OidcClient(config.auth.google, clock) : null;
  const mailer = createMailer(config.smtp, log, config.env);
  if (!config.smtp && config.env === 'development') {
    log.info('No SMTP configured – login mails are logged here and listed at /api/dev/mails.');
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

  const sources = createSourceAdapters({ config, tokens: microsoft });
  // Slide images as PowerPoint draws them (BER-94): Office for linked decks, LibreOffice for
  // uploads and as fallback; without either, the in-house SVG preview.
  const officePdf = config.microsoft ? createOfficePdf(sources, log) : undefined;
  const soffice = await findSoffice({ configured: config.libreOfficePath });
  if (soffice) log.info(`Slide images of uploads are rendered by LibreOffice (${soffice}).`);
  else if (config.libreOfficePath) {
    log.warn(
      `LIBREOFFICE_PATH=${config.libreOfficePath} is not executable – uploads get SVG previews.`,
    );
  } else {
    log.info(
      'LibreOffice is not installed – uploaded decks get the built-in SVG preview (see docs/self-hosting.md).',
    );
  }
  const libreOfficePdf = soffice ? createLibreOfficePdf({ binary: soffice, log }) : null;
  const renderProgress = new RenderProgress();
  const queue = new InProcessQueue<ImportJob>(
    (job) =>
      importDeck(
        { db, storage, openPptx, clock, log, officePdf, libreOfficePdf, renderProgress },
        job,
      ),
    log,
  );
  for (const job of await findInterruptedImports(db)) {
    log.info(`Resuming interrupted ${job.kind ?? 'initial'} import of deck ${job.deckId}`);
    queue.enqueue(job);
  }
  // Decks imported before a better renderer was available: once per revision, in the background.
  scheduleRerenderBackfill({
    db,
    queue,
    renderers: { officePdf, libreOfficePdf },
    progress: renderProgress,
    log,
  });

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
    rendering: { renderers: { officePdf, libreOfficePdf }, progress: renderProgress },
    oidc,
    google,
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
