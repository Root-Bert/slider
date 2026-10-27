import {
  SYMBOL_FONTS,
  type LiveElement,
  type LiveParagraph,
  type LiveRun,
  type LiveTextStyle,
  type TextAlign,
  type VerticalAlign,
} from '@slider/shared';
import { hasPlainGeometry } from './geometry';
import { propertiesOf as propsOf, type Properties, type StyleIndex, unquote } from './styles';
import { lengthToCm } from './units';
import { attr, childrenOf, elementChildren, firstChild, tagOf, textOf, type XmlNode } from './xml';

/*
 * Which texts of a slide can be typed on it (the live editor), and how they look: a text frame
 * or a shape, upright, its text in runs of font, size, colour, bold, italic, underline, capitals
 * and letter spacing, with bullets. The browser draws only the text, over LibreOffice's picture
 * of the slide with that text left out – the shape itself stays LibreOffice's. Text the browser
 * could not draw like LibreOffice does (fields, numbering, symbol fonts, rotated text, …) is not
 * typed on the slide.
 */

export const PT_PER_CM = 72 / 2.54;

/** An ODF length in points, to 1/1000 – sizes written in points read back exactly. */
const pt = (value: string | undefined): number | null => {
  const points = value && /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*pt\s*$/.exec(value);
  if (points) return Number(points[1]);
  const cm = lengthToCm(value);
  return cm === null ? null : Number((cm * PT_PER_CM).toFixed(3));
};

/** Thrown inside the reader: the element is not drawn live. */
class NotLive extends Error {}
const notLive = (why: string): never => {
  throw new NotLive(why);
};

/** Placeholders whose text LibreOffice fills in or that are no slide content. */
const NOT_LIVE_CLASSES = new Set([
  'page-number',
  'footer',
  'header',
  'date-time',
  'notes',
  'page',
  'handout',
  'chart',
  'table',
  'object',
  'graphic',
  'orgchart',
]);

/**
 * A shape whose text can be typed: a rectangle or a custom shape of any outline (its text laid
 * out in its box – exact for rectangles, near enough for the rest), unless its text is turned.
 */
function isTextShape(node: XmlNode): boolean {
  const tag = tagOf(node);
  if (tag === 'draw:rect') return true;
  if (tag !== 'draw:custom-shape') return false;
  const geometry = firstChild(node, 'draw:enhanced-geometry');
  return (geometry ? (attr(geometry, 'draw:text-rotate-angle') ?? '0') : '0') === '0';
}

const ONLY_TEXT_BOX = (node: XmlNode) =>
  elementChildren(node).every((child) =>
    ['draw:text-box', 'svg:title', 'svg:desc'].includes(tagOf(child) ?? ''),
  ) && firstChild(node, 'draw:text-box') !== undefined;

export type LiveShape = 'text' | 'shape';

/** `text` for a text frame, `shape` for a shape with text, `null` for anything else. */
export function liveShapeOf(node: XmlNode): LiveShape | null {
  const tag = tagOf(node);
  if (tag === 'draw:frame') return ONLY_TEXT_BOX(node) ? 'text' : null;
  return isTextShape(node) ? 'shape' : null;
}

/** The shape's own style: the placeholder's presentation style, else its graphic style. */
export function shapeStyleRef(node: XmlNode): {
  family: string;
  name: string | undefined;
  attribute: string;
} {
  const presentation = attr(node, 'presentation:style-name');
  if (presentation) {
    return { family: 'presentation', name: presentation, attribute: 'presentation:style-name' };
  }
  return { family: 'graphic', name: attr(node, 'draw:style-name'), attribute: 'draw:style-name' };
}

// ── Text style ───────────────────────────────────────────────────────────

/** Text properties LibreOffice would draw differently than the browser does from our runs. */
function checkText(props: Properties): void {
  const position = props['style:text-position'];
  if (position && !/^0%?( 100%)?$/.test(position.trim())) notLive('super-/subscript');
  if ((props['fo:font-variant'] ?? 'normal') !== 'normal') notLive('small caps');
  if ((props['style:text-line-through-style'] ?? 'none') !== 'none') notLive('strike-through');
  if ((props['style:text-outline'] ?? 'false') !== 'false') notLive('outline');
  if ((props['fo:text-shadow'] ?? 'none') !== 'none') notLive('shadow');
  const scale = props['style:text-scale'];
  if (scale && scale !== '100%') notLive('text scale');
  const relief = props['style:font-relief'];
  if (relief && relief !== 'none') notLive('relief');
  const opacity = props['loext:opacity'];
  // LibreOffice writes 0% for „not set“ in default styles; only a real transparency counts.
  if (opacity && opacity !== '100%' && opacity !== '0%') notLive('transparent text');
}

export function applyText(
  index: StyleIndex,
  base: LiveTextStyle,
  props: Properties,
  { check = true }: { check?: boolean } = {},
): LiveTextStyle {
  if (check) checkText(props);
  const next = { ...base };
  const name = props['style:font-name'];
  const family = props['fo:font-family'];
  if (name) next.font = index.font(name);
  if (family) next.font = unquote(family);
  if (check && SYMBOL_FONTS.includes(next.font.toLowerCase())) notLive('symbol font');
  const size = props['fo:font-size'];
  if (size?.endsWith('%')) next.size = (base.size * Number.parseFloat(size)) / 100;
  else if (size) next.size = pt(size) ?? next.size;
  if (props['fo:color'] && /^#[0-9a-f]{6}$/i.test(props['fo:color'])) {
    next.color = props['fo:color'].toLowerCase();
  } else if (props['style:use-window-font-color'] === 'true') {
    next.color = '#000000';
  }
  const weight = props['fo:font-weight'];
  if (weight) next.bold = weight === 'bold' || Number(weight) >= 600;
  const style = props['fo:font-style'];
  if (style) next.italic = style === 'italic' || style === 'oblique';
  const underline = props['style:text-underline-style'];
  if (underline) next.underline = underline !== 'none';
  // Absent when plain: `none` and no extra spacing are what the editor's text has by default.
  const transform = props['fo:text-transform'];
  if (transform === 'uppercase' || transform === 'lowercase' || transform === 'capitalize')
    next.caps = transform;
  else if (transform) delete next.caps;
  const spacing = props['fo:letter-spacing'];
  const letterSpacing = spacing && spacing !== 'normal' ? (pt(spacing) ?? 0) : spacing ? 0 : null;
  if (letterSpacing) next.letterSpacing = letterSpacing;
  else if (letterSpacing === 0) delete next.letterSpacing;
  return next;
}

// ── Paragraph style ──────────────────────────────────────────────────────

interface ParagraphLook {
  align: TextAlign;
  lineSpacing: LiveParagraph['lineSpacing'];
  spaceBefore: number;
  spaceAfter: number;
  marginLeft: number;
  indent: number;
}

const ALIGN: Record<string, TextAlign> = {
  start: 'left',
  left: 'left',
  end: 'right',
  right: 'right',
  center: 'center',
  justify: 'justify',
};

function applyParagraph(base: ParagraphLook, props: Properties): ParagraphLook {
  const next = { ...base };
  const align = props['fo:text-align'];
  if (align) next.align = ALIGN[align] ?? next.align;
  const lineHeight = props['fo:line-height'];
  if (lineHeight === 'normal') next.lineSpacing = { type: 'proportional', value: 1 };
  else if (lineHeight?.endsWith('%')) {
    next.lineSpacing = { type: 'proportional', value: Number.parseFloat(lineHeight) / 100 };
  } else if (lineHeight) {
    next.lineSpacing = { type: 'fixed', value: pt(lineHeight) ?? 0 };
  }
  const atLeast = props['style:line-height-at-least'];
  if (atLeast) next.lineSpacing = { type: 'minimum', value: pt(atLeast) ?? 0 };
  const leading = props['style:line-spacing'];
  if (leading && pt(leading) !== 0) notLive('leading');
  for (const [key, name] of [
    ['spaceBefore', 'fo:margin-top'],
    ['spaceAfter', 'fo:margin-bottom'],
    ['marginLeft', 'fo:margin-left'],
    ['indent', 'fo:text-indent'],
  ] as const) {
    const value = props[name];
    if (value === undefined) continue;
    if (value.endsWith('%')) notLive('relative margin');
    next[key] = pt(value) ?? next[key];
  }
  const mode = props['style:writing-mode'];
  if (mode && !['lr-tb', 'page', 'lr'].includes(mode)) notLive('writing mode');
  if (props['fo:border'] && props['fo:border'] !== 'none') notLive('paragraph border');
  const background = props['fo:background-color'];
  if (background && background !== 'transparent') notLive('paragraph background');
  return next;
}

// ── Element ──────────────────────────────────────────────────────────────

/** Where an element's text gets its look, outermost first (see {@link readLive}). */
export interface TextContext {
  index: StyleIndex;
  /** The family default's and shape style's text and paragraph properties. */
  shapeText: (level: number) => Properties[];
  shapeParagraph: (level: number) => Properties[];
  /** The list style of the shape (presentation outline styles carry one). */
  shapeList: XmlNode | undefined;
}

/** The shape style chain for a list level: outline placeholders have a style per level. */
function levelChain(
  index: StyleIndex,
  family: string,
  name: string | undefined,
  level: number,
): XmlNode[] {
  const chain = index.chain(family, name);
  const root = chain[0];
  const rootName = root && attr(root, 'style:name');
  if (level <= 1 || !rootName?.endsWith('outline1')) return chain;
  const levelChainOf = index.chain(family, `${rootName.slice(0, -1)}${Math.min(level, 9)}`);
  return levelChainOf.length > 0 ? [...levelChainOf, ...chain.slice(1)] : chain;
}

export function textContext(index: StyleIndex, node: XmlNode): TextContext {
  const { family, name } = shapeStyleRef(node);
  const fallback = index.defaultStyle('graphic');
  const of = (kind: 'text' | 'paragraph') => (level: number) => {
    const chain = [...(fallback ? [fallback] : []), ...levelChain(index, family, name, level)];
    const props: Properties[] = chain.map((style) => propsOf(style, kind));
    // The frame's default paragraph style (`draw:text-style-name`).
    const textStyle = attr(node, 'draw:text-style-name');
    props.push(...index.chain('paragraph', textStyle).map((style) => propsOf(style, kind)));
    return props;
  };
  return {
    index,
    shapeText: of('text'),
    shapeParagraph: of('paragraph'),
    shapeList: index.listStyleOf(family, name),
  };
}

const DEFAULT_TEXT: LiveTextStyle = {
  font: 'Liberation Serif',
  size: 18,
  color: '#000000',
  bold: false,
  italic: false,
  underline: false,
};

const DEFAULT_PARAGRAPH: ParagraphLook = {
  align: 'left',
  lineSpacing: { type: 'proportional', value: 1 },
  spaceBefore: 0,
  spaceAfter: 0,
  marginLeft: 0,
  indent: 0,
};

const INLINE_IGNORED = new Set([
  'text:soft-page-break',
  'text:bookmark',
  'text:bookmark-start',
  'text:bookmark-end',
  'office:annotation',
  'office:annotation-end',
  'text:reference-mark',
  'text:reference-mark-start',
  'text:reference-mark-end',
]);

const sameStyle = (a: LiveTextStyle, b: LiveTextStyle) =>
  a.font === b.font &&
  a.size === b.size &&
  a.color === b.color &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline;

function readRuns(ctx: TextContext, paragraph: XmlNode, base: LiveTextStyle): LiveRun[] {
  const runs: LiveRun[] = [];
  const push = (text: string, style: LiveTextStyle) => {
    if (!text) return;
    const last = runs.at(-1);
    if (last && sameStyle(last, style)) last.text += text;
    else runs.push({ ...style, text });
  };
  const walk = (node: XmlNode, style: LiveTextStyle) => {
    for (const child of childrenOf(node)) {
      const text = textOf(child);
      if (text !== null) {
        // XML whitespace inside a paragraph is collapsed by ODF (runs of spaces are `text:s`).
        push(text.replace(/[\t\n\r ]+/g, ' '), style);
        continue;
      }
      const tag = tagOf(child) ?? '';
      if (INLINE_IGNORED.has(tag)) continue;
      if (tag === 'text:span') {
        const name = attr(child, 'text:style-name');
        const props = ctx.index.chain('text', name).map((s) => propsOf(s, 'text'));
        walk(
          child,
          props.reduce((current, p) => applyText(ctx.index, current, p), style),
        );
      } else if (tag === 'text:a') walk(child, style);
      else if (tag === 'text:s')
        push(' '.repeat(Math.max(1, Number(attr(child, 'text:c') ?? 1) || 1)), style);
      else if (tag === 'text:tab') push('\t', style);
      else if (tag === 'text:line-break') push('\n', style);
      else notLive(`inline ${tag}`);
    }
  };
  walk(paragraph, base);
  return runs;
}

interface ParagraphPlace {
  paragraph: XmlNode;
  level: number;
  /** The list style in effect, `undefined` outside a list. */
  list: XmlNode | undefined;
  /** In a `text:list-header`: indented like the level, without a bullet. */
  header: boolean;
}

function paragraphPlaces(ctx: TextContext, container: XmlNode): ParagraphPlace[] {
  const places: ParagraphPlace[] = [];
  const walk = (node: XmlNode, level: number, list: XmlNode | undefined, header: boolean) => {
    for (const child of childrenOf(node)) {
      const tag = tagOf(child);
      if (tag === 'text:p' || tag === 'text:h')
        places.push({ paragraph: child, level, list, header });
      else if (tag === 'text:list') {
        const named = ctx.index.list(attr(child, 'text:style-name'));
        const style = named ?? list ?? ctx.shapeList;
        for (const item of childrenOf(child)) {
          const itemTag = tagOf(item);
          if (itemTag === 'text:list-item' || itemTag === 'text:list-header') {
            walk(item, level + 1, style, itemTag === 'text:list-header');
          }
        }
      } else if (
        tag &&
        ![
          'svg:title',
          'svg:desc',
          'draw:enhanced-geometry',
          'office:event-listeners',
          'text:soft-page-break',
        ].includes(tag)
      ) {
        notLive(`block ${tag}`);
      }
    }
  };
  walk(container, 0, undefined, false);
  return places;
}

function levelStyle(list: XmlNode | undefined, level: number): XmlNode | undefined {
  if (!list || level === 0) return undefined;
  return elementChildren(list).find((node) => Number(attr(node, 'text:level') ?? 1) === level);
}

function readBullet(
  ctx: TextContext,
  place: ParagraphPlace,
  look: ParagraphLook,
  first: LiveTextStyle,
): { bullet: LiveParagraph['bullet']; marginLeft: number; indent: number } {
  const style = levelStyle(place.list, place.level);
  if (!style) return { bullet: null, marginLeft: look.marginLeft, indent: look.indent };
  const tag = tagOf(style);
  const properties = firstChild(style, 'style:list-level-properties');
  const alignment = properties && firstChild(properties, 'style:list-level-label-alignment');
  let at: number;
  let textAt: number;
  if (
    properties &&
    attr(properties, 'text:list-level-position-and-space-mode') === 'label-alignment' &&
    alignment
  ) {
    textAt = pt(attr(alignment, 'fo:margin-left')) ?? 0;
    at = textAt + (pt(attr(alignment, 'fo:text-indent')) ?? 0);
  } else {
    at = look.marginLeft + (pt(properties && attr(properties, 'text:space-before')) ?? 0);
    textAt = at + (pt(properties && attr(properties, 'text:min-label-width')) ?? 0);
  }
  let bullet: LiveParagraph['bullet'] = null;
  if (tag === 'text:list-level-style-bullet' && !place.header) {
    const char = attr(style, 'text:bullet-char') ?? '';
    if (char) {
      const props = propsOf(style, 'text');
      const size = props['fo:font-size'];
      const relative = attr(style, 'text:bullet-relative-size');
      const font = props['style:font-name']
        ? ctx.index.font(props['style:font-name'])
        : props['fo:font-family']
          ? unquote(props['fo:font-family'])
          : null;
      if (font && SYMBOL_FONTS.includes(font.toLowerCase())) notLive('symbol bullet');
      const color =
        props['fo:color'] && /^#[0-9a-f]{6}$/i.test(props['fo:color'])
          ? props['fo:color'].toLowerCase()
          : first.color;
      bullet = {
        char,
        font,
        size: size?.endsWith('%')
          ? (first.size * Number.parseFloat(size)) / 100
          : relative
            ? (first.size * Number.parseFloat(relative)) / 100
            : (pt(size) ?? first.size),
        color,
        at,
        width: textAt - at,
      };
    }
  } else if (tag === 'text:list-level-style-number') {
    if ((attr(style, 'style:num-format') ?? '') !== '' && !place.header) notLive('numbering');
  } else if (tag !== 'text:list-level-style-bullet') {
    notLive('picture bullets');
  }
  return { bullet, marginLeft: textAt, indent: bullet ? 0 : look.indent };
}

function readParagraph(ctx: TextContext, place: ParagraphPlace): LiveParagraph {
  const level = Math.max(1, place.level);
  const name = attr(place.paragraph, 'text:style-name');
  const paragraphChain = ctx.index.chain('paragraph', name);
  const textProps = [...ctx.shapeText(level), ...paragraphChain.map((s) => propsOf(s, 'text'))];
  // The defaults of the family hold „not set“ values LibreOffice never draws (see `checkText`).
  const base = textProps.reduce(
    (style, props, i) => applyText(ctx.index, style, props, { check: i > 0 }),
    DEFAULT_TEXT,
  );
  const paragraphProps = [
    ...ctx.shapeParagraph(level),
    ...paragraphChain.map((s) => propsOf(s, 'paragraph')),
  ];
  const look = paragraphProps.reduce(applyParagraph, DEFAULT_PARAGRAPH);
  // Read from the shape only: LibreOffice ignores it in a paragraph's own style.
  const fontIndependent =
    ctx
      .shapeParagraph(level)
      .reduce<string | undefined>(
        (value, props) => props['style:font-independent-line-spacing'] ?? value,
        undefined,
      ) === 'true';
  const runs = readRuns(ctx, place.paragraph, base);
  const first = runs.find((run) => run.text.trim()) ?? runs[0] ?? base;
  const { bullet, marginLeft, indent } = readBullet(ctx, place, look, first);
  const mark = runs.at(-1) ?? base;
  return {
    runs,
    mark: {
      font: mark.font,
      size: mark.size,
      color: mark.color,
      bold: mark.bold,
      italic: mark.italic,
      underline: mark.underline,
    },
    align: look.align,
    fontIndependent,
    lineSpacing: look.lineSpacing,
    spaceBefore: look.spaceBefore,
    spaceAfter: look.spaceAfter,
    marginLeft,
    indent,
    level: place.level,
    bullet,
  };
}

// ── Box ──────────────────────────────────────────────────────────────────

const DEFAULT_PADDING = {
  top: 0.125 * PT_PER_CM,
  bottom: 0.125 * PT_PER_CM,
  left: 0.25 * PT_PER_CM,
  right: 0.25 * PT_PER_CM,
};

/** The graphic properties a shape is drawn with: the default style's, then its own style chain's. */
export function graphicPropsOf(index: StyleIndex, node: XmlNode): Properties {
  const { family, name } = shapeStyleRef(node);
  const fallback = index.defaultStyle('graphic');
  return Object.assign(
    {},
    fallback ? propsOf(fallback, 'graphic') : {},
    ...index.chain(family, name).map((style) => propsOf(style, 'graphic')),
  );
}

function readBox(index: StyleIndex, node: XmlNode, shape: LiveShape) {
  const props = graphicPropsOf(index, node);
  // The shape stays LibreOffice's picture: its fill and outline are read for the editor's
  // controls only – one colour each, else none.
  const fillKind = props['draw:fill'] ?? (shape === 'text' ? 'none' : 'solid');
  const fill =
    fillKind === 'solid' && props['loext:fill-use-slide-background'] !== 'true'
      ? (props['draw:fill-color'] ?? '#729fcf').toLowerCase()
      : null;
  const strokeKind = props['draw:stroke'] ?? (shape === 'text' ? 'none' : 'solid');
  const stroke =
    strokeKind === 'solid'
      ? {
          color: (props['svg:stroke-color'] ?? '#3465a4').toLowerCase(),
          width: pt(props['svg:stroke-width']) ?? 0,
        }
      : null;
  const fit = props['draw:fit-to-size'];
  if (fit && fit !== 'false' && fit !== 'none') notLive('fit to size');
  if (props['draw:auto-grow-width'] === 'true') notLive('grows in width');
  if (shape === 'shape' && props['fo:wrap-option'] === 'no-wrap') notLive('no wrap');
  const writing = props['style:writing-mode'];
  if (writing && !['lr-tb', 'page', 'lr'].includes(writing)) notLive('writing mode');
  const padding = { ...DEFAULT_PADDING };
  const all = props['fo:padding'];
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const value = props[`fo:padding-${side}`] ?? all;
    if (value !== undefined) padding[side] = pt(value) ?? padding[side];
  }
  const vertical = props['draw:textarea-vertical-align'];
  const verticalAlign: VerticalAlign =
    vertical === 'middle' || vertical === 'bottom'
      ? vertical
      : vertical === 'top' || shape === 'text'
        ? 'top'
        : 'middle';
  const grow = props['draw:auto-grow-height'];
  const autoGrow = grow === undefined ? shape === 'text' : grow === 'true';
  const minHeight = pt(props['fo:min-height']);
  return {
    fill,
    stroke,
    padding,
    verticalAlign,
    autoGrow,
    minHeight: autoGrow ? (minHeight ?? 0) : null,
    ...(props['style:shrink-to-fit'] === 'true' ? { shrink: true } : {}),
  };
}

/**
 * The element's text as the browser draws it while it is typed in, or `null` (with the reason,
 * for tests) when it cannot be typed on the slide.
 */
export function readLive(index: StyleIndex, node: XmlNode): LiveElement | null {
  return explainLive(index, node).live;
}

export function explainLive(
  index: StyleIndex,
  node: XmlNode,
): { live: LiveElement | null; why: string | null } {
  try {
    const shape = liveShapeOf(node);
    if (!shape) return { live: null, why: 'not a text frame or rectangle' };
    if (!hasPlainGeometry(node)) return { live: null, why: 'transformed' };
    const role = attr(node, 'presentation:class');
    if (role && NOT_LIVE_CLASSES.has(role)) return { live: null, why: `placeholder ${role}` };
    if (attr(node, 'draw:text-rotate-angle') && attr(node, 'draw:text-rotate-angle') !== '0')
      return { live: null, why: 'rotated text' };
    const box = readBox(index, node, shape);
    const container = shape === 'text' ? (firstChild(node, 'draw:text-box') as XmlNode) : node;
    const ctx = textContext(index, node);
    const paragraphs = paragraphPlaces(ctx, container).map((place) => readParagraph(ctx, place));
    const empty = paragraphs.every((paragraph) => paragraph.runs.every((run) => !run.text.trim()));
    const placeholder = attr(node, 'presentation:placeholder') === 'true' && empty;
    return { live: { ...box, placeholder, paragraphs }, why: null };
  } catch (error) {
    if (error instanceof NotLive) return { live: null, why: error.message };
    throw error;
  }
}
