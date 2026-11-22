import type { ReaderRect } from '@slider/shared';
import type { PDFDocumentProxy } from './pdf';

/** A place where the words searched for stand: its page and the boxes they cover. */
export interface PdfHit {
  page: number;
  rects: ReaderRect[];
}

interface Run {
  text: string;
  /** Where on the page, as fractions of it: the run's box. */
  x: number;
  y: number;
  w: number;
  h: number;
  start: number;
  /** The family pdf.js names for it: letters are measured in it, to share the width fairly. */
  family: string;
}
interface PageWords {
  text: string;
  runs: Run[];
}

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageWords>>>();

/** The page's words with where each run of them stands, read once. */
function wordsOf(doc: PDFDocumentProxy, index: number): Promise<PageWords> {
  let pages = cache.get(doc);
  if (!pages) cache.set(doc, (pages = new Map()));
  let words = pages.get(index);
  if (!words) {
    words = (async () => {
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const runs: Run[] = [];
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const family = content.styles[item.fontName]?.fontFamily ?? 'sans-serif';
        const [a, b, , , e, f] = item.transform as number[];
        const size = Math.hypot(a!, b!) || item.height || 10;
        // Corners of the run in the page as shown.
        const [x1, y1] = viewport.convertToViewportPoint(e!, f! + size * 0.85);
        const [x2, y2] = viewport.convertToViewportPoint(e! + item.width, f! - size * 0.2);
        runs.push({
          text: item.str,
          x: Math.min(x1!, x2!) / viewport.width,
          y: Math.min(y1!, y2!) / viewport.height,
          w: Math.abs(x2! - x1!) / viewport.width,
          h: Math.abs(y2! - y1!) / viewport.height,
          start: text.length,
          family,
        });
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      return { text, runs };
    })();
    pages.set(index, words);
  }
  return words;
}

let measure: CanvasRenderingContext2D | null | undefined;
/** How far into its run the first `count` letters reach, as a fraction of the page. */
function widthOf(run: Run, count: number) {
  if (count <= 0) return 0;
  if (count >= run.text.length) return run.w;
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return (run.w * count) / run.text.length;
  measure.font = `100px ${run.family}`;
  const whole = measure.measureText(run.text).width;
  return whole > 0
    ? (run.w * measure.measureText(run.text.slice(0, count)).width) / whole
    : (run.w * count) / run.text.length;
}

/** Folded for searching: case and accents aside, one length per letter kept. */
const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, (mark) => (mark.length === 1 ? '' : mark))
    .normalize('NFC');

function same(text: string) {
  // Folding must not change positions: only fold where lengths stay.
  const folded = fold(text);
  return folded.length === text.length ? folded : text.toLowerCase();
}

/** Every place `query` stands in the PDF, page by page, each with its boxes. */
export async function findInPdf(
  doc: PDFDocumentProxy,
  query: string,
  signal: { cancelled: boolean },
): Promise<PdfHit[]> {
  const needle = same(query.trim().replace(/\s+/g, ' '));
  if (needle === '') return [];
  const hits: PdfHit[] = [];
  for (let index = 0; index < doc.numPages; index += 1) {
    const { text, runs } = await wordsOf(doc, index);
    if (signal.cancelled) return hits;
    const haystack = same(text.replace(/\s/g, ' '));
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
      const end = at + needle.length;
      const rects: ReaderRect[] = [];
      for (const run of runs) {
        const runEnd = run.start + run.text.length;
        if (runEnd <= at || run.start >= end || run.text.length === 0) continue;
        const from = Math.max(at, run.start) - run.start;
        const to = Math.min(end, runEnd) - run.start;
        const left = widthOf(run, from);
        rects.push({ x: run.x + left, y: run.y, w: widthOf(run, to) - left, h: run.h });
      }
      if (rects.length > 0) hits.push({ page: index, rects });
      if (hits.length >= 2000) return hits;
    }
  }
  return hits;
}
