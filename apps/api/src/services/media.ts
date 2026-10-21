import { eq, inArray, or } from 'drizzle-orm';
import {
  isAllowedMediaMimeType,
  MAX_IMAGE_BYTES,
  type Comment,
  type CommentImage,
  type CommentMedia,
  type createMediaCommentInputSchema,
  type MediaUsage,
  type Viewer,
} from '@slider/shared';
import type { z } from 'zod';
import { requireDeckAccess } from '../auth/access';
import type { Executor } from '../db/client';
import { comments, media, workspaces, type MediaRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, notFound } from '../http/errors';
import { blobKeys } from '../storage/blob-storage';
import { deleteBlobs } from './blob-deletions';
import { insertComment, toCommentDto } from './comments';
import { assertStorageFor, planLimits } from './plans';
import { totalBytes, workspaceStorageUsage } from './workspace-storage';

type CreateMediaCommentData = z.output<typeof createMediaCommentInputSchema>;

export const mediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

export function toMediaDto(row: MediaRow): CommentMedia {
  if (row.kind === 'image') throw new Error('An image is not a recording');
  return {
    id: row.id,
    kind: row.kind,
    url: mediaUrl(row.id),
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    peaks: row.peaks,
  };
}

export const toImageDto = (row: MediaRow): CommentImage => ({
  id: row.id,
  url: mediaUrl(row.id),
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
});

export interface CommentAttachments {
  media: CommentMedia | null;
  image: CommentImage | null;
}

/** Recordings and drawn images of the given comments, by comment id. */
export async function mediaByComment(
  db: Executor,
  commentIds: readonly string[],
): Promise<Map<string, CommentAttachments>> {
  const byComment = new Map<string, CommentAttachments>();
  if (commentIds.length === 0) return byComment;
  const rows = await db
    .select()
    .from(media)
    .where(inArray(media.commentId, [...commentIds]));
  for (const row of rows) {
    const entry = byComment.get(row.commentId) ?? { media: null, image: null };
    if (row.kind === 'image') entry.image = toImageDto(row);
    else entry.media = toMediaDto(row);
    byComment.set(row.commentId, entry);
  }
  return byComment;
}

const unsupportedMedia = () =>
  new ApiError(
    415,
    'unsupported_media',
    'Diese Aufnahme kann Slider nicht speichern (erlaubt: WebM, MP4, Ogg).',
  );

const unsupportedImage = () =>
  new ApiError(415, 'unsupported_media', 'Das Bild muss ein PNG sein.');

const isPng = (bytes: Uint8Array) =>
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);

/** The storage of the deck's organisation (BER-151) – the recorder shows how full it is. */
export async function getMediaUsage(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<MediaUsage> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'view');
  const [workspace] = await deps.db
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, deck.workspaceId));
  return {
    usedBytes: totalBytes(await workspaceStorageUsage(deps.db, deck.workspaceId)),
    limitBytes: planLimits(deps.config, workspace?.plan ?? 'free').maxStorageBytes,
  };
}

export type MediaContainer = 'webm' | 'mp4' | 'ogg';

/**
 * Checks the container signature, so only real recordings are stored and served:
 * WebM/Matroska (EBML header), MP4 (`ftyp` box) or Ogg (`OggS`).
 */
export function sniffMediaContainer(bytes: Uint8Array): MediaContainer | null {
  const at = (offset: number, signature: number[]) =>
    signature.every((byte, i) => bytes[offset + i] === byte);
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (at(4, [0x66, 0x74, 0x79, 0x70])) return 'mp4';
  if (at(0, [0x4f, 0x67, 0x67, 0x53])) return 'ogg';
  return null;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

export interface MediaFile {
  bytes: Uint8Array<ArrayBuffer>;
}

export interface MediaUpload {
  /** The voice or video recording (`input.media` describes it). */
  recording?: MediaFile;
  /** The image drawn in the Bild tab (PNG). */
  image?: MediaFile;
}

interface StoredBlob {
  row: typeof media.$inferInsert;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * A comment with a voice or video recording, a drawn image, or both (an image with the voice
 * memo recorded while drawing). The recording was compressed on the device (Opus, AV1/VP9 at
 * low bitrates), so it is stored as it is – no server-side transcoding, which keeps the API
 * runnable on Cloudflare Workers.
 */
export async function createMediaComment(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: CreateMediaCommentData,
  upload: MediaUpload,
): Promise<Comment> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'comment');
  const { recording, image } = upload;
  if (!recording && !image) throw badRequest('Bitte eine Aufnahme oder ein Bild mitsenden.');
  if (!recording !== !input.media)
    throw badRequest('Angaben zur Aufnahme und Aufnahme gehören zusammen.');

  const blobs: StoredBlob[] = [];
  const base = { deckId, ownerId: deck.ownerId, uploaderId: viewer.author.id };
  if (recording && input.media) {
    const { kind } = input.media;
    if (recording.bytes.byteLength === 0) throw badRequest('Die Aufnahme ist leer.');
    if (recording.bytes.byteLength > deps.config.media.maxBytes)
      throw fileTooLarge(deps.config.media.maxBytes);
    // The type comes from the bytes, never from the upload: multipart parsers guess it from the
    // file name (Bun turns any `.webm` into `video/webm`), and a declared type proves nothing.
    const container = sniffMediaContainer(recording.bytes);
    const mimeType = container && `${kind}/${container}`;
    if (!mimeType || !isAllowedMediaMimeType(kind, mimeType)) throw unsupportedMedia();
    const id = crypto.randomUUID();
    blobs.push({
      bytes: recording.bytes,
      row: {
        ...base,
        id,
        commentId: '',
        kind,
        mimeType,
        sizeBytes: recording.bytes.byteLength,
        durationMs: input.media.durationMs,
        peaks: input.media.peaks,
        storageKey: blobKeys.media(deckId, id, container),
        sha256: await sha256Hex(recording.bytes),
      },
    });
  }
  if (image) {
    if (image.bytes.byteLength === 0) throw badRequest('Das Bild ist leer.');
    if (image.bytes.byteLength > MAX_IMAGE_BYTES) throw fileTooLarge(MAX_IMAGE_BYTES);
    if (!isPng(image.bytes)) throw unsupportedImage();
    const id = crypto.randomUUID();
    blobs.push({
      bytes: image.bytes,
      row: {
        ...base,
        id,
        commentId: '',
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: image.bytes.byteLength,
        durationMs: 0,
        peaks: [],
        storageKey: blobKeys.media(deckId, id, 'png'),
        sha256: await sha256Hex(image.bytes),
      },
    });
  }
  const uploadBytes = blobs.reduce((total, blob) => total + blob.bytes.byteLength, 0);

  // Early, before the blobs are stored; the binding check runs again under the workspace lock.
  await deps.db.transaction((tx) =>
    assertStorageFor(tx, deps.config, deck.workspaceId, uploadBytes, deps.clock.now()),
  );

  const stored: string[] = [];
  try {
    for (const blob of blobs) {
      await deps.media.put(blob.row.storageKey, blob.bytes);
      stored.push(blob.row.storageKey);
    }
    const created = await deps.db.transaction(async (tx) => {
      // The organisation's storage (BER-151), under its lock: two uploads can't share the rest.
      await assertStorageFor(tx, deps.config, deck.workspaceId, uploadBytes, deps.clock.now());
      const row = await insertComment(tx, deps, viewer, deck, input, { hasMedia: true });
      const mediaRows = await tx
        .insert(media)
        .values(blobs.map((blob) => ({ ...blob.row, commentId: row.id, createdAt: row.createdAt })))
        .returning();
      if (mediaRows.length !== blobs.length) throw new Error('Media insert returned no row');
      const recordingRow = mediaRows.find((mediaRow) => mediaRow.kind !== 'image');
      const imageRow = mediaRows.find((mediaRow) => mediaRow.kind === 'image');
      return toCommentDto(row, {
        media: recordingRow ? toMediaDto(recordingRow) : null,
        image: imageRow ? toImageDto(imageRow) : null,
      });
    });
    deps.live?.commentsChanged(deckId);
    return created;
  } catch (error) {
    // Nothing references the blobs – don't let them eat the storage.
    await Promise.all(stored.map((key) => deps.media.delete(key).catch(() => undefined)));
    throw error;
  }
}

async function loadMedia(db: Executor, mediaId: string): Promise<MediaRow> {
  const [row] = await db.select().from(media).where(eq(media.id, mediaId));
  if (!row) throw notFound('Diese Aufnahme gibt es nicht (mehr).');
  return row;
}

/** For streaming: the row, once the viewer may see the deck. */
export async function getMediaForViewer(
  deps: AppDeps,
  viewer: Viewer,
  mediaId: string,
): Promise<MediaRow> {
  const row = await loadMedia(deps.db, mediaId);
  await requireDeckAccess(deps, viewer, row.deckId, 'view');
  return row;
}

/** Storage keys of the recordings on a comment and its replies (the rows go by cascade). */
export async function mediaKeysOfThread(db: Executor, commentId: string): Promise<string[]> {
  const rows = await db
    .select({ key: media.storageKey })
    .from(media)
    .innerJoin(comments, eq(media.commentId, comments.id))
    .where(or(eq(comments.id, commentId), eq(comments.parentId, commentId)));
  return rows.map((row) => row.key);
}

/** Best effort: a blob left behind wastes space but breaks nothing. */
export async function deleteMediaBlobs(deps: AppDeps, keys: readonly string[]): Promise<void> {
  await deleteBlobs(
    deps,
    keys.map((key) => ({ store: 'media', key, prefix: false })),
  );
}
