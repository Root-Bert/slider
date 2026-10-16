import { useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react';

export interface Shift {
  dx: number;
  dy: number;
}

/** Pointer travel (px) before a press on a pin counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

export interface PointDragOptions {
  /** Keeps the shift (relative to the slide) on the slide. */
  clamp: (dx: number, dy: number) => Shift;
  /** The pin as shown while dragged, `null` once it is back in place. */
  onPreview: (shift: Shift | null) => void;
  /** Dropped somewhere else; call `done` once it is stored. */
  onDrop: (shift: Shift, done: () => void) => void;
}

/**
 * Dragging a pin on the slide by its dot, in normalised slide coordinates (the pin's offset parent
 * is the slide box). A press without a drag stays a click (`wasDragged` is false).
 */
export function usePointDrag({ clamp, onPreview, onDrop }: PointDragOptions) {
  const drag = useRef<{ x: number; y: number; box: DOMRect; shift: Shift | null } | null>(null);
  const dragged = useRef(false);
  const shown = useRef(false);
  const onPreviewRef = useRef(onPreview);
  useLayoutEffect(() => {
    onPreviewRef.current = onPreview;
  });
  const preview = (shift: Shift | null) => {
    shown.current = shift !== null;
    onPreviewRef.current(shift);
  };
  // Unmounted mid-drag (or before the drop settled): nothing is shown as dragged any more.
  useEffect(
    () => () => {
      if (shown.current) onPreviewRef.current(null);
    },
    [],
  );

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const box = (event.currentTarget.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    event.preventDefault();
    // The slide below must not start a box or a pin.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, box, shift: null };
    dragged.current = false;
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const px = event.clientX - current.x;
    const py = event.clientY - current.y;
    if (!current.shift && Math.hypot(px, py) < DRAG_THRESHOLD) return;
    current.shift = clamp(px / current.box.width, py / current.box.height);
    dragged.current = true;
    preview(current.shift);
  };
  const onPointerUp = () => {
    const shift = drag.current?.shift;
    drag.current = null;
    if (shift) onDrop(shift, () => preview(null));
  };
  const onPointerCancel = () => {
    if (drag.current?.shift) preview(null);
    drag.current = null;
  };

  return {
    /** Spread on the pin. */
    pointerProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    /** True once after a drag: the click that ends it is no click. */
    wasDragged: () => {
      const was = dragged.current;
      dragged.current = false;
      return was;
    },
  };
}
