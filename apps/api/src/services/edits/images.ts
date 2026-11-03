import { eq, sql } from 'drizzle-orm';
import type { OdpImage } from '@slider/odp';
import {
  imageCreditSchema,
  type ImageCredit,
  type SlideOperation,
  type UploadedEditImage,
  type Viewer,
} from '@slider/shared';
import { decks } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { badRequest } from '../../http/errors';
import { imageSize } from '../../import/any-file';
import { blobKeys } from '../../storage/blob-storage';
import { assertStorageFor } from '../plans';
import { editTarget } from './target';

/*
 * Pictures for the editor: uploaded, or a stock photo fetched (with its credit beside it), kept
 * as the deck's edit pictures until an operation puts them into the file.
 */

/** The formats LibreOffice and every browser show. */
const EDIT_IMAGE_TYPES: Record<string, { extension: string; mediaType: string }> = {
  png: { extension: 'png', mediaType: 'image/png' },
  jpg: { extension: 'jpg', mediaType: 'image/jpeg' },
  gif: { extension: 'gif', mediaType: 'image/gif' },
  webp: { extension: 'webp', mediaType: 'image/webp' },
};
export const MAX_EDIT_IMAGE_BYTES = 20 * 1024 ** 2;
const EDIT_IMAGE_ID = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

function imageKind(bytes: Uint8Array): keyof typeof EDIT_IMAGE_TYPES | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

export async function uploadEditImage(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  bytes: Uint8Array,
): Promise<UploadedEditImage> {
  const { deck } = await editTarget(deps, viewer, deckId);
  if (bytes.byteLength > MAX_EDIT_IMAGE_BYTES) throw badRequest('Das Bild ist größer als 20 MB.');
  const { imageId, width, height } = await storeEditImage(deps, deck.id, bytes);
  return { imageId, width, height };
}

/** Keeps a picture for `replaceImage` – with a stock photo's credit, which goes into the file with it. */
export async function storeEditImage(
  deps: AppDeps,
  deckId: string,
  bytes: Uint8Array,
  credit?: ImageCredit,
): Promise<UploadedEditImage & { mediaType: string }> {
  const kind = imageKind(bytes);
  const size = kind ? imageSize(bytes) : null;
  if (!kind || !size) throw badRequest('Bitte ein Bild als PNG, JPEG, GIF oder WebP.');
  const imageId = `${crypto.randomUUID()}.${EDIT_IMAGE_TYPES[kind]!.extension}`;
  const files: [key: string, bytes: Uint8Array][] = [[blobKeys.editImage(deckId, imageId), bytes]];
  if (credit) {
    files.push([
      blobKeys.editImage(deckId, `${imageId}.credit.json`),
      new TextEncoder().encode(JSON.stringify(credit)),
    ]);
  }
  const addBytes = files.reduce((total, [, file]) => total + file.byteLength, 0);
  const [deck] = await deps.db
    .select({ workspaceId: decks.workspaceId })
    .from(decks)
    .where(eq(decks.id, deckId));
  if (!deck) throw badRequest('Diese Präsentation gibt es nicht mehr.');
  // The workspace's storage (BER-151) – early, before the files are stored; the binding check
  // runs again under the workspace lock, where the deck's files count them right away.
  await deps.db.transaction((tx) =>
    assertStorageFor(tx, deps.config, deck.workspaceId, addBytes, deps.clock.now()),
  );
  const stored: string[] = [];
  try {
    for (const [key, file] of files) {
      await deps.storage.put(key, file);
      stored.push(key);
    }
    await deps.db.transaction(async (tx) => {
      await assertStorageFor(tx, deps.config, deck.workspaceId, addBytes, deps.clock.now());
      // Counted among the deck's other files, as its next measurement finds them (a deck never
      // measured stays `null`: the backfill counts all its files), and kept in mind for removing
      // old pictures (`old-edit-images`).
      await tx
        .update(decks)
        .set({
          filesBytes: sql`jsonb_set(${decks.filesBytes}, '{other}', to_jsonb(coalesce((${decks.filesBytes}->>'other')::bigint, 0) + ${addBytes}::bigint))`,
          editImagesSince: sql`coalesce(${decks.editImagesSince}, ${deps.clock.now().toISOString()}::timestamptz)`,
        })
        .where(eq(decks.id, deckId));
    });
  } catch (error) {
    // Not counted – don't let them eat the storage.
    await Promise.all(stored.map((key) => deps.storage.delete(key).catch(() => undefined)));
    throw error;
  }
  return {
    imageId,
    width: size.width,
    height: size.height,
    mediaType: EDIT_IMAGE_TYPES[kind]!.mediaType,
  };
}

/** An edit picture of the deck with its credit, or `null` when it is gone. */
export async function loadEditImage(
  deps: AppDeps,
  deckId: string,
  imageId: string,
): Promise<OdpImage | null> {
  // An id no upload gives names no picture of the deck: as gone – the operation naming it is
  // left out like one whose picture went, not the whole edit refused.
  if (!EDIT_IMAGE_ID.test(imageId)) return null;
  const [bytes, sidecar] = await Promise.all([
    deps.storage.get(blobKeys.editImage(deckId, imageId)),
    deps.storage.get(blobKeys.editImage(deckId, `${imageId}.credit.json`)),
  ]);
  const kind = bytes && imageKind(bytes);
  const size = bytes && imageSize(bytes);
  if (!bytes || !kind || !size) return null;
  return {
    bytes,
    mediaType: EDIT_IMAGE_TYPES[kind]!.mediaType,
    ...size,
    credit: creditOf(sidecar),
  };
}

/** A stock photo's credit as kept beside it; one that cannot be read is no credit. */
function creditOf(sidecar: Uint8Array | null): ImageCredit | null {
  if (!sidecar) return null;
  try {
    return imageCreditSchema.safeParse(JSON.parse(new TextDecoder().decode(sidecar))).data ?? null;
  } catch {
    return null;
  }
}

/** The pictures an operation puts into the file. */
function imagesOf(operation: SlideOperation): (string | null)[] {
  switch (operation.type) {
    case 'replaceImage':
    case 'addImage':
      return [operation.imageId];
    case 'setTilt':
      return [operation.picture?.imageId ?? null];
    case 'setShapeStyle':
    case 'setSlideBackground':
      // Its fill's layers just uploaded (those of the file go by their path) and their picture.
      return [
        operation.composite?.imageId ?? null,
        ...(operation.fills ?? []).map((layer) =>
          layer.type === 'image' && !layer.src.startsWith('Pictures/') ? layer.src : null,
        ),
      ];
    default:
      return [];
  }
}

/**
 * The pictures `operations` put into the file, by id. One that is gone is left out: the
 * operation naming it then does not fit, and is left out with the reason why.
 */
export async function loadImages(
  deps: AppDeps,
  deckId: string,
  operations: readonly SlideOperation[],
): Promise<Map<string, OdpImage>> {
  const ids = new Set(operations.flatMap(imagesOf).filter((id): id is string => id !== null));
  const images = new Map<string, OdpImage>();
  await Promise.all(
    [...ids].map(async (imageId) => {
      const image = await loadEditImage(deps, deckId, imageId);
      if (image) images.set(imageId, image);
    }),
  );
  return images;
}
