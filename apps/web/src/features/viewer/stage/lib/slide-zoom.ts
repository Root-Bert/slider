import type { Point } from '@slider/shared';

/**
 * Zoom inside one slide: past the largest slide size, pinch and Ctrl/⌘ + wheel keep zooming into
 * the slide under the pointer, which stays the same size on the track and crops its content.
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

/** Deepest zoom: at 8× a 2400 px slide image is about as sharp as it gets. */
export const SLIDE_ZOOM_MAX = 8;

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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampView = ({ scale, x, y }: View, cover: Cover): View => ({
  scale,
  x: clamp(x, 0, 1 - 1 / (scale * cover.x)),
  y: clamp(y, 0, 1 - 1 / (scale * cover.y)),
});

/** What a cropped slide shows before anyone moves it: its top, centred sideways. */
export const startView = (cover: Cover): View => ({
  scale: 1,
  x: (1 - 1 / cover.x) / 2,
  y: 0,
});

/**
 * Zooms by `factor` around `focus` (a spot on the visible frame, 0–1) – that spot of the slide
 * stays under the pointer. Back at 1× or below the zoom ends (`null`) – a cropped slide keeps
 * filling its frame at 1×, around the same spot.
 */
export function zoomAround(
  zoom: View | null,
  factor: number,
  focus: Point,
  cover: Cover = NO_COVER,
): View | null {
  const from = zoom ?? startView(cover);
  const scale = Math.min(SLIDE_ZOOM_MAX, from.scale * factor);
  if (scale <= 1 && !isCropped(cover)) return null;
  const to = Math.max(1, scale);
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

/** Position and size of the zoomed slide inside its frame of `w` × `h` pixels. */
export const zoomedBox = (zoom: View, w: number, h: number, cover: Cover = NO_COVER) => {
  const width = zoom.scale * cover.x * w;
  const height = zoom.scale * cover.y * h;
  return { left: -zoom.x * width, top: -zoom.y * height, width, height };
};
