import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

export interface MarqueeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MarqueeOptions {
  /** A drag began; `additive` (Shift/⌘/Ctrl held) keeps the decks selected so far. */
  onStart: (additive: boolean) => void;
  /** The decks the box touches right now (`[data-deck-id]` inside the container). */
  onChange: (deckIds: string[]) => void;
  /** Plain click on empty space, no drag. */
  onClick: (additive: boolean) => void;
}

/** Pixels the pointer has to travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;
/** Distance to the window edge where a drag starts scrolling, and the speed at the edge. */
const SCROLL_EDGE = 48;
const SCROLL_SPEED = 18;
/** Presses here are clicks on something, not the start of a selection box. */
const NOT_EMPTY_SPACE =
  'a, button, input, textarea, select, label, dialog, [role="menu"], [data-deck-id], [data-selection-bar]';

/**
 * Click and drag on empty space draws a selection box (Finder-style) over the decks inside
 * `containerRef` – which must be positioned, the box is drawn in its coordinates. Scrolls the
 * window while the pointer is near its top or bottom edge.
 */
export function useMarqueeSelect(
  containerRef: RefObject<HTMLElement | null>,
  options: MarqueeOptions,
) {
  const [box, setBox] = useState<MarqueeBox | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    if ((event.target as Element).closest(NOT_EMPTY_SPACE)) return;
    const container = containerRef.current;
    if (!container) return;
    // No text selection while dragging.
    event.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const origin = () => container.getBoundingClientRect();
    const toLocal = (x: number, y: number) => {
      const rect = origin();
      return { x: x - rect.left, y: y - rect.top };
    };
    const start = toLocal(event.clientX, event.clientY);
    // The layout doesn't change during a drag: measure the decks once, in container coordinates.
    const base = origin();
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-deck-id]'), (el) => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.dataset.deckId!,
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

    const update = () => {
      const end = toLocal(pointer.x, pointer.y);
      if (!dragging) {
        if (Math.hypot(end.x - start.x, end.y - start.y) < DRAG_THRESHOLD) return;
        dragging = true;
        latest.current.onStart(additive);
      }
      const next = {
        left: Math.min(start.x, end.x),
        top: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
      setBox(next);
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

    const autoScroll = () => {
      frame = 0;
      if (!dragging) return;
      const { y } = pointer;
      const speed =
        y < SCROLL_EDGE
          ? -SCROLL_SPEED * (1 - y / SCROLL_EDGE)
          : y > window.innerHeight - SCROLL_EDGE
            ? SCROLL_SPEED * (1 - (window.innerHeight - y) / SCROLL_EDGE)
            : 0;
      if (speed === 0) return;
      window.scrollBy(0, speed);
      frame = requestAnimationFrame(autoScroll);
    };

    const onMove = (move: globalThis.MouseEvent) => {
      pointer = { x: move.clientX, y: move.clientY };
      update();
      if (!frame) frame = requestAnimationFrame(autoScroll);
    };
    const onUp = () => {
      const wasDragging = dragging;
      cleanup.current?.();
      setBox(null);
      if (!wasDragging) latest.current.onClick(additive);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('blur', onUp);
    cleanup.current = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('scroll', update);
      window.removeEventListener('blur', onUp);
      cleanup.current = null;
    };
  };

  return { box, onMouseDown };
}
