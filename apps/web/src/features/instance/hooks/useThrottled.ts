import { useEffect, useRef, useState } from 'react';

/**
 * `value`, renewed at most every `ms` while it keeps changing – and its last state once it rests.
 * Dragging the window shows new numbers along the way without asking the API for every stretch.
 */
export function useThrottled<T extends string | number>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        last.current = Date.now();
        setShown(value);
      },
      Math.max(0, last.current + ms - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
