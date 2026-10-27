import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runPdfTask } from './pdf-jobs';

/**
 * Width of the full slide image and of its thumbnail, in pixels (BER-94). The thumbnail serves
 * every slide shown up to 320 CSS px wide (filmstrip, minimap, deck cards) – sharp at 2× – the
 * full image everything larger – up to a 4K screen in the slide show, at full width.
 */
export const PAGE_IMAGE_WIDTH = 3840;
export const PAGE_THUMBNAIL_WIDTH = 640;
/**
 * Tallest page drawn, in pixels at {@link PAGE_IMAGE_WIDTH} (a 1:4 page): the canvas is that tall,
 * so a sliver-thin slide size in an uploaded deck would otherwise ask for gigabytes. Such a PDF is
 * refused and the slides keep their SVG preview.
 */
export const MAX_PAGE_HEIGHT = 4 * PAGE_IMAGE_WIDTH;
/**
 * Pictures inside the PDF with more pixels than this are left out of the page instead of decoded
 * (pdf.js decodes them whole, in its worker): a small, highly compressed picture of huge
 * dimensions in an uploaded deck must not exhaust the server's memory. Covers 50 MP camera photos.
 */
export const MAX_PDF_IMAGE_PIXELS = 64_000_000;

/** Path of a PDF page in a parsed slide: how the pipeline tells it from a PowerPoint slide. */
export const PAGE_PATH = 'pdf:page/';

export interface PageImages {
  /** WebP, {@link PAGE_IMAGE_WIDTH} wide. */
  image: Uint8Array;
  /** WebP, {@link PAGE_THUMBNAIL_WIDTH} wide. */
  thumbnail: Uint8Array;
}

/**
 * `slide`: WebP and its thumbnail, what slides are shown as. `quick`: the picture a JPEG – about
 * ten times quicker to encode at full size – the thumbnail WebP; for an edited slide someone
 * waits for, replaced by its WebP right after. `backdrop`: the JPEG only (the thumbnail empty),
 * for the pictures the editor types over, shown a few seconds at most.
 */
export type PagePicture = 'slide' | 'quick' | 'backdrop';

/**
 * An element's cutout (`OdpDocument.toCutoutBytes`, drawn by {@link drawCutout}): its area and its
 * outline as masks – PNG, black, opaque where LibreOffice drew – cut to `box`, the part of the
 * slide (0–1) either covers. `null`: nothing drawn (no area, no outline).
 */
export interface CutoutImages {
  fill: Uint8Array | null;
  stroke: Uint8Array | null;
  box: { x: number; y: number; w: number; h: number } | null;
  /** What lies over the element, as drawn (PNG, see-through around it), cut to `aboveBox`. */
  above: Uint8Array | null;
  aboveBox: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Width a slide taken apart for the layers view is drawn at: each layer is seen tilted and
 * smaller than the slide, and a slide holds a few dozen of them.
 */
export const LAYER_IMAGE_WIDTH = 1920;

/**
 * A slide taken apart (`OdpDocument.toLayerBytes`, drawn by {@link drawLayers}): the slide
 * without its elements (JPEG; `null` when not asked for), and each element alone (PNG, see-through around it) cut to `box`,
 * the part of the slide (0–1) it covers – `null` both when it draws nothing.
 */
export interface LayerImages {
  background: Uint8Array | null;
  layers: {
    image: Uint8Array | null;
    box: { x: number; y: number; w: number; h: number } | null;
  }[];
}

/**
 * Draws a slide taken apart from its PDF – its first page the slide without its elements when
 * `background` – in a worker with a deadline, in the line of what someone waits for when
 * `interactive`, else after it (a slide beside the one looked at).
 */
export function drawLayers(
  pdf: Uint8Array,
  { interactive = true, background = true } = {},
): Promise<LayerImages> {
  return runPdfTask({ kind: 'layers', bytes: pdf, background }, undefined, { interactive });
}

/**
 * Draws an element's cutout from its PDF (area, outline, and what lies over it if anything does),
 * in a worker with a deadline.
 */
export function drawCutout(pdf: Uint8Array): Promise<CutoutImages> {
  return runPdfTask({ kind: 'cutout', bytes: pdf }, undefined, { interactive: true });
}

// Office PDFs embed their fonts; the standard fonts only back up the rare page that does not.
export const STANDARD_FONTS = `${join(
  dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
  'standard_fonts',
)}/`;

/** The PDF does not have the page count the caller can use; no page was drawn. */
export class PageCountMismatch extends Error {
  constructor(
    readonly pages: number,
    readonly expected: number,
  ) {
    super(`PDF has ${pages} pages, expected ${expected}`);
    this.name = 'PageCountMismatch';
  }
}

/**
 * Renders every page of a PDF to WebP images, in page order, and hands each page to `onPage`
 * before the next one is drawn – so only one page's images are in memory at a time, however
 * long the deck. With `expectedPages`, a PDF with another page count is refused with
 * {@link PageCountMismatch} before any page is drawn. Resolves to the number of pages. Drawn in
 * a worker thread with a deadline (`pdf-jobs.ts`): a PDF that takes too long ends in
 * `PdfTimedOut`.
 */
export function rasterizePdf(
  pdf: Uint8Array,
  onPage: (page: PageImages, index: number) => Promise<void>,
  {
    expectedPages,
    picture,
    interactive,
  }: {
    expectedPages?: number;
    picture?: PagePicture;
    /** Someone waits for it on screen: drawn in a line of its own, not after imports. */
    interactive?: boolean;
  } = {},
): Promise<number> {
  return runPdfTask({ kind: 'pages', bytes: pdf, expectedPages, picture }, onPage, { interactive });
}
