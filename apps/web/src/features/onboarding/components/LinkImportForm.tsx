import { useId } from 'react';
import { Button, Icon, TextField, type IconName } from '@/ui';

interface LinkImportFormProps {
  url: string;
  onChange: (url: string) => void;
  onBlur: () => void;
  onSubmit: () => void;
  error: string | null;
  pending: boolean;
  /** Primary "Öffnen" on the start screen, secondary once the form shows a problem (A3). */
  emphasis?: 'primary' | 'secondary';
  showSources?: boolean;
}

export function LinkImportForm({
  url,
  onChange,
  onBlur,
  onSubmit,
  error,
  pending,
  emphasis = 'primary',
  showSources = true,
}: LinkImportFormProps) {
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-start gap-2">
        <TextField
          type="url"
          size="lg"
          icon="link"
          aria-label="PowerPoint-Link"
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
      {showSources && <SupportedSources />}
    </form>
  );
}

const SOURCES: readonly { label: string; icon: IconName }[] = [
  { label: 'OneDrive', icon: 'cloud' },
  { label: 'SharePoint', icon: 'folder' },
  { label: 'PPTX', icon: 'description' },
];

function SupportedSources() {
  const labelId = useId();
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-fg-subtle">
      <span id={labelId}>Funktioniert mit</span>
      <ul aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {SOURCES.map((source) => (
          <li
            key={source.label}
            className="glass inline-flex h-7 items-center gap-1.5 rounded-[10px] px-2.5 text-fg-muted"
          >
            <Icon name={source.icon} size={14} />
            {source.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
