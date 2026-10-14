import {
  distance,
  MIN_DRAG_DISTANCE,
  type AccentColor,
  type PathStroke,
  type Slide,
} from '@slider/shared';
import { useState, type PointerEvent, type RefObject } from 'react';
import { useCreateComment } from '@/lib/queries';
import { toSlidePoint } from '../lib/geometry';
import { appendPoint, isShapeTool, strokesBounds } from '../lib/stroke-path';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type PenTool } from '../state/viewer-state';

const MAX_POINTS = 2000;

/**
 * Turns pointer input on a slide into strokes (BER-98, BER-99): shapes span the dragged box, the
 * other pens draw one stroke per press. Freehand, arrow and marker strokes are saved right away as
 * bare drawings – a click on their badge adds the comment later; shapes open the composer. Works
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
  const [stroke, setStroke] = useState<PathStroke | null>(null);
  // Saved strokes stay on screen until the stored drawing replaces them.
  const [saving, setSaving] = useState<PathStroke[]>([]);

  const save = (saved: PathStroke) => {
    const rect = strokesBounds([saved]);
    if (!rect) return;
    setSaving((current) => [...current, saved]);
    createComment.mutate(
      {
        slideId: slide.id,
        parentId: null,
        body: '',
        anchor: { type: 'rect', rect, shapeRef: null },
        strokes: [saved],
      },
      { onSettled: () => setSaving((current) => current.filter((item) => item !== saved)) },
    );
  };

  const pointOf = (event: PointerEvent) =>
    boxRef.current ? toSlidePoint(event, boxRef.current) : null;

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!tool || event.button !== 0) return;
    const point = pointOf(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setStroke({ tool, color, points: isShapeTool(tool) ? [point, point] : [point] });
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const point = pointOf(event);
    if (!stroke || !point) return;
    if (isShapeTool(stroke.tool)) {
      setStroke({ ...stroke, points: [stroke.points[0]!, point] });
      return;
    }
    const points = appendPoint(stroke.points, point);
    if (points !== stroke.points && points.length <= MAX_POINTS) setStroke({ ...stroke, points });
  };

  const onPointerUp = () => {
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

  const onPointerCancel = () => setStroke(null);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    previewStrokes: stroke ? [...saving, stroke] : saving,
  };
}
