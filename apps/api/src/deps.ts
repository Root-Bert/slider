import type { MicrosoftTokens } from './auth/microsoft';
import type { OidcClient } from './auth/oidc';
import type { Clock } from './clock';
import type { Config } from './config';
import type { Database } from './db/client';
import type { ImportJob, JobQueue } from './import/queue';
import type { Logger } from './logger';
import type { Mailer } from './mail/mailer';
import type { SourceAdapters } from './sources/source-adapter';
import type { BlobStorage } from './storage/blob-storage';
import type { SyncService } from './sync/sync-service';

/** Everything the HTTP layer depends on; injected so tests can build an app in memory. */
export interface AppDeps {
  config: Config;
  db: Database;
  storage: BlobStorage;
  /** Voice and video recordings (BER-116), a store of their own (`MEDIA_DIR`, later R2). */
  media: BlobStorage;
  queue: JobQueue<ImportJob>;
  sources: SourceAdapters;
  /** Microsoft sign-in tokens per user (BER-92). */
  microsoft: MicrosoftTokens;
  clock: Clock;
  log: Logger;
  /** Automatic updates of link-imported decks (BER-107). */
  sync: SyncService;
  /** Generic OpenID Connect login (BER-129); `null` when OIDC_ISSUER is not set. */
  oidc: OidcClient | null;
  /** Magic links and invitation mails; a `NullMailer` without SMTP. */
  mailer: Mailer;
  /**
   * The `users.id` of the dev owner (see {@link Config.devOwner}) – only with `auth.devLogin`,
   * else `null`.
   */
  ownerId: string | null;
}
