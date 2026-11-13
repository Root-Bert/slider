import { and, desc, eq, exists, isNull, max } from 'drizzle-orm';
import type { SyncError, SyncResult } from '@slider/shared';
import type { Clock } from '../clock';
import type { Config } from '../config';
import type { Database } from '../db/client';
import {
  decks,
  nextcloudConnections,
  revisions,
  workspaceMembers,
  type DeckRow,
  type DeckSyncStateRow,
  type RevisionRow,
} from '../db/schema';
import { ApiError, notFound } from '../http/errors';
import { toDeckBytes } from '../import/any-file';
import { deckFileExtension } from '../import/odp-deck';
import { pdfMakerOf } from '../import/pdf-maker';
import { sha256Hex } from '../import/common';
import type { DocumentToPdf } from '../import/libreoffice';
import type { ImportJob, JobQueue } from '../import/queue';
import type { Logger } from '../logger';
import { isSyncEnabled } from '../services/deck-sync';
import { assertStorageFor, assertWithinLimits } from '../services/plans';
import {
  readContributors,
  type RemoteFile,
  type SourceAdapter,
  type SourceAdapters,
  type SourceContext,
} from '../sources/source-adapter';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import { loginUrlOfDeck, ownerLeftMessage, storageFullMessage, toSyncError } from './errors';
import { healthyCheck, mergeSyncState } from './state';

/** A pull waits this long for the import before answering `queued`. */
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
  config: Pick<Config, 'plans'>;
  /** LibreOffice for Word, Excel and text files (see `toDeckBytes`); absent → none of those. */
  documentPdf?: DocumentToPdf | null;
  /** How long a pull waits for its import; {@link SYNC_MANUAL_WAIT_MS} unless a test says. */
  waitMs?: number;
}

type Remote = { adapter: SourceAdapter; file: RemoteFile; context: SourceContext };

/**
 * Pulls a link-imported deck's file from its source, only when asked ("Neu rendern"): nothing
 * polls. A deck lives in Slider once imported. `checkDeck` compares the source's change token
 * with the current revision's and imports a new file as a new revision. Idempotent: the same
 * token never creates a second revision, and identical bytes under a new token only record the
 * token. A deck edited in Slider is not pulled over (`edit_conflict`).
 *
 * Errors never touch the current revision; they end up in `decks.sync_state` for a banner.
 */
export class SyncService {
  /** One check per deck at a time; concurrent callers share it. */
  private readonly inFlight = new Map<string, Promise<SyncResult>>();

  constructor(private readonly deps: SyncServiceDeps) {}

  checkDeck(deckId: string): Promise<SyncResult> {
    return this.exclusive(deckId, () => this.check(deckId));
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
        const kind = current?.pptxKey?.slice(current.pptxKey.lastIndexOf('.') + 1);
        if (kind && kind !== deckFileExtension(bytes)) {
          throw new ApiError(
            400,
            'not_a_powerpoint',
            kind === 'pdf'
              ? 'Diese Präsentation kam als PDF – bitte auch die neue Version als PDF hochladen.'
              : kind === 'odp'
                ? 'Diese Präsentation kam als ODP – bitte auch die neue Version als .odp hochladen.'
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
        return this.createRevision(deck, { bytes, sha: sourceSha }, null, 'upload');
      },
      { join: false },
    );
  }

  /**
   * Serialises work per deck. By default a caller joins a running call; with `join: false` it
   * always queues behind.
   */
  private exclusive(
    deckId: string,
    work: () => Promise<SyncResult>,
    { join = true }: { join?: boolean } = {},
  ): Promise<SyncResult> {
    const running = this.inFlight.get(deckId);
    if (join && running) return running;
    const before = running ? running.catch(() => undefined) : Promise.resolve();
    const promise = before.then(work).finally(() => {
      if (this.inFlight.get(deckId) === promise) this.inFlight.delete(deckId);
    });
    this.inFlight.set(deckId, promise);
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

  private async check(deckId: string): Promise<SyncResult> {
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
    // Pulling goes by the owner's accounts: never with someone who left the workspace (their
    // linked decks are deleted then, see `departDecks`; this catches decks from before).
    if (!(await this.ownerIsMember(deck))) return this.ownerLeft(deck, now);
    // Over the plan's limits nothing new comes in (BER-155): "Neu rendern" says why.
    await assertWithinLimits(this.deps.db, this.deps.config, deck.workspaceId, now);
    const state = deck.syncState;
    // `isSyncEnabled` lets only Nextcloud and plain links through.
    const adapter: SourceAdapter = this.deps.sources[deck.source as 'nextcloud' | 'url'];
    const file: RemoteFile = {
      ref: deck.sourceRef,
      fileName: deck.fileName,
      sizeBytes: 0,
      changeToken: null,
    };

    try {
      // Through the deck's Nextcloud connection – or, without one, the first of the owner's that
      // has access; the rest of the check goes through the same one.
      const readToken = (context: SourceContext) => adapter.getChangeToken(file, context);
      const changed =
        deck.source === 'nextcloud'
          ? await this.throughOwnConnection(deck, readToken)
          : { value: await readToken({ userId: deck.ownerId }), context: { userId: deck.ownerId } };
      const remote: Remote = { adapter, file, context: changed.context };
      let token = changed.value;
      // Decks linked before contributors were recorded learn them now; the rest with a revision.
      const knowsContributors = deck.sourceContributors !== null;
      if (!knowsContributors) await this.refreshContributors(deck, remote);
      let baseline = current.sourceChangeToken;
      let downloaded: Downloaded | null = null;

      if (token === '') {
        // No ETag/cTag: compare the content itself.
        downloaded = await this.download(remote);
        token = CONTENT_TOKEN_PREFIX + downloaded.sha;
        const sha = await this.revisionSha(current);
        baseline = sha ? CONTENT_TOKEN_PREFIX + sha : null;
      }

      if (baseline !== null && token === baseline) {
        await mergeSyncState(this.deps.db, deckId, healthyCheck(now));
        return { status: 'unchanged' };
      }

      // Edited in Slider (BER-180): a new file from the source must not replace the edits.
      if (current.editSeq !== current.savedSeq) {
        await mergeSyncState(this.deps.db, deckId, healthyCheck(now));
        throw new ApiError(
          409,
          'edit_conflict',
          'Die Datei in der Quelle hat sich geändert, aber diese Präsentation wurde in Slider bearbeitet. Die neue Version wird nicht übernommen, damit die Änderungen bleiben.',
        );
      }

      // The workspace's storage is full (BER-151): no new version comes in until there is room.
      // A version found too big before waits for room for its own size, without a new download.
      const blockedBytes = state.storageBlocked?.token === token ? state.storageBlocked.bytes : 0;
      if (await this.storageFull(deck, blockedBytes, now)) {
        return await this.storageBlocked(deck, now);
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
        await mergeSyncState(this.deps.db, deckId, healthyCheck(now));
        return { status: 'unchanged' };
      }
      // Room left, but not for this file: it waits the same way.
      if (await this.storageFull(deck, bytes.byteLength, now)) {
        return await this.storageBlocked(deck, now, { token, bytes: bytes.byteLength });
      }
      if (knowsContributors) await this.refreshContributors(deck, remote);
      const size = bytes.byteLength;
      return await this.createRevision(deck, downloaded, realToken, 'manual').catch(
        (error: unknown) => {
          // Another upload took the rest meanwhile (the binding check, under the lock): it waits
          // the same way.
          if (error instanceof ApiError && error.code === 'plan_limit') {
            return this.storageBlocked(deck, now, { token, bytes: size });
          }
          throw error;
        },
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'edit_conflict') throw error;
      return this.fail(deck, error, now);
    }
  }

  /** Stores the file as a pending revision and queues its import. */
  private async createRevision(
    deck: DeckRow,
    { bytes, sha }: Downloaded,
    token: string | null,
    trigger: 'manual' | 'upload',
  ): Promise<SyncResult> {
    const { db, storage, clock, queue } = this.deps;
    const revisionId = crypto.randomUUID();
    const pptxKey = blobKeys.pptx(deck.id, revisionId, deckFileExtension(bytes));
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
          ...(trigger === 'upload' ? {} : healthyCheck(now)),
          // Keep an earlier error visible until the import succeeded.
          ...(deck.syncState.lastSyncError ? { lastSyncError: deck.syncState.lastSyncError } : {}),
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

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.deps.waitMs ?? SYNC_MANUAL_WAIT_MS);
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
    const loginUrl = stored.code === 'auth_required' ? loginUrlOfDeck(deck) : undefined;
    return { ...stored, ...(loginUrl ? { loginUrl } : {}) };
  }

  private async fail(deck: DeckRow, error: unknown, now: Date): Promise<SyncResult> {
    const loginUrl = loginUrlOfDeck(deck);
    const { error: syncError, expected } = toSyncError(error, deck.id, now, {
      ...(loginUrl ? { loginUrl } : {}),
    });
    if (!expected) this.deps.log.error(`Sync check of deck ${deck.id} failed`, error);
    else this.deps.log.warn(`Sync check of deck ${deck.id}: ${syncError.code}`);
    await mergeSyncState(this.deps.db, deck.id, {
      lastCheckedAt: now.toISOString(),
      lastSyncError: { code: syncError.code, message: syncError.message, at: syncError.at },
    }).catch(() => {});
    return { status: 'error', error: syncError };
  }

  /**
   * Nextcloud decks read through their own connection, else through the owner's other accounts
   * at the file's server, also when the own one lost access (the adapter tries them) –
   * remembering the one that worked, unless the deck changed connection meanwhile.
   */
  private async throughOwnConnection<T>(
    deck: DeckRow,
    run: (context: SourceContext) => Promise<T>,
  ): Promise<{ value: T; context: SourceContext }> {
    const connections = nextcloudConnections;
    const own = deck.nextcloudConnectionId;
    const context: SourceContext = { userId: deck.ownerId, nextcloudConnectionId: own };
    const value = await run(context);
    const used = context.nextcloudConnectionId;
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
                .select({ id: connections.id })
                .from(connections)
                .where(eq(connections.id, used)),
            ),
          ),
        );
    }
    return { value, context };
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
   * and the next pull tries again once something was deleted or the plan upgraded.
   */
  private async storageBlocked(
    deck: DeckRow,
    now: Date,
    storageBlocked?: DeckSyncStateRow['storageBlocked'],
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
      lastSyncError: error,
      ...(storageBlocked ? { storageBlocked } : {}),
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
}
