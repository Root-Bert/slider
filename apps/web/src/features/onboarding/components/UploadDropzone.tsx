import { useState, type DragEvent } from 'react';
import { cn, ErrorText } from '@/ui';

interface UploadDropzoneProps {
  onFile: (file: File) => void;
  onBrowse: () => void;
  error: string | null;
}

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/**
 * The whole dashed zone is one button that opens the file picker – no button, no icon inside
 * it – lit by the website's sage horizon (`drop-glow`), brighter on hover and while a file is dragged over.
 * Dropping a file anywhere on it works too.
 */
export function UploadDropzone({ onFile, onBrowse, error }: UploadDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onBrowse}
        onDragEnter={(event) => {
          if (hasFiles(event)) setDragOver(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
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
