import type {
  Comment,
  CreateCommentInput,
  CreateMediaCommentInput,
  MediaUsage,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadWithProgress } from '@/lib/api-client';
import { queryKeys, useInvalidateDeckFeedback } from '@/lib/api';
import type { Recording } from './useRecorder';

const mediaUsageKey = (deckId: string) => [...queryKeys.deck(deckId), 'media-usage'] as const;

/** Storage used by recordings in the deck owner's account (5 GB by default). */
export const useMediaUsage = (deckId: string) =>
  useQuery({
    queryKey: mediaUsageKey(deckId),
    queryFn: () => api.get<MediaUsage>(`/decks/${deckId}/media-usage`),
    staleTime: 30_000,
  });

const EXTENSIONS: Record<string, string> = { webm: 'webm', mp4: 'mp4', ogg: 'ogg' };

function fileFor(recording: Recording): File {
  const subtype = recording.mimeType.split(';')[0]?.split('/')[1] ?? '';
  const extension = EXTENSIONS[subtype] ?? 'webm';
  return new File([recording.blob], `aufnahme.${extension}`, { type: recording.mimeType });
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export interface MediaCommentUpload {
  input: CreateCommentInput;
  /** Voice or video – or the memo recorded while drawing. */
  recording?: Recording | null;
  /** The drawn image (Bild tab), exported to PNG when sending. */
  image?: (() => Promise<Blob>) | null;
}

/**
 * Sends a voice or video comment, or a drawn image with an optional voice memo – root or
 * reply – with upload progress.
 *
 * `cancel()` aborts a running upload; leaving (unmount) does too. An aborted upload creates
 * nothing here – no cache entry – and is not reported as an error.
 */
export function useCreateMediaComment(deckId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeckFeedback(deckId);
  const [progress, setProgress] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const mutation = useMutation({
    mutationFn: async ({ input, recording, image }: MediaCommentUpload) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const body: CreateMediaCommentInput = {
        ...input,
        ...(recording && {
          media: { kind: recording.kind, durationMs: recording.durationMs, peaks: recording.peaks },
        }),
      };
      const form = new FormData();
      form.append('comment', JSON.stringify(body));
      if (recording) form.append('file', fileFor(recording));
      if (image) form.append('image', new File([await image()], 'bild.png', { type: 'image/png' }));
      setProgress(0);
      return uploadWithProgress<Comment>(
        `/decks/${deckId}/media-comments`,
        form,
        setProgress,
        controller.signal,
      ).finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<Comment[]>(queryKeys.comments(deckId), (current = []) => [
        ...current.filter((existing) => existing.id !== comment.id),
        comment,
      ]);
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: mediaUsageKey(deckId) });
    },
  });

  const aborted = isAbort(mutation.error);
  return {
    ...mutation,
    error: aborted ? null : mutation.error,
    isError: mutation.isError && !aborted,
    progress,
    cancel,
  };
}
