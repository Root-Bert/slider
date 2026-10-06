import {
  distance,
  MIN_DRAG_DISTANCE,
  rectCenter,
  rectFromPoints,
  shapeRefAt,
  type AccentColor,
  type Point,
  type Rect,
  type Slide,
  type Stroke,
} from '@slider/shared';
import { useState, type PointerEvent, type RefObject } from 'react';
import { toSlidePoint } from '../lib/geometry';
import { appendPoint } from '../lib/stroke-path';
import { useViewerDispatch, type Tool } from '../state/viewer-state';

/** What is being drawn right now, before the pointer is released. */
export type Gesture =
  { kind: 'mark'; start: Point; end: Point } | { kind: 'stroke'; stroke: Stroke };

const MAX_POINTS = 2000;

/**
 * Turns pointer input on a slide into draft anchors and strokes (BER-98, BER-99).
 * Mark tool: tap = pin, drag = frame. Stroke tools: one stroke per press. Works for mouse, pen and touch.
 */
export function useDraftDrawing({
  slide,
  boxRef,
  tool,
  color,
}: {
  slide: Slide;
  boxRef: RefObject<HTMLElement | null>;
  tool: Tool | null;
  color: AccentColor;
}) {
  const dispatch = useViewerDispatch();
  const [gesture, setGesture] = useState<Gesture | null>(null);

  const pointOf = (event: PointerEvent) =>
    boxRef.current ? toSlidePoint(event, boxRef.current) : null;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!tool || event.button !== 0) return;
    const point = pointOf(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture(
      tool === 'mark'
        ? { kind: 'mark', start: point, end: point }
        : { kind: 'stroke', stroke: { tool, color, points: [point] } },
    );
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!gesture) return;
    const point = pointOf(event);
    if (!point) return;
    if (gesture.kind === 'mark') {
      setGesture({ ...gesture, end: point });
      return;
    }
    const points = appendPoint(gesture.stroke.points, point);
    if (points !== gesture.stroke.points && points.length <= MAX_POINTS) {
      setGesture({ kind: 'stroke', stroke: { ...gesture.stroke, points } });
    }
  };

  const onPointerUp = () => {
    if (!gesture) return;
    setGesture(null);

    if (gesture.kind === 'mark') {
      const { start, end } = gesture;
      if (distance(start, end) < MIN_DRAG_DISTANCE) {
        dispatch({
          type: 'anchorPlaced',
          slideId: slide.id,
          anchor: { type: 'point', point: start, shapeRef: shapeRefAt(slide.shapes, start) },
        });
      } else {
        const rect = rectFromPoints(start, end);
        dispatch({
          type: 'anchorPlaced',
          slideId: slide.id,
          anchor: { type: 'rect', rect, shapeRef: shapeRefAt(slide.shapes, rectCenter(rect)) },
        });
      }
      return;
    }

    const { stroke } = gesture;
    // A single tap with a pen still leaves a dot: the API needs at least two points.
    const points =
      stroke.points.length >= 2 ? stroke.points : [stroke.points[0]!, stroke.points[0]!];
    dispatch({ type: 'strokeAdded', slideId: slide.id, stroke: { ...stroke, points } });
  };

  const onPointerCancel = () => setGesture(null);

  const previewRect: Rect | null =
    gesture?.kind === 'mark' ? rectFromPoints(gesture.start, gesture.end) : null;
  const previewStroke: Stroke | null = gesture?.kind === 'stroke' ? gesture.stroke : null;

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    previewRect,
    previewStroke,
  };
}
