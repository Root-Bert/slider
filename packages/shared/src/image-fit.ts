import { z } from 'zod';

/*
 * How a picture fills its frame: „Füllen“ – cropped to the frame, its proportions kept, the part
 * shown chosen by a focus (its middle and how far it is zoomed in) – or „Strecken“ – the whole
 * picture stretched to the frame. In the file: the picture's `fo:clip`.
 */

export const pictureFitSchema = z.enum(['fill', 'stretch']);
export type PictureFit = z.infer<typeof pictureFitSchema>;

/** The part of a filled picture shown: its middle (a share of the picture) and zoom (≥ 1). */
export const pictureFocusSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  zoom: z.number().min(1).max(20),
});
export type PictureFocus = z.infer<typeof pictureFocusSchema>;

/** A picture element's picture and how it fills its frame (`setImageFit`). */
export const elementPictureSchema = z.object({
  /** The file's picture (`Pictures/…`), `null` when it shows none of its own. */
  src: z.string().nullable(),
  /** Its width over its height; `null` while unknown (a picture not fitted in Slider yet). */
  aspect: z.number().positive().nullable(),
  fit: pictureFitSchema,
  /** Filled: the part shown; `null`: the middle, not zoomed in. */
  focus: pictureFocusSchema.nullable(),
});
export type ElementPicture = z.infer<typeof elementPictureSchema>;

/** A part of a picture, each a share of its width or height. */
export interface PictureCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CENTRED: PictureFocus = { x: 0.5, y: 0.5, zoom: 1 };

/**
 * The part of a picture (`aspect`: its width over its height) a frame (`frameAspect`) filled with
 * it shows: as much as fits in the frame's proportions, zoomed in by `focus.zoom`, around its
 * middle – pushed back inside the picture where it would reach beyond.
 */
export function coverCrop(
  aspect: number,
  frameAspect: number,
  focus: PictureFocus | null = null,
): PictureCrop {
  if (!(aspect > 0) || !(frameAspect > 0)) return { x: 0, y: 0, w: 1, h: 1 };
  const { x, y, zoom } = focus ?? CENTRED;
  const wider = frameAspect > aspect;
  const w = (wider ? 1 : frameAspect / aspect) / Math.max(1, zoom);
  const h = (wider ? aspect / frameAspect : 1) / Math.max(1, zoom);
  const clamp = (at: number, size: number) => Math.min(1 - size, Math.max(0, at - size / 2));
  return { x: clamp(x, w), y: clamp(y, h), w, h };
}

/** The focus that shows `crop` (as {@link coverCrop} would): its middle, pushed inside. */
export function focusOf(aspect: number, frameAspect: number, crop: PictureCrop): PictureFocus {
  const whole = coverCrop(aspect, frameAspect);
  const zoom = Math.min(20, Math.max(1, crop.w > 0 ? whole.w / crop.w : 1));
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return {
    x: round(Math.min(1, Math.max(0, crop.x + crop.w / 2))),
    y: round(Math.min(1, Math.max(0, crop.y + crop.h / 2))),
    zoom: round(zoom),
  };
}

/** What a picture shows of itself in its frame: filled, its crop; stretched, all of it. */
export function shownCrop(picture: ElementPicture, frameAspect: number): PictureCrop {
  return picture.fit === 'fill' && picture.aspect
    ? coverCrop(picture.aspect, frameAspect, picture.focus)
    : { x: 0, y: 0, w: 1, h: 1 };
}
