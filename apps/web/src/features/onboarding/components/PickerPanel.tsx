import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motionMs } from '@/lib/motion';
import { Button, cn, ErrorText, IconButton } from '@/ui';
import {
  PICKER_EXPAND_MS,
  PICKER_PANEL_HEIGHT,
  PICKER_PANEL_WIDTH,
  PICKER_SURFACE_TRANSITION,
} from '../lib/picker-motion';

/** The header's height: the button's (`h-11`), so its label stays where it was. */
const HEADER_PX = 44;

/**
 * The surface in both states, all in one transition: it starts as the secondary button exactly
 * (`glass-control`: its tint, light blur, no shadow) and ends as an elevated panel – no jump when
 * the button hands over to the panel, or back.
 */
const surface = (expanded: boolean): CSSProperties => {
  const blur = expanded ? 'blur(24px) saturate(140%)' : 'blur(4px) saturate(140%)';
  return {
    width: expanded ? PICKER_PANEL_WIDTH : '100%',
    height: expanded ? PICKER_PANEL_HEIGHT : `${HEADER_PX}px`,
    borderRadius: expanded ? 'var(--radius-panel)' : 'var(--radius-control)',
    backgroundColor: expanded ? 'var(--color-glass-elevated)' : 'var(--color-glass-control)',
    boxShadow: expanded ? 'var(--shadow-float)' : '0 0 0 0 transparent',
    backdropFilter: blur,
    WebkitBackdropFilter: blur,
    transition: PICKER_SURFACE_TRANSITION,
  };
};

/**
 * A source button that opens up into its file picker, right in the page – it grows wider than
 * the column and tall enough for the list, and shrinks back into the button on close. Shared by
 * OneDrive/SharePoint and Nextcloud so both open the same way.
 */
export function PickerPanel({
  open,
  onOpen,
  onClose,
  label,
  mark,
  pending = false,
  error = null,
  onShownChange,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The button's words, which become the panel's title. */
  label: string;
  mark: ReactNode;
  /** The picked file is being imported (from the button's side). */
  pending?: boolean;
  error?: string | null;
  /** The panel is on the page (open, or still shrinking back). */
  onShownChange?: (shown: boolean) => void;
  /** The panel's body (it fades itself); `expanded` once it has grown, until it shrinks. */
  children: (expanded: boolean) => ReactNode;
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
      const frame = requestAnimationFrame(() => {
        // Lay the button-sized panel out first, so the browser has a start to grow from.
        panelRef.current?.getBoundingClientRect();
        setGrown(true);
      });
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => {
      setGrown(false);
      setMounted(false);
    }, motionMs(PICKER_EXPAND_MS)); // 0 under reduced motion
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
    // Escape inside an embedded frame stays there; its own "Abbrechen" closes too.
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
          {!pending && mark}
          {label}
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
      aria-label={label}
      data-expanded={expanded || undefined}
      // Centred on the column, free to grow past it.
      className="relative left-1/2 flex -translate-x-1/2 flex-col overflow-hidden outline-none"
      style={surface(expanded)}
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
          style={{ transitionDuration: `${PICKER_EXPAND_MS}ms` }}
        >
          {mark}
          {label}
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
      <div
        className={cn(
          'relative min-h-0 flex-1 border-t transition-colors duration-300',
          expanded ? 'border-hairline' : 'border-transparent',
        )}
      >
        {/* Laid out once at the open panel's size and centred, so the growing panel unveils it
            instead of squeezing it (no reflow of the list or Microsoft's page every frame). It
            fades in as the panel settles and out at once when it starts to shrink. */}
        <div
          className={cn(
            'absolute top-0 left-1/2 flex -translate-x-1/2 flex-col transition-opacity',
            expanded ? 'opacity-100 delay-200 duration-300' : 'opacity-0 duration-100',
          )}
          style={{
            width: PICKER_PANEL_WIDTH,
            height: `calc(${PICKER_PANEL_HEIGHT} - ${HEADER_PX + 1}px)`,
          }}
        >
          {children(expanded)}
        </div>
      </div>
      {/* The edge – the same hairline as the button's – drawn above everything: as the glass's own
          inset shadow an opaque frame would cover it at the sides and bottom. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-hairline"
      />
    </section>
  );
}
