/*
 * What a template of the library is written from: its colours, its fonts and its layouts – each
 * layout a master page with its decoration (shapes, pictures) and the placeholders a slide on it
 * gets. Lengths are centimetres on the 16:9 page of a new Slider deck, angles degrees clockwise.
 */

/** The page every template is drawn on – the size of a blank Slider deck. */
export const PAGE = { w: 28, h: 15.75 } as const;

/** `#rrggbb`. */
export type Color = string;

/** A gradient's colour at a place along it (0 … 1). */
export type Stop = readonly [offset: number, color: Color];

/** How see-through a fill gets along a direction: 1 opaque … 0 gone. */
export interface Fade {
  from: number;
  to: number;
  /** As a linear gradient's: 90 left → right, 180 top → bottom. */
  angle?: number;
}

export type Fill =
  | { t: 'solid'; color: Color; opacity?: number; fade?: Fade }
  /** `angle`: where the stops run to – 90 left → right (default), 180 top → bottom. */
  | { t: 'linear'; stops: readonly Stop[]; angle?: number; opacity?: number; fade?: Fade }
  /** Stops from the centre (0) outwards (1); `cx`/`cy` the centre in the box, 0 … 1. */
  | { t: 'radial'; stops: readonly Stop[]; cx?: number; cy?: number; opacity?: number }
  /** Parallel lines `distance` apart; `bg` fills beneath them. */
  | {
      t: 'hatch';
      color: Color;
      distance: number;
      angle?: number;
      style?: 'single' | 'double' | 'triple';
      bg?: Color;
    };

/** A fill, a plain colour, or none (`null`). */
export type FillLike = Fill | Color | null;

export interface Stroke {
  color: Color;
  width: number;
  /** Dash and gap lengths. */
  dash?: readonly [number, number];
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  opacity?: number;
}

export interface Shadow {
  dx: number;
  dy: number;
  blur?: number;
  color?: Color;
  opacity?: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Look {
  fill?: FillLike;
  stroke?: Stroke | null;
  shadow?: Shadow;
}

/** How text is set. */
export interface TextLook {
  font?: string;
  /** Points. */
  size?: number;
  color?: Color;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  upper?: boolean;
  /** Letter spacing in points. */
  spacing?: number;
  /** Line height in percent. */
  lineHeight?: number;
  underline?: boolean;
  /** Padding inside the box: all sides, or top, right, bottom, left. */
  pad?: number | readonly [number, number, number, number];
  /** Space after each paragraph, centimetres. */
  paraSpace?: number;
}

export type Shape =
  | ({ t: 'rect'; r?: number; rotate?: number } & Box & Look)
  | ({
      t: 'ellipse';
      rotate?: number;
      /** A part of it: a pie slice, a segment cut by a chord, or just the arc. */
      kind?: 'section' | 'cut' | 'arc';
      /** Degrees counter-clockwise from 3 o'clock. */
      start?: number;
      end?: number;
    } & Box &
      Look)
  /** A closed polygon through `pts` (page coordinates). */
  | ({ t: 'poly'; pts: readonly (readonly [number, number])[] } & Look)
  /** An SVG path (`d`, in a `vb` wide and high coordinate system) drawn into the box. */
  | ({ t: 'path'; d: string; vb: readonly [number, number]; rotate?: number } & Box & Look)
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
  /** Decoration text – part of the layout, not typed into on slides. */
  | ({ t: 'text'; text: string | readonly string[]; rotate?: number; nowrap?: boolean } & Box &
      Look &
      TextLook)
  | ({ t: 'image'; src: Picture; rotate?: number } & Box & Pick<Look, 'stroke' | 'shadow'>);

/** A picture's bytes as they go into the file. */
export interface Picture {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/svg+xml';
}

/** A text placeholder of a layout: where it sits, how its text is set, what it asks for. */
export type Slot = Box &
  TextLook &
  Look & {
    /** What the empty placeholder asks for; default by kind („Titel“, „Text“ …). */
    prompt?: string;
    /** What the preview shows in it; a list for an outline shown as bullets. */
    sample?: string | readonly string[];
  };

export interface Layout {
  /** What the layout is shown as – see {@link LAYOUT_NAMES}. */
  name: string;
  bg: FillLike;
  /** The decoration, back to front. */
  shapes?: readonly Shape[];
  title?: Slot;
  subtitle?: Slot;
  /** The text placeholders (outline), each its own box. */
  body?: Slot | readonly Slot[];
  /** Where pictures go. */
  pictures?: readonly Box[];
}

/** The ten colours of a template („Farben“), as a design's theme. */
export interface Palette {
  /** Hintergrund 1 – the page. */
  bg: Color;
  /** Text 1. */
  text: Color;
  /** Hintergrund 2 – panels, the second ground. */
  bg2: Color;
  /** Text 2 – quieter text. */
  text2: Color;
  accents: readonly [Color, Color, Color, Color, Color, Color];
}

/** Where a template belongs in the library. */
export type Group =
  'Kunststil' | 'Designtrend' | 'Plakat' | 'Zeitung' | 'Schwarzweiß' | 'Farbenfroh' | 'Bereich';

export interface Template {
  /** File name and style prefix: lower case, `a-z0-9-`. */
  slug: string;
  /** What the template is shown as. */
  name: string;
  group: Group;
  /** Style, mood, where it fits – for finding it. */
  tags: readonly string[];
  /** One German sentence on what it is. */
  description: string;
  palette: Palette;
  fonts: { head: string; body: string };
  /** The looks every placeholder starts from; a slot overrides what it names. */
  text: { title: TextLook; subtitle: TextLook; body: TextLook };
  layouts: readonly Layout[];
  /** Pictures the preview puts into picture places, in turn; default: made from the palette. */
  samplePictures?: readonly Picture[];
}

/** The layouts every template has, in this order; it may have more after them. */
export const LAYOUT_NAMES = [
  'Titel',
  'Abschnitt',
  'Inhalt',
  'Text und Bild',
  'Zwei Spalten',
  'Kennzahl',
  'Zitat',
  'Bild',
  'Schluss',
] as const;

/** A template module's default export. */
export type TemplateModule = Template | (() => Template | Promise<Template>);
