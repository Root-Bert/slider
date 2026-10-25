import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runPdfTask } from './pdf-jobs';

/**
 * Width of the full slide image and of its thumbnail, in pixels (BER-94). The thumbnail serves
 * every slide shown up to 320 CSS px wide (filmstrip, minimap, deck cards) – sharp at 2× – the
 * full image everything larger.
 */
export const PAGE_IMAGE_WIDTH = 2400;
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
  { expectedPages }: { expectedPages?: number } = {},
): Promise<number> {
  return runPdfTask({ kind: 'pages', bytes: pdf, expectedPages }, onPage);
}
