import { z } from 'zod';
import { shapePathSchema } from './shape-path';

/*
 * A drawn shape's outline for the editor's frame: the line around a picked or hovered triangle
 * follows the triangle, not its box. Only the triangle – an ellipse, a star and the rest keep the
 * box, as in Figma.
 */

/** `draw:type` and `draw:modifiers` of a preset shape. */
export const shapeOutlineSchema = z.object({
  type: z.string(),
  modifiers: z.array(z.number()).optional(),
  /** A shape of its own outline (`draw:enhanced-path`): what a fill drawn over it is cut to. */
  path: shapePathSchema.optional(),
});
export type ShapeOutline = z.infer<typeof shapeOutlineSchema>;

/** Whether the frame follows this `draw:type`'s outline. */
export const hasShapeOutline = (type: string | undefined): type is string =>
  type === 'isosceles-triangle';

const n = (value: number) => Math.round(value * 100) / 100;

/**
 * The outline of `outline` drawn in a `w` × `h` box (px, top left at 0,0) as SVG path data,
 * mirrored as `flip` says; `null` for a shape the frame does not follow (the box then). The
 * triangle as LibreOffice draws it: its apex at the modifier (of 21600, the middle by default).
 */
export function shapeOutlinePath(
  outline: ShapeOutline,
  w: number,
  h: number,
  flip?: { x: boolean; y: boolean } | null,
): string | null {
  if (!hasShapeOutline(outline.type) || w <= 0 || h <= 0) return null;
  const apex = ((outline.modifiers?.[0] ?? 10800) / 21600) * w;
  const point = (x: number, y: number) => `${n(flip?.x ? w - x : x)} ${n(flip?.y ? h - y : y)}`;
  return `M${point(apex, 0)} L${point(w, h)} L${point(0, h)} Z`;
}

/**
 * LibreOffice's preset polygons (`EnhancedCustomShapeGeometry`, the shapes a new box takes) in
 * their 21600 × 21600 view, `m` their modifiers – defaults filled in.
 */
const PRESET_POLYGONS: Record<
  string,
  { modifiers: number[]; points: (m: number[]) => number[][] }
> = {
  'isosceles-triangle': {
    modifiers: [10800],
    points: ([a = 10800]) => [
      [a, 0],
      [21600, 21600],
      [0, 21600],
    ],
  },
  diamond: {
    modifiers: [],
    points: () => [
      [10800, 0],
      [21600, 10800],
      [10800, 21600],
      [0, 10800],
    ],
  },
  hexagon: {
    modifiers: [5400],
    points: ([a = 5400]) => [
      [a, 0],
      [21600 - a, 0],
      [21600, 10800],
      [21600 - a, 21600],
      [a, 21600],
      [0, 10800],
    ],
  },
  'right-arrow': {
    modifiers: [16200, 5400],
    points: ([head = 16200, shaft = 5400]) => [
      [0, shaft],
      [head, shaft],
      [head, 0],
      [21600, 10800],
      [head, 21600],
      [head, 21600 - shaft],
      [0, 21600 - shaft],
    ],
  },
  star5: {
    modifiers: [],
    points: () => [
      [10797, 0],
      [13321, 8256],
      [21600, 8256],
      [14878, 13405],
      [17401, 21600],
      [10797, 16580],
      [4198, 21600],
      [6722, 13405],
      [0, 8256],
      [8278, 8256],
    ],
  },
};

/** Whether the browser knows this preset's polygon (`presetPolygon`). */
export const isPresetPolygon = (type: string | undefined): type is string =>
  !!type && type in PRESET_POLYGONS;

/**
 * A preset's corners as shares of its box (0–1), its modifiers as LibreOffice reads them – `null`
 * for one the browser does not know.
 */
export function presetPolygon(outline: ShapeOutline): [number, number][] | null {
  const preset = PRESET_POLYGONS[outline.type];
  if (!preset) return null;
  const modifiers = preset.modifiers.map((fallback, i) => outline.modifiers?.[i] ?? fallback);
  return preset.points(modifiers).map(([x = 0, y = 0]) => [x / 21600, y / 21600]);
}
