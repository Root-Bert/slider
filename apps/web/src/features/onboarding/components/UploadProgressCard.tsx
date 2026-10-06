import { formatBytes } from '@/lib/format';
import { Icon, IconButton, ProgressBar } from '@/ui';

/** Replaces the dropzone while a PPTX uploads (BER-91). */
export function UploadProgressCard({
  file,
  progress,
  onCancel,
}: {
  file: File;
  progress: number;
  onCancel: () => void;
}) {
  // XHR reports 100 % once the bytes are sent; the server still has to store and queue the file.
  const processing = progress >= 1;
  const percent = Math.round(progress * 100);

  return (
    <div className="glass flex items-center gap-3 rounded-panel p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-white/10 text-fg-muted">
        <Icon name="description" size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium text-fg">{file.name}</span>
          <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
            {formatBytes(file.size)} · {processing ? 'wird verarbeitet…' : `${percent} %`}
          </span>
        </div>
        <ProgressBar value={processing ? null : progress} label={`Upload von ${file.name}`} />
        <p role="status" className="sr-only">
          {processing ? 'Upload abgeschlossen, Datei wird verarbeitet' : 'Upload läuft'}
        </p>
      </div>
      <IconButton icon="close" label="Upload abbrechen" size="sm" onClick={onCancel} />
    </div>
  );
}
