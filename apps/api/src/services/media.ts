import { eq, inArray, or, sum } from 'drizzle-orm';
import {
  isAllowedMediaMimeType,
  type Comment,
  type CommentMedia,
  type createMediaCommentInputSchema,
  type MediaUsage,
  type UpdateTranscriptInput,
  type Viewer,
} from '@slider/shared';
import type { z } from 'zod';
import { requireDeckAccess } from '../auth/access';
import type { Executor } from '../db/client';
import { comments, media, type MediaRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, forbidden, notFound } from '../http/errors';
import { blobKeys } from '../storage/blob-storage';
import { insertComment, toCommentDto } from './comments';

type CreateMediaCommentData = z.output<typeof createMediaCommentInputSchema>;

export const mediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

export function toMediaDto(row: MediaRow): CommentMedia {
  return {
    id: row.id,
    kind: row.kind,
    url: mediaUrl(row.id),
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    peaks: row.peaks,
    transcript: row.transcript,
    transcriptStatus: row.transcriptStatus,
  };
}

/** The recordings of the given comments, by comment id. */
export async function mediaByComment(
  db: Executor,
  commentIds: readonly string[],
): Promise<Map<string, CommentMedia>> {
  if (commentIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(media)
    .where(inArray(media.commentId, [...commentIds]));
  return new Map(rows.map((row) => [row.commentId, toMediaDto(row)]));
}

const formatGigabytes = (bytes: number) =>
  `${(bytes / 1024 ** 3).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;

export const quotaExceeded = (limitBytes: number) =>
  new ApiError(
    413,
    'quota_exceeded',
    `Der Speicher für Sprach- und Videokommentare ist voll (${formatGigabytes(limitBytes)}). Lösche alte Aufnahmen, um Platz zu schaffen.`,
  );

const unsupportedMedia = () =>
  new ApiError(
    415,
    'unsupported_media',
    'Diese Aufnahme kann Slider nicht speichern (erlaubt: WebM, MP4, Ogg).',
  );

/** Bytes of recordings in all decks of this owner – guests' recordings included. */
export async function usedMediaBytes(db: Executor, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(media.sizeBytes) })
    .from(media)
    .where(eq(media.ownerId, ownerId));
  return Number(row?.total ?? 0);
}

export async function getMediaUsage(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<MediaUsage> {
  const deck = await requireDeckAccess(deps.db, viewer, deckId, 'view');
  return {
    usedBytes: await usedMediaBytes(deps.db, deck.ownerId),
    limitBytes: deps.config.media.quotaBytes,
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

/**
 * A comment with a voice or video recording. The recording was compressed on the device
 * (Opus, AV1/VP9 at low bitrates), so it is stored as it is – no server-side transcoding, which
 * keeps the API runnable on Cloudflare Workers. The transcript follows later from the device.
 */
export async function createMediaComment(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: CreateMediaCommentData,
  file: MediaFile,
): Promise<Comment> {
  const deck = await requireDeckAccess(deps.db, viewer, deckId, 'comment');
  const { kind } = input.media;
  if (file.bytes.byteLength === 0) throw badRequest('Die Aufnahme ist leer.');
  if (file.bytes.byteLength > deps.config.media.maxBytes)
    throw fileTooLarge(deps.config.media.maxBytes);
  // The type comes from the bytes, never from the upload: multipart parsers guess it from the
  // file name (Bun turns any `.webm` into `video/webm`), and a declared type proves nothing.
  const container = sniffMediaContainer(file.bytes);
  const mimeType = container && `${kind}/${container}`;
  if (!mimeType || !isAllowedMediaMimeType(kind, mimeType)) throw unsupportedMedia();

  const used = await usedMediaBytes(deps.db, deck.ownerId);
  if (used + file.bytes.byteLength > deps.config.media.quotaBytes)
    throw quotaExceeded(deps.config.media.quotaBytes);

  const mediaId = crypto.randomUUID();
  const storageKey = blobKeys.media(deckId, mediaId, container);
  const sha256 = await sha256Hex(file.bytes);
  await deps.media.put(storageKey, file.bytes);
  try {
    return await deps.db.transaction(async (tx) => {
      const row = await insertComment(tx, deps, viewer, deck, input, { hasMedia: true });
      const [mediaRow] = await tx
        .insert(media)
        .values({
          id: mediaId,
          deckId,
          commentId: row.id,
          ownerId: deck.ownerId,
          uploaderId: viewer.author.id,
          kind,
          mimeType,
          sizeBytes: file.bytes.byteLength,
          durationMs: input.media.durationMs,
          peaks: input.media.peaks,
          storageKey,
          sha256,
          createdAt: row.createdAt,
        })
        .returning();
      if (!mediaRow) throw new Error('Media insert returned no row');
      return toCommentDto(row, toMediaDto(mediaRow));
    });
  } catch (error) {
    // Nothing references the blob – don't let it eat the quota.
    await deps.media.delete(storageKey).catch(() => undefined);
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
  await requireDeckAccess(deps.db, viewer, row.deckId, 'view');
  return row;
}

/** The recording device sends the transcript (or that it could not make one). */
export async function updateTranscript(
  deps: AppDeps,
  viewer: Viewer,
  mediaId: string,
  input: UpdateTranscriptInput,
): Promise<Comment> {
  const row = await loadMedia(deps.db, mediaId);
  await requireDeckAccess(deps.db, viewer, row.deckId, 'comment');
  if (row.uploaderId !== viewer.author.id)
    throw forbidden('Nur wer aufgenommen hat, kann das Transkript setzen.');

  const [updated] = await deps.db
    .update(media)
    .set(
      input.status === 'done'
        ? { transcript: input.transcript, transcriptStatus: 'done' }
        : { transcriptStatus: 'failed' },
    )
    .where(eq(media.id, mediaId))
    .returning();
  const [comment] = await deps.db.select().from(comments).where(eq(comments.id, row.commentId));
  if (!updated || !comment) throw notFound('Diese Aufnahme gibt es nicht (mehr).');
  return toCommentDto(comment, toMediaDto(updated));
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
  await Promise.all(
    keys.map((key) =>
      deps.media
        .delete(key)
        .catch((error: unknown) =>
          deps.log.warn(`Could not delete media blob ${key}: ${String(error)}`),
        ),
    ),
  );
}
