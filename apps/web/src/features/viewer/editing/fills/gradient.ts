import {
  alongLine,
  centerOf,
  centredForm,
  colorAt,
  gradientLine,
  gradientPixels,
  isCentredGradient,
  lineStops,
  opacityAt,
  seeThrough,
  sortedStops,
  stopOpacity,
  type GradientLayer,
  type GradientStop,
} from '@slider/shared';

export {
  alongLine,
  centerOf,
  colorAt,
  gradientLine,
  lineStops,
  opacityAt,
  seeThrough,
  sortedStops,
  type GradientLayer,
};

/*
 * A gradient's geometry as LibreOffice draws it – so the editor's previews, the pictures of
 * layers it bakes and the handles over the slide all agree with the slide's own picture:
 *  - linear: from corner to corner of its direction (as CSS's);
 *  - axial: the same line, from its middle out to both sides;
 *  - radial: a circle of half the shape's diagonal around its centre;
 *  - ellipsoid: an ellipse of the shape's proportions, √2 as large, turned;
 *  - square / rectangular: a square of the longer side / a rectangle of the shape, turned and
 *    grown to still cover the shape.
 */

/** A stop of `color` at `at`, `opacity` said only when it is see-through (as a file's stops). */
export const makeStop = (color: string, at: number, opacity = 1): GradientStop =>
  opacity < 1 ? { color, at, opacity: Math.round(opacity * 1000) / 1000 } : { color, at };

const channel = (color: string, i: number) => parseInt(color.slice(1 + i * 2, 3 + i * 2), 16);

/** A stop as CSS has a colour: its hex, else `rgba(…)` when it is see-through. */
export function stopCss(stop: GradientStop): string {
  const opacity = stopOpacity(stop);
  if (opacity >= 1) return stop.color;
  return `rgba(${[0, 1, 2].map((i) => channel(stop.color, i)).join(', ')}, ${opacity})`;
}

/**
 * The line the handles over the slide draw (px of the box): where stop 0 sits and where stop 1 –
 * a linear gradient's start and end, else from its middle out along its (first) axis.
 */
export function handleLine(layer: GradientLayer, width: number, height: number) {
  if (layer.kind === 'linear' || layer.kind === 'axial') {
    const { x0, y0, x1, y1 } = gradientLine(layer.angle, width, height);
    return layer.kind === 'linear' ? { x0, y0, x1, y1 } : { x0: width / 2, y0: height / 2, x1, y1 };
  }
  const { cx, cy, hx } = centredForm(layer, width, height);
  // A circle is not turned: its handle still points where the angle says.
  const radians = (layer.angle * Math.PI) / 180;
  return { x0: cx, y0: cy, x1: cx + Math.cos(radians) * hx, y1: cy + Math.sin(radians) * hx };
}

/** The angle a handle dragged to (`x`, `y`) gives – relative to the line's start or the box's middle. */
export function angleTowards(
  layer: GradientLayer,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const from =
    layer.kind === 'linear' || layer.kind === 'axial'
      ? { x: width / 2, y: height / 2 }
      : { x: centerOf(layer).x * width, y: centerOf(layer).y * height };
  const dx = x - from.x;
  const dy = y - from.y;
  const degrees =
    layer.kind === 'linear' || layer.kind === 'axial'
      ? (Math.atan2(dx, -dy) * 180) / Math.PI
      : (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/** The stop a gradient would have at `at`: its colour and opacity there. */
export const stopAt = (stops: readonly GradientStop[], at: number): GradientStop =>
  makeStop(colorAt(stops, at), at, opacityAt(stops, at));

/**
 * The gradient painted into a `width` × `height` canvas (its layer's opacity is the caller's). A
 * see-through one pixel by pixel: LibreOffice runs colour and opacity apart, a canvas's gradient
 * mixes them (premultiplied) – a colour fading out would look otherwise.
 */
export function paintGradient(
  context: CanvasRenderingContext2D,
  layer: GradientLayer,
  width: number,
  height: number,
): void {
  const centred = isCentredGradient(layer.kind);
  if (!centred && !seeThrough(layer.stops)) {
    const { x0, y0, x1, y1 } = gradientLine(layer.angle, width, height);
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    for (const stop of lineStops(layer)) gradient.addColorStop(stop.at, stop.color);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    return;
  }
  const image = context.createImageData(width, height);
  image.data.set(gradientPixels(layer, width, height));
  context.putImageData(image, 0, 0);
}

/** Pictures of centred gradients for CSS, by the gradient and proportions (a few kept). */
const pictures = new Map<string, string>();
const MAX_PICTURES = 48;
/** Longest side of such a picture: enough for a preview, cheap to paint. */
const PICTURE_SIDE = 240;

/**
 * A gradient as a CSS background in a box of `aspect` (width / height): a linear or axial one as
 * CSS's own, one out from a centre as a picture of it (CSS cannot size a circle by the box).
 */
export function gradientBackground(layer: GradientLayer, aspect = 1): string {
  // A see-through one as a picture too: CSS mixes colour and opacity otherwise (`paintGradient`).
  if (!isCentredGradient(layer.kind) && !seeThrough(layer.stops)) {
    const stops = lineStops(layer)
      .map((stop) => `${stop.color} ${Math.round(stop.at * 1000) / 10}%`)
      .join(', ');
    return `linear-gradient(${layer.angle}deg, ${stops})`;
  }
  // A box without width or height (a line): its gradient as a square's.
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const width = Math.max(1, Math.round(ratio >= 1 ? PICTURE_SIDE : PICTURE_SIDE * ratio));
  const height = Math.max(1, Math.round(ratio >= 1 ? PICTURE_SIDE / ratio : PICTURE_SIDE));
  const key = JSON.stringify([layer.kind, layer.angle, layer.center, layer.stops, width, height]);
  let url = pictures.get(key);
  if (url) pictures.delete(key);
  else {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      // No canvas (tests): near enough.
      const center = centerOf(layer);
      const stops = sortedStops(layer.stops)
        .map((stop) => `${stopCss(stop)} ${Math.round(stop.at * 1000) / 10}%`)
        .join(', ');
      if (!isCentredGradient(layer.kind)) return `linear-gradient(${layer.angle}deg, ${stops})`;
      return `radial-gradient(circle at ${center.x * 100}% ${center.y * 100}%, ${stops})`;
    }
    canvas.width = width;
    canvas.height = height;
    paintGradient(context, layer, width, height);
    url = `center / 100% 100% no-repeat url("${canvas.toDataURL('image/png')}")`;
  }
  pictures.set(key, url);
  while (pictures.size > MAX_PICTURES) pictures.delete(pictures.keys().next().value!);
  return url;
}

/** A gradient to start from, of `color`: top to bottom into a lighter (or darker) one. */
export function defaultGradient(color: string, opacity = 1, visible = true): GradientLayer {
  const light =
    [0, 1, 2].reduce((sum, i) => sum + parseInt(color.slice(1 + i * 2, 3 + i * 2), 16), 0) / 3 >
    160;
  const other = colorAt(
    [
      { color, at: 0 },
      { color: light ? '#000000' : '#ffffff', at: 1 },
    ],
    light ? 0.25 : 0.4,
  );
  return {
    type: 'gradient',
    kind: 'linear',
    angle: 180,
    stops: [
      { color, at: 0 },
      { color: other, at: 1 },
    ],
    opacity,
    visible,
  };
}

/**
 * The colours between two handles as a design tool has them: 0 at the handle `u0` along the
 * gradient's line, 1 at the one `u1` along it – the colours there at both ends, those between in
 * their place.
 */
export function stopsBetween(
  stops: readonly GradientStop[],
  u0: number,
  u1: number,
): GradientStop[] {
  const sorted = sortedStops(stops);
  const span = u1 - u0;
  const inner = sorted
    .filter((stop) => stop.at > u0 + 1e-6 && stop.at < u1 - 1e-6)
    // Rounded as the file's stops are (`stopsOnLine`): taken back, a stop is where it was.
    .map((stop) => ({ ...stop, at: Math.round(((stop.at - u0) / span) * 1000) / 1000 }));
  return [{ ...stopAt(sorted, u0), at: 0 }, ...inner, { ...stopAt(sorted, u1), at: 1 }];
}

/** Most stops a gradient has (as the file's schema). */
const MAX_STOPS = 8;

/**
 * Colours between handles (`stopsBetween`) laid onto the file's line, the handles `t0` and `t1`
 * along it: what lies past its ends is cut off there, in the colour it has there (LibreOffice
 * draws no further). At most {@link MAX_STOPS}: the colours least missed go.
 */
export function stopsOnLine(
  between: readonly GradientStop[],
  t0: number,
  t1: number,
): GradientStop[] {
  const laid = sortedStops(between).map((stop) => ({ ...stop, at: t0 + stop.at * (t1 - t0) }));
  const first = laid[0] as GradientStop;
  const last = laid[laid.length - 1] as GradientStop;
  const out: GradientStop[] = [];
  if (first.at < 0) out.push(stopAt(laid, 0));
  for (const stop of laid) if (stop.at >= 0 && stop.at <= 1) out.push(stop);
  if (last.at > 1) out.push(stopAt(laid, 1));
  if (out.length === 1) {
    const only = out[0] as GradientStop;
    out.push({ ...only, at: only.at < 1 ? 1 : 0 });
  }
  const rounded = sortedStops(
    out.map((stop) => ({ ...stop, at: Math.round(stop.at * 1000) / 1000 })),
  );
  // A stop's colour and opacity as numbers to compare (0–255 each).
  const channels = (stop: GradientStop) => [
    ...[0, 1, 2].map((i) => channel(stop.color, i)),
    stopOpacity(stop) * 255,
  ];
  while (rounded.length > MAX_STOPS) {
    let least = 1;
    let missed = Infinity;
    for (let i = 1; i < rounded.length - 1; i++) {
      const [a, stop, b] = [rounded[i - 1]!, rounded[i]!, rounded[i + 1]!];
      const guess = channels(stopAt([a, b], stop.at));
      const real = channels(stop);
      const off = Math.max(...real.map((value, c) => Math.abs(value - (guess[c] as number))));
      if (off < missed) {
        missed = off;
        least = i;
      }
    }
    rounded.splice(least, 1);
  }
  return rounded;
}
