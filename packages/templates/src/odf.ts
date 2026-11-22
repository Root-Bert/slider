import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  LAYOUT_NAMES,
  PAGE,
  type Box,
  type Fade,
  type Fill,
  type FillLike,
  type Layout,
  type Picture,
  type Shadow,
  type Shape,
  type Slot,
  type Stop,
  type Stroke,
  type Template,
  type TextLook,
} from './model';

/*
 * Writes a template as OpenDocument: every layout a master page of its own (as a template
 * designed in Slider has them), its placeholders bound to common presentation styles
 * (`<master>-title` …, shown as `<layout>-title` – LibreOffice finds them by what the master is
 * shown as), the palette as the first master's theme, pictures where pictures go as Slider's own
 * mark. Nothing here is left to LibreOffice's defaults: a property left out draws blue.
 */

const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
const OTP_MIME = 'application/vnd.oasis.opendocument.presentation-template';

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"',
  'xmlns:slider="urn:slider:odp:1"',
  'office:version="1.3"',
].join(' ');

const esc = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );
const round = (n: number, digits = 3) => Number(n.toFixed(digits));
const cm = (n: number) => `${round(n)}cm`;
const percent = (n: number) => `${round(Math.min(1, Math.max(0, n)) * 100, 1)}%`;

type Attrs = Record<string, string | undefined>;
const attrs = (map: Attrs) =>
  Object.entries(map)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => ` ${key}="${esc(value)}"`)
    .join('');
const tag = (name: string, map: Attrs, inner = '') =>
  inner ? `<${name}${attrs(map)}>${inner}</${name}>` : `<${name}${attrs(map)}/>`;

const SERIF =
  /Serif|Garamond|Playfair|Lora|Merriweather|Baskerville|Bitter|Slab|Arvo|Spectral|Alegreya|Vollkorn|Literata|Fraunces|Newsreader|Frank Ruhl|Abril|Cinzel|Crimson|Caladea/;
const MONO = /Mono|Code|Inconsolata/;

/** `CamelCase` of a slug: style names with no `_` (LibreOffice reads `_xx_` as a character). */
export const prefixOf = (slug: string) =>
  slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** What a file's styles.xml gathers while its shapes are written. */
class Sheet {
  readonly fonts = new Set<string>();
  readonly pictures = new Map<string, { path: string; picture: Picture }>();
  private readonly named: string[] = [];
  private readonly automatic: string[] = [];
  private readonly keys = new Map<string, string>();
  private count = 0;

  constructor(readonly prefix: string) {}

  /** A named piece of office:styles (gradient, hatch, dash, opacity), each written once. */
  private define(kind: string, write: (name: string) => string): string {
    const key = `${kind}:${write('')}`;
    const kept = this.keys.get(key);
    if (kept) return kept;
    const name = `${this.prefix}${kind}${(this.count += 1)}`;
    this.named.push(write(name));
    this.keys.set(key, name);
    return name;
  }

  /** An automatic style of styles.xml, each look once. */
  style(family: 'graphic' | 'paragraph' | 'drawing-page', inner: string): string {
    const key = `${family}:${inner}`;
    const kept = this.keys.get(key);
    if (kept) return kept;
    const letter = { graphic: 'G', paragraph: 'P', 'drawing-page': 'D' }[family];
    const name = `${this.prefix}${letter}${(this.count += 1)}`;
    this.automatic.push(tag('style:style', { 'style:name': name, 'style:family': family }, inner));
    this.keys.set(key, name);
    return name;
  }

  picture(picture: Picture): string {
    const hash = createHash('sha256').update(picture.bytes).digest('hex').slice(0, 20);
    const kept = this.pictures.get(hash);
    if (kept) return kept.path;
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[
      picture.mime
    ];
    const path = `Pictures/${hash}.${extension}`;
    this.pictures.set(hash, { path, picture });
    return path;
  }

  /**
   * LibreOffice's linear gradient: at 0° its first colour is at the top, the angle turning
   * counter-clockwise. Ours: the direction the stops run to, clockwise from up (CSS).
   */
  private axis(angle: number): string {
    return `${round((((180 - angle) % 360) + 360) % 360, 2)}deg`;
  }

  private gradient(
    style: 'linear' | 'radial',
    stops: readonly Stop[],
    angle: number,
    centre: readonly [number, number],
  ): string {
    // A radial one is written from the rim inwards.
    const ordered =
      style === 'radial'
        ? [...stops].reverse().map(([offset, color]) => [1 - offset, color] as const)
        : stops;
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    return this.define('Grad', (name) =>
      tag(
        'draw:gradient',
        {
          'draw:name': name,
          'draw:style': style,
          ...(style === 'radial'
            ? { 'draw:cx': percent(centre[0]), 'draw:cy': percent(centre[1]) }
            : { 'draw:angle': this.axis(angle) }),
          'draw:start-color': first[1],
          'draw:end-color': last[1],
          'draw:start-intensity': '100%',
          'draw:end-intensity': '100%',
          'draw:border': '0%',
        },
        ordered
          .map(([offset, color]) =>
            tag('loext:gradient-stop', {
              'svg:offset': String(round(offset, 4)),
              'loext:color-type': 'rgb',
              'loext:color-value': color,
            }),
          )
          .join(''),
      ),
    );
  }

  private fade(fade: Fade): string {
    return this.define('Fade', (name) =>
      tag('draw:opacity', {
        'draw:name': name,
        'draw:style': 'linear',
        'draw:angle': this.axis(fade.angle ?? 90),
        'draw:start': percent(fade.from),
        'draw:end': percent(fade.to),
        'draw:border': '0%',
      }),
    );
  }

  fill(fill: FillLike | undefined): Attrs {
    if (fill === null || fill === undefined) return { 'draw:fill': 'none' };
    const value: Fill = typeof fill === 'string' ? { t: 'solid', color: fill } : fill;
    switch (value.t) {
      case 'solid':
        return {
          'draw:fill': 'solid',
          'draw:fill-color': value.color,
          ...(value.opacity !== undefined ? { 'draw:opacity': percent(value.opacity) } : {}),
          ...(value.fade ? { 'draw:opacity-name': this.fade(value.fade) } : {}),
        };
      case 'linear':
      case 'radial':
        return {
          'draw:fill': 'gradient',
          'draw:fill-color': value.stops[0]![1],
          'draw:fill-gradient-name':
            value.t === 'linear'
              ? this.gradient('linear', value.stops, value.angle ?? 90, [0.5, 0.5])
              : this.gradient('radial', value.stops, 0, [value.cx ?? 0.5, value.cy ?? 0.5]),
          'draw:gradient-step-count': '0',
          ...(value.opacity !== undefined ? { 'draw:opacity': percent(value.opacity) } : {}),
          ...(value.t === 'linear' && value.fade
            ? { 'draw:opacity-name': this.fade(value.fade) }
            : {}),
        };
      case 'hatch':
        return {
          'draw:fill': 'hatch',
          'draw:fill-hatch-name': this.define('Hatch', (name) =>
            tag('draw:hatch', {
              'draw:name': name,
              'draw:style': value.style ?? 'single',
              'draw:color': value.color,
              'draw:distance': cm(value.distance),
              'draw:rotation': String(Math.round((value.angle ?? 45) * 10)),
            }),
          ),
          ...(value.bg
            ? { 'draw:fill-hatch-solid': 'true', 'draw:fill-color': value.bg }
            : { 'draw:fill-hatch-solid': 'false' }),
        };
    }
  }

  stroke(stroke: Stroke | null | undefined): Attrs {
    if (!stroke) return { 'draw:stroke': 'none' };
    const dash = stroke.dash;
    return {
      'draw:stroke': dash ? 'dash' : 'solid',
      ...(dash
        ? {
            'draw:stroke-dash': this.define('Dash', (name) =>
              tag('draw:stroke-dash', {
                'draw:name': name,
                'draw:style': stroke.cap === 'round' ? 'round' : 'rect',
                'draw:dots1': '1',
                'draw:dots1-length': cm(dash[0]),
                'draw:distance': cm(dash[1]),
              }),
            ),
          }
        : {}),
      'svg:stroke-width': cm(stroke.width),
      'svg:stroke-color': stroke.color,
      'svg:stroke-linecap': stroke.cap ?? 'butt',
      'draw:stroke-linejoin': stroke.join ?? 'miter',
      ...(stroke.opacity !== undefined ? { 'svg:stroke-opacity': percent(stroke.opacity) } : {}),
    };
  }

  shadow(shadow: Shadow | undefined): Attrs {
    if (!shadow) return { 'draw:shadow': 'hidden' };
    return {
      'draw:shadow': 'visible',
      'draw:shadow-offset-x': cm(shadow.dx),
      'draw:shadow-offset-y': cm(shadow.dy),
      'draw:shadow-color': shadow.color ?? '#000000',
      'draw:shadow-opacity': percent(shadow.opacity ?? 0.3),
      ...(shadow.blur ? { 'loext:shadow-blur': cm(shadow.blur) } : {}),
    };
  }

  text(look: TextLook): Attrs {
    if (look.font) this.fonts.add(look.font);
    const size = look.size !== undefined ? `${round(look.size, 1)}pt` : undefined;
    return {
      ...(look.font ? { 'style:font-name': look.font, 'fo:font-family': `'${look.font}'` } : {}),
      'fo:font-size': size,
      'style:font-size-asian': size,
      'style:font-size-complex': size,
      'fo:color': look.color,
      'fo:font-weight': look.bold === undefined ? undefined : look.bold ? 'bold' : 'normal',
      'fo:font-style': look.italic === undefined ? undefined : look.italic ? 'italic' : 'normal',
      'fo:letter-spacing': look.spacing !== undefined ? `${round(look.spacing, 2)}pt` : undefined,
      'fo:text-transform': look.upper === undefined ? undefined : look.upper ? 'uppercase' : 'none',
      ...(look.underline
        ? {
            'style:text-underline-style': 'solid',
            'style:text-underline-width': 'auto',
            'style:text-underline-color': 'font-color',
          }
        : {}),
      'style:letter-kerning': 'true',
    };
  }

  paragraph(look: TextLook): Attrs {
    return {
      'fo:text-align': { left: 'start', center: 'center', right: 'end' }[look.align ?? 'left'],
      'fo:line-height': `${look.lineHeight ?? 110}%`,
      'fo:margin-left': '0cm',
      'fo:margin-right': '0cm',
      'fo:margin-top': '0cm',
      // Space between paragraphs only in text standing at the top: LibreOffice counts the last
      // paragraph's space into the height it centres or sets on the bottom, Slider's editor
      // does not (measured with live-parity: 4–6 % of the box off).
      'fo:margin-bottom': cm((look.valign ?? 'top') === 'top' ? (look.paraSpace ?? 0) : 0),
      'fo:text-indent': '0cm',
    };
  }

  /** How a box holds its text: padding, where it stands, no growing with it. */
  textBox(look: TextLook, wrap = true): Attrs {
    const pad = look.pad ?? 0;
    const [top, right, bottom, left] = typeof pad === 'number' ? [pad, pad, pad, pad] : pad;
    return {
      'fo:padding-top': cm(top),
      'fo:padding-right': cm(right),
      'fo:padding-bottom': cm(bottom),
      'fo:padding-left': cm(left),
      'draw:textarea-vertical-align': look.valign ?? 'top',
      'draw:textarea-horizontal-align': 'justify',
      'draw:auto-grow-height': 'false',
      'draw:auto-grow-width': 'false',
      'fo:wrap-option': wrap ? 'wrap' : 'no-wrap',
    };
  }

  stylesXml(template: Template, masters: string, common: string, pageStyles: string): string {
    const fonts = [...this.fonts]
      .sort()
      .map((font) =>
        tag('style:font-face', {
          'style:name': font,
          'svg:font-family': `'${font}'`,
          'style:font-family-generic': MONO.test(font)
            ? 'modern'
            : SERIF.test(font)
              ? 'roman'
              : 'swiss',
          'style:font-pitch': MONO.test(font) ? 'fixed' : 'variable',
        }),
      )
      .join('');
    const { palette, fonts: faces } = template;
    const base = this.text({ font: faces.body, size: 18, color: palette.text });
    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS}><office:font-face-decls>${fonts}</office:font-face-decls><office:styles>${this.named.join('')}${tag(
      'style:default-style',
      { 'style:family': 'graphic' },
      tag('style:graphic-properties', {
        'svg:stroke-color': palette.text,
        'draw:fill-color': palette.accents[0],
        'fo:wrap-option': 'no-wrap',
      }) +
        tag('style:paragraph-properties', { 'style:writing-mode': 'lr-tb' }) +
        tag('style:text-properties', { ...base, 'fo:language': 'de', 'fo:country': 'DE' }),
    )}${tag(
      'style:style',
      { 'style:name': 'standard', 'style:family': 'graphic' },
      // What a new box of a deck on this template starts from: the body face, the text colour,
      // a shape filled in the first accent – with LibreOffice's own padding (see blank.ts).
      tag('style:graphic-properties', {
        'draw:stroke': 'none',
        'svg:stroke-color': palette.text,
        'draw:fill': 'solid',
        'draw:fill-color': palette.accents[0],
        'draw:textarea-horizontal-align': 'justify',
        'fo:padding-top': '0.125cm',
        'fo:padding-bottom': '0.125cm',
        'fo:padding-left': '0.25cm',
        'fo:padding-right': '0.25cm',
        'fo:wrap-option': 'wrap',
        'draw:shadow': 'hidden',
      }) +
        tag('style:paragraph-properties', {
          'fo:margin-left': '0cm',
          'fo:margin-right': '0cm',
          'fo:margin-top': '0cm',
          'fo:margin-bottom': '0cm',
          'fo:line-height': '100%',
          'fo:text-indent': '0cm',
        }) +
        tag('style:text-properties', base),
    )}${common}</office:styles><office:automatic-styles>${tag(
      'style:page-layout',
      { 'style:name': `${this.prefix}PM` },
      tag('style:page-layout-properties', {
        'fo:margin-top': '0cm',
        'fo:margin-bottom': '0cm',
        'fo:margin-left': '0cm',
        'fo:margin-right': '0cm',
        'fo:page-width': cm(PAGE.w),
        'fo:page-height': cm(PAGE.h),
        'style:print-orientation': 'landscape',
      }),
    )}${pageStyles}${this.automatic.join('')}</office:automatic-styles><office:master-styles><draw:layer-set><draw:layer draw:name="layout"/><draw:layer draw:name="background"/><draw:layer draw:name="backgroundobjects"/><draw:layer draw:name="controls"/><draw:layer draw:name="measurelines"/></draw:layer-set>${masters}</office:master-styles></office:document-styles>`;
  }
}

/** Where a box of that size, turned `degrees` clockwise round its centre, is written. */
function placed(box: Box, degrees: number | undefined): Attrs {
  const size = { 'svg:width': cm(box.w), 'svg:height': cm(box.h) };
  if (!degrees) return { ...size, 'svg:x': cm(box.x), 'svg:y': cm(box.y) };
  // ODF turns counter-clockwise round the origin, then moves.
  const angle = (-degrees * Math.PI) / 180;
  const [cx, cy] = [box.w / 2, box.h / 2];
  const turnedX = cx * Math.cos(angle) + cy * Math.sin(angle);
  const turnedY = -cx * Math.sin(angle) + cy * Math.cos(angle);
  return {
    ...size,
    'draw:transform': `rotate (${round(angle, 6)}) translate (${cm(box.x + cx - turnedX)} ${cm(box.y + cy - turnedY)})`,
  };
}

/**
 * The box an SVG path covers, in its own units – curves and arcs walked in small steps.
 * LibreOffice puts a path's own bounds at the frame's corner, wherever in its view box it
 * lies, so a path is written with the frame of exactly what it draws.
 */
export function pathBounds(d: string): { x: number; y: number; w: number; h: number } | null {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  let [x, y, startX, startY, lastX, lastY] = [0, 0, 0, 0, 0, 0];
  let index = 0;
  let command = '';
  let before = '';
  const number = () => Number(tokens[index++]);
  const STEPS = 32;
  const cubic = (p: readonly number[]) => {
    for (let step = 1; step <= STEPS; step += 1) {
      const t = step / STEPS;
      const u = 1 - t;
      see(
        u * u * u * x + 3 * u * u * t * p[0]! + 3 * u * t * t * p[2]! + t * t * t * p[4]!,
        u * u * u * y + 3 * u * u * t * p[1]! + 3 * u * t * t * p[3]! + t * t * t * p[5]!,
      );
    }
    [lastX, lastY, x, y] = [p[2]!, p[3]!, p[4]!, p[5]!];
  };
  const quadratic = (p: readonly number[]) => {
    for (let step = 1; step <= STEPS; step += 1) {
      const t = step / STEPS;
      const u = 1 - t;
      see(
        u * u * x + 2 * u * t * p[0]! + t * t * p[2]!,
        u * u * y + 2 * u * t * p[1]! + t * t * p[3]!,
      );
    }
    [lastX, lastY, x, y] = [p[0]!, p[1]!, p[2]!, p[3]!];
  };
  const arc = (p: readonly number[]) => {
    let [rx, ry] = [Math.abs(p[0]!), Math.abs(p[1]!)];
    const [phi, large, sweep, toX, toY] = [(p[2]! * Math.PI) / 180, p[3]!, p[4]!, p[5]!, p[6]!];
    if (rx === 0 || ry === 0 || (toX === x && toY === y)) {
      see(toX, toY);
      [x, y] = [toX, toY];
      return;
    }
    const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
    const [dx, dy] = [(x - toX) / 2, (y - toY) / 2];
    const [px, py] = [cos * dx + sin * dy, -sin * dx + cos * dy];
    const scale = Math.sqrt((px * px) / (rx * rx) + (py * py) / (ry * ry));
    if (scale > 1) [rx, ry] = [rx * scale, ry * scale];
    const under = rx * rx * py * py + ry * ry * px * px;
    const factor =
      (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - under) / under));
    const [cxp, cyp] = [(factor * rx * py) / ry, (-factor * ry * px) / rx];
    const [cx, cy] = [cos * cxp - sin * cyp + (x + toX) / 2, sin * cxp + cos * cyp + (y + toY) / 2];
    const from = Math.atan2((py - cyp) / ry, (px - cxp) / rx);
    let delta = Math.atan2((-py - cyp) / ry, (-px - cxp) / rx) - from;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    for (let step = 1; step <= STEPS * 2; step += 1) {
      const angle = from + (delta * step) / (STEPS * 2);
      const [ex, ey] = [rx * Math.cos(angle), ry * Math.sin(angle)];
      see(cx + cos * ex - sin * ey, cy + sin * ex + cos * ey);
    }
    [x, y] = [toX, toY];
  };
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index]!)) command = tokens[index++]!;
    else if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
    else if (command === '') return null;
    const relative = command === command.toLowerCase();
    const [ox, oy] = relative ? [x, y] : [0, 0];
    const take = (count: number) =>
      Array.from({ length: count }, (_, at) => number() + (at % 2 === 0 ? ox : oy));
    const upper = command.toUpperCase();
    switch (upper) {
      case 'M':
        [x, y] = take(2) as [number, number];
        [startX, startY] = [x, y];
        see(x, y);
        break;
      case 'L':
        [x, y] = take(2) as [number, number];
        see(x, y);
        break;
      case 'H':
        x = number() + ox;
        see(x, y);
        break;
      case 'V':
        y = number() + oy;
        see(x, y);
        break;
      case 'C':
        cubic(take(6));
        break;
      case 'S': {
        const smooth = 'CS'.includes(before) ? [2 * x - lastX, 2 * y - lastY] : [x, y];
        cubic([...smooth, ...take(4)]);
        break;
      }
      case 'Q':
        quadratic(take(4));
        break;
      case 'T': {
        const smooth = 'QT'.includes(before) ? [2 * x - lastX, 2 * y - lastY] : [x, y];
        quadratic([...smooth, ...take(2)]);
        break;
      }
      case 'A': {
        const p = [number(), number(), number(), number(), number()];
        arc([...p, number() + ox, number() + oy]);
        break;
      }
      case 'Z':
        [x, y] = [startX, startY];
        break;
      default:
        return null;
    }
    before = upper;
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

const paragraphs = (text: string | readonly string[]) =>
  typeof text === 'string' ? text.split('\n') : text;

function shapeXml(sheet: Sheet, shape: Shape): string {
  const layer = { 'draw:layer': 'backgroundobjects' };
  const graphic = (extra: Attrs = {}) =>
    sheet.style(
      'graphic',
      tag('style:graphic-properties', {
        ...sheet.fill('fill' in shape ? shape.fill : null),
        ...sheet.stroke(shape.stroke),
        ...sheet.shadow('shadow' in shape ? shape.shadow : undefined),
        ...extra,
      }),
    );
  switch (shape.t) {
    case 'rect':
      return tag('draw:rect', {
        'draw:style-name': graphic(),
        ...layer,
        ...placed(shape, shape.rotate),
        ...(shape.r ? { 'draw:corner-radius': cm(shape.r) } : {}),
      });
    case 'ellipse':
      return tag('draw:ellipse', {
        'draw:style-name': graphic(),
        ...layer,
        ...placed(shape, shape.rotate),
        ...(shape.kind
          ? {
              'draw:kind': shape.kind,
              'draw:start-angle': String(shape.start ?? 0),
              'draw:end-angle': String(shape.end ?? 90),
            }
          : {}),
      });
    case 'poly': {
      const xs = shape.pts.map(([x]) => x);
      const ys = shape.pts.map(([, y]) => y);
      const [left, top] = [Math.min(...xs), Math.min(...ys)];
      const [width, height] = [Math.max(...xs) - left, Math.max(...ys) - top];
      const unit = (n: number) => Math.round(n * 1000);
      return tag('draw:polygon', {
        'draw:style-name': graphic(),
        ...layer,
        'svg:x': cm(left),
        'svg:y': cm(top),
        'svg:width': cm(Math.max(width, 0.001)),
        'svg:height': cm(Math.max(height, 0.001)),
        'svg:viewBox': `0 0 ${Math.max(unit(width), 1)} ${Math.max(unit(height), 1)}`,
        'draw:points': shape.pts.map(([x, y]) => `${unit(x - left)},${unit(y - top)}`).join(' '),
      });
    }
    case 'path': {
      // The frame of what the path draws, turned with the box it was given.
      const drawn = pathBounds(shape.d) ?? { x: 0, y: 0, w: shape.vb[0], h: shape.vb[1] };
      const [sx, sy] = [shape.w / shape.vb[0], shape.h / shape.vb[1]];
      const own = { w: Math.max(drawn.w * sx, 0.001), h: Math.max(drawn.h * sy, 0.001) };
      const angle = ((shape.rotate ?? 0) * Math.PI) / 180;
      const [dx, dy] = [
        drawn.x * sx + own.w / 2 - shape.w / 2,
        drawn.y * sy + own.h / 2 - shape.h / 2,
      ];
      const cx = shape.x + shape.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle);
      const cy = shape.y + shape.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle);
      return tag('draw:path', {
        'draw:style-name': graphic(),
        ...layer,
        ...placed({ x: cx - own.w / 2, y: cy - own.h / 2, ...own }, shape.rotate),
        'svg:viewBox': `${round(drawn.x, 4)} ${round(drawn.y, 4)} ${round(Math.max(drawn.w, 0.0001), 4)} ${round(Math.max(drawn.h, 0.0001), 4)}`,
        'svg:d': shape.d,
      });
    }
    case 'line':
      return tag('draw:line', {
        'draw:style-name': graphic(),
        ...layer,
        'svg:x1': cm(shape.x1),
        'svg:y1': cm(shape.y1),
        'svg:x2': cm(shape.x2),
        'svg:y2': cm(shape.y2),
      });
    case 'text': {
      const paragraph = sheet.style(
        'paragraph',
        tag('style:paragraph-properties', sheet.paragraph(shape)) +
          tag('style:text-properties', sheet.text(shape)),
      );
      return tag(
        'draw:frame',
        {
          'draw:style-name': graphic(sheet.textBox(shape, !shape.nowrap)),
          'draw:text-style-name': paragraph,
          ...layer,
          ...placed(shape, shape.rotate),
        },
        tag(
          'draw:text-box',
          {},
          paragraphs(shape.text)
            .map((line) => tag('text:p', { 'text:style-name': paragraph }, esc(line) || ' '))
            .join(''),
        ),
      );
    }
    case 'image':
      return tag(
        'draw:frame',
        { 'draw:style-name': graphic(), ...layer, ...placed(shape, shape.rotate) },
        tag('draw:image', {
          'xlink:href': sheet.picture(shape.src),
          'xlink:type': 'simple',
          'xlink:show': 'embed',
          'xlink:actuate': 'onLoad',
          'draw:mime-type': shape.src.mime,
        }),
      );
  }
}

type SlotKind = 'title' | 'subtitle' | 'outline';

/** A layout's text placeholders, one or several. */
const bodies = (layout: Layout): readonly Slot[] =>
  layout.body === undefined
    ? []
    : Array.isArray(layout.body)
      ? (layout.body as readonly Slot[])
      : [layout.body as Slot];
const STYLE_SUFFIX = { title: 'title', subtitle: 'subtitle', outline: 'outline1' } as const;
const PROMPTS = { title: 'Titel', subtitle: 'Untertitel', outline: 'Text' } as const;

/** A placeholder's whole look – LibreOffice takes nothing else for it. */
function slotStyle(
  sheet: Sheet,
  template: Template,
  kind: SlotKind,
  slot: Slot,
  name: string,
  shown: string | null,
  parent?: string,
): string {
  const look: Slot = {
    valign: kind === 'title' ? 'bottom' : 'top',
    ...template.text[kind === 'outline' ? 'body' : kind],
    ...slot,
  };
  const size = look.size ?? 18;
  return tag(
    'style:style',
    {
      'style:name': name,
      ...(shown ? { 'style:display-name': shown } : {}),
      'style:family': 'presentation',
      ...(parent ? { 'style:parent-style-name': parent } : {}),
    },
    tag('style:graphic-properties', {
      ...sheet.fill(look.fill),
      ...sheet.stroke(look.stroke),
      ...sheet.shadow(look.shadow),
      ...sheet.textBox(look),
    }) +
      tag('style:paragraph-properties', sheet.paragraph(look)) +
      tag('style:text-properties', sheet.text({ bold: false, italic: false, ...look, size })),
  );
}

/** What the preview shows in a placeholder left without a sample. */
const SAMPLES = {
  title: 'Eine klare Aussage als Titel',
  subtitle: 'Untertitel, der einordnet',
  outline: [
    'Ein erster Gedanke, kurz gefasst',
    'Ein zweiter, der darauf aufbaut',
    'Und ein dritter als Abschluss',
  ],
} as const;

interface Written {
  styles: string;
  /** The preview's slides, one per layout. */
  slides: string;
  /** The picture places of the preview, in order of appearance, for their pictures' sizes. */
  pictureBoxes: Box[];
  pictures: Sheet['pictures'];
  firstMaster: string;
}

function write(template: Template, samplePath: (index: number) => string): Written {
  const prefix = prefixOf(template.slug);
  const sheet = new Sheet(prefix);
  sheet.fonts.add(template.fonts.head);
  sheet.fonts.add(template.fonts.body);
  const { palette } = template;
  const theme = tag(
    'loext:theme',
    { 'loext:name': template.name },
    tag(
      'loext:theme-colors',
      { 'loext:name': template.name },
      [
        ['dark1', palette.text],
        ['light1', palette.bg],
        ['dark2', palette.text2],
        ['light2', palette.bg2],
        ...palette.accents.map((color, index) => [`accent${index + 1}`, color] as const),
        ['hyperlink', palette.accents[0]],
        ['followed-hyperlink', palette.accents[1]],
      ]
        .map(([name, color]) => tag('loext:color', { 'loext:name': name, 'loext:color': color }))
        .join(''),
    ),
  );

  const masters: string[] = [];
  const common: string[] = [];
  const pageStyles: string[] = [];
  const slides: string[] = [];
  const pictureBoxes: Box[] = [];
  const names = template.layouts.map((layout) => layout.name);

  template.layouts.forEach((layout, index) => {
    const master = `${prefix}${index + 1}`;
    const bound = names.indexOf(layout.name) === names.lastIndexOf(layout.name);
    const pageStyle = `${prefix}Page${index + 1}`;
    pageStyles.push(
      tag(
        'style:style',
        { 'style:name': pageStyle, 'style:family': 'drawing-page' },
        tag('style:drawing-page-properties', {
          'draw:background-size': 'full',
          ...sheet.fill(layout.bg ?? palette.bg),
        }),
      ),
    );
    const decoration = (layout.shapes ?? []).map((shape) => shapeXml(sheet, shape)).join('');

    const holders: string[] = [];
    const filled: string[] = [];
    const seen = new Set<SlotKind>();
    const slots: [SlotKind, Slot][] = [
      ...(layout.title ? [['title', layout.title] as [SlotKind, Slot]] : []),
      ...(layout.subtitle ? [['subtitle', layout.subtitle] as [SlotKind, Slot]] : []),
      ...bodies(layout).map((slot) => ['outline', slot] as [SlotKind, Slot]),
    ];
    for (const [kind, slot] of slots) {
      const suffix = STYLE_SUFFIX[kind];
      const shared = `${master}-${suffix}`;
      let style = shared;
      if (!seen.has(kind)) {
        seen.add(kind);
        common.push(
          slotStyle(sheet, template, kind, slot, shared, bound ? `${layout.name}-${suffix}` : null),
        );
        if (kind === 'outline') {
          // The deeper levels of an outline, each a little smaller, as LibreOffice names them.
          for (let level = 2; level <= 9; level += 1) {
            common.push(
              tag(
                'style:style',
                {
                  'style:name': `${master}-outline${level}`,
                  ...(bound ? { 'style:display-name': `${layout.name}-outline${level}` } : {}),
                  'style:family': 'presentation',
                  'style:parent-style-name': `${master}-outline${level - 1}`,
                },
                level <= 3
                  ? tag('style:text-properties', {
                      'fo:font-size': `${round(
                        (slot.size ?? template.text.body.size ?? 18) * (level === 2 ? 0.9 : 0.8),
                        1,
                      )}pt`,
                    })
                  : '',
              ),
            );
          }
        }
      } else {
        // A further one of its kind: its own look over the layout's, as Slider writes it.
        style = `${master}${kind}${holders.length + 1}`;
        common.push(slotStyle(sheet, template, kind, slot, style, null));
      }
      const box = {
        'svg:x': cm(slot.x),
        'svg:y': cm(slot.y),
        'svg:width': cm(slot.w),
        'svg:height': cm(slot.h),
      };
      holders.push(
        tag(
          'draw:frame',
          {
            'presentation:style-name': style,
            'draw:layer': 'backgroundobjects',
            ...box,
            'presentation:class': kind,
            'slider:prompt': 'true',
          },
          tag('draw:text-box', {}, tag('text:p', {}, esc(slot.prompt ?? PROMPTS[kind]))),
        ),
      );
      const sample = slot.sample ?? SAMPLES[kind];
      filled.push(
        tag(
          'draw:frame',
          {
            'presentation:style-name': style,
            'draw:layer': 'layout',
            ...box,
            'presentation:class': kind,
            'presentation:user-transformed': 'true',
          },
          tag(
            'draw:text-box',
            {},
            typeof sample === 'string'
              ? sample
                  .split('\n')
                  .map((line) => tag('text:p', {}, esc(line)))
                  .join('')
              : tag(
                  'text:list',
                  { 'text:style-name': 'SL' },
                  sample
                    .map((line) => tag('text:list-item', {}, tag('text:p', {}, esc(line))))
                    .join(''),
                ),
          ),
        ),
      );
    }
    for (const box of layout.pictures ?? []) {
      const place = {
        'svg:x': cm(box.x),
        'svg:y': cm(box.y),
        'svg:width': cm(box.w),
        'svg:height': cm(box.h),
      };
      holders.push(tag('slider:picture-placeholder', place));
      filled.push(
        tag(
          'draw:frame',
          { 'draw:style-name': 'pic', 'draw:layer': 'layout', ...place },
          tag('draw:image', {
            'xlink:href': samplePath(pictureBoxes.length),
            'xlink:type': 'simple',
            'xlink:show': 'embed',
            'xlink:actuate': 'onLoad',
          }),
        ),
      );
      pictureBoxes.push(box);
    }

    masters.push(
      tag(
        'style:master-page',
        {
          'style:name': master,
          'style:display-name': layout.name,
          'style:page-layout-name': `${prefix}PM`,
          'draw:style-name': pageStyle,
        },
        (index === 0 ? theme : '') + decoration + holders.join(''),
      ),
    );
    slides.push(
      tag(
        'draw:page',
        {
          'draw:name': layout.name,
          'draw:style-name': 'dp1',
          'draw:master-page-name': master,
        },
        filled.join(''),
      ),
    );
  });

  return {
    styles: sheet.stylesXml(template, masters.join(''), common.join(''), pageStyles.join('')),
    slides: slides.join(''),
    pictureBoxes,
    pictures: sheet.pictures,
    firstMaster: `${prefix}1`,
  };
}

/*
 * The preview's lists, as Slider writes a list (live-write.ts `newListStyle`): a list style of
 * its own. A presentation style's own bullets are not written – LibreOffice gives a list without
 * a named style its default bullet whatever the placeholder's style says, while Slider's editor
 * would draw the style's.
 */
const SAMPLE_LIST = tag(
  'text:list-style',
  { 'style:name': 'SL' },
  Array.from({ length: 9 }, (_, index) =>
    tag(
      'text:list-level-style-bullet',
      {
        'text:level': String(index + 1),
        'text:bullet-char': index % 2 === 0 ? '•' : '–',
        'text:bullet-relative-size': '100%',
      },
      tag('style:list-level-properties', {
        'text:space-before': `${index * 27}pt`,
        'text:min-label-width': '27pt',
      }) + tag('style:text-properties', { 'fo:font-size': '100%' }),
    ),
  ).join(''),
);

const contentXml = (pages: string) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS}><office:automatic-styles><style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties presentation:display-header="false" presentation:display-footer="false" presentation:display-page-number="false" presentation:display-date-time="false"/></style:style><style:style style:name="pic" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none" draw:shadow="hidden"/></style:style>${SAMPLE_LIST}</office:automatic-styles><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`;

const metaXml = (template: Template) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NS}><office:meta><meta:generator>Slider</meta:generator><dc:title>${esc(template.name)}</dc:title><dc:description>${esc(template.description)}</dc:description>${template.tags.map((word) => `<meta:keyword>${esc(word)}</meta:keyword>`).join('')}</office:meta></office:document-meta>`;

async function pack(
  mime: string,
  styles: string,
  content: string,
  meta: string,
  pictures: readonly { path: string; picture: Picture }[],
): Promise<Uint8Array> {
  const zip = new JSZip();
  // Everything dated alike: the same spec gives the same file.
  const date = new Date('2026-01-01T00:00:00Z');
  zip.file('mimetype', mime, { compression: 'STORE', date });
  zip.file(
    'META-INF/manifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pictures
      .map(
        ({ path, picture }) =>
          `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${picture.mime}"/>`,
      )
      .join('')}</manifest:manifest>`,
    { date },
  );
  zip.file('styles.xml', styles, { date });
  zip.file('content.xml', content, { date });
  zip.file('meta.xml', meta, { date });
  for (const { path, picture } of pictures) {
    // Pictures are packed already.
    zip.file(path, picture.bytes, { compression: 'STORE', date });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: mime });
}

/** What is wrong with a spec, in words; empty when it can be written. */
/** What of a text's look its paragraphs and letters carry (not the box: valign, pad). */
const TEXT_KEYS = [
  'font',
  'size',
  'color',
  'bold',
  'italic',
  'align',
  'upper',
  'spacing',
  'lineHeight',
  'underline',
  'paraSpace',
] as const;

export function problems(template: Template, fonts: ReadonlySet<string>): string[] {
  const found: string[] = [];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(template.slug)) found.push(`slug „${template.slug}“`);
  const names = template.layouts.map((layout) => layout.name);
  LAYOUT_NAMES.forEach((name, index) => {
    if (names[index] !== name) found.push(`layout ${index + 1} is not „${name}“`);
  });
  if (new Set(names).size !== names.length) found.push('two layouts of one name');
  const hex = /^#[0-9a-f]{6}$/;
  const colors = [
    template.palette.bg,
    template.palette.text,
    template.palette.bg2,
    template.palette.text2,
    ...template.palette.accents,
  ];
  for (const color of colors)
    if (!hex.test(color)) found.push(`colour „${color}“ (lower-case hex)`);
  if (new Set(colors).size !== colors.length) found.push('a palette colour twice');
  const used = new Set<string>([template.fonts.head, template.fonts.body]);
  const inside = (box: Box, what: string) => {
    if (box.w <= 0 || box.h <= 0) found.push(`${what}: no size`);
    if (
      box.x < -0.01 ||
      box.y < -0.01 ||
      box.x + box.w > PAGE.w + 0.01 ||
      box.y + box.h > PAGE.h + 0.01
    )
      found.push(`${what}: outside the page`);
  };
  for (const layout of template.layouts) {
    const slots = [layout.title, layout.subtitle, ...bodies(layout)].filter(
      (slot): slot is Slot => slot !== undefined,
    );
    for (const slot of slots) {
      inside(slot, `${layout.name}: a placeholder`);
      if (slot.font) used.add(slot.font);
    }
    // LibreOffice sets every outline of a page in the first one's text look.
    const [first, ...further] = bodies(layout);
    for (const slot of further)
      for (const key of TEXT_KEYS)
        if (slot[key] !== first![key])
          found.push(
            `${layout.name}: the text boxes differ in „${key}“ (only the first one's is drawn)`,
          );
    for (const box of layout.pictures ?? []) inside(box, `${layout.name}: a picture place`);
    for (const shape of layout.shapes ?? [])
      if (shape.t === 'text' && shape.font) used.add(shape.font);
    if ((layout.shapes ?? []).length > 250) found.push(`${layout.name}: more than 250 shapes`);
  }
  for (const look of Object.values(template.text)) if (look.font) used.add(look.font);
  for (const font of used)
    if (!fonts.has(font)) found.push(`font „${font}“ is not one of Slider's`);
  return found;
}

export interface TemplateFiles {
  /** The template itself (`.otp`): its layouts, one empty slide on the first. */
  template: Uint8Array;
  /** A presentation with one filled slide per layout, for the preview. */
  preview: Uint8Array;
}

/**
 * The template's files. `samplePicture` makes the preview's picture for a place of that shape
 * (the `index`th picture place of the template).
 */
export async function templateFiles(
  template: Template,
  samplePicture: (box: Box, index: number) => Promise<Picture> | Picture,
): Promise<TemplateFiles> {
  const written = write(template, (index) => `Pictures/sample-${index + 1}.jpg`);
  const own = [...written.pictures.values()];
  const samples = await Promise.all(
    written.pictureBoxes.map(async (box, index) => ({
      path: `Pictures/sample-${index + 1}.jpg`,
      picture: await samplePicture(box, index),
    })),
  );
  const meta = metaXml(template);
  return {
    template: await pack(
      OTP_MIME,
      written.styles,
      contentXml(
        tag('draw:page', {
          'draw:name': 'Folie 1',
          'draw:style-name': 'dp1',
          'draw:master-page-name': written.firstMaster,
        }),
      ),
      meta,
      own,
    ),
    preview: await pack(ODP_MIME, written.styles, contentXml(written.slides), meta, [
      ...own,
      ...samples,
    ]),
  };
}
