import type { Slide } from '@slider/shared';

/** Below this width the slide shows its thumbnail image and small corners. */
export const THUMB_MAX_W = 320;

/**
 * Raster slide images (Office/LibreOffice, BER-94) come as a 640 px thumbnail and a 2400 px image;
 * `srcset` lets the browser take whichever is sharp at this size and pixel density. SVG previews
 * (thumbnail = image) scale by themselves.
 */
const RASTER_WIDTHS = { thumbnail: 640, image: 2400 };
export function slideSrcSet(slide: Slide, width: number) {
  if (slide.thumbnailUrl === slide.imageUrl) return {};
  return {
    srcSet: `${slide.thumbnailUrl} ${RASTER_WIDTHS.thumbnail}w, ${slide.imageUrl} ${RASTER_WIDTHS.image}w`,
    sizes: `${Math.max(1, Math.round(width))}px`,
  };
}
