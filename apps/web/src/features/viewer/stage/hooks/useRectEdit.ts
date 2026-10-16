import type { Rect } from '@slider/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { moved, resized, type RectCorner, type RectSize } from '../lib/rect-edit';

export { resized, type RectCorner } from '../lib/rect-edit';

/** Marks the frame element; corner handles inside it find it by this. */
export const FRAME_ATTR = 'data-editable-frame';

/** Pointer travel (px) before a press on a box counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

type Drag = {
  kind: 'move' | RectCorner;
  /** The slide box the rect is relative to (the frame's offset parent). */
  slide: DOMRect;
  pointerX: number;
  pointerY: number;
  start: Rect;
  moved: boolean;
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

export interface RectEditOptions {
  /** Follows the box as shown while dragged (`null` once it is back to `rect`). */
  onPreview?: (rect: Rect | null) => void;
  /** Smallest box a resize leaves, relative to the slide. */
  minSize?: RectSize;
}

/**
 * Moving (drag the box) and resizing (drag a corner) a box on the slide, in normalised slide
 * coordinates. Shows the box as dragged until `onCommit`'s `done` – so it doesn't jump back
 * while the new place is stored. A press without a drag stays a click (`wasDragged` is false).
 * Every movable box on the slide (frames, the draft's box, text on the slide) goes through here,
 * so its badge and connector line follow it the same way (`onPreview`).
 */
export function useRectEdit(
  rect: Rect,
  onCommit: (rect: Rect, done: () => void) => void,
  { onPreview, minSize }: RectEditOptions = {},
) {
  const dragRef = useRef<Drag | null>(null);
  const draggedRef = useRef(false);
  const [preview, setPreviewState] = useState<Rect | null>(null);
  const previewRef = useRef<Rect | null>(null);
  const onPreviewRef = useRef(onPreview);
  useLayoutEffect(() => {
    onPreviewRef.current = onPreview;
  });
  const setPreview = (next: Rect | null) => {
    previewRef.current = next;
    setPreviewState(next);
    onPreviewRef.current?.(next);
  };
  // Unmounted mid-drag (or before the commit settled): nothing is shown as dragged any more.
  useEffect(
    () => () => {
      if (previewRef.current) onPreviewRef.current?.(null);
    },
    [],
  );

  const start = (event: ReactPointerEvent<HTMLElement>, kind: Drag['kind']) => {
    if (event.button !== 0) return;
    const frame = event.currentTarget.closest<HTMLElement>(`[${FRAME_ATTR}]`);
    // The slide box: the annotation layer is the frame's offset parent.
    const slide = frame?.offsetParent?.getBoundingClientRect();
    if (!frame || !slide || slide.width <= 0 || slide.height <= 0) return;
    event.preventDefault();
    // The slide below must not start a comment of its own.
    event.stopPropagation();
    // Captured by the frame: a corner handle's moves reach it too.
    frame.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      slide,
      pointerX: event.clientX,
      pointerY: event.clientY,
      start: preview ?? rect,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { slide } = drag;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setPreview(
      drag.kind === 'move'
        ? moved(drag.start, dx / slide.width, dy / slide.height)
        : resized(
            drag.start,
            drag.kind,
            (event.clientX - slide.left) / slide.width,
            (event.clientY - slide.top) / slide.height,
            minSize,
          ),
    );
  };

  const end = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const placed = previewRef.current;
    if (!drag?.moved || !placed) return;
    draggedRef.current = true;
    onCommit(
      { x: round(placed.x), y: round(placed.y), w: round(placed.w), h: round(placed.h) },
      () => setPreview(null),
    );
  };

  return {
    /** The box as shown: as dragged, else `rect`. */
    rect: preview ?? rect,
    dragging: preview !== null,
    /** Spread on the box: dragging it moves it. */
    boxProps: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, 'move'),
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
    },
    /** Spread on a corner handle. */
    cornerProps: (corner: RectCorner) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, corner),
    }),
    /** True once after a drag: the click that ends it is no click. */
    wasDragged: () => {
      const dragged = draggedRef.current;
      draggedRef.current = false;
      return dragged;
    },
  };
}
