import { serve } from '@hono/node-server';
import { openPptx } from '@slider/pptx';
import { createApp } from './app';
import { MicrosoftTokens } from './auth/microsoft';
import { OidcClient } from './auth/oidc';
import { systemClock } from './clock';
import { dataPaths, loadBootConfig } from './config';
import { openDatabase } from './db/client';
import { releaseRunningImportAttempts } from './import/attempts';
import { findInterruptedImports, importDeck } from './import/import-deck';
import { createOfficePdf } from './import/office-pages';
import { createLibreOfficePdf, findSoffice, stopRunningConversions } from './import/libreoffice';
import { importJobPriority, InProcessQueue, type ImportJob } from './import/queue';
import { RenderProgress } from './import/render-progress';
import { scheduleFileAuthorBackfill } from './import/file-author-backfill';
import { scheduleRerenderBackfill } from './import/rerender';
import { consoleLogger as log } from './logger';
import { LiveHub } from './realtime/live-hub';
import { createMailer } from './mail/mailer';
import { announceSetup, loadInstanceConfig } from './services/instance-settings';
import { upsertUser } from './services/users';
import { ensurePersonalWorkspace } from './services/workspaces';
import { createSourceAdapters } from './sources/source-adapter';
import { FsBlobStorage } from './storage/fs-blob-storage';
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
  const config = await loadInstanceConfig(env, boot, db, log);
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

  const sources = createSourceAdapters({ config, tokens: microsoft, log });
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
  const libreOfficePdf = soffice
    ? createLibreOfficePdf({ binary: soffice, log, timeoutMs: config.libreOfficeTimeoutMs })
    : null;
  const renderProgress = new RenderProgress();
  const queue = new InProcessQueue<ImportJob>(
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
          renderProgress,
          syncPollMs: config.sync.pollIntervalMs,
        },
        job,
      ),
    log,
    importJobPriority,
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

  const sync = new SyncService({ db, storage, sources, queue, clock, log, config });
  const live = new LiveHub();
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
    live,
    ownerId: owner?.id ?? null,
    instance: {
      env,
      restart:
        env['SLIDER_SUPERVISED'] === '1' ? () => shutdown('Restart', RESTART_EXIT_CODE) : null,
    },
  });
  await announceSetup(config, db, log);
  const scheduler = new SyncScheduler({ db, clock, log, sync, config });
  if (config.sync.pollIntervalMs > 0) scheduler.start();
  else log.info('Automatic updates of linked decks are off (SYNC_POLL_INTERVAL_MS=0).');
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
    // LibreOffice runs in its own process group and would outlive this process.
    stopRunningConversions();
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
