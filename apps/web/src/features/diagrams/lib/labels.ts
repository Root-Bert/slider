import type { DiagramShape } from '@slider/shared';

export const SHAPE_LABEL: Record<DiagramShape, string> = {
  rect: 'Rechteck',
  rounded: 'Abgerundet',
  pill: 'Kapsel',
  rhombus: 'Raute',
  ellipse: 'Ellipse',
  cylinder: 'Zylinder',
  hexagon: 'Sechseck',
  parallelogram: 'Parallelogramm',
  document: 'Dokument',
  note: 'Notiz',
  text: 'Text',
  frame: 'Rahmen',
};

/** What a tint looks like as a swatch. */
export const tintSwatch = (color: string | undefined) =>
  !color || color === 'gray'
    ? 'var(--color-fg-subtle)'
    : color.startsWith('#')
      ? color
      : `var(--color-accent-${color})`;

export type Tool = 'select' | 'hand' | DiagramShape;

/** The keys that take a tool, as Figma has them. */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  r: 'rounded',
  o: 'ellipse',
  d: 'rhombus',
  n: 'note',
  t: 'text',
  f: 'frame',
};
