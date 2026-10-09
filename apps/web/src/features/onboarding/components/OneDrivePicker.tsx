import { useEffect, useRef, useState, type Ref } from 'react';
import { MicrosoftMark } from '@/features/auth/components/MicrosoftMark';
import { Button, cn, IconButton, Spinner } from '@/ui';

/** Name the picker form targets; one picker at a time. */
const PICKER_FRAME_NAME = 'slider-onedrive-picker';
/** Matches the height/width transition below. */
const EXPAND_MS = 380;

/**
 * "Aus OneDrive oder SharePoint auswählen": the button itself opens up into Microsoft's file
 * picker, right in the page – it grows wider than the column and tall enough for the list, and
 * shrinks back into the button on close. The picker draws its own list, search and
 * "Öffnen"/"Abbrechen".
 */
export function OneDrivePicker({
  open,
  ready,
  onOpen,
  onClose,
  frameRef,
  pending,
  error,
  onShownChange,
}: {
  open: boolean;
  /** The picker page has loaded – until then a spinner stands in for the frame. */
  ready: boolean;
  onOpen: () => void;
  onClose: () => void;
  frameRef: Ref<HTMLIFrameElement>;
  /** The picked file is being imported. */
  pending: boolean;
  error: string | null;
  /** The panel is on the page (open, or still shrinking back). */
  onShownChange?: (shown: boolean) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // `expanded` drives the size: it turns on a frame after the panel mounts (so the growth
  // animates) and off before it unmounts (so it shrinks back first).
  const [grown, setGrown] = useState(false);
  const expanded = open && grown;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => setGrown(true));
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => {
      setGrown(false);
      setMounted(false);
    }, EXPAND_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Back to the button once the panel is gone, so keyboard users keep their place.
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (wasMounted.current && !mounted) buttonRef.current?.focus();
    wasMounted.current = mounted;
    onShownChange?.(mounted);
  }, [mounted, onShownChange]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    // Escape inside Microsoft's frame stays there; its own "Abbrechen" closes too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!mounted) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          ref={buttonRef}
          variant="secondary"
          size="lg"
          loading={pending}
          onClick={onOpen}
          className="w-full"
        >
          {!pending && <MicrosoftMark size={16} />}
          Aus OneDrive oder SharePoint auswählen
        </Button>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label="Aus OneDrive auswählen"
      // Centred on the column, free to grow past it.
      className={cn(
        'relative left-1/2 flex -translate-x-1/2 flex-col overflow-hidden outline-none',
        'transition-[width,height,border-radius,background-color] ease-[cubic-bezier(0.32,0.72,0,1)]',
        expanded
          ? 'glass-elevated h-[min(760px,max(420px,calc(100dvh-300px)))] w-[min(1080px,calc(100vw-32px))] rounded-panel'
          : 'glass h-11 w-full rounded-control',
      )}
      style={{ transitionDuration: `${EXPAND_MS}ms` }}
    >
      <header
        className={cn(
          'flex shrink-0 items-center justify-between gap-4 py-1.5 pr-1.5 pl-5 transition-opacity duration-200',
          expanded ? 'opacity-100 delay-100' : 'opacity-0',
        )}
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <MicrosoftMark size={16} />
          Aus OneDrive auswählen
        </h2>
        <IconButton icon="close" label="Schließen (Esc)" size="sm" onClick={onClose} />
      </header>
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        <iframe
          ref={frameRef}
          name={PICKER_FRAME_NAME}
          title="OneDrive-Dateiauswahl"
          className={cn(
            'size-full transition-opacity duration-300',
            ready && expanded ? 'opacity-100' : 'opacity-0',
          )}
        />
        {!ready && expanded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-subtle">
            <Spinner size={20} />
            <p className="text-xs">OneDrive wird geladen …</p>
          </div>
        )}
      </div>
      {/* The glass edge is an inset shadow, which the opaque frame would cover: draw it on top. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]"
      />
    </section>
  );
}
