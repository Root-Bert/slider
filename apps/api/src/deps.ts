import type { Clock } from './clock';
import type { Config } from './config';
import type { Database } from './db/client';
import type { ImportJob, JobQueue } from './import/queue';
import type { Logger } from './logger';
import type { SourceAdapters } from './sources/source-adapter';
import type { BlobStorage } from './storage/blob-storage';

/** Everything the HTTP layer depends on; injected so tests can build an app in memory. */
export interface AppDeps {
  config: Config;
  db: Database;
  storage: BlobStorage;
  queue: JobQueue<ImportJob>;
  sources: SourceAdapters;
  clock: Clock;
  log: Logger;
  /** The `users.id` of the dev owner (see {@link Config.devOwner}). */
  ownerId: string;
}
