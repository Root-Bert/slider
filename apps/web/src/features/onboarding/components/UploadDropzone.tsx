import { cn, ErrorText, useFileDrop } from '@/ui';

interface UploadDropzoneProps {
  /** The first file dropped – or, with `onFiles`, unused. */
  onFile?: (file: File) => void;
  /** Every file dropped. */
  onFiles?: (files: File[]) => void;
  /** What may be dropped, below „oder hierher ziehen“. */
  hint?: string;
  onBrowse: () => void;
  error: string | null;
}

/**
 * The whole dashed zone is one button that opens the file picker – no button, no icon inside
 * it – lit by the website's sage horizon (`drop-glow`), brighter on hover and while a file is dragged over.
 * Dropping a file anywhere on it works too.
 */
export function UploadDropzone({ onFile, onFiles, hint, onBrowse, error }: UploadDropzoneProps) {
  const { dragOver, handlers } = useFileDrop((files) => {
    if (onFiles) onFiles(files);
    else if (files[0]) onFile?.(files[0]);
  });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onBrowse}
        {...handlers}
        className={cn(
          'group relative flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-control border border-dashed px-4 py-10 transition-colors',
          // One border colour at a time: `cn` is clsx, and in the CSS `border-hairline-strong`
          // comes after `border-danger/45`, so both together never showed the error edge.
          dragOver
            ? 'border-fg'
            : error
              ? 'border-danger/45'
              : 'border-hairline-strong hover:border-fg-subtle',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'drop-glow pointer-events-none absolute inset-0 transition-opacity duration-300',
            dragOver ? 'opacity-100' : 'opacity-70 group-hover:opacity-100',
          )}
        />
        <span className="relative flex flex-col items-center gap-0.5">
          <span className="text-body font-medium text-fg">
            {dragOver ? 'Loslassen zum Hochladen' : 'Datei auswählen'}
          </span>
          <span className="text-caption text-fg-subtle">oder hierher ziehen</span>
          {hint && <span className="mt-2 text-caption text-fg-subtle">{hint}</span>}
        </span>
      </button>
      {error && (
        <ErrorText role="alert" size="xs">
          {error}
        </ErrorText>
      )}
    </div>
  );
}
