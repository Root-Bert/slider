import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { openPptx } from '@slider/pptx';
import { createApp } from './app';
import { LiveTexts } from './realtime/live-texts';
import { BackgroundWork } from './background-work';
import { StripeBilling } from './billing/stripe-billing';
import { MicrosoftLogin } from './auth/microsoft';
import { NextcloudAccounts } from './auth/nextcloud';
import { OidcClient } from './auth/oidc';
import { systemClock } from './clock';
import { dataPaths, loadBootConfig } from './config';
import { openDatabase } from './db/client';
import { GUARDED_EXIT_CODE, holdData } from './desktop-apps';
import { users } from './db/schema';
import { releaseRunningImportAttempts } from './import/attempts';
import { findInterruptedImports, importDeck } from './import/import-deck';
import { createOfficePool } from './import/office-pool';
import { BlankDecks } from './import/ready-blank';
import { configurePdfJobs, stopPdfJobs, warmPdfWorker } from './import/pdf-jobs';
import {
  createLibreOfficeDocumentPdf,
  createMaterialPdf,
  createTextDocumentOdt,
  createLibreOfficePdf,
  findSoffice,
  stopRunningConversions,
} from './import/libreoffice';
import {
  importJobKey,
  importJobPriority,
  InProcessQueue,
  isUrgentImportJob,
  type ImportJob,
} from './import/queue';
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
import { retireFileConnections } from './services/retired-connections';
import { backfillMasterColors } from './services/workspace-masters';
import { placeOlderDecks } from './services/deck-places';
import { backfillDeckFilesBytes } from './services/workspace-storage';
import { ensurePersonalWorkspace } from './services/workspaces';
import { createSourceAdapters } from './sources/source-adapter';
import { FsBlobStorage } from './storage/fs-blob-storage';
import type { AppDeps } from './deps';
import { deckFontAdopter } from './services/deck-fonts';
import { sendDueMail, syncAllMail } from './services/mail';
import { runDueCloudAgents, runWatchingCloudAgents } from './services/cloud-agents';
import { RetentionSweeper } from './services/retention';
import { resumeTranscripts } from './services/transcripts';
import { resumeExtractions } from './services/material-extract';
import { DocumentLive } from './services/documents';
import { SyncService } from './sync/sync-service';

/** Exit code that asks `supervisor.ts` to start the server again (settings were saved); same there. */
const RESTART_EXIT_CODE = 75;

async function main(): Promise<void> {
  const env = process.env;
  // Read first: killed during the start, the supervisor must not be taken for whoever comes after.
  const supervisor = process.ppid;
  // Data folder, database and secret come from the environment only; then the settings saved on
  // the setup page fill in what the environment leaves open, and the whole is validated.
  const boot = loadBootConfig(env);
  const { dbDir, blobsDir } = dataPaths(boot);
  const clock = systemClock;
  // The desktop's service: the database bears one process only. Held from before it is opened
  // until this process is gone – a second service on the same data ends here.
  if (env['SLIDER_GUARD_PORT'] && !(await holdData(Number(env['SLIDER_GUARD_PORT'])))) {
    log.error(
      `Slider already runs on this data (port ${env['SLIDER_GUARD_PORT']} is taken), not starting a second time.`,
    );
    process.exit(GUARDED_EXIT_CODE);
  }
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
    // The desktop app's one person runs their own instance: admin of it (AI keys, settings)
    // without the setup token, which only guards a server others can reach.
    if (config.desktop) {
      await db.update(users).set({ isInstanceAdmin: true }).where(eq(users.id, owner.id));
    }
    log.info(`No login configured – every visitor acts as ${owner.email} (AUTH_DEV_LOGIN).`);
  }
  const oidc = config.auth.oidc ? new OidcClient(config.auth.oidc, clock) : null;
  const google = config.auth.google ? new OidcClient(config.auth.google, clock) : null;
  const mailer = createMailer(config.smtp, log, config.env);
  if (!config.smtp && config.env === 'development') {
    log.info('No SMTP configured – invitation mails are logged here instead of sent.');
  }

  const microsoft = new MicrosoftLogin({ config: config.microsoft, clock, log });
  if (!config.microsoft) {
    log.info('Microsoft login is not configured (MS_CLIENT_ID/MS_CLIENT_SECRET).');
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
  const sources = createSourceAdapters({ config, log, nextcloud });
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
  // Word and PowerPoint files on decks' boards: their text is read from a PDF of them.
  const materialPdf = soffice
    ? createMaterialPdf({
        binary: soffice,
        log,
        timeoutMs: config.libreOfficeTimeoutMs,
        pool: officePool,
      })
    : null;
  // Writer: Word and text files become text documents.
  const documentOdt = soffice
    ? createTextDocumentOdt({ binary: soffice, log, timeoutMs: config.libreOfficeTimeoutMs })
    : null;
  // PDFs are read in worker threads, cut off after this long (plus a second per page).
  configurePdfJobs({ timeoutMs: config.pdfTimeoutMs });
  // … one of them started ahead, so the first edit finds pdf.js loaded.
  if (officePool) warmPdfWorker();
  const renderProgress = new RenderProgress();
  // Live before the imports: a synced revision is written into the texts typed in together.
  const live = new LiveHub();
  const liveTexts = new LiveTexts(live);
  const queue: InProcessQueue<ImportJob> = new InProcessQueue<ImportJob>(
    (job) =>
      importDeck(
        {
          db,
          storage,
          openPptx,
          clock,
          log,
          libreOfficePdf,
          renderProgress,
          liveTexts,
          // A first import opens on SVG previews; LibreOffice's pictures follow as a job.
          queue,
          // Fonts an ODP brings along become its workspace's, before it is drawn.
          adoptFonts: deckFontAdopter({
            db,
            storage,
            log,
            config,
            clock,
            queue,
            rendering: { renderers: { libreOfficePdf }, progress: renderProgress },
          }),
        },
        job,
      ),
    log,
    {
      priority: importJobPriority,
      key: importJobKey,
      urgent: isUrgentImportJob,
      concurrency: config.importWorkers,
    },
  );
  for (const job of await findInterruptedImports(db)) {
    log.info(`Resuming interrupted ${job.kind ?? 'initial'} import of deck ${job.deckId}`);
    queue.enqueue(job);
  }
  // Decks imported before a better renderer was available: once per revision, in the background.
  scheduleRerenderBackfill({
    db,
    queue,
    renderers: { libreOfficePdf },
    progress: renderProgress,
    log,
  });

  scheduleFileAuthorBackfill({ db, storage, openPptx, log });
  // Google Drive and OneDrive are gone: their stored grants are revoked and deleted once.
  retireFileConnections({ db, secret: config.secret, log }).catch((error: unknown) =>
    log.error('Retiring the Google and Microsoft file connections failed', error),
  );
  // Decks from before storage counted per workspace (BER-151) get measured once.
  backfillDeckFilesBytes({ db, storage, log }).catch((error: unknown) =>
    log.error('Measuring the storage of older decks failed', error),
  );
  // Designs uploaded before their theme's colours were read get them once (Bibliothek → Farben).
  backfillMasterColors({ db, storage, log }).catch((error: unknown) =>
    log.error('Reading the colours of older designs failed', error),
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
    documentPdf,
  });
  const background = new BackgroundWork();
  // Drawn once ahead: „Neue Präsentation“ opens at once.
  const blankDecks = new BlankDecks({ openPptx, clock, log, libreOfficePdf });
  blankDecks.warm();
  const deps: AppDeps = {
    config,
    db,
    storage,
    media,
    queue,
    sources,
    microsoft,
    nextcloud,
    clock,
    log,
    sync,
    rendering: { renderers: { libreOfficePdf }, progress: renderProgress },
    blankDecks,
    documentPdf,
    materialPdf,
    documentOdt,
    oidc,
    google,
    billing: config.billing ? new StripeBilling(config.billing) : null,
    mailer,
    live,
    liveTexts,
    // Made here, so files read after a restart (`resumeExtractions`) tell an open document too.
    documentLive: new DocumentLive(),
    background,
    ownerId: owner?.id ?? null,
    instance: {
      env,
      restart:
        env['SLIDER_SUPERVISED'] === '1' ? () => shutdown('Restart', RESTART_EXIT_CODE) : null,
    },
  };
  // Presentations and their folders from before Cloud get their place there, once.
  placeOlderDecks(deps)
    .then((count) => count > 0 && log.info(`${count} older presentations got their place`))
    .catch((error: unknown) => log.error('Placing older presentations failed', error));

  const app = createApp(deps);
  await announceSetup(config, db, log);
  // Deletion deadlines (BER-143, BER-147): unused accounts and decks, old invites, sessions.
  const sweeper = new RetentionSweeper(deps);
  sweeper.start();
  // „Agenten“: orders that repeat are taken up when their time has come – looked at twice a minute.
  let agentsDue = false;
  const agentClock = setInterval(() => {
    if (agentsDue) return;
    agentsDue = true;
    void runDueCloudAgents(deps)
      .catch((error: unknown) => log.error('Running repeated cloud agent orders failed', error))
      .finally(() => {
        agentsDue = false;
      });
  }, 30_000);
  agentClock.unref?.();
  // What they watch is looked at every few seconds: an agent that waits 20 s for quiet starts
  // then, not half a minute later (one look at a time: `runWatchingCloudAgents`).
  const watchClock = setInterval(() => {
    void runWatchingCloudAgents(deps).catch((error: unknown) =>
      log.error('Looking where cloud agents watch failed', error),
    );
  }, 5_000);
  watchClock.unref?.();
  // Mail: every mailbox is read once a minute (one round at a time: `syncAllMail`).
  let mailDue = false;
  const mailClock = setInterval(() => {
    if (mailDue) return;
    mailDue = true;
    void syncAllMail(deps)
      .catch((error: unknown) => log.error('Reading the mailboxes failed', error))
      .finally(() => {
        mailDue = false;
      });
  }, 60_000);
  mailClock.unref?.();
  // The outbox: what is due goes out (one round at a time) – a mail waits `delay` seconds there.
  let outboxDue = false;
  const outboxClock = setInterval(() => {
    if (outboxDue) return;
    outboxDue = true;
    void sendDueMail(deps)
      .catch((error: unknown) => log.error('Sending the outbox failed', error))
      .finally(() => {
        outboxDue = false;
      });
  }, 3_000);
  outboxClock.unref?.();
  // Recordings a stopped server left without their transcript.
  await resumeTranscripts(deps);
  await resumeExtractions(deps);
  const server = serve(
    { fetch: app.fetch, port: config.port, ...(config.host && { hostname: config.host }) },
    (info) => {
      log.info(
        `Slider API listening on http://${config.host ?? 'localhost'}:${info.port} (data: ${config.dataDir}, media: ${config.media.dir})`,
      );
    },
  );

  let shuttingDown = false;
  function shutdown(signal: string, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, shutting down…`);
    sweeper.stop();
    clearInterval(agentClock);
    clearInterval(watchClock);
    clearInterval(mailClock);
    clearInterval(outboxClock);
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
      // or it runs crash recovery on the next start – after the work behind answers that still
      // writes to it (an edit's sharper pictures) – but never wait for it forever.
      await Promise.race([
        Promise.all([imports, background.idle()])
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
  // The desktop's service (desktop/service.mjs): its supervisor ends it when no app is left and
  // is the process the apps know. With that one gone – killed alone – nothing would end this.
  if (env['SLIDER_APPS_DIR']) {
    setInterval(() => {
      if (process.ppid !== supervisor) shutdown('Supervisor gone');
    }, 5_000).unref();
  }
}

main().catch((error: unknown) => {
  log.error('Failed to start the Slider API', error);
  process.exit(1);
});
