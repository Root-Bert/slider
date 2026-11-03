import {
  mirroredInset,
  type EditableElement,
  type ElementFlip,
  type ElementLook,
  type ElementShadow,
  type LiveElement,
  type LiveParagraph,
  type LiveTextStyle,
  type Rect,
} from '@slider/shared';
import type { CSSProperties } from 'react';
import { fontCss, metricsFor } from './fonts';
import { elementTransform } from '../tilt/tilt-math';

/*
 * How live elements are drawn, as CSS (the live editor): text laid out the way LibreOffice
 * lays it out, boxes as it places them. Lengths are points of the slide, scaled to the slide
 * box: the layer sets `--pt` (one point in `cqw`) and `--page-h` (the slide's height).
 */

/** Points of the slide as CSS, inside a {@link liveLayerStyle} box. */
export const u = (pt: number) => `calc(${Number(pt.toFixed(3))} * var(--pt))`;

/** The style of the box live elements are drawn in: a container one point is measured by. */
export const liveLayerStyle = (pageWidthPt: number, pageHeightPt: number): CSSProperties =>
  ({
    containerType: 'inline-size',
    '--pt': `calc(100cqw / ${Number(pageWidthPt.toFixed(3))})`,
    '--page-h': `calc(100cqw * ${Number((pageHeightPt / pageWidthPt).toFixed(6))})`,
  }) as CSSProperties;

export const PT_PER_CM = 72 / 2.54;

/** The resolution LibreOffice lays text out at (Impress's printer-independent reference device). */
const LAYOUT_DPI = 600;

/**
 * The size LibreOffice lays a text of `size` pt out in: its height in 1/100 mm, then in whole
 * pixels of its 600 dpi reference device (20 pt → 706 → 167 px = 20.04 pt). Its letters advance
 * by that size (a line of 20 pt is 0.2 % wider than at 20 pt sharp), so the editor draws them in it.
 */
export function layoutSize(size: number): number {
  const px = Math.round((Math.round((size * 2540) / 72) * LAYOUT_DPI) / 2540);
  return (px * 72) / LAYOUT_DPI;
}

/** A length of the font in pt as LibreOffice measures it: in whole pixels of its device. */
const devicePt = (em: number, size: number) =>
  (Math.round((em * layoutSize(size) * LAYOUT_DPI) / 72) * 72) / LAYOUT_DPI;

/**
 * A line of text in `style` as LibreOffice lays it out (editeng): its height and where its
 * baseline sits below its top. A line is ascent + descent high – the font's own, each in whole
 * pixels of the 600 dpi device ({@link layoutSize}), or 1.2 × the size with font-independent
 * spacing (1 above the baseline, 0.2 below). Proportional spacing scales the height; below
 * 100 % the baseline moves up to at most 80 % of the new height, above it all space is added on
 * top. Fixed and minimum heights also add their space on top.
 */
export function lineBox(
  style: LiveTextStyle,
  paragraph: Pick<LiveParagraph, 'lineSpacing' | 'fontIndependent'>,
) {
  const metrics = metricsFor(style.font);
  const ascent = paragraph.fontIndependent ? style.size : devicePt(metrics.ascent, style.size);
  const descent = paragraph.fontIndependent
    ? 0.2 * style.size
    : devicePt(metrics.descent, style.size);
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
 * How far to move a paragraph so its first baseline sits where LibreOffice's does, as CSS.
 * Chrome puts the baseline at the font's ascent below the line's top plus half the leading
 * (line height − ascent − descent), the ascent and descent (the `@font-face` overrides) each
 * rounded to whole pixels and the half leading rounded down (measured, Chromium 2026-11) – up
 * to a pixel higher than worked out unrounded, so that is worked out in CSS the same way.
 */
function baselineShift(style: LiveTextStyle, paragraph: LiveParagraph): string {
  const box = lineBox(style, paragraph);
  const metrics = metricsFor(style.font);
  const size = layoutSize(style.size);
  const px = (em: number) =>
    `round(nearest, calc(${Number((em * size).toFixed(4))} * var(--pt)), 1px)`;
  const ascent = px(metrics.ascent);
  const leading = `round(down, calc((${Number(box.height.toFixed(4))} * var(--pt) - ${ascent} - ${px(metrics.descent)}) / 2), 1px)`;
  return `calc(${Number(box.baseline.toFixed(4))} * var(--pt) - ${ascent} - ${leading})`;
}

/** The letters' colour, see-through as LibreOffice's text transparency. */
export function textColor(style: Pick<LiveTextStyle, 'color' | 'opacity'>): string {
  const opacity = style.opacity ?? 1;
  if (opacity >= 1) return style.color;
  const alpha = Math.round(Math.max(0, opacity) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${style.color}${alpha}`;
}

export function textCss(style: LiveTextStyle, paragraph: LiveParagraph): CSSProperties {
  return {
    fontFamily: fontCss(style.font),
    fontSize: u(layoutSize(style.size)),
    lineHeight: u(lineBox(style, paragraph).height),
    color: textColor(style),
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration:
      [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' ') ||
      'none',
    textTransform: style.caps ?? 'none',
    letterSpacing: style.letterSpacing ? u(style.letterSpacing) : 'normal',
    // LibreOffice kerns where the file says so (`kerning`).
    fontKerning: style.kerning === false ? 'none' : 'normal',
    // The box's letter shadow (if any), as faint as the letters.
    ...(style.opacity !== undefined && style.opacity < 1
      ? {
          textShadow: `var(--letter-shadow-at, 0 0) rgb(var(--letter-shadow-rgb, 0 0 0) / calc(var(--letter-shadow-alpha, 0) * ${Number(style.opacity.toFixed(3))}))`,
        }
      : {}),
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
    top: baselineShift(strut, paragraph),
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
 * The shadow LibreOffice draws on a text's letters: its box's own, when the box is not filled –
 * a filled box casts it itself, its letters none.
 */
export function letterShadow(look: ElementLook | null | undefined): ElementShadow | null {
  const shadow = look?.effects.shadow;
  return shadow && look && !isFilled(look) ? shadow : null;
}

/** Whether LibreOffice fills the box: a colour, or a layer shown. */
export const isFilled = (look: ElementLook) =>
  look.fill !== null || look.fills.some((layer) => layer.visible && layer.opacity > 0);

/**
 * {@link letterShadow} as CSS on the box – its parts as variables too: see-through letters cast
 * a fainter shadow (as in LibreOffice), set by their run ({@link textCss}).
 */
function letterShadowCss(shadow: ElementShadow): CSSProperties {
  const n = Number.parseInt(shadow.color.slice(1), 16);
  const rgb = `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  const alpha = Number(Math.min(1, Math.max(0, shadow.opacity)).toFixed(3));
  const at = `${u(shadow.x)} ${u(shadow.y)} ${u(shadow.blur)}`;
  return {
    textShadow: `${at} rgb(${rgb} / ${alpha})`,
    '--letter-shadow-at': at,
    '--letter-shadow-rgb': rgb,
    '--letter-shadow-alpha': String(alpha),
  } as CSSProperties;
}

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
  // A drawn shape lays its text out in its text area (a hexagon's middle), the padding inside.
  const area = live.textArea && mirroredInset(live.textArea, element.flip);
  const inset = (pt: number, share: number | undefined, of: string) =>
    share ? `calc(${u(pt)} + ${Number(share.toFixed(5))} * ${of})` : u(pt);
  const across = `${w * 100}cqw`;
  const down = `${h} * var(--page-h)`;
  const shadow = letterShadow(element.look);
  return {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    // A box growing with its text is at least as high as in the file – its own height, as
    // LibreOffice takes it (not the one it was drawn at): grown only by more text.
    ...(live.autoGrow ? { minHeight: `${h * 100}%` } : { height: `${h * 100}%` }),
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: JUSTIFY[live.verticalAlign],
    paddingTop: inset(live.padding.top, area?.top, down),
    paddingRight: inset(live.padding.right, area?.right, across),
    paddingBottom: inset(live.padding.bottom, area?.bottom, down),
    paddingLeft: inset(live.padding.left, area?.left, across),
    background: textOnly ? 'transparent' : (live.fill ?? 'transparent'),
    ...(shadow ? letterShadowCss(shadow) : {}),
    // Turned around its centre, as LibreOffice turns it – and tilted in depth as its picture is.
    ...(elementTransform(element.rotation, element.tilt)
      ? { transform: elementTransform(element.rotation, element.tilt) }
      : {}),
  };
}

/** Where an element is: its box before the turn, the turn (degrees clockwise), its mirroring. */
export interface Frame {
  bbox: Rect;
  rotation: number;
  flip?: ElementFlip | null;
}

/**
 * How a picture of an element drawn at `from` shows it at `to` – turned on, and mirrored in the
 * element's own directions (`flip` changed): around the element's centre; `undefined`: as drawn.
 */
export function frameTransform(from: Frame, to: Frame): string | undefined {
  const sx = !!from.flip?.x !== !!to.flip?.x ? -1 : 1;
  const sy = !!from.flip?.y !== !!to.flip?.y ? -1 : 1;
  if (sx === 1 && sy === 1) {
    const turn = to.rotation - from.rotation;
    return turn ? `rotate(${turn}deg)` : undefined;
  }
  return `rotate(${to.rotation}deg) scale(${sx}, ${sy}) rotate(${-from.rotation}deg)`;
}

/**
 * A picture around an element (`box`, drawn where the element was – `from`) where it is now
 * (`to`): moved and stretched with its box, turned and mirrored by what changed since around its
 * centre. A turned element stretches along its own sides, not the slide's: the picture is turned
 * back, stretched and turned on (a turned triangle pulled longer stayed a sliver drawn across).
 */
export function turnedCss(box: Rect, from: Frame, to: Frame): CSSProperties {
  const css = ({ x, y, w, h }: Rect): CSSProperties => ({
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
  });
  if (from.rotation || to.rotation) {
    if (box.w <= 0 || box.h <= 0) return css(box);
    const fx = !!from.flip?.x !== !!to.flip?.x ? -1 : 1;
    const fy = !!from.flip?.y !== !!to.flip?.y ? -1 : 1;
    const sx = (from.bbox.w > 0 ? to.bbox.w / from.bbox.w : 1) * fx;
    const sy = (from.bbox.h > 0 ? to.bbox.h / from.bbox.h : 1) * fy;
    // Centres: around the old one it is turned back and stretched, onto the new one moved.
    const fromX = from.bbox.x + from.bbox.w / 2;
    const fromY = from.bbox.y + from.bbox.h / 2;
    const dx = ((to.bbox.x + to.bbox.w / 2 - fromX) / box.w) * 100;
    const dy = ((to.bbox.y + to.bbox.h / 2 - fromY) / box.h) * 100;
    const parts = [
      dx || dy ? `translate(${dx}%, ${dy}%)` : '',
      to.rotation ? `rotate(${to.rotation}deg)` : '',
      sx !== 1 || sy !== 1 ? `scale(${sx}, ${sy})` : '',
      from.rotation ? `rotate(${-from.rotation}deg)` : '',
    ].filter(Boolean);
    return {
      ...css(box),
      transform: parts.join(' ') || undefined,
      transformOrigin: `${((fromX - box.x) / box.w) * 100}% ${((fromY - box.y) / box.h) * 100}%`,
    };
  }
  const placed = stretched(box, from.bbox, to.bbox);
  const transform = frameTransform(from, to);
  if (!transform || placed.w <= 0 || placed.h <= 0) return css(placed);
  const cx = to.bbox.x + to.bbox.w / 2;
  const cy = to.bbox.y + to.bbox.h / 2;
  return {
    ...css(placed),
    transform,
    transformOrigin: `${((cx - placed.x) / placed.w) * 100}% ${((cy - placed.y) / placed.h) * 100}%`,
  };
}

/** `box` (a picture around an element at `from`) moved and stretched with it to `to`. */
export function stretched(box: Rect, from: Rect, to: Rect): Rect {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  return {
    x: to.x + (box.x - from.x) * sx,
    y: to.y + (box.y - from.y) * sy,
    w: box.w * sx,
    h: box.h * sy,
  };
}
