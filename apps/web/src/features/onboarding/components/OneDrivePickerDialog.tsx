import { useEffect, useId, useRef, type Ref } from 'react';
import { cn, IconButton, Spinner } from '@/ui';

/** Name the picker form targets; one picker at a time. */
const PICKER_FRAME_NAME = 'slider-onedrive-picker';

/**
 * Microsoft's OneDrive file picker, embedded in a large modal (native <dialog>, like the UI kit
 * "Modal"). The picker draws its own list, search and "Öffnen"/"Abbrechen".
 */
export function OneDrivePickerDialog({
  open,
  ready,
  onClose,
  frameRef,
}: {
  open: boolean;
  /** The picker page has loaded – until then a spinner covers the frame. */
  ready: boolean;
  onClose: () => void;
  frameRef: Ref<HTMLIFrameElement>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // Clicks on the backdrop land on the <dialog> element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        'glass-elevated m-auto overflow-hidden rounded-panel p-0 text-fg',
        'h-[min(720px,calc(100dvh-32px))] w-[min(1080px,calc(100vw-32px))]',
        'backdrop:bg-black/60 backdrop:backdrop-blur-sm open:flex open:animate-pop-in open:flex-col',
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 py-3 pr-3 pl-5">
        <h2 id={titleId} className="text-sm font-semibold text-fg">
          Aus OneDrive auswählen
        </h2>
        <IconButton icon="close" label="Schließen" size="sm" onClick={onClose} />
      </header>
      <div className="relative min-h-0 flex-1 border-t border-hairline bg-black">
        {open && (
          <iframe
            ref={frameRef}
            name={PICKER_FRAME_NAME}
            title="OneDrive-Dateiauswahl"
            className={cn('size-full transition-opacity', ready ? 'opacity-100' : 'opacity-0')}
          />
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-fg-subtle">
            <Spinner size={24} />
          </div>
        )}
      </div>
    </dialog>
  );
}
