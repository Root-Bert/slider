import {
  isPathStroke,
  type Anchor,
  type Comment,
  type Point,
  type Rect,
  type Shape,
  type Slide,
} from '@slider/shared';
import { memo, useMemo } from 'react';
import { useUpdateComment } from '@/lib/queries';
import { cn } from '@/ui';
import {
  anchorRect,
  isImplicitFrame,
  rectsMatch,
  textAnnotation,
  type Thread,
} from '../lib/comment-selectors';
import { accentColor } from '@/lib/accent';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type Draft } from '../state/viewer-state';
import { markLabel } from '../lib/labels';
import { strokePath, strokesBounds } from '../lib/stroke-path';
import { DraftMark } from './DraftMark';
import { Pin, type MarkState } from './Pin';
import { RectFrame } from './RectFrame';
import { ShapeOutline } from './ShapeOutline';
import { StrokePath } from './StrokePath';
import { TextMark } from './TextBox';

interface AnnotationLayerProps {
  slide: Slide;
  threads: Thread[];
  emphasisId: string | null;
  draft: Draft | null;
  /** "Boxen zeigen": outline every PowerPoint shape. */
  showShapes?: boolean;
  /** Shape under the pointer while all boxes are shown – it gets its name. */
  hoveredShapeId?: string | null;
}

interface Mark {
  thread: Thread;
  rect: Rect;
  state: MarkState;
}

/**
 * Renders the marks of all visible comments on a slide (BER-98): pins, frames and drawings.
 * Everything is positioned in normalised slide coordinates, so marks stay exact at every slide size.
 * Strokes live in one SVG with `viewBox="0 0 1 1"`; pins and frames are HTML for crisp borders.
 * Every comment carries its badge – the "P" square for PowerPoint comments, else the author's dot:
 * on its point, at a frame's top-left corner, or where a drawing starts. Frames, drawings and badge
 * share the author's colour, like the connector line. Text on the slide ("Text auf Folie")
 * is HTML in container units (`container-type: size`) and follows the same visibility as drawings.
 * Below the marks: the PowerPoint shape the hovered/focused comment (or the draft) is attached to,
 * and with "Boxen zeigen" every shape – the raster image does not show them.
 */
export const AnnotationLayer = memo(function AnnotationLayer({
  slide,
  threads,
  emphasisId,
  draft,
  showShapes = false,
  hoveredShapeId = null,
}: AnnotationLayerProps) {
  const dispatch = useViewerDispatch();
  const { viewer, deck, canComment } = useViewerData();
  const update = useUpdateComment(deck.id);

  const marks = useMemo<Mark[]>(() => {
    const result: Mark[] = [];
    for (const thread of threads) {
      const rect = anchorRect(thread.root, slide.shapes);
      if (!rect) continue;
      const state: MarkState =
        emphasisId === null ? 'normal' : thread.id === emphasisId ? 'emphasized' : 'dimmed';
      result.push({ thread, rect, state });
    }
    return result;
  }, [threads, slide.shapes, emphasisId]);

  const emphasized = marks.find((mark) => mark.state === 'emphasized');
  const emphasizedShape = emphasized
    ? anchoredShape(emphasized.thread.root.anchor, slide.shapes)
    : null;
  const draftShape = draft ? anchoredShape(draft.anchor, slide.shapes) : null;
  const highlighted = new Set([emphasizedShape?.id, draftShape?.id]);

  // While composing, existing marks step back (B2).
  const composing = draft !== null;
  const opacityOf = (mark: Mark) => {
    if (composing || mark.state === 'dimmed') return 0.3;
    return mark.thread.root.status === 'done' ? 0.5 : 1;
  };
  const activate = (mark: Mark) =>
    dispatch({ type: 'threadFocused', threadId: mark.thread.id, openPanel: true });
  const hover = (mark: Mark, hovering: boolean) =>
    dispatch({ type: 'threadHovered', threadId: hovering ? mark.thread.id : null });

  return (
    <div className="pointer-events-none absolute inset-0 [container-type:size]">
      {showShapes &&
        slide.shapes
          .filter((shape) => !highlighted.has(shape.id))
          .map((shape) => (
            <ShapeOutline
              key={shape.id}
              shape={shape}
              variant="faint"
              labelled={shape.id === hoveredShapeId}
            />
          ))}
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
        {marks.map((mark) =>
          mark.thread.root.strokes.filter(isPathStroke).map((stroke, index) => (
            <g key={`${mark.thread.id}-${index}`}>
              <StrokePath
                // Drawings always take the author's colour, like the connector line.
                stroke={{ ...stroke, color: mark.thread.root.author.color }}
                aspectRatio={slide.aspectRatio}
                opacity={opacityOf(mark)}
                emphasized={mark.state === 'emphasized'}
                isMark
              />
              {/* Wide invisible hit area along the drawing. */}
              <path
                d={strokePath(stroke, slide.aspectRatio)}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents={composing ? 'none' : 'stroke'}
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  activate(mark);
                }}
                onPointerEnter={() => hover(mark, true)}
                onPointerLeave={() => hover(mark, false)}
              />
            </g>
          )),
        )}
      </svg>

      {marks.map((mark) => {
        const { root } = mark.thread;
        // A drawing is its own mark, wherever the comment is anchored.
        const area = (root.strokes.length > 0 && strokesBounds(root.strokes)) || mark.rect;
        const text = textAnnotation(root);
        return (
          <div key={mark.thread.id} className={cn(composing && 'opacity-30')}>
            {root.anchor.type === 'rect' && !isImplicitFrame(root) && (
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
            )}
            {text ? (
              // The text box is the mark and the click target.
              <TextMark
                stroke={{ ...text, color: root.author.color }}
                label={markLabel(root)}
                opacity={mark.state === 'dimmed' ? 0.3 : root.status === 'done' ? 0.5 : 1}
                emphasized={mark.state === 'emphasized'}
                interactive={!composing}
                onActivate={() => activate(mark)}
                onHover={(hovering) => hover(mark, hovering)}
                onPlace={
                  canComment && root.source === 'app' && root.author.id === viewer.author.id
                    ? (textBox, done) =>
                        update.mutate({ commentId: root.id, textBox }, { onSettled: done })
                    : undefined
                }
              />
            ) : null}
            <Pin
              comment={root}
              at={badgePoint(root, area)}
              state={mark.state}
              onActivate={() => activate(mark)}
              onHover={(hovering) => hover(mark, hovering)}
            />
            {root.anchor.type === 'rect' && !text && (
              // The whole frame is a pointer target; keyboard users reach it through the badge.
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                title={markLabel(root)}
                onClick={(event) => {
                  event.stopPropagation();
                  activate(mark);
                }}
                onPointerEnter={() => hover(mark, true)}
                onPointerLeave={() => hover(mark, false)}
                className={cn(
                  'absolute rounded-thumb',
                  composing ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer',
                )}
                style={{
                  left: `${area.x * 100}%`,
                  top: `${area.y * 100}%`,
                  width: `${area.w * 100}%`,
                  height: `${area.h * 100}%`,
                }}
              />
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
function badgePoint(comment: Comment, area: Rect): Point {
  const drawing = comment.strokes.find(isPathStroke);
  if (drawing?.points[0]) return drawing.points[0];
  return { x: area.x, y: area.y };
}
