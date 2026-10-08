import type { ParsedSlide } from '@slider/pptx';
import type { DeckRow, RevisionRow, SlideRenderer } from '../db/schema';
import type { Logger } from '../logger';
import { isGraphRef } from '../sources/microsoft-graph';
import type { SourceAdapters } from '../sources/source-adapter';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import type { PptxToPdf } from './libreoffice';
import { rasterizePdf, type PageImages } from './pdf-pages';

type PdfRenderer = Exclude<SlideRenderer, 'svg'>;

/**
 * The deck's file rendered to PDF by Office, or `null` when there is none (uploads, plain links,
 * no Microsoft login, …). Only ever a nicer picture: callers fall back to the SVG preview.
 */
export type OfficePdf = (deck: DeckRow, revision: RevisionRow) => Promise<Uint8Array | null>;

/** Asks the deck's source for Office's PDF of exactly the file this revision was made from. */
export function createOfficePdf(sources: SourceAdapters, log: Logger): OfficePdf {
  return async (deck, revision) => {
    if (deck.source === 'upload' || !deck.sourceRef) return null;
    const adapter = sources[deck.source];
    if (!adapter.exportPdf) return null;
    const file = { ref: deck.sourceRef, fileName: deck.fileName, sizeBytes: 0, changeToken: null };
    const context = { userId: deck.ownerId };
    try {
      // Graph renders the file as it is now. If it changed since this revision was downloaded,
      // its pages would belong to the next revision. (Anonymous SharePoint revisions carry an
      // HTTP ETag, not a cTag, so they cannot be compared; the page count check still applies.)
      if (isGraphRef(deck.sourceRef) && revision.sourceChangeToken) {
        const now = await adapter.getChangeToken(file, context);
        if (now !== revision.sourceChangeToken) {
          log.info(`Deck ${deck.id} changed since revision ${revision.id}; using the preview`);
          return null;
        }
      }
      return await adapter.exportPdf(file, context);
    } catch (error) {
      log.warn(`Office PDF of deck ${deck.id} unavailable; using the preview`, error);
      return null;
    }
  };
}

/** What a {@link renderSlidePages} call came up with. */
export interface SlidePages {
  /**
   * `office` / `libreoffice`: that renderer's pages are in `pages`. `svg`: a better renderer was
   * tried and failed, every slide keeps its SVG preview. `null`: none was available to try.
   */
  renderer: SlideRenderer | null;
  /** One entry per slide, in order; `null` where the slide keeps its SVG preview (hidden ones). */
  pages: (PageImages | null)[];
}

export interface SlidePagesDeps {
  /** Office's PDF of linked decks. */
  officePdf?: OfficePdf;
  /** LibreOffice's PDF of any PPTX; `null`/absent when LibreOffice is not installed. */
  libreOfficePdf?: PptxToPdf | null;
  log: Logger;
}

/** Whether {@link renderSlidePages} has anything better than the SVG preview for this deck. */
export const hasPdfRenderer = (
  deps: Pick<SlidePagesDeps, 'officePdf' | 'libreOfficePdf'>,
  deck: DeckRow,
): boolean => Boolean(deps.libreOfficePdf) || (Boolean(deps.officePdf) && isLinkedDeck(deck));

const isLinkedDeck = (deck: DeckRow) => deck.source !== 'upload' && deck.sourceRef !== null;

/**
 * The slides' pictures as PowerPoint draws them (BER-94): Office's PDF of the linked file, else
 * LibreOffice's PDF of the revision's own PPTX, rasterised per page. Neither PDF has pages for
 * hidden slides, so pages map onto the visible slides in order. A PDF whose page count differs
 * from the visible slides cannot be mapped and is skipped. Never throws: whatever fails falls
 * back to the next renderer and finally to the SVG preview.
 */
export async function renderSlidePages(
  deps: SlidePagesDeps,
  deck: DeckRow,
  revision: RevisionRow,
  pptx: Uint8Array,
  slides: readonly ParsedSlide[],
): Promise<SlidePages> {
  const none = slides.map(() => null);
  const candidates: { renderer: PdfRenderer; pdf: () => Promise<Uint8Array | null> }[] = [];
  const { officePdf, libreOfficePdf } = deps;
  if (officePdf) candidates.push({ renderer: 'office', pdf: () => officePdf(deck, revision) });
  if (libreOfficePdf) {
    candidates.push({
      renderer: 'libreoffice',
      pdf: async () => {
        try {
          return await libreOfficePdf(pptx);
        } catch (error) {
          deps.log.warn(`LibreOffice could not convert deck ${deck.id}; using the preview`, error);
          return null;
        }
      },
    });
  }
  const visible = slides.filter((slide) => !slide.hidden).length;
  for (const candidate of candidates) {
    const pdf = await candidate.pdf();
    if (!pdf) continue;
    let pages: PageImages[];
    try {
      pages = await rasterizePdf(pdf);
    } catch (error) {
      deps.log.warn(`PDF (${candidate.renderer}) of deck ${deck.id} could not be rendered`, error);
      continue;
    }
    if (pages.length !== visible) {
      deps.log.warn(
        `PDF (${candidate.renderer}) of deck ${deck.id} has ${pages.length} pages for ${visible} visible slides`,
      );
      continue;
    }
    let next = 0;
    return {
      renderer: candidate.renderer,
      pages: slides.map((slide) => (slide.hidden ? null : (pages[next++] ?? null))),
    };
  }
  return { renderer: hasPdfRenderer(deps, deck) ? 'svg' : null, pages: none };
}

/** `slide_versions.renderer` of one slide of a {@link renderSlidePages} result. */
export const slideRenderer = (result: SlidePages, page: PageImages | null): SlideRenderer | null =>
  page ? result.renderer : result.renderer === null ? null : 'svg';

/** Stores a slide's picture: the PDF page when there is one, else the SVG preview. */
export async function storeSlideRender(
  storage: BlobStorage,
  deckId: string,
  revisionId: string,
  svg: string,
  page: PageImages | null,
): Promise<{ imageKey: string; thumbnailKey: string }> {
  if (!page) {
    const imageKey = blobKeys.slideRender(deckId, revisionId, 'svg');
    await storage.put(imageKey, new TextEncoder().encode(svg));
    return { imageKey, thumbnailKey: imageKey };
  }
  const imageKey = blobKeys.slideRender(deckId, revisionId, 'webp');
  const thumbnailKey = blobKeys.slideRender(deckId, revisionId, 'webp');
  await storage.put(imageKey, page.image);
  await storage.put(thumbnailKey, page.thumbnail);
  return { imageKey, thumbnailKey };
}
