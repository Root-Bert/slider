import {
  lineBetween,
  lineEnds,
  type EditableElement,
  type ElementFlip,
  type Point,
  type Rect,
} from '@slider/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LINE_SNAP_PX, snappedPoint, snappedToLines, type SnapLines } from '../stage/lib/rect-edit';
import { useEditing } from './editing-context';

/** How wide (screen pixels) a line can be grabbed. */
const GRAB_PX = 14;
/** Moved less than this (screen pixels): a click, not a drag. */
const CLICK_PX = 3;

interface Drag {
  kind: 'move' | 'from' | 'to';
  /** The pointer where it was pressed, of the slide. */
  pressed: Point;
  start: { from: Point; to: Point };
  slide: DOMRect;
  moved: boolean;
}

/**
 * A line on the edit layer (Figma): grabbed along its length – a click picks it, a drag moves it,
 * caught at the lines a moved box is caught at; picked, a handle at each end drags that end –
 * caught at those lines too, ⇧ to steps of 45°, ⌘ free. Shown as dragged in the same frame
 * (`setPreview`: its box and the way it runs), stored as one `setBox` with its `flip`.
 */
export function LineFrame({
  element,
  color,
  picked,
  hovered,
  snapLines,
  onActivate,
  onHover,
}: {
  element: EditableElement;
  color: string;
  picked: boolean;
  hovered: boolean;
  snapLines: SnapLines;
  /** A click on it (not a drag): picked, or ⇧ picked together. */
  onActivate: (event: { shiftKey: boolean }) => void;
  onHover: (over: boolean) => void;
}) {
  const editing = useEditing();
  const [surface] = useState(() => ({}));
  const drag = useRef<Drag | null>(null);
  // Shown as dragged until the edit is in (no jump back meanwhile).
  const [shown, setShown] = useState<{ from: Point; to: Point } | null>(null);
  const ends = shown ?? lineEnds(element.bbox, element.flip);
  const aspect = editing.pageSize.width / Math.max(1e-6, editing.pageSize.height);
  // Gone (deleted, unmounted mid-drag): nothing shown as dragged any more.
  useEffect(
    () => () => editing.setPreview(null, element.id, surface),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pointOf = (event: { clientX: number; clientY: number }, slide: DOMRect): Point => ({
    x: (event.clientX - slide.left) / Math.max(1, slide.width),
    y: (event.clientY - slide.top) / Math.max(1, slide.height),
  });

  const begin = (event: ReactPointerEvent<Element>, kind: Drag['kind']) => {
    if (event.button !== 0) return;
    const layer = event.currentTarget.closest<HTMLElement>('[data-edit-layer]');
    if (!layer) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const slide = layer.getBoundingClientRect();
    drag.current = {
      kind,
      pressed: pointOf(event, slide),
      start: lineEnds(element.bbox, element.flip),
      slide,
      moved: false,
    };
  };

  const placed = (event: PointerEvent | ReactPointerEvent<Element>, now: Drag) => {
    const at = pointOf(event, now.slide);
    const { from, to } = now.start;
    const tolerance = {
      w: LINE_SNAP_PX / Math.max(1, now.slide.width),
      h: LINE_SNAP_PX / Math.max(1, now.slide.height),
    };
    const free = event.metaKey || event.ctrlKey;
    if (now.kind === 'move') {
      const dx = at.x - now.pressed.x;
      const dy = at.y - now.pressed.y;
      const start = lineBetween(from, to).box;
      const rect = { ...start, x: start.x + dx, y: start.y + dy };
      const caught = free ? rect : snappedToLines(rect, start, 'move', snapLines, tolerance).rect;
      const [sx, sy] = [caught.x - start.x, caught.y - start.y];
      return { from: { x: from.x + sx, y: from.y + sy }, to: { x: to.x + sx, y: to.y + sy } };
    }
    const fixed = now.kind === 'from' ? to : from;
    let end = at;
    if (event.shiftKey) {
      // In steps of 45° as seen, as long as the pointer is far.
      const dx = (at.x - fixed.x) * aspect;
      const dy = at.y - fixed.y;
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const length = Math.hypot(dx, dy);
      end = {
        x: fixed.x + (Math.cos(angle) * length) / aspect,
        y: fixed.y + Math.sin(angle) * length,
      };
    } else if (!free) end = snappedPoint(at, snapLines, tolerance).point;
    return now.kind === 'from' ? { from: end, to } : { from, to: end };
  };

  const preview = (ends: { from: Point; to: Point } | null) => {
    setShown(ends);
    if (!ends) {
      editing.setPreview(null, element.id, surface);
      return;
    }
    const { box, flip } = lineBetween(ends.from, ends.to);
    editing.setPreview({ elementId: element.id, rect: box, flip }, element.id, surface);
  };

  const onPointerMove = (event: ReactPointerEvent<Element>) => {
    const now = drag.current;
    if (!now) return;
    const dx = (event.clientX - now.slide.left) / Math.max(1, now.slide.width) - now.pressed.x;
    const dy = (event.clientY - now.slide.top) / Math.max(1, now.slide.height) - now.pressed.y;
    if (
      !now.moved &&
      Math.hypot(dx * now.slide.width, dy * now.slide.height) < CLICK_PX &&
      now.kind === 'move'
    )
      return;
    now.moved = true;
    preview(placed(event, now));
  };

  const onPointerUp = (event: ReactPointerEvent<Element>) => {
    const now = drag.current;
    drag.current = null;
    if (!now) return;
    event.stopPropagation();
    if (!now.moved) {
      onActivate(event);
      return;
    }
    const ends = placed(event, now);
    const { box, flip } = lineBetween(ends.from, ends.to);
    // A point is no line: nothing stored.
    if (box.w <= 0 && box.h <= 0) {
      preview(null);
      return;
    }
    store(box, flip);
  };

  const store = (box: Rect, flip: ElementFlip) => {
    void editing
      .apply([{ type: 'setBox', elementId: element.id, box, flip }])
      .finally(() => preview(null));
  };

  const pct = (value: number) => `${value * 100}%`;
  const grabFrom = (event: ReactPointerEvent<Element>) => begin(event, 'from');
  const grabTo = (event: ReactPointerEvent<Element>) => begin(event, 'to');
  const onPointerCancel = () => {
    drag.current = null;
    preview(null);
  };
  // The click a drag ends with is no click on the slide (it would let go of the line).
  const onClick = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const outlined = picked || hovered || shown !== null;
  return (
    <>
      <svg
        aria-hidden
        data-line-frame={element.id}
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {outlined && (
          <line
            x1={pct(ends.from.x)}
            y1={pct(ends.from.y)}
            x2={pct(ends.to.x)}
            y2={pct(ends.to.y)}
            stroke={color}
            strokeWidth={picked ? 1.5 : 1}
          />
        )}
        <line
          data-edit-element={element.id}
          x1={pct(ends.from.x)}
          y1={pct(ends.from.y)}
          x2={pct(ends.to.x)}
          y2={pct(ends.to.y)}
          stroke="transparent"
          strokeWidth={GRAB_PX}
          strokeLinecap="round"
          className="cursor-move"
          style={{ pointerEvents: 'stroke' }}
          onPointerDown={(event) => begin(event, 'move')}
          onPointerEnter={() => onHover(true)}
          onPointerLeave={() => onHover(false)}
          onDoubleClick={(event) => event.stopPropagation()}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={onClick}
        />
      </svg>
      {picked &&
        (['from', 'to'] as const).map((end) => (
          <span
            key={end}
            role="presentation"
            data-line-end={end}
            className="absolute z-1 size-3 -translate-1/2 cursor-crosshair rounded-full border-2 bg-white shadow-sm"
            style={{ left: pct(ends[end].x), top: pct(ends[end].y), borderColor: color }}
            onPointerDown={end === 'from' ? grabFrom : grabTo}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClick={onClick}
          />
        ))}
    </>
  );
}
