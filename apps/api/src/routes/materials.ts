import { Hono } from 'hono';
import {
  addMaterialInputSchema,
  createBoardItemInputSchema,
  moveBoardInputSchema,
  updateBoardItemInputSchema,
} from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { readJson } from '../http/validate';
import {
  addMaterial,
  retriedMaterial,
  createBoardItem,
  deleteBoardItem,
  getBoard,
  getMaterialForViewer,
  moveBoard,
  updateBoardItem,
} from '../services/materials';
import { deckBoard, documentBoard, type BoardOwner } from '../services/board-owner';
import { takeMaterialUpload } from './deck-tus';

/**
 * A board's routes stand under its owner: `/decks/:id/…` for a presentation's, `/documents/:id/…`
 * for a text document's – the same routes, shapes and rules (`requireBoardAccess` decides who).
 */
export const BOARD_OWNER_PATH = '/:kind{decks|documents}/:ownerId';

/** How long the browser keeps a file of the board without asking again (as recordings). */
const MATERIAL_MAX_AGE_S = 5 * 60;

/** Shown in the browser as they are; every other file is downloaded, never opened inline. */
const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

/** `filename*` for Content-Disposition: any name, quoted safely. */
const dispositionName = (name: string) =>
  `filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * The board of a deck – its material page „Material“ (`services/materials.ts`):
 * - `GET /decks/:deckId/board` → `Board` (everyone who sees the deck);
 * - `POST /decks/:deckId/materials` `{ id, upload, x, y, w, h }` → `Material` (201; 200 when
 *   sent again) – the file sent before over tus (`purpose material`, `deckId`);
 * - `POST /decks/:deckId/board/items` `{ id, kind, text, url, x, y, w, h }` → `BoardItem`;
 * - `PATCH /decks/:deckId/board/items/:itemId` `{ text?, url? }` → `BoardItem` (its author);
 * - `PATCH /decks/:deckId/board` `{ frames: [{ id, x, y, w, h }] }` → 204 (moved, resized);
 * - `DELETE /decks/:deckId/board/:itemId` → 204 (a file, note or link);
 * - `GET /materials/:id/file`, `GET /materials/:id/preview` – the file and its small picture.
 *
 * A text document's board (Writer) has the same routes under `/documents/:documentId/…`; its
 * uploads name `documentId` in place of `deckId`.
 */
/** Files read whole into memory at once (each up to the upload limit); the next ones wait. */
const MATERIALS_IN_MEMORY = 2;

/** Lets `limit` run at a time; the others wait their turn, in order. */
function turns(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((go) => waiting.push(go));
    else running += 1;
    try {
      return await work();
    } finally {
      // Hands its place straight to the next one waiting.
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}

/** The board named in the address: a deck's (`/decks/:id/…`) or a text document's. */
export const ownerIn = (c: { req: { param: (name: 'kind' | 'ownerId') => string } }): BoardOwner =>
  c.req.param('kind') === 'documents'
    ? documentBoard(c.req.param('ownerId'))
    : deckBoard(c.req.param('ownerId'));

export function materialsRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const inMemory = turns(MATERIALS_IN_MEMORY);

  return new Hono<ViewerEnv>()
    .get(`${BOARD_OWNER_PATH}/board`, viewer, async (c) =>
      c.json(await getBoard(deps, c.var.viewer, ownerIn(c))),
    )
    .post(`${BOARD_OWNER_PATH}/materials`, viewer, async (c) => {
      const owner = ownerIn(c);
      const input = await readJson(c, addMaterialInputSchema);
      if (!input.upload) throw badRequest('Die Datei fehlt (Feld „upload“).');
      const again = await retriedMaterial(deps, c.var.viewer, owner, input.id);
      if (again) return c.json(again);
      const upload = input.upload;
      const userId = c.var.viewer.author.id;
      // Few at a time hold their file in memory: many finished at once wait instead of adding up.
      return inMemory(async () => {
        const sent = await takeMaterialUpload(deps, upload, userId, owner);
        try {
          const { material, created } = await addMaterial(deps, c.var.viewer, owner, input, {
            name: sent.fileName,
            bytes: sent.bytes,
          });
          await sent.done();
          return c.json(material, created ? 201 : 200);
        } catch (error) {
          await sent.done(error);
          throw error;
        }
      });
    })
    .post(`${BOARD_OWNER_PATH}/board/items`, viewer, async (c) => {
      const input = await readJson(c, createBoardItemInputSchema);
      const { item, created } = await createBoardItem(deps, c.var.viewer, ownerIn(c), input);
      return c.json(item, created ? 201 : 200);
    })
    .patch(`${BOARD_OWNER_PATH}/board/items/:itemId`, viewer, async (c) => {
      const input = await readJson(c, updateBoardItemInputSchema);
      return c.json(
        await updateBoardItem(deps, c.var.viewer, ownerIn(c), c.req.param('itemId'), input),
      );
    })
    .patch(`${BOARD_OWNER_PATH}/board`, viewer, async (c) => {
      const input = await readJson(c, moveBoardInputSchema);
      await moveBoard(deps, c.var.viewer, ownerIn(c), input);
      return c.body(null, 204);
    })
    .delete(`${BOARD_OWNER_PATH}/board/:itemId`, viewer, async (c) => {
      await deleteBoardItem(deps, c.var.viewer, ownerIn(c), c.req.param('itemId'));
      return c.body(null, 204);
    })
    .get('/materials/:materialId/:part{file|preview}', viewer, async (c) => {
      const row = await getMaterialForViewer(deps, c.var.viewer, c.req.param('materialId'));
      const preview = c.req.param('part') === 'preview';
      const key = preview ? row.previewKey : row.storageKey;
      const gone = () => notFound('Die Datei ist nicht mehr gespeichert.');
      if (!key) throw gone();
      const etag = `"${row.sha256}${preview ? '-p' : ''}"`;
      const cacheControl = `private, max-age=${MATERIAL_MAX_AGE_S}`;
      c.header('Cache-Control', cacheControl);
      c.header('ETag', etag);
      if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
      const body = await deps.media.stream(key);
      if (!body) throw gone();
      const type = preview ? 'image/jpeg' : row.mimeType;
      const inline = preview || INLINE_TYPES.has(type);
      c.header('Content-Type', inline ? type : 'application/octet-stream');
      c.header('X-Content-Type-Options', 'nosniff');
      // A file put down by anyone runs nothing in Slider's origin, even opened in a tab (a PDF
      // has the browser's own viewer, which a sandbox would block).
      if (type !== 'application/pdf') {
        c.header('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'");
      }
      c.header(
        'Content-Disposition',
        `${inline && c.req.query('download') === undefined ? 'inline' : 'attachment'}; ${dispositionName(row.name)}`,
      );
      return c.body(body);
    });
}
