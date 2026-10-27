import { readFileSync } from 'node:fs';
import type { PptxToPdf } from '../src/import/libreoffice';
import { makeSlidesPdf, type PdfPage } from './pdf';

/** Helpers for tests of ODP decks (BER-177). */

export const DEMO_ODP = new Uint8Array(
  readFileSync(new URL('../../../packages/odp/test/fixtures/demo.odp', import.meta.url)),
);

const page = (text: string): PdfPage => ({ texts: [{ text, x: 80, y: 60, size: 40 }] });

/** A stand-in for LibreOffice: one page per visible slide (5 of the demo's 6), or the pages asked for. */
export function fakeOdpPdf(calls: { pages: readonly number[] | null }[] = []): PptxToPdf {
  const toPdf: PptxToPdf = async () => {
    calls.push({ pages: null });
    return makeSlidesPdf([1, 2, 3, 4, 5].map((n) => page(`Seite ${n}`)));
  };
  toPdf.pages = async (_deck, pages) => {
    calls.push({ pages });
    return makeSlidesPdf(pages.map((n) => page(`Seite ${n} neu`)));
  };
  return toPdf;
}

export const odpForm = (bytes: Uint8Array, name = 'Strategie.odp') => {
  const body = new FormData();
  body.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name));
  return body;
};
