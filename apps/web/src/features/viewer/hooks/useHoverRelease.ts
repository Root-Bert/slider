import { useEffect, useRef } from 'react';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/** Every element that sets the hovered thread on `pointerenter` carries its id here. */
const HOVER_THREAD_ATTR = 'data-hover-thread';

/**
 * Keeps the hovered thread honest. `pointerleave` never fires for an element that is removed or
 * replaced under a resting pointer (a card resolved away under the "Offen" filter, a card turning
 * compact, a mark redrawn), so the thread would stay lit and every other card dimmed. While a
 * thread is hovered, every DOM change re-checks what lies under the pointer.
 */
export function useHoverRelease() {
  const { hoveredThreadId } = useViewerState();
  const dispatch = useViewerDispatch();
  // Where the mouse is – known before a thread gets hovered.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const track = (event: PointerEvent) => {
      if (event.pointerType !== 'touch')
        pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener('pointermove', track, { passive: true });
    document.addEventListener('pointerover', track, { passive: true });
    return () => {
      document.removeEventListener('pointermove', track);
      document.removeEventListener('pointerover', track);
    };
  }, []);

  useEffect(() => {
    if (!hoveredThreadId) return;
    let frame = 0;

    const check = () => {
      frame = 0;
      const pointer = pointerRef.current;
      if (!pointer) return;
      const owner = document
        .elementFromPoint(pointer.x, pointer.y)
        ?.closest<HTMLElement | SVGElement>(`[${HOVER_THREAD_ATTR}]`);
      const threadId = owner?.getAttribute(HOVER_THREAD_ATTR) ?? null;
      if (threadId !== hoveredThreadId) dispatch({ type: 'threadHovered', threadId });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    // The pointer left the window: nothing is hovered any more.
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) dispatch({ type: 'threadHovered', threadId: null });
    };

    // Only removals can take the hovered element away from under the pointer.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.removedNodes.length > 0)) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerout', leave);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerout', leave);
      cancelAnimationFrame(frame);
    };
  }, [hoveredThreadId, dispatch]);
}
