import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { GenerateEditImageInput, UploadedEditImage, Viewer } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import {
  failureMessage,
  generateImage,
  isProviderError,
  keyProblem,
  refusesKey,
  type ImageShape,
} from './ai-providers';
import { storeEditImage } from './edits/images';
import { editTarget } from './edits/target';
import { markKeyRefused, workspaceImageConnection } from './integration-keys';

/*
 * Pictures generated for the editor from a description, with the workspace's key for it
 * (Integrationen → Bildgenerierung) – kept as an edit picture of the deck, ready for
 * `replaceImage`, like an uploaded one.
 */

/** Wider than this is generated landscape, narrower than its inverse portrait. */
const SQUARE_WITHIN = 1.25;

const shapeOf = (aspect: number | null): ImageShape =>
  aspect === null || (aspect <= SQUARE_WITHIN && aspect >= 1 / SQUARE_WITHIN)
    ? 'square'
    : aspect > 1
      ? 'landscape'
      : 'portrait';

/** The middle of the picture cut to `aspect` (width / height), as a JPEG; as it is when it fits. */
async function cutTo(bytes: Uint8Array, aspect: number | null): Promise<Uint8Array> {
  if (aspect === null) return bytes;
  const image = await loadImage(Buffer.from(bytes)).catch(() => {
    throw new ApiError(502, 'source_unreachable', 'Der Dienst hat kein lesbares Bild geschickt.');
  });
  const { width, height } = image;
  const w = Math.min(width, Math.round(height * aspect));
  const h = Math.min(height, Math.round(width / aspect));
  if (Math.abs(w - width) <= 1 && Math.abs(h - height) <= 1) return bytes;
  const canvas = createCanvas(w, h);
  canvas.getContext('2d').drawImage(image, (width - w) / 2, (height - h) / 2, w, h, 0, 0, w, h);
  return new Uint8Array(await canvas.encode('jpeg', 90));
}

/**
 * A picture of `prompt` for a deck of the workspace, with its key for pictures, cut to `aspect`
 * – for the editor and for the AI at work on a comment. Problems are `ApiError`s in German.
 */
export async function generatePicture(
  deps: AppDeps,
  deck: { id: string; workspaceId: string },
  prompt: string,
  aspect: number | null,
  feature: 'image' | 'create' = 'image',
): Promise<Uint8Array> {
  const found = await workspaceImageConnection(deps, deck.workspaceId);
  if (!found.connection) throw badRequest(found.error);
  const { keyId } = found;
  const base = found.connection;
  const connection =
    feature === 'create' && base.meter
      ? {
          ...base,
          meter: (report: Parameters<NonNullable<typeof base.meter>>[0]) =>
            base.meter!({ ...report, feature }),
        }
      : base;
  let bytes: Uint8Array;
  try {
    bytes = await generateImage(deps, connection, prompt, shapeOf(aspect));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const problem = keyProblem(error, connection);
    if (refusesKey(error))
      await markKeyRefused(deps, keyId, problem ?? 'Der Dienst hat den Key abgelehnt.');
    if (!isProviderError(error)) deps.log.warn(`Picture for deck ${deck.id} not generated`, error);
    throw new ApiError(502, 'source_unreachable', problem ?? failureMessage(error, connection));
  }
  return cutTo(bytes, aspect);
}

/** `POST /decks/:id/edit/images/generate`: a picture of `prompt`, for who may edit the deck. */
export async function generateEditImage(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: GenerateEditImageInput,
): Promise<UploadedEditImage> {
  const { deck } = await editTarget(deps, viewer, deckId);
  const bytes = await generatePicture(deps, deck, input.prompt, input.aspect);
  const { imageId, width, height } = await storeEditImage(deps, deck.id, bytes);
  return { imageId, width, height };
}
