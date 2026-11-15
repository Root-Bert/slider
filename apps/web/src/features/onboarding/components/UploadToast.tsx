import { IconButton, ProgressBar } from '@/ui';

/**
 * A file going up as a new presentation: a small toast at the bottom, where the others show –
 * its name, how far, a thin bar. Once sent the deck opens; nothing else on the page changes.
 */
export function UploadToast({
  file,
  progress,
  onCancel,
}: {
  file: File;
  progress: number;
  onCancel: () => void;
}) {
  // XHR reports 100 % once the bytes are sent; the server still has to read the file.
  const processing = progress >= 1;
  const percent = Math.round(progress * 100);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-(--z-toast) flex justify-center px-4">
      <div className="glass-elevated pointer-events-auto flex w-full max-w-[360px] animate-pop-in items-center gap-2 rounded-panel py-2 pr-2 pl-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-body">
            <span className="truncate text-fg">{file.name}</span>
            <span className="shrink-0 text-fg-subtle tabular-nums">
              {processing ? 'Wird geöffnet' : `${percent} %`}
            </span>
          </div>
          <ProgressBar value={processing ? null : progress} label={`Upload von ${file.name}`} />
          <p role="status" className="sr-only">
            {processing ? 'Upload abgeschlossen, Präsentation wird geöffnet' : 'Upload läuft'}
          </p>
        </div>
        {/* Once the bytes are sent the server creates the deck whatever the browser does, so
            there is nothing left to cancel (it could only pretend). */}
        {processing ? (
          <span className="size-8 shrink-0" />
        ) : (
          <IconButton icon="close" label="Upload abbrechen" size="sm" onClick={onCancel} />
        )}
      </div>
    </div>
  );
}
