import { useEffect, useRef, useState, type RefObject } from 'react';

/** How far it is pulled (px) until letting go fetches. */
export const PULL_AT = 64;
/** It follows the finger at half its way, up to this far. */
const PULL_MAX = 96;
/** A wheel or trackpad stroke ends after this pause; a new one starts only at rest at the top. */
const WHEEL_REST_MS = 250;

/**
 * Pulled down at the top of a scroll box, it fetches (`onPull`), as a phone's mail program: by
 * touch – the box moves with the finger, let go far enough, it fetches – and by wheel or
 * trackpad, a stroke up begun while it already stood at the top (not one that scrolled up to it).
 * `pull`: how far it is pulled now, for the sign above the list. Touch moves are listened for
 * from the start, not passive: Safari moves the page otherwise.
 */
export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  onPull: () => void,
  enabled = true,
) {
  const [pull, setPull] = useState(0);
  const onPullRef = useRef(onPull);
  useEffect(() => {
    onPullRef.current = onPull;
  });
  useEffect(() => {
    const box = ref.current;
    if (!box || !enabled) return;
    let startY: number | null = null;
    let pulled = 0;
    const set = (next: number) => {
      pulled = next;
      setPull(next);
    };
    const onTouchStart = (event: TouchEvent) => {
      startY = box.scrollTop <= 0 && event.touches.length === 1 ? event.touches[0]!.clientY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY === null) return;
      const way = event.touches[0]!.clientY - startY;
      if (way <= 0 || box.scrollTop > 0) {
        if (pulled) set(0);
        if (way < 0) startY = null;
        return;
      }
      event.preventDefault();
      set(Math.min(way / 2, PULL_MAX));
    };
    const onTouchEnd = () => {
      if (startY !== null && pulled >= PULL_AT) onPullRef.current();
      startY = null;
      if (pulled) set(0);
    };
    // Wheel and trackpad: a stroke is its events without a pause between them.
    let lastWheel = 0;
    let stroke: 'pull' | 'other' = 'other';
    let rest: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const now = performance.now();
      if (now - lastWheel > WHEEL_REST_MS)
        stroke = box.scrollTop <= 0 && event.deltaY < 0 ? 'pull' : 'other';
      lastWheel = now;
      clearTimeout(rest);
      rest = setTimeout(() => {
        stroke = 'other';
        if (pulled) set(0);
      }, WHEEL_REST_MS);
      if (stroke !== 'pull') return;
      if (event.deltaY > 0) {
        stroke = 'other';
        if (pulled) set(0);
        return;
      }
      const line = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.clientHeight : 1;
      const next = Math.min(pulled + (-event.deltaY * line) / 2, PULL_MAX);
      if (pulled < PULL_AT && next >= PULL_AT) onPullRef.current();
      set(next);
    };
    box.addEventListener('touchstart', onTouchStart, { passive: true });
    box.addEventListener('touchmove', onTouchMove, { passive: false });
    box.addEventListener('touchend', onTouchEnd);
    box.addEventListener('touchcancel', onTouchEnd);
    box.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      clearTimeout(rest);
      box.removeEventListener('touchstart', onTouchStart);
      box.removeEventListener('touchmove', onTouchMove);
      box.removeEventListener('touchend', onTouchEnd);
      box.removeEventListener('touchcancel', onTouchEnd);
      box.removeEventListener('wheel', onWheel);
    };
  }, [ref, enabled]);
  return pull;
}
