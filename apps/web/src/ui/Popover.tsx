import type { ElementType, HTMLAttributes, Ref } from 'react';
import { cn } from './cn';

export type PopoverSide = 'top' | 'bottom';
export type PopoverAlign = 'start' | 'end';

export interface PopoverPanelProps extends HTMLAttributes<HTMLElement> {
  /** `section` for a labelled panel (`aria-labelledby`), `div` otherwise. */
  as?: 'div' | 'section';
  /** Opens below (`bottom`, default) or above (`top`) the trigger. */
  side?: PopoverSide;
  /** Lines up with the trigger's left (`start`, default) or right (`end`) edge. */
  align?: PopoverAlign;
  /** `anchored` (default): absolute next to the trigger; `none`: position it via `className`. */
  position?: 'anchored' | 'none';
  /** Distance to the trigger: `sm` 4px (menus), `md` 8px (popovers, default). */
  offset?: 'sm' | 'md';
  /** `elevated` (default): `glass-elevated`; `default`: the lighter `glass-control`. */
  tone?: 'elevated' | 'default';
  /**
   * Inner padding: `none`; `sm` 4px (menus, items get `inset={4}`); `md` 6px (header popovers,
   * `inset={6}`); `lg` 12px (free content such as a colour picker).
   */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  ref?: Ref<HTMLElement>;
}

const paddingClasses = { none: '', sm: 'p-1', md: 'p-1.5', lg: 'p-3' } as const;

/** Room an absolutely placed panel keeps to the sides of the screen. */
const VIEWPORT_MARGIN_PX = 16;

/**
 * Moves an absolutely placed panel sideways back onto the screen – on a narrow phone a panel
 * lined up with its trigger may reach past the edge and make the whole page scroll sideways.
 * From the layout box (`offsetLeft`), so the pop-in's scale doesn't skew it.
 */
function keepOnScreen(panel: HTMLElement) {
  const parent = panel.offsetParent;
  if (!(parent instanceof HTMLElement) || getComputedStyle(panel).position !== 'absolute') return;
  const left = parent.getBoundingClientRect().left + panel.offsetLeft;
  const right = left + panel.offsetWidth;
  const max = document.documentElement.clientWidth - VIEWPORT_MARGIN_PX;
  const shift =
    right > max
      ? Math.max(max - right, VIEWPORT_MARGIN_PX - left)
      : Math.max(0, VIEWPORT_MARGIN_PX - left);
  panel.style.translate = shift === 0 ? '' : `${shift}px 0`;
}

/**
 * The floating panel of a popover or menu: elevated glass, panel radius, pop-in, the popover
 * layer and – by default – anchored to the `relative` wrapper of its trigger (`usePopover`).
 */
export function PopoverPanel({
  as = 'div',
  side = 'bottom',
  align = 'start',
  position = 'anchored',
  offset = 'md',
  tone = 'elevated',
  padding = 'none',
  className,
  ref,
  ...props
}: PopoverPanelProps) {
  const anchored = position === 'anchored';
  // `div` and `section` share HTMLElement's props; the union only trips over `ref`'s element type.
  const Component = as as ElementType;
  return (
    <Component
      className={cn(
        tone === 'elevated' ? 'glass-elevated' : 'glass-control',
        'z-(--z-popover) flex animate-pop-in flex-col rounded-panel',
        paddingClasses[padding],
        anchored && [
          'absolute',
          side === 'bottom' ? 'top-full' : 'bottom-full',
          side === 'bottom'
            ? offset === 'sm'
              ? 'mt-1'
              : 'mt-2'
            : offset === 'sm'
              ? 'mb-1'
              : 'mb-2',
          align === 'start' ? 'left-0' : 'right-0',
          // Pops out of the trigger's corner.
          side === 'bottom'
            ? align === 'start'
              ? 'origin-top-left'
              : 'origin-top-right'
            : align === 'start'
              ? 'origin-bottom-left'
              : 'origin-bottom-right',
        ],
        className,
      )}
      ref={(panel: HTMLElement | null) => {
        if (typeof ref === 'function') ref(panel);
        else if (ref) ref.current = panel;
        if (panel) keepOnScreen(panel);
      }}
      {...props}
    />
  );
}
