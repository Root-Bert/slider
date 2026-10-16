import type { AccentColor, Point, Slide } from '@slider/shared';
import { useRef, type PointerEvent, type RefObject } from 'react';
import { useEraseDrawing } from '@/lib/api';
import { useDraftDrawing } from './hooks/useDraftDrawing';
import { isBareDrawing, type Thread } from '../comments/lib/comment-selectors';
import { STROKE_STYLE } from './lib/stroke-path';
import { useViewerData } from '../state/viewer-data';
import type { PenTool, Tool } from '../state/viewer-state';
import { StrokePath } from './StrokePath';

interface DrawingSurfaceProps {
  slide: Slide;
  boxRef: RefObject<HTMLElement | null>;
  tool: Tool;
  color: AccentColor;
  threads: Thread[];
}

/**
 * Transparent layer above a slide that captures pointer input while a pen or the eraser is picked.
 * `touch-action: none` only here, so the stage stays swipeable when no pen is selected.
 */
export function DrawingSurface({ slide, boxRef, tool, color, threads }: DrawingSurfaceProps) {
  return tool === 'eraser' ? (
    <EraserSurface boxRef={boxRef} threads={threads} />
  ) : (
    <PenSurface slide={slide} boxRef={boxRef} tool={tool} color={color} />
  );
}

function PenSurface({
  slide,
  boxRef,
  tool,
  color,
}: Pick<DrawingSurfaceProps, 'slide' | 'boxRef' | 'color'> & { tool: PenTool }) {
  const { handlers, previewStrokes } = useDraftDrawing({ slide, boxRef, tool, color });

  return (
    <div {...handlers} className="absolute inset-0 z-20 cursor-crosshair touch-none select-none">
      {previewStrokes.length > 0 && (
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden
        >
          {previewStrokes.map((stroke, index) => (
            <StrokePath key={index} stroke={stroke} aspectRatio={slide.aspectRatio} />
          ))}
        </svg>
      )}
    </div>
  );
}

/** Extra reach of the eraser beyond half a stroke's width, in px. */
const ERASER_REACH = 6;

/** Distance (px) from `p` to the segment `a`–`b`. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The eraser: pressing or wiping over one's own freehand, arrow or marker drawing removes it. Each of
 * those strokes is a comment of its own, so the whole comment goes.
 */
function EraserSurface({ boxRef, threads }: Pick<DrawingSurfaceProps, 'boxRef' | 'threads'>) {
  const { deck, viewer } = useViewerData();
  const erase = useEraseDrawing(deck.id);
  const erased = useRef(new Set<string>());
  const wiping = useRef(false);

  const erasable = threads.filter(
    (thread) =>
      thread.root.source === 'app' &&
      thread.root.author.id === viewer.author.id &&
      isBareDrawing(thread) &&
      thread.root.strokes.every(
        (stroke) =>
          stroke.tool === 'pen' || stroke.tool === 'highlighter' || stroke.tool === 'arrow',
      ),
  );

  const eraseAt = (event: PointerEvent) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const p = { x: event.clientX - box.left, y: event.clientY - box.top };
    const px = ({ x, y }: Point) => ({ x: x * box.width, y: y * box.height });
    for (const thread of erasable) {
      if (erased.current.has(thread.id)) continue;
      const hit = thread.root.strokes.some((stroke) => {
        if (stroke.tool === 'text') return false;
        const reach = STROKE_STYLE[stroke.tool].width / 2 + ERASER_REACH;
        const points = stroke.points.map(px);
        return points.some(
          (point, index) => segmentDistance(p, points[index - 1] ?? point, point) <= reach,
        );
      });
      if (!hit) continue;
      erased.current.add(thread.id);
      erase.mutate(thread.id);
    }
  };

  return (
    <div
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        wiping.current = true;
        eraseAt(event);
      }}
      onPointerMove={(event) => {
        if (wiping.current) eraseAt(event);
      }}
      onPointerUp={() => {
        wiping.current = false;
      }}
      onPointerCancel={() => {
        wiping.current = false;
      }}
      className="absolute inset-0 z-20 cursor-cell touch-none select-none"
    />
  );
}
