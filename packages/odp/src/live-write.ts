import type {
  AddElementOperation,
  ElementEffects,
  LiveParagraph,
  LiveTextStyle,
  NewShape,
  RichParagraph,
  SetShapeStyleOperation,
  TextAlign,
  TextList,
} from '@slider/shared';
import { LIST_INDENT, LIST_LABEL_WIDTH, listBullet, listOf } from '@slider/shared/live-text';
import { OdpError } from './errors';
import type { CmBox } from './geometry';
import {
  explainLive,
  levelStyle,
  liveShapeOf,
  paragraphPlaces,
  readLook,
  shapeStyleRef,
  textContext,
} from './live';
import { HEAD_PROPERTIES, headProperties, placeLine, readHeads } from './lines';
import { propertiesOf, type Properties, type StyleIndex } from './styles';
import { inlineNodes, rewriteParagraphs } from './text';
import { cm } from './units';
import {
  attr,
  attributeNames,
  childrenOf,
  cloneNode,
  element,
  firstChild,
  removeAttr,
  removeChild,
  setAttr,
  tagOf,
  type XmlNode,
} from './xml';

/** A line width in points, as typed: in cm (to 1/1000) 1 pt would read back as 0.99. */
const points = (value: number) => `${Number(value.toFixed(3))}pt`;

/*
 * Writing what the live editor changes (formatted text, a box's fill and border, new boxes) as
 * ODF: automatic styles in content.xml that spell out every property the editor shows, so
 * LibreOffice draws exactly what the browser did. Equal styles are shared, not written twice.
 */

/** What the writers need from the document: its styles and a place for new automatic ones. */
export interface StyleSink {
  index: StyleIndex;
  /** The content automatic style of that family and name, if it is one. */
  automatic: (family: string, name: string) => XmlNode | undefined;
  /** Adds an automatic style (its `style:name` is set) – or finds an equal one – and returns its name. */
  add: (style: XmlNode) => string;
}

const ALIGN: Record<TextAlign, string> = {
  left: 'start',
  center: 'center',
  right: 'end',
  justify: 'justify',
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

/** Properties drawn in a family of their own for Asian and complex scripts. */
const SCRIPT_VARIANTS = ['fo:font-size', 'fo:font-weight', 'fo:font-style'] as const;
const VARIANT: Record<(typeof SCRIPT_VARIANTS)[number], string> = {
  'fo:font-size': 'font-size',
  'fo:font-weight': 'font-weight',
  'fo:font-style': 'font-style',
};

/** Every text property the editor shows, as `style:text-properties` attributes. */
export function textAttributes(index: StyleIndex, style: LiveTextStyle): Record<string, string> {
  const face = index.fontFaceFor(style.font);
  const attributes: Record<string, string> = face
    ? { 'style:font-name': face }
    : { 'fo:font-family': /[\s,]/.test(style.font) ? `'${style.font}'` : style.font };
  Object.assign(attributes, {
    'fo:font-size': `${round(style.size)}pt`,
    'fo:color': style.color.toLowerCase(),
    'fo:font-weight': style.bold ? 'bold' : 'normal',
    'fo:font-style': style.italic ? 'italic' : 'normal',
    'style:text-underline-style': style.underline ? 'solid' : 'none',
    'style:text-underline-width': 'auto',
    'style:text-underline-color': 'font-color',
    'style:text-line-through-style': style.strike ? 'solid' : 'none',
  });
  if (style.strike) attributes['style:text-line-through-type'] = 'single';
  // Always written: a span must not take its paragraph's capitals or spacing unasked.
  attributes['fo:text-transform'] = style.caps ?? 'none';
  attributes['fo:letter-spacing'] = style.letterSpacing
    ? `${round(style.letterSpacing)}pt`
    : 'normal';
  attributes['style:letter-kerning'] = style.kerning === false ? 'false' : 'true';
  // Needs the `loext:` prefix declared (the document does for rich text).
  attributes['loext:opacity'] = `${round(Math.max(0.01, style.opacity ?? 1) * 100, 1)}%`;
  for (const name of SCRIPT_VARIANTS) {
    const value = attributes[name] as string;
    attributes[`style:${VARIANT[name]}-asian`] = value;
    attributes[`style:${VARIANT[name]}-complex`] = value;
  }
  return attributes;
}

/** Sets properties on a style's `style:<kind>-properties`, creating it in ODF's order. */
function setProperties(style: XmlNode, tag: string, attributes: Record<string, string>): XmlNode {
  let properties = firstChild(style, tag);
  if (!properties) {
    properties = element(tag);
    const order = [
      'style:graphic-properties',
      'loext:graphic-properties',
      'style:paragraph-properties',
      'style:text-properties',
    ];
    const children = childrenOf(style);
    const at = children.findIndex(
      (child) => order.indexOf(tagOf(child) ?? '') > order.indexOf(tag),
    );
    children.splice(at < 0 ? children.length : at, 0, properties);
  }
  for (const [name, value] of Object.entries(attributes)) setAttr(properties, name, value);
  return properties;
}

/** Drops a theme colour reference, which LibreOffice would draw instead of the colour set. */
function dropComplexColor(properties: XmlNode, tag: string): void {
  for (const child of childrenOf(properties).filter((node) => tagOf(node) === tag)) {
    removeChild(properties, child);
  }
}

/**
 * Sets the fill a shape's default paragraph style (`draw:text-style-name`) carries, if it carries
 * one: PowerPoint imports put the shape's fill there too (`loext:graphic-properties`), and
 * LibreOffice draws that one over the fill of the shape's own style.
 */
function setTextStyleFill(sink: StyleSink, node: XmlNode, fill: Record<string, string>): void {
  const name = attr(node, 'draw:text-style-name');
  const chain = sink.index.chain('paragraph', name);
  if (!chain.some((style) => firstChild(style, 'loext:graphic-properties'))) return;
  const style = derivedStyle(sink, 'paragraph', name);
  const properties = setProperties(style, 'loext:graphic-properties', fill);
  dropComplexColor(properties, 'loext:fill-complex-color');
  setAttr(node, 'draw:text-style-name', sink.add(style));
}

/**
 * A copy of the named style (an automatic one) or a new style deriving from it (a common one),
 * without a name yet.
 */
function derivedStyle(sink: StyleSink, family: string, name: string | undefined): XmlNode {
  const automatic = name ? sink.automatic(family, name) : undefined;
  if (automatic) {
    const copy = structuredClone(automatic);
    removeAttr(copy, 'style:name');
    return copy;
  }
  return element('style:style', {
    'style:family': family,
    ...(name && sink.index.has(family, name) ? { 'style:parent-style-name': name } : {}),
  });
}

function textStyleName(sink: StyleSink, style: LiveTextStyle): string {
  const node = element('style:style', { 'style:family': 'text' });
  setProperties(node, 'style:text-properties', textAttributes(sink.index, style));
  return sink.add(node);
}

/** `lineSpacing`: set anew, else as it is. */
function fillParagraph(
  sink: StyleSink,
  paragraph: XmlNode,
  rich: RichParagraph,
  lineSpacing?: LiveParagraph['lineSpacing'],
): void {
  const tag = tagOf(paragraph) as string;
  const style = derivedStyle(sink, 'paragraph', attr(paragraph, 'text:style-name'));
  const layout = setProperties(style, 'style:paragraph-properties', {
    'fo:text-align': ALIGN[rich.align],
  });
  if (lineSpacing !== undefined) {
    // One way of spacing lines at a time: the others would win over the one set.
    for (const name of ['fo:line-height', 'style:line-height-at-least', 'style:line-spacing']) {
      removeAttr(layout, name);
    }
    const { type, value } = lineSpacing;
    if (type === 'minimum') setAttr(layout, 'style:line-height-at-least', points(value));
    else {
      setAttr(
        layout,
        'fo:line-height',
        type === 'fixed' ? points(value) : `${round(value * 100, 1)}%`,
      );
    }
  }
  // The paragraph's own text style is the first run's: an empty paragraph keeps its height.
  const first = rich.runs.find((run) => run.text) ?? rich.runs[0];
  if (first) {
    // The font is named one way or the other; the old way must not stay beside the new one.
    const old = firstChild(style, 'style:text-properties');
    for (const name of [
      'style:font-name',
      'fo:font-family',
      'style:font-family-generic',
      'style:font-pitch',
    ]) {
      if (old) removeAttr(old, name);
    }
    const properties = setProperties(
      style,
      'style:text-properties',
      textAttributes(sink.index, first),
    );
    dropComplexColor(properties, 'loext:char-complex-color');
  }
  setAttr(paragraph, 'text:style-name', sink.add(style));
  const children: XmlNode[] = [];
  for (const run of rich.runs) {
    if (!run.text) continue;
    children.push(
      element('text:span', { 'text:style-name': textStyleName(sink, run) }, inlineNodes(run.text)),
    );
  }
  paragraph[tag] = children;
}

/** The text of a text frame or a shape with text, `null` for anything else. */
function textContainerOf(node: XmlNode): XmlNode | null {
  return tagOf(node) === 'draw:frame' ? (firstChild(node, 'draw:text-box') ?? null) : node;
}

/** Takes a text container's paragraphs and lists out, leaving the rest (title, geometry). */
function dropText(container: XmlNode): void {
  const tag = tagOf(container) as string;
  container[tag] = childrenOf(container).filter(
    (child) => !['text:p', 'text:h', 'text:list'].includes(tagOf(child) ?? ''),
  );
}

const TEXT_BLOCKS = ['text:p', 'text:h', 'text:list'];

/** Whether a list style draws lists of that kind at that level. */
function draws(list: XmlNode | undefined, wanted: TextList): boolean {
  const level = levelStyle(list, wanted.level);
  if (!level) return false;
  return wanted.kind === 'bullet'
    ? tagOf(level) === 'text:list-level-style-bullet' && !!attr(level, 'text:bullet-char')
    : tagOf(level) === 'text:list-level-style-number' && attr(level, 'style:num-format') === '1';
}

/** A list style of Slider's own for lists of a kind: bullets or numbers, nine levels deep. */
export function newListStyle(sink: StyleSink, kind: TextList['kind']): string {
  const levels = Array.from({ length: 9 }, (_, i) => {
    const level = i + 1;
    const properties = element('style:list-level-properties', {
      'text:space-before': `${(level - 1) * LIST_INDENT}pt`,
      'text:min-label-width': `${LIST_LABEL_WIDTH}pt`,
    });
    // As large as the text: without it LibreOffice draws numbers small.
    const size = element('style:text-properties', { 'fo:font-size': '100%' });
    return kind === 'bullet'
      ? element(
          'text:list-level-style-bullet',
          {
            'text:level': String(level),
            'text:bullet-char': listBullet(level),
            'text:bullet-relative-size': '100%',
          },
          [properties, size],
        )
      : element(
          'text:list-level-style-number',
          { 'text:level': String(level), 'style:num-format': '1', 'style:num-suffix': '.' },
          [properties, size],
        );
  });
  return sink.add(element('text:list-style', {}, levels));
}

/**
 * Writes the paragraphs anew into lists as `lists` says: each in the list style its text already
 * draws such a list with (its own, another paragraph's, the shape's) – else one of Slider's –,
 * neighbours of one style in one list, a deeper level nested in it.
 */
function writeLists(
  sink: StyleSink,
  node: XmlNode,
  container: XmlNode,
  count: number,
  lists: readonly (TextList | null)[],
  fill: (paragraph: XmlNode, index: number) => void,
): void {
  const ctx = textContext(sink.index, node);
  const places = paragraphPlaces(ctx, container);
  const known = [...new Set([...places.map((place) => place.list), ctx.shapeList])];
  const written = new Map<string, string>();
  const styleFor = (index: number, wanted: TextList): string | null => {
    const own = places[Math.min(index, places.length - 1)]?.list;
    const found = [own, ...known].find(
      (list) => draws(list, wanted) && (list === ctx.shapeList || !!attr(list!, 'style:name')),
    );
    // The shape's own list style needs no name: a list in it draws so.
    if (found && found === ctx.shapeList) return null;
    if (found) return attr(found, 'style:name') as string;
    const name = written.get(wanted.kind) ?? newListStyle(sink, wanted.kind);
    written.set(wanted.kind, name);
    return name;
  };
  const nodes = Array.from({ length: Math.max(1, count) }, (_, index) => {
    const old = places[index]?.paragraph;
    const paragraph = old ?? cloneNode(places.at(-1)?.paragraph ?? element('text:p'));
    fill(paragraph, index);
    return paragraph;
  });
  const children = childrenOf(container);
  const first = children.findIndex((child) => TEXT_BLOCKS.includes(tagOf(child) ?? ''));
  const kept = first < 0 ? children.length : first;
  dropText(container);
  const blocks: XmlNode[] = [];
  let open: { style: string | null; list: XmlNode } | null = null;
  nodes.forEach((paragraph, index) => {
    const wanted = lists[index];
    if (!wanted) {
      blocks.push(paragraph);
      open = null;
      return;
    }
    const style = styleFor(index, wanted);
    if (!open || open.style !== style) {
      open = {
        style,
        list: element('text:list', style === null ? {} : { 'text:style-name': style }),
      };
      blocks.push(open.list);
    }
    let item = element('text:list-item');
    childrenOf(open.list).push(item);
    for (let level = 1; level < wanted.level; level += 1) {
      const inner = element('text:list-item');
      childrenOf(item).push(element('text:list', {}, [inner]));
      item = inner;
    }
    childrenOf(item).push(paragraph);
  });
  childrenOf(container).splice(kept, 0, ...blocks);
}

const sameList = (a: TextList | null, b: TextList | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.level === b.level);

/** Replaces a live element's text by formatted paragraphs. */
export function writeRichText(
  sink: StyleSink,
  node: XmlNode,
  paragraphs: readonly RichParagraph[],
): void {
  const container = liveShapeOf(node) ? textContainerOf(node) : null;
  if (!container) throw new OdpError('operation', 'Dieses Element hat keinen formatierbaren Text.');
  // How the paragraphs are now: lists and spacing change only where they are set otherwise.
  const before: readonly LiveParagraph[] = explainLive(sink.index, node).live?.paragraphs ?? [];
  const was = (index: number): LiveParagraph | undefined =>
    before[Math.min(index, before.length - 1)];
  const listWas = (index: number) => {
    const old = was(index);
    return old ? listOf(old) : null;
  };
  const spacing = paragraphs.map((rich, index) => {
    const now = was(index)?.lineSpacing;
    const wanted = rich.lineSpacing;
    return wanted && !(now?.type === wanted.type && Math.abs(now.value - wanted.value) < 0.001)
      ? wanted
      : undefined;
  });
  const fill = (paragraph: XmlNode, index: number) =>
    fillParagraph(
      sink,
      paragraph,
      paragraphs[index] ?? { align: 'left', runs: [] },
      spacing[index],
    );
  const lists = paragraphs.map((rich, index) =>
    rich.list === undefined ? listWas(index) : rich.list,
  );
  if (lists.some((list, index) => !sameList(list, listWas(index)))) {
    writeLists(sink, node, container, paragraphs.length, lists, fill);
  } else {
    rewriteParagraphs(container, paragraphs.length, fill);
  }
  if (
    attr(node, 'presentation:placeholder') === 'true' &&
    paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))
  ) {
    removeAttr(node, 'presentation:placeholder');
  }
}

/** Fill, border and vertical alignment of a live element, in a style of its own. */
export function writeShapeStyle(
  sink: StyleSink,
  node: XmlNode,
  change: SetShapeStyleOperation,
  /** The `draw:stroke-dash` a dashed or dotted border names (the document adds it). */
  dashName?: string,
  /** The fill as graphic properties, in place of `change.fill` (layers, see `fills.ts`). */
  fillProps?: Properties,
): void {
  const ref = shapeStyleRef(node);
  const style = derivedStyle(sink, ref.family, ref.name);
  const fill: Properties | undefined =
    fillProps ??
    (change.fill === undefined
      ? undefined
      : change.fill
        ? { 'draw:fill': 'solid', 'draw:fill-color': change.fill.toLowerCase() }
        : { 'draw:fill': 'none' });
  const attributes: Record<string, string> = { ...fill };
  if (change.stroke !== undefined) {
    const dashed = !!change.stroke && (change.stroke.dash ?? 'solid') !== 'solid' && !!dashName;
    attributes['draw:stroke'] = change.stroke ? (dashed ? 'dash' : 'solid') : 'none';
    if (dashed && dashName) attributes['draw:stroke-dash'] = dashName;
    if (change.stroke) {
      attributes['svg:stroke-color'] = change.stroke.color.toLowerCase();
      attributes['svg:stroke-width'] = points(change.stroke.width);
    }
  }
  if (change.verticalAlign) attributes['draw:textarea-vertical-align'] = change.verticalAlign;
  if (change.effects) Object.assign(attributes, effectProperties(change.effects));
  // A line's heads: set anew, or sized to its new width.
  const line = tagOf(node) === 'draw:line';
  const heads = line && (change.heads ?? (change.stroke ? readHeads(sink.index, node) : undefined));
  const headWidth = change.stroke?.width ?? readLook(sink.index, node, true).stroke?.width ?? 0;
  if (heads) Object.assign(attributes, headProperties(heads, headWidth));
  const properties = setProperties(style, 'style:graphic-properties', attributes);
  if (heads) {
    for (const name of HEAD_PROPERTIES) if (!(name in attributes)) removeAttr(properties, name);
  }
  if (fill) {
    dropComplexColor(properties, 'loext:fill-complex-color');
    setTextStyleFill(sink, node, fill);
    // What drew the old fill and the new one does not set: its gradient, picture, transparency.
    for (const name of attributeNames(properties)) {
      if (FILL_PROPERTIES.has(name) && !(name in fill)) removeAttr(properties, name);
    }
  }
  if (change.stroke !== undefined) {
    dropComplexColor(properties, 'loext:stroke-complex-color');
    if (attributes['draw:stroke'] !== 'dash') removeAttr(properties, 'draw:stroke-dash');
  }
  setAttr(node, ref.attribute, sink.add(style));
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Shadow, soft edge and glow as graphic properties – each spelt out, also when off: a style the
 * element's derives from may have one. `loext:` ones need the prefix declared (the document does).
 */
export function effectProperties(effects: ElementEffects): Record<string, string> {
  const { shadow, blur, glow } = effects;
  return {
    'draw:shadow': shadow ? 'visible' : 'hidden',
    ...(shadow
      ? {
          'draw:shadow-offset-x': points(shadow.x),
          'draw:shadow-offset-y': points(shadow.y),
          'draw:shadow-color': shadow.color.toLowerCase(),
          'draw:shadow-opacity': percent(shadow.opacity),
          'loext:shadow-blur': points(shadow.blur),
        }
      : {}),
    'loext:softedge-radius': points(blur ?? 0),
    'loext:glow-radius': points(glow?.radius ?? 0),
    ...(glow
      ? {
          'loext:glow-color': glow.color.toLowerCase(),
          'loext:glow-transparency': percent(1 - glow.opacity),
        }
      : {}),
  };
}

/** The graphic properties a fill is drawn with besides `draw:fill` and its colour. */
const FILL_PROPERTIES = new Set([
  'draw:fill-gradient-name',
  'draw:fill-hatch-name',
  'draw:fill-image-name',
  'draw:opacity',
  'draw:opacity-name',
  'draw:gradient-step-count',
  'draw:fill-image-width',
  'draw:fill-image-height',
  'draw:fill-image-ref-point',
  'draw:fill-image-ref-point-x',
  'draw:fill-image-ref-point-y',
  'draw:tile-repeat-offset',
  'style:repeat',
  'loext:fill-use-slide-background',
]);

/** A picture mirrored left to right or not, in a style of its own (`style:mirror`). */
export function writePictureMirror(sink: StyleSink, node: XmlNode, mirrored: boolean): void {
  const ref = shapeStyleRef(node);
  const style = derivedStyle(sink, ref.family, ref.name);
  setProperties(style, 'style:graphic-properties', {
    'style:mirror': mirrored ? 'horizontal' : 'none',
  });
  setAttr(node, ref.attribute, sink.add(style));
}

/**
 * Locks an element in place or unlocks it: its style's `style:protect`, which LibreOffice reads
 * as „Position und Größe schützen“ (`readLocked`).
 */
export function writeLock(
  sink: StyleSink,
  index: StyleIndex,
  node: XmlNode,
  locked: boolean,
): void {
  // What the file protected before stays: a lock adds position and size to it (and notes it),
  // an unlock gives back what was noted – locked elsewhere, position and size go, the rest stays.
  const before = protectOf(index, node);
  const tokens = protectTokens(before);
  let protect: string;
  if (locked) {
    if (attr(node, PROTECT_BEFORE) === undefined) setAttr(node, PROTECT_BEFORE, before);
    protect = [...new Set([...tokens, 'position', 'size'])].join(' ');
  } else {
    const noted = attr(node, PROTECT_BEFORE);
    removeAttr(node, PROTECT_BEFORE);
    protect =
      noted ??
      (tokens.filter((token) => token !== 'position' && token !== 'size').join(' ') || 'none');
  }
  const ref = shapeStyleRef(node);
  const style = derivedStyle(sink, ref.family, ref.name);
  setProperties(style, 'style:graphic-properties', { 'style:protect': protect });
  setAttr(node, ref.attribute, sink.add(style));
}

/** Where a lock notes what the element's `style:protect` was before it (`writeLock`). */
const PROTECT_BEFORE = 'slider:protect-before';

/** An element's `style:protect`: its most specific style that says (no merge of the rest). */
function protectOf(index: StyleIndex, node: XmlNode): string {
  const { family, name } = shapeStyleRef(node);
  const fallback = index.defaultStyle('graphic');
  const styles = [...index.chain(family, name)].reverse();
  for (const style of fallback ? [...styles, fallback] : styles) {
    const value = propertiesOf(style, 'graphic')['style:protect'];
    if (value !== undefined) return value;
  }
  return 'none';
}

const protectTokens = (protect: string): string[] =>
  protect.split(/\s+/).filter((token) => token && token !== 'none');

/** Whether an element is locked in place (`writeLock`): its position protected. */
export const readLocked = (index: StyleIndex, node: XmlNode): boolean =>
  protectTokens(protectOf(index, node)).includes('position');

/**
 * Leaves out an element's text, its shape as it is: the box keeps its height (a box that grows
 * with its text would shrink without it). The copy LibreOffice draws the live editor's picture
 * from, the text typed over it.
 */
export function blankText(sink: StyleSink, node: XmlNode): void {
  const container = liveShapeOf(node) ? textContainerOf(node) : null;
  if (!container) throw new OdpError('operation', 'Dieses Element hat keinen Text.');
  dropText(container);
  const ref = shapeStyleRef(node);
  const style = derivedStyle(sink, ref.family, ref.name);
  setProperties(style, 'style:graphic-properties', { 'draw:auto-grow-height': 'false' });
  setAttr(node, ref.attribute, sink.add(style));
}

const DEFAULT_PADDING = {
  'fo:padding-top': '0.125cm',
  'fo:padding-bottom': '0.125cm',
  'fo:padding-left': '0.25cm',
  'fo:padding-right': '0.25cm',
};

/**
 * A new line (not yet on a page): across `box` (cm) as its `flip` says, drawn by its stroke with
 * its heads – no fill, no text.
 */
function newLine(
  sink: StyleSink,
  change: AddElementOperation,
  box: CmBox,
  name: string,
  dashName?: string,
) {
  const style = element('style:style', { 'style:family': 'graphic' });
  const stroke = change.stroke ?? { color: '#000000', width: 1 };
  const dashed = (stroke.dash ?? 'solid') !== 'solid' && !!dashName;
  setProperties(style, 'style:graphic-properties', {
    'draw:stroke': dashed ? 'dash' : 'solid',
    ...(dashed && dashName ? { 'draw:stroke-dash': dashName } : {}),
    'svg:stroke-color': stroke.color.toLowerCase(),
    'svg:stroke-width': points(stroke.width),
    'draw:fill': 'none',
    'draw:shadow': 'hidden',
    ...headProperties(change.heads ?? 'none', stroke.width),
  });
  const node = element(
    'draw:line',
    {
      'draw:style-name': sink.add(style),
      'draw:layer': 'layout',
      'draw:name': name,
      'xml:id': change.elementId,
    },
    [element('text:p')],
  );
  placeLine(node, box, change.flip ?? { x: false, y: false });
  return node;
}

/** A new text frame or rectangle (not yet on a page), with its text. */
export function newElement(
  sink: StyleSink,
  change: AddElementOperation,
  box: CmBox,
  name: string,
  /** The `draw:stroke-dash` its dashed or dotted line names (the document adds it). */
  dashName?: string,
): XmlNode {
  if (change.kind === 'line') return newLine(sink, change, box, name, dashName);
  const style = element('style:style', { 'style:family': 'graphic' });
  const text = change.kind === 'text';
  const dashed = !!change.stroke && (change.stroke.dash ?? 'solid') !== 'solid' && !!dashName;
  setProperties(style, 'style:graphic-properties', {
    'draw:stroke': change.stroke ? (dashed ? 'dash' : 'solid') : 'none',
    ...(dashed && dashName ? { 'draw:stroke-dash': dashName } : {}),
    ...(change.stroke
      ? {
          'svg:stroke-color': change.stroke.color.toLowerCase(),
          'svg:stroke-width': points(change.stroke.width),
        }
      : {}),
    'draw:fill': change.fill ? 'solid' : 'none',
    ...(change.fill ? { 'draw:fill-color': change.fill.toLowerCase() } : {}),
    'draw:textarea-horizontal-align': 'justify',
    'draw:textarea-vertical-align': text ? 'top' : 'middle',
    'draw:auto-grow-height': text ? 'true' : 'false',
    'draw:auto-grow-width': 'false',
    'draw:fit-to-size': 'false',
    'style:shrink-to-fit': 'false',
    'draw:shadow': 'hidden',
    'fo:wrap-option': 'wrap',
    ...(text ? { 'fo:min-height': cm(box.h) } : {}),
    ...DEFAULT_PADDING,
  });
  const attributes = {
    'draw:style-name': sink.add(style),
    'draw:layer': 'layout',
    'draw:name': name,
    'svg:width': cm(Math.max(0.01, box.w)),
    'svg:height': cm(Math.max(0.01, box.h)),
    'svg:x': cm(box.x),
    'svg:y': cm(box.y),
    'xml:id': change.elementId,
  };
  const node = text
    ? element('draw:frame', attributes, [element('draw:text-box')])
    : element('draw:custom-shape', attributes, [
        element('draw:enhanced-geometry', geometryOf(change.shape)),
      ]);
  writeRichText(sink, node, change.paragraphs);
  return node;
}

/** A preset's outline: LibreOffice draws it from its `draw:type` alone, a rectangle spelt out. */
function geometryOf(shape: NewShape = 'rectangle'): Record<string, string> {
  return shape === 'rectangle'
    ? {
        'svg:viewBox': '0 0 21600 21600',
        'draw:type': 'rectangle',
        'draw:enhanced-path': 'M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N',
      }
    : { 'svg:viewBox': '0 0 21600 21600', 'draw:type': shape };
}

/** A new picture frame (not yet on a page) showing the package's picture `href`. */
export function newImageFrame(
  sink: StyleSink,
  elementId: string,
  box: CmBox,
  name: string,
  href: string,
): XmlNode {
  const style = element('style:style', { 'style:family': 'graphic' });
  setProperties(style, 'style:graphic-properties', {
    'draw:stroke': 'none',
    'draw:fill': 'none',
    'draw:shadow': 'hidden',
  });
  return element(
    'draw:frame',
    {
      'draw:style-name': sink.add(style),
      'draw:layer': 'layout',
      'draw:name': name,
      'svg:width': cm(Math.max(0.01, box.w)),
      'svg:height': cm(Math.max(0.01, box.h)),
      'svg:x': cm(box.x),
      'svg:y': cm(box.y),
      'xml:id': elementId,
    },
    [
      element('draw:image', {
        'xlink:href': href,
        'xlink:type': 'simple',
        'xlink:show': 'embed',
        'xlink:actuate': 'onLoad',
      }),
    ],
  );
}
