import type { SlideLayers, Viewer } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { createHash } from 'node:crypto';
import { fontSubstituteFor } from '../import/libreoffice';
import { PoolBusy, type PoolPriority } from '../import/office-pool';
import { drawCutout, drawLayers, rasterizePdf } from '../import/pdf-pages';
import { blobKeys, fileUrl } from '../storage/blob-storage';
import { editTarget, fileSlides, openFile, readFile, slideIdsOf } from './edits';
import { drawingFonts, type DrawingFonts } from './workspace-fonts';

/*
 * The pictures the live editor types over: a slide drawn by LibreOffice with one text left out,
 * its shape as it is (`OdpDocument.blankText`). Asked for when a text is picked (or ahead, when
 * the pointer comes over it), drawn while the editor waits, stored by what they show – typing in
 * the text changes nothing in its picture, so it is drawn once per text and look of the slide.
 *
 * Each is drawn from the file as LibreOffice draws only that slide (`toDrawingBytes`), made once
 * per file and slide: every text of a slide is blanked in that small copy, not in the whole deck.
 */

/**
 * Pictures being drawn, by revision and fingerprint: a second ask waits for the first. `urgent`:
 * someone waits for it on screen (asked for so, or again so since) – drawn in the line of those.
 */
const drawing = new Map<string, { done: Promise<void>; urgent: boolean }>();

/** The one-slide copies, by file key and page; the most recent last. */
const PAGE_COPIES = 16;
const pageCopies = new Map<string, Promise<Uint8Array>>();

/**
 * A file with only page `pageIndex` drawn (`OdpDocument.toDrawingBytes`), the workspace's fonts
 * embedded, made once.
 */
function pageCopy(
  deps: AppDeps,
  fileKey: string,
  pageIndex: number,
  fonts: DrawingFonts,
): Promise<Uint8Array> {
  const id = `${fileKey}:${pageIndex}:${fonts.fingerprint}`;
  let copy = pageCopies.get(id);
  if (copy) pageCopies.delete(id);
  else {
    copy = (async () => {
      const document = await openFile(await readFile(deps, fileKey));
      document.embedFonts(await fonts.faces(document.fontFamilies()));
      return document.toDrawingBytes([pageIndex], fontSubstituteFor(fonts.families));
    })();
    // A failed copy is made again next time.
    copy.catch(() => pageCopies.delete(id));
  }
  pageCopies.set(id, copy);
  if (pageCopies.size > PAGE_COPIES) pageCopies.delete(pageCopies.keys().next().value as string);
  return copy;
}

type ToPdf = NonNullable<NonNullable<AppDeps['rendering']>['renderers']['libreOfficePdf']>;

/**
 * Draws once what `pending` names: a second ask waits for the first, and an ask someone waits
 * for (`interactive`) moves a drawing asked for ahead to the front. `draw` gets whether someone
 * waits for it now – then its pictures are drawn in the line of those too.
 */
function drawOnce(
  toPdf: ToPdf,
  pending: string,
  priority: PoolPriority,
  draw: (urgent: () => boolean) => Promise<void>,
): Promise<void> {
  const running = drawing.get(pending);
  if (running) {
    if (priority === 'interactive' && !running.urgent) {
      running.urgent = true;
      toPdf.promote?.(pending);
    }
    return running.done;
  }
  const entry = { done: Promise.resolve(), urgent: priority === 'interactive' };
  entry.done = draw(() => entry.urgent).finally(() => drawing.delete(pending));
  drawing.set(pending, entry);
  return entry.done;
}

/** LibreOffice's PDF of some pages of a prepared file; too many asked for ahead is a 503. */
function drawPages(
  toPdf: ToPdf,
  bytes: Uint8Array,
  pages: readonly number[],
  priority: PoolPriority,
  pending: string,
): Promise<Uint8Array> {
  return toPdf.pages!(bytes, pages, { priority, key: pending, prepared: true }).catch(
    (error: unknown) => {
      // Asked for ahead while many are: drawn when asked for again.
      if (error instanceof PoolBusy) {
        throw new ApiError(503, 'internal', 'Gerade zu viel zu zeichnen.');
      }
      throw error;
    },
  );
}

/**
 * What a picture is stored by: what it shows – and the workspace's fonts, so one drawn before a
 * font came is drawn again in it.
 */
const pictureId = (fingerprint: string, fonts: DrawingFonts) =>
  fonts.fingerprint
    ? createHash('sha256').update(`${fingerprint}\n${fonts.fingerprint}`).digest('hex').slice(0, 32)
    : fingerprint;

/** The deck's renderer, the element's slide in the current file and the workspace's fonts. */
async function located(deps: AppDeps, viewer: Viewer, deckId: string, elementId: string) {
  const target = await editTarget(deps, viewer, deckId);
  const fonts = await drawingFonts(deps, target.deck.workspaceId);
  const toPdf = deps.rendering?.renderers.libreOfficePdf;
  if (!toPdf?.pages) throw new ApiError(409, 'bad_request', 'Folien werden hier nicht gezeichnet.');
  const fileKey = target.revision.pptxKey;
  const slide = (await fileSlides(deps, fileKey)).slides.find((candidate) =>
    candidate.elements.some((element) => element.id === elementId),
  );
  const element = slide?.elements.find((candidate) => candidate.id === elementId);
  if (!slide || !element || fileKey === null) {
    throw new ApiError(404, 'not_found', 'Das Element gibt es nicht mehr.');
  }
  return { target, toPdf, fileKey, slide, element, fonts };
}

/**
 * The picture of an element's slide without its text: `{ url }`, drawn first if need be.
 * `background`: asked for ahead (the pointer came over it) – drawn after what someone waits for;
 * asked for again `interactive` (it was picked), it goes first.
 */
export async function textBackground(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  elementId: string,
  priority: PoolPriority = 'interactive',
): Promise<{ url: string }> {
  const { target, toPdf, fileKey, slide, fonts } = await located(deps, viewer, deckId, elementId);
  const document = await openFile(await pageCopy(deps, fileKey, slide.index, fonts));
  const blank = document.blankText(elementId);
  if (!blank) throw new ApiError(400, 'bad_request', 'In diesem Element kann man nicht tippen.');
  const id = pictureId(blank.fingerprint, fonts);
  const key = blobKeys.slideBackground(target.deck.id, target.revision.id, id);
  if ((await deps.storage.size(key)) === null) {
    const pending = `${target.revision.id}:${id}`;
    await drawOnce(toPdf, pending, priority, async (urgent) => {
      // LibreOffice's page range counts every slide, hidden ones too.
      const pdf = await drawPages(
        toPdf,
        await document.toBytes({ compress: false }),
        [blank.pageIndex + 1],
        priority,
        pending,
      );
      await rasterizePdf(pdf, (images) => deps.storage.put(key, images.image), {
        expectedPages: 1,
        picture: 'backdrop',
        interactive: urgent(),
      });
    });
  }
  return { url: fileUrl(key) };
}

/**
 * What the editor draws a shape or text frame with while its slide is drawn anew after its look
 * or place changed: the slide without it (`backdrop`), and its area and outline as masks
 * (`fill`, `stroke`, cut to `box` on the slide) – painted in its new colours, moved or stretched
 * with it, the masks keep LibreOffice's exact outline. `strokeWidth`: the outline's width (pt)
 * in the mask; another one is not drawn live.
 */
export interface ElementCutout {
  backdrop: string;
  fill: string | null;
  stroke: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  /** What lies over the element, drawn over it in turn (as it is), at `aboveBox`. */
  above: string | null;
  aboveBox: { x: number; y: number; w: number; h: number } | null;
  strokeWidth: number;
  /** Its look is one colour each or none: the masks painted so draw it as LibreOffice does … */
  plain: boolean;
  /** … as see-through as these (0–1). */
  fillOpacity: number;
  strokeOpacity: number;
}

export async function elementCutout(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  elementId: string,
  priority: PoolPriority = 'interactive',
): Promise<ElementCutout> {
  const { target, toPdf, fileKey, slide, element, fonts } = await located(
    deps,
    viewer,
    deckId,
    elementId,
  );
  if (!element.live) {
    throw new ApiError(400, 'bad_request', 'Dieses Element wird nicht live gezeichnet.');
  }
  const copy = await pageCopy(deps, fileKey, slide.index, fonts);
  const [withoutIt, alone] = await Promise.all([openFile(copy), openFile(copy)]);
  const blank = withoutIt.blankElement(elementId);
  const cut = await alone.toCutoutBytes(elementId, fontSubstituteFor(fonts.families));
  if (!blank || !cut) {
    throw new ApiError(400, 'bad_request', 'Dieses Element wird nicht live gezeichnet.');
  }
  const { deck, revision } = target;
  const backdropId = pictureId(blank.fingerprint, fonts);
  const cutId = pictureId(cut.fingerprint, fonts);
  const backdropKey = blobKeys.slideBackground(deck.id, revision.id, backdropId);
  const keys = {
    fill: blobKeys.elementCutout(deck.id, revision.id, cutId, 'fill'),
    stroke: blobKeys.elementCutout(deck.id, revision.id, cutId, 'stroke'),
    above: blobKeys.elementCutout(deck.id, revision.id, cutId, 'above'),
    box: blobKeys.elementCutout(deck.id, revision.id, cutId, 'box'),
  };
  const [hasBackdrop, hasCutout] = await Promise.all([
    deps.storage.size(backdropKey),
    deps.storage.size(keys.box),
  ]);
  await Promise.all([
    hasBackdrop !== null
      ? undefined
      : drawOnce(toPdf, `${revision.id}:${backdropId}`, priority, async (urgent) => {
          const pdf = await drawPages(
            toPdf,
            await withoutIt.toBytes({ compress: false }),
            [blank.pageIndex + 1],
            priority,
            `${revision.id}:${backdropId}`,
          );
          await rasterizePdf(pdf, (images) => deps.storage.put(backdropKey, images.image), {
            expectedPages: 1,
            picture: 'backdrop',
            interactive: urgent(),
          });
        }),
    hasCutout !== null
      ? undefined
      : drawOnce(toPdf, `${revision.id}:${cutId}`, priority, async () => {
          const pdf = await drawPages(
            toPdf,
            cut.bytes,
            cut.pages,
            priority,
            `${revision.id}:${cutId}`,
          );
          const masks = await drawCutout(pdf);
          await Promise.all([
            masks.fill && deps.storage.put(keys.fill, masks.fill),
            masks.stroke && deps.storage.put(keys.stroke, masks.stroke),
            masks.above && deps.storage.put(keys.above, masks.above),
          ]);
          // Written last: the masks are there once it is.
          const box = {
            box: masks.box,
            fill: masks.fill !== null,
            stroke: masks.stroke !== null,
            aboveBox: masks.above ? masks.aboveBox : null,
          };
          await deps.storage.put(keys.box, new TextEncoder().encode(JSON.stringify(box)));
        }),
  ]);
  const stored = await deps.storage.get(keys.box);
  const { box, fill, stroke, aboveBox } = JSON.parse(
    new TextDecoder().decode(stored ?? new Uint8Array()),
  ) as {
    box: ElementCutout['box'];
    fill: boolean;
    stroke: boolean;
    aboveBox: ElementCutout['aboveBox'];
  };
  return {
    backdrop: fileUrl(backdropKey),
    fill: fill ? fileUrl(keys.fill) : null,
    stroke: stroke ? fileUrl(keys.stroke) : null,
    box,
    above: aboveBox ? fileUrl(keys.above) : null,
    aboveBox,
    strokeWidth: element.live.stroke?.width ?? 1,
    plain: cut.plain,
    fillOpacity: cut.fillOpacity,
    strokeOpacity: cut.strokeOpacity,
  };
}

/**
 * A slide taken apart for the layers view: the slide without its elements and each element
 * alone, bottom first (`OdpDocument.toLayerBytes`). Each part is drawn once per look of its own:
 * restacked, nothing is drawn again; an element changed, only it – the parts missing in one go
 * (a page per element on white and on black).
 */
export async function slideLayers(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  slideId: string,
  priority: PoolPriority = 'interactive',
): Promise<SlideLayers> {
  const { deck, revision } = await editTarget(deps, viewer, deckId);
  const fonts = await drawingFonts(deps, deck.workspaceId);
  const toPdf = deps.rendering?.renderers.libreOfficePdf;
  if (!toPdf?.pages) throw new ApiError(409, 'bad_request', 'Folien werden hier nicht gezeichnet.');
  const fileKey = revision.pptxKey;
  const index = (await slideIdsOf(deps.db, revision.id)).indexOf(slideId);
  if (index === -1 || fileKey === null) {
    throw new ApiError(404, 'not_found', 'Die Folie gibt es nicht mehr.');
  }
  const document = await openFile(await pageCopy(deps, fileKey, index, fonts));
  const drawing = await document.toLayerBytes(index, fontSubstituteFor(fonts.families));
  const key = (fingerprint: string, part: 'background' | 'image' | 'box') =>
    blobKeys.slideLayer(deck.id, revision.id, pictureId(fingerprint, fonts), part);
  const background = key(drawing.background, 'background');
  const drawBackground = (await deps.storage.size(background)) === null;
  // The elements not drawn yet, each once (two alike are one).
  const missing = [
    ...new Map(
      (
        await Promise.all(
          drawing.layers.map(async (fingerprint, at) =>
            (await deps.storage.size(key(fingerprint, 'box'))) === null ? [at] : [],
          ),
        )
      )
        .flat()
        .map((at) => [drawing.layers[at] as string, at]),
    ).values(),
  ];
  if (drawBackground || missing.length > 0) {
    const pending = `${revision.id}:layers:${drawBackground ? drawing.background : ''}:${missing
      .map((at) => drawing.layers[at])
      .join(',')}`;
    await drawOnce(toPdf, pending, priority, async (urgent) => {
      // The slide's page, then each element's two.
      const [first = 0, ...pairs] = drawing.pages;
      const pages = [
        ...(drawBackground ? [first] : []),
        ...missing.flatMap((at) => pairs.slice(2 * at, 2 * at + 2)),
      ];
      const pdf = await drawPages(toPdf, drawing.bytes, pages, priority, pending);
      const drawn = await drawLayers(pdf, { interactive: urgent(), background: drawBackground });
      await Promise.all([
        drawn.background && deps.storage.put(background, drawn.background),
        ...missing.map(async (at, i) => {
          const fingerprint = drawing.layers[at] as string;
          const layer = drawn.layers[i];
          if (layer?.image) await deps.storage.put(key(fingerprint, 'image'), layer.image);
          // Written last: the picture is there once it is.
          const box = layer?.image ? layer.box : null;
          await deps.storage.put(
            key(fingerprint, 'box'),
            new TextEncoder().encode(JSON.stringify(box)),
          );
        }),
      ]);
    });
  }
  const layers = await Promise.all(
    drawing.elementIds.map(async (elementId, at) => {
      const fingerprint = drawing.layers[at] as string;
      const stored = await deps.storage.get(key(fingerprint, 'box'));
      const box = JSON.parse(
        new TextDecoder().decode(stored ?? new TextEncoder().encode('null')),
      ) as SlideLayers['layers'][number]['box'];
      return { elementId, url: box ? fileUrl(key(fingerprint, 'image')) : null, box };
    }),
  );
  return { seq: revision.editSeq, background: fileUrl(background), layers };
}
