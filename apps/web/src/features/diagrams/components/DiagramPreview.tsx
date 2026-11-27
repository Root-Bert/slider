import './diagram.css';
import type { Diagram, DiagramNode } from '@slider/shared';
import { getBezierPath, getSmoothStepPath, getStraightPath } from '@xyflow/react';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/ui';
import { rectIn } from '../lib/edit';
import { arrowEnds, type Rect } from '../lib/flow';
import { tintProps } from './context';
import { ShapeOutline } from './ShapeOutline';

const PAD = 24;

/** Where everything drawn lies, on the canvas; null when nothing is. */
function diagramBounds(diagram: Diagram): Rect | null {
  if (diagram.nodes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of diagram.nodes) {
    const rect = rectIn(diagram, box);
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left - PAD, y: top - PAD, width: right - left + 2 * PAD, height: bottom - top + 2 * PAD };
}

function depthOf(byId: Map<string, DiagramNode>, box: DiagramNode): number {
  let depth = 0;
  for (let at = box.parent && byId.get(box.parent); at && depth < 32; at = at.parent && byId.get(at.parent)) depth += 1;
  return depth;
}

/**
 * A diagram as it is drawn in its editor, still: the same boxes, frames and arrows (the editor's
 * own pieces and look), scaled down to fit its place – on a page, in Cloud. Nothing in it reacts;
 * what holds it decides what a click does.
 */
export function DiagramPreview({
  diagram,
  maxHeight = 560,
  className,
}: {
  diagram: Diagram;
  /** Taller drawings are scaled down further, to stay within it. */
  maxHeight?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Two drawings on one page: their arrow heads must not take each other's.
  const prefix = `dg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const drawn = useMemo(() => {
    const bounds = diagramBounds(diagram);
    if (!bounds) return null;
    const byId = new Map(diagram.nodes.map((box) => [box.id, box]));
    const rects = new Map(diagram.nodes.map((box) => [box.id, rectIn(diagram, box)]));
    const frames = diagram.nodes
      .filter((box) => box.shape === 'frame')
      .sort((a, b) => depthOf(byId, a) - depthOf(byId, b));
    const boxes = diagram.nodes.filter((box) => box.shape !== 'frame');
    const arrows = diagram.edges.flatMap((arrow) => {
      const from = rects.get(arrow.from);
      const to = rects.get(arrow.to);
      if (!from || !to) return [];
      const ends = arrowEnds(from, to, arrow);
      const [path, labelX, labelY] =
        arrow.route === 'curve'
          ? getBezierPath(ends)
          : arrow.route === 'straight'
            ? getStraightPath(ends)
            : getSmoothStepPath({ ...ends, borderRadius: 10, offset: 20 });
      return [{ arrow, path, labelX, labelY }];
    });
    return { bounds, rects, frames, boxes, arrows };
  }, [diagram]);

  if (!drawn) return <div ref={ref} className={cn('dg-flow dg-static', className)} />;
  const { bounds, rects, frames, boxes, arrows } = drawn;
  const scale = width > 0 ? Math.min(1, width / bounds.width, maxHeight / bounds.height) : 0;
  const place = (box: DiagramNode) => {
    const rect = rects.get(box.id)!;
    return { left: rect.x - bounds.x, top: rect.y - bounds.y, width: rect.width, height: rect.height };
  };
  return (
    <div
      ref={ref}
      className={cn('dg-flow dg-static', className)}
      style={{ height: Math.ceil(bounds.height * scale) }}
    >
      {scale > 0 && (
        <div
          className="dg-static-stage"
          style={{
            width: bounds.width,
            height: bounds.height,
            left: Math.max(0, (width - bounds.width * scale) / 2),
            transform: `scale(${scale})`,
          }}
        >
          {frames.map((box) => (
            <div key={box.id} className="dg-static-node" style={place(box)}>
              <div className="dg-box" data-shape="frame" {...tintProps(box.color)}>
                <div className="dg-frame" />
                <div className="dg-frame-title">{box.text}</div>
              </div>
            </div>
          ))}
          <svg className="dg-static-arrows" width={bounds.width} height={bounds.height}>
            <g transform={`translate(${-bounds.x} ${-bounds.y})`}>
              {arrows.map(({ arrow, path }) => {
                const head = `${prefix}-${arrow.id}`;
                return (
                  <g key={arrow.id} className="dg-arrow-group" {...tintProps(arrow.color)}>
                    <defs>
                      <marker
                        id={head}
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="11"
                        markerHeight="11"
                        markerUnits="userSpaceOnUse"
                        orient="auto-start-reverse"
                      >
                        <path className="dg-arrow-head" d="M0.5,0.8 L10,5 L0.5,9.2 L2.6,5 Z" />
                      </marker>
                    </defs>
                    <path
                      className="dg-arrow"
                      data-line={arrow.line}
                      d={path}
                      markerEnd={(arrow.end ?? 'arrow') === 'arrow' ? `url(#${head})` : undefined}
                      markerStart={arrow.start === 'arrow' ? `url(#${head})` : undefined}
                    />
                  </g>
                );
              })}
            </g>
          </svg>
          {boxes.map((box) => (
            <div key={box.id} className="dg-static-node" style={place(box)}>
              <div className="dg-box" data-shape={box.shape} data-size={box.size} {...tintProps(box.color)}>
                <ShapeOutline shape={box.shape} width={box.width} height={box.height} />
                <div className="dg-text">{box.text}</div>
              </div>
            </div>
          ))}
          {arrows.map(
            ({ arrow, labelX, labelY }) =>
              arrow.label && (
                <div
                  key={arrow.id}
                  className="dg-label"
                  style={{
                    transform: `translate(-50%, -50%) translate(${labelX - bounds.x}px, ${labelY - bounds.y}px)`,
                  }}
                >
                  {arrow.label}
                </div>
              ),
          )}
        </div>
      )}
    </div>
  );
}
