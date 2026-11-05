import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  extensionOf,
  materialKindOf,
  type AddMaterialInput,
  type Board,
  type BoardFrame,
  type BoardItem,
  type CreateBoardItemInput,
  type Material,
  type MaterialKind,
  type MoveBoardInput,
  type UpdateBoardItemInput,
  type Viewer,
} from '@slider/shared';
import { deckAccess, requireDeckAccess } from '../auth/access';
import {
  deckBoardItems,
  deckMaterials,
  type DeckBoardItemRow,
  type DeckMaterialRow,
} from '../db/schema';
import { advisoryXactLock } from '../db/client';
import type { AppDeps } from '../deps';
import { badRequest, fileTooLarge, forbidden, notFound } from '../http/errors';
import { blobKeys } from '../storage/blob-storage';
import { deleteBlobs } from './blob-deletions';
import { extractLater } from './material-extract';
import { assertStorageFor, assertWithinLimits } from './plans';

/*
 * The board of a deck – Folie 0, „Material“: files, notes and links lying on a free surface
 * before slide 1. Never part of the deck's file. Everyone who sees the deck sees the board;
 * whoever may comment puts things down, moves them and deletes their own; whoever manages the
 * deck deletes anyone's (as comments). Every change is told to the others at once
 * (`LiveHub.boardChanged`). Files come over tus (`purpose material`), their text is read in the
 * background (`material-extract.ts`) for the AI's tools (`material-tools.ts`).
 */

export const materialUrl = (id: string) => `/api/materials/${id}/file`;
export const materialPreviewUrl = (id: string) => `/api/materials/${id}/preview`;

export function toMaterialDto(row: DeckMaterialRow): Material {
  return {
    id: row.id,
    deckId: row.deckId,
    author: row.author,
    name: row.name,
    kind: row.kind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: materialUrl(row.id),
    previewUrl: row.previewKey ? materialPreviewUrl(row.id) : null,
    readState: row.readState,
    pages: row.pages,
    sheets: row.sheets,
    expanded: row.expanded,
    folderId: row.folderId ?? null,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    createdAt: row.createdAt.toISOString(),
  };
}

export const toBoardItemDto = (row: DeckBoardItemRow): BoardItem => ({
  id: row.id,
  deckId: row.deckId,
  author: row.author,
  kind: row.kind,
  text: row.text,
  url: row.url ?? null,
  boundIds: row.boundIds,
  color: row.color ?? null,
  rich: (row.rich as Record<string, unknown> | null) ?? null,
  x: row.x,
  y: row.y,
  w: row.w,
  h: row.h,
  createdAt: row.createdAt.toISOString(),
});

/** Everything on the board, oldest first (newer cards lie over older ones). */
export async function getBoard(deps: AppDeps, viewer: Viewer, deckId: string): Promise<Board> {
  await requireDeckAccess(deps, viewer, deckId, 'view');
  const [materials, items] = await Promise.all([
    deps.db
      .select()
      .from(deckMaterials)
      .where(eq(deckMaterials.deckId, deckId))
      .orderBy(asc(deckMaterials.createdAt), asc(deckMaterials.id)),
    deps.db
      .select()
      .from(deckBoardItems)
      .where(eq(deckBoardItems.deckId, deckId))
      .orderBy(asc(deckBoardItems.createdAt), asc(deckBoardItems.id)),
  ]);
  return { materials: materials.map(toMaterialDto), items: items.map(toBoardItemDto) };
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** A picture browsers show, by its bytes; `null` for anything else. */
function sniffImage(bytes: Uint8Array): keyof typeof IMAGE_TYPES | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  return null;
}

const isZip = (bytes: Uint8Array) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
const isOle = (bytes: Uint8Array) => startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);

const TEXT_TYPES: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
};

const OFFICE_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  ppt: 'application/vnd.ms-powerpoint',
  odp: 'application/vnd.oasis.opendocument.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

/**
 * What the file is: by its name, checked against its bytes – a name promising a picture, a PDF
 * or an Office file whose bytes are none is stored as „other“ (never read, never shown inline).
 */
export function classifyMaterial(
  name: string,
  bytes: Uint8Array,
): { kind: MaterialKind; mimeType: string } {
  const extension = extensionOf(name);
  const byName = materialKindOf(name);
  const other = { kind: 'other' as const, mimeType: 'application/octet-stream' };
  const image = sniffImage(bytes);
  if (image) return { kind: 'image', mimeType: IMAGE_TYPES[image]! };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46]))
    return { kind: 'pdf', mimeType: 'application/pdf' };
  if (byName === 'document' || byName === 'presentation' || byName === 'spreadsheet') {
    const text = extension === 'csv' || extension === 'tsv' || extension === 'rtf';
    if (text || isZip(bytes) || isOle(bytes)) {
      return {
        kind: byName,
        mimeType: OFFICE_TYPES[extension] ?? TEXT_TYPES[extension] ?? 'application/octet-stream',
      };
    }
    return other;
  }
  if (byName === 'text') return { kind: 'text', mimeType: TEXT_TYPES[extension] ?? 'text/plain' };
  return other;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
}

/** File names as shown: no path, no control characters, not endless. */
const cleanName = (name: string) =>
  [...(name.split(/[\\/]/).pop() ?? '')]
    .filter((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .slice(0, 255) || 'Datei';

/** A completed upload retried after its response was lost, even after tus cleanup. */
export async function retriedMaterial(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  id: string,
): Promise<Material | null> {
  await requireDeckAccess(deps, viewer, deckId, 'comment');
  const [row] = await deps.db.select().from(deckMaterials).where(eq(deckMaterials.id, id));
  if (!row) return null;
  if (row.deckId !== deckId || row.author.id !== viewer.author.id)
    throw badRequest('Dieses Material gibt es schon.');
  return toMaterialDto(row);
}

/**
 * Puts a file on the board at `input`'s place. Sent again under the same id (its answer lost),
 * the file saved first is the answer. Its text is read afterwards (`readState` `pending`).
 */
export async function addMaterial(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: AddMaterialInput,
  file: { name: string; bytes: Uint8Array<ArrayBuffer> },
): Promise<{ material: Material; created: boolean }> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'comment');
  const again = await retriedMaterial(deps, viewer, deckId, input.id);
  if (again) return { material: again, created: false };
  await assertWithinLimits(deps.db, deps.config, deck.workspaceId, deps.clock.now());
  if (input.folderId) {
    const [folder] = await deps.db
      .select({ kind: deckBoardItems.kind })
      .from(deckBoardItems)
      .where(and(eq(deckBoardItems.id, input.folderId), eq(deckBoardItems.deckId, deckId)));
    if (folder?.kind !== 'folder') throw notFound('Diesen Ordner gibt es nicht (mehr).');
  }
  const size = file.bytes.byteLength;
  if (size === 0) throw badRequest('Die Datei ist leer.');
  if (size > deps.config.maxUploadBytes) throw fileTooLarge(deps.config.maxUploadBytes);
  const name = cleanName(file.name);
  const { kind, mimeType } = classifyMaterial(name, file.bytes);
  const storageKey = blobKeys.material(deckId, `${input.id}-${crypto.randomUUID()}`);
  await deps.db.transaction((tx) =>
    assertStorageFor(tx, deps.config, deck.workspaceId, size, deps.clock.now()),
  );
  await deps.media.put(storageKey, file.bytes);
  try {
    const now = deps.clock.now();
    const result = await deps.db.transaction(async (tx) => {
      await advisoryXactLock(tx, `material:${input.id}`);
      const [again] = await tx.select().from(deckMaterials).where(eq(deckMaterials.id, input.id));
      if (again) {
        if (again.deckId !== deckId || again.author.id !== viewer.author.id)
          throw badRequest('Dieses Material gibt es schon.');
        return { row: again, created: false };
      }
      await assertStorageFor(tx, deps.config, deck.workspaceId, size, now);
      const [inserted] = await tx
        .insert(deckMaterials)
        .values({
          id: input.id,
          deckId,
          author: viewer.author,
          name,
          kind,
          mimeType,
          sizeBytes: size,
          storageKey,
          sha256: await sha256Hex(file.bytes),
          x: input.x,
          y: input.y,
          w: input.w,
          h: input.h,
          folderId: input.folderId ?? null,
          // Pictures have no text, but a small picture is made of them all the same.
          readState: kind === 'image' || kind === 'other' ? 'none' : 'pending',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      // Into its folder – appended where it is stored, as files of one folder arrive side by side.
      if (input.folderId)
        await tx
          .update(deckBoardItems)
          .set({
            boundIds: sql`${deckBoardItems.boundIds} || ${JSON.stringify([input.id])}::jsonb`,
          })
          .where(eq(deckBoardItems.id, input.folderId));
      return { row: inserted!, created: true };
    });
    const { row, created } = result;
    if (!created) {
      await deleteBlobs(deps, [{ store: 'media', key: storageKey, prefix: false }]);
      return { material: toMaterialDto(row), created: false };
    }
    deps.live?.boardChanged(deckId);
    if (row.kind !== 'other') extractLater(deps, row.id);
    return { material: toMaterialDto(row), created: true };
  } catch (error) {
    await deps.media.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

/** A note or a link put on the board; sent again under its id, the one saved first. */
export async function createBoardItem(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: CreateBoardItemInput & { id: string; text: string; url: string | null },
): Promise<{ item: BoardItem; created: boolean }> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'comment');
  const [again] = await deps.db
    .select()
    .from(deckBoardItems)
    .where(eq(deckBoardItems.id, input.id));
  if (again) {
    if (again.deckId !== deckId || again.author.id !== viewer.author.id)
      throw badRequest('Diese Notiz gibt es schon.');
    return { item: toBoardItemDto(again), created: false };
  }
  await assertWithinLimits(deps.db, deps.config, deck.workspaceId, deps.clock.now());
  if (input.kind === 'link' && !input.url) throw badRequest('Ein Link braucht eine Adresse.');
  if (input.kind !== 'link' && input.url) throw badRequest('Nur ein Link hat eine Adresse.');
  const boundIds = [...new Set(input.boundIds ?? [])];
  if (boundIds.length > 0) {
    // What it hangs on lies on this board.
    const [files, items] = await Promise.all([
      deps.db
        .select({ id: deckMaterials.id })
        .from(deckMaterials)
        .where(and(eq(deckMaterials.deckId, deckId), inArray(deckMaterials.id, boundIds))),
      deps.db
        .select({ id: deckBoardItems.id })
        .from(deckBoardItems)
        .where(and(eq(deckBoardItems.deckId, deckId), inArray(deckBoardItems.id, boundIds))),
    ]);
    if (files.length + items.length < boundIds.length)
      throw notFound('Woran die Notiz hängt, gibt es nicht (mehr).');
  }
  const now = deps.clock.now();
  const [row] = await deps.db
    .insert(deckBoardItems)
    .values({
      id: input.id,
      deckId,
      author: viewer.author,
      kind: input.kind,
      text: input.text,
      url: input.url,
      boundIds,
      color: input.color ?? null,
      rich: input.rich ?? null,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  deps.live?.boardChanged(deckId);
  return { item: toBoardItemDto(row!), created: true };
}

/** A note's text or a link changed – by its author, as with comments. */
export async function updateBoardItem(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  itemId: string,
  input: UpdateBoardItemInput,
): Promise<BoardItem> {
  await requireDeckAccess(deps, viewer, deckId, 'comment');
  const [row] = await deps.db
    .select()
    .from(deckBoardItems)
    .where(and(eq(deckBoardItems.id, itemId), eq(deckBoardItems.deckId, deckId)));
  if (!row) throw notFound('Diese Notiz gibt es nicht (mehr).');
  // Its text and address only by its author; what a frame holds by anyone who moves things.
  if (
    (input.text !== undefined ||
      input.url !== undefined ||
      input.color !== undefined ||
      input.rich !== undefined) &&
    row.author.id !== viewer.author.id
  )
    throw forbidden('Nur eigene Notizen und Links können geändert werden.');
  if (input.url !== undefined && row.kind !== 'link')
    throw badRequest('Eine Notiz hat keine Adresse.');
  if (input.boundIds !== undefined && row.kind !== 'box' && row.kind !== 'folder')
    throw badRequest('Nur eine Box oder ein Ordner nimmt Dinge auf.');
  const boundIds =
    input.boundIds === undefined ? undefined : await existingOnBoard(deps, deckId, input.boundIds);
  const [updated] = await deps.db
    .update(deckBoardItems)
    .set({
      ...(input.text !== undefined && { text: input.text }),
      ...(input.url !== undefined && { url: input.url }),
      ...(boundIds !== undefined && { boundIds }),
      ...(input.color !== undefined && { color: input.color }),
      ...(input.rich !== undefined && { rich: input.rich }),
      updatedAt: deps.clock.now(),
    })
    .where(eq(deckBoardItems.id, itemId))
    .returning();
  deps.live?.boardChanged(deckId);
  return toBoardItemDto(updated!);
}

/** The ids of `ids` that lie on the deck's board (files or items), in their order, once each. */
async function existingOnBoard(deps: AppDeps, deckId: string, ids: readonly string[]) {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return [];
  const [files, items] = await Promise.all([
    deps.db
      .select({ id: deckMaterials.id })
      .from(deckMaterials)
      .where(and(eq(deckMaterials.deckId, deckId), inArray(deckMaterials.id, wanted))),
    deps.db
      .select({ id: deckBoardItems.id })
      .from(deckBoardItems)
      .where(and(eq(deckBoardItems.deckId, deckId), inArray(deckBoardItems.id, wanted))),
  ]);
  const there = new Set([...files, ...items].map((each) => each.id));
  return wanted.filter((id) => there.has(id));
}

/**
 * Items moved or resized together – files, notes and links, anyone's (moving is not changing).
 * Ids no longer on the board (deleted meanwhile) are passed over.
 */
export async function moveBoard(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  { frames }: MoveBoardInput,
): Promise<void> {
  await requireDeckAccess(deps, viewer, deckId, 'comment');
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    for (const { id, ...frame } of frames) {
      const values: BoardFrame & { updatedAt: Date } = { ...frame, updatedAt: now };
      const moved = await tx
        .update(deckMaterials)
        .set(values)
        .where(and(eq(deckMaterials.id, id), eq(deckMaterials.deckId, deckId)))
        .returning({ id: deckMaterials.id });
      if (moved.length > 0) continue;
      await tx
        .update(deckBoardItems)
        .set(values)
        .where(and(eq(deckBoardItems.id, id), eq(deckBoardItems.deckId, deckId)));
    }
  });
  deps.live?.boardChanged(deckId);
}

/**
 * Takes items off the board: one's own with comment rights, anyone's with manage rights (as
 * comments). A file's bytes, small picture and text go with it. Already gone: nothing to do.
 */
export async function deleteBoardItem(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  itemId: string,
): Promise<void> {
  const { permissions } = await deckAccess(deps, viewer, deckId, 'view');
  const [material] = await deps.db
    .select()
    .from(deckMaterials)
    .where(and(eq(deckMaterials.id, itemId), eq(deckMaterials.deckId, deckId)));
  const [item] = material
    ? []
    : await deps.db
        .select()
        .from(deckBoardItems)
        .where(and(eq(deckBoardItems.id, itemId), eq(deckBoardItems.deckId, deckId)));
  const found = material ?? item;
  if (!found) return;
  const own = found.author.id === viewer.author.id;
  if (!permissions.canManage && !(own && permissions.canComment)) {
    throw forbidden('Nur eigenes Material kann gelöscht werden.');
  }
  if (material) {
    await deps.db.delete(deckMaterials).where(eq(deckMaterials.id, itemId));
    await deleteBlobs(
      deps,
      [material.storageKey, material.previewKey]
        .filter((key): key is string => !!key)
        .map((key) => ({ store: 'media' as const, key, prefix: false })),
    );
  } else {
    await deps.db.delete(deckBoardItems).where(eq(deckBoardItems.id, itemId));
    // A folder gone: the files from it are files of the board like any.
    if (item?.kind === 'folder')
      await deps.db
        .update(deckMaterials)
        .set({ folderId: null })
        .where(and(eq(deckMaterials.deckId, deckId), eq(deckMaterials.folderId, itemId)));
  }
  await unbind(deps, deckId, itemId);
  deps.live?.boardChanged(deckId);
}

/**
 * A thing gone from the board: the notes hanging on it let go of it – one that hung on it alone
 * goes with it.
 */
async function unbind(deps: AppDeps, deckId: string, goneId: string) {
  const notes = await deps.db
    .select({ id: deckBoardItems.id, kind: deckBoardItems.kind, boundIds: deckBoardItems.boundIds })
    .from(deckBoardItems)
    .where(eq(deckBoardItems.deckId, deckId));
  for (const note of notes) {
    if (!note.boundIds.includes(goneId)) continue;
    const left = note.boundIds.filter((id) => id !== goneId);
    // A frame or folder stays, empty or not (its people decide); a note on nothing left goes.
    if (left.length === 0 && note.kind === 'note')
      await deps.db.delete(deckBoardItems).where(eq(deckBoardItems.id, note.id));
    else
      await deps.db
        .update(deckBoardItems)
        .set({ boundIds: left })
        .where(eq(deckBoardItems.id, note.id));
    // A note on notes: those hanging on it let go of it in turn.
    if (left.length === 0 && note.kind === 'note') await unbind(deps, deckId, note.id);
  }
}

/** A file of the board for whoever may see the deck: its row (the route streams the bytes). */
export async function getMaterialForViewer(
  deps: AppDeps,
  viewer: Viewer,
  materialId: string,
): Promise<DeckMaterialRow> {
  const [row] = await deps.db.select().from(deckMaterials).where(eq(deckMaterials.id, materialId));
  if (!row) throw notFound('Dieses Material gibt es nicht (mehr).');
  await requireDeckAccess(deps, viewer, row.deckId, 'view');
  return row;
}
