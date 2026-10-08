import { useId } from 'react';
import { Button, TextField } from '@/ui';

interface LinkImportFormProps {
  url: string;
  onChange: (url: string) => void;
  onBlur: () => void;
  onSubmit: () => void;
  error: string | null;
  pending: boolean;
  /** Primary "Öffnen" on the start screen, secondary once the form shows a problem (A3). */
  emphasis?: 'primary' | 'secondary';
  /** Visible label above the field; without it the field is labelled for screen readers only. */
  label?: string;
}

export function LinkImportForm({
  url,
  onChange,
  onBlur,
  onSubmit,
  error,
  pending,
  emphasis = 'primary',
  label,
}: LinkImportFormProps) {
  const labelId = useId();
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {label && (
        <p id={labelId} className="text-sm font-medium text-fg">
          {label}
        </p>
      )}
      <div className="flex items-start gap-2">
        <TextField
          type="url"
          size="lg"
          icon="link"
          aria-label={label ? undefined : 'PowerPoint-Link'}
          aria-labelledby={label ? labelId : undefined}
          placeholder="PowerPoint-Link einfügen…"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          error={error}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="lg" variant={emphasis} loading={pending}>
          Öffnen
        </Button>
      </div>
    </form>
  );
}
