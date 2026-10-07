import { and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Clock } from '../clock';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { decks } from '../db/schema';
import type { Logger } from '../logger';
import { SYNC_ACTIVE_WINDOW_MS, type SyncService } from './sync-service';

/** Decks checked per tick at most; the rest follow on the next ticks. */
export const SYNC_MAX_DECKS_PER_TICK = 20;
const SYNC_MAX_TICK_MS = 30_000;

export interface SyncSchedulerDeps {
  db: Database;
  clock: Clock;
  log: Logger;
  sync: SyncService;
  config: Pick<Config, 'sync'>;
}

/** How often the scheduler wakes up: often enough for the debounce to end on time. */
export function syncTickMs(config: Config['sync']): number {
  const candidates = [config.pollIntervalMs, config.debounceMs, SYNC_MAX_TICK_MS].filter(
    (ms) => ms > 0,
  );
  return Math.max(1_000, Math.min(...candidates));
}

/**
 * Polls link-imported decks for changes inside the API process (BER-107), like the in-process
 * import queue. Each tick checks the decks whose `nextCheckAt` is due, one after the other:
 * not archived, imported successfully, and opened or changed within the last 7 days.
 */
export class SyncScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly deps: SyncSchedulerDeps) {}

  start(): void {
    if (this.timer || this.deps.config.sync.pollIntervalMs <= 0) return;
    const every = syncTickMs(this.deps.config.sync);
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref?.();
    this.deps.log.info(
      `Automatic updates: checking linked decks every ${Math.round(this.deps.config.sync.pollIntervalMs / 1000)} s`,
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get started(): boolean {
    return this.timer !== null;
  }

  /** Checks every due deck once. Returns the ids checked; overlapping ticks are skipped. */
  async tick(): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const due = await this.dueDecks();
      for (const deckId of due) {
        try {
          await this.deps.sync.checkDeck(deckId);
        } catch (error) {
          this.deps.log.error(`Sync check of deck ${deckId} failed`, error);
        }
      }
      return due;
    } catch (error) {
      this.deps.log.error('Sync tick failed', error);
      return [];
    } finally {
      this.running = false;
    }
  }

  private async dueDecks(): Promise<string[]> {
    const now = this.deps.clock.now();
    const nowIso = now.toISOString();
    const activeSince = new Date(now.getTime() - SYNC_ACTIVE_WINDOW_MS).toISOString();
    const nextCheckAt = sql`(${decks.syncState}->>'nextCheckAt')::timestamptz`;
    const rows = await this.deps.db
      .select({ id: decks.id })
      .from(decks)
      .where(
        and(
          inArray(decks.source, ['onedrive', 'sharepoint', 'url']),
          isNotNull(decks.sourceRef),
          isNull(decks.archivedAt),
          sql`${decks.importState}->>'status' = 'ready'`,
          sql`greatest(${decks.lastViewedAt}, ${decks.updatedAt}) >= ${activeSince}::timestamptz`,
          sql`(${nextCheckAt} is null or ${nextCheckAt} <= ${nowIso}::timestamptz)`,
        ),
      )
      .orderBy(sql`${nextCheckAt} asc nulls first`, decks.id)
      .limit(SYNC_MAX_DECKS_PER_TICK);
    return rows.map((row) => row.id);
  }
}
