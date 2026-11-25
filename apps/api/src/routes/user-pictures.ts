import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { MePicture, PeoplePictures } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { users } from '../db/schema';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { badRequest, fileTooLarge } from '../http/errors';
import { assertWithinLimit } from '../http/rate-limit';
import {
  deleteUserPicture,
  MAX_PICTURE_BYTES,
  peoplePictures,
  pictureUrl,
  pictureWorkspace,
  professionalPicture,
  setUserPicture,
} from '../services/user-pictures';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const sized = bodyLimit({
  maxSize: MAX_PICTURE_BYTES + MULTIPART_OVERHEAD_BYTES,
  onError: (c) => c.json(fileTooLarge(MAX_PICTURE_BYTES).toBody(), 413),
});

/** The picture in the form's field `file`, and the form. */
async function sentPicture(c: Context) {
  const body = await c.req.parseBody().catch(() => {
    throw badRequest('Das Bild konnte nicht gelesen werden.');
  });
  const file = body['file'];
  if (!(file instanceof File)) throw badRequest('Bitte ein Bild im Feld „file“ mitsenden.');
  return { bytes: new Uint8Array(await file.arrayBuffer()), body };
}

async function mePicture(deps: AppDeps, userId: string): Promise<MePicture> {
  const [[user], workspaceId] = await Promise.all([
    deps.db.select({ picture: users.picture }).from(users).where(eq(users.id, userId)),
    pictureWorkspace(deps, userId),
  ]);
  return { url: pictureUrl(user?.picture ?? null), ai: workspaceId !== null };
}

/**
 * One's own picture (Konto › Profil) – uploaded, or made by the image model from a photo
 * („Profibild mit KI“, shown first, kept with a `PUT`) – and the pictures of the people one sees,
 * which every avatar shows (`GET /people/pictures`).
 */
export function userPicturesRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  return (
    new Hono<ViewerEnv>()
      .get('/me/picture', viewer, async (c) => {
        requireOwner(c.var.viewer);
        return c.json<MePicture>(await mePicture(deps, c.var.viewer.author.id));
      })
      .put('/me/picture', viewer, sized, async (c) => {
        requireOwner(c.var.viewer);
        assertWithinLimit(
          c,
          aiLimits(deps).pictureUploads.hit(c.var.viewer.author.id),
          'Zu viele Bilder auf einmal. Bitte warte einen Moment.',
        );
        const { bytes } = await sentPicture(c);
        await setUserPicture(deps, c.var.viewer.author.id, bytes);
        return c.json<MePicture>(await mePicture(deps, c.var.viewer.author.id));
      })
      .delete('/me/picture', viewer, async (c) => {
        requireOwner(c.var.viewer);
        await deleteUserPicture(deps, c.var.viewer.author.id);
        return c.body(null, 204);
      })
      /** A portrait made from the photo in `file` after the wish in `wish` – a JPEG, not yet kept. */
      .post('/me/picture/professional', viewer, sized, async (c) => {
        requireOwner(c.var.viewer);
        const userId = c.var.viewer.author.id;
        // The photo is decoded whole as an upload is: one budget for both. Asked first – a hit
        // counts even when refused, and the AI's budget is shared with everything else.
        assertWithinLimit(
          c,
          aiLimits(deps).pictureUploads.hit(userId),
          'Zu viele Bilder auf einmal. Bitte warte einen Moment.',
        );
        assertWithinLimit(
          c,
          aiLimits(deps).aiRequests.hit(userId),
          'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
        );
        const { bytes, body } = await sentPicture(c);
        const wish = typeof body['wish'] === 'string' ? body['wish'] : '';
        const made = await professionalPicture(deps, userId, bytes, wish);
        return c.body(made as Uint8Array<ArrayBuffer>, 200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
        });
      })
      .get('/people/pictures', viewer, async (c) =>
        c.json<PeoplePictures>(
          c.var.viewer.kind === 'owner' ? await peoplePictures(deps, c.var.viewer.author.id) : {},
        ),
      )
  );
}
