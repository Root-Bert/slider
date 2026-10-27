import { useState } from 'react';
import { useSaveEdit } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { ConfirmDialog, IconButton, Spinner } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { useEditing } from './editing-context';

/**
 * The tool bar's buttons while editing (BER-181): saving back to Nextcloud – what the slides
 * themselves do not show. Undo and redo are ⌘Z and ⇧⌘Z; the download sits in the deck pill.
 */
export function EditActions() {
  const editing = useEditing();
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const save = useSaveEdit(deck.id);
  const [conflict, setConflict] = useState(false);
  const state = editing.state;
  if (!editing.active) return null;

  const onSave = (overwrite = false) =>
    save.mutate(
      { overwrite },
      {
        onSuccess: () => {
          setConflict(false);
          toast('In Nextcloud gespeichert');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'edit_conflict') setConflict(true);
          else toast(error.message, 'danger');
        },
      },
    );

  return (
    <>
      {state?.saveTarget === 'nextcloud' && (
        <IconButton
          icon="upload"
          label={state.unsaved ? 'In Nextcloud speichern' : 'In Nextcloud gespeichert'}
          title={
            state.changedInCloud
              ? 'In Nextcloud speichern – die Datei wurde dort inzwischen geändert'
              : undefined
          }
          size="sm"
          variant={state.unsaved ? 'primary' : undefined}
          disabled={!state.unsaved || save.isPending}
          onClick={() => onSave()}
        />
      )}
      {(editing.busy || save.isPending) && <Spinner size="sm" label="Wird gespeichert" />}
      <ConfirmDialog
        open={conflict}
        onClose={() => setConflict(false)}
        title="In Nextcloud geändert"
        description="Jemand hat die Datei in Nextcloud inzwischen gespeichert. Trotzdem überschreiben? Nextcloud behält die andere Version in ihrem Verlauf."
        confirmLabel="Überschreiben"
        pending={save.isPending}
        onConfirm={() => onSave(true)}
      />
    </>
  );
}
