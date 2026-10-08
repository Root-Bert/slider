import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Deck } from '@slider/shared';
import { uploadWithProgress } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';
import { validatePptxFile } from '../lib/upload-validation';

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
    const problem = validatePptxFile(file);
    if (problem) {
      setState({ status: 'error', message: problem });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: 'uploading', file, progress: 0 });

    const formData = new FormData();
    formData.append('workspaceId', workspaceId);
    formData.append('file', file);
    try {
      const deck = await uploadWithProgress<Deck>(
        '/decks/upload',
        formData,
        (progress) => setState({ status: 'uploading', file, progress }),
        controller.signal,
      );
      queryClient.setQueryData(queryKeys.deck(deck.id), deck);
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
      onUploaded(deck);
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Der Upload ist fehlgeschlagen.',
      });
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: 'idle' });
  };

  return { state, start: (file: File) => void start(file), cancel };
}
