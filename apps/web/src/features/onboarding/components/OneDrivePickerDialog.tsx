import { useEffect, useId, useRef, useState, type Ref, type RefObject } from 'react';
import { MicrosoftMark } from '@/features/auth/components/MicrosoftMark';
import { cn, IconButton, Spinner } from '@/ui';

/** Name the picker form targets; one picker at a time. */
const PICKER_FRAME_NAME = 'slider-onedrive-picker';

/** The button grows into the panel (and shrinks back on close). */
const MORPH: KeyframeAnimationOptions = {
  duration: 380,
  easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
};

/** Geometry and surface of `element` as a keyframe, so the dialog can take its place. */
function surfaceOf(element: HTMLElement): Keyframe {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    margin: '0px',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: style.borderRadius,
    backgroundColor: style.backgroundColor,
    boxShadow: style.boxShadow,
  };
}

/** Hides the button while the panel stands in for it. */
function setStandIn(anchor: HTMLElement, active: boolean) {
  anchor.style.visibility = active ? 'hidden' : '';
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Microsoft's OneDrive file picker in a large panel that grows out of the button that opened it
 * (`anchorRef`) – no dimmed page behind it. A native <dialog> keeps focus and Escape. The picker
 * draws its own list, search and "Öffnen"/"Abbrechen".
 */
export function OneDrivePickerDialog({
  open,
  ready,
  onClose,
  frameRef,
  anchorRef,
}: {
  open: boolean;
  /** The picker page has loaded – until then a spinner stands in for the frame. */
  ready: boolean;
  onClose: () => void;
  frameRef: Ref<HTMLIFrameElement>;
  /** The button the panel grows out of; without it the panel pops in. */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Keeps the frame while the panel shrinks back, so it does not empty before it is gone.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const dialog = ref.current;
    const content = contentRef.current;
    if (!dialog || !content) return;
    const anchor = anchorRef.current?.isConnected ? anchorRef.current : null;
    const motion = !reducedMotion();
    const stop = () =>
      [dialog, content].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));

    // Reopened while shrinking back: stay open at full size.
    if (open && dialog.open) return stop();

    if (open) {
      dialog.showModal();
      if (!motion) return;
      if (anchor) {
        setStandIn(anchor, true);
        // Ends on the panel's own (responsive) size, so nothing has to stay filled in.
        dialog.animate([surfaceOf(anchor), surfaceOf(dialog)], MORPH);
        content.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 220,
          delay: 140,
          fill: 'backwards',
        });
      } else {
        dialog.animate(
          [
            { opacity: 0, scale: 0.96 },
            { opacity: 1, scale: 1 },
          ],
          MORPH,
        );
      }
      return;
    }

    if (dialog.open) {
      const finish = () => {
        // Show the button again first, so the dialog can hand focus back to it.
        if (anchor) setStandIn(anchor, false);
        dialog.close();
        stop();
        setMounted(false);
      };
      if (!motion) return finish();
      // Start from where the panel is now, even if it is still growing.
      const from = surfaceOf(dialog);
      stop();
      content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
      const shrink = anchor
        ? dialog.animate([from, surfaceOf(anchor)], { ...MORPH, fill: 'forwards' })
        : dialog.animate(
            [
              { opacity: 1, scale: 1 },
              { opacity: 0, scale: 0.96 },
            ],
            { ...MORPH, duration: 160, fill: 'forwards' },
          );
      // Cancelled when reopened mid-way.
      shrink.finished.then(finish, () => {});
    }
  }, [open, anchorRef]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: shrink back first, close afterwards.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Clicks next to the panel land on the <dialog> element itself.
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        'glass-elevated fixed inset-0 m-auto overflow-hidden rounded-panel p-0 text-fg',
        'h-[min(720px,calc(100dvh-32px))] w-[min(1080px,calc(100vw-32px))]',
        'backdrop:bg-transparent open:flex open:flex-col',
      )}
    >
      <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 py-3 pr-3 pl-5">
          <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-fg">
            <MicrosoftMark size={16} />
            Aus OneDrive auswählen
          </h2>
          <IconButton icon="close" label="Schließen" size="sm" onClick={onClose} />
        </header>
        <div className="relative min-h-0 flex-1 border-t border-hairline">
          {mounted && (
            <iframe
              ref={frameRef}
              name={PICKER_FRAME_NAME}
              title="OneDrive-Dateiauswahl"
              className={cn(
                'size-full transition-opacity duration-300',
                ready ? 'opacity-100' : 'opacity-0',
              )}
            />
          )}
          {!ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-subtle">
              <Spinner size={20} />
              <p className="text-xs">OneDrive wird geladen …</p>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
