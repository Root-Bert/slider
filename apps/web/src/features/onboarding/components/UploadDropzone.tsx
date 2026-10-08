import { useState, type DragEvent } from 'react';
import { MAX_UPLOAD_BYTES } from '@slider/shared';
import { formatBytes } from '@/lib/format';
import { cn, Icon } from '@/ui';

interface UploadDropzoneProps {
  onFile: (file: File) => void;
  onBrowse: () => void;
  error: string | null;
}

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/** Slim dashed drop target – uploads are the rare path. "Datei auswählen" is the keyboard path. */
export function UploadDropzone({ onFile, onBrowse, error }: UploadDropzoneProps) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div
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
        onClick={(event) => {
          // Mouse convenience: the whole row opens the picker; the inner button handles keyboard.
          if (event.target === event.currentTarget) onBrowse();
        }}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-control border border-dashed px-4 py-3 transition-colors',
          dragOver ? 'border-fg bg-white/5' : 'border-hairline-strong hover:bg-white/[0.03]',
          error && !dragOver && 'border-danger/60',
        )}
      >
        <Icon name="upload" size={18} className="pointer-events-none shrink-0 text-fg-subtle" />
        <p className="pointer-events-none min-w-0 flex-1 text-sm text-fg-muted">
          {dragOver ? (
            'Loslassen zum Hochladen'
          ) : (
            <>
              PPTX hierher ziehen oder{' '}
              <button
                type="button"
                onClick={onBrowse}
                className="pointer-events-auto text-fg underline underline-offset-2 hover:text-fg"
              >
                Datei auswählen
              </button>
            </>
          )}
        </p>
        <span className="pointer-events-none shrink-0 text-xs text-fg-subtle">
          bis {formatBytes(MAX_UPLOAD_BYTES)}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
