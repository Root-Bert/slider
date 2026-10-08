import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';

interface DialogProps {
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
 * Escape-to-close and the top layer come from the browser.
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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    // Most dialogs close by unmounting, where the browser never restores focus by itself.
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
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
        'glass-elevated m-auto w-[min(480px,calc(100vw-32px))] rounded-panel p-0 text-fg',
        'max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain',
        'backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-pop-in',
        className,
      )}
    >
      <div className="flex flex-col gap-5 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {title}
            </h2>
            {description && <div className="text-[13px] text-fg-subtle">{description}</div>}
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
        {footer && <footer className="flex items-center justify-end gap-2">{footer}</footer>}
      </div>
    </dialog>
  );
}
