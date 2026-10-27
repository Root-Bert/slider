import { serve } from '@hono/node-server';
import { openPptx } from '@slider/pptx';
import { createApp } from './app';
import { StripeBilling } from './billing/stripe-billing';
import { MicrosoftTokens } from './auth/microsoft';
import { GoogleTokens } from './auth/google';
import { NextcloudAccounts } from './auth/nextcloud';
import { OidcClient } from './auth/oidc';
import { systemClock } from './clock';
import { dataPaths, loadBootConfig } from './config';
import { openDatabase } from './db/client';
import { releaseRunningImportAttempts } from './import/attempts';
import { findInterruptedImports, importDeck } from './import/import-deck';
import { createOfficePdf } from './import/office-pages';
import { createOfficePool } from './import/office-pool';
import { configurePdfJobs, stopPdfJobs, warmPdfWorker } from './import/pdf-jobs';
import { createSlidesExtras } from './import/slides-extras';
import {
  createLibreOfficeDocumentPdf,
  createLibreOfficePdf,
  findSoffice,
  stopRunningConversions,
} from './import/libreoffice';
import { importJobKey, importJobPriority, InProcessQueue, type ImportJob } from './import/queue';
import { RenderProgress } from './import/render-progress';
import { scheduleFileAuthorBackfill } from './import/file-author-backfill';
import { scheduleRerenderBackfill } from './import/rerender';
import { consoleLogger as log } from './logger';
import { LiveHub } from './realtime/live-hub';
import { createMailer } from './mail/mailer';
import { announceSetup, loadInstanceConfig } from './services/instance-settings';
import {
  backfillContentEncryption,
  encryptedStores,
  setUpDataKey,
} from './services/content-encryption';
import { upsertUser } from './services/users';
import { backfillDeckFilesBytes } from './services/workspace-storage';
import { ensurePersonalWorkspace } from './services/workspaces';
import { createSourceAdapters } from './sources/source-adapter';
import { FsBlobStorage } from './storage/fs-blob-storage';
import type { AppDeps } from './deps';
import { deckFontAdopter } from './services/deck-fonts';
import { RetentionSweeper } from './services/retention';
import { SyncScheduler } from './sync/scheduler';
import { SyncService } from './sync/sync-service';

/** Exit code that asks `supervisor.ts` to start the server again (settings were saved); same there. */
const RESTART_EXIT_CODE = 75;

async function main(): Promise<void> {
  const env = process.env;
  // Data folder, database and secret come from the environment only; then the settings saved on
  // the setup page fill in what the environment leaves open, and the whole is validated.
  const boot = loadBootConfig(env);
  const { dbDir, blobsDir } = dataPaths(boot);
  const clock = systemClock;
  // Self-hosting: a Postgres server when DATABASE_URL is set, else PGlite in the data folder.
  const database = await openDatabase(boot.hosting?.databaseUrl ?? dbDir);
  const { db } = database;
  // Content is encrypted at rest (BER-149); a key other than the data's stops the start here.
  const dataKey = await setUpDataKey(env, boot.dataDir, boot.env === 'production', db, log);
  const config = await loadInstanceConfig(env, boot, db, log);
  const { storage, media } = encryptedStores(dataKey, {
    storage: new FsBlobStorage(blobsDir),
    // Recordings (BER-116) in their own folder – `MEDIA_DIR` may point at any linked folder.
    media: new FsBlobStorage(config.media.dir),
  });

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
    log.info('No SMTP configured – invitation mails are logged here instead of sent.');
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

  const nextcloud = new NextcloudAccounts({
    db,
    secret: config.secret,
    clock,
    config: config.nextcloud,
    log,
    maxBytes: config.maxUploadBytes,
    webOrigin: config.webOrigin,
  });
  const googleDrive = new GoogleTokens({
    config: config.googleDrive,
    secret: config.secret,
    db,
    clock,
    log,
  });
  const sources = createSourceAdapters({
    config,
    tokens: microsoft,
    log,
    nextcloud,
    google: googleDrive,
  });
  // Slide images as PowerPoint draws them (BER-94): Office for linked decks, Google's PDF for
  // Google Slides (public ones too), LibreOffice for uploads and as fallback; without either,
  // the in-house SVG preview.
  const officePdf = createOfficePdf(sources, log, microsoft, {
    microsoft: Boolean(config.microsoft),
  });
  // Google Slides' own slide ids and comments, which its PowerPoint export leaves out (BER-157).
  const slidesExtras = createSlidesExtras(sources, log);
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
  // Edited slides are drawn by LibreOffices kept running – about 0.1 s a slide instead of 2.
  const officePool =
    soffice && (config.libreOfficeWorkers ?? 0) > 0
      ? await createOfficePool({ binary: soffice, size: config.libreOfficeWorkers!, log })
      : null;
  const libreOfficePdf = soffice
    ? createLibreOfficePdf({
        binary: soffice,
        log,
        timeoutMs: config.libreOfficeTimeoutMs,
        pool: officePool,
      })
    : null;
  // Word, Excel and text files picked in a cloud become PDF decks through it, too.
  const documentPdf = soffice
    ? createLibreOfficeDocumentPdf({ binary: soffice, log, timeoutMs: config.libreOfficeTimeoutMs })
    : null;
  // PDFs are read in worker threads, cut off after this long (plus a second per page).
  configurePdfJobs({ timeoutMs: config.pdfTimeoutMs });
  // … one of them started ahead, so the first edit finds pdf.js loaded.
  if (officePool) warmPdfWorker();
  const renderProgress = new RenderProgress();
  const queue: InProcessQueue<ImportJob> = new InProcessQueue<ImportJob>(
    (job) =>
      importDeck(
        {
          db,
          storage,
          openPptx,
          clock,
          log,
          officePdf,
          libreOfficePdf,
          slidesExtras,
          renderProgress,
          syncPollMs: config.sync.pollIntervalMs,
          // Fonts an ODP brings along become its workspace's, before it is drawn.
          adoptFonts: deckFontAdopter({
            db,
            storage,
            log,
            config,
            clock,
            queue,
            rendering: { renderers: { officePdf, libreOfficePdf }, progress: renderProgress },
          }),
        },
        job,
      ),
    log,
    { priority: importJobPriority, key: importJobKey, concurrency: config.importWorkers },
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

  scheduleFileAuthorBackfill({ db, storage, openPptx, log });
  // Decks from before storage counted per workspace (BER-151) get measured once.
  backfillDeckFilesBytes({ db, storage, log }).catch((error: unknown) =>
    log.error('Measuring the storage of older decks failed', error),
  );
  // What was stored before encryption at rest gets sealed once, in the background.
  backfillContentEncryption({ db, stores: [storage, media], log }).catch((error: unknown) =>
    log.error('Encrypting content stored before encryption at rest failed', error),
  );

  const sync = new SyncService({
    db,
    storage,
    sources,
    queue,
    clock,
    log,
    config,
    connections: microsoft,
    documentPdf,
  });
  const live = new LiveHub();
  const deps: AppDeps = {
    config,
    db,
    storage,
    media,
    queue,
    sources,
    microsoft,
    nextcloud,
    googleDrive,
    clock,
    log,
    sync,
    rendering: { renderers: { officePdf, libreOfficePdf }, progress: renderProgress },
    documentPdf,
    oidc,
    google,
    billing: config.billing ? new StripeBilling(config.billing) : null,
    mailer,
    live,
    ownerId: owner?.id ?? null,
    instance: {
      env,
      restart:
        env['SLIDER_SUPERVISED'] === '1' ? () => shutdown('Restart', RESTART_EXIT_CODE) : null,
    },
  };
  const app = createApp(deps);
  await announceSetup(config, db, log);
  const scheduler = new SyncScheduler({ db, clock, log, sync, config });
  if (config.sync.pollIntervalMs > 0) scheduler.start();
  else log.info('Automatic updates of linked decks are off (SYNC_POLL_INTERVAL_MS=0).');
  // Deletion deadlines (BER-143, BER-147): unused accounts and decks, old invites, sessions.
  const sweeper = new RetentionSweeper(deps);
  sweeper.start();
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    log.info(
      `Slider API listening on http://localhost:${info.port} (data: ${config.dataDir}, media: ${config.media.dir})`,
    );
  });

  let shuttingDown = false;
  function shutdown(signal: string, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down…`);
    scheduler.stop();
    sweeper.stop();
    // LibreOffice runs in its own process group and would outlive this process.
    stopRunningConversions();
    officePool?.close();
    // PDF workers too: their imports resume on the next start, like those of LibreOffice.
    stopPdfJobs();
    // A running import is cut off, not crashed: its run must not count towards giving up.
    const imports = releaseRunningImportAttempts(db).catch((error: unknown) =>
      log.error('Could not release the running imports', error),
    );
    // Open viewers hold a live stream each, which would keep `close` from ever finishing; the
    // browsers reconnect once the server is back.
    live.closeAll();
    let exiting = false;
    const exit = async () => {
      if (exiting) return;
      exiting = true;
      // Interrupted imports are picked up again on the next start. PGlite must be closed cleanly
      // or it runs crash recovery on the next start – but never wait for it forever.
      await Promise.race([
        imports
          .then(() => database.close())
          .catch((error: unknown) => log.error('Closing the database failed', error)),
        new Promise((resolve) => setTimeout(resolve, 3_000).unref()),
      ]);
      process.exit(exitCode);
    };
    server.close(() => void exit());
    // Idle keep-alive connections would hold `close` back; running requests may finish.
    if ('closeIdleConnections' in server) server.closeIdleConnections();
    // Connections that became idle since (the closed streams), then whatever still hangs.
    setTimeout(() => {
      if ('closeIdleConnections' in server) server.closeIdleConnections();
    }, 200).unref();
    setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
      void exit();
    }, 5_000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  log.error('Failed to start the Slider API', error);
  process.exit(1);
});
