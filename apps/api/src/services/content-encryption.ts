import { and, type AnyColumn, asc, eq, gt, notLike, or, sql } from 'drizzle-orm';
import { isSealed, openText, SEALED_PREFIX, sealText, useDataKey } from '../crypto/content-crypto';
import { loadDataKey, type DataKey } from '../crypto/data-key';
import { loadSodium } from '../crypto/sodium';
import type { Executor } from '../db/client';
import {
  comments,
  decks,
  deletedPptxComments,
  instanceSettings,
  slideVersions,
} from '../db/schema';
import type { Logger } from '../logger';
import type { BlobStorage } from '../storage/blob-storage';
import { EncryptedBlobStorage } from '../storage/encrypted-blob-storage';

/**
 * Encryption at rest (BER-149): which key, whether it's the one the data was sealed with, and
 * sealing what was stored before.
 */

/** Rows of `instance_settings` the setup page never sees (it only reads known env names). */
const KEY_CHECK = '__data_key_check';
const BACKFILL_DONE = '__content_encrypted';
const KEY_CHECK_TEXT = 'slider-data-key-check';
/** Additional data the check value is sealed with, like an encrypted column's `table.column`. */
const KEY_CHECK_CONTEXT = `instance_settings.${KEY_CHECK}`;
/**
 * Bumped when more is encrypted or the format changes: instances that finished an older run
 * catch up. `v3`: everything rewritten into the libsodium format. `v4`: comment strokes (text
 * placed on the slide) and deck source links. `v5`: values and files sealed again with their
 * place (column, blob key) bound in as additional data.
 */
const BACKFILL_VERSION = 'v5';
const BATCH = 200;

export class WrongDataKeyError extends Error {
  constructor(keyId: string) {
    super(
      `The data key (fingerprint ${keyId}) is not the one this instance's data was encrypted with. ` +
        'Start with the original key (SLIDER_DATA_KEY, SLIDER_DATA_KEY_FILE or <DATA_DIR>/data-key) – with another one, files and comments cannot be read.',
    );
    this.name = 'WrongDataKeyError';
  }
}

/**
 * Loads the data key, makes it the active one and checks it against the instance: the first
 * start records a check value sealed with it, every later start must open that value – so a
 * changed or lost key stops the start instead of turning content unreadable.
 */
export async function setUpDataKey(
  env: NodeJS.ProcessEnv,
  dataDir: string,
  production: boolean,
  db: Executor,
  log: Logger,
): Promise<DataKey> {
  await loadSodium();
  const loaded = loadDataKey(env, dataDir);
  if (loaded.created) log.info(`Generated a data key for encryption at rest in ${loaded.file}.`);
  if (production && loaded.source === 'data-dir') {
    log.warn(
      `The data key lies in the data folder (${loaded.file}) – backups of that folder carry the key next to the files it encrypts. Keep a copy elsewhere and set SLIDER_DATA_KEY or SLIDER_DATA_KEY_FILE (see docs/self-hosting.md).`,
    );
  }
  await checkDataKey(db, loaded.key);
  useDataKey(loaded.key);
  return loaded.key;
}

export async function checkDataKey(db: Executor, key: DataKey): Promise<void> {
  const [row] = await db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, KEY_CHECK));
  if (!row) {
    await db
      .insert(instanceSettings)
      .values({ key: KEY_CHECK, value: sealText(KEY_CHECK_TEXT, KEY_CHECK_CONTEXT, key) })
      .onConflictDoNothing();
    return checkDataKey(db, key);
  }
  let opened: string | null = null;
  try {
    opened = openText(row.value, KEY_CHECK_CONTEXT, key);
  } catch {
    // another key
  }
  if (opened !== KEY_CHECK_TEXT) throw new WrongDataKeyError(key.id);
}

/** Both blob stores, encrypted with the data key. */
export const encryptedStores = (
  key: DataKey,
  stores: { storage: BlobStorage; media: BlobStorage },
) => ({
  storage: new EncryptedBlobStorage(stores.storage, key),
  media: new EncryptedBlobStorage(stores.media, key),
});

const BLOB_PREFIXES = ['decks/', 'workspaces/', 'demo/'];

/**
 * Seals everything stored before encryption, or in an older format: files in both stores and
 * the encrypted columns.
 * Runs once per instance (in the background on start); afterwards everything is written sealed.
 * Idempotent – a run cut short just starts over next time. Once a run of this version has
 * finished (now or before), the stores refuse files without encryption (`refusePlaintext`).
 */
export async function backfillContentEncryption(deps: {
  db: Executor;
  stores: EncryptedBlobStorage[];
  log: Logger;
}): Promise<void> {
  const { db, stores, log } = deps;
  const [done] = await db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, BACKFILL_DONE));
  if (done?.value === BACKFILL_VERSION) {
    for (const store of stores) store.refusePlaintext(log);
    return;
  }

  let files = 0;
  for (const store of stores) {
    for (const prefix of BLOB_PREFIXES) {
      for (const key of await store.list(prefix)) {
        if (await store.sealInPlace(key)) files++;
      }
    }
  }
  const rows = await sealRows(db);
  // The key check too, so nothing of the first format is left to read.
  const [check] = await db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, KEY_CHECK));
  if (check && !isSealed(check.value)) {
    await db
      .update(instanceSettings)
      .set({ value: sealText(openText(check.value, KEY_CHECK_CONTEXT), KEY_CHECK_CONTEXT) })
      .where(eq(instanceSettings.key, KEY_CHECK));
  }
  await db
    .insert(instanceSettings)
    .values({ key: BACKFILL_DONE, value: BACKFILL_VERSION })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: BACKFILL_VERSION } });
  for (const store of stores) store.refusePlaintext(log);
  if (files > 0 || rows > 0) {
    log.info(
      `Sealed ${files} stored files and ${rows} database rows written before encryption at rest or in an older format.`,
    );
  }
}

/**
 * Rewrites rows still holding plaintext or an older format; the encrypted column types seal them on the way. Each
 * update only applies while the row still holds what was read (compared as stored), so an edit
 * made meanwhile – a comment edited, a deck renamed or synced – is never overwritten with the
 * old text. Paged by key, so every row is looked at once even if one is left unsealed.
 */
async function sealRows(db: Executor): Promise<number> {
  const unsealed = (column: AnyColumn) =>
    and(sql`btrim(${column}) <> ''`, notLike(column, `${SEALED_PREFIX}%`));
  /** The value as stored, not opened – what the update compares against. */
  const stored = (column: AnyColumn) => sql<string | null>`${column}::text`;
  const unchanged = (column: AnyColumn, value: string | null) =>
    sql`${column}::text is not distinct from ${value}`;
  /** Plain JSON, or a sealed string of an older format. */
  const unsealedJson = (column: AnyColumn) =>
    sql`(jsonb_typeof(${column}) <> 'string' or (${column} #>> '{}') not like ${`${SEALED_PREFIX}%`})`;
  let total = 0;

  for (let after = ''; ;) {
    const batch = await db
      .select({
        id: comments.id,
        body: comments.body,
        strokes: comments.strokes,
        storedBody: stored(comments.body),
        storedStrokes: stored(comments.strokes),
      })
      .from(comments)
      .where(
        and(
          gt(comments.id, after),
          or(
            unsealed(comments.body),
            // An empty list stays a plain `[]`.
            and(sql`${comments.strokes} <> '[]'::jsonb`, unsealedJson(comments.strokes)),
          ),
        ),
      )
      .orderBy(asc(comments.id))
      .limit(BATCH);
    for (const row of batch) {
      const updated = await db
        .update(comments)
        .set({ body: row.body, strokes: row.strokes })
        .where(
          and(
            eq(comments.id, row.id),
            unchanged(comments.body, row.storedBody),
            unchanged(comments.strokes, row.storedStrokes),
          ),
        )
        .returning({ id: comments.id });
      total += updated.length;
    }
    if (batch.length < BATCH) break;
    after = batch.at(-1)!.id;
  }

  for (let after = ''; ;) {
    const batch = await db
      .select({
        id: decks.id,
        title: decks.title,
        fileName: decks.fileName,
        sourceUrl: decks.sourceUrl,
        storedTitle: stored(decks.title),
        storedFileName: stored(decks.fileName),
        storedSourceUrl: stored(decks.sourceUrl),
      })
      .from(decks)
      .where(
        and(
          gt(decks.id, after),
          or(unsealed(decks.title), unsealed(decks.fileName), unsealed(decks.sourceUrl)),
        ),
      )
      .orderBy(asc(decks.id))
      .limit(BATCH);
    for (const row of batch) {
      const updated = await db
        .update(decks)
        .set({ title: row.title, fileName: row.fileName, sourceUrl: row.sourceUrl })
        .where(
          and(
            eq(decks.id, row.id),
            unchanged(decks.title, row.storedTitle),
            unchanged(decks.fileName, row.storedFileName),
            unchanged(decks.sourceUrl, row.storedSourceUrl),
          ),
        )
        .returning({ id: decks.id });
      total += updated.length;
    }
    if (batch.length < BATCH) break;
    after = batch.at(-1)!.id;
  }

  for (let after = ''; ;) {
    const batch = await db
      .select({
        id: slideVersions.id,
        title: slideVersions.title,
        textHash: slideVersions.textHash,
        shapes: slideVersions.shapes,
        storedTitle: stored(slideVersions.title),
        storedTextHash: stored(slideVersions.textHash),
        storedShapes: stored(slideVersions.shapes),
      })
      .from(slideVersions)
      .where(
        and(
          gt(slideVersions.id, after),
          or(
            unsealed(slideVersions.title),
            unsealed(slideVersions.textHash),
            unsealedJson(slideVersions.shapes),
          ),
        ),
      )
      .orderBy(asc(slideVersions.id))
      .limit(BATCH);
    for (const row of batch) {
      const updated = await db
        .update(slideVersions)
        .set({ title: row.title, textHash: row.textHash, shapes: row.shapes })
        .where(
          and(
            eq(slideVersions.id, row.id),
            unchanged(slideVersions.title, row.storedTitle),
            unchanged(slideVersions.textHash, row.storedTextHash),
            unchanged(slideVersions.shapes, row.storedShapes),
          ),
        )
        .returning({ id: slideVersions.id });
      total += updated.length;
    }
    if (batch.length < BATCH) break;
    after = batch.at(-1)!.id;
  }

  for (let after = { deckId: '', externalId: '' }; ;) {
    const batch = await db
      .select({
        deckId: deletedPptxComments.deckId,
        externalId: deletedPptxComments.externalId,
        bodyHash: deletedPptxComments.bodyHash,
        storedBodyHash: stored(deletedPptxComments.bodyHash),
      })
      .from(deletedPptxComments)
      .where(
        and(
          sql`(${deletedPptxComments.deckId}, ${deletedPptxComments.externalId}) > (${after.deckId}, ${after.externalId})`,
          unsealed(deletedPptxComments.bodyHash),
        ),
      )
      .orderBy(asc(deletedPptxComments.deckId), asc(deletedPptxComments.externalId))
      .limit(BATCH);
    for (const row of batch) {
      const updated = await db
        .update(deletedPptxComments)
        .set({ bodyHash: row.bodyHash })
        .where(
          and(
            eq(deletedPptxComments.deckId, row.deckId),
            eq(deletedPptxComments.externalId, row.externalId),
            unchanged(deletedPptxComments.bodyHash, row.storedBodyHash),
          ),
        )
        .returning({ deckId: deletedPptxComments.deckId });
      total += updated.length;
    }
    if (batch.length < BATCH) break;
    after = batch.at(-1)!;
  }
  return total;
}
