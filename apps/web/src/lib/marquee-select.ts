import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from 'react';
import { isModKey } from '@/lib/keyboard';

export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MarqueeOptions {
  /** The attribute that marks an item and holds its id, e.g. `data-select-id`. */
  attribute: string;
  /** A drag began; `additive` (Shift/⌘/Ctrl held) keeps the items selected so far. */
  onStart: (additive: boolean) => void;
  /** The items the box touches right now (`[attribute]` inside the container). */
  onChange: (ids: string[]) => void;
  /** Plain click on empty space, no drag. */
  onClick: (additive: boolean) => void;
  /** Presses inside these never start a box (on top of controls and items). */
  ignore?: string;
  /**
   * The element that scrolls under the items, when it isn't the window (both ways then): the
   * drag scrolls it near its edges and follows its scrolling.
   */
  scroller?: RefObject<HTMLElement | null>;
}

/** Pixels the pointer has to travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Distance to the window edge where a drag starts scrolling, and the speed at the edge. */
const SCROLL_EDGE = 48;
const SCROLL_SPEED = 18;
/** Presses here are clicks on something, not the start of a selection box. */
const NOT_EMPTY_SPACE =
  'a, button, input, textarea, select, label, dialog, [role="menu"], [data-selection-bar]';

/** A right click here is on a control, not on the page's empty space (its own menu, if any). */
export const isOnControl = (target: EventTarget) =>
  (target as Element).closest('a, button, input, textarea, select, [role="menu"]') !== null;

/**
 * Click and drag on empty space draws a selection box (Finder-style) over the items inside
 * `containerRef` – which must be positioned, the box is drawn in its coordinates. Scrolls the
 * window (or `scroller`) while the pointer is near its edge.
 *
 * Render the box element (attached to `boxRef`) while `active`: its position is written straight
 * to the DOM once per frame, so dragging doesn't re-render the page on every mouse move.
 */
export function useMarqueeSelect(
  containerRef: RefObject<HTMLElement | null>,
  boxRef: RefObject<HTMLElement | null>,
  options: MarqueeOptions,
) {
  const [active, setActive] = useState(false);
  const geometry = useRef<MarqueeBox | null>(null);
  const paint = () => {
    const el = boxRef.current;
    const box = geometry.current;
    if (!el || !box) return;
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
  };
  // The box mounts a render after the drag starts: give it the geometry before it shows.
  useLayoutEffect(() => {
    if (active) paint();
  });
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    const { attribute, ignore } = latest.current;
    const target = event.target as Element;
    if (target.closest(NOT_EMPTY_SPACE) || target.closest(`[${attribute}]`)) return;
    if (ignore && target.closest(ignore)) return;
    const scroller = latest.current.scroller?.current ?? null;
    const container = containerRef.current;
    if (!container) return;
    // No text selection while dragging.
    event.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();

    const additive = event.shiftKey || isModKey(event);
    const origin = () => container.getBoundingClientRect();
    const toLocal = (x: number, y: number) => {
      const rect = origin();
      return { x: x - rect.left, y: y - rect.top };
    };
    const start = toLocal(event.clientX, event.clientY);
    // The layout doesn't change during a drag: measure the items once, in container coordinates.
    const base = origin();
    const items = Array.from(container.querySelectorAll<HTMLElement>(`[${attribute}]`), (el) => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute(attribute)!,
        left: rect.left - base.left,
        top: rect.top - base.top,
        right: rect.right - base.left,
        bottom: rect.bottom - base.top,
      };
    });

    let pointer = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let lastHits = '';
    let frame = 0;
    let moveFrame = 0;

    const update = () => {
      const end = toLocal(pointer.x, pointer.y);
      if (!dragging) {
        if (Math.hypot(end.x - start.x, end.y - start.y) < DRAG_THRESHOLD) return;
        dragging = true;
        latest.current.onStart(additive);
        setActive(true);
      }
      const next = {
        left: Math.min(start.x, end.x),
        top: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
      geometry.current = next;
      paint();
      const hits = items
        .filter(
          (item) =>
            item.left < next.left + next.width &&
            item.right > next.left &&
            item.top < next.top + next.height &&
            item.bottom > next.top,
        )
        .map((item) => item.id);
      const key = hits.join(' ');
      if (key !== lastHits) {
        lastHits = key;
        latest.current.onChange(hits);
      }
    };

    /** Speed along one axis: faster the closer `at` is to (or the further past) an edge. */
    const edgeSpeed = (at: number, low: number, high: number) => {
      const near = (distance: number) => SCROLL_SPEED * Math.min(1, 1 - distance / SCROLL_EDGE);
      if (at < low + SCROLL_EDGE) return -near(at - low);
      if (at > high - SCROLL_EDGE) return near(high - at);
      return 0;
    };
    const autoScroll = () => {
      frame = 0;
      if (!dragging) return;
      const rect = scroller?.getBoundingClientRect();
      const dy = edgeSpeed(pointer.y, rect?.top ?? 0, rect?.bottom ?? window.innerHeight);
      const dx = rect ? edgeSpeed(pointer.x, rect.left, rect.right) : 0;
      if (dx === 0 && dy === 0) return;
      if (scroller) scroller.scrollBy(dx, dy);
      else window.scrollBy(0, dy);
      frame = requestAnimationFrame(autoScroll);
    };

    // Mouse moves can come faster than the screen refreshes: draw at most once per frame.
    const scheduleUpdate = () => {
      if (!moveFrame)
        moveFrame = requestAnimationFrame(() => {
          moveFrame = 0;
          update();
        });
    };
    const onMove = (move: globalThis.MouseEvent) => {
      pointer = { x: move.clientX, y: move.clientY };
      scheduleUpdate();
      if (!frame) frame = requestAnimationFrame(autoScroll);
    };
    const onUp = () => {
      // The last move may still wait for its frame – the selection must match where the pointer let go.
      if (moveFrame) update();
      const wasDragging = dragging;
      cleanup.current?.();
      geometry.current = null;
      setActive(false);
      if (!wasDragging) latest.current.onClick(additive);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const scrolling: HTMLElement | Window = scroller ?? window;
    scrolling.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('blur', onUp);
    cleanup.current = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moveFrame);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      scrolling.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('blur', onUp);
      cleanup.current = null;
    };
  };

  return { active, onMouseDown };
}
