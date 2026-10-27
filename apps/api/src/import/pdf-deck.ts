import type { ParsedSlide } from '@slider/pptx';
import { isOdpBytes } from '@slider/odp';
import { isPdfBytes } from '../sources/safe-fetch';
import { openOdpDeck } from './odp-deck';
import { runPdfTask } from './pdf-jobs';
import { PAGE_PATH } from './pdf-pages';
import type { OpenPptx, PptxDocument } from './pptx';

/*
 * A review deck that came as a PDF – exported from Keynote, Canva, Google Slides, PowerPoint or
 * LaTeX – read like a PowerPoint: every page a slide, its boxes (`pdf-boxes.ts`) its shapes. The
 * import, new versions with slide matching, box comments that follow their box, and the pictures
 * (`renderSlidePages` draws the PDF itself) all run as for a PPTX. What a PDF lacks stays empty:
 * no slide ids (slides are matched by what they show), no layouts, no comments, no hidden slides.
 */

/** 1 PDF point in EMU – the slide size is stored in EMU. */
const EMU_PER_POINT = 12_700;

/** Whether a parsed slide is a page of a PDF – it has no PowerPoint slide id. */
export const isPdfPage = (slide: Pick<ParsedSlide, 'path'>) => slide.path.startsWith(PAGE_PATH);

/** The original of a revision opened for the import: a PPTX by `openPptx`, a PDF or ODP here. */
export const openDeckFile = (openPptx: OpenPptx, bytes: Uint8Array): Promise<PptxDocument> =>
  isPdfBytes(bytes) ? openPdfDeck(bytes) : isOdpBytes(bytes) ? openOdpDeck(bytes) : openPptx(bytes);

/**
 * A PDF as the import reads a PowerPoint: its pages as slides with their boxes. Read in a worker
 * thread with a deadline (`pdf-jobs.ts`): a PDF that takes too long ends in `PdfTimedOut`.
 */
export async function openPdfDeck(bytes: Uint8Array): Promise<PptxDocument> {
  const { size, author, slides, looks } = await runPdfTask({ kind: 'deck', bytes });
  return {
    presentation: {
      size: {
        cx: Math.round(size.width * EMU_PER_POINT),
        cy: Math.round(size.height * EMU_PER_POINT),
      },
      slides,
      sections: [],
      comments: [],
      author,
    },
    // The page's look in place of PowerPoint's preview: its hash says when it changed. Its
    // picture is the drawn PDF page; this stands in only if drawing it failed.
    renderSlideSvg: async (slide) => {
      const look = looks[slide.index] ?? '';
      const w = size.width || 960;
      const h = size.height || 540;
      const texts = slide.shapes
        .filter((shape) => shape.text)
        .map(
          (shape) =>
            `<text x="${(shape.bbox.x * w).toFixed(1)}" y="${((shape.bbox.y + shape.bbox.h * 0.8) * h).toFixed(1)}" font-family="sans-serif" font-size="${Math.max(6, shape.bbox.h * h * 0.6).toFixed(1)}">${escapeXml(shape.text.split('\n')[0] ?? '')}</text>`,
        )
        .join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><desc>pdf ${look}</desc><rect width="100%" height="100%" fill="#ffffff"/>${texts}</svg>`;
    },
  };
}

const escapeXml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!,
  );
