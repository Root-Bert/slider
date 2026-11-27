import {
  useLayoutEffect,
  useRef,
  type ElementType,
  type HTMLAttributes,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
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

/** The part of the screen a panel inside `from` shows in: cut by every box above that clips. */
function visibleSpan(from: HTMLElement) {
  let top = 0;
  let bottom = window.innerHeight;
  for (let box = from.parentElement; box && box !== document.body; box = box.parentElement) {
    const style = getComputedStyle(box);
    if (style.overflowY !== 'visible') {
      const rect = box.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    // A fixed box (a floating bar) is cut by no box around it.
    if (style.position === 'fixed') break;
  }
  return { top, bottom };
}

/**
 * Turns an anchored panel to the trigger's other side when it doesn't fit where it opens and
 * there is more room there – a menu low on a phone opens upwards; fitting nowhere whole, it
 * takes the larger room and scrolls. Room: what is visible, a scrolling side panel cuts it too. From the layout box, so the pop-in's scale doesn't skew it.
 */
function keepInView(panel: HTMLElement, side: PopoverSide) {
  const parent = panel.offsetParent;
  if (!(parent instanceof HTMLElement) || getComputedStyle(panel).position !== 'absolute') return;
  const { style } = panel;
  // Measured afresh on each render: a list scrolled inside keeps its place.
  const scrolled = panel.scrollTop;
  style.top = style.bottom = style.marginTop = style.marginBottom = '';
  style.maxHeight = style.overflowY = style.transformOrigin = '';
  const computed = getComputedStyle(panel);
  const gap = parseFloat(computed.marginTop) + parseFloat(computed.marginBottom);
  const box = parent.getBoundingClientRect();
  const span = visibleSpan(parent);
  const room = {
    bottom: span.bottom - box.bottom - gap - VIEWPORT_MARGIN_PX,
    top: box.top - span.top - gap - VIEWPORT_MARGIN_PX,
  };
  const height = panel.offsetHeight;
  const other = side === 'bottom' ? 'top' : 'bottom';
  const opens = height > room[side] && room[other] > room[side] ? other : side;
  if (opens !== side) {
    style.top = opens === 'bottom' ? '100%' : 'auto';
    style.bottom = opens === 'top' ? '100%' : 'auto';
    style.marginTop = opens === 'bottom' ? `${gap}px` : '0';
    style.marginBottom = opens === 'top' ? `${gap}px` : '0';
    // Pops out of the corner it now touches: its side as before, the other end.
    style.transformOrigin = `${computed.transformOrigin.split(' ')[0]} ${opens === 'top' ? '100%' : '0'}`;
  }
  if (height > room[opens]) {
    style.maxHeight = `${Math.max(room[opens], 0)}px`;
    style.overflowY = 'auto';
    panel.scrollTop = scrolled;
  }
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
      // A glass it opens in leaves its blur meanwhile (index.css), so this one blurs the page.
      data-popover-panel=""
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
        if (!panel) return;
        keepOnScreen(panel);
        if (anchored) keepInView(panel, side);
      }}
      {...props}
    />
  );
}

/**
 * Places a fixed panel at `anchor`: on its `side` – the other one when it doesn't fit there and
 * there is more room – lined up with its `align` edge, inside the screen; fitting nowhere whole,
 * it takes the larger room and scrolls. Written to its style, not state: what is inside (a
 * recording) never renders again for a scroll. From the layout box, so the pop-in's scale doesn't
 * skew it.
 */
function placeFixed(
  panel: HTMLElement,
  anchor: HTMLElement,
  side: PopoverSide,
  align: PopoverAlign,
  gap: number,
) {
  const { style } = panel;
  const scrolled = panel.scrollTop;
  style.maxHeight = style.overflowY = '';
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const box = anchor.getBoundingClientRect();
  const screen = { width: document.documentElement.clientWidth, height: window.innerHeight };
  const room = {
    bottom: screen.height - box.bottom - gap - VIEWPORT_MARGIN_PX,
    top: box.top - gap - VIEWPORT_MARGIN_PX,
  };
  const other = side === 'bottom' ? 'top' : 'bottom';
  const opens = height > room[side] && room[other] > room[side] ? other : side;
  // The anchor scrolled (nearly) out of view: it keeps a usable height on the screen's edge.
  const shown = Math.min(height, Math.max(room[opens], FLOATING_MIN_PX));
  const left = align === 'end' ? box.right - width : box.left;
  const top = opens === 'bottom' ? box.bottom + gap : box.top - gap - shown;
  style.left = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(left, screen.width - width - VIEWPORT_MARGIN_PX))}px`;
  style.top = `${Math.max(VIEWPORT_MARGIN_PX, Math.min(top, screen.height - shown - VIEWPORT_MARGIN_PX))}px`;
  style.transformOrigin = `${align === 'end' ? '100%' : '0'} ${opens === 'top' ? '100%' : '0'}`;
  if (height > shown) {
    style.maxHeight = `${shown}px`;
    style.overflowY = 'auto';
    panel.scrollTop = scrolled;
  }
  style.opacity = style.pointerEvents = '';
}

/** The least a fixed panel shows of itself, however little room there is. */
const FLOATING_MIN_PX = 160;

export interface FloatingPanelProps extends Omit<PopoverPanelProps, 'position'> {
  /** What it opens at – the field or button it belongs to. */
  anchor: RefObject<HTMLElement | null>;
}

/**
 * A `PopoverPanel` portalled into `<body>` (the fullscreen element while there is one) and placed
 * fixed at `anchor`: no scrolling or clipping box around the anchor (a widget, a side panel) cuts
 * it, no glass card after it paints over it. It follows the anchor on scroll and keeps placing
 * itself as it or the anchor grows. Counts as inside for `useDismiss`.
 */
export function FloatingPanel({
  anchor,
  side = 'bottom',
  align = 'start',
  offset = 'md',
  className,
  ref,
  ...props
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const gap = offset === 'sm' ? 4 : 8;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const at = anchor.current;
    if (!panel || !at) return;
    const place = () => placeFixed(panel, at, side, align, gap);
    place();
    // As it changes inside (pick, record, edit) and the anchor grows with text and files.
    const observer = new ResizeObserver(place);
    observer.observe(at);
    observer.observe(panel);
    for (const child of panel.children) observer.observe(child);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, side, align, gap]);
  return createPortal(
    <PopoverPanel
      {...props}
      ref={(panel: HTMLElement | null) => {
        panelRef.current = panel;
        if (typeof ref === 'function') ref(panel);
        else if (ref) ref.current = panel;
      }}
      data-floating-menu=""
      position="none"
      offset={offset}
      // Unseen until placed, so it never flashes at the top left corner – transparent, not
      // `visibility: hidden`: what is inside may take the focus before it is placed.
      style={{ opacity: 0, pointerEvents: 'none', ...props.style }}
      className={cn('fixed top-0 left-0', className)}
    />,
    document.fullscreenElement ?? document.body,
  );
}
