import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import {
  localFileOpenInputSchema,
  localFileSaveInputSchema,
  type LocalFileOpened,
  type LocalFiles,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { electronOnly } from '../http/desktop-guard';
import { ApiError, badRequest, notFound } from '../http/errors';
import { readJson } from '../http/validate';
import { requireDeckAccess } from '../auth/access';
import { toDeckBytes } from '../import/any-file';
import { isOdpKey } from '../import/odp-deck';
import { createDeckFromFile } from '../services/decks';
import { LocalFilesSync } from '../services/local-files';
import { currentRevision } from '../services/edits/target';
import { createUploadedDeck } from './decks';

/*
 * The desktop's files on this computer (BER-201, `services/local-files`). Opening and saving take
 * a path, so they answer Electron only – it proves itself with the app's secret; a web page in
 * any browser could reach 127.0.0.1 too. Listing, showing in the Finder and passes are the page's.
 */

/** Files Slider opens; an ODP (and its template) is linked, the rest open as a copy. */
const LINKED = new Set(['.odp', '.otp']);

export function desktopFilesRoutes(deps: AppDeps) {
  if (!deps.config.desktop) return new Hono<ViewerEnv>();
  const files = new LocalFilesSync(deps);
  files.start();
  const fromElectron = electronOnly(deps.config.secret);
  const readable = async (filePath: string) => {
    try {
      return new Uint8Array(await readFile(filePath));
    } catch {
      throw new ApiError(404, 'not_found', `„${path.basename(filePath)}“ ließ sich nicht öffnen.`);
    }
  };

  return (
    new Hono<ViewerEnv>()
      .use('/desktop/files', viewerMiddleware(deps))
      .use('/desktop/files/*', viewerMiddleware(deps))
      .get('/desktop/files', (c) => c.json<LocalFiles>(files.list()))
      /** A pass now (tests; Electron after the window comes back to the front). */
      .post('/desktop/files/sync', async (c) => {
        await files.run({ flush: true });
        return c.json<LocalFiles>(files.list());
      })
      .post('/desktop/files/open', fromElectron, async (c) => {
        const { path: filePath } = await readJson(c, localFileOpenInputSchema);
        const known = files.deckOf(filePath);
        if (known) {
          await files.run({ flush: true });
          return c.json<LocalFileOpened>({ deckId: known, linked: true });
        }
        const original = await readable(filePath);
        const fileName = path.basename(filePath);
        const uploaded = await createUploadedDeck(deps, c.var.viewer, undefined, {
          fileName,
          original,
        });
        let { deck } = uploaded;
        const linked = LINKED.has(path.extname(filePath).toLowerCase());
        // The same bytes as a presentation that is another file here (a copy of it): a
        // presentation of its own – that one keeps its file.
        const other = linked && !uploaded.created ? files.list()[deck.id] : undefined;
        if (other && !other.missing && existsSync(other.path)) {
          deck = await createDeckFromFile(
            deps,
            { ownerId: c.var.viewer.author.id, workspaceId: deck.workspaceId },
            {
              fileName,
              bytes: await toDeckBytes(fileName, original, deps.documentPdf),
              source: 'upload',
            },
          );
        }
        if (linked) await files.link(deck.id, filePath, true);
        return c.json<LocalFileOpened>({ deckId: deck.id, linked });
      })
      /** „Als Datei sichern …“: the presentation written to this file, linked from now on. */
      .post('/desktop/files/:deckId/save', fromElectron, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'own');
        const { path: filePath } = await readJson(c, localFileSaveInputSchema);
        if (!LINKED.has(path.extname(filePath).toLowerCase())) {
          throw badRequest('Nur als ODP-Datei (.odp).');
        }
        const revision = await currentRevision(deps.db, deck);
        if (!isOdpKey(revision?.pptxKey ?? null)) {
          throw badRequest('Als Datei sichern geht nur mit Präsentationen im ODP-Format.');
        }
        await files.link(deck.id, filePath, false);
        await files.run({ flush: true });
        return c.json<LocalFiles>(files.list());
      })
      /** „Im Finder zeigen“: the file's path – Electron shows it in the Finder or file manager. */
      .post('/desktop/files/:deckId/reveal', (c) => {
        const filePath = files.revealed(c.req.param('deckId'));
        if (!filePath) throw notFound();
        return c.json({ path: filePath });
      })
  );
}
