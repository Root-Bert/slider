import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Deck, FilePickerSession } from '@slider/shared';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys, useImportDriveItem } from '@/lib/queries';
import { runPicker, type PickedDriveItem } from '../lib/onedrive-picker';

const FAILED_MESSAGE = 'Die OneDrive-Auswahl konnte nicht geöffnet werden.';
/** Set by the API after the one-time Microsoft consent: open the picker again by itself. */
const REOPEN_PARAM = 'onedrive';

const fetchToken = async (resource: string) =>
  (await api.post<{ token: string }>('/microsoft/file-picker/token', { resource })).token;

/**
 * "Aus OneDrive auswählen": Microsoft's file picker embedded in a dialog (starting in
 * "Geteilt"), then the import of the picked PowerPoint. Without a Microsoft login the browser
 * goes to sign in first and comes back to the start page.
 */
export function useOneDrivePicker(workspaceId: string, onImported: (deck: Deck) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Back from the Microsoft consent (`?onedrive=1`) the picker starts open.
  const [reopen] = useState(() => searchParams.get(REOPEN_PARAM) === '1');
  const [open, setOpen] = useState(reopen);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const importItem = useImportDriveItem(workspaceId);
  const queryClient = useQueryClient();

  const fail = (cause: unknown) => {
    if (cause instanceof ApiError && cause.code === 'microsoft_login_required' && cause.loginUrl) {
      window.location.assign(cause.loginUrl);
      return;
    }
    setError(cause instanceof ApiError ? cause.message : FAILED_MESSAGE);
  };

  const importPicked = (item: PickedDriveItem) =>
    importItem.mutate(item, {
      onSuccess: (deck) => {
        queryClient.setQueryData(queryKeys.deck(deck.id), deck);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
        onImported(deck);
      },
      onError: fail,
    });

  // While the dialog is open: load the picker into its frame and wait for a pick or a cancel.
  useEffect(() => {
    const frame = frameRef.current;
    if (!open || !frame) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      try {
        const session = await api.get<FilePickerSession>('/microsoft/file-picker');
        if (signal.aborted) return;
        const picked = await runPicker({
          frame,
          session,
          getToken: fetchToken,
          signal,
          onReady: () => setReady(true),
        });
        if (signal.aborted) return;
        setOpen(false);
        if (picked) importPicked(picked);
      } catch (cause) {
        if (signal.aborted) return;
        setOpen(false);
        fail(cause);
      }
    })();
    return () => controller.abort();
    // Runs per opening; `importPicked`/`fail` only use stable mutation and query-client handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Drop `?onedrive=1` from the URL, so a reload does not open the picker again.
  useEffect(() => {
    if (!reopen) return;
    setSearchParams(
      (params) => {
        params.delete(REOPEN_PARAM);
        return params;
      },
      { replace: true },
    );
  }, [reopen, setSearchParams]);

  return {
    open: () => {
      setError(null);
      setReady(false);
      importItem.reset();
      setOpen(true);
    },
    close: () => setOpen(false),
    dialog: { open, ready, frameRef },
    pending: importItem.isPending,
    error,
  };
}
