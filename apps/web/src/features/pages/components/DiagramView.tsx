import { useId, type ReactNode } from 'react';
import {
  curvePath,
  GROUP_TEXT,
  LABEL_TEXT,
  LINE_HEIGHT,
  NODE_TEXT,
  type Placed,
  type PlacedNode,
} from '../lib/diagram/layout';
import type { Head, Look, Shape } from '../lib/diagram/parse';

/*
 * A diagram drawn: groups as soft frames with their name on the top line, arrows as quiet curves
 * under the boxes, boxes in their shapes with their words. Everything in the theme's tokens
 * (page.css), so it reads in light and dark; colours the text gives are laid over them.
 */

/** A box's outline around its centre. */
export function shapePath(shape: Shape, w: number, h: number): string {
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const poly = (points: [number, number][]) =>
    `M${points.map(([x, y]) => `${r(x)},${r(y)}`).join('L')}Z`;
  const rounded = (radius: number) => {
    const k = Math.min(radius, w / 2, h / 2);
    return `M${r(x0 + k)},${r(y0)}H${r(x1 - k)}A${r(k)},${r(k)} 0 0 1 ${r(x1)},${r(y0 + k)}V${r(y1 - k)}A${r(k)},${r(k)} 0 0 1 ${r(x1 - k)},${r(y1)}H${r(x0 + k)}A${r(k)},${r(k)} 0 0 1 ${r(x0)},${r(y1 - k)}V${r(y0 + k)}A${r(k)},${r(k)} 0 0 1 ${r(x0 + k)},${r(y0)}Z`;
  };
  const s = h * 0.3;
  switch (shape) {
    case 'round':
      return rounded(14);
    case 'stadium':
      return rounded(h / 2);
    case 'circle':
    case 'double-circle': {
      const radius = w / 2;
      return `M${r(-radius)},0A${r(radius)},${r(radius)} 0 1 1 ${r(radius)},0A${r(radius)},${r(radius)} 0 1 1 ${r(-radius)},0Z`;
    }
    case 'rhombus':
      return poly([
        [0, y0],
        [x1, 0],
        [0, y1],
        [x0, 0],
      ]);
    case 'hexagon': {
      const i = h / 4;
      return poly([
        [x0 + i, y0],
        [x1 - i, y0],
        [x1, 0],
        [x1 - i, y1],
        [x0 + i, y1],
        [x0, 0],
      ]);
    }
    case 'lean-right':
      return poly([
        [x0 + s, y0],
        [x1, y0],
        [x1 - s, y1],
        [x0, y1],
      ]);
    case 'lean-left':
      return poly([
        [x0, y0],
        [x1 - s, y0],
        [x1, y1],
        [x0 + s, y1],
      ]);
    case 'trapezoid':
      return poly([
        [x0 + s, y0],
        [x1 - s, y0],
        [x1, y1],
        [x0, y1],
      ]);
    case 'trapezoid-alt':
      return poly([
        [x0, y0],
        [x1, y0],
        [x1 - s, y1],
        [x0 + s, y1],
      ]);
    case 'flag':
      return poly([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0 + 12, 0],
      ]);
    case 'cylinder': {
      const ry = 7;
      return `M${r(x0)},${r(y0 + ry)}A${r(w / 2)},${ry} 0 0 1 ${r(x1)},${r(y0 + ry)}V${r(y1 - ry)}A${r(w / 2)},${ry} 0 0 1 ${r(x0)},${r(y1 - ry)}Z`;
    }
    default:
      return rounded(6);
  }
}

const r = (n: number) => Math.round(n * 10) / 10;

/** Lines a box adds inside its outline: a cylinder's lid, a subroutine's bars, a double ring. */
function shapeDetail(shape: Shape, w: number, h: number): string | null {
  if (shape === 'cylinder') {
    const ry = 7;
    return `M${r(-w / 2)},${r(-h / 2 + ry)}A${r(w / 2)},${ry} 0 0 0 ${r(w / 2)},${r(-h / 2 + ry)}`;
  }
  if (shape === 'subroutine') {
    return `M${r(-w / 2 + 8)},${r(-h / 2)}V${r(h / 2)}M${r(w / 2 - 8)},${r(-h / 2)}V${r(h / 2)}`;
  }
  if (shape === 'double-circle') {
    const radius = w / 2 - 5;
    return `M${r(-radius)},0A${r(radius)},${r(radius)} 0 1 1 ${r(radius)},0A${r(radius)},${r(radius)} 0 1 1 ${r(-radius)},0Z`;
  }
  return null;
}

/** Black or white words on a colour the text gives – none for a see-through or unknown one. */
export function inkOn(fill: string | undefined): string | undefined {
  if (!fill) return undefined;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(fill.trim())?.[1];
  if (!hex) return undefined;
  const full =
    hex.length <= 4
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  if (alpha < 0.6) return undefined;
  const [red, green, blue] = [0, 2, 4].map((at) => {
    const c = parseInt(full.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return light > 0.36 ? '#000000' : '#ffffff';
}

/** Lines of words centred on a point. */
function Words({
  lines,
  size,
  className,
  x = 0,
  y = 0,
  color,
}: {
  lines: readonly string[];
  size: number;
  className: string;
  x?: number;
  y?: number;
  color?: string;
}) {
  const step = size * LINE_HEIGHT;
  const top = y - ((lines.length - 1) * step) / 2;
  return (
    <text className={className} x={x} y={top} style={color ? { fill: color } : undefined}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} y={r(top + index * step)}>
          {line || ' '}
        </tspan>
      ))}
    </text>
  );
}

function markerOf(head: Head, prefix: string, end: 'start' | 'end'): string | undefined {
  if (head === 'none') return undefined;
  return `url(#${prefix}-${head}${end === 'start' ? '-start' : ''})`;
}

export interface DiagramViewProps {
  placed: Placed;
  /** Read out for who cannot see it. */
  label: string;
  /** A box drawn as picked. */
  picked?: string | null;
  /** Drawn over the boxes (handles, a field to type in). */
  children?: ReactNode;
  className?: string;
}

/** How far a drawing is shrunk to its column at most; wider still, it scrolls sideways. */
export const MIN_SCALE = 0.75;

/** The drawing at its natural size; the block around it scales it down to the column. */
export function DiagramView({ placed, label, picked, children, className }: DiagramViewProps) {
  const prefix = `dg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg
      className={className ?? 'page-diagram-svg'}
      viewBox={`0 0 ${placed.width} ${placed.height}`}
      width={placed.width}
      height={placed.height}
      role="img"
      aria-label={label}
    >
      <defs>
        {(['arrow', 'circle', 'cross'] as const).flatMap((head) =>
          (['', '-start'] as const).map((end) => (
            <marker
              key={head + end}
              id={`${prefix}-${head}${end}`}
              viewBox="0 0 10 10"
              refX={head === 'arrow' ? 9 : 5}
              refY="5"
              markerWidth="8"
              markerHeight="8"
              markerUnits="userSpaceOnUse"
              orient={end ? 'auto-start-reverse' : 'auto'}
              className="page-diagram-head"
            >
              {head === 'arrow' ? (
                <path d="M1,1.5L9,5L1,8.5Z" />
              ) : head === 'circle' ? (
                <circle cx="5" cy="5" r="3.5" />
              ) : (
                <path d="M2,2L8,8M8,2L2,8" className="page-diagram-head-cross" />
              )}
            </marker>
          )),
        )}
      </defs>

      {placed.groups.map((frame) => (
        <g key={frame.group.id} className="page-diagram-group" data-group={frame.group.id}>
          <rect
            x={r(frame.x)}
            y={r(frame.y)}
            width={r(frame.width)}
            height={r(frame.height)}
            rx={12}
            style={groupStyle(frame.group.look)}
          />
        </g>
      ))}

      {placed.edges.map((placedEdge) => {
        const { edge } = placedEdge;
        if (edge.stroke === 'invisible') return null;
        return (
          <path
            key={placedEdge.index}
            className="page-diagram-edge"
            data-stroke={edge.stroke}
            data-edge={placedEdge.index}
            d={curvePath(placedEdge.points)}
            markerEnd={markerOf(edge.head, prefix, 'end')}
            markerStart={markerOf(edge.tail, prefix, 'start')}
          />
        );
      })}

      {/* Wide, unseen: an arrow is hit where it runs, not only on its hairline. */}
      {placed.edges.map((placedEdge) =>
        placedEdge.edge.stroke === 'invisible' ? null : (
          <path
            key={placedEdge.index}
            className="page-diagram-edge-hit"
            data-edge={placedEdge.index}
            d={curvePath(placedEdge.points)}
          />
        ),
      )}

      {placed.nodes.map((box) => (
        <Box key={box.node.id} box={box} picked={picked === box.node.id} />
      ))}

      {placed.edges.map((placedEdge) =>
        placedEdge.label && placedEdge.edge.stroke !== 'invisible' ? (
          <g
            key={placedEdge.index}
            className="page-diagram-edge-label"
            data-edge-label={placedEdge.index}
          >
            <rect
              x={r(placedEdge.label.x - placedEdge.label.width / 2)}
              y={r(placedEdge.label.y - placedEdge.label.height / 2)}
              width={r(placedEdge.label.width)}
              height={r(placedEdge.label.height)}
              rx={4}
            />
            <Words
              lines={placedEdge.label.lines}
              size={LABEL_TEXT}
              className="page-diagram-edge-text"
              x={r(placedEdge.label.x)}
              y={r(placedEdge.label.y)}
            />
          </g>
        ) : null,
      )}

      {/* Group names last: on their frame's top line, over arrows that cross it. */}
      {placed.groups.map((frame) =>
        frame.group.label ? (
          <GroupName
            key={frame.group.id}
            x={frame.x + 12}
            y={frame.y}
            width={frame.labelWidth}
            text={frame.group.label}
          />
        ) : null,
      )}

      {children}
    </svg>
  );
}

function groupStyle(look: Look) {
  if (!look.fill && !look.stroke) return undefined;
  return {
    ...(look.fill ? { fill: look.fill } : {}),
    ...(look.stroke ? { stroke: look.stroke } : {}),
  };
}

function GroupName({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const height = GROUP_TEXT * LINE_HEIGHT + 6;
  return (
    <g className="page-diagram-group-name">
      <rect
        x={r(x)}
        y={r(y - height / 2)}
        width={r(width + 16)}
        height={r(height)}
        rx={height / 2}
      />
      <text x={r(x + 8)} y={r(y)} className="page-diagram-group-text">
        {text}
      </text>
    </g>
  );
}

function Box({ box, picked }: { box: PlacedNode; picked: boolean }) {
  const { node, width, height } = box;
  const outline = shapePath(node.shape, width, height);
  const detail = shapeDetail(node.shape, width, height);
  const look = node.look;
  return (
    <g
      className="page-diagram-node"
      data-node={node.id}
      data-picked={picked || undefined}
      transform={`translate(${r(box.x)},${r(box.y)})`}
    >
      <path className="page-diagram-node-ground" d={outline} />
      <path
        className="page-diagram-node-shape"
        d={outline}
        style={{
          ...(look.fill ? { fill: look.fill } : {}),
          ...(look.stroke ? { stroke: look.stroke } : {}),
          ...(look.dashed ? { strokeDasharray: '5 4' } : {}),
        }}
      />
      {detail && (
        <path
          className="page-diagram-node-detail"
          d={detail}
          style={look.stroke ? { stroke: look.stroke } : undefined}
        />
      )}
      <Words
        lines={box.lines}
        size={NODE_TEXT}
        className="page-diagram-node-text"
        color={look.color ?? inkOn(look.fill)}
      />
    </g>
  );
}
