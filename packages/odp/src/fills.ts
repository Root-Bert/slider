import { createHash } from 'node:crypto';
import {
  fillLayersSchema,
  gradientKindSchema,
  isCentredGradient,
  stopOpacity,
  type FillLayer,
  type GradientStop,
} from '@slider/shared';
import type { Properties, StyleIndex } from './styles';
import { attr, childrenOf, element, removeAttr, setAttr, tagOf, type XmlNode } from './xml';

/*
 * A fill in layers, as a design tool has them. ODF fills a shape with one colour, gradient or
 * picture: a single colour or gradient is written as such; more layers shown, or a picture, as one
 * picture of them all (drawn by the editor), stretched over the shape. The layers themselves go in
 * an attribute of Slider's own on the shape (`slider:fills`), with the fill they were written as –
 * a fill changed elsewhere since (another program, the AI's XML) makes them stale, and the fill is
 * read as the file has it. Pictures of layers live in `Pictures/` like any other.
 */

export const SLIDER_NS = 'urn:slider:odp:1';
const MARK = 'slider:fills';
export const LOEXT_NS = 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0';

/** What a shape's fill is, as far as telling whether it is still the one written. */
function fillKey(props: Properties): string {
  const kind = props['draw:fill'] ?? '';
  const what =
    kind === 'solid'
      ? (props['draw:fill-color'] ?? '').toLowerCase()
      : kind === 'gradient'
        ? (props['draw:fill-gradient-name'] ?? '')
        : kind === 'bitmap'
          ? (props['draw:fill-image-name'] ?? '')
          : '';
  return `${kind}:${what}`;
}

/** Layers as written on a shape: `aspect`, that of their picture (`null`: none). */
export interface FillsMark {
  fills: FillLayer[];
  aspect: number | null;
  /**
   * The backdrop blur (frosted glass, `ElementEffects.backdrop`): `radius` in points, `source`
   * what the fill's picture was baked from (`OdpDocument.backdropWork`) – another one, or `''`,
   * means it is to be baked anew. `radius` 0: none wanted any more, but the picture still holds
   * one – to be baked of the layers alone.
   */
  backdrop?: BackdropMark;
}

export interface BackdropMark {
  radius: number;
  source: string;
}

/** The layers written on the shape, if its fill is still the one they were written as. */
export function readFillsMark(node: XmlNode, props: Properties): FillsMark | null {
  const raw = attr(node, MARK);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      key?: unknown;
      fills?: unknown;
      aspect?: unknown;
      backdrop?: { radius?: unknown; source?: unknown };
    };
    if (data.key !== fillKey(props)) return null;
    const fills = fillLayersSchema.safeParse(data.fills).data;
    if (!fills) return null;
    const aspect = typeof data.aspect === 'number' && data.aspect > 0 ? data.aspect : null;
    const radius = data.backdrop?.radius;
    const backdrop =
      typeof radius === 'number' && radius >= 0 && radius <= 200
        ? { radius, source: typeof data.backdrop?.source === 'string' ? data.backdrop.source : '' }
        : undefined;
    return { fills, aspect, ...(backdrop ? { backdrop } : {}) };
  } catch {
    return null;
  }
}

/** Writes the layers on the shape (`null`: drops them), with the fill `props` they were written as. */
export function writeFillsMark(node: XmlNode, mark: FillsMark | null, props: Properties): void {
  if (!mark) removeAttr(node, MARK);
  else
    setAttr(
      node,
      MARK,
      JSON.stringify({
        key: fillKey(props),
        fills: mark.fills,
        ...(mark.aspect ? { aspect: mark.aspect } : {}),
        ...(mark.backdrop ? { backdrop: mark.backdrop } : {}),
      }),
    );
}

/** The pictures (`Pictures/…`) the layers on a shape show. */
export function fillsMarkPictures(node: XmlNode): string[] {
  const raw = attr(node, MARK);
  if (!raw) return [];
  try {
    const fills = fillLayersSchema.safeParse((JSON.parse(raw) as { fills?: unknown }).fills).data;
    return (fills ?? []).flatMap((layer) =>
      layer.type === 'image' && layer.src.startsWith('Pictures/') ? [layer.src] : [],
    );
  } catch {
    return [];
  }
}

// ── Gradients ────────────────────────────────────────────────────────────

const percent = (value: number) => `${Number((value * 100).toFixed(1))}%`;
const normal = (degrees: number) => ((degrees % 360) + 360) % 360;

/**
 * LibreOffice turns a linear gradient counter-clockwise from running top to bottom; the layer's
 * angle runs as CSS's, clockwise from bottom to top.
 */
const fileAngle = (angle: number) => normal(180 - angle);

/** An ODF angle (`450` in tenths of a degree, `45deg`, `0.79rad`, `50grad`) in degrees. */
function degrees(value: string | undefined): number {
  if (!value) return 0;
  const number = parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  if (value.endsWith('deg')) return number;
  if (value.endsWith('grad')) return number * 0.9;
  if (value.endsWith('rad')) return (number * 180) / Math.PI;
  return number / 10;
}

type GradientLayer = Extract<FillLayer, { type: 'gradient' }>;

/**
 * A form out from a centre is turned counter-clockwise by LibreOffice, clockwise by the layer.
 * (A circle is not turned at all.)
 */
const fileTurn = (layer: GradientLayer) =>
  layer.kind === 'radial' ? 0 : normal(360 - layer.angle);

/**
 * The stops as the file runs them: a gradient of LibreOffice out from a centre starts at its
 * edge, the layer's in its centre. An axial one runs from the middle out in both.
 */
function fileStops(layer: GradientLayer): GradientStop[] {
  const stops = [...layer.stops].sort((a, b) => a.at - b.at);
  return isCentredGradient(layer.kind)
    ? stops.map((stop) => ({ ...stop, at: 1 - stop.at })).reverse()
    : stops;
}

/** The stops as the file runs them, with stops at both ends: LibreOffice reads those between from them alone. */
function fileEnds(layer: GradientLayer): GradientStop[] {
  const stops = fileStops(layer);
  const first = stops[0] as GradientStop;
  const last = stops[stops.length - 1] as GradientStop;
  return [
    ...(first.at > 0 ? [{ ...first, at: 0 }] : []),
    ...stops,
    ...(last.at < 1 ? [{ ...last, at: 1 }] : []),
  ];
}

/** Where a gradient runs as the file has it – its form, direction or centre – the same for its colours and its opacity. */
function fileGeometry(layer: GradientLayer): Record<string, string> {
  const geometry: Record<string, string> = { 'draw:style': layer.kind };
  if (!isCentredGradient(layer.kind))
    geometry['draw:angle'] = `${Number(fileAngle(layer.angle).toFixed(1))}deg`;
  else
    Object.assign(geometry, {
      'draw:cx': percent(layer.center?.x ?? 0.5),
      'draw:cy': percent(layer.center?.y ?? 0.5),
      'draw:angle': `${Number(fileTurn(layer).toFixed(1))}deg`,
    });
  return geometry;
}

/** A gradient as styles.xml names it (`draw:name` set), its colours as stops too. */
export function gradientElement(layer: GradientLayer): XmlNode {
  const ends = fileEnds(layer).map((stop) => ({ color: stop.color, at: stop.at }));
  const first = ends[0] as GradientStop;
  const last = ends[ends.length - 1] as GradientStop;
  const { 'draw:style': style, ...place } = fileGeometry(layer);
  const attributes: Record<string, string> = {
    'draw:style': style as string,
    'draw:start-color': first.color.toLowerCase(),
    'draw:end-color': last.color.toLowerCase(),
    'draw:start-intensity': '100%',
    'draw:end-intensity': '100%',
    'draw:border': '0%',
    ...place,
  };
  const children = ends.map((stop) =>
    element('loext:gradient-stop', {
      'svg:offset': String(Number(stop.at.toFixed(4))),
      'loext:color-type': 'rgb',
      'loext:color-value': stop.color.toLowerCase(),
    }),
  );
  const name = `Slider_20_Gradient_${createHash('sha256')
    .update(JSON.stringify([attributes, ends]))
    .digest('hex')
    .slice(0, 12)}`;
  return element(
    'draw:gradient',
    { 'draw:name': name, 'draw:display-name': name.replaceAll('_20_', ' '), ...attributes },
    children,
  );
}

/**
 * How opaque a gradient is along it, as styles.xml names it (`draw:opacity`, `draw:name` set) –
 * each stop's opacity times the layer's – running as its colours do. `null`: no stop see-through
 * (the layer's opacity alone is `draw:opacity` of the shape).
 */
export function opacityElement(layer: GradientLayer): XmlNode | null {
  if (!layer.stops.some((stop) => stopOpacity(stop) < 1)) return null;
  const ends = fileEnds(layer).map((stop) => ({
    at: stop.at,
    opacity: Number((stopOpacity(stop) * layer.opacity).toFixed(4)),
  }));
  const first = ends[0] as (typeof ends)[number];
  const last = ends[ends.length - 1] as (typeof ends)[number];
  const attributes: Record<string, string> = {
    ...fileGeometry(layer),
    'draw:start': percent(first.opacity),
    'draw:end': percent(last.opacity),
    'draw:border': '0%',
  };
  const children = ends.map((stop) =>
    element('loext:opacity-stop', {
      'svg:offset': String(Number(stop.at.toFixed(4))),
      'svg:stop-opacity': String(stop.opacity),
    }),
  );
  const name = `Slider_20_Opacity_${createHash('sha256')
    .update(JSON.stringify([attributes, ends]))
    .digest('hex')
    .slice(0, 12)}`;
  return element(
    'draw:opacity',
    { 'draw:name': name, 'draw:display-name': name.replaceAll('_20_', ' '), ...attributes },
    children,
  );
}

/** How opaque a `draw:opacity` is along it (0–1 each), from its stops or its ends. */
function opacityStops(node: XmlNode): { at: number; opacity: number }[] {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const stops = childrenOf(node)
    .filter((child) => tagOf(child) === 'loext:opacity-stop')
    .map((child) => ({
      at: clamp(parseFloat(attr(child, 'svg:offset') ?? '0') || 0),
      opacity: clamp(parseFloat(attr(child, 'svg:stop-opacity') ?? '1')),
    }))
    .filter((stop) => Number.isFinite(stop.opacity))
    .sort((a, b) => a.at - b.at);
  if (stops.length >= 2) return stops;
  return [
    { at: 0, opacity: fraction(attr(node, 'draw:start'), 1) },
    { at: 1, opacity: fraction(attr(node, 'draw:end'), 1) },
  ];
}

/** `stops` (file order, 0–1) at `at`, between them. */
function between<T extends { at: number }>(
  stops: readonly T[],
  at: number,
  mix: (a: T, b: T, t: number) => T,
): T {
  const after = stops.findIndex((stop) => stop.at >= at);
  if (after <= 0) return stops[after === -1 ? stops.length - 1 : 0] as T;
  const a = stops[after - 1] as T;
  const b = stops[after] as T;
  return mix(a, b, b.at === a.at ? 0 : (at - a.at) / (b.at - a.at));
}

const mixColor = (a: string, b: string, t: number) =>
  `#${[1, 3, 5]
    .map((i) => {
      const from = parseInt(a.slice(i, i + 2), 16);
      const to = parseInt(b.slice(i, i + 2), 16);
      return Math.round(from + (to - from) * t)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;

/**
 * Colour stops (file order) with the opacity a `draw:opacity` gives them – at their own places
 * and, while the schema's eight allow, at the opacity's too.
 */
function withOpacity(stops: GradientStop[], opacity: XmlNode): GradientStop[] {
  const see = opacityStops(opacity);
  const colors = [...stops].sort((a, b) => a.at - b.at);
  const places = [...new Set([...colors.map((s) => s.at), ...see.map((s) => s.at)])].sort(
    (a, b) => a - b,
  );
  const at = places.length <= 8 ? places : colors.map((stop) => stop.at);
  return at.map((place) => {
    const color = between(colors, place, (a, b, t) => ({
      color: mixColor(a.color, b.color, t),
      at: place,
    })).color;
    const value = between(see, place, (a, b, t) => ({
      at: place,
      opacity: a.opacity + (b.opacity - a.opacity) * t,
    })).opacity;
    return value < 0.9995
      ? { color, at: place, opacity: Math.round(value * 1000) / 1000 }
      : { color, at: place };
  });
}

/** A fraction of an ODF percentage (`50%`), else `fallback`. */
function fraction(value: string | undefined, fallback: number): number {
  const number = parseFloat(value ?? '');
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number / 100)) : fallback;
}

/**
 * A gradient of the file as a layer, in whichever of LibreOffice's forms it is; `see`: how opaque
 * it is along it (`draw:opacity`), its stops' opacity then.
 */
function gradientLayer(gradient: XmlNode, opacity: number, see?: XmlNode): FillLayer {
  const style = attr(gradient, 'draw:style') ?? 'linear';
  const kind = gradientKindSchema.safeParse(style).data ?? 'linear';
  const color = (name: string, fallback: string) =>
    /^#[0-9a-f]{6}$/i.test(attr(gradient, name) ?? '')
      ? (attr(gradient, name) as string).toLowerCase()
      : fallback;
  let stops: GradientStop[] = childrenOf(gradient)
    .filter((child) => tagOf(child) === 'loext:gradient-stop')
    .map((child) => ({
      color: (attr(child, 'loext:color-value') ?? '#000000').toLowerCase(),
      at: Math.min(1, Math.max(0, parseFloat(attr(child, 'svg:offset') ?? '0') || 0)),
    }))
    .filter((stop) => /^#[0-9a-f]{6}$/.test(stop.color));
  if (stops.length < 2) {
    stops = [
      { color: color('draw:start-color', '#000000'), at: 0 },
      { color: color('draw:end-color', '#ffffff'), at: 1 },
    ];
  }
  stops = stops.slice(0, 8);
  if (see) {
    stops = withOpacity(stops, see);
    opacity = 1;
  }
  const turn = degrees(attr(gradient, 'draw:angle'));
  if (!isCentredGradient(kind))
    return { type: 'gradient', kind, angle: normal(180 - turn), stops, opacity, visible: true };
  const center = {
    x: fraction(attr(gradient, 'draw:cx'), 0.5),
    y: fraction(attr(gradient, 'draw:cy'), 0.5),
  };
  return {
    type: 'gradient',
    kind,
    angle: kind === 'radial' ? 0 : normal(360 - turn),
    ...(center.x !== 0.5 || center.y !== 0.5 ? { center } : {}),
    stops: stops.map((stop) => ({ ...stop, at: 1 - stop.at })).reverse(),
    opacity,
    visible: true,
  };
}

// ── Pictures ─────────────────────────────────────────────────────────────

/** A fill picture as styles.xml names it (`draw:name` set). */
export function fillImageElement(path: string): XmlNode {
  const name = `Slider_20_Fill_${createHash('sha256').update(path).digest('hex').slice(0, 12)}`;
  return element('draw:fill-image', {
    'draw:name': name,
    'draw:display-name': name.replaceAll('_20_', ' '),
    'xlink:href': path,
    'xlink:type': 'simple',
    'xlink:show': 'embed',
    'xlink:actuate': 'onLoad',
  });
}

// ── Reading and writing ──────────────────────────────────────────────────

/** `draw:opacity` as 0–1 (`100%`: not see-through). */
const opacityOf = (props: Properties) => {
  const value = parseFloat(props['draw:opacity'] ?? '100');
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : 1;
};

/**
 * The fill's layers: those written on the shape while still its fill, else its fill as the file
 * has it – a colour, a gradient or a picture (`fill`: the kind a shape without one has).
 */
export function readFills(
  index: StyleIndex,
  node: XmlNode,
  props: Properties,
  fill: string,
): FillsMark {
  const marked = readFillsMark(node, props);
  if (marked) return marked;
  return { fills: fileFills(index, props, fill), aspect: null };
}

function fileFills(index: StyleIndex, props: Properties, fill: string): FillLayer[] {
  if (props['loext:fill-use-slide-background'] === 'true') return [];
  const opacity = opacityOf(props);
  switch (props['draw:fill'] ?? fill) {
    case 'solid':
      return [
        {
          type: 'solid',
          color: (props['draw:fill-color'] ?? '#729fcf').toLowerCase(),
          opacity,
          visible: true,
        },
      ];
    case 'gradient': {
      const gradient = index.gradient(props['draw:fill-gradient-name']);
      const see = index.opacity(props['draw:opacity-name']);
      return gradient ? [gradientLayer(gradient, opacity, see)] : [];
    }
    case 'bitmap': {
      const href = attr(index.fillImage(props['draw:fill-image-name']) ?? {}, 'xlink:href');
      if (!href?.startsWith('Pictures/')) return [];
      const repeat = props['style:repeat'] ?? 'repeat';
      const fit = repeat === 'stretch' ? 'stretch' : repeat === 'no-repeat' ? 'fit' : 'tile';
      return [{ type: 'image', src: href, fit, opacity, visible: true }];
    }
    default:
      return [];
  }
}

/** What the document needs to write a fill: its named gradients and pictures. */
export interface FillSink {
  /** Adds a `draw:gradient` or `draw:fill-image` to styles.xml (once) and returns its name. */
  named: (node: XmlNode) => string;
}

/**
 * The graphic properties drawing `fills`: `composite` is the path of the picture of them all,
 * needed when one colour or gradient cannot draw them.
 */
export function fillProperties(
  sink: FillSink,
  shown: FillLayer | null | 'composite',
  composite: string | null,
): Properties {
  if (shown === null) return { 'draw:fill': 'none' };
  if (shown === 'composite') {
    if (!composite) throw new Error('composite missing');
    return {
      'draw:fill': 'bitmap',
      'draw:fill-image-name': sink.named(fillImageElement(composite)),
      'style:repeat': 'stretch',
      // Always said: a parent style's see-through would show through otherwise.
      'draw:opacity': '100%',
    };
  }
  const opacity: Properties = { 'draw:opacity': percent(shown.opacity) };
  if (shown.type === 'solid')
    return { 'draw:fill': 'solid', 'draw:fill-color': shown.color.toLowerCase(), ...opacity };
  if (shown.type === 'gradient') {
    // Stops see-through: the layer's opacity is in theirs.
    const see = opacityElement(shown);
    return {
      'draw:fill': 'gradient',
      'draw:fill-gradient-name': sink.named(gradientElement(shown)),
      ...(see ? { 'draw:opacity-name': sink.named(see), 'draw:opacity': '100%' } : opacity),
    };
  }
  throw new Error('a picture is drawn as a composite');
}
