import { serve } from '@hono/node-server';
import { openPptx } from '@slider/pptx';
import { createApp } from './app';
import { MicrosoftTokens } from './auth/microsoft';
import { OidcClient } from './auth/oidc';
import { systemClock } from './clock';
import { dataPaths, hasLogin, loadConfig, withStoredSettings, type Config } from './config';
import { openDatabase, type Database } from './db/client';
import { findInterruptedImports, importDeck } from './import/import-deck';
import { createOfficePdf } from './import/office-pages';
import { createLibreOfficePdf, findSoffice } from './import/libreoffice';
import { InProcessQueue, type ImportJob } from './import/queue';
import { RenderProgress } from './import/render-progress';
import { scheduleRerenderBackfill } from './import/rerender';
import { consoleLogger as log } from './logger';
import { createMailer } from './mail/mailer';
import {
  ensureSetupToken,
  instanceClaimed,
  readStoredSettings,
  removeSetupToken,
} from './services/instance-settings';
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
  // the setup page fill in what the environment leaves open.
  const boot = loadConfig(env, () => {});
  const { dbDir, blobsDir } = dataPaths(boot);
  const clock = systemClock;
  // Self-hosting: a Postgres server when DATABASE_URL is set, else PGlite in the data folder.
  const database = await openDatabase(boot.hosting?.databaseUrl ?? dbDir);
  const { db } = database;
  const config = await loadFullConfig(env, boot, db);
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
    instance: {
      env,
      restart:
        env['SLIDER_SUPERVISED'] === '1' ? () => shutdown('Restart', RESTART_EXIT_CODE) : null,
    },
  });
  await announceSetup(config, db);
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
    server.close(async () => {
      // Interrupted imports are picked up again on the next start.
      await database.close();
      process.exit(exitCode);
    });
    // Idle keep-alive connections would hold `close` back; running requests may finish.
    if ('closeIdleConnections' in server) server.closeIdleConnections();
    setTimeout(() => process.exit(exitCode || 1), 5_000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/** The environment plus the settings saved on the setup page; broken stored settings are skipped. */
async function loadFullConfig(env: NodeJS.ProcessEnv, boot: Config, db: Database): Promise<Config> {
  const stored = await readStoredSettings(db, boot.secret, log);
  if (Object.keys(stored).length === 0) return loadConfig(env);
  try {
    const config = loadConfig(withStoredSettings(env, stored));
    log.info(`Settings from the setup page: ${Object.keys(stored).join(', ')}`);
    return config;
  } catch (error) {
    log.error('The settings saved on the setup page are invalid – starting without them', error);
    return loadConfig(env);
  }
}

/**
 * Until the first account exists, the log shows the one-time link to the setup page – the only
 * way in when no login is configured yet.
 */
async function announceSetup(config: Config, db: Database): Promise<void> {
  if (await instanceClaimed(db)) {
    removeSetupToken(config.dataDir);
    if (!hasLogin(config) && !config.auth.devLogin) {
      log.warn('No login is configured. The instance admin can set one up at /einrichtung.');
    }
    return;
  }
  // Development without a login acts as the dev owner – nothing to set up.
  if (config.env === 'test' || config.auth.devLogin) return;
  const token = ensureSetupToken(config.dataDir);
  const url = `${config.webOrigin}/einrichtung#token=${token}`;
  log.warn(
    [
      '',
      '────────────────────────────────────────────────────────────────────',
      ' Slider is not set up yet. Open this link to configure the login',
      ' and become the admin of this instance:',
      '',
      `   ${url}`,
      '',
      ' (Shown until the first account exists. Keep it private.)',
      '────────────────────────────────────────────────────────────────────',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  log.error('Failed to start the Slider API', error);
  process.exit(1);
});
