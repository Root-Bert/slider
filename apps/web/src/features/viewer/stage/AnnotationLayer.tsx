import {
  clampDrawingShift,
  isDrawing,
  isPathStroke,
  rectShapeRefAt,
  type Anchor,
  type Comment,
  type Point,
  type Rect,
  type Shape,
  type Slide,
} from '@slider/shared';
import { memo, useMemo, useRef, type PointerEvent } from 'react';
import { useUpdateComment } from '@/lib/queries';
import { cn } from '@/ui';
import {
  anchorRect,
  isBareDrawing,
  isImplicitFrame,
  rectsMatch,
  textAnnotation,
  type Thread,
} from '../lib/comment-selectors';
import { accentColor } from '@/lib/accent';
import { useMarkPreview, useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type Draft } from '../state/viewer-state';
import { markLabel } from '../lib/labels';
import { strokePath, strokesBounds } from '../lib/stroke-path';
import { dragTextBox, startFontSize } from '../lib/text-box';
import { DraftMark } from './DraftMark';
import { EditableFrame } from './EditableFrame';
import { Pin, type MarkState } from './Pin';
import { FrameEdges, RectFrame } from './RectFrame';
import { ShapeOutline } from './ShapeOutline';
import { StrokePath } from './StrokePath';
import { TextMark } from './TextBox';

interface AnnotationLayerProps {
  slide: Slide;
  threads: Thread[];
  emphasisId: string | null;
  draft: Draft | null;
  /** Box mode: the box a hovered/focused comment or the draft attaches to is outlined. */
  boxes?: boolean;
  /** Pointer mode: a click on the slide starts a comment, so frames let it through. */
  selecting?: boolean;
}

interface Mark {
  thread: Thread;
  rect: Rect;
  state: MarkState;
  /** How far the drawing is shown away from where it is stored, while it (or its box) is dragged. */
  shift: Shift;
}

interface Shift {
  dx: number;
  dy: number;
}

const NO_SHIFT: Shift = { dx: 0, dy: 0 };
/** Pointer travel (px) before a press on a drawing counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

/**
 * Renders the marks of all visible comments on a slide (BER-98): pins, frames and drawings.
 * Everything is positioned in normalised slide coordinates, so marks stay exact at every slide size.
 * Strokes live in one SVG with `viewBox="0 0 1 1"`; pins and frames are HTML for crisp borders.
 * Every comment carries its badge – the "P" square for PowerPoint comments, else the author's dot:
 * on its point, at a frame's top-left corner, or where a drawing starts. Frames, drawings and badge
 * share the author's colour, like the connector line. Text on the slide ("Text auf Folie")
 * is HTML in container units (`container-type: size`) and follows the same visibility as drawings.
 * Below the marks, in box mode: the PowerPoint shape the hovered/focused comment (or the draft) is
 * attached to – the raster image does not show them.
 */
export const AnnotationLayer = memo(function AnnotationLayer({
  slide,
  threads,
  emphasisId,
  draft,
  boxes = false,
  selecting = false,
}: AnnotationLayerProps) {
  const dispatch = useViewerDispatch();
  const { viewer, deck, canComment } = useViewerData();
  const update = useUpdateComment(deck.id);
  const layerRef = useRef<HTMLDivElement>(null);
  const registry = useStageRegistry();
  // A box being dragged: its badge follows it live.
  const preview = useMarkPreview();
  // A box keeps to the PowerPoint shape under its centre while box mode is on.
  const rectAnchor = (rect: Rect): Extract<Anchor, { type: 'rect' }> => ({
    type: 'rect',
    rect,
    shapeRef: boxes ? rectShapeRefAt(slide.shapes, rect) : null,
  });
  const isOwn = (comment: Comment) =>
    canComment && comment.source === 'app' && comment.author.id === viewer.author.id;

  const marks = useMemo<Mark[]>(() => {
    const result: Mark[] = [];
    for (const thread of threads) {
      // The drawing being commented on is shown by the draft.
      if (thread.id === draft?.commentId) continue;
      const stored = anchorRect(thread.root, slide.shapes);
      const rect = preview?.threadId === thread.id ? preview.rect : stored;
      if (!rect || !stored) continue;
      const state: MarkState =
        emphasisId === null ? 'normal' : thread.id === emphasisId ? 'emphasized' : 'dimmed';
      // Moved, not resized: the drawing goes along (as it will once stored).
      const moved =
        rect !== stored && Math.abs(rect.w - stored.w) < 1e-6 && Math.abs(rect.h - stored.h) < 1e-6;
      const shift = moved ? { dx: rect.x - stored.x, dy: rect.y - stored.y } : NO_SHIFT;
      result.push({ thread, rect, state, shift });
    }
    return result;
  }, [threads, slide.shapes, emphasisId, preview, draft?.commentId]);

  const emphasized = marks.find((mark) => mark.state === 'emphasized');
  const emphasizedShape =
    boxes && emphasized ? anchoredShape(emphasized.thread.root.anchor, slide.shapes) : null;
  const draftShape = boxes && draft ? anchoredShape(draft.anchor, slide.shapes) : null;

  // While composing, existing marks step back (B2).
  const composing = draft !== null;
  const opacityOf = (mark: Mark) => {
    if (composing || mark.state === 'dimmed') return 0.3;
    return mark.thread.root.status === 'done' ? 0.5 : 1;
  };
  // One's own freehand, arrow or marker drawing takes its comment in the composer.
  const commentable = (mark: Mark) =>
    isOwn(mark.thread.root) &&
    isBareDrawing(mark.thread) &&
    mark.thread.root.anchor.type !== 'gap';
  const activate = (mark: Mark) => {
    const { root } = mark.thread;
    if (commentable(mark))
      dispatch({
        type: 'drawingCommentStarted',
        slideId: slide.id,
        commentId: root.id,
        anchor: root.anchor,
        strokes: root.strokes,
      });
    else dispatch({ type: 'threadFocused', threadId: mark.thread.id, openPanel: true });
  };

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 [container-type:size]">
      {emphasizedShape && emphasized && !draftShape && (
        <ShapeOutline
          shape={emphasizedShape}
          variant="emphasis"
          color={accentColor(emphasized.thread.root.author.color)}
          labelled
        />
      )}
      {draftShape && (
        <ShapeOutline
          shape={draftShape}
          variant="target"
          color={accentColor(viewer.author.color)}
          labelled
        />
      )}
      <svg
        className="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden
      >
        {marks.map((mark) => {
          const { root } = mark.thread;
          return (
            <DrawingStrokes
              key={mark.thread.id}
              mark={mark}
              aspectRatio={slide.aspectRatio}
              opacity={opacityOf(mark)}
              interactive={!composing}
              movable={isOwn(root) && isDrawing(root)}
              onActivate={() => activate(mark)}
              onPreview={(shift) => {
                const stored = anchorRect(root, slide.shapes);
                registry.setMarkPreview(
                  shift && stored
                    ? {
                        threadId: mark.thread.id,
                        rect: { ...stored, x: stored.x + shift.dx, y: stored.y + shift.dy },
                      }
                    : null,
                );
              }}
              onMove={(shift, done) =>
                update.mutate({ commentId: root.id, move: shift }, { onSettled: done })
              }
            />
          );
        })}
      </svg>

      {marks.map((mark) => {
        const { root } = mark.thread;
        // A drawing is its own mark, wherever the comment is anchored.
        const area = (root.strokes.length > 0 && strokesBounds(root.strokes)) || mark.rect;
        const text = textAnnotation(root);
        // Freehand, arrow and marker stay themselves: no box; the strokes take the clicks.
        const bareStrokes =
          isDrawing(root) && (root.anchor.type !== 'rect' || isImplicitFrame(root));
        return (
          <div
            key={mark.thread.id}
            data-hover-thread={mark.thread.id}
            className={cn(composing && 'opacity-30')}
          >
            {root.anchor.type === 'rect' &&
              !isImplicitFrame(root) &&
              (isOwn(root) && !composing ? (
                // One's own box moves and resizes; a click opens its thread.
                <EditableFrame
                  rect={mark.rect}
                  color={accentColor(root.author.color)}
                  handles={mark.state === 'emphasized'}
                  emphasized={mark.state === 'emphasized'}
                  isMark
                  edgesOnly
                  title={`${markLabel(root)} – ziehen zum Verschieben`}
                  className={cn(
                    'transition-opacity duration-200',
                    mark.state === 'dimmed' && 'opacity-30',
                    root.status === 'done' && 'opacity-50',
                  )}
                  onActivate={() => activate(mark)}
                  onPreview={(rect) =>
                    registry.setMarkPreview(rect ? { threadId: mark.thread.id, rect } : null)
                  }
                  onCommit={(rect, done) =>
                    update.mutate(
                      { commentId: root.id, anchor: rectAnchor(rect) },
                      { onSettled: done },
                    )
                  }
                />
              ) : (
                <RectFrame
                  rect={mark.rect}
                  color={accentColor(root.author.color)}
                  className={cn(
                    'transition-opacity duration-200',
                    mark.state === 'dimmed' && 'opacity-30',
                    root.status === 'done' && 'opacity-50',
                  )}
                  emphasized={mark.state === 'emphasized'}
                  isMark
                />
              ))}
            {text ? (
              // The text box is the mark and the click target.
              <TextMark
                stroke={{ ...text, color: root.author.color }}
                label={markLabel(root)}
                opacity={mark.state === 'dimmed' ? 0.3 : root.status === 'done' ? 0.5 : 1}
                emphasized={mark.state === 'emphasized'}
                interactive={!composing}
                onActivate={() => activate(mark)}
                onPlace={
                  isOwn(root)
                    ? (textBox, done) =>
                        update.mutate({ commentId: root.id, textBox }, { onSettled: done })
                    : undefined
                }
              />
            ) : null}
            <Pin
              comment={root}
              at={badgePoint(root, area, mark.shift)}
              state={mark.state}
              onActivate={() => activate(mark)}
              aboveTools={!composing && commentable(mark)}
            />
            {root.anchor.type === 'rect' &&
              !text &&
              !bareStrokes &&
              !(isOwn(root) && !isImplicitFrame(root)) && (
                // The frame's border is a pointer target; keyboard users reach it through the badge.
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  title={markLabel(root)}
                  onClick={(event) => {
                    event.stopPropagation();
                    activate(mark);
                  }}
                  className="pointer-events-none absolute cursor-pointer rounded-thumb"
                  style={{
                    left: `${area.x * 100}%`,
                    top: `${area.y * 100}%`,
                    width: `${area.w * 100}%`,
                    height: `${area.h * 100}%`,
                  }}
                >
                  <FrameEdges active={!composing && !selecting} />
                </button>
              )}
          </div>
        );
      })}

      {draft && (
        <DraftMark
          draft={draft}
          author={viewer.author}
          aspectRatio={slide.aspectRatio}
          // A box picked with the pointer is outlined (and named) as the shape itself.
          frame={
            !(
              draftShape &&
              draft.anchor.type === 'rect' &&
              rectsMatch(draft.anchor.rect, draftShape.bbox)
            )
          }
          onRectChange={(rect) => {
            if (draft.slideId)
              dispatch({ type: 'anchorPlaced', slideId: draft.slideId, anchor: rectAnchor(rect) });
          }}
          onWriteInside={(rect, text) => {
            if (!draft.slideId) return;
            const fontSize = startFontSize(layerRef.current?.offsetHeight ?? 0);
            dispatch({
              type: 'textBoxPlaced',
              slideId: draft.slideId,
              box: dragTextBox(rect, fontSize),
              text,
            });
          }}
        />
      )}
    </div>
  );
});

/** The PowerPoint shape a pin or frame is attached to, if it still exists on this slide. */
function anchoredShape(anchor: Anchor, shapes: readonly Shape[]): Shape | null {
  if (anchor.type !== 'point' && anchor.type !== 'rect') return null;
  const ref = anchor.shapeRef;
  return ref ? (shapes.find((shape) => shape.id === ref.shapeId) ?? null) : null;
}

/** Where a comment's badge sits: its point, the start of its drawing, or the area's corner. */
function badgePoint(comment: Comment, area: Rect, shift: Shift): Point {
  const start = comment.strokes.find(isPathStroke)?.points[0];
  if (start) return { x: start.x + shift.dx, y: start.y + shift.dy };
  return { x: area.x, y: area.y };
}

interface DrawingStrokesProps {
  mark: Mark;
  aspectRatio: number;
  opacity: number;
  interactive: boolean;
  /** One's own drawing: dragging a stroke moves the whole drawing. */
  movable: boolean;
  onActivate: () => void;
  /** The drawing as shown while dragged, `null` once it is back in place. */
  onPreview: (shift: Shift | null) => void;
  /** Dropped somewhere else; call `done` once it is stored. */
  onMove: (shift: Shift, done: () => void) => void;
}

/** A comment's strokes in the slide's SVG, each with a wide invisible hit area along it. */
function DrawingStrokes({
  mark,
  aspectRatio,
  opacity,
  interactive,
  movable,
  onActivate,
  onPreview,
  onMove,
}: DrawingStrokesProps) {
  const { root } = mark.thread;
  const drag = useRef<{ x: number; y: number; box: DOMRect; shift: Shift | null } | null>(null);
  const dragged = useRef(false);

  const onPointerDown = (event: PointerEvent<SVGPathElement>) => {
    if (!movable || event.button !== 0) return;
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    // The slide below must not start a box or a pin.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, box, shift: null };
    dragged.current = false;
  };
  const onPointerMove = (event: PointerEvent<SVGPathElement>) => {
    const current = drag.current;
    if (!current) return;
    const px = event.clientX - current.x;
    const py = event.clientY - current.y;
    if (!current.shift && Math.hypot(px, py) < DRAG_THRESHOLD) return;
    current.shift = clampDrawingShift(root, px / current.box.width, py / current.box.height);
    dragged.current = true;
    onPreview(current.shift);
  };
  const onPointerUp = () => {
    const shift = drag.current?.shift;
    drag.current = null;
    if (shift) onMove(shift, () => onPreview(null));
  };
  const onPointerCancel = () => {
    if (drag.current?.shift) onPreview(null);
    drag.current = null;
  };

  const { dx, dy } = mark.shift;
  return (
    <g
      data-hover-thread={mark.thread.id}
      transform={dx || dy ? `translate(${dx} ${dy})` : undefined}
    >
      {root.strokes.filter(isPathStroke).map((stroke, index) => (
        <g key={index}>
          <StrokePath
            // Drawings always take the author's colour, like the connector line.
            stroke={{ ...stroke, color: root.author.color }}
            aspectRatio={aspectRatio}
            opacity={opacity}
            emphasized={mark.state === 'emphasized'}
            isMark
          />
          <path
            d={strokePath(stroke, aspectRatio)}
            fill="none"
            stroke="transparent"
            strokeWidth={16}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pointerEvents={interactive ? 'stroke' : 'none'}
            className={cn('touch-none', movable ? 'cursor-move' : 'cursor-pointer')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClick={(event) => {
              event.stopPropagation();
              if (!dragged.current) onActivate();
              dragged.current = false;
            }}
          />
        </g>
      ))}
    </g>
  );
}
