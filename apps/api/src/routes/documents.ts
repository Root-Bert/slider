import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { streamSSE } from 'hono/streaming';
import {
  createWriterAiProposalInputSchema,
  createWriterCommentInputSchema,
  createWriterDocumentInputSchema,
  updateWriterCommentInputSchema,
  setCommentReactionInputSchema,
  writerEditInputSchema,
  MAX_WRITER_PICTURE_BYTES,
  generateEditImageInputSchema,
  stockOrientationSchema,
  type WriterAiProposal,
  type WriterComment,
  type WriterDocument,
  type WriterEditResult,
  type WriterOpened,
  type WriterTools,
  writerPresenceInputSchema,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { resolveViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { ApiError, badRequest, fileTooLarge } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  listDocumentAi,
  moveDocumentAi,
  startDocumentAi,
  stopDocumentAi,
} from '../services/document-ai';
import {
  addDocumentPicture,
  generateDocumentPicture,
  documentTools,
  pickDocumentPhoto,
  searchDocumentPhotos,
  createDocument,
  createDocumentComment,
  deleteDocumentComment,
  documentOf,
  documentPicture,
  DocumentLive,
  editDocument,
  importDocument,
  listDocumentComments,
  listDocuments,
  MAX_DOCUMENT_FILE_BYTES,
  openDocument,
  setDocumentCommentReaction,
  updateDocumentComment,
} from '../services/documents';

/** What a document's stream sends its events as. */
export const DOCUMENT_EVENT = 'document';
const HEARTBEAT_MS = 15_000;
const ACCESS_CHECK_MS = 30_000;

/** The body whole, refused past `max` before it is held. */
export async function bodyBytes(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw fileTooLarge(max);
  const reader = request.body?.getReader();
  if (!reader) throw badRequest('Die Datei kam nicht an.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw fileTooLarge(max);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  if (size === 0) throw badRequest('Die Datei ist ohne Inhalt.');
  return bytes;
}

/**
 * Writer – text documents (`services/documents`). A document is a file in Cloud: renaming,
 * moving, deleting, restoring and its versions go through Cloud's own routes with its id.
 */
export function documentsRoutes(deps: AppDeps, live = new DocumentLive()) {
  const viewer = viewerMiddleware(deps);
  const user = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author.id;
  };

  // Every edit writes the file, a picture is stored, a photo picked is fetched with the
  // workspace's key – as for a slide's (`edits.ts`), a window of its own. The editor sends what
  // was typed 600 ms after the last key, one request after the other, and sends again on a 429.
  const editWindow = fixedWindow({ limit: 120, windowMs: 60_000, clock: deps.clock });
  const edits = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      editWindow.hit(c.var.viewer.author.id),
      'Zu viele Änderungen auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });
  // Every photo search costs the server's photo allowance – as for a slide's (`edits.ts`).
  const stockWindow = fixedWindow({ limit: 30, windowMs: 60_000, clock: deps.clock });
  const stockRequests = createMiddleware<ViewerEnv>(async (c, next) => {
    assertWithinLimit(
      c,
      stockWindow.hit(c.var.viewer.author.id),
      'Zu viele Fotosuchen auf einmal. Bitte warte einen Moment.',
    );
    await next();
  });

  return (
    new Hono<ViewerEnv>()
      .get('/workspaces/:id/documents', viewer, async (c) =>
        c.json<WriterDocument[]>(
          await listDocuments(
            deps,
            user(c),
            c.req.param('id'),
            c.req.query('scope') === 'trash' ? 'trash' : 'all',
          ),
        ),
      )
      .post('/documents', viewer, async (c) => {
        const input = await readJson(c, createWriterDocumentInputSchema);
        const place = { parentId: input.parentId, areaId: input.areaId };
        return c.json<WriterDocument>(await createDocument(deps, user(c), input, place), 201);
      })
      // A file made into a document: its bytes are the body, its name is in the address.
      .post('/workspaces/:id/documents/import', viewer, async (c) => {
        const userId = user(c);
        const name = c.req.query('name')?.trim();
        if (!name || name.length > 255) throw badRequest('Die Datei braucht einen Namen.');
        const bytes = await bodyBytes(c.req.raw, MAX_DOCUMENT_FILE_BYTES);
        return c.json<WriterDocument>(
          await importDocument(deps, userId, c.req.param('id'), name, bytes),
          201,
        );
      })
      .get('/documents/:documentId', viewer, async (c) => {
        c.header('Cache-Control', 'private, no-store');
        return c.json<WriterOpened>(await openDocument(deps, user(c), c.req.param('documentId')));
      })
      .get('/documents/:documentId/card', viewer, async (c) =>
        c.json<WriterDocument>(await documentOf(deps, user(c), c.req.param('documentId'))),
      )
      .post('/documents/:documentId/edits', viewer, edits, async (c) => {
        const input = await readJson(c, writerEditInputSchema);
        return c.json<WriterEditResult>(
          await editDocument(deps, live, user(c), c.req.param('documentId'), input),
        );
      })
      .get('/documents/:documentId/pictures', viewer, async (c) => {
        const picture = await documentPicture(
          deps,
          user(c),
          c.req.param('documentId'),
          c.req.query('path') ?? '',
        );
        c.header('Content-Type', picture.mimeType);
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        // A picture's part never changes: a new picture is a new part.
        c.header('Cache-Control', 'private, max-age=31536000, immutable');
        return c.body(picture.bytes as Uint8Array<ArrayBuffer>);
      })
      .post('/documents/:documentId/pictures', viewer, edits, async (c) => {
        const userId = user(c);
        const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        const bytes = await bodyBytes(c.req.raw, MAX_WRITER_PICTURE_BYTES);
        return c.json(
          await addDocumentPicture(deps, userId, c.req.param('documentId'), type, bytes),
          201,
        );
      })
      .get('/documents/:documentId/tools', viewer, async (c) =>
        c.json<WriterTools>(await documentTools(deps, user(c), c.req.param('documentId'))),
      )
      // A picture made by the AI, as for a slide's (`/decks/:id/edit/images/generate`).
      .post('/documents/:documentId/pictures/generate', viewer, async (c) => {
        const userId = user(c);
        assertWithinLimit(
          c,
          aiLimits(deps).aiRequests.hit(userId),
          'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
        );
        const input = await readJson(c, generateEditImageInputSchema);
        return c.json(
          await generateDocumentPicture(
            deps,
            userId,
            c.req.param('documentId'),
            input.prompt,
            input.aspect ?? null,
          ),
          201,
        );
      })
      // A photo of the workspace's photo service, as on a slide (`/decks/:id/stock/photos`).
      .get('/documents/:documentId/stock/photos', viewer, stockRequests, async (c) => {
        const orientation = stockOrientationSchema
          .optional()
          .safeParse(c.req.query('orientation') || undefined);
        const photos = await searchDocumentPhotos(
          deps,
          user(c),
          c.req.param('documentId'),
          (c.req.query('q') ?? '').slice(0, 200),
          orientation.data,
        );
        return c.json({ photos });
      })
      .post('/documents/:documentId/stock/photos/:photoId', viewer, edits, async (c) =>
        c.json(
          await pickDocumentPhoto(deps, user(c), c.req.param('documentId'), c.req.param('photoId')),
          201,
        ),
      )
      .get('/documents/:documentId/comments', viewer, async (c) =>
        c.json<WriterComment[]>(
          await listDocumentComments(deps, user(c), c.req.param('documentId')),
        ),
      )
      .post('/documents/:documentId/comments', viewer, async (c) => {
        const input = await readJson(c, createWriterCommentInputSchema);
        return c.json<WriterComment>(
          await createDocumentComment(deps, live, user(c), c.req.param('documentId'), input),
          201,
        );
      })
      .patch('/document-comments/:commentId', viewer, async (c) => {
        const input = await readJson(c, updateWriterCommentInputSchema);
        return c.json<WriterComment>(
          await updateDocumentComment(deps, live, user(c), c.req.param('commentId'), input),
        );
      })
      // One's own reaction (👍 / 👎 / egal), as on a slide's comment; `null` takes it back.
      .put('/document-comments/:commentId/reaction', viewer, async (c) => {
        user(c);
        const input = await readJson(c, setCommentReactionInputSchema);
        return c.json<WriterComment>(
          await setDocumentCommentReaction(
            deps,
            live,
            c.var.viewer.author,
            c.req.param('commentId'),
            input.kind,
          ),
        );
      })
      .delete('/document-comments/:commentId', viewer, async (c) => {
        await deleteDocumentComment(deps, live, user(c), c.req.param('commentId'));
        return c.body(null, 204);
      })
      // A comment handed to the AI (`services/document-ai`): on the workspace's AI key.
      .get('/documents/:documentId/ai-proposals', viewer, async (c) =>
        c.json<WriterAiProposal[]>(await listDocumentAi(deps, user(c), c.req.param('documentId'))),
      )
      .post('/documents/:documentId/ai-proposals', viewer, async (c) => {
        const userId = user(c);
        assertWithinLimit(
          c,
          aiLimits(deps).aiRequests.hit(userId),
          'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
        );
        const input = await readJson(c, createWriterAiProposalInputSchema);
        return c.json<WriterAiProposal>(
          await startDocumentAi(deps, live, userId, c.req.param('documentId'), input),
          202,
        );
      })
      .post('/document-ai-proposals/:proposalId/stop', viewer, async (c) =>
        c.json<WriterAiProposal>(
          await stopDocumentAi(deps, live, user(c), c.req.param('proposalId')),
        ),
      )
      .post('/document-ai-proposals/:proposalId/:action{revert|reapply}', viewer, async (c) =>
        c.json<WriterAiProposal>(
          await moveDocumentAi(
            deps,
            live,
            user(c),
            c.req.param('proposalId'),
            c.req.param('action') === 'revert' ? 'revert' : 'reapply',
          ),
        ),
      )
      /** What happens in the document while it is open: steps, comments, who else is there. */
      .get('/documents/:documentId/live', viewer, async (c) => {
        const userId = user(c);
        const documentId = c.req.param('documentId');
        await documentOf(deps, userId, documentId);
        const author = c.var.viewer.author;
        c.header('X-Accel-Buffering', 'no');
        const stillAllowed = async () => {
          try {
            const current = await resolveViewer(c, deps, { readOnly: true });
            if (current?.author.id !== author.id) return false;
            await documentOf(deps, userId, documentId);
            return true;
          } catch (error) {
            if (error instanceof ApiError) return false;
            deps.log.warn(`Live access check for document ${documentId} failed`, error);
            return true;
          }
        };
        return streamSSE(c, async (stream) => {
          const open = () => !stream.aborted && !stream.closed;
          const leave = live.join(documentId, author, (event) => {
            if (!open()) return;
            stream.writeSSE({ event: DOCUMENT_EVENT, data: JSON.stringify(event) }).catch(() => {});
          });
          stream.onAbort(leave);
          let checkedAt = Date.now();
          try {
            while (open()) {
              await stream.sleep(HEARTBEAT_MS);
              if (!open()) break;
              if (Date.now() - checkedAt >= ACCESS_CHECK_MS) {
                checkedAt = Date.now();
                if (!(await stillAllowed())) break;
              }
              await stream.write(': ping\n\n');
            }
          } finally {
            leave();
          }
        });
      })
      /** Where my caret stands, told to the others who have it open (as a slide's text carets). */
      .post('/documents/:documentId/presence', viewer, async (c) => {
        const { sel } = await readJson(c, writerPresenceInputSchema);
        const documentId = c.req.param('documentId');
        await documentOf(deps, user(c), documentId);
        live.publish(documentId, { type: 'cursor', author: c.var.viewer.author, sel });
        return c.body(null, 204);
      })
  );
}
