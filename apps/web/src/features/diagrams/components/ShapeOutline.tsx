import type { DiagramShape } from '@slider/shared';

/**
 * A box's outline in its size – fill and stroke come from its tint (`diagram.css`). Drawn inside
 * by half the stroke so the outline lies exactly on the box's edge, where arrows end.
 */
export function ShapeOutline({
  shape,
  width,
  height,
}: {
  shape: DiagramShape;
  width: number;
  height: number;
}) {
  const s = 1; // half the stroke
  const w = Math.max(width, 2);
  const h = Math.max(height, 2);
  return (
    <svg
      className="dg-outline"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
      overflow="visible"
    >
      {outline(shape, w, h, s)}
    </svg>
  );
}

/** The shape small, as the tools and menus show it: its outline in the current colour. */
export function ShapeIcon({ shape, size = 20 }: { shape: DiagramShape; size?: number }) {
  const w = shape === 'rhombus' || shape === 'ellipse' ? 16 : 18;
  const h = shape === 'cylinder' || shape === 'note' ? 16 : shape === 'rhombus' ? 16 : 12;
  return (
    <svg className="dg-icon" width={size} height={size} viewBox="-1 -1 20 20" aria-hidden>
      <g transform={`translate(${(18 - w) / 2} ${(18 - h) / 2})`}>{outline(shape, w, h, 0.75)}</g>
    </svg>
  );
}

function outline(shape: DiagramShape, w: number, h: number, s: number) {
  switch (shape) {
    case 'rect':
      return <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} rx={3} />;
    case 'rounded':
      return <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} rx={Math.min(12, h / 4)} />;
    case 'pill':
      return <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} rx={(h - 2 * s) / 2} />;
    case 'note':
      return <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} rx={4} className="dg-note" />;
    case 'frame':
      return <rect x={s} y={s} width={w - 2 * s} height={h - 2 * s} rx={14} />;
    case 'text':
      return null;
    case 'ellipse':
      return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - s} ry={h / 2 - s} />;
    case 'rhombus':
      return <polygon points={`${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`} strokeLinejoin="round" />;
    case 'hexagon': {
      const k = Math.min(22, w * 0.18, h * 0.5);
      return (
        <polygon
          points={`${k},${s} ${w - k},${s} ${w - s},${h / 2} ${w - k},${h - s} ${k},${h - s} ${s},${h / 2}`}
          strokeLinejoin="round"
        />
      );
    }
    case 'parallelogram': {
      const k = Math.min(20, w * 0.16);
      return (
        <polygon
          points={`${k + s},${s} ${w - s},${s} ${w - k - s},${h - s} ${s},${h - s}`}
          strokeLinejoin="round"
        />
      );
    }
    case 'cylinder': {
      const ry = Math.min(12, h * 0.14);
      const left = s;
      const right = w - s;
      return (
        <>
          <path
            d={`M${left},${ry + s} A${w / 2 - s},${ry} 0 0 1 ${right},${ry + s} V${h - ry - s} A${w / 2 - s},${ry} 0 0 1 ${left},${h - ry - s} Z`}
          />
          <path className="dg-line" d={`M${left},${ry + s} A${w / 2 - s},${ry} 0 0 0 ${right},${ry + s}`} />
        </>
      );
    }
    case 'document': {
      const wave = Math.min(10, h * 0.14);
      return (
        <path
          d={`M${s},${s} H${w - s} V${h - wave - s} Q${(w * 3) / 4},${h - wave * 2 - s} ${w / 2},${h - wave - s} T${s},${h - wave - s} Z`}
          strokeLinejoin="round"
        />
      );
    }
  }
}
