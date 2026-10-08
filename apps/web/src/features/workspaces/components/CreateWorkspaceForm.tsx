import { useState, type ReactNode } from 'react';
import type { Workspace } from '@slider/shared';
import { useCreateWorkspace } from '@/lib/workspace-queries';
import { Button, TextField } from '@/ui';

const MAX_NAME = 80;

/** Name field + "Organisation erstellen"; calls `onCreated` once `/me` knows the new workspace. */
export function CreateWorkspaceForm({
  onCreated,
  autoFocus = false,
  secondaryAction,
}: {
  onCreated: (workspace: Workspace) => void;
  autoFocus?: boolean;
  /** E.g. "Abbrechen" in the dialog. */
  secondaryAction?: ReactNode;
}) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const create = useCreateWorkspace();
  const trimmed = name.trim();
  const error =
    touched && trimmed === '' ? 'Gib der Organisation einen Namen.' : create.error?.message;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (trimmed === '') return;
        create.mutate(trimmed, { onSuccess: onCreated });
      }}
    >
      <TextField
        label="Name"
        size="lg"
        placeholder="z. B. Marketing oder Agentur Nord"
        value={name}
        maxLength={MAX_NAME}
        autoFocus={autoFocus}
        error={error ?? null}
        hint="Den Namen sehen alle Mitglieder. Du kannst ihn später ändern."
        onChange={(event) => {
          setName(event.target.value);
          if (create.error) create.reset();
        }}
      />
      <div className="flex justify-end gap-2">
        {secondaryAction}
        <Button type="submit" size="lg" loading={create.isPending}>
          Organisation erstellen
        </Button>
      </div>
    </form>
  );
}
