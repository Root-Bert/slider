import type { EditableElement, LiveElement, LiveParagraph, LiveTextStyle } from '@slider/shared';
import type { CSSProperties } from 'react';
import { fontCss, metricsFor } from './fonts';

/*
 * How live elements are drawn, as CSS (the live editor): text laid out the way LibreOffice
 * lays it out, boxes as it places them. Lengths are points of the slide, scaled to the slide
 * box: the layer sets `--pt` (one point in `cqw`).
 */

/** Points of the slide as CSS, inside a {@link liveLayerStyle} box. */
export const u = (pt: number) => `calc(${Number(pt.toFixed(3))} * var(--pt))`;

/** The style of the box live elements are drawn in: a container one point is measured by. */
export const liveLayerStyle = (pageWidthPt: number): CSSProperties =>
  ({
    containerType: 'inline-size',
    '--pt': `calc(100cqw / ${Number(pageWidthPt.toFixed(3))})`,
  }) as CSSProperties;

export const PT_PER_CM = 72 / 2.54;

/**
 * A line of text in `style` as LibreOffice lays it out (editeng): its height and where its
 * baseline sits below its top. A line is ascent + descent high – the font's own, or 1.2 × the
 * size with font-independent spacing (1 above the baseline, 0.2 below). Proportional spacing
 * scales the height; below 100 % the baseline moves up to at most 80 % of the new height, above
 * it all space is added on top. Fixed and minimum heights also add their space on top.
 */
export function lineBox(
  style: LiveTextStyle,
  paragraph: Pick<LiveParagraph, 'lineSpacing' | 'fontIndependent'>,
) {
  const metrics = metricsFor(style.font);
  const ascent = (paragraph.fontIndependent ? 1 : metrics.ascent) * style.size;
  const descent = (paragraph.fontIndependent ? 0.2 : metrics.descent) * style.size;
  const text = ascent + descent;
  const { type, value } = paragraph.lineSpacing;
  if (type === 'proportional') {
    const height = text * value;
    return {
      height,
      baseline: value < 1 ? Math.min(ascent, height * 0.8) : ascent + height - text,
    };
  }
  const height = type === 'fixed' ? value : Math.max(value, text);
  return { height, baseline: ascent + height - text };
}

/**
 * CSS puts the baseline where the font's own ascent and descent (the `@font-face` overrides)
 * sit centred in the line; the difference to LibreOffice's, to move the text by.
 */
function baselineShift(style: LiveTextStyle, paragraph: LiveParagraph): number {
  const box = lineBox(style, paragraph);
  const metrics = metricsFor(style.font);
  const content = (metrics.ascent + metrics.descent) * style.size;
  return box.baseline - ((box.height - content) / 2 + metrics.ascent * style.size);
}

export function textCss(style: LiveTextStyle, paragraph: LiveParagraph): CSSProperties {
  return {
    fontFamily: fontCss(style.font),
    fontSize: u(style.size),
    lineHeight: u(lineBox(style, paragraph).height),
    color: style.color,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    textTransform: style.caps ?? 'none',
    letterSpacing: style.letterSpacing ? u(style.letterSpacing) : 'normal',
    fontKerning: 'normal',
  };
}

/** The style a paragraph's line box is measured by: its first run's, or its mark's. */
export const strutOf = (paragraph: LiveParagraph): LiveTextStyle =>
  paragraph.runs.find((run) => run.text.trim()) ?? paragraph.runs[0] ?? paragraph.mark;

/** `first`: LibreOffice leaves out the space above a box's first paragraph. */
export function paragraphCss(paragraph: LiveParagraph, first = false): CSSProperties {
  const strut = strutOf(paragraph);
  return {
    ...textCss(strut, paragraph),
    margin: 0,
    paddingTop: u(first ? 0 : paragraph.spaceBefore),
    paddingBottom: u(paragraph.spaceAfter),
    paddingLeft: u(paragraph.marginLeft),
    textIndent: u(paragraph.indent),
    textAlign: paragraph.align,
    position: 'relative',
    top: u(baselineShift(strut, paragraph)),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    tabSize: u(1.25 * PT_PER_CM),
  };
}

const JUSTIFY: Record<LiveElement['verticalAlign'], CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

/**
 * Where an element sits on the slide and how its box is drawn – `textOnly`: no fill, the shape
 * is LibreOffice's picture under it.
 */
export function boxCss(
  element: EditableElement,
  live: LiveElement,
  textOnly = false,
): CSSProperties {
  const { x, y, w, h } = element.bbox;
  return {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    ...(live.autoGrow ? { minHeight: u(live.minHeight ?? 0) } : { height: `${h * 100}%` }),
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: JUSTIFY[live.verticalAlign],
    paddingTop: u(live.padding.top),
    paddingRight: u(live.padding.right),
    paddingBottom: u(live.padding.bottom),
    paddingLeft: u(live.padding.left),
    background: textOnly ? 'transparent' : (live.fill ?? 'transparent'),
  };
}
