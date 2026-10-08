import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Width of the full slide image and of its thumbnail, in pixels (BER-94). */
export const PAGE_IMAGE_WIDTH = 2400;
export const PAGE_THUMBNAIL_WIDTH = 240;
const WEBP_QUALITY = 90;

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

/** Renders every page of a PDF to WebP images, in page order. */
export async function rasterizePdf(pdf: Uint8Array): Promise<PageImages[]> {
  const loading = getDocument({
    // pdf.js takes ownership of (detaches) the buffer it is given.
    data: pdf.slice(),
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  });
  try {
    const document = await loading.promise;
    const pages: PageImages[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const scaled = page.getViewport({ scale: PAGE_IMAGE_WIDTH / viewport.width });
      const canvas = createCanvas(PAGE_IMAGE_WIDTH, Math.round(scaled.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // @napi-rs/canvas implements the subset of the DOM canvas that pdf.js draws with.
      await page.render({
        canvas: canvas as unknown as RenderParameters['canvas'],
        canvasContext: context as unknown as RenderParameters['canvasContext'],
        viewport: scaled,
      }).promise;
      page.cleanup();

      const thumbnail = createCanvas(
        PAGE_THUMBNAIL_WIDTH,
        Math.max(1, Math.round((canvas.height * PAGE_THUMBNAIL_WIDTH) / canvas.width)),
      );
      thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
      pages.push({
        image: new Uint8Array(await canvas.encode('webp', WEBP_QUALITY)),
        thumbnail: new Uint8Array(await thumbnail.encode('webp', WEBP_QUALITY)),
      });
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}
