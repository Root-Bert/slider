import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Deck, FilePickerSession, MicrosoftConnection } from '@slider/shared';
import { api, ApiError } from '@/lib/api-client';
import {
  queryKeys,
  reportSessionError,
  useImportDriveItem,
  useMe,
  useMicrosoftConnections,
} from '@/lib/api';
import { runPicker, type PickedDriveItem } from '../lib/onedrive-picker';

const FAILED_MESSAGE = 'Die OneDrive-Auswahl konnte nicht geöffnet werden.';
/**
 * Set by the API after the one-time Microsoft consent: open the picker again by itself – with
 * the Microsoft connection it names (`?onedrive=<id>`; `1` from older links: the latest).
 */
const REOPEN_PARAM = 'onedrive';

const fetchToken = async (resource: string, connectionId: string | undefined) =>
  (
    await api.post<{ token: string }>('/microsoft/file-picker/token', {
      resource,
      ...(connectionId ? { connectionId } : {}),
    })
  ).token;

const sessionPath = (connectionId: string | undefined) =>
  connectionId
    ? `/microsoft/file-picker?connectionId=${encodeURIComponent(connectionId)}`
    : '/microsoft/file-picker';

/**
 * "Aus OneDrive / SharePoint wählen": Microsoft's file picker embedded in a dialog
 * (starting in "Geteilt"), then the import of the picked PowerPoint. With several Microsoft
 * accounts connected, the person picks the account first (`chooser`); the picker and the import
 * then run with that one. Without a Microsoft login the browser goes to sign in first and comes
 * back to the start page.
 */
export function useOneDrivePicker(workspaceId: string, onImported: (deck: Deck) => void) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Back from the Microsoft consent (`?onedrive=<id>`) the picker starts open.
  const [reopenParam] = useState(() => searchParams.get(REOPEN_PARAM));
  const reopen = reopenParam !== null;
  const [open, setOpen] = useState(reopen);
  const [connectionId, setConnectionId] = useState<string | undefined>(
    reopenParam && reopenParam !== '1' ? reopenParam : undefined,
  );
  const [choosing, setChoosing] = useState(false);
  const { data: me } = useMe();
  const connections = useMicrosoftConnections((me?.user?.microsoftConnections ?? 0) > 1);
  const usable = (connections.data ?? []).filter((connection) => !connection.needsReconnect);
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
    // The picker session and token calls skip React Query: an ended session goes to the login.
    reportSessionError(queryClient, cause);
    setError(cause instanceof ApiError ? cause.message : FAILED_MESSAGE);
  };

  const importPicked = (item: PickedDriveItem, account: string | undefined) =>
    importItem.mutate(account ? { ...item, connectionId: account } : item, {
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
    const account = connectionId;
    void (async () => {
      try {
        const session = await api.get<FilePickerSession>(sessionPath(account));
        if (signal.aborted) return;
        const picked = await runPicker({
          frame,
          session,
          getToken: (resource) => fetchToken(resource, account),
          signal,
          onReady: () => setReady(true),
        });
        if (signal.aborted) return;
        setOpen(false);
        if (picked) importPicked(picked, account);
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

  const start = (account: string | undefined) => {
    setError(null);
    setReady(false);
    importItem.reset();
    setConnectionId(account);
    setChoosing(false);
    setOpen(true);
  };

  return {
    /** Several accounts: ask which one first; one (or none – the login follows): straight in. */
    open: () => {
      if (usable.length > 1) {
        setError(null);
        setChoosing(true);
        return;
      }
      start(usable[0]?.id);
    },
    close: () => setOpen(false),
    dialog: { open, ready, frameRef },
    chooser: {
      open: choosing,
      accounts: usable as readonly MicrosoftConnection[],
      onChoose: (account: MicrosoftConnection) => start(account.id),
      onClose: () => setChoosing(false),
    },
    pending: importItem.isPending,
    error,
  };
}
