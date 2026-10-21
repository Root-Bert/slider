import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { getDocument, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Width of the full slide image and of its thumbnail, in pixels (BER-94). The thumbnail serves
 * every slide shown up to 320 CSS px wide (filmstrip, minimap, deck cards) – sharp at 2× – the
 * full image everything larger.
 */
export const PAGE_IMAGE_WIDTH = 2400;
export const PAGE_THUMBNAIL_WIDTH = 640;
const WEBP_QUALITY = 90;
/**
 * Tallest page drawn, in pixels at {@link PAGE_IMAGE_WIDTH} (a 1:4 page): the canvas is that tall,
 * so a sliver-thin slide size in an uploaded deck would otherwise ask for gigabytes. Such a PDF is
 * refused and the slides keep their SVG preview.
 */
export const MAX_PAGE_HEIGHT = 4 * PAGE_IMAGE_WIDTH;
/**
 * Pictures inside the PDF with more pixels than this are left out of the page instead of decoded
 * (pdf.js decodes them whole, in this process): a small, highly compressed picture of huge
 * dimensions in an uploaded deck must not exhaust the server's memory. Covers 50 MP camera photos.
 */
export const MAX_PDF_IMAGE_PIXELS = 64_000_000;

type RenderParameters = Parameters<PDFPageProxy['render']>[0];

export interface PageImages {
  /** WebP, {@link PAGE_IMAGE_WIDTH} wide. */
  image: Uint8Array;
  /** WebP, {@link PAGE_THUMBNAIL_WIDTH} wide. */
  thumbnail: Uint8Array;
}

// Office PDFs embed their fonts; the standard fonts only back up the rare page that does not.
const STANDARD_FONTS = `${join(
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
 * {@link PageCountMismatch} before any page is drawn. Resolves to the number of pages.
 */
export async function rasterizePdf(
  pdf: Uint8Array,
  onPage: (page: PageImages, index: number) => Promise<void>,
  { expectedPages }: { expectedPages?: number } = {},
): Promise<number> {
  const loading = getDocument({
    // pdf.js takes ownership of (detaches) the buffer it is given.
    data: pdf.slice(),
    standardFontDataUrl: STANDARD_FONTS,
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    verbosity: 0,
  });
  try {
    const document = await loading.promise;
    if (expectedPages !== undefined && document.numPages !== expectedPages) {
      throw new PageCountMismatch(document.numPages, expectedPages);
    }
    // One canvas pair for the whole deck – its pages share a size; a new pair only when a page
    // is taller or shorter than the one before.
    let canvases = null as { full: Canvas; thumbnail: Canvas } | null;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const scaled = page.getViewport({ scale: PAGE_IMAGE_WIDTH / viewport.width });
      const height = Math.round(scaled.height);
      if (!Number.isFinite(height) || height < 1 || height > MAX_PAGE_HEIGHT) {
        throw new Error(`PDF page ${number} is too tall to draw (${height} px)`);
      }
      if (!canvases || canvases.full.height !== height) {
        canvases = {
          full: createCanvas(PAGE_IMAGE_WIDTH, height),
          thumbnail: createCanvas(
            PAGE_THUMBNAIL_WIDTH,
            Math.max(1, Math.round((height * PAGE_THUMBNAIL_WIDTH) / PAGE_IMAGE_WIDTH)),
          ),
        };
      }
      const { full: canvas, thumbnail } = canvases;
      const context = canvas.getContext('2d');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // @napi-rs/canvas implements the subset of the DOM canvas that pdf.js draws with.
      await page.render({
        canvas: canvas as unknown as RenderParameters['canvas'],
        canvasContext: context as unknown as RenderParameters['canvasContext'],
        viewport: scaled,
      }).promise;
      page.cleanup();

      const small = thumbnail.getContext('2d');
      small.setTransform(1, 0, 0, 1, 0, 0);
      small.clearRect(0, 0, thumbnail.width, thumbnail.height);
      small.imageSmoothingEnabled = true;
      small.imageSmoothingQuality = 'high';
      small.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      await onPage(
        {
          image: new Uint8Array(await canvas.encode('webp', WEBP_QUALITY)),
          thumbnail: new Uint8Array(await thumbnail.encode('webp', WEBP_QUALITY)),
        },
        number - 1,
      );
    }
    return document.numPages;
  } finally {
    await loading.destroy();
  }
}
