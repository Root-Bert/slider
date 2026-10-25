import { createHash } from 'node:crypto';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import {
  MAX_SLIDES,
  PptxError,
  textHash,
  type ParsedShape,
  type ParsedShapeKind,
  type ParsedSlide,
} from '@slider/pptx';
import type { Shape } from '@slider/shared';
import { getDocument, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageBoxes, RECORD_BOXES } from './pdf-boxes';
import {
  MAX_PAGE_HEIGHT,
  MAX_PDF_IMAGE_PIXELS,
  PAGE_IMAGE_WIDTH,
  PAGE_THUMBNAIL_WIDTH,
  PAGE_PATH,
  PageCountMismatch,
  STANDARD_FONTS,
  type PageImages,
} from './pdf-pages';

/*
 * The heavy part of reading a PDF: pdf.js parses it and draws its pages, in the PDF worker
 * (`pdf-worker.ts`, started by `pdf-jobs.ts`) – never on the server's main thread, where a
 * crafted PDF would hold up every request. Only plain data leaves here; the callers' wrappers are
 * `openPdfDeck` (pdf-deck.ts) and `rasterizePdf` (pdf-pages.ts).
 */

/** Width a page is drawn at to measure its boxes – they are fractions of the page anyway. */
const MEASURE_WIDTH = 800;
const WEBP_QUALITY = 90;

type RenderParameters = Parameters<PDFPageProxy['render']>[0];

/** What {@link readPdfDeck} found: everything `openPdfDeck` needs to build the document. */
export interface PdfDeckData {
  /** Size of the first page, in PDF points. */
  size: { width: number; height: number };
  author: string | null;
  /** Its pages as slides, the shapes being their boxes (`pdf-boxes.ts`). */
  slides: ParsedSlide[];
  /** What each page looks like (hash of its pixels), for the render hash. */
  looks: string[];
}

const KIND: Record<string, ParsedShapeKind> = { t: 'text', i: 'picture', g: 'table' };

const toParsedShape = (shape: Shape): ParsedShape => ({
  ...shape,
  kind: KIND[shape.id.replace(/\d+$/, '')] ?? 'other',
  paragraphs: [],
  imagePath: null,
  fill: null,
  placeholder: null,
});

/**
 * Opens a PDF for pdf.js. The bytes are handed over: pdf.js takes ownership of (detaches) the
 * buffer – the worker got its own copy.
 */
const open = (bytes: Uint8Array) =>
  getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS,
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    verbosity: 0,
  });

/** Told the page count as soon as the PDF is open – the worker's deadline grows with it. */
export type OnPdfOpened = (pages: number) => void;

/** A PDF as the import reads a PowerPoint: its pages as slides with their boxes. */
export async function readPdfDeck(
  bytes: Uint8Array,
  onOpened: OnPdfOpened = () => {},
): Promise<PdfDeckData> {
  const loading = open(bytes);
  try {
    const document = await loading.promise.catch((error: unknown) => {
      throw (error as { name?: string } | null)?.name === 'PasswordException'
        ? new PptxError('encrypted', 'PDF is password protected')
        : new PptxError('corrupt', 'PDF could not be read');
    });
    if (document.numPages > MAX_SLIDES) {
      throw new PptxError('too_many_slides', `PDF has ${document.numPages} pages`);
    }
    onOpened(document.numPages);
    const info = (await document.getMetadata().catch(() => null))?.info as
      { Author?: unknown } | undefined;
    const slides: ParsedSlide[] = [];
    const looks: string[] = [];
    let size = { width: 0, height: 0 };
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      if (number === 1) size = { width: viewport.width, height: viewport.height };
      const scaled = page.getViewport({ scale: MEASURE_WIDTH / viewport.width });
      const height = Math.max(1, Math.min(4 * MEASURE_WIDTH, Math.round(scaled.height)));
      const canvas = createCanvas(MEASURE_WIDTH, height);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // @napi-rs/canvas implements the subset of the DOM canvas that pdf.js draws with.
      await page.render({
        canvas: canvas as unknown as RenderParameters['canvas'],
        canvasContext: context as unknown as RenderParameters['canvasContext'],
        viewport: scaled,
        ...RECORD_BOXES,
      }).promise;
      const shapes = await pageBoxes(page);
      page.cleanup();
      looks.push(
        createHash('sha256')
          .update(new Uint8Array(context.getImageData(0, 0, canvas.width, height).data))
          .digest('hex'),
      );
      const text = shapes
        .map((shape) => shape.text)
        .filter(Boolean)
        .join('\n');
      const title =
        shapes
          .find((shape) => shape.text)
          ?.text.split('\n')[0]
          ?.slice(0, 200) ?? null;
      slides.push({
        // No PowerPoint id: `isPdfPage` keeps it out of matching and storage.
        sldId: 0,
        index: number - 1,
        path: `${PAGE_PATH}${number}`,
        hidden: false,
        title,
        layoutName: null,
        textHash: textHash(text),
        // What a PDF page shows is all in its render hash.
        contentHash: '',
        creationId: null,
        shapes: shapes.map(toParsedShape),
        groups: [],
        background: null,
        guides: [],
      });
    }
    return {
      size,
      author: typeof info?.Author === 'string' && info.Author.trim() ? info.Author.trim() : null,
      slides,
      looks,
    };
  } finally {
    await loading.destroy();
  }
}

/**
 * Draws every page of a PDF to WebP images, in page order, and hands each page to `onPage`
 * before the next one is drawn. With `expectedPages`, a PDF with another page count is refused
 * with {@link PageCountMismatch} before any page is drawn. Resolves to the number of pages.
 */
export async function drawPdfPages(
  pdf: Uint8Array,
  onPage: (page: PageImages, index: number) => Promise<void>,
  { expectedPages, onOpened }: { expectedPages?: number; onOpened?: OnPdfOpened } = {},
): Promise<number> {
  const loading = open(pdf);
  try {
    const document = await loading.promise;
    if (expectedPages !== undefined && document.numPages !== expectedPages) {
      throw new PageCountMismatch(document.numPages, expectedPages);
    }
    onOpened?.(document.numPages);
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
