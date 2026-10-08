import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Deck, FilePickerSession } from '@slider/shared';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys, useImportDriveItem } from '@/lib/queries';
import { openPickerWindow, runPicker } from '../lib/onedrive-picker';

const POPUP_BLOCKED_MESSAGE =
  'Dein Browser hat das OneDrive-Fenster blockiert. Erlaube Pop-ups für Slider und versuche es erneut.';
const FAILED_MESSAGE = 'Die OneDrive-Auswahl konnte nicht geöffnet werden.';

const fetchToken = async (resource: string) =>
  (await api.post<{ token: string }>('/microsoft/file-picker/token', { resource })).token;

/**
 * "Aus OneDrive auswählen": Microsoft's file picker in a popup (starting in "Geteilt"), then the
 * import of the picked PowerPoint. Without a Microsoft login the browser goes to sign in first
 * and comes back to the start page.
 */
export function useOneDrivePicker(workspaceId: string, onImported: (deck: Deck) => void) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importItem = useImportDriveItem(workspaceId);
  const queryClient = useQueryClient();

  const fail = (cause: unknown) => {
    if (cause instanceof ApiError && cause.code === 'microsoft_login_required' && cause.loginUrl) {
      window.location.assign(cause.loginUrl);
      return;
    }
    setError(cause instanceof ApiError ? cause.message : FAILED_MESSAGE);
  };

  const open = async () => {
    setError(null);
    importItem.reset();
    // Synchronously in the click, or the browser blocks the window.
    const popup = openPickerWindow();
    if (!popup) {
      setError(POPUP_BLOCKED_MESSAGE);
      return;
    }
    setPicking(true);
    let picked;
    try {
      const session = await api.get<FilePickerSession>('/microsoft/file-picker');
      picked = await runPicker(popup, session, fetchToken);
    } catch (cause) {
      popup.close();
      fail(cause);
      return;
    } finally {
      setPicking(false);
    }
    if (!picked) return;
    importItem.mutate(picked, {
      onSuccess: (deck) => {
        queryClient.setQueryData(queryKeys.deck(deck.id), deck);
        void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
        onImported(deck);
      },
      onError: fail,
    });
  };

  return {
    open: () => void open(),
    pending: picking || importItem.isPending,
    error,
  };
}
