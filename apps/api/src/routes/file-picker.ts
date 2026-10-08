import { Hono } from 'hono';
import { filePickerTokenInputSchema } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { microsoftNotConfigured } from '../sources/errors';

/**
 * Microsoft's OneDrive file picker (see `sources/onedrive-picker.ts`): which picker to open, and
 * the tokens it asks for while it runs. Picked files are imported with `POST /decks/drive-item`.
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
      const session = await picker().session({ userId: c.var.viewer.author.id });
      return c.json(session);
    })

    .post('/microsoft/file-picker/token', viewer, async (c) => {
      requireOwner(c.var.viewer);
      const { resource } = await readJson(c, filePickerTokenInputSchema);
      const token = await picker().token({ userId: c.var.viewer.author.id }, resource);
      // A bearer token for the person's own files: never cache it anywhere.
      c.header('Cache-Control', 'no-store');
      return c.json({ token });
    });
}
