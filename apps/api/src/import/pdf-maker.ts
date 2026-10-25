import type { SlideRenderer } from '@slider/shared';

/** Who turned a file into the PDF a deck is: Office or Google (`office`), or LibreOffice. */
export type PdfMaker = Extract<SlideRenderer, 'office' | 'libreoffice'>;

/*
 * The maker travels with the bytes from the source's download (or `toDeckBytes`) to the stored
 * revision (`revisions.pdf_renderer`), which the deck card shows as the renderer – a Word file's
 * pages are drawn by whoever made its PDF, not by the PDF reader. Bytes nobody marked are a PDF as
 * it came, or a picture's page.
 */
const makers = new WeakMap<Uint8Array, PdfMaker>();

export function markPdfMaker(bytes: Uint8Array, maker: PdfMaker): Uint8Array {
  makers.set(bytes, maker);
  return bytes;
}

export const pdfMakerOf = (bytes: Uint8Array): PdfMaker | null => makers.get(bytes) ?? null;
