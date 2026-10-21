import { useEffect, useEffectEvent, type RefObject } from 'react';

/** A ref whose element counts as "inside"; `null`/`undefined` entries are skipped. */
export type DismissRef = RefObject<HTMLElement | null> | null | undefined;

/**
 * Closes a floating element (menu, popover) on Escape or a pointer press outside of `refs`.
 * Escape also hands focus back to `returnFocusTo`, so keyboard users don't get lost.
 *
 * Pass every element that counts as inside – the wrapper with the trigger and, for a panel
 * portalled out of it, the panel itself. Optional refs may be `null`/`undefined`.
 */
export function useDismiss({
  open,
  onDismiss,
  refs,
  returnFocusTo,
}: {
  open: boolean;
  onDismiss: () => void;
  refs: readonly DismissRef[];
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const handlePointerDown = useEffectEvent((event: PointerEvent) => {
    const target = event.target as Node;
    if (refs.some((ref) => ref?.current?.contains(target))) return;
    onDismiss();
  });

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onDismiss();
    returnFocusTo?.current?.focus();
  });

  useEffect(() => {
    if (!open) return;
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
}
