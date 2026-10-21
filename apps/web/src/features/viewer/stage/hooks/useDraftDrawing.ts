import {
  distance,
  MIN_DRAG_DISTANCE,
  type AccentColor,
  type PathStroke,
  type Slide,
} from '@slider/shared';
import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useCreateComment } from '@/lib/api';
import { toSlidePoint } from '../../lib/geometry';
import { appendPoint, isShapeTool, strokesBounds } from '../lib/stroke-path';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch, type PenTool } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';

const MAX_POINTS = 2000;

/**
 * Turns pointer input on a slide into strokes (BER-98, BER-99): shapes span the dragged box, the
 * other pens draw one stroke per press. Freehand, arrow and marker strokes are saved right away as
 * bare drawings – a click on their badge (or typing right away) adds the comment; shapes open the composer. Works
 * for mouse, pen and touch. Pins, boxes and text on the slide come from the pointer itself (`SlideFrame`).
 */
export function useDraftDrawing({
  slide,
  boxRef,
  tool,
  color,
}: {
  slide: Slide;
  boxRef: RefObject<HTMLElement | null>;
  tool: PenTool | null;
  color: AccentColor;
}) {
  const dispatch = useViewerDispatch();
  const { deck } = useViewerData();
  const createComment = useCreateComment(deck.id);
  const showToast = useViewerToast();
  const [stroke, setStroke] = useState<PathStroke | null>(null);
  // Saved strokes stay on screen until the stored drawing replaces them.
  const [saving, setSaving] = useState<PathStroke[]>([]);
  // The pointer drawing the stroke: a second finger neither restarts nor bends it.
  const pointerRef = useRef<number | null>(null);

  const save = (saved: PathStroke) => {
    const rect = strokesBounds([saved]);
    if (!rect) return;
    setSaving((current) => [...current, saved]);
    // Per stroke through the promise: `mutate`'s own callbacks run only for the latest call, so a
    // stroke drawn while the one before is still saving would leave that one's preview behind.
    createComment
      .mutateAsync({
        slideId: slide.id,
        parentId: null,
        body: '',
        anchor: { type: 'rect', rect, shapeRef: null },
        strokes: [saved],
      })
      .then(
        // Typing right away comments on it (`useViewerShortcuts`).
        (comment) =>
          dispatch({
            type: 'drawingSaved',
            slideId: slide.id,
            commentId: comment.id,
            anchor: comment.anchor,
            strokes: comment.strokes,
          }),
        // The stroke leaves the slide – say why, instead of letting it vanish.
        (error: Error) => showToast(error.message, 'danger'),
      )
      .finally(() => setSaving((current) => current.filter((item) => item !== saved)));
  };

  const pointOf = (event: PointerEvent) =>
    boxRef.current ? toSlidePoint(event, boxRef.current) : null;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!tool || event.button !== 0 || pointerRef.current !== null) return;
    const point = pointOf(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    setStroke({ tool, color, points: isShapeTool(tool) ? [point, point] : [point] });
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    const point = pointOf(event);
    if (!stroke || !point) return;
    if (isShapeTool(stroke.tool)) {
      setStroke({ ...stroke, points: [stroke.points[0]!, point] });
      return;
    }
    const points = appendPoint(stroke.points, point);
    if (points !== stroke.points && points.length <= MAX_POINTS) setStroke({ ...stroke, points });
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    if (!stroke) return;
    setStroke(null);
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
    save({ ...stroke, points });
  };

  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    setStroke(null);
  };

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      // Capture lost without a release (after one the pointer is no longer the drawing one).
      onLostPointerCapture: onPointerCancel,
    },
    previewStrokes: stroke ? [...saving, stroke] : saving,
  };
}
