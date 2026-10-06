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

/** Dashed drop target (A1). The "Datei auswählen" button is the keyboard path to the file picker. */
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
          // Mouse convenience: the whole zone opens the picker; the inner button handles keyboard.
          if (event.target === event.currentTarget) onBrowse();
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-1.5 rounded-panel border border-dashed px-6 py-8 text-center transition-colors',
          dragOver ? 'border-fg bg-white/5' : 'border-hairline-strong hover:bg-white/[0.03]',
          error && !dragOver && 'border-danger/60',
        )}
      >
        <Icon name="upload" size={22} className="pointer-events-none text-fg-muted" />
        <p className="pointer-events-none text-sm font-medium text-fg">
          {dragOver ? 'Loslassen zum Hochladen' : 'Datei hierher ziehen'}
        </p>
        <p className="text-xs text-fg-subtle">
          oder{' '}
          <button
            type="button"
            onClick={onBrowse}
            className="text-fg-muted underline underline-offset-2 hover:text-fg"
          >
            Datei auswählen
          </button>{' '}
          · .pptx bis {formatBytes(MAX_UPLOAD_BYTES)}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
