import { clamp, type Point } from '@slider/shared';

/**
 * Zoom inside one slide: pinch and Ctrl/⌘ + wheel over a slide zoom into it, around the pointer;
 * it stays the same size on the track and crops its content. Zoomed out (below 1×), the slide
 * sits smaller in its frame, around the pointer too – room around it for what lies off the slide.
 * `x`/`y` is the top left corner of the visible part in slide coordinates (0–1), so the visible
 * part is `1 / scale` of the slide each way – times `1 / cover` in a frame of another shape.
 * In such a frame (portrait pages in 16:9 frames) the slide fills it at 1× and is cropped already,
 * so a view at 1× still says which part shows.
 */
export interface SlideZoom {
  slideId: string;
  scale: number;
  x: number;
  y: number;
}

/** Deepest zoom: at 8× a 3840 px slide image is about as sharp as it gets. */
export const SLIDE_ZOOM_MAX = 8;
/** Furthest out: the slide at half its frame. */
export const SLIDE_ZOOM_MIN = 0.5;

type View = Pick<SlideZoom, 'scale' | 'x' | 'y'>;

/**
 * How much bigger than its frame the slide is laid out at 1× so it fills the frame, each way
 * (one of the two is 1). `{ x: 1, y: 1 }`: frame and slide have the same shape.
 */
export interface Cover {
  x: number;
  y: number;
}

export const NO_COVER: Cover = { x: 1, y: 1 };

/** Cover of a slide of aspect `slideAspect` (width / height) in a frame of `frameAspect`. */
export const coverOf = (slideAspect: number, frameAspect: number): Cover =>
  slideAspect < frameAspect
    ? { x: 1, y: frameAspect / slideAspect }
    : { x: slideAspect / frameAspect, y: 1 };

/** The slide is cropped even unzoomed (more than a rounding error). */
export const isCropped = (cover: Cover) => cover.x > 1.005 || cover.y > 1.005;

/**
 * The visible part on the slide, `span` of it wide: kept on the slide – or, wider than it (zoomed
 * out), the slide kept whole in the frame, wherever there.
 */
const placed = (at: number, span: number) =>
  span >= 1 ? clamp(at, 1 - span, 0) : clamp(at, 0, 1 - span);

const clampView = ({ scale, x, y }: View, cover: Cover): View => ({
  scale,
  x: placed(x, 1 / (scale * cover.x)),
  y: placed(y, 1 / (scale * cover.y)),
});

/** What a cropped slide shows before anyone moves it: its top, centred sideways. */
export const startView = (cover: Cover): View => ({
  scale: 1,
  x: (1 - 1 / cover.x) / 2,
  y: 0,
});

/**
 * Zooms by `factor` around `focus` (a spot on the visible frame, 0–1) – that spot of the slide
 * stays under the pointer. Passing 1× it stops there, and there the zoom ends (`null`) – a cropped
 * slide keeps filling its frame at 1×, around the same spot.
 */
export function zoomAround(
  zoom: View | null,
  factor: number,
  focus: Point,
  cover: Cover = NO_COVER,
): View | null {
  const from = zoom ?? startView(cover);
  const wanted = clamp(from.scale * factor, SLIDE_ZOOM_MIN, SLIDE_ZOOM_MAX);
  const to = (from.scale - 1) * (wanted - 1) < 0 ? 1 : wanted;
  if (to === 1 && !isCropped(cover)) return null;
  const spot = {
    x: from.x + focus.x / (from.scale * cover.x),
    y: from.y + focus.y / (from.scale * cover.y),
  };
  return clampView(
    { scale: to, x: spot.x - focus.x / (to * cover.x), y: spot.y - focus.y / (to * cover.y) },
    cover,
  );
}

/** Moves the visible part by a share of the frame (`dx`/`dy`, 1 = one frame width/height). */
export const panBy = (zoom: View, dx: number, dy: number, cover: Cover = NO_COVER): View =>
  clampView(
    {
      scale: zoom.scale,
      x: zoom.x + dx / (zoom.scale * cover.x),
      y: zoom.y + dy / (zoom.scale * cover.y),
    },
    cover,
  );

/** Moved this close (px) to the middle of its frame, a slide zoomed out lies there (`snappedCentre`). */
export const CENTRE_SNAP_PX = 16;

/**
 * A slide zoomed out and moved, caught in the middle of its frame of `w` × `h` pixels – each way
 * it is smaller than the frame, once it is that close (`CENTRE_SNAP_PX`).
 */
export const snappedCentre = (zoom: View, w: number, h: number, cover: Cover = NO_COVER): View => {
  const caught = (at: number, span: number, size: number) => {
    // As large as the frame this way, or larger: nothing to centre.
    if (span <= 1) return at;
    const centred = (1 - span) / 2;
    return Math.abs(at - centred) * size <= CENTRE_SNAP_PX ? centred : at;
  };
  return {
    scale: zoom.scale,
    x: caught(zoom.x, 1 / (zoom.scale * cover.x), zoom.scale * cover.x * w),
    y: caught(zoom.y, 1 / (zoom.scale * cover.y), zoom.scale * cover.y * h),
  };
};

/**
 * Each way a slide zoomed out lies in the middle of its frame, as `snappedCentre` catches it:
 * `'x'`, `'y'`, both (`'xy'`) or neither (`''`).
 */
export const centredWays = (zoom: View, cover: Cover = NO_COVER): string => {
  const centred = (at: number, span: number) => span > 1 && Math.abs(at - (1 - span) / 2) < 1e-9;
  return (
    (centred(zoom.x, 1 / (zoom.scale * cover.x)) ? 'x' : '') +
    (centred(zoom.y, 1 / (zoom.scale * cover.y)) ? 'y' : '')
  );
};

/** Position and size of the zoomed slide inside its frame of `w` × `h` pixels. */
export const zoomedBox = (zoom: View, w: number, h: number, cover: Cover = NO_COVER) => {
  const width = zoom.scale * cover.x * w;
  const height = zoom.scale * cover.y * h;
  return { left: -zoom.x * width, top: -zoom.y * height, width, height };
};
