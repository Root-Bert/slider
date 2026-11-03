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
import { deband } from './deband';
import { pageBoxes, RECORD_BOXES } from './pdf-boxes';
import {
  MAX_PAGE_HEIGHT,
  MAX_PDF_IMAGE_PIXELS,
  PAGE_IMAGE_WIDTH,
  PAGE_THUMBNAIL_WIDTH,
  PAGE_PATH,
  PageCountMismatch,
  STANDARD_FONTS,
  LAYER_IMAGE_WIDTH,
  type LayerImages,
  type PageImages,
  type PagePicture,
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
/** `quick` and `backdrop` pictures (`PagePicture`): JPEG encodes a 4K page in a tenth of WebP's time. */
const JPEG_QUALITY = 90;

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
  {
    expectedPages,
    onOpened,
    picture = 'slide',
  }: { expectedPages?: number; onOpened?: OnPdfOpened; picture?: PagePicture } = {},
): Promise<number> {
  const loading = open(pdf);
  try {
    const document = await loading.promise;
    if (expectedPages !== undefined && document.numPages !== expectedPages) {
      throw new PageCountMismatch(document.numPages, expectedPages);
    }
    onOpened?.(document.numPages);
    // Encoding a 4K page takes several times longer than drawing it, and runs on threads of its
    // own: the next pages are drawn while the ones before are still encoded. Each page in flight
    // holds its canvas pair, so how many go at once depends on their size; `onPage` still gets
    // them one by one, in page order.
    const spare: CanvasPair[] = [];
    const inFlight: { pair: CanvasPair; images: Promise<PageImages> }[] = [];
    let delivered = 0;
    const deliver = async () => {
      const oldest = inFlight.shift()!;
      const images = await oldest.images;
      spare.push(oldest.pair);
      await onPage(images, delivered++);
    };
    try {
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const scaled = page.getViewport({ scale: PAGE_IMAGE_WIDTH / viewport.width });
        const height = Math.round(scaled.height);
        if (!Number.isFinite(height) || height < 1 || height > MAX_PAGE_HEIGHT) {
          throw new Error(`PDF page ${number} is too tall to draw (${height} px)`);
        }
        const depth = Math.max(1, Math.floor(PAGES_IN_FLIGHT_PIXELS / (PAGE_IMAGE_WIDTH * height)));
        while (inFlight.length >= depth) await deliver();
        // Pages of a deck share a size: a pair is reused, new ones (and only those) made for
        // another height.
        const at = spare.findIndex((pair) => pair.full.height === height);
        if (at === -1) spare.length = 0;
        const pair = at === -1 ? newCanvasPair(height) : spare.splice(at, 1)[0]!;
        const canvas = pair.full;
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
        smoothGradients(context, canvas.width, height);
        const images = encodePage(pair, picture);
        // Failing while the next page renders is no unhandled rejection: `deliver` throws it.
        images.catch(() => {});
        inFlight.push({ pair, images });
      }
      while (inFlight.length > 0) await deliver();
    } finally {
      // A page given up half-way: its encodes still run on their threads – nobody waits for them.
      for (const { images } of inFlight) images.catch(() => {});
    }
    return document.numPages;
  } finally {
    await loading.destroy();
  }
}

/**
 * Pixels of the pages {@link drawPdfPages} encodes at once: three 16:9 pages at full width
 * (about 100 MB of canvases); a tall page goes alone.
 */
const PAGES_IN_FLIGHT_PIXELS = 3 * PAGE_IMAGE_WIDTH * 2160;

interface CanvasPair {
  full: Canvas;
  thumbnail: Canvas;
}

const newCanvasPair = (height: number): CanvasPair => ({
  full: createCanvas(PAGE_IMAGE_WIDTH, height),
  thumbnail: createCanvas(
    PAGE_THUMBNAIL_WIDTH,
    Math.max(1, Math.round((height * PAGE_THUMBNAIL_WIDTH) / PAGE_IMAGE_WIDTH)),
  ),
});

/** A drawn page's images; the pair must not be drawn on until it resolves. */
async function encodePage(
  { full: canvas, thumbnail }: CanvasPair,
  picture: PagePicture,
): Promise<PageImages> {
  if (picture === 'backdrop') {
    // The picture alone: no thumbnail (empty).
    return {
      image: new Uint8Array(await canvas.encode('jpeg', JPEG_QUALITY)),
      thumbnail: new Uint8Array(0),
    };
  }
  const small = thumbnail.getContext('2d');
  small.setTransform(1, 0, 0, 1, 0, 0);
  small.clearRect(0, 0, thumbnail.width, thumbnail.height);
  small.imageSmoothingEnabled = true;
  small.imageSmoothingQuality = 'high';
  small.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  // Encoded side by side (each on a thread of its own).
  const [image, preview] = await Promise.all([
    picture === 'quick' ? canvas.encode('jpeg', JPEG_QUALITY) : canvas.encode('webp', WEBP_QUALITY),
    thumbnail.encode('webp', WEBP_QUALITY),
  ]);
  return { image: new Uint8Array(image), thumbnail: new Uint8Array(preview) };
}

/** Less opaque than this (of 255) is see-through in a matted drawing: the page edge's noise. */
const MIN_OPACITY = 8;

/** Pixels around what was drawn, kept with it: the edges' soft pixels stay whole. */
const CUTOUT_MARGIN = 2;

/** Where `alpha` is not zero, widened by {@link CUTOUT_MARGIN}; `null` when nowhere. */
function coveredBox(alphas: readonly Uint8Array[], width: number, height: number) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (const alpha of alphas) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if ((alpha[row + x] as number) === 0) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  left = Math.max(0, left - CUTOUT_MARGIN);
  top = Math.max(0, top - CUTOUT_MARGIN);
  right = Math.min(width - 1, right + CUTOUT_MARGIN);
  bottom = Math.min(height - 1, bottom + CUTOUT_MARGIN);
  return { left, top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * A page drawn on `ground` (where the page leaves the canvas bare – a rounded-off last row),
 * `width` px wide, as its pixels.
 */
async function drawRgba(
  document: Awaited<ReturnType<typeof open>['promise']>,
  number: number,
  width = PAGE_IMAGE_WIDTH,
  ground = '#ffffff',
): Promise<Drawn> {
  const page = await document.getPage(number);
  const viewport = page.getViewport({ scale: 1 });
  const scaled = page.getViewport({ scale: width / viewport.width });
  const height = Math.round(scaled.height);
  if (!Number.isFinite(height) || height < 1 || height > MAX_PAGE_HEIGHT) {
    throw new Error(`PDF page ${number} is too tall to draw (${height} px)`);
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = ground;
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas: canvas as unknown as RenderParameters['canvas'],
    canvasContext: context as unknown as RenderParameters['canvasContext'],
    viewport: scaled,
  }).promise;
  page.cleanup();
  return { canvas, rgba: smoothGradients(context, canvas.width, height), height };
}

/**
 * LibreOffice's gradients, drawn as bands, smoothed over in a drawn page (`deband.ts`); its
 * pixels after.
 */
function smoothGradients(
  context: ReturnType<Canvas['getContext']>,
  width: number,
  height: number,
): Uint8ClampedArray {
  const image = context.getImageData(0, 0, width, height);
  deband(image.data, width, height);
  context.putImageData(image, 0, 0);
  return image.data;
}

interface Drawn {
  canvas: Canvas;
  rgba: Uint8ClampedArray;
  height: number;
}

/**
 * What the same drawing on a white and on a black page shows alone: see-through where the page
 * showed – where the two differ –, its colours as drawn; PNG cut to the part it covers (0–1 of
 * the page), `null` when it covers nothing.
 */
async function matted(
  onWhite: Drawn,
  onBlack: Drawn,
): Promise<{ image: Uint8Array; box: { x: number; y: number; w: number; h: number } } | null> {
  const w = onWhite.canvas.width;
  const h = onWhite.height;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) {
    let through = 0;
    for (let c = 0; c < 3; c++) {
      const d = (onWhite.rgba[i * 4 + c] as number) - (onBlack.rgba[i * 4 + c] as number);
      if (d > through) through = d;
    }
    // The page's own edges differ by a shade on white and black: not drawn there.
    alpha[i] = through > 255 - MIN_OPACITY ? 0 : 255 - through;
  }
  const part = coveredBox([alpha], w, h);
  if (!part) return null;
  const out = createCanvas(part.w, part.h);
  const context = out.getContext('2d');
  const image = context.createImageData(part.w, part.h);
  for (let y = 0; y < part.h; y++) {
    for (let x = 0; x < part.w; x++) {
      const from = (part.top + y) * w + part.left + x;
      const to = (y * part.w + x) * 4;
      const a = alpha[from] as number;
      if (a === 0) continue;
      // On black, a pixel is its colour times its opacity.
      for (let c = 0; c < 3; c++) {
        image.data[to + c] = Math.min(
          255,
          Math.round(((onBlack.rgba[from * 4 + c] as number) * 255) / a),
        );
      }
      image.data[to + 3] = a;
    }
  }
  context.putImageData(image, 0, 0);
  return {
    image: new Uint8Array(await out.encode('png')),
    box: { x: part.left / w, y: part.top / h, w: part.w / w, h: part.h / h },
  };
}

/**
 * A slide taken apart from its PDF (`OdpDocument.toLayerBytes`), `width` wide: with `background`,
 * the first page – the slide without its elements – as a JPEG; then each pair of pages – an
 * element alone on white and on black – as that element alone ({@link matted}).
 */
export async function drawLayerPages(
  pdf: Uint8Array,
  background = true,
  width = LAYER_IMAGE_WIDTH,
): Promise<LayerImages> {
  const loading = open(pdf);
  try {
    const document = await loading.promise;
    const first = background ? 1 : 0;
    if ((document.numPages - first) % 2 !== 0) {
      throw new PageCountMismatch(document.numPages, first);
    }
    const ground = background
      ? new Uint8Array(
          await (await drawRgba(document, 1, width)).canvas.encode('jpeg', JPEG_QUALITY),
        )
      : null;
    const layers: LayerImages['layers'] = [];
    for (let number = first + 1; number < document.numPages; number += 2) {
      const onWhite = await drawRgba(document, number, width);
      // On a black canvas too: a bare edge shows through, like the page.
      const onBlack = await drawRgba(document, number + 1, width, '#000000');
      layers.push((await matted(onWhite, onBlack)) ?? { image: null, box: null });
    }
    return { background: ground, layers };
  } finally {
    await loading.destroy();
  }
}
