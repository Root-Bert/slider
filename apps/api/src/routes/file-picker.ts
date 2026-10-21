import { Hono } from 'hono';
import { filePickerTokenInputSchema } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { microsoftNotConfigured } from '../sources/errors';
import { pickerContext } from '../sources/onedrive-picker';

/**
 * Microsoft's OneDrive file picker (see `sources/onedrive-picker.ts`): which picker to open, and
 * the tokens it asks for while it runs. Picked files are imported with `POST /decks/drive-item`.
 * All three name the Microsoft connection the person chose (`connectionId`, else the latest).
 */
export function filePickerRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);

  const picker = () => {
    if (!deps.config.microsoft || !deps.sources.picker) throw microsoftNotConfigured();
    return deps.sources.picker;
  };

  return new Hono<ViewerEnv>()
    .get('/microsoft/file-picker', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const context = await pickerContext(
        deps,
        c.var.viewer.author.id,
        c.req.query('connectionId') || undefined,
      );
      const session = await picker().session(context);
      return c.json(session);
    })

    .post('/microsoft/file-picker/token', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { resource, connectionId } = await readJson(c, filePickerTokenInputSchema);
      const context = await pickerContext(deps, c.var.viewer.author.id, connectionId);
      const token = await picker().token(context, resource);
      // A bearer token for the person's own files: never cache it anywhere.
      c.header('Cache-Control', 'no-store');
      return c.json({ token });
    });
}
