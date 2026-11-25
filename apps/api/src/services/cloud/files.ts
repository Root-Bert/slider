import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, max, ne } from 'drizzle-orm';
import {
  CLOUD_MAX_DEPTH,
  CLOUD_UPLOAD_IN_PARTS_FROM,
  cloudExtension,
  cloudFreeName,
  cloudNameSchema,
  type CloudBatchResult,
  type CloudNode,
  type CloudUploadResult,
  type CloudVersion,
} from '@slider/shared';
import { advisoryXactLock } from '../../db/client';
import { runLater } from '../../background-work';
import {
  cloudNodes,
  cloudVersions,
  decks,
  revisions,
  type CloudNodeRow,
  type CloudVersionRow,
} from '../../db/schema';
import { ApiError, badRequest, fileTooLarge } from '../../http/errors';
import { blobKeys, putBlobStream } from '../../storage/blob-storage';
import { deleteBlobs, storageBlobs } from '../blob-deletions';
import { assertStorageFor } from '../plans';
import {
  authorIn,
  authorsOf,
  cloudContext,
  cloudMaxFileBytes,
  loadNode,
  nodeNotFound,
  type CloudCtx,
  type CloudDeps,
} from './context';
import { isDeckKey } from './blobs';
import { agentWorks, recordEvent } from './events';
import { uploadComes, uploadEnded } from './uploading';
import { insertFolder, nodeDto } from './nodes';
import { scheduleThumbnail } from './pictures';
import {
  assertDepth,
  descendantsOf,
  findByName,
  nameKeys,
  nameTaken,
  placeOf,
  resolveTarget,
  siblingsIn,
  targetName,
  type Place,
  type Target,
} from './tree';

/**
 * A file's bytes: uploads, versions („Fassungen“), copies. What goes up is stored as it is and
 * comes down byte for byte. A file put where one of the same name lies becomes its next
 * version – no „Bericht (1).pdf“ – and the earlier ones stay to look at or bring back.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

/** What the browser said it is – or, when it said nothing useful, what its name says. */
export function mimeOf(name: string, given?: string | null): string {
  const type = given?.split(';')[0]?.trim().toLowerCase();
  if (type && type !== 'application/octet-stream' && /^[\w.+-]+\/[\w.+-]+$/.test(type)) return type;
  return MIME_BY_EXTENSION[cloudExtension(name)] ?? 'application/octet-stream';
}

const placeKey = (place: Place) =>
  `cloud:${place.workspaceId}:${place.parentId ?? place.areaId ?? place.ownerId ?? ''}`;

export interface UploadSource {
  /** The bytes as they come in. */
  data: AsyncIterable<Uint8Array>;
  /** What the sender said it sends; `null` when it did not say. */
  size: number | null;
  mimeType: string | null;
  /**
   * The bytes lie stored already and stay whose they are (a presentation's file): the new file
   * points at them. Nothing is written, nothing counts against the plan, nothing is dropped.
   */
  held?: { key: string; sha256: string };
}

export interface UploadInput {
  name: string;
  parentId?: string;
  areaId?: string;
  /** The new version of this file, wherever it lies and whatever the upload is called. */
  nodeId?: string;
  keepBoth?: boolean;
  /** Folders to make on the way, `/`-separated, under the target (a dropped folder). */
  path?: string;
  /** The version the sender's change was made on, `none` for a new file: else refused. */
  ifVersion?: string;
}

const changedMeanwhile = () =>
  new ApiError(409, 'cloud_conflict', 'Die Datei wurde inzwischen an anderer Stelle geändert.');

/** The folders of `path` under `target`, made where they are missing; the innermost as target. */
async function ensurePath(
  deps: CloudDeps,
  ctx: CloudCtx,
  target: Target,
  path: string,
  userId: string,
): Promise<Target> {
  const names = path
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (names.length > CLOUD_MAX_DEPTH) throw badRequest('Der Ordner ist zu tief verschachtelt.');
  let current = target;
  for (const raw of names) {
    const name = cloudNameSchema.parse(raw);
    assertDepth(current);
    const folder = await deps.db.transaction(async (tx) => {
      await advisoryXactLock(tx, placeKey(current.place));
      const existing = findByName(await siblingsIn(tx, current.place), name);
      if (existing && existing.kind !== 'folder') throw nameTaken(name);
      return existing ?? (await insertFolder(tx, current.place, name, userId, deps.clock.now()));
    });
    current = await resolveTarget(deps, ctx, { parentId: folder.id }, 'edit');
  }
  return current;
}

/**
 * Stores an upload: a new file, or – a file of that name being there, or `nodeId` naming one –
 * its next version. The same bytes as the current version change nothing.
 */
export async function storeUpload(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
  input: UploadInput,
  source: UploadSource,
): Promise<CloudUploadResult> {
  // Known as on its way while its bytes come: who watches the place sees it before it is there.
  const coming = crypto.randomUUID();
  // What an agent writes is its own doing, not something that arrives.
  if (agentWorks()) return storeComing(deps, userId, workspaceId, input, source);
  uploadComes(
    coming,
    {
      workspaceId,
      name: input.name,
      parentId: input.parentId,
      areaId: input.areaId,
      nodeId: input.nodeId,
    },
    deps.clock.now().getTime(),
  );
  try {
    return await storeComing(deps, userId, workspaceId, input, source);
  } finally {
    uploadEnded(coming);
  }
}

async function storeComing(
  deps: CloudDeps,
  userId: string,
  workspaceId: string,
  input: UploadInput,
  source: UploadSource,
): Promise<CloudUploadResult> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  const now = deps.clock.now();
  // Without a said length nothing can be checked before the bytes are taken: only a small file
  // comes that way (a large one says its length, or comes in parts).
  const maxBytes =
    source.size === null
      ? Math.min(cloudMaxFileBytes(deps.config), CLOUD_UPLOAD_IN_PARTS_FROM)
      : cloudMaxFileBytes(deps.config);
  if (source.size !== null && source.size > maxBytes) throw fileTooLarge(maxBytes);

  let place: Place;
  let fixed: CloudNodeRow | null = null;
  if (input.nodeId) {
    const loaded = await loadNode(deps, userId, input.nodeId, 'edit');
    if (loaded.node.workspaceId !== workspaceId) throw nodeNotFound();
    if (loaded.node.kind !== 'file') throw badRequest('Ein Ordner hat keine Fassungen.');
    fixed = loaded.node;
    place = placeOf(loaded.node);
  } else {
    let target = await resolveTarget(deps, ctx, input, 'edit');
    if (input.path) target = await ensurePath(deps, ctx, target, input.path, userId);
    assertDepth(target);
    place = target.place;
  }
  const { held } = source;
  // Before a byte is taken: is there room for it at all?
  if (!held) {
    await deps.db.transaction((tx) =>
      assertStorageFor(tx, deps.config, workspaceId, source.size ?? 0, now),
    );
  }

  // The bytes go under an id of their own first – whose version they are is settled after.
  const versionId = crypto.randomUUID();
  const holdingId = fixed?.id ?? crypto.randomUUID();
  const key = held?.key ?? blobKeys.cloudVersion(workspaceId, holdingId, versionId);
  const hash = createHash('sha256');
  let size = 0;
  const counted = (async function* () {
    for await (const chunk of source.data) {
      size += chunk.byteLength;
      if (size > maxBytes) throw fileTooLarge(maxBytes);
      hash.update(chunk);
      yield chunk;
    }
  })();
  if (held) size = source.size ?? 0;
  else await putBlobStream(deps.storage, key, counted);
  const drop = async () => {
    if (!held) await deleteBlobs(deps, storageBlobs([key]));
  };
  if (source.size !== null && size !== source.size) {
    await drop();
    throw badRequest('Die Datei kam nicht vollständig an. Bitte versuch es noch einmal.');
  }
  const sha256 = held?.sha256 ?? hash.digest('hex');
  const mimeType = mimeOf(input.name, source.mimeType);

  let outcome: { row: CloudNodeRow; created: boolean; stored: boolean };
  try {
    outcome = await deps.db.transaction(async (tx) => {
      await advisoryXactLock(tx, placeKey(place));
      // Asked again where it is stored, under the workspace's lock: uploads sent side by side
      // each passed the first look.
      const room = async () => {
        if (!held) await assertStorageFor(tx, deps.config, workspaceId, size, now);
      };
      const siblings = fixed ? [] : await siblingsIn(tx, place);
      let existing = fixed;
      let name = input.name;
      if (!fixed) {
        const same = findByName(siblings, name);
        if (same && input.keepBoth) name = cloudFreeName(name, nameKeys(siblings));
        else if (same?.kind === 'folder') throw nameTaken(name);
        else existing = same;
      }
      if (existing) {
        // Read again under the lock: another upload may have just added a version.
        const [fresh] = await tx.select().from(cloudNodes).where(eq(cloudNodes.id, existing.id));
        if (!fresh || fresh.deletedAt) throw nodeNotFound();
        const [current] = fresh.currentVersionId
          ? await tx
              .select()
              .from(cloudVersions)
              .where(eq(cloudVersions.id, fresh.currentVersionId))
          : [];
        // The same bytes as it has – before the question of whose version it builds on: an
        // upload whose answer was lost and is sent again is no conflict.
        if (current && current.sha256 === sha256 && current.sizeBytes === size) {
          return { row: fresh, created: false, stored: false };
        }
        // A presentation's file is the presentation: there is one of it, changed in Slider.
        if (current && isDeckKey(current.storageKey)) {
          throw badRequest(
            'Diese Datei ist eine Präsentation in Slider. Öffne sie dort, um sie zu ändern.',
          );
        }
        if (input.ifVersion !== undefined && fresh.currentVersionId !== input.ifVersion) {
          throw changedMeanwhile();
        }
        await room();
        const [last] = await tx
          .select({ number: max(cloudVersions.number) })
          .from(cloudVersions)
          .where(eq(cloudVersions.nodeId, fresh.id));
        // Sent under a holding id that is not this file's: its bytes keep that key.
        await tx.insert(cloudVersions).values({
          id: versionId,
          nodeId: fresh.id,
          workspaceId,
          number: (last?.number ?? 0) + 1,
          storageKey: key,
          sizeBytes: size,
          sha256,
          mimeType,
          createdBy: userId,
          createdAt: now,
        });
        const [row] = await tx
          .update(cloudNodes)
          .set({
            sizeBytes: size,
            mimeType,
            currentVersionId: versionId,
            versionCount: fresh.versionCount + 1,
            thumbnail: 'none',
            updatedAt: now,
            updatedBy: userId,
          })
          .where(eq(cloudNodes.id, fresh.id))
          .returning();
        if (!row) throw new Error('Version update returned nothing');
        return { row, created: false, stored: true };
      }
      await room();
      const [row] = await tx
        .insert(cloudNodes)
        .values({
          id: holdingId,
          workspaceId,
          areaId: place.areaId,
          ownerId: place.areaId ? userId : place.ownerId,
          parentId: place.parentId,
          kind: 'file',
          name,
          extension: cloudExtension(name),
          mimeType,
          sizeBytes: size,
          currentVersionId: versionId,
          versionCount: 1,
          createdAt: now,
          updatedAt: now,
          updatedBy: userId,
        })
        .returning();
      if (!row) throw new Error('File insert returned nothing');
      await tx.insert(cloudVersions).values({
        id: versionId,
        nodeId: row.id,
        workspaceId,
        number: 1,
        storageKey: key,
        sizeBytes: size,
        sha256,
        mimeType,
        createdBy: userId,
        createdAt: now,
      });
      return { row, created: true, stored: true };
    });
  } catch (error) {
    await drop();
    throw error;
  }
  if (!outcome.stored) {
    await drop();
    return { node: await nodeDto(deps, ctx, outcome.row), created: false };
  }
  await recordEvent(
    deps.db,
    {
      kind: outcome.created ? 'uploaded' : 'version',
      actorId: userId,
      node: outcome.row,
      workspaceId,
      name: outcome.row.name,
      detail: outcome.created ? null : `Fassung ${outcome.row.versionCount}`,
    },
    now,
  );
  scheduleThumbnail(deps, outcome.row.id);
  return { node: await nodeDto(deps, ctx, outcome.row), created: outcome.created };
}

// ── Versions ────────────────────────────────────────────────────────────────

export async function toVersionDtos(
  deps: Pick<CloudDeps, 'db'>,
  node: Pick<CloudNodeRow, 'currentVersionId'>,
  rows: readonly CloudVersionRow[],
): Promise<CloudVersion[]> {
  const authors = await authorsOf(
    deps.db,
    rows.map((row) => row.createdBy),
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    createdBy: authorIn(authors, row.createdBy),
    label: row.label,
    current: row.id === node.currentVersionId,
    restoredFrom: row.restoredFrom,
  }));
}

/** A file's versions, the newest first. */
export async function versionsOf(
  deps: Pick<CloudDeps, 'db'>,
  node: CloudNodeRow,
): Promise<CloudVersion[]> {
  const rows = await deps.db
    .select()
    .from(cloudVersions)
    .where(eq(cloudVersions.nodeId, node.id))
    .orderBy(desc(cloudVersions.number));
  return toVersionDtos(deps, node, rows);
}

async function loadVersion(deps: CloudDeps, userId: string, versionId: string, edit = true) {
  const [version] = await deps.db
    .select()
    .from(cloudVersions)
    .where(eq(cloudVersions.id, versionId));
  if (!version) throw nodeNotFound();
  const loaded = await loadNode(deps, userId, version.nodeId, edit ? 'edit' : 'view');
  return { version, ...loaded };
}

/**
 * Brings an earlier version back as the newest – nothing is overwritten, the one it replaces
 * stays in the history. The bytes are not copied: the new version points at the same ones.
 */
export async function restoreVersion(
  deps: CloudDeps,
  userId: string,
  versionId: string,
): Promise<CloudNode> {
  const { version, node, ctx, access } = await loadVersion(deps, userId, versionId);
  if (version.id === node.currentVersionId) return nodeDto(deps, ctx, node, access);
  const now = deps.clock.now();
  const row = await deps.db.transaction(async (tx) => {
    const [last] = await tx
      .select({ number: max(cloudVersions.number) })
      .from(cloudVersions)
      .where(eq(cloudVersions.nodeId, node.id));
    const id = crypto.randomUUID();
    await tx.insert(cloudVersions).values({
      id,
      nodeId: node.id,
      workspaceId: node.workspaceId,
      number: (last?.number ?? 0) + 1,
      storageKey: version.storageKey,
      sizeBytes: version.sizeBytes,
      sha256: version.sha256,
      mimeType: version.mimeType,
      restoredFrom: version.number,
      createdBy: userId,
      createdAt: now,
    });
    const [updated] = await tx
      .update(cloudNodes)
      .set({
        sizeBytes: version.sizeBytes,
        mimeType: version.mimeType,
        currentVersionId: id,
        versionCount: node.versionCount + 1,
        thumbnail: 'none',
        updatedAt: now,
        updatedBy: userId,
      })
      .where(eq(cloudNodes.id, node.id))
      .returning();
    if (!updated) throw new Error('Restore returned nothing');
    return updated;
  });
  await recordEvent(
    deps.db,
    {
      kind: 'version_restored',
      actorId: userId,
      node: row,
      workspaceId: row.workspaceId,
      name: row.name,
      detail: `Fassung ${version.number}`,
      groupKey: null,
    },
    now,
  );
  scheduleThumbnail(deps, row.id);
  return nodeDto(deps, ctx, row, access);
}

/** Names a version („An den Vorstand“) – named ones stay for good – or takes the name away. */
export async function labelVersion(
  deps: CloudDeps,
  userId: string,
  versionId: string,
  label: string | null,
): Promise<CloudVersion> {
  const { version, node } = await loadVersion(deps, userId, versionId);
  const [row] = await deps.db
    .update(cloudVersions)
    .set({ label: label || null })
    .where(eq(cloudVersions.id, version.id))
    .returning();
  if (!row) throw new Error('Label returned nothing');
  if (label) {
    await recordEvent(
      deps.db,
      {
        kind: 'version_named',
        actorId: userId,
        node,
        workspaceId: node.workspaceId,
        name: node.name,
        detail: label,
        groupKey: null,
      },
      deps.clock.now(),
    );
  }
  const [dto] = await toVersionDtos(deps, node, [row]);
  if (!dto) throw new Error('A version has no DTO');
  return dto;
}

/** Deletes an earlier version for good; the current one only goes with its file. */
export async function deleteVersion(
  deps: CloudDeps,
  userId: string,
  versionId: string,
): Promise<void> {
  const { version, node } = await loadVersion(deps, userId, versionId);
  if (version.id === node.currentVersionId) {
    throw badRequest('Die aktuelle Fassung lässt sich nicht löschen – nur die Datei selbst.');
  }
  await removeVersions(deps, node, [version]);
}

/** Drops these versions and whatever bytes no other version of the file still points at. */
export async function removeVersions(
  deps: Pick<CloudDeps, 'db' | 'storage' | 'log'>,
  node: Pick<CloudNodeRow, 'id' | 'workspaceId'>,
  versions: readonly CloudVersionRow[],
): Promise<void> {
  const keys: string[] = [];
  for (const version of versions) {
    await deps.db.delete(cloudVersions).where(eq(cloudVersions.id, version.id));
    const [other] = await deps.db
      .select({ id: cloudVersions.id })
      .from(cloudVersions)
      .where(
        and(eq(cloudVersions.storageKey, version.storageKey), ne(cloudVersions.id, version.id)),
      )
      .limit(1);
    // A Markdown file's line ids lie beside it (`services/documents.ts`): they go with it.
    if (!other && !isDeckKey(version.storageKey))
      keys.push(version.storageKey, `${version.storageKey}.ids.json`);
    keys.push(
      blobKeys.cloudThumbnail(node.workspaceId, node.id, version.id),
      blobKeys.cloudPreview(node.workspaceId, node.id, version.id),
      blobKeys.cloudPreviewAsDeck(node.workspaceId, node.id, version.id),
    );
  }
  await deps.db
    .update(cloudNodes)
    .set({ versionCount: await versionCount(deps, node.id) })
    .where(eq(cloudNodes.id, node.id));
  await deleteBlobs(deps, storageBlobs(keys));
}

async function versionCount(deps: Pick<CloudDeps, 'db'>, nodeId: string): Promise<number> {
  const rows = await deps.db
    .select({ id: cloudVersions.id })
    .from(cloudVersions)
    .where(eq(cloudVersions.nodeId, nodeId));
  return rows.length;
}

// ── A presentation's file ───────────────────────────────────────────────────
/*
 * A presentation has one file, Slider's (`revisions.pptx_key`, a new one with every step). Its
 * file in Cloud holds no bytes of its own: its version points at that file. `followDeckFile`
 * moves the pointer when the presentation changed – a while after each step
 * (`scheduleDeckFile`) and whenever the file is read (`versionToServe`) – and `standAlone` gives
 * the file bytes of its own where the two part (the presentation deleted, the file taken into
 * someone else's own files).
 */

const DECK_FILE_DELAY_MS = 3000;
const deckFileDue = new Map<string, symbol>();

type FileDeps = Pick<CloudDeps, 'db' | 'storage' | 'clock' | 'log'>;

/**
 * Points `nodeId`'s file at its presentation's file as it is now, as its newest version; the
 * ones before that pointed at earlier steps go, and one with the very same bytes (the upload a
 * presentation was made of). Answers that version – `null` where the file is no presentation's.
 */
export async function followDeckFile(
  deps: FileDeps,
  nodeId: string,
): Promise<CloudVersionRow | null> {
  const [found] = await deps.db
    .select({ key: revisions.pptxKey, node: cloudNodes })
    .from(decks)
    .innerJoin(revisions, eq(revisions.id, decks.currentRevisionId))
    .innerJoin(cloudNodes, eq(cloudNodes.id, decks.cloudNodeId))
    .where(
      and(eq(decks.cloudNodeId, nodeId), isNull(decks.deletedAt), eq(decks.isTemplate, false)),
    );
  if (!found?.key || found.node.kind !== 'file') return null;
  const { key, node } = found;
  const versions = await deps.db
    .select()
    .from(cloudVersions)
    .where(eq(cloudVersions.nodeId, node.id));
  const current = versions.find((each) => each.id === node.currentVersionId) ?? null;
  if (current?.storageKey === key) return current;
  const bytes = await deps.storage.get(key);
  if (!bytes) return current;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const now = deps.clock.now();
  const id = crypto.randomUUID();
  try {
    await deps.db.transaction(async (tx) => {
      await tx.insert(cloudVersions).values({
        id,
        nodeId: node.id,
        workspaceId: node.workspaceId,
        number: Math.max(0, ...versions.map((each) => each.number)) + 1,
        storageKey: key,
        sizeBytes: bytes.byteLength,
        sha256,
        mimeType: node.mimeType,
        createdBy: node.updatedBy,
        createdAt: now,
      });
      await tx
        .update(cloudNodes)
        .set({
          sizeBytes: bytes.byteLength,
          currentVersionId: id,
          thumbnail: 'none',
          updatedAt: now,
        })
        .where(eq(cloudNodes.id, node.id));
    });
  } catch (error) {
    // Two at once: the other one moved it.
    deps.log.warn(`Cloud file ${node.id} not pointed at its presentation: ${String(error)}`);
    return current;
  }
  await removeVersions(
    deps,
    node,
    versions.filter((each) => isDeckKey(each.storageKey) || each.sha256 === sha256),
  );
  const [row] = await deps.db.select().from(cloudVersions).where(eq(cloudVersions.id, id));
  return row ?? current;
}

/** {@link followDeckFile} a while after the presentation's last step, with a new small picture. */
export function scheduleDeckFile(
  deps: FileDeps & Partial<Pick<CloudDeps, 'config' | 'background'>>,
  deckId: string,
): void {
  const turn = Symbol(deckId);
  deckFileDue.set(deckId, turn);
  runLater(deps, DECK_FILE_DELAY_MS, async () => {
    if (deckFileDue.get(deckId) !== turn) return;
    deckFileDue.delete(deckId);
    try {
      const [deck] = await deps.db
        .select({ nodeId: decks.cloudNodeId })
        .from(decks)
        .where(eq(decks.id, deckId));
      if (!deck?.nodeId) return;
      const before = await deps.db
        .select({ id: cloudNodes.currentVersionId })
        .from(cloudNodes)
        .where(eq(cloudNodes.id, deck.nodeId));
      const version = await followDeckFile(deps, deck.nodeId);
      // The importer runs without the server's settings: the picture comes with the next step.
      if (version && version.id !== before[0]?.id && deps.config) {
        scheduleThumbnail({ ...deps, config: deps.config }, deck.nodeId);
      }
    } catch (error) {
      deps.log.warn(`Cloud file of presentation ${deckId} not brought along`, error);
    }
  });
}

/**
 * The file and its presentation part: what pointed at the presentation's file gets bytes of its
 * own (the same ones), and is a file like any other from then on.
 */
export async function standAlone(deps: FileDeps, nodeId: string): Promise<void> {
  const versions = await deps.db
    .select()
    .from(cloudVersions)
    .where(eq(cloudVersions.nodeId, nodeId));
  for (const version of versions) {
    if (!isDeckKey(version.storageKey)) continue;
    const bytes = await deps.storage.get(version.storageKey);
    if (!bytes) continue;
    const key = blobKeys.cloudVersion(version.workspaceId, nodeId, version.id);
    await deps.storage.put(key, bytes);
    await deps.db
      .update(cloudVersions)
      .set({ storageKey: key })
      .where(eq(cloudVersions.id, version.id));
  }
}

/** The version to serve: the one asked for, or the file's current one. */
export async function versionToServe(
  deps: FileDeps,
  node: CloudNodeRow,
  versionId?: string | null,
): Promise<CloudVersionRow> {
  if (!versionId && node.kind === 'file') {
    // A presentation's file: as the presentation is now.
    const followed = await followDeckFile(deps, node.id);
    if (followed) return followed;
  }
  const id = versionId || node.currentVersionId;
  if (node.kind !== 'file' || !id) throw nodeNotFound();
  const [version] = await deps.db
    .select()
    .from(cloudVersions)
    .where(and(eq(cloudVersions.id, id), eq(cloudVersions.nodeId, node.id)));
  if (!version) throw new ApiError(404, 'not_found', 'Diese Fassung gibt es nicht (mehr).');
  return version;
}

// ── Copies ──────────────────────────────────────────────────────────────────

async function* webStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** A copy of a file's current version in `place`, as a file of its own with one version. */
async function copyFile(
  deps: CloudDeps,
  source: CloudNodeRow,
  place: Place,
  name: string,
  userId: string,
): Promise<CloudNodeRow> {
  const version = await versionToServe(deps, source);
  const data = await deps.storage.stream(version.storageKey);
  if (!data) throw nodeNotFound();
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const key = blobKeys.cloudVersion(place.workspaceId, id, versionId);
  await putBlobStream(deps.storage, key, webStream(data));
  const now = deps.clock.now();
  try {
    return await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(cloudNodes)
        .values({
          id,
          workspaceId: place.workspaceId,
          areaId: place.areaId,
          ownerId: place.areaId ? userId : place.ownerId,
          parentId: place.parentId,
          kind: 'file',
          name,
          extension: cloudExtension(name),
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
          currentVersionId: versionId,
          versionCount: 1,
          createdAt: now,
          updatedAt: now,
          updatedBy: userId,
        })
        .returning();
      if (!row) throw new Error('Copy insert returned nothing');
      await tx.insert(cloudVersions).values({
        id: versionId,
        nodeId: id,
        workspaceId: place.workspaceId,
        number: 1,
        storageKey: key,
        sizeBytes: version.sizeBytes,
        sha256: version.sha256,
        mimeType: version.mimeType,
        createdBy: userId,
        createdAt: now,
      });
      return row;
    });
  } catch (error) {
    await deleteBlobs(deps, storageBlobs([key]));
    throw error;
  }
}

/** Copies files and folders (with everything in them) into a folder, an area or one's own files. */
export async function copyNodes(
  deps: CloudDeps,
  userId: string,
  input: { ids: string[]; parentId?: string | null; areaId?: string | null },
): Promise<CloudBatchResult> {
  const nodes: CloudNode[] = [];
  const skipped: CloudBatchResult['skipped'] = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      const { node, ctx } = await loadNode(deps, userId, id);
      const target = await resolveTarget(deps, ctx, input, 'edit');
      assertDepth(target);
      const inside = node.kind === 'folder' ? await descendantsOf(deps.db, [node.id]) : [];
      const bytes = [node, ...inside].reduce((sum, each) => sum + each.sizeBytes, 0);
      await deps.db.transaction((tx) =>
        assertStorageFor(tx, deps.config, node.workspaceId, bytes, deps.clock.now()),
      );
      const siblings = await siblingsIn(deps.db, target.place);
      const name = cloudFreeName(node.name, nameKeys(siblings));
      let copy: CloudNodeRow;
      if (node.kind === 'file') {
        copy = await copyFile(deps, node, target.place, name, userId);
        scheduleThumbnail(deps, copy.id);
      } else {
        copy = await insertFolder(deps.db, target.place, name, userId, deps.clock.now());
        // Folder by folder, outermost first: each copy's children find their new parent.
        const copies = new Map([[node.id, copy]]);
        for (const child of inside) {
          const parent = copies.get(child.parentId ?? '');
          if (!parent) continue;
          const place = { ...placeOf(parent), parentId: parent.id };
          if (child.kind === 'folder') {
            copies.set(
              child.id,
              await insertFolder(deps.db, place, child.name, userId, deps.clock.now()),
            );
          } else {
            const made = await copyFile(deps, child, place, child.name, userId);
            scheduleThumbnail(deps, made.id);
          }
        }
      }
      await recordEvent(
        deps.db,
        {
          kind: 'copied',
          actorId: userId,
          node: copy,
          workspaceId: copy.workspaceId,
          name: copy.name,
          detail: targetName(target),
        },
        deps.clock.now(),
      );
      nodes.push(await nodeDto(deps, ctx, copy, target.access));
    } catch (error) {
      if (!(error instanceof Error) || !('status' in error)) throw error;
      skipped.push({ id, name: '', reason: error.message });
    }
  }
  return { nodes, skipped };
}
