import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PptxError } from '@slider/pptx';
import { ApiError, notAPowerPoint } from '../http/errors';
import { isPdfBytes } from '../sources/safe-fetch';
import {
  ConversionAborted,
  ConversionFailed,
  ConversionTimedOut,
  DOCUMENT_IMPORT_FILTERS,
  type DocumentToPdf,
  type OfficeDocumentKind,
} from './libreoffice';
import { markPdfMaker } from './pdf-maker';

/*
 * Any file picked in a cloud as a review deck: a PowerPoint or a PDF stays what it is, everything
 * else becomes a PDF – pictures as one page each, Word, Excel and text through LibreOffice. The
 * sources hand over what Office or Google render themselves already as PDF (Graph `format=pdf`,
 * Google Docs exports), so this only sees files no provider turned into a deck.
 */

export const UNSUPPORTED_FILE_MESSAGE =
  'Diese Datei kann Slider nicht öffnen. Es gehen PowerPoint, PDF, Bilder, Word, Excel und Text.';

/** Without LibreOffice a server reads PowerPoints, PDFs and pictures only. */
const NO_LIBREOFFICE_MESSAGE =
  'Word-, Excel- und Textdateien kann dieser Server nicht öffnen. Es gehen PowerPoint, PDF und Bilder.';

/** Pictures with more pixels are refused before decoding: they would take gigabytes of memory. */
const MAX_IMAGE_PIXELS = 50_000_000;
/** Longest side a picture is drawn at on its page; bigger ones are scaled down. */
const MAX_IMAGE_SIDE = 4096;
/** Pixels to PDF points: a picture is as big on its page as on a 96 dpi screen. */
const POINTS_PER_PIXEL = 72 / 96;

const extensionOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

const startsWith = (bytes: Uint8Array, ...prefix: number[]) =>
  prefix.every((byte, i) => bytes[i] === byte);
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));
const u32le = (bytes: Uint8Array, offset: number) =>
  offset + 4 <= bytes.length
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
    : 0;

/** The sizes of BMP's info header (`BITMAPCOREHEADER`, `BITMAPINFOHEADER`, V4, V5). */
const BMP_INFO_HEADER_SIZES = new Set([12, 40, 108, 124]);

/**
 * A BMP – not just two bytes `BM`, which any text may start with (a CSV row "BMW,Audi,…"): the
 * info header has one of its known sizes, and the file and pixel offset fields fit the file.
 */
function isBmp(bytes: Uint8Array): boolean {
  if (bytes.length < 26 || ascii(bytes, 0, 2) !== 'BM') return false;
  const fileSize = u32le(bytes, 2);
  const pixelOffset = u32le(bytes, 10);
  const infoSize = u32le(bytes, 14);
  return (
    BMP_INFO_HEADER_SIZES.has(infoSize) &&
    fileSize <= bytes.length &&
    pixelOffset >= 14 + infoSize &&
    pixelOffset < bytes.length
  );
}

/** PNG, JPEG, GIF, WebP or BMP, told by its first bytes. */
export function isImageBytes(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, 0x89, 0x50, 0x4e, 0x47) ||
    startsWith(bytes, 0xff, 0xd8, 0xff) ||
    ascii(bytes, 0, 4) === 'GIF8' ||
    (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') ||
    isBmp(bytes)
  );
}

const isDocumentKind = (extension: string): extension is OfficeDocumentKind =>
  Object.hasOwn(DOCUMENT_IMPORT_FILTERS, extension);

/**
 * The deck for a file from a source: a PPTX or PDF as it is, a picture or document as a PDF. The
 * deck keeps the file's own name (`Bericht.docx`): its next version is converted the same way.
 * Throws `not_a_powerpoint` for anything else, and for documents on a server without LibreOffice.
 */
export async function toDeckBytes(
  fileName: string,
  bytes: Uint8Array,
  documentPdf: DocumentToPdf | null | undefined,
): Promise<Uint8Array> {
  const extension = extensionOf(fileName);
  if (isPdfBytes(bytes)) return bytes;
  // A broken PowerPoint is told by the import, with what is wrong with it.
  if (extension === 'pptx') return bytes;
  // A document goes by its name, before its first bytes are taken for a picture's.
  if (isDocumentKind(extension)) return documentToDeck(bytes, extension, documentPdf);
  if (isImageBytes(bytes)) {
    const pdf = await imageToPdf(bytes);
    if (pdf) return pdf;
  }
  throw notAPowerPoint(UNSUPPORTED_FILE_MESSAGE);
}

/**
 * A document as a PDF through LibreOffice. A file LibreOffice cannot read is "broken or locked";
 * a timeout or a LibreOffice that does not start is the server's problem – worth another try.
 * The cause is logged by the converter.
 */
async function documentToDeck(
  bytes: Uint8Array,
  kind: OfficeDocumentKind,
  documentPdf: DocumentToPdf | null | undefined,
): Promise<Uint8Array> {
  if (!documentPdf) throw notAPowerPoint(NO_LIBREOFFICE_MESSAGE);
  try {
    return markPdfMaker(await documentPdf(bytes, kind), 'libreoffice');
  } catch (error) {
    if (error instanceof ConversionAborted) throw error;
    if (error instanceof ConversionFailed || error instanceof PptxError) {
      throw notAPowerPoint(
        'Slider konnte die Datei nicht lesen – ist sie beschädigt oder passwortgeschützt?',
      );
    }
    if (error instanceof ConversionTimedOut) {
      throw new ApiError(
        503,
        'internal',
        'Das Umwandeln der Datei hat zu lange gedauert. Bitte versuch es noch einmal – oder lade sie als PDF hoch.',
      );
    }
    throw new ApiError(
      503,
      'internal',
      'Slider konnte die Datei gerade nicht umwandeln. Bitte versuch es gleich noch einmal.',
    );
  }
}

/**
 * Width and height from the picture's header, without decoding it; `null` when the header does
 * not tell (then the picture is not decoded either).
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (offset: number, read: (offset: number) => number) =>
    offset >= 0 && offset < bytes.length - 3 ? read(offset) : 0;
  const u16be = (o: number) => at(o, (x) => view.getUint16(x));
  const u16le = (o: number) => at(o, (x) => view.getUint16(x, true));
  const u32be = (o: number) => at(o, (x) => view.getUint32(x));
  const i32le = (o: number) => at(o, (x) => Math.abs(view.getInt32(x, true)));
  const u24le = (o: number) => at(o, (x) => view.getUint16(x, true) + (bytes[x + 2]! << 16));
  let size: { width: number; height: number } | null = null;
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) size = { width: u32be(16), height: u32be(20) };
  else if (ascii(bytes, 0, 4) === 'GIF8') size = { width: u16le(6), height: u16le(8) };
  else if (isBmp(bytes)) {
    // `BITMAPCOREHEADER` (12 bytes) has 16-bit sides, the others 32-bit.
    size =
      u32le(bytes, 14) === 12
        ? { width: u16le(18), height: u16le(20) }
        : { width: i32le(18), height: i32le(22) };
  } else if (ascii(bytes, 0, 4) === 'RIFF') {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === 'VP8X') size = { width: u24le(24) + 1, height: u24le(27) + 1 };
    else if (chunk === 'VP8 ') size = { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    else if (chunk === 'VP8L') {
      const bits = at(21, (x) => view.getUint32(x, true));
      size = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  } else if (startsWith(bytes, 0xff, 0xd8)) {
    // Walk the JPEG markers to the frame header (SOF0–SOF15, not DHT/JPG/DAC).
    let offset = 2;
    while (offset < bytes.length - 9 && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        size = { width: u16be(offset + 7), height: u16be(offset + 5) };
        break;
      }
      offset += 2 + u16be(offset + 2);
    }
  }
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** A picture as a one-page PDF, the page as big as the picture; `null` if it cannot be read. */
export async function imageToPdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  const size = imageSize(bytes);
  if (!size) return null;
  // An uncompressed BMP whose header claims more pixels than the file holds is no picture.
  if (isBmp(bytes) && !bmpFits(bytes, size)) return null;
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    throw notAPowerPoint('Das Bild ist zu groß – bitte verkleinert noch einmal speichern.');
  }
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(Buffer.from(bytes));
  } catch {
    return null;
  }
  if (!image.width || !image.height) return null;
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  // JPEG has no transparency: transparent parts show white, like on a slide.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const jpeg = new Uint8Array(await canvas.encode('jpeg', 92));
  return jpegPdf(jpeg, width, height);
}

/** An uncompressed (`BI_RGB`) BMP holds its rows of pixels; compressed ones are not checked. */
function bmpFits(bytes: Uint8Array, { width, height }: { width: number; height: number }) {
  const core = u32le(bytes, 14) === 12;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bitCount = view.getUint16(core ? 24 : 28, true);
  const compression = core ? 0 : u32le(bytes, 30);
  if (compression !== 0 || bitCount === 0) return true;
  const rowBytes = Math.ceil((width * bitCount) / 32) * 4;
  return u32le(bytes, 10) + rowBytes * height <= bytes.length;
}

/** The smallest PDF that shows one JPEG on a page of its size. */
function jpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const pageWidth = +(width * POINTS_PER_PIXEL).toFixed(2);
  const pageHeight = +(height * POINTS_PER_PIXEL).toFixed(2);
  const draw = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const chunk = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(chunk);
    length += chunk.length;
  };
  const object = (body: string, stream?: Uint8Array) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };
  push('%PDF-1.4\n');
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );
  object(
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  object(`<< /Length ${draw.length} >>`, encoder.encode(draw));
  const xref = length;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const pdf = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    pdf.set(part, at);
    at += part.length;
  }
  return pdf;
}
