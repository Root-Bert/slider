import type { ParsedSlide } from '@slider/pptx';
import type { DeckRow, RevisionRow } from '../db/schema';
import type { Logger } from '../logger';
import { isGraphRef } from '../sources/microsoft-graph';
import type { SourceAdapters } from '../sources/source-adapter';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import { rasterizePdf, type PageImages } from './pdf-pages';

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

/**
 * Office's page images for the given slides, in the same order; `null` where a slide has none.
 * PowerPoint's PDF leaves hidden slides out, so pages map onto the visible slides in order. If
 * the counts differ the mapping cannot be trusted, and every slide gets `null` (BER-94).
 */
export async function officeSlidePages(
  deps: { officePdf?: OfficePdf; log: Logger },
  deck: DeckRow,
  revision: RevisionRow,
  slides: readonly ParsedSlide[],
): Promise<(PageImages | null)[]> {
  const none = slides.map(() => null);
  const pdf = deps.officePdf ? await deps.officePdf(deck, revision) : null;
  if (!pdf) return none;
  let pages: PageImages[];
  try {
    pages = await rasterizePdf(pdf);
  } catch (error) {
    deps.log.warn(`Office PDF of deck ${deck.id} could not be rendered; using the preview`, error);
    return none;
  }
  const visible = slides.filter((slide) => !slide.hidden).length;
  if (pages.length !== visible) {
    deps.log.warn(
      `Office PDF of deck ${deck.id} has ${pages.length} pages for ${visible} visible slides; using the preview`,
    );
    return none;
  }
  let next = 0;
  return slides.map((slide) => (slide.hidden ? null : (pages[next++] ?? null)));
}

/** Stores a slide's picture: Office's page when there is one, else the SVG preview. */
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
