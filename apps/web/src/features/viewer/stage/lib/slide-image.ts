import type { Slide } from '@slider/shared';

/** Below this width the slide shows its thumbnail image and small corners. */
export const THUMB_MAX_W = 320;

/**
 * Raster slide images (Office/LibreOffice, BER-94) come as a 640 px thumbnail and a 3840 px image;
 * `srcset` lets the browser take whichever is sharp at this size and pixel density. SVG previews
 * (thumbnail = image) scale by themselves. `'screen'`: as wide as the viewport, whatever it
 * becomes (fullscreen).
 */
const RASTER_WIDTHS = { thumbnail: 640, image: 3840 };
export function slideSrcSet(slide: Slide, width: number | 'screen') {
  if (slide.thumbnailUrl === slide.imageUrl) return {};
  return {
    srcSet: `${slide.thumbnailUrl} ${RASTER_WIDTHS.thumbnail}w, ${slide.imageUrl} ${RASTER_WIDTHS.image}w`,
    sizes: width === 'screen' ? '100vw' : `${Math.max(1, Math.round(width))}px`,
  };
}
