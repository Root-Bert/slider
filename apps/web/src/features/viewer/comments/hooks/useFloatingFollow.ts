import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/** How quickly the popover catches up with its mark: the gap shrinks to 1/e every `FOLLOW_TAU` ms. */
const FOLLOW_TAU = 50;
/** Closer than this (px), it simply sits there. */
const REST = 0.5;

/** Shows `node` shifted by `x`/`y` off its place (none at 0, 0). */
function shift(node: HTMLElement, x: number, y: number) {
  node.style.translate = x === 0 && y === 0 ? '' : `${x}px ${y}px`;
}

interface Point {
  left: number;
  top: number;
}

/**
 * Lets a popover float after its anchor instead of being glued to it: `target` is where it
 * belongs (measured right away), the element trails there with an exponential ease – the same
 * feel at any frame rate. Only CSS `translate` is touched, so `left`/`top` stay React's and an
 * entry animation's `transform` composes with it. The first placement and reduced motion snap.
 */
export function useFloatingFollow(element: RefObject<HTMLElement | null>, target: Point | null) {
  const placed = useRef<Point | null>(null);
  // Where it shows, relative to `placed`.
  const offset = useRef({ x: 0, y: 0 });
  const frame = useRef(0);

  const left = target?.left ?? null;
  const top = target?.top ?? null;
  useLayoutEffect(() => {
    const node = element.current;
    const previous = placed.current;
    placed.current = left === null || top === null ? null : { left, top };
    if (!node) return;
    if (!placed.current || !previous || prefersReducedMotion()) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      offset.current = { x: 0, y: 0 };
      shift(node, 0, 0);
      return;
    }
    // Keep showing it where it was: the new place only moves the goal.
    offset.current = {
      x: offset.current.x + previous.left - placed.current.left,
      y: offset.current.y + previous.top - placed.current.top,
    };
    shift(node, offset.current.x, offset.current.y);
    if (frame.current) return;
    let last = performance.now();
    const step = (now: number) => {
      const decay = Math.exp(-(now - last) / FOLLOW_TAU);
      last = now;
      const x = offset.current.x * decay;
      const y = offset.current.y * decay;
      const resting = Math.abs(x) < REST && Math.abs(y) < REST;
      offset.current = resting ? { x: 0, y: 0 } : { x, y };
      shift(node, offset.current.x, offset.current.y);
      frame.current = resting ? 0 : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [element, left, top]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
}
