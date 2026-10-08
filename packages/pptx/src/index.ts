/**
 * @slider/pptx – reads PowerPoint files; the only write is inserting an empty slide.
 *
 * Public API (contract for apps/api):
 *
 *   const pkg = await openPptx(bytes);          // throws PptxError
 *   pkg.presentation                            // ParsedPresentation
 *   await pkg.renderSlideSvg(slide)             // self-contained SVG string (images inlined)
 *   await pkg.readFile('ppt/media/image1.png')  // raw bytes or null
 *   matchSlides(prevFingerprints, nextFingerprints) // slide matching across revisions (BER-108)
 *   await insertSlide(bytes, { afterSldId })    // the one write: an empty slide (BER-128)
 */
export * from './types';
export { openPptx, type PptxPackage } from './package';
export * from './matching';
export { normaliseText, textHash } from './hash';
export {
  insertSlide,
  SlideInsertError,
  type InsertSlideOptions,
  type InsertSlideResult,
} from './edit/insert-slide';
