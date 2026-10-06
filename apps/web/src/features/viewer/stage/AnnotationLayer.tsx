import type { Rect, Slide } from '@slider/shared';
import { memo, useMemo } from 'react';
import { cn } from '@/ui';
import { anchorRect, type Thread } from '../lib/comment-selectors';
import { markColor } from '../lib/colors';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type Draft } from '../state/viewer-state';
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
 * Everything is positioned in normalised slide coordinates, so marks stay exact at every zoom.
 * Strokes live in one SVG with `viewBox="0 0 1 1"`; pins and frames are HTML for crisp borders.
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
            <StrokePath
              key={`${mark.thread.id}-${index}`}
              stroke={stroke}
              aspectRatio={slide.aspectRatio}
              opacity={opacityOf(mark)}
              emphasized={mark.state === 'emphasized'}
            />
          )),
        )}
      </svg>

      {marks.map((mark) => {
        const { root } = mark.thread;
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
              />
            )}
            <Pin
              comment={root}
              at={
                root.anchor.type === 'point'
                  ? mark.rect
                  : { x: mark.rect.x + mark.rect.w, y: mark.rect.y }
              }
              state={mark.state}
              onActivate={() =>
                dispatch({ type: 'threadFocused', threadId: mark.thread.id, openPanel: true })
              }
              onHover={(hovering) =>
                dispatch({ type: 'threadHovered', threadId: hovering ? mark.thread.id : null })
              }
            />
          </div>
        );
      })}

      {draft && <DraftMark draft={draft} author={viewer.author} aspectRatio={slide.aspectRatio} />}
    </div>
  );
});
