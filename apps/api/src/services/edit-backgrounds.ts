import { placedBox, type LayerPlacement } from '@slider/odp';
import type { Rect, SlideLayers, Viewer } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { createHash } from 'node:crypto';
import { fontSubstituteFor } from '../import/libreoffice';
import { PoolBusy, type PoolPriority } from '../import/office-pool';
import { drawLayers, PAGE_IMAGE_WIDTH } from '../import/pdf-pages';
import { blobKeys, fileUrl } from '../storage/blob-storage';
import { editTarget, openFile, readFile, slideIdsOf } from './edits';
import { drawingFonts, type DrawingFonts } from './workspace-fonts';

/** A layer drawn where it lies (`toLayerBytes` placements). */
const NOT_MOVED: LayerPlacement = { scale: { x: 1, y: 1 }, shift: { x: 0, y: 0 } };

/*
 * The pictures the editor composes a slide from (`slideLayers`) and an element alone
 * (`elementAlone`): drawn by LibreOffice from the file as it draws only that slide
 * (`toDrawingBytes`, made once per file and slide), stored by what they show.
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

/**
 * A slide taken apart for the layers view: the slide without its elements and each element
 * alone, bottom first (`OdpDocument.toLayerBytes`). Each part is drawn once per look of its own:
 * restacked, nothing is drawn again; an element changed, only it – the parts missing in one go
 * (a page per element on white and on black). An element reaching off the slide is drawn whole
 * (moved onto its page alone): its box then reaches off the slide too.
 */
export async function slideLayers(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  slideId: string,
  priority: PoolPriority = 'interactive',
  /** For the per-element editor (`toLayerBytes` `compose`): browser-drawn elements not drawn. */
  compose = false,
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
  const drawing = await document.toLayerBytes(index, fontSubstituteFor(fonts.families), {
    compose,
  });
  // Each drawn element's two pages, by its place in the stack (one the browser draws has none) –
  // composed, after the master's background and its shapes' two.
  const pagesOf = new Map<number, number[]>();
  const [, ...afterSlide] = drawing.pages;
  const masterPages = drawing.masterShapes === null ? [] : afterSlide.slice(0, 3);
  {
    const pairs = afterSlide.slice(masterPages.length);
    let next = 0;
    drawing.layers.forEach((fingerprint, at) => {
      if (fingerprint === null) return;
      pagesOf.set(at, pairs.slice(next, next + 2));
      next += 2;
    });
  }
  const key = (fingerprint: string, part: 'background' | 'image' | 'box') =>
    blobKeys.slideLayer(deck.id, revision.id, pictureId(fingerprint, fonts), part);
  const background = key(drawing.background, 'background');
  const drawBackground = (await deps.storage.size(background)) === null;
  const masterBox = drawing.masterShapes && key(drawing.masterShapes, 'box');
  const ground = drawing.masterGround && key(drawing.masterGround, 'background');
  // Master background and shapes drawn once per master, as wide as the slide (small type in a
  // footer stays sharp).
  const drawMaster =
    masterBox !== null &&
    ground !== null &&
    ((await deps.storage.size(masterBox)) === null || (await deps.storage.size(ground)) === null);
  // The elements not drawn yet, each once (two alike are one).
  const missing = [
    ...new Map(
      (
        await Promise.all(
          drawing.layers.map(async (fingerprint, at) =>
            fingerprint !== null && (await deps.storage.size(key(fingerprint, 'box'))) === null
              ? [at]
              : [],
          ),
        )
      )
        .flat()
        .map((at) => [drawing.layers[at] as string, at]),
    ).values(),
  ];
  if (drawBackground || drawMaster || missing.length > 0) {
    const pending = `${revision.id}:layers:${drawBackground ? drawing.background : ''}:${
      drawMaster ? drawing.masterShapes : ''
    }:${missing.map((at) => drawing.layers[at]).join(',')}`;
    await drawOnce(toPdf, pending, priority, async (urgent) => {
      // The slide's page, then each element's two – the master's three on their own, wider.
      const [first = 0] = drawing.pages;
      const pages = [
        ...(drawBackground ? [first] : []),
        ...missing.flatMap((at) => pagesOf.get(at) ?? []),
      ];
      const [drawn, masterDrawn] = await Promise.all([
        pages.length > 0
          ? drawPages(toPdf, drawing.bytes, pages, priority, pending).then((pdf) =>
              drawLayers(pdf, { interactive: urgent(), background: drawBackground }),
            )
          : { background: null, layers: [] },
        drawMaster
          ? drawPages(toPdf, drawing.bytes, masterPages, priority, `${pending}:master`).then(
              (pdf) => drawLayers(pdf, { interactive: urgent(), width: PAGE_IMAGE_WIDTH }),
            )
          : null,
      ]);
      const elementLayers = drawn.layers;
      const master = masterDrawn?.layers[0];
      await Promise.all([
        drawn.background && deps.storage.put(background, drawn.background),
        drawMaster &&
          (async () => {
            const fingerprint = drawing.masterShapes as string;
            if (masterDrawn?.background) {
              await deps.storage.put(ground as string, masterDrawn.background);
            }
            if (master?.image) await deps.storage.put(key(fingerprint, 'image'), master.image);
            await deps.storage.put(
              key(fingerprint, 'box'),
              new TextEncoder().encode(JSON.stringify(master?.image ? master.box : null)),
            );
          })(),
        ...missing.map(async (at, i) => {
          const fingerprint = drawing.layers[at] as string;
          const layer = elementLayers[i];
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
      const fingerprint = drawing.layers[at];
      // Drawn by the browser: no picture of it.
      if (fingerprint == null) return { elementId, url: null, box: null };
      const stored = await deps.storage.get(key(fingerprint, 'box'));
      const box = JSON.parse(
        new TextDecoder().decode(stored ?? new TextEncoder().encode('null')),
      ) as SlideLayers['layers'][number]['box'];
      const placed = box && placedBox(box, drawing.placements[at] ?? NOT_MOVED);
      return { elementId, url: box ? fileUrl(key(fingerprint, 'image')) : null, box: placed };
    }),
  );
  let masterShapes: SlideLayers['masterShapes'];
  if (drawing.masterShapes) {
    const stored = await deps.storage.get(key(drawing.masterShapes, 'box'));
    const box = JSON.parse(
      new TextDecoder().decode(stored ?? new TextEncoder().encode('null')),
    ) as SlideLayers['layers'][number]['box'];
    masterShapes = { url: box ? fileUrl(key(drawing.masterShapes, 'image')) : null, box };
  }
  return {
    seq: revision.editSeq,
    background: fileUrl(background),
    ...(masterShapes && { masterShapes }),
    ...(ground && { masterGround: fileUrl(ground) }),
    layers,
  };
}

/**
 * One element alone as {@link slideLayers} draws it – from a file not stored yet (the AI's copy
 * of the deck, `bytes`): its picture (PNG, see-through around it), where it lies on the slide,
 * and the address the layers view keeps it under (`source`, without query), which a tilt names
 * as drawn from (`ElementTilt.source`). Stored there, so the editor need not draw it again.
 * `null` when it draws nothing.
 */
export async function elementAlone(
  deps: AppDeps,
  target: { deckId: string; revisionId: string; workspaceId: string },
  bytes: Uint8Array,
  pageIndex: number,
  elementId: string,
): Promise<{ image: Uint8Array; box: Rect; source: string } | null> {
  const fonts = await drawingFonts(deps, target.workspaceId);
  const toPdf = deps.rendering?.renderers.libreOfficePdf;
  if (!toPdf?.pages) throw new ApiError(409, 'bad_request', 'Folien werden hier nicht gezeichnet.');
  const file = await openFile(bytes);
  file.embedFonts(await fonts.faces(file.fontFamilies()));
  const document = await openFile(
    await file.toDrawingBytes([pageIndex], fontSubstituteFor(fonts.families)),
  );
  const drawing = await document.toLayerBytes(pageIndex, fontSubstituteFor(fonts.families));
  const at = drawing.elementIds.indexOf(elementId);
  if (at === -1) return null;
  const pending = `${target.revisionId}:alone:${drawing.layers[at]}`;
  const pdf = await drawPages(
    toPdf,
    drawing.bytes,
    drawing.pages.slice(1 + 2 * at, 3 + 2 * at),
    'interactive',
    pending,
  );
  const layer = (await drawLayers(pdf, { background: false })).layers[0];
  if (!layer?.image || !layer.box) return null;
  const key = (part: 'image' | 'box') =>
    blobKeys.slideLayer(
      target.deckId,
      target.revisionId,
      pictureId(drawing.layers[at] as string, fonts),
      part,
    );
  await deps.storage.put(key('image'), layer.image);
  await deps.storage.put(key('box'), new TextEncoder().encode(JSON.stringify(layer.box)));
  const url = fileUrl(key('image'));
  return {
    image: layer.image,
    box: placedBox(layer.box, drawing.placements[at] ?? NOT_MOVED),
    source: url.split('?')[0] ?? url,
  };
}
