import { useState } from 'react';

/**
 * Keeps a deck's panel mounted while it animates out: after `open` turns false it stays
 * `mounted` (and `closing`) until its `DeckPanelFrame` calls `onClosed`. Without animation (a
 * popover or dialog instead) it goes at once.
 */
export function usePanelPresence(open: boolean, animated: boolean) {
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open && animated);
  }
  return { mounted: open || closing, closing, onClosed: () => setClosing(false) };
}
