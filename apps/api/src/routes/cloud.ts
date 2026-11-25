import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import {
  cloudActivityQuerySchema,
  cloudSummaryQuerySchema,
  cloudAreaCreateSchema,
  cloudAreaMembersInputSchema,
  cloudAreaUpdateSchema,
  cloudExtension,
  cloudFileType,
  cloudFolderInputSchema,
  cloudIdsInputSchema,
  cloudPdfInputSchema,
  cloudListQuerySchema,
  cloudMoveInputSchema,
  cloudRenameInputSchema,
  cloudSearchQuerySchema,
  cloudChangesQuerySchema,
  cloudShareInputSchema,
  cloudShareUpdateSchema,
  cloudColorInputSchema,
  cloudPinInputSchema,
  cloudUploadQuerySchema,
  cloudVersionLabelInputSchema,
  CLOUD_INLINE_AUDIO,
  CLOUD_INLINE_IMAGES,
  CLOUD_INLINE_VIDEO,
  CLOUD_MAX_BATCH,
  type CloudBatchResult,
  type CloudHome,
  type CloudListing,
  type CloudNodeDetail,
  type CloudOverview,
  type CloudPublic,
  type CloudSearchResult,
  type CloudChanges,
  type CloudUploadResult,
} from '@slider/shared';
import { deckAccess, requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { decks, type CloudNodeRow, type CloudVersionRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { ApiError, badRequest, fileTooLarge, notFound } from '../http/errors';
import { createUploadedDeck, existingDeckDto } from './decks';
import { cloudFocus } from '../services/cloud-focus';
import { cloudSummary } from '../services/cloud-news';
import { parseRange } from '../http/range';
import { rateLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  archiveOf,
  cloudContext,
  cloudPublicLinks,
  cloudSharing,
  cloudHome,
  cloudOverview,
  copyNodes,
  createArea,
  createFolder,
  createShare,
  deleteArea,
  deleteVersion,
  emptyTrash,
  labelVersion,
  listActivity,
  listNodes,
  listPeople,
  loadNode,
  makeThumbnail,
  moveNodes,
  nodeDetail,
  pageCount,
  pagePicture,
  publicFile,
  publicNodeRow,
  publicView,
  purgeNodes,
  removeShare,
  renameNode,
  restoreNodes,
  restoreVersion,
  searchNodes,
  syncChanges,
  setAreaMembers,
  setNodeColor,
  setPin,
  storeUpload,
  trashNodes,
  updateArea,
  updateShare,
  versionToServe,
} from '../services/cloud';
import {
  deckOfNode,
  deckPlaces,
  followArea,
  followMoved,
  followShares,
  linkDeck,
} from '../services/deck-places';
import { updateDeckAccess } from '../services/deck-access';
import { keepNodePdfs } from '../services/edits';
import { blobKeys } from '../storage/blob-storage';

/** A file's name for `Content-Disposition`: plain ASCII, and the real one for browsers that read it. */
export const dispositionName = (name: string) =>
  `filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Runs nothing, loads nothing: whatever someone uploaded stays a picture or text in Slider's origin. */
const INERT_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/**
 * How a file is sent when it is not being saved: pictures, video, audio and PDFs as what they
 * are, text as plain text (an uploaded HTML page is shown, never run) – everything else is
 * saved, whatever was asked.
 */
function inlineType(node: Pick<CloudNodeRow, 'name' | 'mimeType'>): string | null {
  const extension = cloudExtension(node.name);
  // By the name, never by what the upload called itself: a „picture“ sent as `text/html` is
  // not served as a page.
  if (CLOUD_INLINE_IMAGES.has(extension))
    return `image/${extension === 'jpg' ? 'jpeg' : extension}`;
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'pdf') return 'application/pdf';
  if (CLOUD_INLINE_VIDEO.has(extension)) {
    return node.mimeType?.startsWith('video/') ? node.mimeType : 'video/mp4';
  }
  if (CLOUD_INLINE_AUDIO.has(extension)) {
    return node.mimeType?.startsWith('audio/') ? node.mimeType : 'audio/mpeg';
  }
  const type = cloudFileType(node.name, node.mimeType);
  if (type === 'text' || extension === 'csv' || extension === 'tsv') {
    return 'text/plain; charset=utf-8';
  }
  return null;
}

/**
 * Sends a version's bytes: whole or a byte range (video seeks, downloads that go on where they
 * stopped). Asked again with its ETag after the access check: 304, no bytes.
 */
async function sendVersion(
  c: Context,
  deps: AppDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
  download: boolean,
): Promise<Response> {
  const etag = `"${version.id}"`;
  // Checked on every load: who lost access gets nothing from the browser's cache either.
  c.header('Cache-Control', 'private, no-cache');
  c.header('ETag', etag);
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
  const inline = download ? null : inlineType(node);
  c.header('Content-Type', inline ?? 'application/octet-stream');
  c.header('X-Content-Type-Options', 'nosniff');
  if (inline !== 'application/pdf') c.header('Content-Security-Policy', INERT_CSP);
  c.header(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; ${dispositionName(node.name)}`,
  );
  c.header('Accept-Ranges', 'bytes');
  const size = version.sizeBytes;
  const range = parseRange(c.req.header('Range'), size);
  if (range === 'unsatisfiable') {
    c.header('Content-Range', `bytes */${size}`);
    return c.body(null, 416);
  }
  const head = c.req.method === 'HEAD';
  const body = head ? null : await deps.storage.stream(version.storageKey, range ?? undefined);
  if (!head && !body) throw notFound('Die Datei ist nicht mehr gespeichert.');
  if (range) {
    c.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    c.header('Content-Length', String(range.end - range.start + 1));
    return body ? c.body(body, 206) : c.body(null, 206);
  }
  c.header('Content-Length', String(size));
  return body ? c.body(body) : c.body(null);
}

/**
 * A small picture or page, tagged by `tag` and what it holds: drawn anew (a presentation file's
 * PDF in its workspace's fonts, `redrawOld`) the browser takes the new one.
 */
async function sendPicture(c: Context, bytes: Uint8Array | null, tag: string): Promise<Response> {
  if (!bytes) throw notFound('Davon gibt es kein Bild.');
  const etag = `"${tag}-${createHash('sha1').update(bytes).digest('base64url').slice(0, 12)}"`;
  c.header('Cache-Control', 'private, no-cache');
  c.header('ETag', etag);
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304);
  c.header('Content-Type', 'image/jpeg');
  c.header('Content-Length', String(bytes.byteLength));
  return c.body(bytes as Uint8Array<ArrayBuffer>);
}

async function sendArchive(
  c: Context,
  deps: AppDeps,
  roots: CloudNodeRow[],
  name: string,
): Promise<Response> {
  const body = await archiveOf(deps, roots);
  c.header('Content-Type', 'application/zip');
  c.header('Cache-Control', 'no-store');
  c.header('Content-Disposition', `attachment; ${dispositionName(`${name}.zip`)}`);
  return c.body(body);
}

async function* bodyOf(request: Request): AsyncGenerator<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

/**
 * Cloud – the workspace's files (`services/cloud`): areas, folders, files and their versions,
 * sharing, the trash, activity, and what a link shows to someone outside.
 */
const noSharing = () =>
  badRequest(
    'Wer was sieht, regeln Rolle und Bereich im Workspace. Einzeln geteilt wird hier nicht.',
  );

export function cloudRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const user = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author.id;
  };
  const thumbnailOf = async (node: CloudNodeRow) => {
    if (node.kind !== 'file' || !node.currentVersionId) return null;
    if (node.thumbnail === 'none') await makeThumbnail(deps, node.id);
    if (node.thumbnail === 'failed') return null;
    return deps.storage.get(
      blobKeys.cloudThumbnail(node.workspaceId, node.id, node.currentVersionId),
    );
  };

  // Packing a folder reads every file in it, and anyone with the link may ask: not without end.
  const publicArchives = rateLimit({ limit: 20, windowMs: 60_000, clock: deps.clock });

  return (
    new Hono<ViewerEnv>()
      // ── A link, opened by someone outside: no account, only the token ──
      .get('/cloud/public/:token', async (c) =>
        c.json<CloudPublic>(await publicView(deps, c.req.param('token'), c.req.query('node'))),
      )
      .get('/cloud/public/:token/content', async (c) => {
        const { node, version } = await publicFile(deps, c.req.param('token'), c.req.query('node'));
        return sendVersion(c, deps, node, version, c.req.query('download') === '1');
      })
      .get('/cloud/public/:token/thumbnail', async (c) => {
        const { node, version } = await publicFile(deps, c.req.param('token'), c.req.query('node'));
        return sendPicture(c, await thumbnailOf(node), `${version.id}-t`);
      })
      .get('/cloud/public/:token/archive', publicArchives, async (c) => {
        const node = await publicNodeRow(deps, c.req.param('token'), c.req.query('node'));
        return sendArchive(c, deps, [node], node.name);
      })

      // ── The workspace's files ──
      .get('/workspaces/:id/cloud', viewer, async (c) =>
        c.json<CloudHome>(await cloudHome(deps, user(c), c.req.param('id'))),
      )
      .get('/workspaces/:id/cloud/overview', viewer, async (c) =>
        c.json<CloudOverview>(await cloudOverview(deps, user(c), c.req.param('id'))),
      )
      .get('/workspaces/:id/cloud/nodes', viewer, async (c) =>
        c.json<CloudListing>(
          await listNodes(
            deps,
            user(c),
            c.req.param('id'),
            cloudListQuerySchema.parse(c.req.query()),
          ),
        ),
      )
      // For a computer keeping a copy: what changed since it last asked.
      .get('/workspaces/:id/cloud/changes', viewer, async (c) =>
        c.json<CloudChanges>(
          await syncChanges(
            deps,
            user(c),
            c.req.param('id'),
            cloudChangesQuerySchema.parse(c.req.query()),
          ),
        ),
      )
      .get('/workspaces/:id/cloud/search', viewer, async (c) => {
        const searched = aiLimits(deps).fileSearches.hit(user(c));
        if (!searched.allowed) {
          c.header('Retry-After', String(searched.retryAfterS));
          throw new ApiError(
            429,
            'rate_limited',
            'Zu viele Suchen auf einmal – gleich noch einmal.',
          );
        }
        return c.json<CloudSearchResult>(
          await searchNodes(
            deps,
            user(c),
            c.req.param('id'),
            cloudSearchQuerySchema.parse(c.req.query()),
          ),
        );
      })
      .get('/workspaces/:id/cloud/activity', viewer, async (c) =>
        c.json(
          await listActivity(
            deps,
            user(c),
            c.req.param('id'),
            cloudActivityQuerySchema.parse(c.req.query()),
          ),
        ),
      )
      .get('/workspaces/:id/cloud/summary', viewer, async (c) => {
        const userId = user(c);
        const { since } = cloudSummaryQuerySchema.parse(c.req.query());
        return c.json(
          await cloudSummary(deps, userId, c.req.param('id'), c.var.viewer.author.name, since),
        );
      })
      // „Für dich“ on Cloud's start: `?ai=1` said by the AI, else at once as the server finds it.
      .get('/workspaces/:id/cloud/focus', viewer, async (c) => {
        user(c);
        return c.json(
          await cloudFocus(deps, c.var.viewer, c.req.param('id'), {
            ai: c.req.query('ai') === '1',
          }),
        );
      })
      .get('/workspaces/:id/cloud/people', viewer, async (c) =>
        c.json(await listPeople(deps, user(c), c.req.param('id'))),
      )
      .get('/workspaces/:id/cloud/archive', viewer, async (c) => {
        const userId = user(c);
        const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean);
        if (ids.length === 0 || ids.length > CLOUD_MAX_BATCH) throw badRequest('Was soll ins ZIP?');
        const roots: CloudNodeRow[] = [];
        for (const id of ids) {
          const { node } = await loadNode(deps, userId, id);
          if (node.workspaceId !== c.req.param('id')) throw notFound();
          roots.push(node);
        }
        const [only] = roots;
        return sendArchive(c, deps, roots, roots.length === 1 && only ? only.name : 'Dateien');
      })
      .post('/workspaces/:id/cloud/trash/empty', viewer, async (c) =>
        c.json(await emptyTrash(deps, user(c), c.req.param('id'))),
      )

      // ── Areas ──
      .post('/workspaces/:id/cloud/areas', viewer, async (c) => {
        const input = await readJson(c, cloudAreaCreateSchema);
        return c.json(await createArea(deps, user(c), c.req.param('id'), input), 201);
      })
      .patch('/cloud/areas/:areaId', viewer, async (c) => {
        const input = await readJson(c, cloudAreaUpdateSchema);
        const area = await updateArea(deps, user(c), c.req.param('areaId'), input);
        if (input.visibility !== undefined) await followArea(deps, area.id);
        return c.json(area);
      })
      .delete('/cloud/areas/:areaId', viewer, async (c) => {
        await deleteArea(deps, user(c), c.req.param('areaId'));
        return c.body(null, 204);
      })
      .put('/cloud/areas/:areaId/members', viewer, async (c) => {
        const { members } = await readJson(c, cloudAreaMembersInputSchema);
        const area = await setAreaMembers(deps, user(c), c.req.param('areaId'), members);
        await followArea(deps, c.req.param('areaId'));
        return c.json(area);
      })

      // ── Folders and files ──
      .post('/workspaces/:id/cloud/folders', viewer, async (c) => {
        const input = await readJson(c, cloudFolderInputSchema);
        return c.json(await createFolder(deps, user(c), c.req.param('id'), input), 201);
      })
      // A file sent whole: its bytes are the body, everything else is in the address.
      .post('/workspaces/:id/cloud/files', viewer, async (c) => {
        const userId = user(c);
        const query = cloudUploadQuerySchema.parse(c.req.query());
        // Checked before a byte is read: 404 for people outside the workspace.
        await cloudContext(deps.db, c.req.param('id'), userId);
        const declared = Number(c.req.header('content-length'));
        const result = await storeUpload(
          deps,
          userId,
          c.req.param('id'),
          { ...query, keepBoth: query.keepBoth === '1' },
          {
            data: bodyOf(c.req.raw),
            size: Number.isSafeInteger(declared) && declared >= 0 ? declared : null,
            mimeType: c.req.header('content-type') ?? null,
          },
        );
        return c.json<CloudUploadResult>(result, result.created ? 201 : 200);
      })
      .post('/cloud/nodes/move', viewer, async (c) => {
        const input = await readJson(c, cloudMoveInputSchema);
        const before = await deckPlaces(deps.db, input.ids);
        const result = await moveNodes(deps, user(c), input);
        // Presentations among them are seen as where they lie now (`services/deck-places`).
        await followMoved(deps, result.nodes, user(c), before);
        return c.json<CloudBatchResult>(result);
      })
      // „Als PDF ablegen“: presentations (or other office files) each as a PDF beside it, its few
      // (`CLOUD_PDF_BATCH`) one after another, each counted against the PDFs a minute.
      .post('/cloud/nodes/pdf', viewer, async (c) => {
        const { ids } = await readJson(c, cloudPdfInputSchema);
        return c.json(await keepNodePdfs(deps, c.var.viewer, ids));
      })
      .post('/cloud/nodes/copy', viewer, async (c) =>
        c.json<CloudBatchResult>(
          await copyNodes(deps, user(c), await readJson(c, cloudMoveInputSchema)),
        ),
      )
      .post('/cloud/nodes/trash', viewer, async (c) => {
        const { ids } = await readJson(c, cloudIdsInputSchema);
        return c.json<CloudBatchResult>(await trashNodes(deps, user(c), ids));
      })
      .post('/cloud/nodes/restore', viewer, async (c) => {
        const { ids } = await readJson(c, cloudIdsInputSchema);
        const before = await deckPlaces(deps.db, ids);
        const result = await restoreNodes(deps, user(c), ids);
        // Their folder may be gone, and they lie at the top of their area now.
        await followMoved(deps, result.nodes, user(c), before);
        return c.json<CloudBatchResult>(result);
      })
      .post('/cloud/nodes/purge', viewer, async (c) => {
        const { ids } = await readJson(c, cloudIdsInputSchema);
        return c.json(await purgeNodes(deps, user(c), ids));
      })
      .get('/cloud/nodes/:nodeId', viewer, async (c) =>
        c.json<CloudNodeDetail>(await nodeDetail(deps, user(c), c.req.param('nodeId'))),
      )
      .patch('/cloud/nodes/:nodeId', viewer, async (c) => {
        const { name } = await readJson(c, cloudRenameInputSchema);
        return c.json(await renameNode(deps, user(c), c.req.param('nodeId'), name));
      })
      .put('/cloud/nodes/:nodeId/color', viewer, async (c) => {
        const { color } = await readJson(c, cloudColorInputSchema);
        return c.json(await setNodeColor(deps, user(c), c.req.param('nodeId'), color));
      })
      .put('/cloud/nodes/:nodeId/pin', viewer, async (c) => {
        const { pinned } = await readJson(c, cloudPinInputSchema);
        return c.json(await setPin(deps, user(c), c.req.param('nodeId'), pinned));
      })
      .get('/cloud/nodes/:nodeId/content', viewer, async (c) => {
        const { node } = await loadNode(deps, user(c), c.req.param('nodeId'));
        const version = await versionToServe(deps, node, c.req.query('v'));
        return sendVersion(c, deps, node, version, c.req.query('download') === '1');
      })
      .get('/cloud/nodes/:nodeId/thumbnail', viewer, async (c) => {
        const { node } = await loadNode(deps, user(c), c.req.param('nodeId'));
        return sendPicture(c, await thumbnailOf(node), `${node.currentVersionId}-t`);
      })
      // The file as pages (a PDF, or an office file LibreOffice drew as one): how many …
      .get('/cloud/nodes/:nodeId/pages', viewer, async (c) => {
        const { node } = await loadNode(deps, user(c), c.req.param('nodeId'));
        const version = await versionToServe(deps, node, c.req.query('v'));
        const pages = await pageCount(deps, node, version);
        if (pages === null) throw notFound('Diese Datei lässt sich hier nicht zeigen.');
        c.header('Cache-Control', 'private, no-cache');
        return c.json({ pages });
      })
      // … and each one as a picture.
      .get('/cloud/nodes/:nodeId/pages/:page', viewer, async (c) => {
        const { node } = await loadNode(deps, user(c), c.req.param('nodeId'));
        const version = await versionToServe(deps, node, c.req.query('v'));
        const page = Number(c.req.param('page'));
        if (!Number.isInteger(page) || page < 1 || page > 5000) throw notFound();
        return sendPicture(
          c,
          await pagePicture(deps, node, version, page),
          `${version.id}-p${page}`,
        );
      })
      // A presentation (or anything Slider reads) opened in Slider: the presentation this file
      // stands for (`services/deck-places`) – made of its current version the first time, as an
      // upload of it would be, and the same one from then on.
      .post('/cloud/nodes/:nodeId/present', viewer, async (c) => {
        const { node, sharedRoot } = await loadNode(deps, user(c), c.req.param('nodeId'));
        const placed = await deckOfNode(deps.db, node.id);
        if (placed) {
          // Seeing the file (a share) is not seeing the presentation: that has its own list.
          await deckAccess(deps, c.var.viewer, placed.id, 'view');
          return c.json(await existingDeckDto(deps, c.var.viewer, placed));
        }
        const version = await versionToServe(deps, node);
        if (version.sizeBytes > deps.config.maxUploadBytes) {
          throw fileTooLarge(deps.config.maxUploadBytes);
        }
        const original = await deps.storage.get(version.storageKey);
        if (!original) throw notFound('Die Datei ist nicht mehr gespeichert.');
        const { deck, created } = await createUploadedDeck(
          deps,
          c.var.viewer,
          node.workspaceId,
          { fileName: node.name, original },
          // Its place is this file's, said below – never a copy of it in one's own files.
          false,
        );
        // Only a presentation made just now gets this place: one that was there before (the
        // same file uploaded earlier) stays open to whom it was.
        if (created) {
          const [row] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
          // Reached through a share only, the file is not the caller's to stand a presentation
          // on: the people of its place would open one that belongs to a guest.
          if (row && sharedRoot === null && (await linkDeck(deps, row, node))) {
            const [linked] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
            return c.json(await existingDeckDto(deps, c.var.viewer, linked ?? row), 201);
          }
          // No place for it here (someone else's file, shared): made of a file not everyone
          // sees, it is its maker's alone.
          if (row) {
            await updateDeckAccess(deps, row, { restricted: true, userIds: [] });
            const [own] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
            return c.json(await existingDeckDto(deps, c.var.viewer, own ?? row), 201);
          }
        }
        return c.json(deck, created ? 201 : 200);
      })
      .post('/cloud/nodes/:nodeId/shares', viewer, async (c) => {
        const input = await readJson(c, cloudShareInputSchema);
        if (!('link' in input) && !cloudSharing(deps.config)) throw noSharing();
        const share = await createShare(deps, user(c), c.req.param('nodeId'), input);
        // A presentation's file: whom it is shared with may open the presentation.
        await followShares(deps, c.req.param('nodeId'));
        return c.json(share, 201);
      })
      .patch('/cloud/shares/:shareId', viewer, async (c) => {
        const input = await readJson(c, cloudShareUpdateSchema);
        if (!cloudSharing(deps.config) && !cloudPublicLinks(deps.config)) throw noSharing();
        return c.json(await updateShare(deps, user(c), c.req.param('shareId'), input));
      })
      .delete('/cloud/shares/:shareId', viewer, async (c) => {
        const nodeId = await removeShare(deps, user(c), c.req.param('shareId'));
        await followShares(deps, nodeId);
        return c.body(null, 204);
      })

      // ── Versions ──
      .post('/cloud/versions/:versionId/restore', viewer, async (c) => {
        const node = await restoreVersion(deps, user(c), c.req.param('versionId'));
        // A text document open in Writer reads itself anew (no one listens on other files).
        deps.documentLive?.publish(node.id, { type: 'restored' });
        return c.json(node);
      })
      .patch('/cloud/versions/:versionId', viewer, async (c) => {
        const { label } = await readJson(c, cloudVersionLabelInputSchema);
        return c.json(await labelVersion(deps, user(c), c.req.param('versionId'), label));
      })
      .delete('/cloud/versions/:versionId', viewer, async (c) => {
        await deleteVersion(deps, user(c), c.req.param('versionId'));
        return c.body(null, 204);
      })
  );
}
