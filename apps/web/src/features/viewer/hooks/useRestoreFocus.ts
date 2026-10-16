import { useEffect, useState } from 'react';

/**
 * Gives the focus back when a panel that took it closes (Esc, ✕, a thread deleted meanwhile):
 * to the control that had it before – the card, the tool bar button – instead of dropping it on
 * the page, where keyboard users would have to start over.
 */
export function useRestoreFocus() {
  // Read while rendering: before the panel's own `autoFocus` / focus effect takes it.
  const [previous] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );
  useEffect(
    () => () => {
      // Someone else took the focus meanwhile (another card, another panel): leave it there.
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected)
        previous.focus({ preventScroll: true });
    },
    [previous],
  );
}
