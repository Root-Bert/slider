import { useEffect } from 'react';
import { useViewerDispatch } from '../state/viewer-state';

/** Every element that belongs to a thread (card, pin, frame, drawing, gap marker) carries its id. */
const HOVER_THREAD_ATTR = 'data-hover-thread';

/**
 * The hovered thread, from one source of truth: the thread element under the mouse. No element
 * reports enter/leave itself – those events miss elements that move or vanish under a resting
 * pointer (a panel closing, cards re-flowing, a card resolved away), and the thread stayed lit.
 * Instead the element under the last mouse position is looked up again whenever the pointer
 * moves, the page scrolls or the DOM changes – at most once per frame. Touch has no hover.
 */
export function useThreadHover() {
  const dispatch = useViewerDispatch();

  useEffect(() => {
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;

    const update = () => {
      frame = 0;
      const owner = pointer
        ? document
            .elementFromPoint(pointer.x, pointer.y)
            ?.closest<HTMLElement | SVGElement>(`[${HOVER_THREAD_ATTR}]`)
        : null;
      dispatch({ type: 'threadHovered', threadId: owner?.getAttribute(HOVER_THREAD_ATTR) ?? null });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    // Left the window (no element to go to): nothing is hovered.
    const out = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      pointer = null;
      schedule();
    };
    const refresh = () => {
      if (pointer) schedule();
    };

    // Layout moves cards and marks by inline style; removals take them away.
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerdown', move, { passive: true });
    document.addEventListener('pointerout', out);
    document.addEventListener('scroll', refresh, { capture: true, passive: true });
    window.addEventListener('resize', refresh);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', move);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('scroll', refresh, { capture: true });
      window.removeEventListener('resize', refresh);
      cancelAnimationFrame(frame);
    };
  }, [dispatch]);
}
