import { useEffect, useEffectEvent, type RefObject } from 'react';

/**
 * Closes a floating element (menu, popover) on Escape or a pointer press outside of `refs`.
 * Escape also hands focus back to `returnFocusTo`, so keyboard users don't get lost.
 */
export function useDismiss({
  open,
  onDismiss,
  refs,
  returnFocusTo,
}: {
  open: boolean;
  onDismiss: () => void;
  refs: readonly RefObject<HTMLElement | null>[];
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const handlePointerDown = useEffectEvent((event: PointerEvent) => {
    const target = event.target as Node;
    if (refs.some((ref) => ref.current?.contains(target))) return;
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
