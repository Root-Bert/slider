import { createCanvas } from '@napi-rs/canvas';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AppDeps } from '../deps';
import { users, workspaceMembers } from '../db/schema';
import { ApiError, badRequest } from '../http/errors';
import { imageSize } from '../import/any-file';
import { loadImage } from '../import/load-image';
import { fileUrl } from '../storage/file-urls';
import { takesImageReferences } from './ai-providers';
import { imageMediaType } from './edits/images';
import { generatePicture } from './image-generation';
import { workspaceImageConnection } from './integration-keys';

/*
 * A person's own picture (Konto › Profil), shown wherever their avatar is: uploaded, or made by
 * the image model from a photo of them („Profibild mit KI“). Only pictures we drew are kept – a
 * square JPEG, so nothing of the upload (its format, its EXIF and place) stays.
 */

/** Width and height of a kept picture. */
const SIDE = 512;
/** An upload or photo larger than this is refused. */
export const MAX_PICTURE_BYTES = 15_000_000;
/** What the person may wish for the picture, at most. */
export const MAX_PICTURE_WISH = 300;
/** Pixels an own picture or photo may have (any phone's photo; decoding takes 4 bytes each). */
export const MAX_PICTURE_PIXELS = 40_000_000;
/** Roles whose workspace key makes pictures for them – who may make pictures there anyway. */
const MAKERS = ['admin', 'member'] as const;

const pictureKey = (userId: string) => `users/${userId}/pictures/${crypto.randomUUID()}.jpg`;

/** The middle square of `bytes`, `SIDE` wide, as a JPEG – refused when it is no picture. */
async function squareJpeg(bytes: Uint8Array, refusal: string): Promise<Uint8Array> {
  const size = imageSize(bytes);
  if (size && size.width * size.height > MAX_PICTURE_PIXELS)
    throw badRequest('Das Bild hat zu viele Pixel – höchstens 40 Megapixel.');
  const image = await loadImage(bytes, MAX_PICTURE_PIXELS).catch(() => {
    throw badRequest(refusal);
  });
  const side = Math.min(image.width, image.height);
  if (side < 1) throw badRequest(refusal);
  const canvas = createCanvas(SIDE, SIDE);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    SIDE,
    SIDE,
  );
  return new Uint8Array(await canvas.encode('jpeg', 88));
}

function checkUpload(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw badRequest('Bitte ein Bild mitsenden.');
  if (bytes.byteLength > MAX_PICTURE_BYTES)
    throw badRequest('Das Bild ist zu groß – höchstens 15 MB.');
  if (!imageMediaType(bytes))
    throw badRequest('Das geht nicht als Bild – bitte ein Foto als JPEG, PNG oder WebP.');
}

/** The person's picture as a link, `null` without one. */
export const pictureUrl = (key: string | null): string | null => (key ? fileUrl(key) : null);

/** Keeps `bytes` (an upload, or a picture the AI made) as the person's picture. */
export async function setUserPicture(
  deps: AppDeps,
  userId: string,
  bytes: Uint8Array,
): Promise<string> {
  checkUpload(bytes);
  const drawn = await squareJpeg(bytes, 'Das Bild ließ sich nicht lesen.');
  const key = pictureKey(userId);
  await deps.storage.put(key, drawn);
  const [before] = await deps.db
    .select({ picture: users.picture })
    .from(users)
    .where(eq(users.id, userId));
  await deps.db.update(users).set({ picture: key }).where(eq(users.id, userId));
  if (before?.picture) await deps.storage.delete(before.picture).catch(() => undefined);
  return fileUrl(key);
}

/** Back to the picture seeded by the name. */
export async function deleteUserPicture(deps: AppDeps, userId: string): Promise<void> {
  const [before] = await deps.db
    .select({ picture: users.picture })
    .from(users)
    .where(eq(users.id, userId));
  if (!before?.picture) return;
  await deps.db.update(users).set({ picture: null }).where(eq(users.id, userId));
  await deps.storage.delete(before.picture).catch(() => undefined);
}

/**
 * The pictures of the people the viewer sees – those in a workspace with them, and their own –
 * by user id, as links (`/files/…`, valid for hours: asked again before they run out).
 */
export async function peoplePictures(
  deps: AppDeps,
  userId: string,
): Promise<Record<string, string>> {
  const mine = deps.db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  const [rows, own] = await Promise.all([
    deps.db
      .selectDistinct({ id: users.id, picture: users.picture })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(inArray(workspaceMembers.workspaceId, mine), isNotNull(users.picture))),
    deps.db
      .select({ id: users.id, picture: users.picture })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.picture))),
  ]);
  return Object.fromEntries(
    [...rows, ...own].flatMap((row) => (row.picture ? [[row.id, fileUrl(row.picture)]] : [])),
  );
}

/**
 * The first of the person's workspaces whose image model goes after a photo (FLUX Kontext,
 * FLUX.2, gpt-image) and where they may make pictures – `null`: no „Profibild mit KI“.
 */
export async function pictureWorkspace(deps: AppDeps, userId: string): Promise<string | null> {
  const memberships = await deps.db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.role, [...MAKERS])))
    .orderBy(asc(workspaceMembers.createdAt));
  for (const { workspaceId } of memberships) {
    const found = await workspaceImageConnection(deps, workspaceId);
    if (found.connection && takesImageReferences(found.connection)) return workspaceId;
  }
  return null;
}

/** The frame round the person's wish: their face stays theirs, the rest becomes a portrait. */
const professionalPrompt = (wish: string) =>
  [
    'Turn this photo into a professional business portrait of exactly the same person.',
    "Keep the person's identity unchanged: the same face, facial features, eyes, skin tone, age, hair and glasses (if any) – it must clearly be them.",
    'Head and shoulders, centred, facing the camera with a natural, friendly expression.',
    'Soft, flattering studio light, a calm neutral background, smart business clothing, sharp focus, photorealistic, like a high-end corporate headshot. Square picture, no text, no watermark.',
    wish ? `The person's wish (may be in German): ${wish}` : '',
  ]
    .filter(Boolean)
    .join('\n');

/**
 * A professional portrait made from `photo` by the image model of {@link pictureWorkspace} – shown
 * to the person first; kept only once they take it (`setUserPicture`).
 */
export async function professionalPicture(
  deps: AppDeps,
  userId: string,
  photo: Uint8Array,
  wish: string,
): Promise<Uint8Array> {
  checkUpload(photo);
  const workspaceId = await pictureWorkspace(deps, userId);
  if (!workspaceId) {
    throw new ApiError(
      400,
      'bad_request',
      'Für ein Profibild braucht ein Workspace eine Bildgenerierung, die Fotos als Vorlage nimmt (Integrationen).',
    );
  }
  // Sent as we drew it: a square JPEG, without what the camera or phone wrote into it.
  const reference = await squareJpeg(photo, 'Das Foto ließ sich nicht lesen.');
  return generatePicture(
    deps,
    { id: `(profile picture of ${userId})`, workspaceId },
    professionalPrompt(wish.trim().slice(0, MAX_PICTURE_WISH)),
    1,
    'image',
    [{ bytes: reference, mediaType: 'image/jpeg' }],
  );
}
