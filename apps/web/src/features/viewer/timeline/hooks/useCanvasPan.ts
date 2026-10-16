import { useEffect, type RefObject } from 'react';

/** The pointer has to travel this far before a press becomes a pan (a shorter one stays a click). */
const PAN_THRESHOLD = 4;

/**
 * Drag the comment area like a canvas: pressing the mouse on its background (not on the sticky
 * header or on anything matching `ignore`) and moving scrolls the timeline both ways. A press that
 * turned into a pan swallows its click, so it doesn't close the thread panel. Mouse only – touch
 * already pans natively.
 */
export function useCanvasPan({
  scrollerRef,
  ignore,
  enabled,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  ignore: string;
  enabled: boolean;
}) {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !enabled) return;

    const onPointerDown = (down: PointerEvent) => {
      if (down.pointerType !== 'mouse' || down.button !== 0) return;
      if (!(down.target instanceof Element)) return;
      if (down.target.closest('[data-timeline-header]') || down.target.closest(ignore)) return;
      const startLeft = scroller.scrollLeft;
      const startTop = scroller.scrollTop;
      let panning = false;

      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - down.clientX;
        const dy = move.clientY - down.clientY;
        if (!panning) {
          if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
          panning = true;
          scroller.setPointerCapture(down.pointerId);
          scroller.style.cursor = 'grabbing';
          scroller.style.userSelect = 'none';
          window.getSelection()?.removeAllRanges();
        }
        scroller.scrollLeft = startLeft - dx;
        scroller.scrollTop = startTop - dy;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (!panning) return;
        scroller.style.cursor = '';
        scroller.style.userSelect = '';
        // The click that ends the pan is not a click on the background.
        const swallow = (click: MouseEvent) => click.stopPropagation();
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    scroller.addEventListener('pointerdown', onPointerDown);
    return () => scroller.removeEventListener('pointerdown', onPointerDown);
  }, [scrollerRef, ignore, enabled]);
}
