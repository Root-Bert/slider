import type { DeckEditState, Viewer } from '@slider/shared';
import { imageSize, OdpDocument } from '@slider/odp';
import { requireDeckAccess } from '../../auth/access';
import type { AppDeps } from '../../deps';
import { deckFonts } from '../../import/libreoffice';
import { notFound } from '../../http/errors';
import { cutOutSource } from '../cut-outs';
import { photoSource } from '../stock-photos';
import { workspaceAiConnection, workspaceImageConnection } from '../integration-keys';
import { drawingFonts, workspaceFontsOf } from '../workspace-fonts';
import { templateFile } from '../workspace-masters';
import { fileSlides } from './file-slides';
import { loadEditImage } from './images';
import { blocker, currentRevision, editTarget, readFile, slideIdsOf } from './target';

/** What the editor needs of a deck: whether it can be edited, its step, and its slides' elements. */
export async function getEditState(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<DeckEditState> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'own');
  const revision = await currentRevision(deps.db, deck);
  const reason = blocker(deps, deck, revision);
  if (reason || !revision) {
    return {
      editable: false,
      reason,
      seq: 0,
      aiAvailable: false,
      aiReason: null,
      stockPhotos: false,
      imageGeneration: false,
      cutOut: false,
      mail: false,
      photoSource: null,
      fonts: [],
      pageSize: { width: 28, height: 15.75 },
      slides: [],
    };
  }
  const [file, slideIds, ai, fonts, photos, images] = await Promise.all([
    fileSlides(deps, revision.pptxKey),
    slideIdsOf(deps.db, revision.id),
    workspaceAiConnection(deps, deck.workspaceId),
    workspaceFontsOf(deps, deck.workspaceId),
    photoSource(deps, deck.workspaceId),
    workspaceImageConnection(deps, deck.workspaceId),
  ]);
  return {
    editable: true,
    reason: null,
    seq: revision.editSeq,
    aiAvailable: ai.connection !== null,
    aiReason: ai.connection ? null : ai.error,
    stockPhotos: photos !== null,
    photoSource: photos?.provider ?? null,
    imageGeneration: images.connection !== null,
    cutOut: cutOutSource(deps) !== null,
    mail: deps.mailer.configured,
    fonts,
    pageSize: file.pageSize,
    slides: file.slides.flatMap((slide) => {
      const slideId = slideIds[slide.index];
      return slideId
        ? [
            {
              slideId,
              pageId: slide.pageId as string,
              index: slide.index,
              name: slide.name,
              hidden: slide.hidden,
              background: slide.background,
              ownBackground: slide.ownBackground,
              backgroundFills: slide.backgroundFills,
              transition: slide.transition,
              notes: slide.notes,
              ...(slide.notesRich && { notesRich: slide.notesRich }),
              variantOf: slide.variantOf,
              elements: slide.elements,
            },
          ]
        : [];
    }),
  };
}

/** The deck's file as it is now (download), with its name. */
export async function editedFile(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<{ bytes: Uint8Array; fileName: string; template: boolean }> {
  const { deck, revision } = await editTarget(deps, viewer, deckId);
  const bytes = await readFile(deps, revision.pptxKey);
  // A template being designed goes out as the template it is, as the library keeps it.
  if (deck.isTemplate) {
    const file = await templateFile(bytes, deck.templateDesign ?? undefined);
    return { bytes: file, fileName: `${fileBase(deck)}.otp`, template: true };
  }
  return { bytes, fileName: `${fileBase(deck)}.odp`, template: false };
}

/** A template being designed is named by its title: its file keeps the name it started with. */
export const fileBase = (deck: { fileName: string | null; title: string | null; isTemplate: boolean }) =>
  deck.isTemplate && deck.title?.trim()
    ? deck.title.trim()
    : (deck.fileName ?? deck.title ?? 'Präsentation').replace(/\.[^./]+$/, '');

/**
 * The file as it is now as a PDF, drawn by LibreOffice in the workspace's fonts like the slide
 * pictures – hidden slides are left out.
 */
export async function editedPdf(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { deck, revision } = await editTarget(deps, viewer, deckId);
  const odp = await readFile(deps, revision.pptxKey);
  // `editTarget` refuses a deck without LibreOffice, so it is there.
  const toPdf = deps.rendering!.renderers.libreOfficePdf!;
  const fonts = await (await drawingFonts(deps, deck.workspaceId)).faces(await deckFonts(odp));
  return { bytes: await toPdf(odp, { fonts }), fileName: `${fileBase(deck)}.pdf` };
}

/**
 * A picture of the deck's file (`Pictures/…`) – one a fill layer shows, which the editor draws
 * the layers from anew.
 */
export async function filePicture(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  path: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const { revision } = await editTarget(deps, viewer, deckId);
  // Only the zip: a picture is asked for per layer, the whole file need not be read for it.
  const bytes = await OdpDocument.pictureOf(await readFile(deps, revision.pptxKey), path);
  const size = bytes && imageSize(bytes);
  if (!bytes || !size) throw notFound('Dieses Bild hat die Präsentation nicht.');
  return { bytes, mediaType: size.mediaType };
}

/**
 * A picture uploaded for the editor, by its id – what a fill's layers are drawn from in the
 * browser before the file has it (a stock photo just fetched).
 */
export async function uploadedPicture(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  imageId: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  await editTarget(deps, viewer, deckId);
  const image = await loadEditImage(deps, deckId, imageId);
  if (!image) throw notFound('Das Bild ist nicht mehr da.');
  return { bytes: image.bytes, mediaType: image.mediaType };
}
