import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isPictureAttachment, MAX_ATTACHMENT_BYTES, type AccountAuthor } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { attachmentFile, dropAttachment, uploadAttachment } from '../services/attachments';

/**
 * Files put on what one writes (`services/attachments.ts`): up into the workspace, taken off
 * again while waiting, a taken one's bytes for the workspace's members. Account members only.
 */
export function attachmentRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return (c.var.viewer.author as AccountAuthor).id;
  };
  // Plenty for a day's messages, not a store.
  const uploads = fixedWindow({ limit: 300, windowMs: 60 * 60 * 1000, clock: deps.clock });
  const tooBig = 'Diese Datei ist zu groß – höchstens 25 MB je Datei.';
  return (
    new Hono<ViewerEnv>()
      /** A file put on something being written (multipart, field `file`). */
      .post(
        '/workspaces/:workspaceId/attachments',
        viewer,
        (c, next) => {
          assertWithinLimit(
            c,
            uploads.hit(me(c)),
            'Zu viele Dateien auf einmal. Bitte warte ein wenig.',
          );
          return next();
        },
        bodyLimit({
          // The file and the form around it.
          maxSize: MAX_ATTACHMENT_BYTES + 64 * 1024,
          onError: (c) => c.json(new ApiError(413, 'file_too_large', tooBig).toBody(), 413),
        }),
        async (c) => {
          const file = (await c.req.parseBody().catch(() => ({}) as Record<string, unknown>))[
            'file'
          ];
          if (!(file instanceof File))
            throw badRequest('Bitte die Datei im Feld „file“ mitsenden.');
          return c.json(
            await uploadAttachment(deps, me(c), c.req.param('workspaceId'), {
              name: file.name,
              type: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
            }),
            201,
          );
        },
      )
      .delete('/attachments/:id', viewer, async (c) => {
        await dropAttachment(deps, me(c), c.req.param('id'));
        return c.body(null, 204);
      })
      .get('/attachments/:id', viewer, async (c) => {
        const found = await attachmentFile(deps, me(c), c.req.param('id'));
        // Only pictures show in the page; anything else (HTML, SVG …) is a download – never a
        // page of its own under the app's address.
        const shown = isPictureAttachment(found.type) && !c.req.query('download');
        c.header('Content-Type', shown ? found.type : 'application/octet-stream');
        c.header(
          'Content-Disposition',
          `${shown ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(found.name)}`,
        );
        // Its bytes never change: kept by the browser.
        c.header('Cache-Control', 'private, max-age=31536000, immutable');
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        c.header('X-Content-Type-Options', 'nosniff');
        return c.body(new Uint8Array(found.bytes));
      })
  );
}
