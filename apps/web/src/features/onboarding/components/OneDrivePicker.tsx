import { useEffect, useRef, useState, type Ref } from 'react';
import { motionMs } from '@/lib/motion';
import { Button, cn, ErrorText, IconButton, MicrosoftMark, Spinner } from '@/ui';

/** Name the picker form targets; one picker at a time. */
const PICKER_FRAME_NAME = 'slider-onedrive-picker';
/** Matches the height/width transition below (`ease-sheet`); 0 for the timer under reduced motion. */
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
    }, motionMs(EXPAND_MS));
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
          <ErrorText role="alert" size="xs">
            {error}
          </ErrorText>
        )}
      </div>
    );
  }

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label="Aus OneDrive oder SharePoint auswählen"
      // Centred on the column, free to grow past it.
      className={cn(
        'glass relative left-1/2 flex -translate-x-1/2 flex-col overflow-hidden outline-none',
        'transition-[width,height,border-radius,background-color] ease-sheet',
        expanded
          ? 'h-[min(760px,max(420px,calc(100dvh-300px)))] w-[min(1080px,calc(100vw-32px))] rounded-panel bg-glass-elevated! shadow-float!'
          : 'h-11 w-full rounded-control shadow-none!',
      )}
      style={{ transitionDuration: `${EXPAND_MS}ms` }}
    >
      {/* The button's own label, gliding from the middle to the top left (and back) – the same
          words and type, so the button reads as the panel's title bar. */}
      <header className="relative h-11 shrink-0">
        <h2
          className={cn(
            'absolute top-1/2 flex -translate-y-1/2 items-center gap-2 text-sm font-medium whitespace-nowrap text-fg',
            'transition-[left,translate] ease-sheet',
            expanded ? 'left-5 translate-x-0' : 'left-1/2 -translate-x-1/2',
          )}
          style={{ transitionDuration: `${EXPAND_MS}ms` }}
        >
          <MicrosoftMark size={16} />
          Aus OneDrive oder SharePoint auswählen
        </h2>
        <IconButton
          icon="close"
          label="Schließen (Esc)"
          size="sm"
          onClick={onClose}
          className={cn(
            'absolute top-1/2 right-1.5 -translate-y-1/2 transition-opacity duration-200',
            expanded ? 'opacity-100 delay-150' : 'pointer-events-none opacity-0',
          )}
        />
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
            <Spinner size="xl" />
            <p className="text-xs">OneDrive wird geladen …</p>
          </div>
        )}
      </div>
      {/* The edge – the same hairline as the button's – drawn above everything: as the glass's own
          inset shadow the opaque frame would cover it at the sides and bottom. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-hairline"
      />
    </section>
  );
}
