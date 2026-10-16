import { useId, useState, type FormEvent } from 'react';
import { ConfirmDialog, TextField } from '@/ui';

/** "Neuer Ordner" and "Umbenennen": one name field. */
export function FolderNameDialog({
  title,
  initialName = '',
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  initialName?: string;
  submitLabel: string;
  pending: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed && !pending) onSubmit(trimmed);
  };
  return (
    <ConfirmDialog
      onClose={onClose}
      title={title}
      tone="primary"
      confirmLabel={submitLabel}
      form={formId}
      confirmDisabled={!trimmed || pending}
    >
      <form id={formId} onSubmit={submit}>
        <TextField
          aria-label="Name des Ordners"
          placeholder="z. B. Kunde Müller"
          icon="folder"
          maxLength={80}
          autoFocus
          value={name}
          error={error}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </ConfirmDialog>
  );
}
