import {
  DECK_UPLOAD_IN_PARTS_FROM,
  type Comment,
  type CreateCommentInput,
  type CreateMediaCommentInput,
  type MediaUsage,
  type SetCommentRecordingInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadWithProgress } from '@/lib/api-client';
import { queryKeys, useInvalidateDeckFeedback } from '@/lib/api';
import { sendInParts, type PartsTarget } from '@/lib/upload-in-parts';
import type { Recording } from './useRecorder';

const mediaUsageKey = (deckId: string) => [...queryKeys.deck(deckId), 'media-usage'] as const;

/** Storage of the deck's workspace – every file of its reviews counts (BER-151). */
export const useMediaUsage = (deckId: string) =>
  useQuery({
    queryKey: mediaUsageKey(deckId),
    queryFn: () => api.get<MediaUsage>(`/decks/${deckId}/media-usage`),
    staleTime: 30_000,
  });

const EXTENSIONS: Record<string, string> = { webm: 'webm', mp4: 'mp4', ogg: 'ogg' };

function fileFor(recording: Pick<Recording, 'blob' | 'mimeType'>): File {
  const subtype = recording.mimeType.split(';')[0]?.split('/')[1] ?? '';
  const extension = EXTENSIONS[subtype] ?? 'webm';
  return new File([recording.blob], `aufnahme.${extension}`, { type: recording.mimeType });
}

/**
 * The recording in the form – or, when the request would be big (a proxy may refuse one over
 * 100 MB), sent in parts first (`sendInParts`, half the progress) and named by its upload.
 */
async function appendRecording(
  form: FormData,
  file: File,
  othersBytes: number,
  target: PartsTarget,
  setProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<(fraction: number) => void> {
  if (file.size + othersBytes < DECK_UPLOAD_IN_PARTS_FROM) {
    form.append('file', file);
    return setProgress;
  }
  const id = await sendInParts(file, target, (sent) => setProgress(sent * 0.9), signal);
  form.append('upload', id);
  return (sent) => setProgress(0.9 + sent * 0.1);
}

export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

/** A recording as it is sent – also one kept offline (its preview's object URL is not). */
export type RecordingToSend = Pick<
  Recording,
  'kind' | 'blob' | 'mimeType' | 'durationMs' | 'peaks'
>;

export interface MediaCommentUpload {
  input: CreateCommentInput;
  /** Voice or video – or the memo recorded while drawing. */
  recording?: RecordingToSend | null;
  /** Its images in order – the drawn one (Bild tab, exported to PNG when sending) first. */
  images?: (() => Promise<Blob>)[];
}

/**
 * Sends a media comment – its recording (in parts when big) and images – with its progress: the
 * way `useCreateMediaComment` sends, and the comment outbox (`lib/api/comment-outbox.ts`) one
 * recorded offline, once the server can be reached.
 */
export async function sendMediaComment(
  deckId: string,
  { input, recording, images = [] }: MediaCommentUpload,
  setProgress: (fraction: number) => void = () => {},
  signal: AbortSignal = new AbortController().signal,
): Promise<Comment> {
  const body: CreateMediaCommentInput = {
    ...input,
    ...(recording && {
      media: { kind: recording.kind, durationMs: recording.durationMs, peaks: recording.peaks },
    }),
  };
  const form = new FormData();
  form.append('comment', JSON.stringify(body));
  const pictures = await Promise.all(
    images.map(async (image) => new File([await image()], 'bild.png', { type: 'image/png' })),
  );
  setProgress(0);
  const onProgress = recording
    ? await appendRecording(
        form,
        fileFor(recording),
        pictures.reduce((sum, picture) => sum + picture.size, 0),
        { purpose: 'recording', deckId },
        setProgress,
        signal,
      )
    : setProgress;
  for (const picture of pictures) form.append('image', picture);
  return uploadWithProgress<Comment>(`/decks/${deckId}/media-comments`, form, onProgress, signal);
}

/**
 * Sends a voice or video comment, or images (a drawn one with an optional voice memo, pasted or
 * picked ones) – root or reply – with upload progress.
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
    mutationFn: (upload: MediaCommentUpload) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      return sendMediaComment(deckId, upload, setProgress, controller.signal).finally(() => {
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

/**
 * Saves an edited comment with a new recording (voice mode while editing): it replaces the
 * comment's recording, `body` is its text. Like a new one, with upload progress; leaving aborts.
 */
export function useSetCommentRecording(deckId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeckFeedback(deckId);
  const [progress, setProgress] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const mutation = useMutation({
    mutationFn: async ({
      commentId,
      body,
      recording,
    }: {
      commentId: string;
      body: string;
      recording: Recording;
    }) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const input: SetCommentRecordingInput = {
        body,
        media: { kind: recording.kind, durationMs: recording.durationMs, peaks: recording.peaks },
      };
      const form = new FormData();
      form.append('comment', JSON.stringify(input));
      setProgress(0);
      const onProgress = await appendRecording(
        form,
        fileFor(recording),
        0,
        { purpose: 'recording', commentId },
        setProgress,
        controller.signal,
      ).catch((error: unknown) => {
        if (controllerRef.current === controller) controllerRef.current = null;
        throw error;
      });
      return uploadWithProgress<Comment>(
        `/comments/${commentId}/recording`,
        form,
        onProgress,
        controller.signal,
        'PUT',
      ).finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null;
      });
    },
    onSuccess: (comment) => {
      queryClient.setQueryData<Comment[]>(queryKeys.comments(deckId), (current = []) =>
        current.map((existing) => (existing.id === comment.id ? comment : existing)),
      );
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: mediaUsageKey(deckId) });
    },
  });

  const aborted = isAbort(mutation.error);
  return { ...mutation, error: aborted ? null : mutation.error, progress };
}
