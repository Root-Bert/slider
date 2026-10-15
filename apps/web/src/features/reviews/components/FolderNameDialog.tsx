import { useState, type FormEvent } from 'react';
import { Button, Dialog, TextField } from '@/ui';

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
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed && !pending) onSubmit(trimmed);
  };
  return (
    <Dialog open onClose={onClose} title={title}>
      <form className="flex flex-col gap-5" onSubmit={submit}>
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
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={!trimmed || pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
