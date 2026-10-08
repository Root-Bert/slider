import {
  distance,
  hitTestShapes,
  MIN_DRAG_DISTANCE,
  rectCenter,
  rectFromPoints,
  shapeRefAt,
  type AccentColor,
  type Point,
  type PathStroke,
  type Rect,
  type Shape,
  type Slide,
} from '@slider/shared';
import { useState, type PointerEvent, type RefObject } from 'react';
import { toSlidePoint } from '../lib/geometry';
import { appendPoint, isShapeTool } from '../lib/stroke-path';
import { clickTextBox, dragTextBox, startFontSize } from '../lib/text-box';
import { useViewerDispatch, type Tool } from '../state/viewer-state';

/** What is being drawn right now, before the pointer is released. */
export type Gesture =
  | { kind: 'mark'; start: Point; end: Point }
  | { kind: 'text'; start: Point; end: Point }
  | { kind: 'stroke'; stroke: PathStroke };

const MAX_POINTS = 2000;

/**
 * Turns pointer input on a slide into draft anchors and strokes (BER-98, BER-99).
 * Mark tool: tap = pin, drag = frame. Shapes: drag spans the box. Other stroke tools: one stroke
 * per press. Text: tap opens a growing text box, drag a box of that width – while the box holds
 * text, pressing the slide only returns the focus to it (it moves by its edge or name tag).
 * Works for mouse, pen and touch. With the mark tool it also reports `targetShape`: the PowerPoint
 * shape the comment would attach to – under the pointer, or under the centre of a dragged area.
 */
export function useDraftDrawing({
  slide,
  boxRef,
  tool,
  color,
  hasText = false,
}: {
  slide: Slide;
  boxRef: RefObject<HTMLElement | null>;
  tool: Tool | null;
  color: AccentColor;
  /** The draft's text box on this slide holds text. */
  hasText?: boolean;
}) {
  const dispatch = useViewerDispatch();
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const pointOf = (event: PointerEvent) =>
    boxRef.current ? toSlidePoint(event, boxRef.current) : null;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!tool || event.button !== 0) return;
    const point = pointOf(event);
    if (!point) return;
    event.preventDefault();
    if (tool === 'text' && hasText) {
      boxRef.current?.querySelector<HTMLTextAreaElement>('[data-text-editor] textarea')?.focus();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture(
      tool === 'mark'
        ? { kind: 'mark', start: point, end: point }
        : tool === 'text'
          ? { kind: 'text', start: point, end: point }
          : {
              kind: 'stroke',
              stroke: { tool, color, points: isShapeTool(tool) ? [point, point] : [point] },
            },
    );
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const point = pointOf(event);
    if (!point) return;
    if (!gesture) {
      // Only the mark tool attaches to shapes; touch has no hover.
      if (tool === 'mark' && event.pointerType !== 'touch') setHover(point);
      return;
    }
    if (gesture.kind !== 'stroke') {
      setGesture({ ...gesture, end: point });
      return;
    }
    if (isShapeTool(gesture.stroke.tool)) {
      setGesture({
        kind: 'stroke',
        stroke: { ...gesture.stroke, points: [gesture.stroke.points[0]!, point] },
      });
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

    if (gesture.kind === 'text') {
      const { start, end } = gesture;
      const fontSize = startFontSize(boxRef.current?.getBoundingClientRect().height ?? 0);
      dispatch({
        type: 'textBoxPlaced',
        slideId: slide.id,
        box:
          distance(start, end) < MIN_DRAG_DISTANCE
            ? clickTextBox(start, fontSize)
            : dragTextBox(rectFromPoints(start, end), fontSize),
      });
      return;
    }

    const { stroke } = gesture;
    if (isShapeTool(stroke.tool)) {
      // A shape needs a drag; a tap leaves nothing.
      const [start, end] = stroke.points;
      if (start && end && distance(start, end) >= MIN_DRAG_DISTANCE)
        dispatch({ type: 'strokeAdded', slideId: slide.id, stroke });
      return;
    }
    // A single tap with a pen still leaves a dot: the API needs at least two points.
    const points =
      stroke.points.length >= 2 ? stroke.points : [stroke.points[0]!, stroke.points[0]!];
    dispatch({ type: 'strokeAdded', slideId: slide.id, stroke: { ...stroke, points } });
  };

  const onPointerCancel = () => setGesture(null);
  const onPointerLeave = () => setHover(null);

  const previewRect: Rect | null =
    gesture && gesture.kind !== 'stroke' ? rectFromPoints(gesture.start, gesture.end) : null;
  const previewStroke: PathStroke | null = gesture?.kind === 'stroke' ? gesture.stroke : null;
  const targetPoint =
    tool !== 'mark'
      ? null
      : gesture?.kind === 'mark'
        ? distance(gesture.start, gesture.end) < MIN_DRAG_DISTANCE
          ? gesture.start
          : rectCenter(rectFromPoints(gesture.start, gesture.end))
        : gesture
          ? null
          : hover;
  const targetShape: Shape | null = targetPoint ? hitTestShapes(slide.shapes, targetPoint) : null;

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave },
    previewRect,
    previewStroke,
    targetShape,
  };
}
