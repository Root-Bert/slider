import { eq, inArray, or } from 'drizzle-orm';
import type { OdpDocument, OdpSlide } from '@slider/odp';
import { runInBackground, runLater } from '../../background-work';
import { slideVersions } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError } from '../../http/errors';
import { ConversionAborted, fontSubstituteFor } from '../../import/libreoffice';
import { rasterizePdf } from '../../import/pdf-pages';
import { blobKeys } from '../../storage/blob-storage';
import { drawingFonts } from '../workspace-fonts';
import { notEditable, openFile, type EditTarget } from './target';

/*
 * Drawing the slides a step changed with LibreOffice – quick (JPEG) while someone waits for
 * them, their WebP after – and deleting the pictures no slide shows any more.
 */

export interface DrawnSlide {
  imageKey: string;
  thumbnailKey: string;
}

/** What {@link drawSlides} drew quick: its PDF and the slides of its pages, in order. */
export interface QuickDrawing {
  pdf?: Uint8Array;
  order?: readonly number[];
}

/**
 * Draws some slides of a file (0-based file positions of visible slides) with LibreOffice,
 * stores their images under the revision and returns them by position.
 */
export async function drawSlides(
  deps: AppDeps,
  target: EditTarget,
  bytes: Uint8Array,
  slides: readonly OdpSlide[],
  indices: Iterable<number>,
  /** `bytes` already open, to be used for nothing else afterwards: spares opening it again. */
  opened?: OdpDocument,
  /**
   * Stored as JPEG for now (a tenth of WebP's time at full size); `quick` gets what
   * {@link sharpenLater} needs to replace them by their WebP once the step is committed.
   */
  quick?: QuickDrawing,
): Promise<Map<number, DrawnSlide>> {
  const drawn = new Map<number, DrawnSlide>();
  // Hidden slides are not drawn – variants are: they show above their slide.
  const visible = [...indices].filter((index) => {
    const slide = slides[index];
    return slide && (!slide.hidden || slide.variantOf !== null);
  });
  if (visible.length === 0) return drawn;
  const toPdf = deps.rendering?.renderers.libreOfficePdf;
  if (!toPdf?.pages) throw notEditable('Auf diesem Server fehlt LibreOffice.');
  // LibreOffice's page range counts every slide, hidden ones too (it draws only the others).
  const pages = visible.map((index) => index + 1);
  let pdf: Uint8Array;
  try {
    // Only the pages drawn, as LibreOffice is to draw them – in the workspace's own fonts.
    const fonts = await drawingFonts(deps, target.deck.workspaceId);
    const document = opened ?? (await openFile(bytes));
    document.embedFonts(await fonts.faces(document.fontFamilies()));
    const deck = await document.toDrawingBytes(visible, fontSubstituteFor(fonts.families));
    pdf = await toPdf.pages(deck, pages, { prepared: true });
  } catch (error) {
    if (error instanceof ConversionAborted) throw error;
    deps.log.warn(`LibreOffice could not draw edited slides of deck ${target.deck.id}`, error);
    throw new ApiError(
      503,
      'internal',
      'Die Folie ließ sich gerade nicht zeichnen. Bitte versuch es gleich noch einmal.',
    );
  }
  let next = 0;
  // Every key put, those of a page whose second picture failed too.
  const stored: string[] = [];
  try {
    await rasterizePdf(
      pdf,
      async (images) => {
        const index = visible[next++];
        if (index === undefined) return;
        const keys = {
          imageKey: blobKeys.slideRender(
            target.deck.id,
            target.revision.id,
            quick ? 'jpg' : 'webp',
          ),
          thumbnailKey: blobKeys.slideRender(target.deck.id, target.revision.id, 'webp'),
        };
        stored.push(keys.imageKey, keys.thumbnailKey);
        await Promise.all([
          deps.storage.put(keys.imageKey, images.image),
          deps.storage.put(keys.thumbnailKey, images.thumbnail),
        ]);
        drawn.set(index, keys);
      },
      // Someone waits for it on screen: not after a running import.
      {
        expectedPages: visible.length,
        interactive: true,
        picture: quick ? 'quick' : 'slide',
      },
    );
  } catch (error) {
    // The pages drawn before it failed would be named by nothing.
    await Promise.all(stored.map((key) => deps.storage.delete(key).catch(() => {})));
    throw error;
  }
  if (quick) {
    quick.pdf = pdf;
    quick.order = visible;
  }
  return drawn;
}

/** A quick picture replaced by its WebP is deleted this much later – no viewer still loads it. */
const QUICK_PICTURE_GRACE_MS = 5 * 60_000;

/**
 * Replaces the JPEG pictures of a committed step by their WebP (drawn from the same PDF, after
 * what someone waits for): the same pixels at about half the bytes for everyone who looks at
 * the slide later. Viewers are told the slides changed, so they load the WebP; the JPEG goes a
 * while later, once nothing names it. Best effort, in the background: a picture that is not
 * replaced stays JPEG.
 */
export function sharpenLater(
  deps: AppDeps,
  target: EditTarget,
  quick: QuickDrawing,
  drawn: ReadonlyMap<number, DrawnSlide>,
): void {
  const { pdf, order } = quick;
  if (!pdf || !order || order.length === 0) return;
  runInBackground(deps, async () => {
    try {
      const replaced = await sharpen(deps, target, pdf, order, drawn);
      if (replaced.length === 0) return;
      deps.live?.slidesChanged(target.deck.id);
      runLater(deps, QUICK_PICTURE_GRACE_MS, () =>
        dropUnusedImages(deps, replaced).catch((error: unknown) =>
          deps.log.warn('Could not delete quick slide pictures', error),
        ),
      );
    } catch (error) {
      if (!(error instanceof ConversionAborted)) {
        deps.log.warn(`Could not sharpen the edited slides of deck ${target.deck.id}`, error);
      }
    }
  });
}

/** {@link sharpenLater}'s pictures: the JPEG keys replaced by a WebP. */
async function sharpen(
  deps: AppDeps,
  target: EditTarget,
  pdf: Uint8Array,
  order: readonly number[],
  drawn: ReadonlyMap<number, DrawnSlide>,
): Promise<string[]> {
  const replaced: string[] = [];
  let next = 0;
  await rasterizePdf(
    pdf,
    async (images) => {
      const index = order[next++];
      const jpeg = index === undefined ? undefined : drawn.get(index)?.imageKey;
      if (!jpeg) return;
      const key = blobKeys.slideRender(target.deck.id, target.revision.id, 'webp');
      await deps.storage.put(key, images.image);
      const rows = await deps.db
        .update(slideVersions)
        .set({ imageKey: key })
        .where(eq(slideVersions.imageKey, jpeg))
        .returning({ id: slideVersions.id });
      if (rows.length > 0) replaced.push(jpeg);
      // Replaced meanwhile by a newer step: this one is not needed.
      else await deps.storage.delete(key).catch(() => {});
    },
    { expectedPages: order.length },
  );
  return replaced;
}

/** Deletes blobs no row refers to any more; best effort. */
export async function dropUnusedImages(deps: AppDeps, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const used = await deps.db
    .select({ imageKey: slideVersions.imageKey, thumbnailKey: slideVersions.thumbnailKey })
    .from(slideVersions)
    .where(
      or(
        inArray(slideVersions.imageKey, [...keys]),
        inArray(slideVersions.thumbnailKey, [...keys]),
      ),
    );
  const keep = new Set(used.flatMap((row) => [row.imageKey, row.thumbnailKey]));
  await Promise.all(
    keys.filter((key) => !keep.has(key)).map((key) => deps.storage.delete(key).catch(() => {})),
  );
}
