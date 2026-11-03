import {
  arrowHeadWidth,
  hasHead,
  headsOf,
  lineEnds,
  turnedLine,
  type ElementFlip,
  type ElementLook,
  type ElementPaint,
  type ElementTilt,
  type LineHeads,
} from '@slider/shared';
import type { CmBox } from './geometry';
import { graphicPropsOf } from './live';
import type { Properties, StyleIndex } from './styles';
import { cm, lengthToCm } from './units';
import { readParagraphs } from './text';
import { attr, element, setAttr, tagOf, type XmlNode } from './xml';

/*
 * Straight lines (`draw:line`) as the editor works on them: their ends are the corners of their
 * box (`lineEnds`), the way they run their `flip`; an arrow head is LibreOffice's own „Arrow“
 * marker at an end – what PowerPoint takes as its medium triangle.
 */

const PT_PER_CM = 72 / 2.54;

/** LibreOffice's standard arrow head, as it writes it into styles.xml. */
export const ARROW_MARKER = {
  'draw:name': 'Arrow',
  'svg:viewBox': '0 0 20 30',
  'svg:d': 'M10 0l-10 30h20z',
} as const;

/** The marker element LibreOffice writes for its arrow head. */
export const arrowMarker = (): XmlNode => element('draw:marker', { ...ARROW_MARKER });

/** Whether `marker` is LibreOffice's „Arrow“ as it writes it. */
const isArrow = (marker: XmlNode | undefined): boolean =>
  !!marker &&
  attr(marker, 'svg:viewBox')?.trim() === ARROW_MARKER['svg:viewBox'] &&
  attr(marker, 'svg:d')?.replace(/\s+/g, '') === ARROW_MARKER['svg:d'].replace(/\s+/g, '');

const props = (styles: StyleIndex, node: XmlNode): Properties => graphicPropsOf(styles, node);

/** The heads a line's style sets (any marker counts as one). */
export function readHeads(styles: StyleIndex, node: XmlNode): LineHeads {
  const p = props(styles, node);
  return headsOf(!!p['draw:marker-start'], !!p['draw:marker-end']);
}

/** The way a line runs: from its first end (`svg:x1`, `svg:y1`) to its second. */
export function readLineFlip(node: XmlNode): ElementFlip {
  const [x1, y1, x2, y2] = ['svg:x1', 'svg:y1', 'svg:x2', 'svg:y2'].map(
    (name) => lengthToCm(attr(node, name)) ?? 0,
  );
  return { x: x1! > x2!, y: y1! > y2! };
}

/**
 * Lays a line into `box` (cm) running as `flip` says (as it ran when left out), turned by
 * `rotation` degrees round the box's centre.
 */
export function placeLine(
  node: XmlNode,
  box: CmBox,
  flip: ElementFlip | undefined,
  rotation = 0,
): void {
  const laid = turnedLine(box, flip ?? readLineFlip(node), rotation);
  const { from, to } = lineEnds(laid.box, laid.flip);
  setAttr(node, 'svg:x1', cm(from.x));
  setAttr(node, 'svg:y1', cm(from.y));
  setAttr(node, 'svg:x2', cm(to.x));
  setAttr(node, 'svg:y2', cm(to.y));
}

/**
 * The graphic properties of a line's heads: the „Arrow“ at each end that has one, as wide as
 * `arrowHeadWidth` makes it for a line `width` pt wide, its tip at the end; nothing at the others.
 */
export function headProperties(heads: LineHeads, width: number): Record<string, string> {
  const size = cm(arrowHeadWidth(width) / PT_PER_CM);
  const out: Record<string, string> = {};
  for (const [end, side] of [
    [false, 'start'],
    [true, 'end'],
  ] as const) {
    if (!hasHead(heads, end)) continue;
    out[`draw:marker-${side}`] = ARROW_MARKER['draw:name'];
    out[`draw:marker-${side}-width`] = size;
    out[`draw:marker-${side}-center`] = 'false';
  }
  return out;
}

/** The marker attributes of a line's style: dropped before its heads are written anew. */
export const HEAD_PROPERTIES = ['start', 'end'].flatMap((side) => [
  `draw:marker-${side}`,
  `draw:marker-${side}-width`,
  `draw:marker-${side}-center`,
]);

/**
 * How the browser draws a line whole (`EditableElement.paint`), else `undefined`: a plain line,
 * solid or dashed as the editor writes it, not see-through, without shadow, glow or soft edge,
 * butt ends, no text on it – its heads none or Slider's (LibreOffice's „Arrow“ as wide as
 * `arrowHeadWidth`, its tip at the end).
 */
export function linePaintOf(
  styles: StyleIndex,
  node: XmlNode,
  look: ElementLook | null,
  frame: { rotation: number } | null,
  tilt: ElementTilt | null,
  sliderDash: (name: string | undefined) => boolean,
): ElementPaint | undefined {
  const stroke = look?.stroke;
  if (!frame || tilt || !stroke || tagOf(node) !== 'draw:line') return undefined;
  if (readParagraphs(node).some((paragraph) => paragraph.trim())) return undefined;
  const p = props(styles, node);
  const line = p['draw:stroke'] ?? 'solid';
  if (line === 'dash' ? !stroke.dash || !sliderDash(p['draw:stroke-dash']) : line !== 'solid')
    return undefined;
  if (
    (p['draw:shadow'] ?? 'hidden') !== 'hidden' ||
    (lengthToCm(p['loext:softedge-radius']) ?? 0) > 0 ||
    (lengthToCm(p['loext:glow-radius']) ?? 0) > 0 ||
    (p['svg:stroke-linecap'] ?? 'butt') !== 'butt'
  )
    return undefined;
  const opacity = p['svg:stroke-opacity'];
  const strokeOpacity = opacity === undefined ? 1 : Number.parseFloat(opacity) / 100;
  if (!Number.isFinite(strokeOpacity)) return undefined;
  const width = arrowHeadWidth(stroke.width) / PT_PER_CM;
  for (const side of ['start', 'end']) {
    const name = p[`draw:marker-${side}`];
    if (!name) continue;
    const size = lengthToCm(p[`draw:marker-${side}-width`]);
    if (
      !isArrow(styles.marker(name)) ||
      p[`draw:marker-${side}-center`] === 'true' ||
      size === null ||
      Math.abs(size - width) > 0.002
    )
      return undefined;
  }
  return { outline: 'line', radius: 0, ...(strokeOpacity < 1 && { strokeOpacity }) };
}
