import type { Author, CreateCommentInput } from '@slider/shared';
import { useQueueMediaComment } from '@/lib/api';
import { statusOf } from '@/lib/outbox';
import { isAbort, type RecordingToSend } from './useMediaComment';

/** The upload found no server (no connection, or lost on the way) – not stopped, not refused. */
export const isUnreachable = (error: unknown) =>
  !isAbort(error) &&
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  statusOf(error) === 0;

/**
 * A voice or video comment or pictures without a connection (BER-164): kept with the recording
 * and the images in the browser and sent once the server can be reached – the comment shows at
 * once, pending, as any written offline (`useQueueMediaComment`).
 */
export function useQueueMediaUpload(deckId: string, author: Author) {
  const queue = useQueueMediaComment(deckId, author);
  return async (
    input: CreateCommentInput,
    recording: RecordingToSend | null | undefined,
    images: readonly (() => Promise<Blob>)[],
  ) =>
    queue(input, {
      recording: recording
        ? {
            kind: recording.kind,
            blob: recording.blob,
            mimeType: recording.mimeType,
            durationMs: recording.durationMs,
            peaks: recording.peaks,
          }
        : null,
      images: await Promise.all(images.map((image) => image())),
    });
}
