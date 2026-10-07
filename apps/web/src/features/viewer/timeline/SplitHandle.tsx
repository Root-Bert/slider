import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '@/ui';
import { rafThrottle } from '../lib/dom';
import {
  dragSplit,
  SPLIT_KEY_STEP_LARGE_PX,
  SPLIT_KEY_STEP_PX,
  SPLIT_MAX,
  SPLIT_MIN,
  stepSplit,
} from '../lib/split';
import { resolvedSplit, type TrackGeometry } from '../lib/timeline-layout';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

interface SplitHandleProps {
  geometry: TrackGeometry;
  /** Current slide height (the track's height). */
  slideH: number;
}

/**
 * Grabber between the slide area (track, minimap, controls row) and the comment area. Dragging it
 * down makes the slides bigger and the comment area smaller, up the other way round; the slides
 * always fill the track. Double click resets the default split. As a focusable separator, ↑ / ↓
 * (with Shift: larger steps) move it, Home / End jump to the smallest / largest slides.
 */
export function SplitHandle({ geometry, slideH }: SplitHandleProps) {
  const { split } = useViewerState();
  const dispatch = useViewerDispatch();
  const dragRef = useRef<{ pointerId: number; startY: number; startH: number } | null>(null);
  const pendingRef = useRef<number | null>(null);
  // Pointer moves arrive faster than frames: the latest split is dispatched once per frame.
  const flushRef = useRef<ReturnType<typeof rafThrottle> | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const throttle = rafThrottle(() => {
      if (pendingRef.current === null) return;
      dispatch({ type: 'splitChanged', split: pendingRef.current });
      pendingRef.current = null;
    });
    flushRef.current = throttle;
    return () => {
      throttle.cancel();
      flushRef.current = null;
    };
  }, [dispatch]);

  // While dragging the cursor stays a resize cursor everywhere (the pointer outruns the handle
  // at the limits) and nothing gets text-selected.
  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    const { cursor, userSelect } = root.style;
    root.style.cursor = 'row-resize';
    root.style.userSelect = 'none';
    return () => {
      root.style.cursor = cursor;
      root.style.userSelect = userSelect;
    };
  }, [dragging]);

  const value = resolvedSplit(split, geometry);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startH: slideH };
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pendingRef.current = dragSplit(drag.startH, event.clientY - drag.startY, geometry);
    flushRef.current?.schedule();
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? SPLIT_KEY_STEP_LARGE_PX : SPLIT_KEY_STEP_PX;
    let next: number | null;
    if (event.key === 'ArrowUp') next = stepSplit(split, -1, geometry, step);
    else if (event.key === 'ArrowDown') next = stepSplit(split, 1, geometry, step);
    else if (event.key === 'Home') next = SPLIT_MIN;
    else if (event.key === 'End') next = SPLIT_MAX;
    else if (event.key === 'Enter') next = null;
    else return;
    event.preventDefault();
    dispatch({ type: 'splitChanged', split: next });
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Größe von Folien und Kommentarbereich"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`Folien ${Math.round(slideH)} px hoch`}
      title="Ziehen: Folien größer oder kleiner · Doppelklick: Standard"
      tabIndex={0}
      data-split-handle
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={() => dispatch({ type: 'splitChanged', split: null })}
      onKeyDown={onKeyDown}
      className="group relative flex h-3 cursor-row-resize touch-none items-center justify-center outline-none select-none"
    >
      {/* Hairline across the width while the handle is hovered, focused or dragged. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-white/0 transition-colors md:inset-x-[clamp(16px,3vw,32px)]',
          'group-hover:bg-white/10 group-focus-visible:bg-white/15',
          dragging && 'bg-white/15',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'relative h-1 w-10 rounded-full bg-white/25 transition-[background-color,width] duration-150',
          'group-hover:w-14 group-hover:bg-white/60 group-focus-visible:w-14 group-focus-visible:bg-white/70 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-mention',
          dragging && 'w-14 bg-white/80',
        )}
      />
    </div>
  );
}
