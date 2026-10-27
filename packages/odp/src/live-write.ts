import type {
  AddElementOperation,
  LiveTextStyle,
  RichParagraph,
  SetShapeStyleOperation,
  TextAlign,
} from '@slider/shared';
import { OdpError } from './errors';
import type { CmBox } from './geometry';
import { liveShapeOf, shapeStyleRef } from './live';
import type { Properties, StyleIndex } from './styles';
import { inlineNodes, rewriteParagraphs } from './text';
import { cm } from './units';
import {
  attr,
  attributeNames,
  childrenOf,
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
  });
  // Always written: a span must not take its paragraph's capitals or spacing unasked.
  attributes['fo:text-transform'] = style.caps ?? 'none';
  attributes['fo:letter-spacing'] = style.letterSpacing
    ? `${round(style.letterSpacing)}pt`
    : 'normal';
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

function fillParagraph(sink: StyleSink, paragraph: XmlNode, rich: RichParagraph): void {
  const tag = tagOf(paragraph) as string;
  const style = derivedStyle(sink, 'paragraph', attr(paragraph, 'text:style-name'));
  setProperties(style, 'style:paragraph-properties', { 'fo:text-align': ALIGN[rich.align] });
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

/** Replaces a live element's text by formatted paragraphs. */
export function writeRichText(
  sink: StyleSink,
  node: XmlNode,
  paragraphs: readonly RichParagraph[],
): void {
  const container = liveShapeOf(node) ? textContainerOf(node) : null;
  if (!container) throw new OdpError('operation', 'Dieses Element hat keinen formatierbaren Text.');
  rewriteParagraphs(
    container,
    paragraphs.length,
    (paragraph, index) =>
      fillParagraph(sink, paragraph, paragraphs[index] ?? { align: 'left', runs: [] }),
    (paragraph) => {
      const children = childrenOf(container);
      const geometry = children.findIndex((child) => tagOf(child) === 'draw:enhanced-geometry');
      children.splice(geometry < 0 ? children.length : geometry, 0, paragraph);
    },
  );
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
): void {
  if (!liveShapeOf(node))
    throw new OdpError('operation', 'Dieses Element hat keine Füllung oder Linie.');
  const ref = shapeStyleRef(node);
  const style = derivedStyle(sink, ref.family, ref.name);
  const attributes: Record<string, string> = {};
  if (change.fill !== undefined) {
    attributes['draw:fill'] = change.fill ? 'solid' : 'none';
    if (change.fill) attributes['draw:fill-color'] = change.fill.toLowerCase();
  }
  if (change.stroke !== undefined) {
    attributes['draw:stroke'] = change.stroke ? 'solid' : 'none';
    if (change.stroke) {
      attributes['svg:stroke-color'] = change.stroke.color.toLowerCase();
      attributes['svg:stroke-width'] = points(change.stroke.width);
    }
  }
  if (change.verticalAlign) attributes['draw:textarea-vertical-align'] = change.verticalAlign;
  const properties = setProperties(style, 'style:graphic-properties', attributes);
  if (change.fill !== undefined) {
    dropComplexColor(properties, 'loext:fill-complex-color');
    setTextStyleFill(
      sink,
      node,
      change.fill
        ? { 'draw:fill': 'solid', 'draw:fill-color': change.fill.toLowerCase() }
        : { 'draw:fill': 'none' },
    );
    for (const name of attributeNames(properties)) {
      if (
        name === 'draw:fill-gradient-name' ||
        name === 'draw:fill-hatch-name' ||
        name === 'draw:fill-image-name'
      ) {
        removeAttr(properties, name);
      }
    }
  }
  if (change.stroke !== undefined) {
    dropComplexColor(properties, 'loext:stroke-complex-color');
    removeAttr(properties, 'draw:stroke-dash');
  }
  setAttr(node, ref.attribute, sink.add(style));
}

/**
 * Leaves out an element's text, its shape as it is: the box keeps its height (a box that grows
 * with its text would shrink without it). The copy LibreOffice draws the live editor's picture
 * from, the text typed over it.
 */
export function blankText(sink: StyleSink, node: XmlNode): void {
  const container = liveShapeOf(node) ? textContainerOf(node) : null;
  if (!container) throw new OdpError('operation', 'Dieses Element hat keinen Text.');
  const tag = tagOf(container) as string;
  container[tag] = childrenOf(container).filter(
    (child) => !['text:p', 'text:h', 'text:list'].includes(tagOf(child) ?? ''),
  );
  const ref = shapeStyleRef(node);
  const style = derivedStyle(sink, ref.family, ref.name);
  setProperties(style, 'style:graphic-properties', { 'draw:auto-grow-height': 'false' });
  setAttr(node, ref.attribute, sink.add(style));
}

/**
 * Makes a shape draw as a mask of one of its parts (`OdpDocument.toCutoutBytes`): its area or
 * its outline, in black, and nothing else – no text, shadow or see-through. The outline keeps
 * its own line (width, dashes, joins); a shape without one gets the editor's new one (1 pt,
 * solid). `props`: the shape's graphic properties as it is drawn now (`graphicPropsOf`).
 */
export function maskElement(
  sink: StyleSink,
  node: XmlNode,
  part: 'fill' | 'stroke',
  props: Properties,
): void {
  const shape = liveShapeOf(node);
  const container = shape ? textContainerOf(node) : null;
  if (container) {
    const tag = tagOf(container) as string;
    container[tag] = childrenOf(container).filter(
      (child) => !['text:p', 'text:h', 'text:list'].includes(tagOf(child) ?? ''),
    );
  }
  const ref = shapeStyleRef(node);
  const style = derivedStyle(sink, ref.family, ref.name);
  // Every colour black, also the one not drawn: the same outline makes the same masks.
  const plain = {
    'draw:fill-color': '#000000',
    'svg:stroke-color': '#000000',
    'draw:shadow': 'hidden',
    'draw:opacity': '100%',
    'svg:stroke-opacity': '100%',
    'draw:auto-grow-height': 'false',
  };
  let properties: XmlNode;
  if (part === 'fill') {
    properties = setProperties(style, 'style:graphic-properties', {
      ...plain,
      'draw:fill': 'solid',
      'draw:fill-color': '#000000',
      'draw:stroke': 'none',
    });
  } else {
    const kind = props['draw:stroke'] ?? (shape === 'text' ? 'none' : 'solid');
    const own = kind === 'solid' || kind === 'dash';
    properties = setProperties(style, 'style:graphic-properties', {
      ...plain,
      'draw:fill': 'none',
      'draw:stroke': own ? kind : 'solid',
      'svg:stroke-color': '#000000',
      ...(own ? {} : { 'svg:stroke-width': '1pt' }),
    });
  }
  // A theme colour would be drawn instead of the black, as would a fill of its paragraph style.
  dropComplexColor(properties, 'loext:fill-complex-color');
  dropComplexColor(properties, 'loext:stroke-complex-color');
  setTextStyleFill(
    sink,
    node,
    part === 'fill'
      ? { 'draw:fill': 'solid', 'draw:fill-color': '#000000' }
      : { 'draw:fill': 'none' },
  );
  setAttr(node, ref.attribute, sink.add(style));
}

const DEFAULT_PADDING = {
  'fo:padding-top': '0.125cm',
  'fo:padding-bottom': '0.125cm',
  'fo:padding-left': '0.25cm',
  'fo:padding-right': '0.25cm',
};

/** A new text frame or rectangle (not yet on a page), with its text. */
export function newElement(
  sink: StyleSink,
  change: AddElementOperation,
  box: CmBox,
  name: string,
): XmlNode {
  const style = element('style:style', { 'style:family': 'graphic' });
  const text = change.kind === 'text';
  setProperties(style, 'style:graphic-properties', {
    'draw:stroke': change.stroke ? 'solid' : 'none',
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
        element('draw:enhanced-geometry', {
          'svg:viewBox': '0 0 21600 21600',
          'draw:type': 'rectangle',
          'draw:enhanced-path': 'M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N',
        }),
      ]);
  writeRichText(sink, node, change.paragraphs.length > 0 ? change.paragraphs : []);
  return node;
}
