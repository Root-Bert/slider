import { and, desc, eq, exists, isNull, max } from 'drizzle-orm';
import type { SyncError, SyncResult } from '@slider/shared';
import type { Clock } from '../clock';
import { DEFAULT_SYNC_POLL_INTERVAL_MS, type Config } from '../config';
import type { Database } from '../db/client';
import {
  decks,
  googleConnections,
  nextcloudConnections,
  revisions,
  workspaceMembers,
  type DeckRow,
  type DeckSyncStateRow,
  type RevisionRow,
} from '../db/schema';
import { ApiError, notFound } from '../http/errors';
import { toDeckBytes } from '../import/any-file';
import { pdfMakerOf } from '../import/pdf-maker';
import { sha256Hex } from '../import/common';
import { isPdfBytes } from '../sources/safe-fetch';
import type { DocumentToPdf } from '../import/libreoffice';
import type { ImportJob, JobQueue } from '../import/queue';
import type { Logger } from '../logger';
import { isSyncEnabled } from '../services/deck-sync';
import { assertStorageFor, assertWithinLimits } from '../services/plans';
import { withDeckConnection, type ConnectionLookup } from '../sources/connections';
import {
  readContributors,
  type RemoteFile,
  type SourceAdapter,
  type SourceAdapters,
  type SourceContext,
} from '../sources/source-adapter';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import {
  loginUrlOfDeck,
  ownerLeftMessage,
  storageFullMessage,
  toSyncError,
  TRANSIENT_SYNC_ERRORS,
} from './errors';
import { healthyCheck, mergeSyncState, SYNC_MAX_BACKOFF_MS, syncBackoffMs } from './state';

export { SYNC_MAX_BACKOFF_MS } from './state';

/** Only decks someone opened or changed within this window are polled. */
export const SYNC_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Constant autosaving must not postpone an import forever: after 10 × debounce it happens. */
export const SYNC_MAX_DEBOUNCE_FACTOR = 10;
/** Transient errors (source unreachable) show a banner only after this many failures in a row. */
export const SYNC_TRANSIENT_ERROR_THRESHOLD = 3;
/** Sources without ETag/cTag are downloaded and hashed – at most every 5 poll intervals. */
export const SYNC_CONTENT_CHECK_FACTOR = 5;
/** A manual check waits this long for the import before answering `queued`. */
export const SYNC_MANUAL_WAIT_MS = 25_000;

const CONTENT_TOKEN_PREFIX = 'sha256:';

/** A version's deck file, and the SHA-256 of the file it was made from (`contentSha256`). */
interface Downloaded {
  bytes: Uint8Array;
  sha: string;
}

export interface SyncServiceDeps {
  db: Database;
  storage: BlobStorage;
  sources: SourceAdapters;
  queue: JobQueue<ImportJob>;
  clock: Clock;
  log: Logger;
  config: Pick<Config, 'sync' | 'plans'>;
  /** The owners' Microsoft connections, for decks that do not know theirs yet. */
  connections?: ConnectionLookup;
  /** LibreOffice for Word, Excel and text files (see `toDeckBytes`); absent → none of those. */
  documentPdf?: DocumentToPdf | null;
}

export interface CheckOptions {
  /** Owner pressed "Neu rendern": no debounce, no throttling, wait for the import. */
  manual?: boolean;
}

type Remote = { adapter: SourceAdapter; file: RemoteFile; context: SourceContext };

/**
 * Keeps link-imported decks up to date (BER-107). `checkDeck` compares the source's change
 * token with the current revision's, waits until PowerPoint stops autosaving (debounce) and then
 * queues a sync import of the new file. Idempotent: the same token never creates a second
 * revision, and identical bytes under a new token only record the token.
 *
 * Errors never touch the current revision; they end up in `decks.sync_state` for a banner.
 */
export class SyncService {
  /** One check per deck at a time; concurrent callers share it. */
  private readonly inFlight = new Map<string, { promise: Promise<SyncResult>; manual: boolean }>();

  constructor(private readonly deps: SyncServiceDeps) {}

  private get pollMs(): number {
    return this.deps.config.sync.pollIntervalMs || DEFAULT_SYNC_POLL_INTERVAL_MS;
  }

  private get debounceMs(): number {
    return this.deps.config.sync.debounceMs;
  }

  checkDeck(deckId: string, options: CheckOptions = {}): Promise<SyncResult> {
    const manual = options.manual ?? false;
    return this.exclusive(deckId, manual, () => this.check(deckId, manual));
  }

  /**
   * A new file uploaded by hand for an upload deck: same pipeline, trigger `upload`. Uploads
   * never share a running call (each carries its own bytes); they run one after the other, and
   * one that still finds an unfinished revision is refused instead of being dropped silently.
   */
  /** `sourceSha` is that of the file as it came, when `bytes` is the PDF it was turned into. */
  importUpload(
    deckId: string,
    bytes: Uint8Array,
    sourceSha = sha256Hex(bytes),
  ): Promise<SyncResult> {
    return this.exclusive(
      deckId,
      true,
      async () => {
        // Pending first, then the current revision: a sync import finishing in between
        // would otherwise leave us comparing against a stale revision.
        const pending = await this.pendingRevision(deckId);
        if (pending) {
          throw new ApiError(
            409,
            'bad_request',
            'Gerade wird noch eine andere Version verarbeitet. Versuche es gleich noch einmal.',
          );
        }
        const { deck, current } = await this.load(deckId);
        // A deck stays what it came as: its versions are compared slide by slide.
        if (current?.pptxKey && current.pptxKey.endsWith('.pdf') !== isPdfBytes(bytes)) {
          throw new ApiError(
            400,
            'not_a_powerpoint',
            current.pptxKey.endsWith('.pdf')
              ? 'Diese Präsentation kam als PDF – bitte auch die neue Version als PDF hochladen.'
              : 'Diese Präsentation kam als PowerPoint – bitte auch die neue Version als .pptx hochladen.',
          );
        }
        if (current && sourceSha === (await this.revisionSha(current))) {
          return { status: 'unchanged' };
        }
        // Not while over the plan's limits (BER-155), nor past the storage limit (BER-151) –
        // early, before the file is stored; `createRevision` checks again under the lock.
        await this.deps.db.transaction((tx) =>
          assertStorageFor(
            tx,
            this.deps.config,
            deck.workspaceId,
            bytes.byteLength,
            this.deps.clock.now(),
          ),
        );
        return this.createRevision(deck, { bytes, sha: sourceSha }, null, 'upload', true);
      },
      { join: false },
    );
  }

  /**
   * Serialises work per deck. By default a caller joins a running call it may share (any call
   * for a poll, a manual one for a manual call); with `join: false` it always queues behind.
   */
  private exclusive(
    deckId: string,
    manual: boolean,
    work: () => Promise<SyncResult>,
    { join = true }: { join?: boolean } = {},
  ): Promise<SyncResult> {
    const running = this.inFlight.get(deckId);
    if (join && running && (running.manual || !manual)) return running.promise;
    // A manual request waits for a running poll check, then runs without debounce.
    const before = running ? running.promise.catch(() => undefined) : Promise.resolve();
    const promise = before.then(work).finally(() => {
      if (this.inFlight.get(deckId)?.promise === promise) this.inFlight.delete(deckId);
    });
    this.inFlight.set(deckId, { promise, manual });
    return promise;
  }

  /**
   * The source's file as the deck it becomes – any file but a PPTX or PDF turned into a PDF – and
   * the SHA-256 of the file as it came: a conversion differs byte by byte on every run, so
   * versions are told apart by the original.
   */
  private async download({ adapter, file, context }: Remote): Promise<Downloaded> {
    const original = await adapter.download(file, context);
    return {
      bytes: await toDeckBytes(file.fileName, original, this.deps.documentPdf),
      sha: sha256Hex(original),
    };
  }

  private async load(deckId: string): Promise<{ deck: DeckRow; current: RevisionRow | null }> {
    const [deck] = await this.deps.db.select().from(decks).where(eq(decks.id, deckId));
    if (!deck) throw notFound('Diese Präsentation gibt es nicht (mehr).');
    const [current] = deck.currentRevisionId
      ? await this.deps.db.select().from(revisions).where(eq(revisions.id, deck.currentRevisionId))
      : [];
    return { deck, current: current ?? null };
  }

  private async pendingRevision(deckId: string): Promise<{ id: string } | null> {
    const [row] = await this.deps.db
      .select({ id: revisions.id })
      .from(revisions)
      .where(and(eq(revisions.deckId, deckId), eq(revisions.status, 'pending')))
      .limit(1);
    return row ?? null;
  }

  private async check(deckId: string, manual: boolean): Promise<SyncResult> {
    // Pending first, then the deck: if a queued import commits in between, `load` already sees
    // its revision as current (the flip is atomic), so we never compare against a stale one.
    const pending = await this.pendingRevision(deckId);
    const { deck, current } = await this.load(deckId);
    if (!isSyncEnabled(deck) || !deck.sourceRef || deck.importState.status !== 'ready') {
      return { status: 'unchanged' };
    }
    if (pending) return { status: 'queued', revisionId: pending.id };
    if (!current) return { status: 'unchanged' };

    const now = this.deps.clock.now();
    // Syncing goes by the owner's accounts: never with someone who left the workspace (their
    // linked decks are deleted then, see `departDecks`; this catches decks from before).
    if (!(await this.ownerIsMember(deck))) return this.ownerLeft(deck, now);
    // Over the plan's limits nothing new comes in (BER-155): "Neu laden" says why, polling waits.
    if (manual) await assertWithinLimits(this.deps.db, this.deps.config, deck.workspaceId, now);
    else if (await this.overLimit(deck, now)) {
      await mergeSyncState(this.deps.db, deckId, {
        lastCheckedAt: now.toISOString(),
        nextCheckAt: this.after(now, SYNC_MAX_BACKOFF_MS),
      });
      return { status: 'unchanged' };
    }
    const state = deck.syncState;
    const adapter = this.deps.sources[deck.source as Exclude<DeckRow['source'], 'upload'>];
    const file: RemoteFile = {
      ref: deck.sourceRef,
      fileName: deck.fileName,
      sizeBytes: 0,
      changeToken: null,
    };

    try {
      // Through the deck's Microsoft (Nextcloud, Google) connection – or, without one, the first
      // of the owner's that has access; the rest of the check goes through the same one.
      const changed =
        deck.source === 'nextcloud'
          ? await this.throughNextcloud(deck, (context) => adapter.getChangeToken(file, context))
          : deck.source === 'google'
            ? await this.throughGoogle(deck, (context) => adapter.getChangeToken(file, context))
            : await withDeckConnection(this.deps, deck, (context) =>
                adapter.getChangeToken(file, context),
              );
      const remote: Remote = { adapter, file, context: changed.context };
      let token = changed.value;
      // Decks linked before contributors were recorded learn them now; the rest with a revision.
      const knowsContributors = deck.sourceContributors !== null;
      if (!knowsContributors) await this.refreshContributors(deck, remote);
      let baseline = current.sourceChangeToken;
      let downloaded: Downloaded | null = null;
      const bookkeeping: Partial<DeckSyncStateRow> = {};

      if (token === '') {
        // No ETag/cTag: compare the content itself, but not on every poll.
        const lastContentCheck = state.lastContentCheckAt
          ? Date.parse(state.lastContentCheckAt)
          : 0;
        if (!manual && now.getTime() - lastContentCheck < SYNC_CONTENT_CHECK_FACTOR * this.pollMs) {
          await mergeSyncState(this.deps.db, deckId, {
            lastCheckedAt: now.toISOString(),
            nextCheckAt: this.after(now, this.pollMs),
          });
          return { status: 'unchanged' };
        }
        downloaded = await this.download(remote);
        token = CONTENT_TOKEN_PREFIX + downloaded.sha;
        const sha = await this.revisionSha(current);
        baseline = sha ? CONTENT_TOKEN_PREFIX + sha : null;
        bookkeeping.lastContentCheckAt = now.toISOString();
      }

      if (baseline !== null && token === baseline) {
        await mergeSyncState(this.deps.db, deckId, {
          ...healthyCheck(now, new Date(now.getTime() + this.pollMs)),
          ...bookkeeping,
        });
        return { status: 'unchanged' };
      }

      if (!manual && state.failedToken && token === state.failedToken) {
        // This exact file failed to import before; wait for the next change.
        await mergeSyncState(this.deps.db, deckId, {
          lastCheckedAt: now.toISOString(),
          nextCheckAt: this.after(now, this.pollMs),
          pending: null,
          ...bookkeeping,
        });
        return { status: 'error', error: this.storedError(deck) };
      }

      // The workspace's storage is full (BER-151): no new version comes in – neither waited
      // for nor downloaded – until there is room. Then the next check takes it over by itself.
      // A version found too big before waits for room for its own size, without a new download.
      const blockedBytes = state.storageBlocked?.token === token ? state.storageBlocked.bytes : 0;
      if (await this.storageFull(deck, blockedBytes, now)) {
        return await this.storageBlocked(deck, now, bookkeeping);
      }

      if (!manual) {
        const waiting = this.debounce(state, token, now);
        if (waiting) {
          await mergeSyncState(this.deps.db, deckId, { ...waiting, ...bookkeeping });
          return { status: 'queued' };
        }
      }

      if (Object.keys(bookkeeping).length > 0) {
        await mergeSyncState(this.deps.db, deckId, bookkeeping);
      }
      downloaded ??= await this.download(remote);
      const { bytes } = downloaded;
      const realToken = token.startsWith(CONTENT_TOKEN_PREFIX) ? null : token;
      if (downloaded.sha === (await this.revisionSha(current))) {
        // A new token for the same bytes (e.g. metadata only): remember it, no new revision.
        if (realToken !== null) {
          await this.deps.db
            .update(revisions)
            .set({ sourceChangeToken: realToken })
            .where(eq(revisions.id, current.id));
        }
        await mergeSyncState(
          this.deps.db,
          deckId,
          healthyCheck(now, new Date(now.getTime() + this.pollMs)),
        );
        return { status: 'unchanged' };
      }
      // Room left, but not for this file: it waits the same way.
      if (await this.storageFull(deck, bytes.byteLength, now)) {
        return await this.storageBlocked(deck, now, {
          storageBlocked: { token, bytes: bytes.byteLength },
        });
      }
      if (knowsContributors) await this.refreshContributors(deck, remote);
      const size = bytes.byteLength;
      return await this.createRevision(
        deck,
        downloaded,
        realToken,
        manual ? 'manual' : 'poll',
        manual,
      ).catch((error: unknown) => {
        // Another upload took the rest meanwhile (the binding check, under the lock): it waits
        // the same way.
        if (error instanceof ApiError && error.code === 'plan_limit') {
          return this.storageBlocked(deck, now, { storageBlocked: { token, bytes: size } });
        }
        throw error;
      });
    } catch (error) {
      return this.fail(deck, error, now);
    }
  }

  /**
   * `null` when the change has settled (or waited long enough) and should be imported now;
   * otherwise the pending state to store.
   */
  private debounce(
    state: DeckSyncStateRow,
    token: string,
    now: Date,
  ): Partial<DeckSyncStateRow> | null {
    const debounce = this.debounceMs;
    const pending = state.pending ?? null;
    const same = pending?.token === token;
    const firstSeenAt = pending ? Date.parse(pending.firstSeenAt) : now.getTime();
    const lastChangedAt = same && pending ? Date.parse(pending.lastChangedAt) : now.getTime();
    const t = now.getTime();
    const forced = t - firstSeenAt >= SYNC_MAX_DEBOUNCE_FACTOR * debounce;
    const settled = same && t - lastChangedAt >= debounce;
    if (forced || settled) return null;
    // Look again before the quiet period ends, to notice further autosaves.
    const recheck = Math.min(this.pollMs, Math.max(1_000, Math.floor(debounce / 2)));
    const nextCheckAt = Math.max(t + 1_000, Math.min(lastChangedAt + debounce, t + recheck));
    return {
      pending: {
        token,
        firstSeenAt: new Date(firstSeenAt).toISOString(),
        lastChangedAt: new Date(lastChangedAt).toISOString(),
      },
      lastCheckedAt: now.toISOString(),
      nextCheckAt: new Date(nextCheckAt).toISOString(),
    };
  }

  /** Stores the file as a pending revision and queues its import. */
  private async createRevision(
    deck: DeckRow,
    { bytes, sha }: Downloaded,
    token: string | null,
    trigger: 'poll' | 'manual' | 'upload',
    wait: boolean,
  ): Promise<SyncResult> {
    const { db, storage, clock, queue } = this.deps;
    const revisionId = crypto.randomUUID();
    const pptxKey = blobKeys.pptx(deck.id, revisionId, isPdfBytes(bytes) ? 'pdf' : 'pptx');
    const now = clock.now();
    await storage.put(pptxKey, bytes);
    let stale: SyncResult | null = null;
    try {
      await db.transaction(async (tx) => {
        // Last line of defence against a stale baseline: if the newest revision already is
        // this file, or one is still being imported, create nothing.
        const [latest] = await tx
          .select({
            id: revisions.id,
            status: revisions.status,
            contentSha256: revisions.contentSha256,
          })
          .from(revisions)
          .where(eq(revisions.deckId, deck.id))
          .orderBy(desc(revisions.number))
          .limit(1);
        if (latest?.status === 'pending') {
          stale = { status: 'queued', revisionId: latest.id };
          return;
        }
        if (latest?.status === 'ready' && latest.contentSha256 === sha) {
          stale = { status: 'unchanged' };
          if (token !== null) {
            await tx
              .update(revisions)
              .set({ sourceChangeToken: token })
              .where(eq(revisions.id, latest.id));
          }
          return;
        }
        // The workspace's storage (BER-151) under its lock, reserved in the same transaction:
        // versions and uploads arriving at once can't both take the rest.
        await assertStorageFor(tx, this.deps.config, deck.workspaceId, bytes.byteLength, now);
        const [last] = await tx
          .select({ number: max(revisions.number) })
          .from(revisions)
          .where(eq(revisions.deckId, deck.id));
        // The unique (deck_id, number) key guards against a concurrent second revision.
        await tx.insert(revisions).values({
          id: revisionId,
          deckId: deck.id,
          number: (last?.number ?? 0) + 1,
          createdAt: now,
          pptxKey,
          sourceChangeToken: token,
          status: 'pending',
          trigger,
          contentSha256: sha,
          pdfRenderer: pdfMakerOf(bytes),
          // Held until the import was measured (`measureDeckFiles`) or the revision discarded.
          reservedBytes: bytes.byteLength,
        });
        await mergeSyncState(tx, deck.id, {
          ...(trigger === 'upload' ? {} : healthyCheck(now, new Date(now.getTime() + this.pollMs))),
          // Keep an earlier error visible, and failed imports counted (their backoff), until the
          // import succeeded.
          ...(deck.syncState.lastSyncError ? { lastSyncError: deck.syncState.lastSyncError } : {}),
          consecutiveFailures: deck.syncState.consecutiveFailures ?? 0,
          pending: null,
          importingRevisionId: revisionId,
        });
      });
    } catch (error) {
      await storage.deletePrefix(blobKeys.revisionPrefix(deck.id, revisionId)).catch(() => {});
      throw error;
    }
    if (stale) {
      await storage.deletePrefix(blobKeys.revisionPrefix(deck.id, revisionId)).catch(() => {});
      return stale;
    }

    const done = queue.run({ deckId: deck.id, revisionId, kind: 'sync' });
    if (!wait) return { status: 'queued', revisionId };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SYNC_MANUAL_WAIT_MS);
    });
    await Promise.race([done, timeout]);
    clearTimeout(timer);
    return this.outcome(deck.id, revisionId);
  }

  /** What became of a queued revision. */
  private async outcome(deckId: string, revisionId: string): Promise<SyncResult> {
    const [revision] = await this.deps.db
      .select({ status: revisions.status, summary: revisions.summary })
      .from(revisions)
      .where(eq(revisions.id, revisionId));
    if (revision?.status === 'ready') {
      return {
        status: 'updated',
        revisionId,
        ...(revision.summary ? { summary: revision.summary } : {}),
      };
    }
    if (revision) return { status: 'queued', revisionId };
    const [deck] = await this.deps.db.select().from(decks).where(eq(decks.id, deckId));
    return { status: 'error', error: this.storedError(deck) };
  }

  private storedError(deck: DeckRow | undefined): SyncError {
    const stored = deck?.syncState.lastSyncError;
    if (!deck || !stored)
      return toSyncError(new Error('unknown'), deck?.id ?? '', this.deps.clock.now()).error;
    return {
      ...stored,
      ...(stored.code === 'auth_required' ? { loginUrl: loginUrlOfDeck(deck) } : {}),
    };
  }

  private async fail(deck: DeckRow, error: unknown, now: Date): Promise<SyncResult> {
    const { error: syncError, expected } = toSyncError(error, deck.id, now, {
      loginUrl: loginUrlOfDeck(deck),
    });
    if (!expected) this.deps.log.error(`Sync check of deck ${deck.id} failed`, error);
    else this.deps.log.warn(`Sync check of deck ${deck.id}: ${syncError.code}`);
    const failures = (deck.syncState.consecutiveFailures ?? 0) + 1;
    const backoff = syncBackoffMs(this.pollMs, failures);
    const show =
      !TRANSIENT_SYNC_ERRORS.has(syncError.code) || failures >= SYNC_TRANSIENT_ERROR_THRESHOLD;
    await mergeSyncState(this.deps.db, deck.id, {
      lastCheckedAt: now.toISOString(),
      nextCheckAt: this.after(now, backoff),
      consecutiveFailures: failures,
      ...(show
        ? { lastSyncError: { code: syncError.code, message: syncError.message, at: syncError.at } }
        : {}),
    }).catch(() => {});
    return { status: 'error', error: syncError };
  }

  /**
   * Nextcloud decks read through their own connection, else through the owner's accounts at the
   * file's server (the adapter tries them, also when the own one lost access) – remembering the
   * one that worked, unless the deck changed connection meanwhile.
   */
  private async throughNextcloud<T>(
    deck: DeckRow,
    run: (context: SourceContext) => Promise<T>,
  ): Promise<{ value: T; context: SourceContext }> {
    const context: SourceContext = {
      userId: deck.ownerId,
      nextcloudConnectionId: deck.nextcloudConnectionId,
    };
    const value = await run(context);
    const used = context.nextcloudConnectionId;
    const own = deck.nextcloudConnectionId;
    if (used && used !== own) {
      await this.deps.db
        .update(decks)
        .set({ nextcloudConnectionId: used })
        .where(
          and(
            eq(decks.id, deck.id),
            own ? eq(decks.nextcloudConnectionId, own) : isNull(decks.nextcloudConnectionId),
            // Disconnected during the check: nothing to remember (the foreign key would fail).
            exists(
              this.deps.db
                .select({ id: nextcloudConnections.id })
                .from(nextcloudConnections)
                .where(eq(nextcloudConnections.id, used)),
            ),
          ),
        );
    }
    return { value, context };
  }

  /**
   * Google decks read through their own connection, else through the owner's other Google
   * accounts, else the public link (the adapter tries them) – remembering the account that
   * worked, unless the deck changed connection meanwhile.
   */
  private async throughGoogle<T>(
    deck: DeckRow,
    run: (context: SourceContext) => Promise<T>,
  ): Promise<{ value: T; context: SourceContext }> {
    const context: SourceContext = {
      userId: deck.ownerId,
      googleConnectionId: deck.googleConnectionId,
    };
    const value = await run(context);
    const used = context.googleConnectionId;
    const own = deck.googleConnectionId;
    if (used && used !== own) {
      await this.deps.db
        .update(decks)
        .set({ googleConnectionId: used })
        .where(
          and(
            eq(decks.id, deck.id),
            own ? eq(decks.googleConnectionId, own) : isNull(decks.googleConnectionId),
            // Disconnected during the check: nothing to remember (the foreign key would fail).
            exists(
              this.deps.db
                .select({ id: googleConnections.id })
                .from(googleConnections)
                .where(eq(googleConnections.id, used)),
            ),
          ),
        );
    }
    return { value, context };
  }

  private async overLimit(deck: DeckRow, now: Date): Promise<boolean> {
    try {
      await assertWithinLimits(this.deps.db, this.deps.config, deck.workspaceId, now);
      return false;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'plan_over_limit') return true;
      throw error;
    }
  }

  /** `addBytes` more would not fit into the workspace's storage (`plan_limit`, BER-151). */
  private async storageFull(deck: DeckRow, addBytes: number, now: Date): Promise<boolean> {
    try {
      await this.deps.db.transaction((tx) =>
        assertStorageFor(tx, this.deps.config, deck.workspaceId, addBytes, now),
      );
      return false;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'plan_limit') return true;
      throw error;
    }
  }

  /**
   * The new version waits for room (`storage_full`): nothing is imported, the banner says why,
   * and the next regular check tries again – no backoff, nothing to do by hand once something
   * was deleted or the plan upgraded.
   */
  private async storageBlocked(
    deck: DeckRow,
    now: Date,
    bookkeeping: Partial<DeckSyncStateRow> = {},
  ): Promise<SyncResult> {
    const error: SyncError = {
      code: 'storage_full',
      message: storageFullMessage(deck),
      // An earlier one keeps its time: a banner closed once stays closed while nothing changes.
      at:
        deck.syncState.lastSyncError?.code === 'storage_full'
          ? deck.syncState.lastSyncError.at
          : now.toISOString(),
    };
    await mergeSyncState(this.deps.db, deck.id, {
      lastCheckedAt: now.toISOString(),
      nextCheckAt: this.after(now, this.pollMs),
      pending: null,
      lastSyncError: error,
      ...bookkeeping,
    });
    return { status: 'error', error };
  }

  private async ownerIsMember(deck: DeckRow): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, deck.workspaceId),
          eq(workspaceMembers.userId, deck.ownerId),
        ),
      );
    return row !== undefined;
  }

  private async ownerLeft(deck: DeckRow, now: Date): Promise<SyncResult> {
    const error: SyncError = {
      code: 'access_revoked',
      message: ownerLeftMessage(deck),
      at: now.toISOString(),
    };
    await mergeSyncState(this.deps.db, deck.id, {
      lastCheckedAt: now.toISOString(),
      nextCheckAt: this.after(now, SYNC_MAX_BACKOFF_MS),
      pending: null,
      lastSyncError: error,
    });
    return { status: 'error', error };
  }

  /**
   * Who worked on the file, as the source tells now (`decks.source_contributors`). Best effort:
   * a source that cannot tell leaves `[]`, so it is asked again with the next revision only.
   */
  private async refreshContributors(deck: DeckRow, remote: Remote): Promise<void> {
    if (!remote.adapter.listContributors) return;
    const contributors = await readContributors(
      remote.adapter,
      remote.file,
      remote.context,
      this.deps.log,
    );
    // A failure keeps the names known so far.
    if (contributors === null && deck.sourceContributors !== null) return;
    await this.deps.db
      .update(decks)
      .set({ sourceContributors: contributors ?? [] })
      .where(eq(decks.id, deck.id));
  }

  /** SHA-256 of a revision's original; computed from the stored file once for older revisions. */
  private async revisionSha(revision: RevisionRow): Promise<string | null> {
    if (revision.contentSha256) return revision.contentSha256;
    if (!revision.pptxKey) return null;
    const bytes = await this.deps.storage.get(revision.pptxKey);
    if (!bytes) return null;
    const sha = sha256Hex(bytes);
    await this.deps.db
      .update(revisions)
      .set({ contentSha256: sha })
      .where(eq(revisions.id, revision.id));
    return sha;
  }

  private after(now: Date, ms: number): string {
    return new Date(now.getTime() + ms).toISOString();
  }
}
