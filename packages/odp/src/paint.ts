import {
  isPresetPolygon,
  type ElementLook,
  type ElementPaint,
  type ElementTilt,
  type LiveElement,
} from '@slider/shared';
import { clipOf, fittedInSlider, framePicture } from './image-fit';
import { readCornerRadius } from './corners';
import { graphicPropsOf } from './live';
import type { StyleIndex } from './styles';
import { lengthToCm } from './units';
import { attr, childrenOf, firstChild, tagOf, type XmlNode } from './xml';

/*
 * Which elements the browser draws whole in Bearbeiten (the per-element editor, docs/do-not-break.md):
 * a strict whitelist, so what it draws is what LibreOffice draws – checked per element by
 * `live-parity --compose`. Anything not named here is LibreOffice's picture of it.
 */

const PT_PER_CM = 72 / 2.54;
/** The paths LibreOffice writes for its own presets – the preset drawn, nothing of its own. */
const PRESET_PATHS: Record<string, readonly string[]> = {
  rectangle: ['M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N'],
  ellipse: ['U 10800 10800 10800 10800 0 360 Z N', 'U 10800 10800 10800 10800 0 23592960 Z N'],
};

/** Its outline when the browser can draw it: a box (corners rounded) or an ellipse. */
function outlineOf(node: XmlNode): ElementPaint | null {
  const tag = tagOf(node);
  if (tag === 'draw:frame')
    return firstChild(node, 'draw:text-box') ? { outline: 'rect', radius: 0 } : null;
  if (tag === 'draw:rect') {
    const radius = lengthToCm(attr(node, 'draw:corner-radius')) ?? 0;
    return { outline: 'rect', radius: radius * PT_PER_CM };
  }
  if (tag === 'draw:ellipse') {
    const kind = attr(node, 'draw:kind');
    return !kind || kind === 'full' ? { outline: 'ellipse', radius: 0 } : null;
  }
  if (tag !== 'draw:custom-shape') return null;
  const geometry = firstChild(node, 'draw:enhanced-geometry');
  if (!geometry) return null;
  const type = attr(geometry, 'draw:type');
  // Letters along a path (Fontwork): drawn as LibreOffice does.
  if (attr(geometry, 'draw:text-path') === 'true') return null;
  const path = attr(geometry, 'draw:enhanced-path');
  // One of the presets a new box takes, as Slider writes it (its type alone, no path of its own).
  if (isPresetPolygon(type) && path === undefined) {
    const modifiers = (attr(geometry, 'draw:modifiers') ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    if (!modifiers.every(Number.isFinite)) return null;
    return {
      outline: 'preset',
      radius: 0,
      preset: { type, ...(modifiers.length > 0 && { modifiers }) },
    };
  }
  if (type === 'rectangle' || type === 'ellipse') {
    if (path !== undefined && !PRESET_PATHS[type]?.includes(path.trim())) return null;
    return type === 'rectangle'
      ? { outline: 'rect', radius: 0 }
      : { outline: 'ellipse', radius: 0 };
  }
  if (type === 'round-rectangle') {
    const radius = readCornerRadius(node);
    return radius === undefined ? null : { outline: 'rect', radius };
  }
  // PowerPoint's rectangle as LibreOffice imports it: its path over the box's own size.
  if (type === 'ooxml-rect' && path?.trim() === OOXML_RECT_PATH) {
    const formulas = new Map(
      childrenOf(geometry)
        .filter((child) => tagOf(child) === 'draw:equation')
        .map((child) => [attr(child, 'draw:name'), attr(child, 'draw:formula')?.trim()]),
    );
    return formulas.get('f2') === 'logheight' && formulas.get('f3') === 'logwidth'
      ? { outline: 'rect', radius: 0 }
      : null;
  }
  return null;
}

const OOXML_RECT_PATH = 'M 0 0 L ?f3 0 ?f3 ?f2 0 ?f2 Z N';

/** Percent as a share (1 when not said). */
const share = (value: string | undefined) => {
  const percent = value === undefined ? NaN : Number.parseFloat(value);
  return Number.isFinite(percent) ? percent / 100 : 1;
};

/**
 * How the browser draws the element whole (`EditableElement.paint`), else `undefined`: its
 * outline a box or an ellipse, its area and line one colour each or none (solid, not
 * see-through), its text typed live or none – flat, not turned, mirrored or in depth, without
 * shadow, glow, soft edge, blur or a frosted backdrop.
 */
export function paintOf(
  styles: StyleIndex,
  node: XmlNode,
  live: LiveElement | null,
  look: ElementLook | null,
  frame: { rotation: number } | null,
  tilt: ElementTilt | null,
): ElementPaint | undefined {
  if (!live || !look || !frame || tilt) return undefined;
  const paint = outlineOf(node);
  if (!paint) return undefined;
  // Mirrored with text: LibreOffice turns the text with it – only an empty one the browser draws.
  const geometry = firstChild(node, 'draw:enhanced-geometry');
  const mirrored =
    !!geometry &&
    (attr(geometry, 'draw:mirror-horizontal') === 'true' ||
      attr(geometry, 'draw:mirror-vertical') === 'true');
  if (mirrored && holdsText(live)) return undefined;
  // A mirrored gradient: not measured against LibreOffice yet.
  if (mirrored && look.fills.some((layer) => layer.type === 'gradient')) return undefined;
  // Only a box grows with its text: the browser's box follows it, an outline drawn apart would not.
  if (live.autoGrow && (paint.outline !== 'rect' || paint.radius > 0)) return undefined;
  const { effects } = look;
  if (effects.shadow || effects.blur || effects.glow || effects.backdrop) return undefined;
  if (look.fillAspect !== null) return undefined;
  const props = graphicPropsOf(styles, node);
  // A turned shape's gradient lies over its upright bounds (`TurnedGradient`): a box or polygon
  // only – a turned ellipse or rounded box is cut otherwise.
  const turnedRound =
    !!frame.rotation &&
    (paint.outline === 'ellipse' || (paint.outline === 'rect' && paint.radius > 0));
  const gradient = !turnedRound && plainGradient(styles, props, look);
  if (look.fills.length > 1 || look.fills.some((layer) => layer.type !== 'solid' && !gradient))
    return undefined;
  if (live.stroke?.dash && !sliderDash(styles, props['draw:stroke-dash'])) return undefined;
  // Dashes the browser lays as LibreOffice does (`live-parity --compose`): not a star's many short
  // sides, a box's dots or a rounded box's – LibreOffice spaces those per side.
  if (
    live.stroke?.dash &&
    ((paint.outline === 'preset' && paint.preset?.type === 'star5') ||
      (paint.outline === 'rect' && (live.stroke.dash === 'dot' || paint.radius > 0)))
  )
    return undefined;
  const shapeKind = tagOf(node) === 'draw:frame' ? 'none' : 'solid';
  const area = props['draw:fill'] ?? shapeKind;
  if (!['none', 'solid'].includes(area) && !(area === 'gradient' && gradient)) return undefined;
  const line = props['draw:stroke'] ?? shapeKind;
  if (!['none', 'solid'].includes(line) && !(line === 'dash' && live.stroke?.dash))
    return undefined;
  if (
    props['loext:fill-use-slide-background'] === 'true' ||
    (props['draw:shadow'] ?? 'hidden') !== 'hidden' ||
    (lengthToCm(props['loext:softedge-radius']) ?? 0) > 0 ||
    (lengthToCm(props['loext:glow-radius']) ?? 0) > 0 ||
    props['draw:opacity-name'] ||
    props['draw:marker-start'] ||
    props['draw:marker-end']
  )
    return undefined;
  // Its area and line as `live` has them: a fill or line LibreOffice draws but `live` misses
  // would go unseen.
  if ((props['draw:fill'] ?? shapeKind) === 'solid' && !live.fill) return undefined;
  if (line !== 'none' && !live.stroke) return undefined;
  const fillOpacity = share(props['draw:opacity']);
  const strokeOpacity = share(props['svg:stroke-opacity']);
  // A box growing with its text (or an empty placeholder) is drawn as the live editor draws it
  // (`LiveElementView`), solid lines and colours only.
  const growing = (live.autoGrow && holdsText(live)) || live.placeholder;
  if (
    growing &&
    paint.outline === 'rect' &&
    paint.radius === 0 &&
    (live.stroke?.dash || fillOpacity < 1 || strokeOpacity < 1 || gradient)
  )
    return undefined;
  return {
    outline: paint.outline,
    radius: Math.round(paint.radius * 100) / 100,
    ...(paint.preset && { preset: paint.preset }),
    ...(fillOpacity < 1 && { fillOpacity }),
    ...(strokeOpacity < 1 && { strokeOpacity }),
    ...(gradient && { gradient: true }),
  };
}

/** The gradient kinds the browser draws as LibreOffice does (`live-parity --compose`). */
const GRADIENT_KINDS = new Set(['linear', 'axial', 'radial', 'ellipsoid', 'square', 'rectangular']);

/**
 * Whether the area is one gradient the browser draws as LibreOffice does: shown alone, of a kind
 * it knows, as the editor writes one (`gradientElement`) – no border, full intensity, smooth (no
 * steps), not see-through along it (`draw:opacity-name`).
 */
function plainGradient(styles: StyleIndex, props: Record<string, string>, look: ElementLook) {
  if (props['draw:fill'] !== 'gradient' || props['draw:opacity-name']) return false;
  const [layer] = look.fills;
  if (look.fills.length !== 1 || layer?.type !== 'gradient' || !layer.visible) return false;
  if (!GRADIENT_KINDS.has(layer.kind)) return false;
  // An ellipsoid's colours between its ends lie otherwise than the browser's (5 % at a middle stop).
  if (layer.kind === 'ellipsoid' && layer.stops.length > 2) return false;
  const gradient = styles.gradient(props['draw:fill-gradient-name']);
  if (!gradient) return false;
  const plain = (key: string, value: string) => (attr(gradient, key) ?? value) === value;
  const steps = Number(props['draw:gradient-step-count'] ?? 0);
  return (
    plain('draw:border', '0%') &&
    plain('draw:start-intensity', '100%') &&
    plain('draw:end-intensity', '100%') &&
    !(steps > 0)
  );
}

/** Whether any paragraph holds a character. */
const holdsText = (live: LiveElement) =>
  live.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text));

/**
 * Whether a line's dash pattern is one the editor writes (`strokeDash`): rect dashes of 4 × the
 * line's width 2 × apart, or dots of 1 × 1 – the browser draws exactly these.
 */
export function sliderDash(styles: StyleIndex, name: string | undefined): boolean {
  const pattern = styles.dash(name);
  if (!pattern) return false;
  const style = attr(pattern, 'draw:style') ?? 'rect';
  const dots = attr(pattern, 'draw:dots1');
  const length = attr(pattern, 'draw:dots1-length');
  const distance = attr(pattern, 'draw:distance');
  if (style !== 'rect' || dots !== '1' || attr(pattern, 'draw:dots2')) return false;
  return (length === '400%' && distance === '200%') || (length === '100%' && distance === '100%');
}

/** Raster pictures the browser draws as LibreOffice does (no vector or metafile formats). */
const RASTER = /\.(jpe?g|png|webp|gif)$/i;

/**
 * How the browser draws a picture whole (`EditableElement.paint`), else `undefined`: a raster
 * picture shown whole or cut as Slider fits it, not see-through, recoloured, bordered, filled behind, shadowed
 * or in depth – turned and mirrored as it is.
 */
export function picturePaintOf(
  styles: StyleIndex,
  node: XmlNode,
  frame: { rotation: number } | null,
  tilt: ElementTilt | null,
): ElementPaint | undefined {
  if (!frame || tilt || tagOf(node) !== 'draw:frame') return undefined;
  const images = childrenOf(node).filter((child) => tagOf(child) === 'draw:image');
  const src = framePicture(node);
  if (images.length !== 1 || !src || !RASTER.test(src)) return undefined;
  // Cut as Slider fits it (`shownCrop` names the part): drawn so; any other cut is LibreOffice's.
  if (clipOf(styles, node) && !fittedInSlider(node)) return undefined;
  const props = graphicPropsOf(styles, node);
  const plain = (key: string, value: string) => (props[key] ?? value) === value;
  if (
    !plain('draw:color-mode', 'standard') ||
    !plain('draw:luminance', '0%') ||
    !plain('draw:contrast', '0%') ||
    !plain('draw:gamma', '100%') ||
    !plain('draw:red', '0%') ||
    !plain('draw:green', '0%') ||
    !plain('draw:blue', '0%') ||
    share(props['draw:image-opacity']) < 1 ||
    !plain('draw:stroke', 'none') ||
    !plain('draw:fill', 'none') ||
    (props['draw:shadow'] ?? 'hidden') !== 'hidden' ||
    (lengthToCm(props['loext:softedge-radius']) ?? 0) > 0 ||
    (lengthToCm(props['loext:glow-radius']) ?? 0) > 0
  )
    return undefined;
  return { outline: 'picture', radius: 0 };
}
