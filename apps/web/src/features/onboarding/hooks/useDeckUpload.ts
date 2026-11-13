import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DECK_UPLOAD_IN_PARTS_FROM, type Deck } from '@slider/shared';
import { uploadWithProgress } from '@/lib/api-client';
import { CANCEL_UPLOAD, uploadInParts } from '@/lib/upload-in-parts';
import { queryKeys, reportSessionError } from '@/lib/api';
import { validateUploadFile } from '../lib/upload-validation';

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; /** 0–1 */ progress: number }
  | { status: 'error'; message: string };

/** PPTX upload into a workspace with progress and cancel (BER-91). Calls `onUploaded` with the created deck. */
export function useDeckUpload(workspaceId: string, onUploaded: (deck: Deck) => void) {
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Leaving the page cancels a running upload.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = async (file: File) => {
    const problem = validateUploadFile(file);
    if (problem) {
      setState({ status: 'error', message: problem });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'uploading', file, progress: 0 });

    // All bytes sent: from here on the server creates the deck even if we stop listening.
    let sent = false;
    const onProgress = (progress: number) => {
      if (progress >= 1) sent = true;
      setState({ status: 'uploading', file, progress });
    };
    try {
      // Big files go in parts (a proxy may refuse one big request); a reload goes on from there.
      const deck =
        file.size >= DECK_UPLOAD_IN_PARTS_FROM
          ? await uploadInParts<Deck>(file, { workspaceId }, onProgress, controller.signal)
          : await uploadWithProgress<Deck>(
              // In the URL too: the server checks the target before it reads the file.
              `/decks/upload?workspaceId=${encodeURIComponent(workspaceId)}`,
              formDataOf(file, workspaceId),
              onProgress,
              controller.signal,
            );
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      onUploaded(deck);
    } catch (error) {
      if (controller.signal.aborted) {
        // Left the page after the bytes were sent: the deck (and its plan slot) may exist now.
        if (sent) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
          void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        }
        return;
      }
      // The XHR skips React Query: an ended session goes to the login like any other call.
      reportSessionError(queryClient, error);
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Der Upload ist fehlgeschlagen.',
      });
    }
  };

  const cancel = () => {
    // Cancelled on purpose: a file sent in parts is dropped on the server too.
    controllerRef.current?.abort(CANCEL_UPLOAD);
    controllerRef.current = null;
    setState({ status: 'idle' });
  };

  // `run`: the same, to wait for – files dropped together go one after another.
  return { state, start: (file: File) => void start(file), run: start, cancel };
}

function formDataOf(file: File, workspaceId: string): FormData {
  const formData = new FormData();
  formData.append('workspaceId', workspaceId);
  formData.append('file', file);
  return formData;
}
