import {
  distance,
  MAX_DRAWING_STROKES,
  MIN_DRAG_DISTANCE,
  type AccentColor,
  type Comment,
  type PathStroke,
  type Slide,
} from '@slider/shared';
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useCreateComment, useUpdateComment } from '@/lib/api';
import { toSlidePoint } from '../../lib/geometry';
import { appendPoint, isShapeTool, strokesBounds } from '../lib/stroke-path';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch, useViewerState, type PenTool } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';

const MAX_POINTS = 2000;

/** Freehand strokes drawn one after another: one drawing (one comment). */
interface FreehandGroup {
  slideId: string;
  strokes: PathStroke[];
  /** Its comment once stored; `null` while the first stroke is still saving. */
  commentId: string | null;
  /** The saves so far, one after another – each stroke is added to what the one before stored. */
  saved: Promise<void>;
}

/**
 * Turns pointer input on a slide into strokes (BER-98, BER-99): shapes span the dragged box, the
 * other pens draw one stroke per press. Freehand, arrow and marker strokes are saved right away as
 * bare drawings – a click on their badge (or typing right away) adds the comment; shapes open the composer.
 * Freehand strokes drawn on, without a comment in between, join the drawing before: one drawing;
 * arrows and markers stay one each. Works
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
  const { draft, lastDrawing } = useViewerState();
  const { deck } = useViewerData();
  const createComment = useCreateComment(deck.id);
  const updateComment = useUpdateComment(deck.id);
  const showToast = useViewerToast();
  const [stroke, setStroke] = useState<PathStroke | null>(null);
  // Saved strokes stay on screen until the stored drawing replaces them.
  const [saving, setSaving] = useState<PathStroke[]>([]);
  // The pointer drawing the stroke: a second finger neither restarts nor bends it.
  const pointerRef = useRef<number | null>(null);
  const groupRef = useRef<FreehandGroup | null>(null);

  // Another tool, or the pen picked anew, starts a new drawing.
  useEffect(() => {
    groupRef.current = null;
  }, [tool]);

  /** The freehand drawing a new freehand stroke joins: still bare and the latest one drawn. */
  const openGroup = () => {
    const group = groupRef.current;
    if (!group || group.slideId !== slide.id || draft) return null;
    if (group.strokes.length >= MAX_DRAWING_STROKES) return null;
    // Commented on (or left for another drawing) once it was stored: done.
    if (group.commentId !== null && lastDrawing?.commentId !== group.commentId) return null;
    return group;
  };

  // Typing right away comments on it (`useViewerShortcuts`).
  const saved = (comment: Comment) =>
    dispatch({
      type: 'drawingSaved',
      slideId: slide.id,
      commentId: comment.id,
      anchor: comment.anchor,
      strokes: comment.strokes,
    });

  const save = (stroke: PathStroke) => {
    const group =
      stroke.tool === 'pen'
        ? (openGroup() ?? {
            slideId: slide.id,
            strokes: [],
            commentId: null,
            saved: Promise.resolve(),
          })
        : null;
    const strokes = [...(group?.strokes ?? []), stroke];
    const rect = strokesBounds(strokes);
    if (!rect) return;
    setSaving((current) => [...current, stroke]);
    // Per stroke through the promise: `mutate`'s own callbacks run only for the latest call, so a
    // stroke drawn while the one before is still saving would leave that one's preview behind.
    const store = () =>
      group?.commentId
        ? updateComment.mutateAsync({
            commentId: group.commentId,
            addStrokes: { strokes: [stroke], rect },
          })
        : createComment.mutateAsync({
            slideId: slide.id,
            parentId: null,
            body: '',
            anchor: { type: 'rect', rect, shapeRef: null },
            strokes: [stroke],
          });
    const done = (group?.saved ?? Promise.resolve())
      .then(store)
      .then(
        (comment) => {
          if (group) group.commentId = comment.id;
          saved(comment);
        },
        // The stroke leaves the slide – say why, instead of letting it vanish. The next one
        // starts a drawing of its own.
        (error: Error) => {
          if (groupRef.current === group) groupRef.current = null;
          showToast(error.message, 'danger');
        },
      )
      .finally(() => setSaving((current) => current.filter((item) => item !== stroke)));
    if (group) {
      group.strokes = strokes;
      group.saved = done;
      groupRef.current = group;
    }
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
