import type { ParsedPresentation, ParsedSlide } from '@slider/pptx';

/**
 * What the import pipeline needs from `@slider/pptx`. Injected so routes and tests
 * can run without the real parser; `server.ts` wires in `openPptx`.
 */
export interface PptxDocument {
  presentation: ParsedPresentation;
  renderSlideSvg(slide: ParsedSlide): Promise<string>;
}

export type OpenPptx = (bytes: Uint8Array) => Promise<PptxDocument>;
