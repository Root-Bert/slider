import { useState } from 'react';
import type { DeckFolder } from '@slider/shared';
import { useCreateFolder, useRenameFolder } from '@/lib/api';

export type FolderDialogState = { mode: 'create' } | { mode: 'rename'; folder: DeckFolder } | null;

/**
 * The "Neuer Ordner" / "Ordner umbenennen" dialog with its two mutations. The mutations outlive
 * the dialog, so every open and close resets them: an earlier failed attempt never shows its
 * error under a fresh, empty field (or under another folder's rename).
 */
export function useFolderDialog(workspaceId: string) {
  const createFolder = useCreateFolder(workspaceId);
  const renameFolder = useRenameFolder(workspaceId);
  const [state, setState] = useState<FolderDialogState>(null);

  const show = (next: FolderDialogState) => {
    createFolder.reset();
    renameFolder.reset();
    setState(next);
  };
  const close = () => show(null);
  const mutation = state?.mode === 'rename' ? renameFolder : createFolder;

  const submit = (name: string) => {
    if (!state) return;
    if (state.mode === 'create') createFolder.mutate(name, { onSuccess: close });
    else renameFolder.mutate({ folderId: state.folder.id, name }, { onSuccess: close });
  };

  return {
    state,
    openCreate: () => show({ mode: 'create' }),
    openRename: (folder: DeckFolder) => show({ mode: 'rename', folder }),
    close,
    submit,
    pending: createFolder.isPending || renameFolder.isPending,
    error: mutation.error?.message,
  };
}
