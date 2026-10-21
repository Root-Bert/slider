/** A point in pixels. */
export interface Px {
  x: number;
  y: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * SVG path through the polyline with rounded corners – the comment connectors' corners, and the
 * dashboard lines drawn like them. A corner's radius shrinks on short
 * segments: inner segments are shared by two corners (half each), the first and last segment
 * belong to one corner only (a 4px stub gets r=4, as in Figma).
 */
export function roundedPath(points: readonly Px[], radius = 8): string {
  const [first] = points;
  if (!first) return '';
  let d = `M${round(first.x)} ${round(first.y)}`;
  const last = points.length - 1;
  for (let i = 1; i < points.length; i++) {
    const corner = points[i]!;
    const next = points[i + 1];
    if (!next) {
      d += `L${round(corner.x)} ${round(corner.y)}`;
      break;
    }
    const previous = points[i - 1]!;
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(
      radius,
      i === 1 ? inLength : inLength / 2,
      i + 1 === last ? outLength : outLength / 2,
    );
    const before = towards(corner, previous, r, inLength);
    const after = towards(corner, next, r, outLength);
    d += `L${round(before.x)} ${round(before.y)}Q${round(corner.x)} ${round(corner.y)} ${round(after.x)} ${round(after.y)}`;
  }
  return d;
}

function towards(from: Px, to: Px, distance: number, length: number): Px {
  if (length === 0) return from;
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  };
}
