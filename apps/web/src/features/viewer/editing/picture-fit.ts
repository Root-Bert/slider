import { useMemo, useSyncExternalStore } from 'react';
import {
  CENTRED,
  ellipseArc,
  nativeFill,
  presetPolygon,
  shapeAreaSteps,
  type EditableElement,
  type OutlineStep,
  type FillLayer,
  type ImageFit,
  type PictureFit,
  type PictureFocus,
} from '@slider/shared';
import { useViewerData } from '../state/viewer-data';
import { useEditing } from './editing-context';
import { isComposed } from './compose/composed';

/*
 * A picture's fit being changed (`setImageFit`, or a shape's picture fill): which one has its part
 * chosen on the slide („Ausschnitt“, `PictureFitLayer`) and where that part is so far, and which
 * ones the browser draws until LibreOffice's picture of the change is on screen – the slide's
 * picture of before (`since`) is not taken for it.
 */

interface Pending {
  slideId: string;
  /** The slide's picture when the change was made. */
  since: string | null;
  /** A shape's fill changed: its layers as set (else the element's picture). */
  fills?: readonly FillLayer[];
  /** Which change it is (each one counted). */
  serial: number;
}

/** A shape filled with a picture (a layer of its fill) whose part is chosen, as a picture's. */
export interface FillCrop {
  /** The layer of the element's fill. */
  layer: number;
  src: string;
  fit: ImageFit;
  focus: PictureFocus | null;
  /** Takes the part chosen: the layer filled, showing it. */
  take: (focus: PictureFocus) => void;
}

interface Cropping {
  elementId: string;
  /** The part shown so far; `null`: as the element has it. */
  focus: PictureFocus | null;
  /** A layer of a shape's fill, not a picture element's picture. */
  fill?: FillCrop;
}

let cropping: Cropping | null = null;
/** Takes the part chosen (`CropOnSlide` while it is open). */
let finisher: (() => void) | null = null;
let pending: ReadonlyMap<string, Pending> = new Map();
let serial = 0;
let snapshot: { cropping: Cropping | null; pending: ReadonlyMap<string, Pending> } = {
  cropping,
  pending,
};
const listeners = new Set<() => void>();

function changed() {
  snapshot = { cropping, pending };
  for (const listener of listeners) listener();
}

/**
 * What stands for slide `slideId`'s background where an element's id would (`pictureFit.crop`):
 * its picture's part chosen on the slide as a shape's fill – the whole slide its frame.
 */
export const groundCrop = (slideId: string): string => `ground:${slideId}`;

/** A part chosen told apart from the others (`pictureFit.croppingKey`). */
export const cropKey = (elementId: string, layer?: number): string => `${elementId}:${layer ?? ''}`;

export const pictureFit = {
  /** Which part is being chosen – its element's id, and its layer's – `null`: none. */
  croppingKey(): string | null {
    return cropping ? cropKey(cropping.elementId, cropping.fill?.layer) : null;
  },
  /**
   * Choosing the part of `elementId` shown, on the slide (`null`: done) – its picture's, or that
   * of a layer of its fill (`fill`).
   */
  crop(elementId: string | null, fill?: FillCrop) {
    if ((cropping?.elementId ?? null) === elementId && cropping?.fill?.layer === fill?.layer)
      return;
    cropping = elementId ? { elementId, focus: null, ...(fill && { fill }) } : null;
    changed();
  },
  /** Takes the part chosen so far – as Esc or ↵ on the slide (none on it: the editor left, done). */
  finish() {
    if (finisher) finisher();
    else pictureFit.crop(null);
  },
  /** What {@link finish} calls (`null`: nothing open). */
  finishWith(finish: (() => void) | null) {
    finisher = finish;
  },
  /** The part chosen so far. */
  focus(focus: PictureFocus) {
    if (!cropping) return;
    cropping = { ...cropping, focus };
    changed();
  },
  /**
   * Drawn by the browser until the slide's picture after `since` is on screen – its picture, or
   * the layers of its fill as set (`fills`).
   */
  drawUntilNew(
    elementId: string,
    slideId: string,
    since: string | null,
    fills?: readonly FillLayer[],
  ) {
    serial += 1;
    pending = new Map(pending).set(elementId, {
      slideId,
      since,
      serial,
      ...(fills && { fills }),
    });
    changed();
  },
  drawn(elementId: string) {
    if (!pending.has(elementId)) return;
    const next = new Map(pending);
    next.delete(elementId);
    pending = next;
    changed();
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function usePictureFit() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/**
 * A slide's background layers as drawn while its picture's part is being chosen on the slide
 * (`groundCrop`): that layer filling the slide with the part chosen so far – the browser draws the
 * slide's own background (`SlideGround`), so it follows each move in the same frame.
 */
export function useCroppedGround(
  slideId: string,
  fills: readonly FillLayer[],
): readonly FillLayer[] {
  const { cropping } = usePictureFit();
  const crop = cropping?.elementId === groundCrop(slideId) ? cropping : null;
  return useMemo(() => {
    const at = crop?.fill?.layer;
    const layer = at === undefined ? undefined : fills[at];
    if (!crop || layer?.type !== 'image') return fills;
    const focus = crop.focus ?? (layer.fit === 'fill' ? (layer.focus ?? CENTRED) : CENTRED);
    return fills.map((item, index): FillLayer =>
      index === at ? { ...layer, fit: 'fill', focus } : item,
    );
  }, [crop, fills]);
}

/**
 * Sets how a picture fills its frame (`setImageFit`) – shown at once: the browser draws it so
 * until LibreOffice's picture of the change is on screen.
 */
export function useFitPicture(slideId: string) {
  const editing = useEditing();
  const { slides } = useViewerData();
  return (element: EditableElement, fit: PictureFit, focus?: PictureFocus) => {
    const since = slides.find((slide) => slide.id === slideId)?.imageUrl ?? null;
    // Drawn by the browser on a composed slide (`paint`): shown changed in the same frame, from the
    // element as it is now – nothing to draw over it until LibreOffice's picture.
    if (!element.tilt && !(element.paint && isComposed(slideId)))
      pictureFit.drawUntilNew(element.id, slideId, since);
    void editing.apply([
      { type: 'setImageFit', elementId: element.id, fit, ...(focus && { focus }) },
    ]);
  };
}

const CM_PER_PT = 2.54 / 72;

/**
 * Whether the browser draws a shape's layers at once over it (`FillsDrawn`) until LibreOffice's
 * picture of them: ones the file shows as a picture of them all, a picture among them – not a
 * gradient (drawn as LibreOffice does only alone) nor a tiled picture.
 */
export function drawsFillsAtOnce(fills: readonly FillLayer[]): boolean {
  const shown = fills.filter((layer) => layer.visible);
  return (
    nativeFill(fills) === 'composite' &&
    shown.some((layer) => layer.type === 'image') &&
    !shown.some(
      (layer) => layer.type === 'gradient' || (layer.type === 'image' && layer.fit === 'tile'),
    )
  );
}

/** Where a shape's fill drawn over it lies: its area's upright bounds, cut to the area. */
export interface FillArea {
  /** The bounds on the slide (shares of it) – a shape's box, unless turned or its own outline. */
  box: { x: number; y: number; w: number; h: number };
  /** A CSS mask over `box`: the shape's area inside its line. */
  mask: string;
}

type Point = [number, number];

/** A shape's area as LibreOffice outlines it, in its box (`w` × `h` cm), not mirrored. */
function areaSteps(element: EditableElement, w: number, h: number): OutlineStep[] | null {
  const outline = element.outline;
  if (outline?.type === 'ellipse' && !outline.path) {
    const { start, steps } = ellipseArc([w / 2, h / 2], w / 2, h / 2, 0, 2 * Math.PI);
    return [{ op: 'M', points: [start] }, ...steps, { op: 'Z', points: [] }];
  }
  if (outline?.path) return shapeAreaSteps(outline.path, outline.type, outline.modifiers, w, h);
  if (outline) {
    const corners = presetPolygon(outline);
    if (!corners) return null;
    return [
      ...corners.map(([x, y], i): OutlineStep => ({
        op: i === 0 ? 'M' : 'L',
        points: [[x * w, y * h]],
      })),
      { op: 'Z', points: [] },
    ];
  }
  if (element.cornerRadius === undefined) return null;
  // A box, its corners rounded as the browser draws one (`ElementView`).
  const r = Math.max(0, Math.min(element.cornerRadius * CM_PER_PT, w / 2, h / 2));
  const corner = (cx: number, cy: number, from: number) =>
    r > 0 ? ellipseArc([cx, cy], r, r, from, from + Math.PI / 2).steps : [];
  return [
    { op: 'M', points: [[r, 0]] },
    { op: 'L', points: [[w - r, 0]] },
    ...corner(w - r, r, -Math.PI / 2),
    { op: 'L', points: [[w, h - r]] },
    ...corner(w - r, h - r, 0),
    { op: 'L', points: [[r, h]] },
    ...corner(r, h - r, Math.PI / 2),
    { op: 'L', points: [[0, r]] },
    ...corner(r, r, Math.PI),
    { op: 'Z', points: [] },
  ];
}

/**
 * Where the browser may draw a shape's new fill over it (`FillsDrawn`) until LibreOffice's picture
 * of it shows – its area inside its line (a box with its corners, an ellipse, a preset polygon, an
 * outline of its own) over the bounds LibreOffice lays a picture fill on: the area's own, upright
 * when the shape is turned, not mirrored with it (measured, `live-parity --compose`). `null` where
 * it cannot tell the area (an outline it cannot read).
 */
export function fillArea(
  element: EditableElement,
  page: { width: number; height: number },
): FillArea | null {
  const w = element.bbox.w * page.width;
  const h = element.bbox.h * page.height;
  if (!(w > 0) || !(h > 0)) return null;
  const steps = areaSteps(element, w, h);
  if (!steps) return null;
  // Mirrored in its box, turned about its centre (clockwise as seen), in cm from the centre.
  const turn = ((element.rotation ?? 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
  const placed = ([x, y]: Point): Point => {
    const mx = (element.flip?.x ? w - x : x) - w / 2;
    const my = (element.flip?.y ? h - y : y) - h / 2;
    return [mx * cos - my * sin, mx * sin + my * cos];
  };
  const moved = steps.map((step) => ({ ...step, points: step.points.map(placed) }) as OutlineStep);
  // Its upright bounds: along its curves too.
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  const take = ([x, y]: Point) => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  let at: Point = [0, 0];
  for (const step of moved) {
    if (step.op === 'C') {
      const [a, b, c] = step.points;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        take([
          u * u * u * at[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0],
          u * u * u * at[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1],
        ]);
      }
      at = c;
    } else if (step.op !== 'Z') {
      take(step.points[0]);
      at = step.points[0];
    }
  }
  // PowerPoint's shapes (as LibreOffice imports them) take the turned box's bounds instead
  // (measured, `live-parity --compose`).
  if (element.outline?.type.startsWith('ooxml-')) {
    [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const corner of [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ] as Point[])
      take(placed(corner));
  }
  const [bw, bh] = [right - left, bottom - top];
  if (!(bw > 0) || !(bh > 0)) return null;
  const n = (value: number) => String(Math.round(value * 10000) / 10000);
  const dOf = (outline: readonly OutlineStep[]) =>
    outline
      .map((step) =>
        step.op === 'Z'
          ? 'Z'
          : `${step.op}${step.points.map(([x, y]) => `${n(x - left)} ${n(y - top)}`).join(' ')}`,
      )
      .join('');
  // Inside its line: the line (centred on the outline) taken off.
  const stroke = element.look?.stroke;
  const line = stroke && stroke.width > 0 ? stroke.width * CM_PER_PT : 0;
  const outline = element.outline;
  // Parts of its outline drawn only as lines (a cloud's arcs inside it): taken off too.
  const lines =
    line && outline?.path
      ? (shapeAreaSteps(outline.path, outline.type, outline.modifiers, w, h, true) ?? [])
      : [];
  const linesD = dOf(
    lines.map((step) => ({ ...step, points: step.points.map(placed) }) as OutlineStep),
  );
  const lineAttrs = `stroke="#000" stroke-width="${n(line)}" stroke-linejoin="round"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(bw)} ${n(bh)}" preserveAspectRatio="none">` +
    `<mask id="a" maskUnits="userSpaceOnUse" x="0" y="0" width="${n(bw)}" height="${n(bh)}">` +
    `<path d="${dOf(moved)}" fill="#fff" fill-rule="evenodd"${line ? ` ${lineAttrs}` : ''}/>` +
    (linesD ? `<path d="${linesD}" fill="none" ${lineAttrs}/>` : '') +
    `</mask><rect width="${n(bw)}" height="${n(bh)}" mask="url(#a)"/></svg>`;
  const cx = element.bbox.x + element.bbox.w / 2;
  const cy = element.bbox.y + element.bbox.h / 2;
  return {
    box: {
      x: cx + left / page.width,
      y: cy + top / page.height,
      w: bw / page.width,
      h: bh / page.height,
    },
    mask: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
  };
}
