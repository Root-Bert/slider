import { z } from 'zod';
import { photoProviderSchema, type PhotoProvider } from './integrations';
import {
  commentReactionSchema,
  commentStatusSchema,
  slideTransitionSchema,
  type TemplatePlaceholderKind,
} from './model';
import { shapeOutlineSchema } from './shape-outline';
import { elementPictureSchema, pictureFitSchema, pictureFocusSchema } from './image-fit';
import { workspaceFontSchema } from './workspaces';

/*
 * Editing decks in Slider (BER-177): the editor and the AI change a deck through the same small set
 * of operations on its elements. The operations know nothing about the file format – a format
 * adapter (ODP first, `@slider/odp`) applies them to the file. Geometry is normalised to the slide
 * (0–1), like every other on-slide geometry.
 */

/** Like `rectSchema`, but an element may reach beyond the slide. */
export const elementBoxSchema = z.object({
  x: z.number().min(-10).max(10),
  y: z.number().min(-10).max(10),
  w: z.number().min(0).max(20),
  h: z.number().min(0).max(20),
});
export type ElementBox = z.infer<typeof elementBoxSchema>;

export const editableElementKindSchema = z.enum([
  'text',
  'image',
  'shape',
  'table',
  'group',
  /** A straight line (`draw:line`), maybe with arrow heads: its box runs from end to end. */
  'line',
  'other',
]);
export type EditableElementKind = z.infer<typeof editableElementKindSchema>;

// ── Live elements ────────────────────────────────────────────────────────

/*
 * Texts the browser draws itself while they are typed in or formatted (the live editor): their
 * look read from the file's styles, resolved, so the editor shows a change at once – over
 * LibreOffice's picture of the slide with that one text left out. Everything else is always
 * LibreOffice's picture. Lengths are points, sizes of text too.
 */

export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Farbe als #rrggbb.');

export const liveTextStyleSchema = z.object({
  /** The font as the file names it (`Calibri`); the browser maps it like LibreOffice does. */
  font: z.string().min(1).max(100),
  size: z.number().min(1).max(999),
  color: colorSchema,
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  /** Struck through with one line; left out: not. */
  strike: z.boolean().optional(),
  /** Drawn in capitals (or small letters) whatever is typed – the file's text transform. */
  caps: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  /** Extra room between letters, points. */
  letterSpacing: z.number().min(-50).max(200).optional(),
  /**
   * `false`: letters not kerned in pairs – LibreOffice's `style:letter-kerning` off, which it is
   * where a file says nothing (decks started blank before 2026-11-03). Left out: kerned.
   */
  kerning: z.literal(false).optional(),
  /** How opaque the letters are (0–1, LibreOffice's text transparency); left out: fully. */
  opacity: z.number().min(0).max(1).optional(),
});
export type LiveTextStyle = z.infer<typeof liveTextStyleSchema>;

/** A stretch of text in one style; `\n` is a line break inside the paragraph. */
export const liveRunSchema = liveTextStyleSchema.extend({ text: z.string().max(5_000) });
export type LiveRun = z.infer<typeof liveRunSchema>;

export const textAlignSchema = z.enum(['left', 'center', 'right', 'justify']);
export type TextAlign = z.infer<typeof textAlignSchema>;

/** How list items are numbered: 1, 2, 3 – a, b, c – A, B, C – i, ii, iii – I, II, III. */
export const listNumberSchema = z.enum(['1', 'a', 'A', 'i', 'I']);
export type ListNumber = z.infer<typeof listNumberSchema>;

/** A paragraph in a list: with bullets or numbers, at a level (1 outermost). */
export const textListSchema = z.object({
  kind: z.enum(['bullet', 'number']),
  level: z.number().int().min(1).max(9),
});
export type TextList = z.infer<typeof textListSchema>;

/** `proportional`: of the font's line height (1 = single); else points. */
export const lineSpacingSchema = z.object({
  type: z.enum(['proportional', 'fixed', 'minimum']),
  value: z.number().min(0).max(1000),
});

export const liveParagraphSchema = z.object({
  runs: z.array(liveRunSchema),
  /** The style of an empty paragraph and of text typed at its end. */
  mark: liveTextStyleSchema,
  align: textAlignSchema,
  /**
   * Lines as high as 1.2 × the font size, not as the font's own metrics say (LibreOffice's
   * „font-independent line spacing“, which presentation placeholders use).
   */
  fontIndependent: z.boolean(),
  lineSpacing: lineSpacingSchema,
  spaceBefore: z.number(),
  spaceAfter: z.number(),
  /** Where the text starts, from the box's inner left; `indent` moves the first line. */
  marginLeft: z.number(),
  indent: z.number(),
  /** List level, 0 outside a list. */
  level: z.number().int().nonnegative(),
  bullet: z
    .object({
      /** The bullet character; empty for a number. */
      char: z.string().max(4),
      font: z.string().nullable(),
      size: z.number(),
      color: colorSchema,
      /** Where the bullet sits and how wide its room is, from the box's inner left. */
      at: z.number(),
      width: z.number(),
      /**
       * Numbered instead: how (`1`, `a`, `A`, `i`, `I`), what goes before and after the number and
       * where counting starts. Paragraphs of one level and numbering count on until one of a
       * lower level, without one or numbered otherwise (`listLabels`).
       */
      number: listNumberSchema.optional(),
      prefix: z.string().max(8).optional(),
      suffix: z.string().max(8).optional(),
      start: z.number().int().min(0).max(9999).optional(),
    })
    .nullable(),
});
export type LiveParagraph = z.infer<typeof liveParagraphSchema>;

/** How a border is drawn: a line, dashes or dots. */
export const strokeDashSchema = z.enum(['solid', 'dash', 'dot']);
export type StrokeDash = z.infer<typeof strokeDashSchema>;

export const elementStrokeSchema = z.object({
  color: colorSchema,
  width: z.number().min(0).max(100),
  /** Left out: a line. */
  dash: strokeDashSchema.optional(),
});
export type ElementStroke = z.infer<typeof elementStrokeSchema>;

/** A shadow an element casts: offset and blur in points, its colour as see-through as `opacity`. */
export const elementShadowSchema = z.object({
  x: z.number().min(-200).max(200),
  y: z.number().min(-200).max(200),
  blur: z.number().min(0).max(200),
  color: colorSchema,
  opacity: z.number().min(0).max(1),
});
export type ElementShadow = z.infer<typeof elementShadowSchema>;

/** A glow around an element: how far it reaches (points), its colour and opacity. */
export const elementGlowSchema = z.object({
  radius: z.number().positive().max(200),
  color: colorSchema,
  opacity: z.number().min(0).max(1),
});
export type ElementGlow = z.infer<typeof elementGlowSchema>;

/**
 * Effects on a shape or text frame as LibreOffice draws them: a shadow, its edges blurred inwards
 * by `blur` points (soft edge), a glow. `null`: none of that kind. `backdrop`: what lies behind it
 * shows through its fill blurred by that many points (frosted glass) – LibreOffice has no such
 * effect, so the server bakes it into the fill as a picture (`slider:fills`, see `fills.ts`).
 */
export const elementEffectsSchema = z.object({
  shadow: elementShadowSchema.nullable().default(null),
  blur: z.number().positive().max(200).nullable().default(null),
  glow: elementGlowSchema.nullable().default(null),
  backdrop: z.number().positive().max(200).nullable().default(null),
});
export type ElementEffects = z.infer<typeof elementEffectsSchema>;
export const NO_EFFECTS: ElementEffects = { shadow: null, blur: null, glow: null, backdrop: null };

/**
 * An element tilted in depth, in degrees: around its horizontal axis (`x`, its top away from the
 * viewer) and its vertical one (`y`, its right side away), seen in perspective. The slide shows a
 * picture of it so tilted; the element itself stays in the file, unseen, to be changed.
 */
export const elementTiltSchema = z.object({
  x: z.number().min(-80).max(80),
  y: z.number().min(-80).max(80),
  /**
   * The picture of the element alone its tilted picture was drawn from (its address without
   * query): another one means the element changed since – to be drawn tilted anew.
   */
  source: z.string().max(1000).optional(),
});
export type ElementTilt = z.infer<typeof elementTiltSchema>;

/**
 * An element mirrored: left to right (`x`, about its vertical axis) and top to bottom (`y`), before
 * it is turned. Pictures and drawn shapes only – a text frame does not mirror.
 */
export const elementFlipSchema = z.object({ x: z.boolean(), y: z.boolean() });
export type ElementFlip = z.infer<typeof elementFlipSchema>;

/**
 * Who took a stock photo (Unsplash, Pexels), kept with the picture in the file (its description)
 * so the credit travels with it. Links without tracking parameters – see {@link stockLink}.
 */
export const imageCreditSchema = z.object({
  name: z.string(),
  /** The photographer's profile. */
  profileUrl: z.string(),
  /** The photo's own page. */
  photoUrl: z.string(),
  /** Where it was found; absent: Unsplash (credits from before there were others). */
  source: photoProviderSchema.optional(),
});
export type ImageCredit = z.infer<typeof imageCreditSchema>;

/**
 * A picture that is one of Slider's symbols (an icon or pictogram, `@/features/icons`) drawn in
 * one colour – kept with it in the file (its description, like a credit), so a symbol picked
 * again offers its colours and other symbols instead of a picture's controls.
 */
export const imageSymbolSchema = z.object({
  /** `phosphor/house` – the same in every build of the sets. */
  id: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  /** As shown: `House`. */
  label: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export type ImageSymbol = z.infer<typeof imageSymbolSchema>;

/** How see-through a fill layer is drawn: 0 (not at all) to 1 (fully). */
const opacitySchema = z.number().min(0).max(1);

/**
 * A colour of a gradient, where it sits along it (0–1) and how opaque it is there (absent: fully;
 * the layer's own opacity on top).
 */
export const gradientStopSchema = z.object({
  color: colorSchema,
  at: z.number().min(0).max(1),
  opacity: opacitySchema.optional(),
});
export type GradientStop = z.infer<typeof gradientStopSchema>;

/** How opaque a gradient's stop is (absent: fully). */
export const stopOpacity = (stop: { opacity?: number }): number => stop.opacity ?? 1;

/**
 * How a picture fills its shape: covering it (cut, its part shown a `focus` as a picture
 * element's), whole inside it, stretched or repeated.
 */
export const imageFitSchema = z.enum(['fill', 'fit', 'stretch', 'tile']);
export type ImageFit = z.infer<typeof imageFitSchema>;

/**
 * The forms of gradient LibreOffice draws: along a line (`linear`), along it and back
 * (`axial`), and out from a centre – a circle (`radial`), an ellipse of the shape's proportions
 * (`ellipsoid`), a square or a rectangle of them.
 */
export const gradientKindSchema = z.enum([
  'linear',
  'axial',
  'radial',
  'ellipsoid',
  'square',
  'rectangular',
]);
export type GradientKind = z.infer<typeof gradientKindSchema>;

/**
 * Whether a gradient of `kind` runs out from a centre that can be moved. Stops of those and of an
 * axial one run from the middle (0) to the edge (1), of a linear one from start to end.
 */
export const isCentredGradient = (kind: GradientKind): boolean =>
  kind !== 'linear' && kind !== 'axial';

/**
 * One layer of a fill, as in a design tool: a colour, a gradient or a picture, each with its
 * opacity, shown or hidden. A gradient's angle is the direction it runs as on screen (CSS: 90 runs
 * left to right, 180 top to bottom) – an axial one from its middle out to both sides – or, for
 * one out from a centre, how far its form is turned clockwise; `center` is that centre as a
 * fraction of the shape (absent: the middle).
 */
export const fillLayerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('solid'),
    color: colorSchema,
    opacity: opacitySchema,
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal('gradient'),
    kind: gradientKindSchema,
    angle: z.number().min(0).max(360),
    center: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
    stops: z.array(gradientStopSchema).min(2).max(8),
    opacity: opacitySchema,
    visible: z.boolean(),
  }),
  z.object({
    type: z.literal('image'),
    /** A picture of the file (`Pictures/…`) or one just uploaded for the editor (its id). */
    src: z.string().min(1).max(200),
    fit: imageFitSchema,
    /**
     * Filled (`fit` „fill“): the part shown, as a picture element's (`ElementPicture.focus`,
     * chosen on the slide: „Ausschnitt“). Left out: the middle, not zoomed in.
     */
    focus: pictureFocusSchema.optional(),
    opacity: opacitySchema,
    visible: z.boolean(),
    /** A stock photo's photographer, shown wherever the layer is. */
    credit: imageCreditSchema.optional(),
  }),
]);
export type FillLayer = z.infer<typeof fillLayerSchema>;

export const fillLayersSchema = z.array(fillLayerSchema).max(10);

/**
 * The one layer of `fills` a file draws as it is – a colour or a gradient, the only layer shown;
 * `null`: none shown; `composite`: ones only a picture of them all draws. A slide's background
 * (`page`) is never see-through in LibreOffice: one there that is goes as a picture too, drawn on
 * white.
 */
export function nativeFill(
  fills: readonly FillLayer[],
  page = false,
): FillLayer | null | 'composite' {
  const shown = fills.filter((layer) => layer.visible);
  if (shown.length === 0) return null;
  const [only] = shown;
  if (shown.length !== 1 || !only || only.type === 'image') return 'composite';
  const seeThrough =
    only.opacity < 1 || (only.type === 'gradient' && only.stops.some((s) => stopOpacity(s) < 1));
  return page && seeThrough ? 'composite' : only;
}

/** A shape's or text frame's fill and border. */
export const elementLookSchema = z.object({
  /** The fill as one colour, else `null` (none, or one of gradients, pictures or layers). */
  fill: colorSchema.nullable(),
  /** The fill's layers, bottom first; none: not filled. */
  fills: fillLayersSchema.default([]),
  /**
   * Layers the file shows as one picture of them: the proportions (width / height) it was drawn
   * in – an element of others since has it stretched, to be drawn anew. `null`: no such picture.
   */
  fillAspect: z.number().positive().nullable().default(null),
  stroke: elementStrokeSchema.nullable(),
  effects: elementEffectsSchema.default(NO_EFFECTS),
});
export type ElementLook = z.infer<typeof elementLookSchema>;

export const verticalAlignSchema = z.enum(['top', 'middle', 'bottom']);
export type VerticalAlign = z.infer<typeof verticalAlignSchema>;

export const liveElementSchema = z.object({
  fill: colorSchema.nullable(),
  stroke: elementStrokeSchema.nullable(),
  padding: z.object({
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  }),
  /**
   * A drawn shape's text area (a hexagon's middle) as insets of its box, each a share of the
   * box's width or height, not mirrored; the padding lies inside it. Left out: the whole box.
   */
  textArea: z
    .object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() })
    .optional(),
  verticalAlign: verticalAlignSchema,
  /**
   * The box grows with its text (LibreOffice's „Höhe an Text anpassen“), never lower than its own
   * height: LibreOffice takes the box's height as its least – a `fo:min-height` in the file not.
   */
  autoGrow: z.boolean(),
  /** Empty placeholder: LibreOffice draws nothing, the editor its prompt. */
  placeholder: z.boolean(),
  /** What an empty placeholder asks for, when its layout says (typed in a Slider template). */
  prompt: z.string().max(5_000).optional(),
  /** The text shrinks to fit the box (autofit); the browser does so as LibreOffice roughly does. */
  shrink: z.boolean().optional(),
  paragraphs: z.array(liveParagraphSchema),
});
export type LiveElement = z.infer<typeof liveElementSchema>;

/** Unsplash wants every link back to it tagged with the app it comes from; others don't. */
export const stockLink = (url: string, source: PhotoProvider = 'unsplash'): string =>
  // A credit can come from a collaborator's edit step: anything but https links to the service.
  !url.startsWith('https://')
    ? STOCK_HOMES[source]
    : source === 'unsplash'
      ? `${url}${url.includes('?') ? '&' : '?'}utm_source=Slider&utm_medium=referral`
      : url;

/** The photo services themselves, linked from every credit. */
export const STOCK_HOMES: Record<PhotoProvider, string> = {
  unsplash: 'https://unsplash.com/',
  pexels: 'https://www.pexels.com/',
};

/** One element of a slide as the editor and the AI see it. */
/**
 * How the browser draws an element it may draw whole (a strict whitelist, `paintOf` in the odp
 * package): a box – its corners rounded by `radius` (pt) – or an ellipse; one colour or none for
 * its area and line (the element's `live`), not turned or mirrored, without effects.
 */
export const elementPaintSchema = z.object({
  /**
   * A box (corners `radius` pt), an ellipse, one of LibreOffice's preset polygons, a picture, a
   * straight line (its ends `lineEnds`, its heads the element's `line`, its look `look.stroke`).
   */
  outline: z.enum(['rect', 'ellipse', 'preset', 'picture', 'line']),
  radius: z.number().nonnegative(),
  /** `preset`: which, with its modifiers (`presetPolygon`). */
  preset: shapeOutlineSchema.optional(),
  /** Its area and line see-through (`draw:opacity`, `svg:stroke-opacity`): 1 when left out. */
  fillOpacity: z.number().min(0).max(1).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
  /** Its area one gradient (`look.fills`), drawn by the browser as LibreOffice does. */
  gradient: z.boolean().optional(),
});
export type ElementPaint = z.infer<typeof elementPaintSchema>;

/** Which ends of a line carry an arrow head (LibreOffice's „Arrow“ marker). */
export const lineHeadsSchema = z.enum(['none', 'start', 'end', 'both']);
export type LineHeads = z.infer<typeof lineHeadsSchema>;

/** Whether a line's start (`end` false) or end carries a head. */
export const hasHead = (heads: LineHeads, end: boolean): boolean =>
  heads === 'both' || heads === (end ? 'end' : 'start');

/** The heads of a line with a head at its start and/or end. */
export const headsOf = (start: boolean, end: boolean): LineHeads =>
  start ? (end ? 'both' : 'start') : end ? 'end' : 'none';

/**
 * A line's ends: the corners of its box, from top left to bottom right unless mirrored – `flip.x`
 * starts it on the right, `flip.y` at the bottom (the element's `flip` is the way it runs).
 */
export function lineEnds(
  box: { x: number; y: number; w: number; h: number },
  flip: { x: boolean; y: boolean } | null,
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const [left, right] = [box.x, box.x + box.w];
  const [top, bottom] = [box.y, box.y + box.h];
  return {
    from: { x: flip?.x ? right : left, y: flip?.y ? bottom : top },
    to: { x: flip?.x ? left : right, y: flip?.y ? top : bottom },
  };
}

/** A line from `from` to `to` as a box and the way it runs (`lineEnds` the other way round). */
export function lineBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { box: { x: number; y: number; w: number; h: number }; flip: { x: boolean; y: boolean } } {
  return {
    box: {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.abs(to.x - from.x),
      h: Math.abs(to.y - from.y),
    },
    flip: { x: from.x > to.x, y: from.y > to.y },
  };
}

/**
 * A line laid into `box` running as `flip` says, then turned clockwise by `rotation` degrees as
 * seen around the box's centre (`aspect`: the page's width over its height – 1 for lengths alike
 * both ways, as centimetres). A line has no turn of its own: its ends are where it lies.
 */
export function turnedLine(
  box: { x: number; y: number; w: number; h: number },
  flip: { x: boolean; y: boolean } | null,
  rotation: number,
  aspect = 1,
): { box: { x: number; y: number; w: number; h: number }; flip: { x: boolean; y: boolean } } {
  const { from, to } = lineEnds(box, flip);
  const turn = (((rotation % 360) + 360) % 360) * (Math.PI / 180);
  if (Math.abs(turn) < 1e-9) return lineBetween(from, to);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const turned = (point: { x: number; y: number }) => {
    const dx = (point.x - cx) * aspect;
    const dy = point.y - cy;
    return { x: cx + (dx * c - dy * s) / aspect, y: cy + dx * s + dy * c };
  };
  return lineBetween(turned(from), turned(to));
}

/**
 * How wide an arrow head is (pt) on a line `width` pt wide: three times the line, at least as on a
 * line of 0.07 cm – as LibreOffice takes PowerPoint's medium heads, so they go back as medium.
 */
export const arrowHeadWidth = (width: number): number => 3 * Math.max(width, (0.07 * 72) / 2.54);

export const editableElementSchema = z.object({
  /** Stable while the deck is edited in Slider. */
  id: z.string(),
  kind: editableElementKindSchema,
  /** The element's name in the file (e.g. „Title 1“), may repeat across slides. */
  name: z.string(),
  /** Placeholder role from the layout: `title`, `subtitle`, `outline`, … – `null` otherwise. */
  role: z.string().nullable(),
  /** Where it lies – before it is turned (`rotation`), around the box's centre. */
  bbox: elementBoxSchema,
  /** Turned clockwise by this many degrees as seen, 0 ≤ rotation < 360 (when `resizable`). */
  rotation: z.number().default(0),
  /** One entry per paragraph; `null` when the element holds no editable text. */
  paragraphs: z.array(z.string()).nullable(),
  /** Whether {@link setBox} works on it (skewed or line-like elements are read-only for now). */
  movable: z.boolean(),
  /** Its size and turn can be set too (groups only move). */
  resizable: z.boolean(),
  /** Set when its text can be typed on the slide (the browser draws it then); `null`: it cannot. */
  live: liveElementSchema.nullable().default(null),
  /** A picture that is a stock photo: whose it is (shown with it). */
  credit: imageCreditSchema.nullable().default(null),
  /** A picture that is a symbol: which, in which colour. Left out: none. */
  symbol: imageSymbolSchema.optional(),
  /** Fill and border of a shape or text frame (`setShapeStyle`); `null`: it has none to set. */
  look: elementLookSchema.nullable().default(null),
  /** Tilted in depth (`setTilt`); `null`: flat on the slide. */
  tilt: elementTiltSchema.nullable().default(null),
  /** Mirrored (`setBox`); `null`: it cannot be (a text frame, a group, …). */
  flip: elementFlipSchema.nullable().default(null),
  /**
   * Locked in place (`setLocked`, LibreOffice's „Position und Größe schützen“): the editor's slide
   * neither picks nor moves it – what lies on it can be drawn there. Left out: not locked.
   */
  locked: z.boolean().optional(),
  /**
   * Who it is across slides for the morph transition: the element it was copied from with its
   * slide (`duplicateSlide`), and so on back – the one first copied. Left out: none was.
   */
  morphKey: z.string().optional(),
  /**
   * A group: the ids of the elements in it, bottom first (`groupElements`; `ungroupElements` sets
   * them on the slide again). Left out: no group, or one whose elements have no ids.
   */
  members: z.array(z.string()).optional(),
  /** A preset shape's outline (an ellipse, a star): the editor's frame follows it. Else the box. */
  outline: shapeOutlineSchema.optional(),
  /**
   * A line (kind `line`): which ends carry an arrow head (`setShapeStyle` `heads`). Its ends are
   * corners of its box, the way it runs its `flip` (`lineEnds`); its look `look.stroke`.
   */
  line: z.object({ heads: lineHeadsSchema }).optional(),
  /** A rectangle's corner radius in pt (`setCornerRadius`), 0 when sharp. Left out: no rectangle. */
  cornerRadius: z.number().nonnegative().optional(),
  /** A picture element's picture and how it fills its frame (`setImageFit`). Left out: no picture. */
  picture: elementPictureSchema.optional(),
  /**
   * Drawn by the browser in Bearbeiten (the per-element editor, docs/do-not-break.md): its outline, its
   * fill and line from `live`. Left out: LibreOffice draws it (a picture of it alone).
   */
  paint: elementPaintSchema.optional(),
  /**
   * A group: its elements as elements of their own, bottom first – what a double click on it
   * enters (Figma), each picked and edited by its id; Bearbeiten draws the group from them.
   * Left out: no group.
   */
  get children(): z.ZodOptional<z.ZodArray<typeof editableElementSchema>> {
    return z.array(editableElementSchema).optional();
  },
});
export type EditableElement = z.infer<typeof editableElementSchema>;

/** Elements with every group's elements after it, depth first (a group's `children`). */
export function withChildren(elements: readonly EditableElement[]): EditableElement[] {
  return elements.flatMap((element) =>
    element.children ? [element, ...withChildren(element.children)] : [element],
  );
}

/** Element `id` among `elements` or in one of their groups, at any depth. */
export function findElement(
  elements: readonly EditableElement[],
  id: string,
): EditableElement | undefined {
  for (const element of elements) {
    if (element.id === id) return element;
    const inner = element.children && findElement(element.children, id);
    if (inner) return inner;
  }
  return undefined;
}

/** The group element `id` is directly in, among `elements` at any depth; none at the top. */
export function parentOf(
  elements: readonly EditableElement[],
  id: string,
): EditableElement | undefined {
  for (const element of elements) {
    if (!element.children) continue;
    if (element.children.some((child) => child.id === id)) return element;
    const inner = parentOf(element.children, id);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * What the elements of one layout of a template being designed hold for slides made from it
 * (`DeckTemplate.placeholders` for that layout's elements). What was typed into a text box is
 * what its placeholder asks for, so every text box one can type into is a text placeholder – save
 * a locked one (⇧⌘L), which stays as it is on every slide (a footer „Vertraulich“), and one that
 * is turned or tilted. Its kind is the one marked before (templates from before kept them), else
 * the file's (`role`), else: the one in the largest letters is the title – unless the layout has
 * one –, ties the topmost, the others text. Pictures are placeholders only as marked (`picture`).
 */
export function layoutPlaceholders(
  elements: readonly EditableElement[],
  marked: Readonly<Record<string, TemplatePlaceholderKind>>,
): Record<string, TemplatePlaceholderKind> {
  const kinds: Record<string, TemplatePlaceholderKind> = {};
  const open: EditableElement[] = [];
  for (const element of elements) {
    const mark = marked[element.id];
    if (mark === 'picture') {
      if (element.kind === 'image') kinds[element.id] = mark;
      continue;
    }
    const typable =
      element.kind === 'text' &&
      element.live !== null &&
      !element.locked &&
      element.rotation === 0 &&
      element.tilt === null;
    if (!typable) continue;
    const role = element.role;
    const kind =
      mark ?? (role === 'title' || role === 'subtitle' || role === 'outline' ? role : undefined);
    if (kind) kinds[element.id] = kind;
    else open.push(element);
  }
  const letters = (element: EditableElement) =>
    Math.max(
      0,
      ...(element.live?.paragraphs ?? []).flatMap((paragraph) => [
        paragraph.mark.size,
        ...paragraph.runs.map((run) => run.size),
      ]),
    );
  const titled = Object.values(kinds).includes('title');
  const title = titled
    ? undefined
    : open.reduce<EditableElement | undefined>((best, element) => {
        if (!best) return element;
        const [a, b] = [letters(element), letters(best)];
        return a > b || (a === b && element.bbox.y < best.bbox.y) ? element : best;
      }, undefined);
  for (const element of open) kinds[element.id] = element === title ? 'title' : 'outline';
  return kinds;
}

/**
 * A stretch of speaker notes in one style: only what notes are formatted with – the font, size
 * and colour stay the notes page's own.
 */
export const notesRunSchema = z.object({
  text: z.string().max(5_000),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
});
export type NotesRun = z.infer<typeof notesRunSchema>;

/** A paragraph of speaker notes: its runs, in a list or not. */
export const notesParagraphSchema = z.object({
  runs: z.array(notesRunSchema).max(200),
  list: textListSchema.nullable().optional(),
});
export type NotesParagraph = z.infer<typeof notesParagraphSchema>;

/** Speaker notes as plain text, a paragraph per line. */
export const notesText = (paragraphs: readonly NotesParagraph[]): string =>
  paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
    .replace(/\s+$/, '');

export const editableSlideSchema = z.object({
  /** 0-based position in the file, hidden slides included. */
  index: z.number().int().nonnegative(),
  name: z.string(),
  hidden: z.boolean(),
  /** The slide's own background colour as `#rrggbb`; `null`: the master's (or not one colour). */
  background: z.string().nullable().default(null),
  /** Whether the slide fills its background itself (one colour or more), not the master. */
  ownBackground: z.boolean().default(false),
  /** The slide's own background as fill layers, bottom first; none: the master's. */
  backgroundFills: fillLayersSchema.default([]),
  /** How it comes in when presenting; `null`: a transition Slider does not offer. */
  transition: slideTransitionSchema.nullable().default('none'),
  /** The speaker notes as plain text, paragraphs on lines of their own. */
  notes: z.string().default(''),
  /** The speaker notes with their formatting (bold, lists, …); left out: none. */
  notesRich: z.array(notesParagraphSchema).optional(),
  /**
   * A variant of another slide (`addVariant`): that slide's page id. A variant is hidden in the
   * file and shows above its slide, not in the deck; `null` for every other slide.
   */
  variantOf: z.string().nullable().default(null),
  elements: z.array(editableElementSchema),
});
export type EditableSlide = z.infer<typeof editableSlideSchema>;

/** Longest text the editor or the AI may put into one element. */
export const MAX_ELEMENT_TEXT = 5_000;
/** Most paragraphs one element takes. */
export const MAX_PARAGRAPHS = 200;

const elementId = z.string().min(1).max(100);
/** The id the editor gives an element it adds (`sl…`). */
const newElementId = z.string().regex(/^sl[a-z0-9-]{4,60}$/);
/** A box an element is given: not empty. */
const filledBox = elementBoxSchema.refine((box) => box.w > 0 && box.h > 0, 'Leere Box.');
/** A box an element is moved into: a line's may be flat (a level or upright line). */
const placedBox = elementBoxSchema.refine((box) => box.w > 0 || box.h > 0, 'Leere Box.');
/**
 * A slide by its page id ({@link EditSlide.pageId}): it stays with the slide when slides move,
 * come or go – so operations made on an older state still find their slide.
 */
const pageId = z.string().min(1).max(100);
/** The id the editor gives a slide it adds (`sl…`), chosen like an element's. */
const newPageId = newElementId;
/** Where a slide goes: right after this one; `null`: first. */
const afterPage = pageId.nullable();

export const setTextOperationSchema = z.object({
  type: z.literal('setText'),
  elementId,
  /** Replaces the element's text; formatting of the first run of each paragraph stays. */
  paragraphs: z
    .array(z.string().max(MAX_ELEMENT_TEXT))
    .max(MAX_PARAGRAPHS)
    .refine((paragraphs) => paragraphs.join('').length <= MAX_ELEMENT_TEXT, 'Text zu lang.'),
});

export const setBoxOperationSchema = z.object({
  type: z.literal('setBox'),
  elementId,
  /**
   * The box before the turn. A line's ends are its corners (`lineEnds`), as `flip` says – turned,
   * they turn round its centre (a line keeps no turn of its own).
   */
  box: placedBox,
  /** Turned clockwise by this many degrees around the box's centre; left out: as it is. */
  rotation: z.number().min(-3600).max(3600).optional(),
  /** Mirrored so (when it can be, `EditableElement.flip`); left out: as it is. */
  flip: elementFlipSchema.optional(),
});

/** A paragraph as the editor writes it: its runs carry their whole style. */
export const richParagraphSchema = z.object({
  align: textAlignSchema,
  runs: z.array(liveRunSchema).max(200),
  /** In a list (`null`: not); left out: as it is. */
  list: textListSchema.nullable().optional(),
  /** Line spacing as a live paragraph has it; left out: as it is. */
  lineSpacing: lineSpacingSchema.optional(),
});
export type RichParagraph = z.infer<typeof richParagraphSchema>;

const richParagraphs = z
  .array(richParagraphSchema)
  .max(MAX_PARAGRAPHS)
  .refine(
    (paragraphs) =>
      paragraphs.reduce(
        (sum, paragraph) => sum + paragraph.runs.reduce((n, run) => n + run.text.length, 0),
        0,
      ) <= MAX_ELEMENT_TEXT,
    'Text zu lang.',
  );

/** Replaces a live element's text with formatted text; paragraph spacing stays, and lists unless set. */
export const setRichTextOperationSchema = z.object({
  type: z.literal('setRichText'),
  elementId,
  paragraphs: richParagraphs,
  /**
   * The live editor saving what was typed in its shared text (`LiveTexts`): that text may be
   * ahead of this save already, so the step is not written back into it. Any other rich text –
   * the format panel's, the AI's – is, so editors typing there see it.
   */
  typed: z.boolean().optional(),
});

/** Fill, border and vertical alignment of a shape or text frame; what is left out stays. */
export const setShapeStyleOperationSchema = z.object({
  type: z.literal('setShapeStyle'),
  elementId,
  fill: colorSchema.nullable().optional(),
  /**
   * The fill as layers (bottom first; none: not filled), in place of `fill`. One that a single
   * colour or gradient cannot draw – pictures, more than one layer shown – needs `composite`:
   * the layers drawn as one picture of the element's proportions (uploaded, by its id; `aspect`:
   * the width / height it was drawn in).
   */
  fills: fillLayersSchema.optional(),
  composite: z
    .object({ imageId: z.string().min(1).max(200), aspect: z.number().positive().max(1000) })
    .optional(),
  stroke: elementStrokeSchema.nullable().optional(),
  verticalAlign: verticalAlignSchema.optional(),
  /** Shadow, soft edge and glow – all three as they are to be. */
  effects: elementEffectsSchema.optional(),
  /** A line's arrow heads. */
  heads: lineHeadsSchema.optional(),
});

/** Outlines a new box can take – LibreOffice's preset shapes (`draw:type`) – and their names. */
export const NEW_SHAPES = {
  rectangle: 'Rechteck',
  'round-rectangle': 'Abgerundetes Rechteck',
  ellipse: 'Ellipse',
  'isosceles-triangle': 'Dreieck',
  diamond: 'Raute',
  hexagon: 'Sechseck',
  'right-arrow': 'Blockpfeil',
  star5: 'Stern',
} as const;
export type NewShape = keyof typeof NEW_SHAPES;
const newShapeSchema = z.enum(Object.keys(NEW_SHAPES) as [NewShape, ...NewShape[]]);

/** The lines a frame can be filled with (`addElement` kind `line`), beside the shapes. */
export const NEW_LINES = { line: 'Linie', arrow: 'Pfeil' } as const;
export type NewLine = keyof typeof NEW_LINES;
/** What „Form“ offers: a shape, or a line across the frame. */
export type FrameShape = NewShape | NewLine;
export const isNewLine = (shape: FrameShape | null | undefined): shape is NewLine =>
  shape === 'line' || shape === 'arrow';
/** A new line's look until it is changed. */
export const NEW_LINE_STROKE = { color: '#1e40af', width: 2 };

/**
 * A new text box, box or line on a slide, on top; the editor picks its id (`sl…`). A line runs
 * across `box` from corner to corner – from top left unless `flip` says otherwise (`lineEnds`) –
 * drawn by `stroke`, with `heads`; it has no fill or text.
 */
export const addElementOperationSchema = z.object({
  type: z.literal('addElement'),
  pageId,
  elementId: newElementId,
  kind: z.enum(['text', 'rect', 'line']),
  /** A box's outline; a rectangle when left out. */
  shape: newShapeSchema.optional(),
  /** A line: the way it runs across its box. */
  flip: elementFlipSchema.optional(),
  /** A line: its arrow heads (none when left out). */
  heads: lineHeadsSchema.optional(),
  box: filledBox,
  fill: colorSchema.nullable(),
  stroke: elementStrokeSchema.nullable(),
  paragraphs: richParagraphs,
});

/**
 * A new picture frame on a slide, on top, the picture fitted into `box`; the editor picks its id
 * (`sl…`). Without `imageId` it holds a placeholder – to swap for a file or a photo later.
 */
export const addImageOperationSchema = z.object({
  type: z.literal('addImage'),
  pageId,
  elementId: newElementId,
  box: filledBox,
  /** An image uploaded for this deck before (`POST /decks/:id/edit/images`). */
  imageId: z.string().min(1).max(100).nullable(),
});

/**
 * A copy of element `elementId` – any kind, with its look, text and tilt – on top of slide
 * `pageId` (its own or another), in `box`; the editor picks its id (`sl…`). The editor's ⌘C / ⌘V.
 */
export const copyElementOperationSchema = z.object({
  type: z.literal('copyElement'),
  elementId,
  pageId,
  newElementId,
  /** Where the copy lies, as `setBox`'s box (before its turn). */
  box: placedBox,
  /**
   * A group on that slide the copy goes into, on top of its elements (pasted while in it, a
   * deleted element of it brought back). Left out: on top of the slide.
   */
  groupId: elementId.optional(),
  /**
   * A group copied: its parts' new ids by the ids of the parts copied, at any depth – given by the
   * editor, so the copy it shows at once has the ids the file then has (nothing re-keyed). Left
   * out, or a part not named: the file gives it one.
   */
  partIds: z
    .record(elementId, newElementId)
    .refine((ids) => Object.keys(ids).length <= 500, 'Zu viele Teile.')
    .optional(),
});

export const replaceImageOperationSchema = z.object({
  type: z.literal('replaceImage'),
  elementId,
  /** An image uploaded for this deck before (`POST /decks/:id/edit/images`). */
  imageId: z.string().min(1).max(100),
});

/**
 * Tilts an element in depth, or lays it flat again (`tilt` `null`). A tilt comes with the element
 * drawn so tilted (an image uploaded before, see-through around it) and where that picture lies on
 * the slide: the slide shows it, the element stays in the file unseen.
 */
export const setTiltOperationSchema = z.object({
  type: z.literal('setTilt'),
  elementId,
  tilt: elementTiltSchema.nullable(),
  picture: z
    .object({
      imageId: z.string().min(1).max(100),
      box: filledBox,
    })
    .nullable(),
});

/** Locks an element in place on the slide, or unlocks it (`EditableElement.locked`). */
export const setLockedOperationSchema = z.object({
  type: z.literal('setLocked'),
  elementId,
  locked: z.boolean(),
});

/**
 * How a picture fills its frame: `fill` cropped to it (proportions kept) – the part shown by
 * `focus`, else as it was –, `stretch` the whole picture stretched to it.
 */
export const setImageFitOperationSchema = z.object({
  type: z.literal('setImageFit'),
  elementId,
  fit: pictureFitSchema,
  focus: pictureFocusSchema.optional(),
});

/** Rounds a rectangle's corners by `radius` (pt; at most half its shorter side), 0: sharp. */
export const setCornerRadiusOperationSchema = z.object({
  type: z.literal('setCornerRadius'),
  elementId,
  radius: z.number().min(0).max(2000),
});

export const deleteElementOperationSchema = z.object({
  type: z.literal('deleteElement'),
  elementId,
});

/**
 * Puts an element at another place in its slide's stacking order: `to` counts the slide's
 * elements from the bottom (0: under all others), without the element itself.
 */
export const moveElementOperationSchema = z.object({
  type: z.literal('moveElement'),
  elementId,
  to: z.number().int().nonnegative().max(10_000),
});

/**
 * Groups elements of one slide (at least two) into one (`draw:g`, kind `group`) with the id the
 * editor picks: in it in their stacking order, each keeping its id; the group where the topmost
 * of them was. The editor's ⌘G.
 */
export const groupElementsOperationSchema = z.object({
  type: z.literal('groupElements'),
  elementIds: z.array(elementId).min(2).max(200),
  newElementId,
});

/**
 * Takes a group apart: its elements stand on the slide on their own again, in their order where
 * the group was, each keeping its id. The editor's ⇧⌘G.
 */
export const ungroupElementsOperationSchema = z.object({
  type: z.literal('ungroupElements'),
  elementId,
});

export const deleteSlideOperationSchema = z.object({
  type: z.literal('deleteSlide'),
  pageId,
});

/** PowerPoint's „Folie ausblenden“: the slide stays in the file, but is not shown. */
export const setSlideHiddenOperationSchema = z.object({
  type: z.literal('setSlideHidden'),
  pageId,
  hidden: z.boolean(),
});

/**
 * The slide's background: one colour of its own, or the master's again (`color` `null`) – or,
 * in its place, fill layers as a shape has them (`fills`; none: the master's), with `composite`
 * – the layers drawn as one picture of the slide – when one colour or gradient cannot draw them.
 */
export const setSlideBackgroundOperationSchema = z.object({
  type: z.literal('setSlideBackground'),
  pageId,
  color: colorSchema.nullable().optional(),
  fills: fillLayersSchema.optional(),
  composite: z.object({ imageId: z.string().min(1).max(200) }).optional(),
});

/** How the slide comes in when presenting (`none`: without a transition). */
export const setSlideTransitionOperationSchema = z.object({
  type: z.literal('setSlideTransition'),
  pageId,
  transition: slideTransitionSchema,
});

export const moveSlideOperationSchema = z.object({
  type: z.literal('moveSlide'),
  pageId,
  /** The slide it goes right after (another one); `null`: first. */
  after: afterPage,
});

/**
 * A copy of slide `pageId` (ids of its own, its name with „(2)“) right after slide `after`
 * (`null`: first), with the page id `newPageId`. The gap's „Folie einfügen“.
 */
export const duplicateSlideOperationSchema = z.object({
  type: z.literal('duplicateSlide'),
  pageId,
  newPageId,
  after: afterPage,
});

/**
 * A new slide without content right after slide `after` (`null`: first), with the page id
 * `newPageId`, on the background of slide `like` – empty: no placeholder, none of its master's
 * shapes: the template editor's „Neue Folie“, a layout from scratch. With `master` (a master page's `style:name`) it is a slide of
 * that layout instead, its placeholders empty: the gap's layouts of the deck's own design. With
 * `design` it is a slide of layout `layout` (its place among the template's layouts) of the
 * workspace's template `id` instead, the layout taken into the deck when it lacks it: the gap's
 * „Vorlagen“.
 */
export const addSlideOperationSchema = z.object({
  type: z.literal('addSlide'),
  like: pageId,
  newPageId,
  after: afterPage,
  master: z.string().min(1).max(500).optional(),
  design: z
    .object({
      id: z.string().min(1).max(100),
      layout: z.number().int().nonnegative().max(1000),
    })
    .optional(),
});

/** Longest speaker notes a slide may have. */
export const MAX_SLIDE_NOTES = 20_000;

/**
 * The slide's speaker notes, as plain text (empty: none) – and formatted (`paragraphs`, their
 * text the same as `text`), which then is what the file gets.
 */
export const setSlideNotesOperationSchema = z.object({
  type: z.literal('setSlideNotes'),
  pageId,
  text: z.string().max(MAX_SLIDE_NOTES),
  paragraphs: z
    .array(notesParagraphSchema)
    .max(2_000)
    .refine((paragraphs) => notesText(paragraphs).length <= MAX_SLIDE_NOTES, 'Notizen zu lang.')
    .optional(),
});

/**
 * A variant of slide `pageId`: a copy of it with the page id `newPageId`, hidden in the file and
 * shown above its slide. A variant's variant is one of the same slide.
 */
export const addVariantOperationSchema = z.object({
  type: z.literal('addVariant'),
  pageId,
  newPageId,
});

/**
 * Variant `pageId` takes its slide's place in the deck – that slide (and its other variants)
 * become variants of it.
 */
export const useVariantOperationSchema = z.object({
  type: z.literal('useVariant'),
  pageId,
});

export const slideOperationSchema = z.discriminatedUnion('type', [
  setTextOperationSchema,
  setBoxOperationSchema,
  setRichTextOperationSchema,
  setShapeStyleOperationSchema,
  addElementOperationSchema,
  addImageOperationSchema,
  copyElementOperationSchema,
  replaceImageOperationSchema,
  setTiltOperationSchema,
  setLockedOperationSchema,
  setCornerRadiusOperationSchema,
  setImageFitOperationSchema,
  deleteElementOperationSchema,
  moveElementOperationSchema,
  groupElementsOperationSchema,
  ungroupElementsOperationSchema,
  deleteSlideOperationSchema,
  setSlideHiddenOperationSchema,
  setSlideBackgroundOperationSchema,
  setSlideTransitionOperationSchema,
  moveSlideOperationSchema,
  duplicateSlideOperationSchema,
  addSlideOperationSchema,
  setSlideNotesOperationSchema,
  addVariantOperationSchema,
  useVariantOperationSchema,
]);
export type SlideOperation = z.infer<typeof slideOperationSchema>;
export type SetTextOperation = z.infer<typeof setTextOperationSchema>;
export type SetBoxOperation = z.infer<typeof setBoxOperationSchema>;
export type SetRichTextOperation = z.infer<typeof setRichTextOperationSchema>;
export type SetShapeStyleOperation = z.infer<typeof setShapeStyleOperationSchema>;
export type AddElementOperation = z.infer<typeof addElementOperationSchema>;
export type AddImageOperation = z.infer<typeof addImageOperationSchema>;
export type CopyElementOperation = z.infer<typeof copyElementOperationSchema>;
export type ReplaceImageOperation = z.infer<typeof replaceImageOperationSchema>;
export type SetTiltOperation = z.infer<typeof setTiltOperationSchema>;
export type SetLockedOperation = z.infer<typeof setLockedOperationSchema>;
export type SetCornerRadiusOperation = z.infer<typeof setCornerRadiusOperationSchema>;
export type SetImageFitOperation = z.infer<typeof setImageFitOperationSchema>;
export type DeleteElementOperation = z.infer<typeof deleteElementOperationSchema>;
export type MoveElementOperation = z.infer<typeof moveElementOperationSchema>;
export type GroupElementsOperation = z.infer<typeof groupElementsOperationSchema>;
export type UngroupElementsOperation = z.infer<typeof ungroupElementsOperationSchema>;
export type DeleteSlideOperation = z.infer<typeof deleteSlideOperationSchema>;
export type SetSlideHiddenOperation = z.infer<typeof setSlideHiddenOperationSchema>;
export type SetSlideBackgroundOperation = z.infer<typeof setSlideBackgroundOperationSchema>;
export type SetSlideTransitionOperation = z.infer<typeof setSlideTransitionOperationSchema>;
export type MoveSlideOperation = z.infer<typeof moveSlideOperationSchema>;
export type DuplicateSlideOperation = z.infer<typeof duplicateSlideOperationSchema>;
export type AddSlideOperation = z.infer<typeof addSlideOperationSchema>;
export type SetSlideNotesOperation = z.infer<typeof setSlideNotesOperationSchema>;
export type AddVariantOperation = z.infer<typeof addVariantOperationSchema>;
export type UseVariantOperation = z.infer<typeof useVariantOperationSchema>;

/** Most operations one request (or one AI proposal) may carry. */
export const MAX_OPERATIONS_PER_EDIT = 100;

export const slideOperationsSchema = z
  .array(slideOperationSchema)
  .min(1)
  .max(MAX_OPERATIONS_PER_EDIT);

// ── API ──────────────────────────────────────────────────────────────────

/** Who made a step of a deck's edit history: `original` is the file as it came. */
export const deckEditSourceSchema = z.enum(['original', 'editor', 'ai']);
export type DeckEditSource = z.infer<typeof deckEditSourceSchema>;

/** A slide of an editable deck: the editor's view, tied to the viewer's slide by `slideId`. */
export const editSlideSchema = editableSlideSchema.extend({
  slideId: z.string(),
  /** The slide's id in the file: what operations name it by (`pageId`, `after`, `like`). */
  pageId: z.string(),
});
export type EditSlide = z.infer<typeof editSlideSchema>;

/** `GET /decks/:id/edit` – whether and how the deck can be edited, and its elements. */
export const deckEditStateSchema = z.object({
  /** Only ODP decks can be edited for now (BER-177). */
  editable: z.boolean(),
  /** Why not, in German; `null` when it can. */
  reason: z.string().nullable(),
  /** The edit step the deck shows (0 = as it came). */
  seq: z.number().int().nonnegative(),
  /** The workspace has a working AI key: the AI can propose changes (BER-183). */
  aiAvailable: z.boolean(),
  /** Why not, in German (no key, the service refused it); `null` while it is there. */
  aiReason: z.string().nullable().default(null),
  /** Stock photos can be searched: the workspace or the instance has a photo service. */
  stockPhotos: z.boolean().default(false),
  /** Which one – named in the search's credit. */
  photoSource: photoProviderSchema.nullable().default(null),
  /** Pictures can be generated: the workspace or the instance has a key for it. */
  imageGeneration: z.boolean().default(false),
  /** Pictures can be cut out of their background: the server has rembg (REMBG_URL). */
  cutOut: z.boolean().default(false),
  /** The server sends mail: „Exportieren“ can send the file to someone (`…/edit/send`). */
  mail: z.boolean().default(false),
  /** The workspace's own fonts: slides are drawn in them, the editor offers them. */
  fonts: z.array(workspaceFontSchema).default([]),
  /** The slides' size in centimetres, for drawing live elements to scale. */
  pageSize: z
    .object({ width: z.number().positive(), height: z.number().positive() })
    .default({ width: 28, height: 15.75 }),
  slides: z.array(editSlideSchema),
});
export type DeckEditState = z.infer<typeof deckEditStateSchema>;

/**
 * A deck's speaker notes, slide by slide – for everyone who may open it (the presenter view);
 * changing them stays with edit rights (`setSlideNotes`).
 */
export const deckNotesSchema = z.object({
  slides: z.array(
    z.object({
      slideId: z.string(),
      notes: z.string(),
      notesRich: z.array(notesParagraphSchema).optional(),
    }),
  ),
});
export type DeckNotes = z.infer<typeof deckNotesSchema>;

/**
 * What „Exportieren“ hands out: the deck's file (a template as `.otp`), its PDF, or one slide
 * (`slideId`) as a PDF or as its picture (PNG).
 */
export const exportFormatSchema = z.enum(['file', 'pdf', 'slidePdf', 'slidePng']);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

/** Longest note sent along with an exported file. */
export const EXPORT_NOTE_MAX = 2000;

/** `POST /decks/:id/edit/send` – the export mailed to someone, as an attachment. */
export const sendExportInputSchema = z.object({
  to: z.email().max(320),
  note: z.string().trim().max(EXPORT_NOTE_MAX).optional(),
  format: exportFormatSchema,
  /** The slide for `slidePdf` and `slidePng`. */
  slideId: z.string().min(1).max(100).optional(),
});
export type SendExportInput = z.infer<typeof sendExportInputSchema>;

export const applyEditInputSchema = z.object({
  operations: slideOperationsSchema,
  /**
   * The step the editor made them on. Another step meanwhile (someone else's, or while the editor
   * was offline): they are applied to the deck as it is now, those that no longer fit left out.
   */
  baseSeq: z.number().int().nonnegative().optional(),
  /**
   * The editor's own id for this edit, unique for each: sent again (a retry after a timeout, a
   * reload while it was on its way), it is applied once – the repeat gets the step the first made.
   * Kept with that step, so a restart of the server in between changes nothing.
   */
  clientEditId: z.string().min(1).max(100).optional(),
  /**
   * The account the editor made it under: another one signed in by now (the editor's tab had not
   * heard of it yet) – it is refused (409 `account_changed`), never applied as someone else's.
   */
  userId: z.string().min(1).max(100).optional(),
});
export type ApplyEditInput = z.infer<typeof applyEditInputSchema>;

/**
 * `POST /decks/:id/edit/operations` and `…/edit/revert` – the new edit state, the step made and
 * how many operations (slides, taking back) were left out.
 */
export const applyEditResultSchema = deckEditStateSchema.extend({
  /**
   * Operations that no longer fit the deck (their element or slide went meanwhile) – for taking
   * a step back, the slides left as they are (someone changed the same things since).
   */
  dropped: z.number().int().nonnegative().default(0),
  /** The step the edit made (`null`: none – nothing of it fitted any more). */
  step: z.number().int().nonnegative().nullable().default(null),
});
export type ApplyEditResult = z.infer<typeof applyEditResultSchema>;

/**
 * `POST /decks/:id/edit/revert` – takes back one step of one's own (undo; redo takes back that
 * undo's step) on top of the deck as it is now: what others changed since stays.
 */
export const revertEditInputSchema = z.object({
  seq: z.number().int().positive(),
  /** As for an edit ({@link applyEditInputSchema}): sent again, the step is taken back once. */
  clientEditId: z.string().min(1).max(100).optional(),
  /** As for an edit ({@link applyEditInputSchema}): refused under another account. */
  userId: z.string().min(1).max(100).optional(),
});
export type RevertEditInput = z.infer<typeof revertEditInputSchema>;

/**
 * `POST /decks/:id/edit/slides/:slideId/layers` – a slide taken apart for the layers view: what
 * is under every element (page and master background, master shapes) and each element drawn
 * alone, see-through around it, bottom first – in the order of the slide's `elements`.
 */
export const slideLayersSchema = z.object({
  /** The edit step they were drawn from. */
  seq: z.number().int().nonnegative(),
  background: z.string(),
  /**
   * Composed (`compose`): what lies over the slide's own background – its master's shapes, footer
   * and page number – see-through elsewhere, PNG cut to `box`; `url` `null`: nothing does. The
   * browser draws the slide's own background beneath it.
   */
  masterShapes: z
    .object({
      url: z.string().nullable(),
      box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
    })
    .optional(),
  /**
   * Composed: the master's background alone (JPEG, the whole slide) – what the browser shows under
   * the master's shapes where the slide has no background of its own („Wie Master“ at once).
   */
  masterGround: z.string().optional(),
  layers: z.array(
    z.object({
      elementId: z.string(),
      /**
       * PNG cut to `box` (of the slide: 0–1 on it – beyond for an element reaching off it, drawn
       * whole); `null` when the element draws nothing.
       */
      url: z.string().nullable(),
      box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
    }),
  ),
});
export type SlideLayers = z.infer<typeof slideLayersSchema>;

/** `POST /decks/:id/edit/images` – a picture ready for `replaceImage`. */
export const uploadedEditImageSchema = z.object({
  imageId: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type UploadedEditImage = z.infer<typeof uploadedEditImageSchema>;

/** Longest description a picture is generated from. */
export const IMAGE_PROMPT_MAX = 2000;

/** `POST /decks/:id/edit/images/generate` – a picture generated from a description. */
export const generateEditImageInputSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, 'Bitte beschreiben, was das Bild zeigen soll.')
    .max(IMAGE_PROMPT_MAX),
  /** The frame's width / height: the picture is generated roughly so and cut to it. */
  aspect: z.number().min(0.01).max(100).nullable().default(null),
});
export type GenerateEditImageInput = z.infer<typeof generateEditImageInputSchema>;

// ── Stock photos (Unsplash, Pexels) ──────────────────────────────────────

/**
 * A photo found on Unsplash or Pexels. Its pictures are always loaded from the service itself
 * (hotlinked); only when one goes into a slide does the server fetch it into the file.
 */
export const stockPhotoSchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Its average colour, shown while it loads. */
  color: z.string().nullable(),
  /** A small picture (~400 px wide) for lists. */
  thumbUrl: z.string(),
  /** The picture's base address; `w`, `h` and `fit=crop` give any size (see `stockPhotoUrl`). */
  rawUrl: z.string(),
  credit: imageCreditSchema,
});
export type StockPhoto = z.infer<typeof stockPhotoSchema>;

/** The photo cut to `aspect` (width / height), about `width` px wide – as it goes into the file. */
export function stockPhotoUrl(
  photo: Pick<StockPhoto, 'rawUrl'>,
  width: number,
  aspect?: number | null,
) {
  const url = new URL(photo.rawUrl);
  url.searchParams.set('w', String(Math.round(width)));
  if (aspect) {
    url.searchParams.set('h', String(Math.round(width / aspect)));
    url.searchParams.set('fit', 'crop');
    url.searchParams.set('crop', 'entropy');
  }
  url.searchParams.set('fm', 'jpg');
  url.searchParams.set('q', '80');
  return url.toString();
}

export const stockOrientationSchema = z.enum(['landscape', 'portrait', 'squarish']);
export type StockOrientation = z.infer<typeof stockOrientationSchema>;

/** `GET /decks/:id/stock/photos?q=…&orientation=…` */
export const stockSearchSchema = z.object({ photos: z.array(stockPhotoSchema) });
export type StockSearch = z.infer<typeof stockSearchSchema>;

/** `POST /decks/:id/stock/photos/:photoId` – the photo cut to the frame it goes into. */
export const pickStockPhotoInputSchema = z.object({
  /** The frame's width / height; without it the photo keeps its own proportions. */
  aspect: z.number().min(0.05).max(20).optional(),
});
export type PickStockPhotoInput = z.infer<typeof pickStockPhotoInputSchema>;

// ── AI proposals ─────────────────────────────────────────────────────────

/** How long the AI may work on a request, waiting included: then it stops, and its change goes back. */
export const AI_RUNNING_LIMIT_MS = 10 * 60_000;

/**
 * `running` → `applied` (the AI applies its proposal right away) ⇄ `reverted`; `ready` when it
 * changed nothing, `failed`, `cancelled` when someone stopped it. `discarded`: from before
 * proposals applied themselves.
 */
export const aiProposalStatusSchema = z.enum([
  'running',
  'ready',
  'failed',
  'applied',
  'reverted',
  'discarded',
  'cancelled',
]);
export type AiProposalStatus = z.infer<typeof aiProposalStatusSchema>;

/**
 * Asked from a comment (⌘↵): the AI reads its thread and edits the deck, starting at the comment's
 * slide. Or „Variante erstellen“ with words: the AI makes a variant of slide `variantOf` as they say.
 */
export const createAiProposalInputSchema = z.union([
  z.object({ commentId: z.string().min(1) }),
  z.object({ variantOf: z.string().min(1), prompt: z.string().trim().min(1).max(4_000) }),
]);
export type CreateAiProposalInput = z.infer<typeof createAiProposalInputSchema>;

export const aiProposalSchema = z.object({
  id: z.string(),
  slideId: z.string(),
  /** The comment that asked for it; the proposal shows in its thread, right after it. */
  commentId: z.string().nullable(),
  prompt: z.string(),
  status: aiProposalStatusSchema,
  /** What the AI did, in its words. */
  summary: z.string().nullable(),
  /**
   * Its reply asks the people something about the request: the thread waits under „KI“ for their
   * answer instead of going to „Erledigt“.
   */
  asks: z.boolean().default(false),
  error: z.string().nullable(),
  /**
   * The stock photo the AI put on the slide, and the others it would take: one click puts
   * another in its place.
   */
  photos: z
    .object({
      /** The frame showing it, when it is one the editor knows. */
      elementId: z.string().nullable(),
      /** The frame's width / height: every choice is cut to it. */
      aspect: z.number().nullable(),
      chosenId: z.string(),
      /** The AI's choice first. */
      candidates: z.array(stockPhotoSchema),
    })
    .nullable()
    .default(null),
  /**
   * While it runs: what it does now and the latest slide it drew – known to the server process
   * running it, `null` elsewhere and once it is done.
   */
  progress: z
    .object({ step: z.string(), previewUrl: z.string().nullable() })
    .nullable()
    .default(null),
  /**
   * Its card closed („Erledigt“) – for everyone, like a thread done (`Comment.status`): a
   * variant's answer (no thread) stays open on it until then. `null`: open.
   */
  resolvedAt: z.iso.datetime().nullable().default(null),
  /** Reactions to its answer (👍 / 👎 / egal), oldest first – as on a comment. */
  reactions: z.array(commentReactionSchema).optional(),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AiProposal = z.infer<typeof aiProposalSchema>;

/** `PATCH /decks/:id/ai/proposals/:proposalId` – its card done or open again, for everyone. */
export const updateAiProposalInputSchema = z.object({ status: commentStatusSchema });
export type UpdateAiProposalInput = z.infer<typeof updateAiProposalInputSchema>;

/** `POST /decks/:id/ai/proposals/:proposalId/photo` – another of its photos. */
export const choosePhotoInputSchema = z.object({ photoId: z.string().min(1).max(100) });
export type ChoosePhotoInput = z.infer<typeof choosePhotoInputSchema>;
