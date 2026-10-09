import type {
  Comment,
  CreateCommentInput,
  CreateMediaCommentInput,
  MediaUsage,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadWithProgress } from '@/lib/api-client';
import { queryKeys, useInvalidateDeckFeedback } from '@/lib/queries';
import { transcribeInBackground } from './transcription';
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

/**
 * Sends a voice or video comment – root or reply – with upload progress. Once saved, this
 * browser transcribes the recording in the background (Whisper, on the device).
 *
 * `cancel()` aborts a running upload; leaving (unmount) does too. An aborted upload creates
 * nothing here – no cache entry, no transcription – and is not reported as an error.
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
    mutationFn: ({ input, recording }: { input: CreateCommentInput; recording: Recording }) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const body: CreateMediaCommentInput = {
        ...input,
        media: { kind: recording.kind, durationMs: recording.durationMs, peaks: recording.peaks },
      };
      const form = new FormData();
      form.append('comment', JSON.stringify(body));
      form.append('file', fileFor(recording));
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
    onSuccess: (comment, { recording }) => {
      queryClient.setQueryData<Comment[]>(queryKeys.comments(deckId), (current = []) => [
        ...current.filter((existing) => existing.id !== comment.id),
        comment,
      ]);
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: mediaUsageKey(deckId) });
      if (comment.media) {
        transcribeInBackground({
          queryClient,
          deckId,
          mediaId: comment.media.id,
          audio: recording.transcriptionAudio,
        });
      }
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
