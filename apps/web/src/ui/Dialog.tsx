import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * UI kit "Modal". Built on the native <dialog> element, so focus trapping,
 * Escape-to-close and the top layer come from the browser. Opening focuses the first element
 * with `data-autofocus` (a TextField with `autoFocus`), else the browser picks.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Where the press started: a text selection dragged out of a field ends on the backdrop too.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    // Most dialogs close by unmounting, where the browser never restores focus by itself.
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    // The field meant to take the keys: React focuses `autoFocus` fields while committing, when
    // this dialog is still closed (display: none), so the browser would pick the close button.
    // Fields and panels that want the focus carry `data-autofocus` (the kit's TextField does
    // for `autoFocus`).
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={(event) => {
        // The `close` event is queued: one left over from closing (e.g. StrictMode's effect
        // re-run, close + showModal) arrives while the dialog is open again – ignore it.
        if (!event.currentTarget.open) onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Clicks on the backdrop land on the <dialog> element itself – but so does a press
        // inside (e.g. selecting text in a field) released over the backdrop: only a press that
        // also started on the backdrop closes.
        const fromBackdrop = pressedBackdrop.current;
        pressedBackdrop.current = false;
        if (event.target === event.currentTarget && fromBackdrop) onClose();
      }}
      className={cn(
        'glass-elevated m-auto w-[min(480px,calc(100vw-32px))] rounded-panel p-0 text-fg',
        'max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain',
        'backdrop:bg-scrim backdrop:backdrop-blur-sm open:animate-pop-in',
        className,
      )}
    >
      <div className="flex flex-col gap-5 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {title}
            </h2>
            {description && <div className="text-body text-fg-subtle">{description}</div>}
          </div>
          <IconButton
            icon="close"
            label="Schließen"
            size="sm"
            onClick={onClose}
            className="-mt-1 -mr-2"
          />
        </header>
        {children}
        {footer && (
          // Wraps on narrow screens instead of pushing "Abbrechen" off the start edge.
          <footer className="flex flex-wrap items-center justify-end gap-2">{footer}</footer>
        )}
      </div>
    </dialog>
  );
}
