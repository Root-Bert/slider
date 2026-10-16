import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useDismiss, type DismissRef } from './useDismiss';

export interface UsePopoverOptions {
  /** Further elements that count as inside (besides the wrapper and the panel). */
  extraRefs?: readonly DismissRef[];
  /** Escape hands the focus back to the trigger (default). */
  returnFocus?: boolean;
  /** `aria-haspopup` of the trigger; omitted by default (a plain disclosure). */
  hasPopup?: 'menu' | 'dialog' | 'listbox' | true;
  /** Called with the open state after every change (and once on mount). */
  onOpenChange?: (open: boolean) => void;
  initialOpen?: boolean;
}

export interface UsePopover {
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  toggle: () => void;
  close: () => void;
  /** Around trigger and (unportalled) panel – a press outside of it closes. */
  wrapperRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** For a panel rendered elsewhere (portal): it then still counts as inside. */
  panelRef: RefObject<HTMLElement | null>;
  panelId: string;
  /** Spread onto the trigger `<button>`: ref, aria-expanded/-controls/-haspopup, onClick. */
  triggerProps: {
    ref: RefObject<HTMLButtonElement | null>;
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
    'aria-haspopup'?: 'menu' | 'dialog' | 'listbox' | true;
    onClick: () => void;
  };
}

/**
 * Trigger + floating panel wiring (header popovers, the open-comments list, colour pickers):
 * open state, ids for aria-controls, and `useDismiss` (Escape / press outside closes, Escape
 * returns focus to the trigger). Render the panel with `PopoverPanel`.
 *
 * Destructure the result (`const { open, triggerProps, … } = usePopover()`): the React
 * compiler lint treats a whole object that holds refs as a ref and rejects reading it in render.
 */
export function usePopover({
  extraRefs = [],
  returnFocus = true,
  hasPopup,
  onOpenChange,
  initialOpen = false,
}: UsePopoverOptions = {}): UsePopover {
  const [open, setOpen] = useState(initialOpen);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  // An effect event: an inline `onOpenChange` doesn't re-fire on every render.
  const reportOpen = useEffectEvent((value: boolean) => onOpenChange?.(value));
  useEffect(() => reportOpen(open), [open]);

  useDismiss({
    open,
    onDismiss: close,
    refs: [wrapperRef, panelRef, ...extraRefs],
    returnFocusTo: returnFocus ? triggerRef : undefined,
  });

  return {
    open,
    setOpen,
    toggle,
    close,
    wrapperRef,
    triggerRef,
    panelRef,
    panelId,
    triggerProps: {
      ref: triggerRef,
      'aria-expanded': open,
      'aria-controls': open ? panelId : undefined,
      ...(hasPopup !== undefined && { 'aria-haspopup': hasPopup }),
      onClick: toggle,
    },
  };
}
