import { useEffect, useRef, type PointerEvent } from 'react';

/**
 * Where the pointer is on a featured card, for its `pointer-light` and `pointer-rim`
 * (`--mx`/`--my`): one write per frame, however often the pointer moves.
 */
export function usePointerSpot() {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (event: PointerEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${clientX - box.left}px`);
      card.style.setProperty('--my', `${clientY - box.top}px`);
    });
  };
}
