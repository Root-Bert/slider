/**
 * @slider/pptx – reads PowerPoint files without touching them.
 *
 * Public API (contract for apps/api):
 *
 *   const pkg = await openPptx(bytes);          // throws PptxError
 *   pkg.presentation                            // ParsedPresentation
 *   await pkg.renderSlideSvg(slide)             // self-contained SVG string (images inlined)
 *   await pkg.readFile('ppt/media/image1.png')  // raw bytes or null
 */
export * from './types';
export { openPptx, type PptxPackage } from './package';
