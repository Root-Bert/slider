/** Where a deck's panel (open comments, storage) opens instead of floating. */
export type DeckPanelKind = 'thumbnail' | 'row';

/** A slot element for a deck's panel and what kind of place it is. */
export interface DeckPanelSlot {
  element: HTMLElement | null;
  kind: DeckPanelKind;
}

interface DeckPanelStyle {
  /** The panel itself (`PopoverPanel`); its pop-in is off – the frame animates instead. */
  className: string;
  tone: 'elevated' | 'default';
  /** `DeckPanelFrame` around it, and its animation in and out. */
  frame: string;
  opening: string;
  closing: string;
}

export const DECK_PANEL: Record<DeckPanelKind, DeckPanelStyle> = {
  // Over a grid card's thumbnail: 8px inset, its corners concentric with the thumbnail's
  // (`rounded-panel` 16px minus the inset = `rounded-chip` 8px; `!` beats the `rounded-panel` of
  // `PopoverPanel`). Unrolls upwards from the bottom edge – towards the button that opened it –
  // and rolls back down; the frame lies above the card's stretched title link.
  thumbnail: {
    className: 'absolute inset-0 rounded-chip! animate-none!',
    tone: 'elevated',
    frame: 'absolute inset-2 z-(--z-popover)',
    opening: 'animate-unroll-up',
    closing: 'animate-roll-down',
  },
  // Under a list row, which expands: in the flow, positioned so it lies above the row's
  // stretched title link; the lighter glass, as it doesn't float. The frame is a one-row grid
  // sliding open to exactly the panel's height (`0fr` → `1fr`) and shut again.
  row: {
    className: 'relative min-h-0 max-h-80 animate-none! overflow-hidden',
    tone: 'default',
    frame: 'mt-2 grid grid-rows-[1fr]',
    opening: 'animate-expand-rows',
    closing: 'animate-collapse-rows',
  },
};
