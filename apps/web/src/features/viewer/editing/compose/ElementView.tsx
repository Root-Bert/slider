import {
  arrowHeadWidth,
  hasHead,
  lineEnds,
  presetPolygon,
  shownCrop,
  type EditableElement,
  type ElementPaint,
  type LiveElement,
} from '@slider/shared';
import type { CSSProperties, Ref } from 'react';
import { elementTransform } from '../tilt/tilt-math';
import { u } from '../live/css';
import { gradientBackground } from '../fills/gradient';
import { LiveElementView, TextView } from '../live/render';
import { holdsText } from './text';

/*
 * An element the browser draws whole in Bearbeiten (`EditableElement.paint`): plain and
 * context-free, so the parity check (`scripts/live-parity.ts --compose`) draws exactly what the
 * editor does. A box as the live editor draws one (its fill and centred line, `LiveElementView`);
 * a rounded box, an ellipse or a preset polygon as an SVG outline under its text; a picture as
 * itself, stretched over its frame.
 */

/** Its text laid out unseen: the box keeps its height while the text is typed on the edit layer. */
function UnseenText({ live }: { live: LiveElement }) {
  return (
    <div style={{ visibility: 'hidden' }}>
      <TextView live={live} />
    </div>
  );
}

/** Where the element lies, turned as it is (around its centre). */
function boxStyle(element: EditableElement): CSSProperties {
  const { x, y, w, h } = element.bbox;
  const transform = elementTransform(element.rotation, element.tilt);
  return {
    position: 'absolute',
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    overflow: 'visible',
    ...(transform ? { transform } : {}),
  };
}

/**
 * The dashes the editor writes (`strokeDash`): 4 × the line's width 2 × apart, or dots 1 × 1,
 * from the outline's first corner on – a box's (`boxed`) one line's width in, as LibreOffice lays
 * them (measured by `live-parity --compose`).
 */
function dashes(
  dash: string | undefined,
  width: number,
  boxed: boolean,
): Pick<CSSProperties, 'strokeDasharray' | 'strokeDashoffset'> {
  const [part, gap] = dash === 'dash' ? [4, 2] : dash === 'dot' ? [1, 1] : [0, 0];
  if (!part) return {};
  return {
    strokeDasharray: `${u(width * part)} ${u(width * gap)}`,
    ...(boxed && { strokeDashoffset: u(width * (part + gap - 1)) }),
  };
}

/**
 * A rounded box's, an ellipse's or a preset's area and line – the line centred on its edge, as
 * LibreOffice does; a mirrored preset mirrored within its box.
 */
function OutlineView({
  element,
  live,
  paint,
  pageAspect,
}: {
  element: EditableElement;
  live: LiveElement;
  paint: ElementPaint;
  pageAspect: number;
}) {
  const stroke = live.stroke;
  const layer = paint.gradient ? element.look?.fills[0] : undefined;
  const gradient = layer?.type === 'gradient' ? layer : null;
  // A hairline (0) is one pixel.
  const width = stroke ? (stroke.width > 0 ? u(stroke.width) : '1px') : undefined;
  const shape: CSSProperties = {
    fill: gradient ? 'none' : (live.fill ?? 'none'),
    fillOpacity: paint.fillOpacity,
    stroke: stroke?.color ?? 'none',
    strokeOpacity: paint.strokeOpacity,
    strokeWidth: width,
    ...(stroke && stroke.width > 0
      ? dashes(stroke.dash, stroke.width, paint.outline === 'rect')
      : {}),
    strokeLinejoin: 'round',
  };
  const flip = element.flip;
  const polygon = paint.outline === 'preset' && paint.preset ? presetPolygon(paint.preset) : null;
  const corners = polygon?.map(
    ([px, py]) => [flip?.x ? 1 - px : px, flip?.y ? 1 - py : py] as const,
  );
  const { w, h } = element.bbox;
  return (
    <>
      {gradient && element.rotation ? (
        // Turned: LibreOffice lays the gradient over the turned shape's upright bounds, not turned
        // with it – drawn so, cut to the turned outline.
        <TurnedGradient
          element={element}
          corners={corners ?? BOX_CORNERS}
          background={(aspect) => gradientBackground(gradient, aspect)}
          opacity={paint.fillOpacity}
          pageAspect={pageAspect}
        />
      ) : (
        gradient && (
          // A gradient as CSS draws it over the box (LibreOffice's geometry, `gradientBackground`),
          // cut to the outline; the line drawn over it.
          <div
            aria-hidden
            data-compose-gradient={gradient.kind}
            style={{
              ...boxStyle(element),
              background: gradientBackground(gradient, h > 0 ? (w * pageAspect) / h : 1),
              opacity: paint.fillOpacity,
              clipPath:
                paint.outline === 'ellipse'
                  ? 'ellipse(50% 50% at 50% 50%)'
                  : corners
                    ? `polygon(${corners.map(([px, py]) => `${px * 100}% ${py * 100}%`).join(', ')})`
                    : paint.radius > 0
                      ? `inset(0 round ${u(paint.radius)})`
                      : undefined,
            }}
          />
        )
      )}
      <Outline element={element} paint={paint} polygon={corners ?? null} shape={shape} />
    </>
  );
}

const BOX_CORNERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

/**
 * A turned shape's gradient as LibreOffice draws it: over the upright box around the turned shape
 * (its bounds on the slide), cut to the shape's corners turned with it.
 */
function TurnedGradient({
  element,
  corners,
  background,
  opacity,
  pageAspect,
}: {
  element: EditableElement;
  corners: readonly (readonly [number, number])[];
  background: (aspect: number) => string;
  opacity: number | undefined;
  pageAspect: number;
}) {
  const { x, y, w, h } = element.bbox;
  // In the slide's widths: its height then counts as much as its width.
  const height = h / pageAspect;
  const turn = (element.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const across = w * Math.abs(c) + height * Math.abs(s);
  const down = w * Math.abs(s) + height * Math.abs(c);
  const clip = corners.map(([u, v]) => {
    const [lx, ly] = [(u - 0.5) * w, (v - 0.5) * height];
    const px = (lx * c - ly * s + across / 2) / across;
    const py = (lx * s + ly * c + down / 2) / down;
    return `${px * 100}% ${py * 100}%`;
  });
  return (
    <div
      aria-hidden
      data-compose-gradient="turned"
      style={{
        position: 'absolute',
        left: `${(x + w / 2 - across / 2) * 100}%`,
        top: `${(y + h / 2 - (down * pageAspect) / 2) * 100}%`,
        width: `${across * 100}%`,
        height: `${down * pageAspect * 100}%`,
        background: background(down > 0 ? across / down : 1),
        opacity,
        clipPath: `polygon(${clip.join(', ')})`,
      }}
    />
  );
}

/** The outline as SVG: its area (unless a gradient lies under it) and its line. */
function Outline({
  element,
  paint,
  polygon,
  shape,
}: {
  element: EditableElement;
  paint: ElementPaint;
  polygon: readonly (readonly [number, number])[] | null;
  shape: CSSProperties;
}) {
  return (
    <svg aria-hidden data-compose-outline={paint.outline} style={boxStyle(element)}>
      {paint.outline === 'ellipse' ? (
        <ellipse cx="50%" cy="50%" rx="50%" ry="50%" style={shape} />
      ) : polygon ? (
        // Its corners as shares of the box, the box's own size by the viewBox – the line kept
        // its width however the box is stretched.
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          overflow="visible"
        >
          <polygon
            points={polygon.map(([px, py]) => `${px},${py}`).join(' ')}
            vectorEffect="non-scaling-stroke"
            style={shape}
          />
        </svg>
      ) : (
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          style={{ ...shape, rx: u(paint.radius), ry: u(paint.radius) } as CSSProperties}
        />
      )}
    </svg>
  );
}

/** A picture over its frame, stretched to it – mirrored as it is. */
function PictureView({
  element,
  src,
  pageAspect,
}: {
  element: EditableElement;
  src: string;
  pageAspect: number;
}) {
  const style = boxStyle(element);
  const mirror = element.flip?.x ? 'scaleX(-1)' : '';
  const transform = [style.transform, mirror].filter(Boolean).join(' ');
  const { w, h } = element.bbox;
  // Filled, the part it shows (`shownCrop`, as the file's `fo:clip`): the whole picture placed so
  // that part covers the frame, the rest cut off by it.
  const crop = element.picture
    ? shownCrop(element.picture, h > 0 ? (w * pageAspect) / h : 1)
    : null;
  const whole = !crop || (crop.w >= 1 && crop.h >= 1);
  const picture: CSSProperties = {
    display: 'block',
    maxWidth: 'none',
    objectFit: 'fill',
    imageOrientation: 'none',
  };
  if (whole) {
    return (
      <img
        aria-hidden
        data-compose-outline="picture"
        src={src}
        alt=""
        draggable={false}
        style={{ ...style, ...(transform ? { transform } : {}), ...picture }}
      />
    );
  }
  return (
    <div
      aria-hidden
      data-compose-outline="picture"
      style={{ ...style, ...(transform ? { transform } : {}), overflow: 'hidden' }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          ...picture,
          position: 'absolute',
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
          width: `${100 / crop.w}%`,
          height: `${100 / crop.h}%`,
        }}
      />
    </div>
  );
}

/** A head's length over its width: LibreOffice's „Arrow“ (`svg:viewBox` 0 0 20 30). */
const HEAD_LENGTH = 1.5;
/** How much earlier, in line widths, LibreOffice's dashes begin after a head at the start. */
const DASH_LEAD = 0.22;

/**
 * A line from end to end of its box as it runs (`lineEnds`), over the whole slide in points – its
 * heads LibreOffice's „Arrow“, the tip at the end, the line stopping at the head's base (as
 * LibreOffice draws it, `live-parity --compose`).
 */
function LineView({
  element,
  paint,
  pageWidthPt,
  pageAspect,
}: {
  element: EditableElement;
  paint: ElementPaint;
  pageWidthPt: number;
  pageAspect: number;
}) {
  const stroke = element.look?.stroke;
  if (!stroke) return null;
  const height = pageWidthPt / pageAspect;
  const ends = lineEnds(element.bbox, element.flip);
  const from = { x: ends.from.x * pageWidthPt, y: ends.from.y * height };
  const to = { x: ends.to.x * pageWidthPt, y: ends.to.y * height };
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const [dx, dy] = length > 0 ? [(to.x - from.x) / length, (to.y - from.y) / length] : [1, 0];
  const heads = element.line?.heads ?? 'none';
  const head = arrowHeadWidth(stroke.width);
  const reach = head * HEAD_LENGTH;
  // The heads' triangles, each pointing out of its end; the line between their bases.
  const triangle = (tip: { x: number; y: number }, sx: number, sy: number) => {
    const base = { x: tip.x - sx * reach, y: tip.y - sy * reach };
    const [nx, ny] = [-sy * (head / 2), sx * (head / 2)];
    return `${tip.x},${tip.y} ${base.x + nx},${base.y + ny} ${base.x - nx},${base.y - ny}`;
  };
  const atStart = hasHead(heads, false);
  const atEnd = hasHead(heads, true);
  const cut = (atStart ? reach : 0) + (atEnd ? reach : 0);
  const start = atStart ? { x: from.x + dx * reach, y: from.y + dy * reach } : from;
  const end = atEnd ? { x: to.x - dx * reach, y: to.y - dy * reach } : to;
  const color = stroke.color;
  const [part, gap] = stroke.dash === 'dash' ? [4, 2] : stroke.dash === 'dot' ? [1, 1] : [0, 0];
  // A hairline (0) is one pixel, however the slide is scaled.
  const hair = stroke.width <= 0;
  return (
    <svg
      aria-hidden
      data-compose-outline="line"
      viewBox={`0 0 ${pageWidthPt} ${height}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
    >
      <g opacity={paint.strokeOpacity}>
        {length > cut && (
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={color}
            strokeWidth={hair ? 1 : stroke.width}
            vectorEffect={hair ? 'non-scaling-stroke' : undefined}
            strokeDasharray={
              part && !hair ? `${part * stroke.width} ${gap * stroke.width}` : undefined
            }
            // Under a head at its start LibreOffice's dashes begin a little earlier (about a
            // fifth of the line's width, measured by `live-parity --compose`).
            strokeDashoffset={part && !hair && atStart ? DASH_LEAD * stroke.width : undefined}
          />
        )}
        {atStart && <polygon points={triangle(from, -dx, -dy)} fill={color} />}
        {atEnd && <polygon points={triangle(to, dx, dy)} fill={color} />}
      </g>
    </svg>
  );
}

/**
 * One element drawn by the browser: `element` where it shows now (dragged, its box as dragged).
 * `typing`: its text is typed on the edit layer – laid out here unseen, its shape still drawn.
 * `src`: a picture's address (`paint.outline` 'picture').
 */
export function ElementView({
  element,
  live,
  paint,
  src,
  typing = false,
  pageAspect = 16 / 9,
  pageWidthPt,
  textRef,
}: {
  element: EditableElement;
  live: LiveElement | null;
  paint: ElementPaint;
  src?: string;
  typing?: boolean;
  /** The slide's width over its height: a gradient out from a centre is sized by the box. */
  pageAspect?: number;
  /** The slide's width in points: a line is drawn in them. */
  pageWidthPt?: number;
  /** Its text's box, as laid out (a box growing with its text is measured by it). */
  textRef?: Ref<HTMLDivElement>;
}) {
  if (paint.outline === 'picture')
    return src ? <PictureView element={element} src={src} pageAspect={pageAspect} /> : null;
  if (paint.outline === 'line')
    return pageWidthPt ? (
      <LineView element={element} paint={paint} pageWidthPt={pageWidthPt} pageAspect={pageAspect} />
    ) : null;
  if (!live) return null;
  const unseen = typing ? <UnseenText live={live} /> : undefined;
  // A box growing with its text is as high as the text lays out (`LiveElementView`), an empty
  // placeholder drawn as the live editor draws it; any other outline exactly on its box – its
  // padding never makes it higher (a thin bar), an empty line grows it not.
  if ((live.autoGrow && holdsText(live)) || live.placeholder) {
    if (paint.outline === 'rect' && paint.radius === 0) {
      return (
        <LiveElementView ref={textRef} element={element} live={live} prompt="room">
          {unseen}
        </LiveElementView>
      );
    }
  }
  return (
    <>
      <OutlineView element={element} live={live} paint={paint} pageAspect={pageAspect} />
      {/* Its outline drawn above: the text alone (a placeholder's box line not again). */}
      <LiveElementView
        ref={textRef}
        element={element}
        live={live.placeholder ? { ...live, placeholder: false } : live}
        prompt="room"
        textOnly
      >
        {unseen}
      </LiveElementView>
    </>
  );
}
