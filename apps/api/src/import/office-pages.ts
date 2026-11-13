import type { ParsedSlide } from '@slider/pptx';
import type { Database } from '../db/client';
import type { DeckRow, RevisionRow, SlideRenderer } from '../db/schema';
import type { Logger } from '../logger';
import { isOdpBytes } from '@slider/odp';
import { isPdfBytes } from '../sources/safe-fetch';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import { ConversionAborted, deckFonts, type PptxToPdf } from './libreoffice';
import type { PoolPriority } from './office-pool';
import { PAGE_IMAGE_WIDTH, PageCountMismatch, rasterizePdf } from './pdf-pages';
import { svgThumbnail } from './svg-thumbnail';
import { drawingFonts } from '../services/workspace-fonts';

type PdfRenderer = Exclude<SlideRenderer, 'svg'>;

/** What a {@link renderSlidePages} call came up with. */
export interface SlidePages {
  /**
   * `libreoffice` / `pdf`: that renderer's pages are in `pages`. `svg`: a better renderer was
   * tried and failed, every slide keeps its SVG preview. `null`: none was available to try.
   */
  renderer: SlideRenderer | null;
  /**
   * One entry per slide, in order: the stored WebP image and thumbnail of its PDF page, or
   * `null` where the slide keeps its SVG preview (hidden ones).
   */
  pages: (StoredPage | null)[];
}

/** A PDF page's images, already in blob storage under the revision's prefix. */
export interface StoredPage {
  imageKey: string;
  thumbnailKey: string;
}

export interface SlidePagesDeps {
  /** Where page images go the moment they are drawn. */
  storage: BlobStorage;
  /** LibreOffice's PDF of any PPTX; `null`/absent when LibreOffice is not installed. */
  libreOfficePdf?: PptxToPdf | null;
  log: Logger;
  /** With it, LibreOffice draws in the workspace's own fonts. */
  db?: Database;
  /**
   * Takes the fonts an ODP brings along into its workspace's own (`adoptDeckFonts`), before
   * LibreOffice draws it – so it is drawn in them already the first time.
   */
  adoptFonts?: (deck: DeckRow, file: Uint8Array) => Promise<unknown>;
}

/**
 * Whether {@link renderSlidePages} has anything better than the SVG preview: LibreOffice. Without
 * it syncs keep a deck's images instead of rendering them again each time.
 */
export const hasPdfRenderer = (deps: Pick<SlidePagesDeps, 'libreOfficePdf'>): boolean =>
  Boolean(deps.libreOfficePdf);

/**
 * The slides' pictures as PowerPoint draws them (BER-94): LibreOffice's PDF of the revision's own
 * file, rasterised per page. The PDF has no pages for hidden slides, so pages map onto the
 * visible slides in order. A PDF whose page count differs from the visible slides cannot be
 * mapped and is skipped. Whatever fails falls back to the SVG preview; it only throws
 * {@link ConversionAborted} (shutdown).
 */
export async function renderSlidePages(
  deps: SlidePagesDeps,
  deck: DeckRow,
  revision: RevisionRow,
  pptx: Uint8Array,
  slides: readonly ParsedSlide[],
  {
    priority,
    onPage,
  }: {
    priority?: PoolPriority;
    /** After each page drawn and stored: how many are, of the visible slides. */
    onPage?: (done: number) => Promise<void>;
  } = {},
): Promise<SlidePages> {
  const preview: SlidePages = {
    renderer: hasPdfRenderer(deps) ? 'svg' : null,
    pages: slides.map(() => null),
  };
  const { libreOfficePdf } = deps;
  let renderer: PdfRenderer;
  let pdf: Uint8Array | null = null;
  if (isPdfBytes(pptx)) {
    // A review deck that came as a PDF: its own pages are the pictures – one per slide, drawn
    // by whoever made the PDF of a converted file.
    renderer = revision.pdfRenderer ?? 'pdf';
    pdf = pptx;
  } else if (libreOfficePdf) {
    renderer = 'libreoffice';
    try {
      if (deps.adoptFonts && isOdpBytes(pptx)) {
        await deps
          .adoptFonts(deck, pptx)
          .catch((error: unknown) =>
            deps.log.warn(`Taking the fonts deck ${deck.id} brings along failed`, error),
          );
      }
      // Only the faces the deck names are read.
      const fonts = deps.db
        ? await (
            await drawingFonts({ ...deps, db: deps.db }, deck.workspaceId)
          ).faces(await deckFonts(pptx))
        : [];
      pdf = await libreOfficePdf(pptx, { fonts, priority });
    } catch (error) {
      // Shutdown: no SVG fallback – the import or re-render resumes on the next start.
      if (error instanceof ConversionAborted) throw error;
      deps.log.warn(`LibreOffice could not convert deck ${deck.id}; using the preview`, error);
    }
  } else return preview;
  if (!pdf) return preview;
  const visible = slides.filter((slide) => !slide.hidden).length;
  // Each page goes to storage as soon as it is drawn, so a long deck never holds all its
  // images in memory; the page count is checked before the first page is drawn.
  const pages: StoredPage[] = [];
  try {
    await rasterizePdf(
      pdf,
      async (images) => {
        const page = {
          imageKey: blobKeys.slideRender(deck.id, revision.id, 'webp'),
          thumbnailKey: blobKeys.slideRender(deck.id, revision.id, 'webp'),
        };
        pages.push(page);
        await deps.storage.put(page.imageKey, images.image);
        await deps.storage.put(page.thumbnailKey, images.thumbnail);
        await onPage?.(pages.length);
      },
      { expectedPages: visible, background: priority === 'background' },
    );
  } catch (error) {
    await deleteStoredPages(deps.storage, pages);
    if (error instanceof PageCountMismatch) {
      deps.log.warn(
        `PDF (${renderer}) of deck ${deck.id} has ${error.pages} pages for ${visible} visible slides`,
      );
    } else {
      deps.log.warn(`PDF (${renderer}) of deck ${deck.id} could not be rendered`, error);
    }
    return preview;
  }
  let next = 0;
  return {
    renderer,
    pages: slides.map((slide) => (slide.hidden ? null : (pages[next++] ?? null))),
  };
}

/** Removes the images of a PDF that was given up half-way; best effort. */
async function deleteStoredPages(storage: BlobStorage, pages: StoredPage[]): Promise<void> {
  for (const page of pages) {
    await storage.delete(page.imageKey).catch(() => {});
    await storage.delete(page.thumbnailKey).catch(() => {});
  }
}

/** `slide_versions.renderer` of one slide of a {@link renderSlidePages} result. */
export const slideRenderer = (result: SlidePages, page: StoredPage | null): SlideRenderer | null =>
  page ? result.renderer : result.renderer === null ? null : 'svg';

/**
 * A slide's picture: the PDF page when there is one (already stored), else the SVG preview –
 * stored with its pictures scaled to what the full slide ({@link PAGE_IMAGE_WIDTH}) and the
 * thumbnail show. The render hash is the caller's, of the unscaled SVG.
 */
export async function storeSlideRender(
  storage: BlobStorage,
  deckId: string,
  revisionId: string,
  svg: string,
  page: StoredPage | null,
): Promise<{ imageKey: string; thumbnailKey: string }> {
  if (page) return { imageKey: page.imageKey, thumbnailKey: page.thumbnailKey };
  const imageKey = blobKeys.slideRender(deckId, revisionId, 'svg');
  // Pictures no larger than a PDF page would show them: a photo deck would otherwise send
  // every viewer several MB per slide.
  const full = await svgThumbnail(svg, PAGE_IMAGE_WIDTH);
  await storage.put(imageKey, new TextEncoder().encode(full));
  // Same SVG with its pictures scaled down further: a photo slide would otherwise put
  // megabytes into every minimap and deck card.
  const thumbnail = await svgThumbnail(full);
  if (thumbnail === full) return { imageKey, thumbnailKey: imageKey };
  const thumbnailKey = blobKeys.slideRender(deckId, revisionId, 'svg');
  await storage.put(thumbnailKey, new TextEncoder().encode(thumbnail));
  return { imageKey, thumbnailKey };
}
