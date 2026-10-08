import type { Rect, Slide } from '@slider/shared';
import { memo, useMemo } from 'react';
import { cn } from '@/ui';
import { anchorRect, type Thread } from '../lib/comment-selectors';
import { markColor } from '../lib/colors';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type Draft } from '../state/viewer-state';
import { markLabel } from '../lib/labels';
import { strokePath, strokesBounds } from '../lib/stroke-path';
import { DraftMark } from './DraftMark';
import { Pin, type MarkState } from './Pin';
import { RectFrame } from './RectFrame';
import { StrokePath } from './StrokePath';

interface AnnotationLayerProps {
  slide: Slide;
  threads: Thread[];
  emphasisId: string | null;
  draft: Draft | null;
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
 * Only point comments without a drawing get a dot (B1): frames and drawings are themselves the
 * click target, and their connector line leaves the shape.
 */
export const AnnotationLayer = memo(function AnnotationLayer({
  slide,
  threads,
  emphasisId,
  draft,
}: AnnotationLayerProps) {
  const dispatch = useViewerDispatch();
  const { viewer } = useViewerData();

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
    <div className="pointer-events-none absolute inset-0">
      <svg
        className="absolute inset-0 size-full overflow-visible"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-hidden
      >
        {marks.map((mark) =>
          mark.thread.root.strokes.map((stroke, index) => (
            <g key={`${mark.thread.id}-${index}`}>
              <StrokePath
                stroke={stroke}
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
        return (
          <div key={mark.thread.id} className={cn(composing && 'opacity-30')}>
            {root.anchor.type === 'rect' && (
              <RectFrame
                rect={mark.rect}
                color={markColor(root)}
                className={cn(
                  'transition-opacity duration-200',
                  mark.state === 'dimmed' && 'opacity-30',
                  root.status === 'done' && 'opacity-50',
                )}
                emphasized={mark.state === 'emphasized'}
                isMark
              />
            )}
            {root.anchor.type === 'point' && root.strokes.length === 0 ? (
              <Pin
                comment={root}
                at={mark.rect}
                state={mark.state}
                onActivate={() => activate(mark)}
                onHover={(hovering) => hover(mark, hovering)}
              />
            ) : (
              // Frame: the whole area is the target. Drawing: only reachable by keyboard here,
              // the pointer hits the stroke itself (above).
              <button
                type="button"
                aria-label={markLabel(root)}
                title={markLabel(root)}
                onClick={(event) => {
                  event.stopPropagation();
                  activate(mark);
                }}
                onPointerEnter={() => hover(mark, true)}
                onPointerLeave={() => hover(mark, false)}
                onFocus={() => hover(mark, true)}
                onBlur={() => hover(mark, false)}
                className={cn(
                  'absolute rounded-thumb outline-offset-2',
                  root.anchor.type === 'rect' && !composing
                    ? 'pointer-events-auto cursor-pointer'
                    : 'pointer-events-none',
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

      {draft && <DraftMark draft={draft} author={viewer.author} aspectRatio={slide.aspectRatio} />}
    </div>
  );
});
