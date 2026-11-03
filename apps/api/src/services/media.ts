import { and, eq, inArray, ne, or } from 'drizzle-orm';
import {
  isAllowedMediaMimeType,
  MAX_COMMENT_IMAGES,
  MAX_IMAGE_BYTES,
  type Comment,
  type CommentImage,
  type CommentMedia,
  type createMediaCommentInputSchema,
  type setCommentRecordingInputSchema,
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
import { touchDeck } from './decks';
import {
  assertMayEditText,
  insertComment,
  loadComment,
  retriedComment,
  toCommentDto,
  withMedia,
} from './comments';
import { assertStorageFor, assertWithinLimits, planLimits } from './plans';
import { initialTranscriptStatus, transcribeLater } from './transcripts';
import { totalBytes, workspaceStorageUsage } from './workspace-storage';

type CreateMediaCommentData = z.output<typeof createMediaCommentInputSchema>;
type SetCommentRecordingData = z.output<typeof setCommentRecordingInputSchema>;
type RecordingInfo = SetCommentRecordingData['media'];

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
    transcript: row.transcriptStatus === 'done' ? (row.transcript ?? '') : null,
    transcriptStatus: row.transcriptStatus,
    transcriptSummary:
      row.transcriptStatus === 'done' ? row.transcriptSummary?.trim() || null : null,
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
  images: CommentImage[];
}

/** Recordings and images of the given comments, by comment id; images in their order. */
export async function mediaByComment(
  db: Executor,
  commentIds: readonly string[],
): Promise<Map<string, CommentAttachments>> {
  const byComment = new Map<string, CommentAttachments>();
  if (commentIds.length === 0) return byComment;
  const rows = await db
    .select()
    .from(media)
    .where(inArray(media.commentId, [...commentIds]))
    .orderBy(media.position);
  for (const row of rows) {
    const entry = byComment.get(row.commentId) ?? { media: null, images: [] };
    if (row.kind === 'image') entry.images.push(toImageDto(row));
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

/** The storage of the deck's workspace (BER-151) – the recorder shows how full it is. */
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
  /** The images: drawn in the Bild tab, pasted or picked (PNG, in order). */
  images?: MediaFile[];
}

interface StoredBlob {
  row: typeof media.$inferInsert;
  bytes: Uint8Array<ArrayBuffer>;
}

type BlobBase = Pick<typeof media.$inferInsert, 'deckId' | 'ownerId' | 'uploaderId'>;

/** Checks a recording and describes its blob (`commentId` is set when it is inserted). */
async function recordingBlob(
  deps: AppDeps,
  base: BlobBase,
  recording: MediaFile,
  info: RecordingInfo,
): Promise<StoredBlob> {
  const { kind } = info;
  if (recording.bytes.byteLength === 0) throw badRequest('Die Aufnahme ist leer.');
  if (recording.bytes.byteLength > deps.config.media.maxBytes)
    throw fileTooLarge(deps.config.media.maxBytes);
  // The type comes from the bytes, never from the upload: multipart parsers guess it from the
  // file name (Bun turns any `.webm` into `video/webm`), and a declared type proves nothing.
  const container = sniffMediaContainer(recording.bytes);
  const mimeType = container && `${kind}/${container}`;
  if (!mimeType || !isAllowedMediaMimeType(kind, mimeType)) throw unsupportedMedia();
  const id = crypto.randomUUID();
  return {
    bytes: recording.bytes,
    row: {
      ...base,
      id,
      commentId: '',
      kind,
      mimeType,
      sizeBytes: recording.bytes.byteLength,
      durationMs: info.durationMs,
      peaks: info.peaks,
      storageKey: blobKeys.media(base.deckId, id, container),
      sha256: await sha256Hex(recording.bytes),
    },
  };
}

/**
 * A comment with a voice or video recording, images, or both (a drawn image with the voice memo
 * recorded while drawing). The recording was compressed on the device (Opus, AV1/VP9 at
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
  // Sent again (recorded offline, its answer lost): the comment saved the first time, as it is.
  const retried = await retriedComment(deps.db, viewer, deck.id, input.id);
  if (retried) return (await withMedia(deps.db, [retried]))[0]!;
  // No new comments while the workspace is over its plan's limits (BER-155), as in createComment.
  await assertWithinLimits(deps.db, deps.config, deck.workspaceId, deps.clock.now());
  const { recording, images = [] } = upload;
  if (!recording && images.length === 0)
    throw badRequest('Bitte eine Aufnahme oder ein Bild mitsenden.');
  if (images.length > MAX_COMMENT_IMAGES)
    throw badRequest(`Höchstens ${MAX_COMMENT_IMAGES} Bilder pro Kommentar.`);
  if (!recording !== !input.media)
    throw badRequest('Angaben zur Aufnahme und Aufnahme gehören zusammen.');

  const blobs: StoredBlob[] = [];
  const base = { deckId, ownerId: deck.ownerId, uploaderId: viewer.author.id };
  if (recording && input.media) {
    const blob = await recordingBlob(deps, base, recording, input.media);
    blob.row.transcriptStatus = await initialTranscriptStatus(deps, deck.workspaceId);
    blobs.push(blob);
  }
  for (const [position, image] of images.entries()) {
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
        position,
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
      // The workspace's storage (BER-151), under its lock: two uploads can't share the rest.
      await assertStorageFor(tx, deps.config, deck.workspaceId, uploadBytes, deps.clock.now());
      const row = await insertComment(tx, deps, viewer, deck, input, { hasMedia: true });
      const mediaRows = await tx
        .insert(media)
        .values(blobs.map((blob) => ({ ...blob.row, commentId: row.id, createdAt: row.createdAt })))
        .returning();
      if (mediaRows.length !== blobs.length) throw new Error('Media insert returned no row');
      const recordingRow = mediaRows.find((mediaRow) => mediaRow.kind !== 'image');
      return toCommentDto(row, {
        media: recordingRow ? toMediaDto(recordingRow) : null,
        images: mediaRows
          .filter((mediaRow) => mediaRow.kind === 'image')
          .sort((a, b) => a.position - b.position)
          .map(toImageDto),
      });
    });
    deps.live?.commentsChanged(deckId);
    if (created.media?.transcriptStatus === 'pending') transcribeLater(deps, created.media.id);
    return created;
  } catch (error) {
    // Nothing references the blobs – don't let them eat the storage.
    await Promise.all(stored.map((key) => deps.media.delete(key).catch(() => undefined)));
    throw error;
  }
}

/**
 * Editing a comment with a new recording (voice mode while editing): it replaces the comment's
 * recording – images stay – and `body` becomes its text, the recording's note. Author only, like
 * changing the text.
 */
export function setCommentRecording(
  deps: AppDeps,
  viewer: Viewer,
  commentId: string,
  input: SetCommentRecordingData,
  recording: MediaFile,
): Promise<Comment> {
  return replaceRecording(deps, viewer, commentId, recording, input.media, { body: input.body });
}

/**
 * A spoken comment's recording (speaking to the AI): its pieces, put together in the browser,
 * with their text known already – no transcript to make. The comment's text stays.
 */
export function attachSpokenRecording(
  deps: AppDeps,
  viewer: Viewer,
  commentId: string,
  info: { durationMs: number; peaks: number[] },
  transcript: string,
  recording: MediaFile,
): Promise<Comment> {
  return replaceRecording(
    deps,
    viewer,
    commentId,
    recording,
    { kind: 'audio', ...info },
    { transcript },
  );
}

/** The comment's recording replaced; with `body` its text too, with `transcript` known text. */
async function replaceRecording(
  deps: AppDeps,
  viewer: Viewer,
  commentId: string,
  recording: MediaFile,
  info: RecordingInfo,
  { body, transcript }: { body?: string; transcript?: string },
): Promise<Comment> {
  const comment = await loadComment(deps, commentId);
  const deck = await requireDeckAccess(deps, viewer, comment.deckId, 'comment');
  assertMayEditText(comment, viewer);
  const blob = await recordingBlob(
    deps,
    { deckId: comment.deckId, ownerId: deck.ownerId, uploaderId: viewer.author.id },
    recording,
    info,
  );
  if (transcript === undefined) {
    blob.row.transcriptStatus = await initialTranscriptStatus(deps, deck.workspaceId);
  } else {
    blob.row.transcriptStatus = 'done';
    blob.row.transcript = transcript;
  }
  const uploadBytes = blob.bytes.byteLength;
  // Early, before the blob is stored; the binding check runs again under the workspace lock.
  await deps.db.transaction((tx) =>
    assertStorageFor(tx, deps.config, deck.workspaceId, uploadBytes, deps.clock.now()),
  );

  await deps.media.put(blob.row.storageKey, blob.bytes);
  let replaced: string[];
  let updated: Comment;
  try {
    const now = deps.clock.now();
    ({ replaced, updated } = await deps.db.transaction(async (tx) => {
      await assertStorageFor(tx, deps.config, deck.workspaceId, uploadBytes, now);
      const old = await tx
        .delete(media)
        .where(and(eq(media.commentId, commentId), ne(media.kind, 'image')))
        .returning({ key: media.storageKey });
      await tx.insert(media).values({ ...blob.row, commentId, createdAt: now });
      const [row] = await tx
        .update(comments)
        .set({ ...(body === undefined ? {} : { body }), updatedAt: now })
        .where(eq(comments.id, commentId))
        .returning();
      if (!row) throw notFound('Diesen Kommentar gibt es nicht (mehr).');
      await touchDeck(tx, comment.deckId, now);
      const [dto] = await withMedia(tx, [row]);
      return { replaced: old.map((entry) => entry.key), updated: dto! };
    }));
  } catch (error) {
    // Nothing references the blob – don't let it eat the storage.
    await deps.media.delete(blob.row.storageKey).catch(() => undefined);
    throw error;
  }
  await deleteMediaBlobs(deps, replaced);
  deps.live?.commentsChanged(comment.deckId);
  if (updated.media?.transcriptStatus === 'pending') transcribeLater(deps, updated.media.id);
  return updated;
}

/**
 * A recording's transcript made anew – one that failed, or one recorded before speech to text
 * was set up. Whoever may comment on the deck may ask.
 */
export async function retryTranscript(
  deps: AppDeps,
  viewer: Viewer,
  mediaId: string,
): Promise<void> {
  const row = await loadMedia(deps.db, mediaId);
  if (row.kind === 'image') throw notFound('Diese Aufnahme gibt es nicht (mehr).');
  const deck = await requireDeckAccess(deps, viewer, row.deckId, 'comment');
  if (row.transcriptStatus === 'pending' || row.transcriptStatus === 'done') return;
  const status = await initialTranscriptStatus(deps, deck.workspaceId);
  if (status !== 'pending') {
    throw new ApiError(
      409,
      'speech_not_configured',
      'In diesem Workspace ist Sprache zu Text nicht eingerichtet.',
    );
  }
  // Asked twice at once, it is made once.
  const queued = await deps.db
    .update(media)
    .set({ transcriptStatus: 'pending' })
    .where(and(eq(media.id, mediaId), inArray(media.transcriptStatus, ['none', 'failed'])))
    .returning({ id: media.id });
  if (queued.length === 0) return;
  deps.live?.commentsChanged(row.deckId);
  transcribeLater(deps, mediaId);
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
