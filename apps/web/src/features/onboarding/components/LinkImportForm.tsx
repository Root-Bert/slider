import { useId } from 'react';
import { Button, cn, TextField } from '@/ui';

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
  // "Öffnen" only slides in once there is something to open; Enter still submits regardless.
  const showSubmit = url.trim() !== '' || pending;
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
      <div className="flex items-start">
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
        <div
          inert={!showSubmit}
          className={cn(
            'grid transition-[grid-template-columns,opacity,translate] duration-300 ease-out motion-reduce:transition-none',
            showSubmit ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] translate-x-2 opacity-0',
          )}
        >
          <div className="overflow-hidden">
            <div className="pl-2">
              <Button type="submit" size="lg" variant={emphasis} loading={pending}>
                Öffnen
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
