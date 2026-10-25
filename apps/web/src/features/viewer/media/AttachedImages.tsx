import { cn, IconButton, Spinner } from '@/ui';
import { useRef, type ChangeEvent } from 'react';
import type { ImageAttachment } from './hooks/useImageAttachments';
import { IMAGE_THUMB_CLASSES } from './lib/image-thumb';

/**
 * The images attached to the comment being written, as tiny 16:9 thumbnails inside the field,
 * each with a way to take it off again.
 */
export function AttachedImages({
  attachments,
  onRemove,
}: {
  attachments: readonly ImageAttachment[];
  onRemove: (attachment: ImageAttachment) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Angehängte Bilder" className="flex flex-wrap gap-1.5 pt-1.5">
      {attachments.map((attachment, index) => (
        <li key={attachment.url} className="group/thumb relative">
          <img
            src={attachment.url}
            alt={`Angehängtes Bild ${index + 1}`}
            className={IMAGE_THUMB_CLASSES}
          />
          <IconButton
            icon="close"
            label={`Bild ${index + 1} entfernen`}
            variant="glass"
            shape="round"
            size="xs"
            onClick={() => onRemove(attachment)}
            className="absolute -top-1.5 -right-1.5 scale-75 opacity-0 group-hover/thumb:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
          />
        </li>
      ))}
    </ul>
  );
}

/** Small button that opens the file picker for images – several at once (pasting works too). */
export function AttachImageButton({
  onPick,
  busy = false,
  disabled = false,
  size = 'sm',
}: {
  onPick: (files: File[]) => void;
  busy?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'compact';
}) {
  const input = useRef<HTMLInputElement>(null);
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    // The same files can be picked again.
    event.target.value = '';
    if (files.length > 0) onPick(files);
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={picked}
      />
      {/* Stays mounted while the images convert – the focus stays on it; a spinner over it. */}
      <span className="relative inline-flex shrink-0">
        <IconButton
          icon="attachFile"
          label="Bilder anhängen"
          title="Bilder anhängen – oder direkt ins Textfeld einfügen"
          variant="subtle"
          size={size}
          aria-busy={busy || undefined}
          // `aria-disabled`, not `disabled`: a disabled button would drop the focus.
          aria-disabled={busy || disabled || undefined}
          onClick={() => {
            if (!busy && !disabled) input.current?.click();
          }}
          className={cn(
            (busy || disabled) && 'cursor-default opacity-40',
            busy && '[&>svg]:invisible',
          )}
        />
        {busy && <Spinner size={16} className="pointer-events-none absolute inset-0 m-auto" />}
      </span>
    </>
  );
}
