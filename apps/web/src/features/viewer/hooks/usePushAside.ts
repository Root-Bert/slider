import { useRef, useState, type PointerEvent } from 'react';

/**
 * A floating panel pushed aside by its handle while it is open – a margin on top of its place, so
 * where it floats and how it follows stay as they are. `handle`: the props for what grabs it (its
 * drag indicator, its name).
 */
export function usePushAside() {
  const [pushed, setPushed] = useState({ x: 0, y: 0 });
  const push = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const handle = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      push.current = { x: event.clientX, y: event.clientY, from: pushed };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = push.current;
      if (!start) return;
      setPushed({
        x: start.from.x + event.clientX - start.x,
        y: start.from.y + event.clientY - start.y,
      });
    },
    onPointerUp: () => {
      push.current = null;
    },
    onPointerCancel: () => {
      push.current = null;
    },
  };
  return { pushed, handle };
}
