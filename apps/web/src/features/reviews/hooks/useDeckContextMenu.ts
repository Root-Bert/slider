import { useCallback, useState, type MouseEvent } from 'react';

/**
 * Right click on a deck card/row opens its actions at the pointer (every deck can at least be
 * pinned); Shift + right click keeps the browser's own menu (open in new tab, …).
 */
export function useDeckContextMenu() {
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
  const onContextClose = useCallback(() => setContextAt(null), []);
  const onContextMenu = (event: MouseEvent) => {
    if (event.shiftKey) return;
    event.preventDefault();
    setContextAt({ x: event.clientX, y: event.clientY });
  };
  return { contextAt, onContextClose, onContextMenu };
}
