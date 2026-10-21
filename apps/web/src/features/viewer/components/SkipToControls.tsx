import { buttonClasses, cn } from '@/ui';

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Focuses the first control of the row – the pointer tool, or the filter when view-only. Skips
 * what Tab wouldn't reach: roving-tabindex items (`tabindex="-1"`) and hidden parts. Returns
 * whether the focus got there.
 */
function focusControls(targetId: string): boolean {
  const target = [
    ...(document.getElementById(targetId)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
  ].find((element) => element.tabIndex >= 0 && !element.closest('[hidden], [inert]'));
  target?.focus();
  return target !== undefined && document.activeElement === target;
}

/**
 * The viewer's first focus stop, hidden until it has the focus: leads keyboard users past the
 * slides on the track straight to the controls row (`targetId`) – by Enter, and by Tab, which
 * would otherwise go on through every slide first.
 */
export function SkipToControls({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      onClick={(event) => {
        // Only the focus moves; the address keeps no `#…`.
        event.preventDefault();
        focusControls(targetId);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.shiftKey) return;
        // Nothing to go to (yet): Tab goes on as usual.
        if (focusControls(targetId)) event.preventDefault();
      }}
      className={cn(
        buttonClasses({ variant: 'secondary', size: 'sm' }),
        'fixed top-4 left-4 z-(--z-toast) not-focus:sr-only',
      )}
    >
      Zu den Bedienelementen
    </a>
  );
}
