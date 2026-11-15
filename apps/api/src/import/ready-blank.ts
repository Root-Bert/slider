import { eq } from 'drizzle-orm';
import { blankOdp } from '@slider/odp';
import { svgForRenderHash, type ParsedSlide } from '@slider/pptx';
import type { Clock } from '../clock';
import type { Executor } from '../db/client';
import { revisions, slides, slideVersions, type SlideRenderer } from '../db/schema';
import type { Logger } from '../logger';
import { blobKeys, type BlobStorage } from '../storage/blob-storage';
import { FINGERPRINT_VERSION, sha256Hex, toShape } from './common';
import type { PptxToPdf } from './libreoffice';
import { isPdfPage, openDeckFile } from './pdf-deck';
import { PAGE_IMAGE_WIDTH, rasterizePdf } from './pdf-pages';
import type { OpenPptx } from './pptx';
import { svgThumbnail } from './svg-thumbnail';

/** A slide's picture as an import would store it. */
interface SlidePicture {
  image: Uint8Array;
  thumbnail: Uint8Array;
  extension: 'webp' | 'svg';
  renderer: SlideRenderer | null;
}

/** A deck file read and drawn already: its revision's slides go in with the deck, no import. */
export interface ReadyImport {
  width: number;
  height: number;
  author: string | null;
  slides: { parsed: ParsedSlide; renderHash: string; picture: SlidePicture }[];
}

export interface BlankDecksDeps {
  openPptx: OpenPptx;
  clock: Clock;
  log: Logger;
  libreOfficePdf?: PptxToPdf | null;
}

/**
 * „Neue Präsentation“ without a design opens at once: the blank slide's picture is drawn once
 * (at start-up, `warm`), each new blank deck gets a copy of it and is ready the moment it exists –
 * no import queued, nothing waited for. The file itself is made fresh per deck (its date); the
 * picture does not depend on it.
 */
export class BlankDecks {
  private picture: Promise<SlidePicture> | null = null;

  constructor(private readonly deps: BlankDecksDeps) {}

  /** Draws the blank slide ahead, so the first „Neue Präsentation“ finds it. */
  warm(): void {
    void this.drawn().catch(() => {});
  }

  /** A fresh blank file, read and drawn – `null` if drawing failed (the deck is imported then). */
  async next(): Promise<{ bytes: Uint8Array; ready: ReadyImport } | null> {
    const picture = await this.drawn().catch(() => null);
    if (!picture) return null;
    const bytes = await blankOdp(this.deps.clock.now());
    const document = await openDeckFile(this.deps.openPptx, bytes);
    const { presentation } = document;
    const slides = [];
    for (const parsed of presentation.slides) {
      const svg = await document.renderSlideSvg(parsed);
      slides.push({ parsed, renderHash: sha256Hex(svgForRenderHash(svg)), picture });
    }
    return {
      bytes,
      ready: {
        width: presentation.size.cx,
        height: presentation.size.cy,
        author: presentation.author,
        slides,
      },
    };
  }

  private drawn(): Promise<SlidePicture> {
    this.picture ??= this.draw().catch((error: unknown) => {
      // Tried again by the next blank deck.
      this.picture = null;
      this.deps.log.warn('Could not draw the blank slide ahead', error);
      throw error;
    });
    return this.picture;
  }

  /** As the import draws it: LibreOffice's page, else (or if that fails) the SVG preview. */
  private async draw(): Promise<SlidePicture> {
    const bytes = await blankOdp(this.deps.clock.now());
    const { libreOfficePdf } = this.deps;
    if (libreOfficePdf) {
      const page = await this.drawnByLibreOffice(libreOfficePdf, bytes).catch((error: unknown) => {
        this.deps.log.warn('LibreOffice could not draw the blank slide; using the preview', error);
        return null;
      });
      if (page) return page;
    }
    const document = await openDeckFile(this.deps.openPptx, bytes);
    const slide = document.presentation.slides[0];
    if (!slide) throw new Error('The blank deck has no slide');
    const full = await svgThumbnail(await document.renderSlideSvg(slide), PAGE_IMAGE_WIDTH);
    const encoded = new TextEncoder().encode(full);
    // `svg`: a better renderer was tried; `null`: none was there to try – as an import leaves it.
    return {
      image: encoded,
      thumbnail: encoded,
      extension: 'svg',
      renderer: libreOfficePdf ? 'svg' : null,
    };
  }

  private async drawnByLibreOffice(
    libreOfficePdf: PptxToPdf,
    bytes: Uint8Array,
  ): Promise<SlidePicture> {
    const pdf = await libreOfficePdf(bytes);
    const pages: SlidePicture[] = [];
    await rasterizePdf(
      pdf,
      async (images) => {
        pages.push({
          image: images.image,
          thumbnail: images.thumbnail,
          extension: 'webp',
          renderer: 'libreoffice',
        });
      },
      { expectedPages: 1 },
    );
    const [page] = pages;
    if (!page) throw new Error('LibreOffice drew no page of the blank deck');
    return page;
  }
}

/** The pictures of a {@link ReadyImport} under the revision, before its rows go in. */
export async function storeReadyPictures(
  storage: BlobStorage,
  deckId: string,
  revisionId: string,
  ready: ReadyImport,
): Promise<{ imageKey: string; thumbnailKey: string }[]> {
  const keys = [];
  for (const { picture } of ready.slides) {
    const imageKey = blobKeys.slideRender(deckId, revisionId, picture.extension);
    await storage.put(imageKey, picture.image);
    let thumbnailKey = imageKey;
    if (picture.thumbnail !== picture.image) {
      thumbnailKey = blobKeys.slideRender(deckId, revisionId, picture.extension);
      await storage.put(thumbnailKey, picture.thumbnail);
    }
    keys.push({ imageKey, thumbnailKey });
  }
  return keys;
}

/** The revision's slides as `runImport` would leave them, in the deck's transaction. */
export async function insertReadySlides(
  tx: Executor,
  deckId: string,
  revisionId: string,
  ready: ReadyImport,
  keys: readonly { imageKey: string; thumbnailKey: string }[],
): Promise<void> {
  await tx
    .update(revisions)
    .set({
      slideWidthEmu: ready.width,
      slideHeightEmu: ready.height,
      fileAuthor: ready.author,
      fingerprintVersion: FINGERPRINT_VERSION,
    })
    .where(eq(revisions.id, revisionId));
  if (ready.slides.length === 0) return;
  const planned = ready.slides.map((slide, position) => ({
    ...slide,
    position,
    slideId: crypto.randomUUID(),
    keys: keys[position]!,
  }));
  await tx.insert(slides).values(planned.map(({ slideId }) => ({ id: slideId, deckId })));
  await tx.insert(slideVersions).values(
    planned.map(({ parsed, slideId, position, renderHash, picture, keys }) => ({
      id: crypto.randomUUID(),
      slideId,
      revisionId,
      position,
      pptxSldId: isPdfPage(parsed) ? null : parsed.sldId,
      hidden: parsed.hidden,
      title: parsed.title,
      layoutName: parsed.layoutName,
      textHash: parsed.textHash,
      contentHash: parsed.contentHash,
      creationId: parsed.creationId,
      imageKey: keys.imageKey,
      thumbnailKey: keys.thumbnailKey,
      aspectRatio: ready.width / ready.height,
      shapes: parsed.shapes.map(toShape),
      guides: parsed.guides,
      transition: parsed.transition ?? null,
      renderHash,
      renderer: picture.renderer,
    })),
  );
}
