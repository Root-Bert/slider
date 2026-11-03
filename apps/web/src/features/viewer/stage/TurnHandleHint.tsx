import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/ui';
import { setHandleHint } from '../hint/handle-hint';

/** Floats this far (px) over the turning handle. */
const LIFT = 6;

/**
 * ⇧ held over a turning handle where it cannot tilt: a hint floats over the handle (`anchor`),
 * flat on the screen – a plane turned in depth would skew it –, and the split handle under the
 * track says why (`setHandleHint`).
 */
export function TurnHandleHint({
  anchor,
  open,
  text,
  color,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  text: string;
  /** The viewer's colour, as the frame's. */
  color: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return;
    const seen = anchor.getBoundingClientRect();
    ref.current.style.left = `${seen.left + seen.width / 2}px`;
    ref.current.style.top = `${seen.top - LIFT}px`;
  }, [open, anchor]);
  useEffect(() => {
    if (!open) return;
    setHandleHint(text);
    return () => setHandleHint(null);
  }, [open, text]);
  if (!open) return null;
  return createPortal(
    <span
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed z-(--z-popover) flex -translate-x-1/2 -translate-y-full animate-pop-in"
      style={{ color }}
    >
      <Icon name="info" size="sm" />
    </span>,
    document.body,
  );
}
