import type { Slide } from '@slider/shared';
import { useMemo } from 'react';
import { useIsNarrow } from '@/ui';
import { useViewerData } from './viewer-data';
import { useViewerState } from './viewer-state';

/** Shape of the frames in the 16:9 view. */
export const WIDE_FRAME = 16 / 9;

/** Portrait pages (Word, PDF, pictures): only then the 16:9 view is offered. */
export const hasPortraitSlides = (slides: readonly Pick<Slide, 'aspectRatio'>[]) =>
  slides.some((slide) => slide.aspectRatio < 1);

/**
 * Whether the 16:9 view is on (`wideFrames`, and the deck has portrait pages), and every slide's
 * frame shape (width / height) on track and minimap: 16:9 for portrait pages then, else the
 * slide's own – landscape slides always show whole. The page itself keeps its shape, its frame
 * crops it (`stage/lib/slide-zoom`). Never on a phone: there no wheel moves the part a cropped
 * page shows, so pages show whole whatever this browser remembers.
 */
export function useFrameAspects(): { wide: boolean; aspectRatios: readonly number[] } {
  const { slides } = useViewerData();
  const { wideFrames } = useViewerState();
  const narrow = useIsNarrow();
  const wide = wideFrames && !narrow && hasPortraitSlides(slides);
  const aspectRatios = useMemo(
    () => slides.map((slide) => (wide && slide.aspectRatio < 1 ? WIDE_FRAME : slide.aspectRatio)),
    [slides, wide],
  );
  return { wide, aspectRatios };
}
