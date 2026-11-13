import { createCanvas } from '@napi-rs/canvas';
import { PptxError } from '@slider/pptx';
import { getDocument, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MAX_PAGE_HEIGHT, MAX_PDF_IMAGE_PIXELS, STANDARD_FONTS } from './pdf-pages';

/*
 * The text of a PDF on a deck's material page and pictures of its pages – in the PDF worker
 * like every pdf.js run (`pdf-jobs.ts`), never on the server's main thread.
 */

/** Pages read at most: a longer PDF is read as far as this. */
export const MAX_TEXT_PAGES = 2000;
/** Width of a card's picture of the first page. */
export const PREVIEW_WIDTH = 480;

type RenderParameters = Parameters<PDFPageProxy['render']>[0];

/** What {@link readPdfText} found: the text of each page and a small picture of the first. */
export interface PdfText {
  pages: string[];
  /** All pages of the file, also those past {@link MAX_TEXT_PAGES}. */
  pageCount: number;
  preview: Uint8Array | null;
}

const open = (bytes: Uint8Array) =>
  getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS,
    maxImageSize: MAX_PDF_IMAGE_PIXELS,
    verbosity: 0,
  });

async function openDocument(loading: ReturnType<typeof open>) {
  return loading.promise.catch((error: unknown) => {
    throw (error as { name?: string } | null)?.name === 'PasswordException'
      ? new PptxError('encrypted', 'PDF is password protected')
      : new PptxError('corrupt', 'PDF could not be read');
  });
}

/** A page's text in reading order as pdf.js gives it, lines kept. */
async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function drawPage(page: PDFPageProxy, width: number): Promise<Uint8Array> {
  const viewport = page.getViewport({ scale: 1 });
  const scaled = page.getViewport({ scale: width / viewport.width });
  const height = Math.max(1, Math.min(MAX_PAGE_HEIGHT, Math.round(scaled.height)));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  await page.render({
    canvas: canvas as unknown as RenderParameters['canvas'],
    canvasContext: context as unknown as RenderParameters['canvasContext'],
    viewport: scaled,
  }).promise;
  return new Uint8Array(await canvas.encode('jpeg', 85));
}

/** Every page's text (up to {@link MAX_TEXT_PAGES}) and the first page drawn small. */
export async function readPdfText(
  bytes: Uint8Array,
  onOpened: (pages: number) => void = () => {},
): Promise<PdfText> {
  const loading = open(bytes);
  try {
    const document = await openDocument(loading);
    const count = Math.min(document.numPages, MAX_TEXT_PAGES);
    onOpened(count);
    const pages: string[] = [];
    let preview: Uint8Array | null = null;
    for (let number = 1; number <= count; number++) {
      const page = await document.getPage(number);
      pages.push(await pageText(page));
      if (number === 1) preview = await drawPage(page, PREVIEW_WIDTH).catch(() => null);
      page.cleanup();
    }
    return { pages, pageCount: document.numPages, preview };
  } finally {
    await loading.destroy();
  }
}

/** Page `number` (1-based) drawn `width` px wide as a JPEG – for the AI to look at. */
export async function drawPdfPage(
  bytes: Uint8Array,
  number: number,
  width: number,
): Promise<Uint8Array> {
  const loading = open(bytes);
  try {
    const document = await openDocument(loading);
    if (number < 1 || number > document.numPages) {
      throw new RangeError(`The PDF has ${document.numPages} pages`);
    }
    const page = await document.getPage(number);
    try {
      return await drawPage(page, width);
    } finally {
      page.cleanup();
    }
  } finally {
    await loading.destroy();
  }
}
