import type { ReactNode } from 'react';
import { cn } from '@/ui';
import { DECK_PANEL, type DeckPanelKind } from '../lib/deck-panel';

/**
 * Around a deck's panel in the thumbnail or under the row: animates it in, and while `closing`
 * out again – then calls `onClosed` (see `usePanelPresence`). Each panel has its own, so one
 * closing while the other opens (comments ↔ storage) animates both.
 */
export function DeckPanelFrame({
  kind,
  closing = false,
  onClosed,
  children,
}: {
  kind: DeckPanelKind;
  closing?: boolean;
  onClosed?: () => void;
  children: ReactNode;
}) {
  const style = DECK_PANEL[kind];
  return (
    <div
      className={cn(style.frame, closing ? ['pointer-events-none', style.closing] : style.opening)}
      onAnimationEnd={(event) => {
        // Animations inside the panel (a reply list fading in) bubble up here too.
        if (closing && event.target === event.currentTarget) onClosed?.();
      }}
    >
      {children}
    </div>
  );
}
