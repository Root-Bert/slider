import { useEffect, useEffectEvent, useState } from 'react';

/** A line of a line-based wheel (some mice) in pixels. */
const LINE_PX = 16;

/**
 * Sideways scrolling over the element – two fingers on a trackpad, or Shift with a mouse wheel –
 * as pixels (positive: towards later), with the element's width. Up and down still scroll the
 * page; the browser's swipe-back gesture doesn't fire here.
 */
export function useSidewaysWheel<T extends HTMLElement>(
  onPan: (px: number, width: number) => void,
) {
  // A callback ref: the element may appear later (once the data is there).
  const [element, ref] = useState<T | null>(null);
  const pan = useEffectEvent(onPan);
  useEffect(() => {
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const sideways = event.shiftKey
        ? event.deltaX || event.deltaY
        : Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : 0;
      if (sideways === 0) return;
      event.preventDefault();
      // Handled here: an outer element listening too doesn't move again.
      event.stopPropagation();
      pan(
        sideways * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : 1),
        element.clientWidth,
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element]);
  return ref;
}
