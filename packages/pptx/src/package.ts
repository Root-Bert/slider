import { Archive } from './archive';
import { parsePresentation } from './presentation';
import { renderSlideSvg } from './render/svg';
import type { ParsedPresentation, ParsedSlide } from './types';

export interface PptxPackage {
  presentation: ParsedPresentation;
  /** Raw bytes of any zip entry, or null if missing. */
  readFile(path: string): Promise<Uint8Array | null>;
  /** Self-contained SVG for one slide (images inlined as data URIs), width 1920, height by aspect ratio. */
  renderSlideSvg(slide: ParsedSlide): Promise<string>;
}

/**
 * Opens a PPTX file and parses it eagerly. The input is never modified.
 *
 * @throws {PptxError} `encrypted` for password-protected files, `not_pptx` for anything that is
 *   not a PowerPoint package, `corrupt` for packages with broken or missing parts.
 */
export async function openPptx(data: Uint8Array | ArrayBuffer): Promise<PptxPackage> {
  const archive = await Archive.open(data);
  const presentation = await parsePresentation(archive);
  const readFile = (path: string) => archive.readBytes(path);
  return {
    presentation,
    readFile,
    renderSlideSvg: (slide) => renderSlideSvg(slide, presentation.size, readFile),
  };
}
