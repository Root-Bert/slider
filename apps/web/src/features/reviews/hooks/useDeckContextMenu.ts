import { useCallback, useState, type MouseEvent } from 'react';
import type { Deck } from '@slider/shared';

/**
 * Right click on a deck card/row opens its actions at the pointer. Only for decks the viewer
 * manages; Shift + right click keeps the browser's own menu (open in new tab, …).
 */
export function useDeckContextMenu(deck: Deck) {
  const [contextAt, setContextAt] = useState<{ x: number; y: number } | null>(null);
  const onContextClose = useCallback(() => setContextAt(null), []);
  const onContextMenu = (event: MouseEvent) => {
    if (!deck.permissions.canManage || event.shiftKey) return;
    event.preventDefault();
    setContextAt({ x: event.clientX, y: event.clientY });
  };
  return { contextAt, onContextClose, onContextMenu };
}
