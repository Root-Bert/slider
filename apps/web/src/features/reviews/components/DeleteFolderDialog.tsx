import type { DeckFolder } from '@slider/shared';
import { useDeleteFolder } from '@/lib/api';
import { ConfirmDialog } from '@/ui';

/**
 * "Ordner löschen?" – mounted only while it shows. A failure stays in the dialog: a toast would
 * sit behind its backdrop.
 */
export function DeleteFolderDialog({
  workspaceId,
  folder,
  onClose,
  onDeleted,
}: {
  workspaceId: string;
  folder: DeckFolder;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const deleteFolder = useDeleteFolder(workspaceId);
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`Ordner „${folder.name}“ löschen?`}
      description="Die Reviews darin bleiben erhalten und stehen danach wieder direkt in der Übersicht."
      confirmLabel="Ordner löschen"
      pending={deleteFolder.isPending}
      error={deleteFolder.error?.message}
      onConfirm={() => deleteFolder.mutate(folder.id, { onSuccess: onDeleted })}
    />
  );
}
