import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { cloudNameSchema } from '@slider/shared';
import { ConfirmDialog, TextField, type IconName } from '@/ui';

/**
 * A version's name: one name field. (Files and folders are named where they stand,
 * `NodeNameInput` – a new folder too.)
 */
export function NameDialog({
  title,
  label,
  initialName = '',
  placeholder,
  submitLabel,
  icon = 'folder',
  pending,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  /** Accessible name of the field. */
  label: string;
  initialName?: string;
  placeholder?: string;
  submitLabel: string;
  icon?: IconName;
  pending: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const parsed = cloudNameSchema.safeParse(name);
  const trimmed = name.trim();
  const problem = trimmed && !parsed.success ? parsed.error.issues[0]?.message : null;
  useEffect(() => {
    const input = field.current;
    if (!input || !initialName) return;
    input.setSelectionRange(0, initialName.length);
  }, [initialName]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed.success && !pending) onSubmit(parsed.data);
  };
  return (
    <ConfirmDialog
      onClose={onClose}
      title={title}
      tone="primary"
      confirmLabel={submitLabel}
      form={formId}
      pending={pending}
      confirmDisabled={!parsed.success || parsed.data === initialName}
    >
      <form id={formId} onSubmit={submit}>
        <TextField
          ref={field}
          aria-label={label}
          placeholder={placeholder}
          icon={icon}
          maxLength={200}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={name}
          error={problem ?? error}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </ConfirmDialog>
  );
}
