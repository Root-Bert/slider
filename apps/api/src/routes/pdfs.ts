import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  createReaderAiProposalInputSchema,
  createReaderCommentInputSchema,
  createReaderSignatureInputSchema,
  MAX_READER_FILE_BYTES,
  readerMarkBodySchema,
  readerMarkIdSchema,
  updateReaderCommentInputSchema,
  type ReaderAiProposal,
  type ReaderComment,
  type ReaderMark,
  type ReaderOpened,
  type ReaderPdf,
  type ReaderSignature,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { resolveViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { ApiError, badRequest } from '../http/errors';
import { assertWithinLimit } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { listPdfAi, movePdfAi, startPdfAi, stopPdfAi } from '../services/pdf-ai';
import {
  createPdfComment,
  createSignature,
  deletePdfComment,
  deleteSignature,
  exportPdf,
  importPdf,
  listPdfComments,
  listPdfs,
  listSignatures,
  openPdf,
  pdfFile,
  pdfOf,
  PdfLive,
  removePdfMark,
  setPdfMark,
  updatePdfComment,
} from '../services/pdfs';
import { bodyBytes } from './documents';

/** What a PDF's stream sends its events as. */
export const PDF_EVENT = 'pdf';
const HEARTBEAT_MS = 15_000;
const ACCESS_CHECK_MS = 30_000;

/** `Content-Disposition` for a file name with any letters in it. */
const disposition = (kind: 'inline' | 'attachment', name: string) =>
  `${kind}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/**
 * Reader – PDFs (`services/pdfs`). A PDF is a file in Cloud: renaming, moving, deleting,
 * restoring and its versions go through Cloud's own routes with its id.
 */
export function pdfsRoutes(deps: AppDeps, live = new PdfLive()) {
  const viewer = viewerMiddleware(deps);
  const user = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author.id;
  };
  const markId = (raw: string) => {
    const parsed = readerMarkIdSchema.safeParse(decodeURIComponent(raw));
    if (!parsed.success) throw badRequest('Diese Markierung gibt es nicht.');
    return parsed.data;
  };

  return (
    new Hono<ViewerEnv>()
      .get('/workspaces/:id/pdfs', viewer, async (c) =>
        c.json<ReaderPdf[]>(
          await listPdfs(
            deps,
            user(c),
            c.req.param('id'),
            c.req.query('scope') === 'trash' ? 'trash' : 'all',
          ),
        ),
      )
      // A PDF brought in: its bytes are the body, its name is in the address.
      .post('/workspaces/:id/pdfs/import', viewer, async (c) => {
        const userId = user(c);
        const name = c.req.query('name')?.trim();
        if (!name || name.length > 255) throw badRequest('Die Datei braucht einen Namen.');
        const bytes = await bodyBytes(c.req.raw, MAX_READER_FILE_BYTES);
        return c.json<ReaderPdf>(await importPdf(deps, userId, c.req.param('id'), name, bytes), 201);
      })
      .get('/pdfs/:pdfId', viewer, async (c) => {
        c.header('Cache-Control', 'private, no-store');
        return c.json<ReaderOpened>(await openPdf(deps, user(c), c.req.param('pdfId')));
      })
      .get('/pdfs/:pdfId/card', viewer, async (c) =>
        c.json<ReaderPdf>(await pdfOf(deps, user(c), c.req.param('pdfId'))),
      )
      // The file as it lies in Cloud – one version's bytes never change.
      .get('/pdfs/:pdfId/file', viewer, async (c) => {
        const file = await pdfFile(deps, user(c), c.req.param('pdfId'));
        c.header('Content-Type', 'application/pdf');
        c.header('Content-Disposition', disposition('inline', file.name));
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        c.header('Cache-Control', 'private, no-cache');
        c.header('ETag', `"${file.versionId}"`);
        if (c.req.header('if-none-match') === `"${file.versionId}"`) return c.body(null, 304);
        return c.body(file.bytes as Uint8Array<ArrayBuffer>);
      })
      // With everything filled in baked into it: printed and exported.
      .get('/pdfs/:pdfId/export', viewer, async (c) => {
        const file = await exportPdf(deps, user(c), c.req.param('pdfId'));
        c.header('Content-Type', 'application/pdf');
        c.header('Content-Disposition', disposition('attachment', file.name));
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        c.header('Cache-Control', 'private, no-store');
        return c.body(file.bytes as Uint8Array<ArrayBuffer>);
      })
      .put('/pdfs/:pdfId/marks/:markId', viewer, async (c) => {
        const body = await readJson(c, readerMarkBodySchema);
        return c.json<ReaderMark>(
          await setPdfMark(
            deps,
            live,
            user(c),
            c.req.param('pdfId'),
            markId(c.req.param('markId')),
            body,
          ),
        );
      })
      .delete('/pdfs/:pdfId/marks/:markId', viewer, async (c) => {
        await removePdfMark(
          deps,
          live,
          user(c),
          c.req.param('pdfId'),
          markId(c.req.param('markId')),
        );
        return c.body(null, 204);
      })
      .get('/reader/signatures', viewer, async (c) => {
        c.header('Cache-Control', 'private, no-store');
        return c.json<ReaderSignature[]>(await listSignatures(deps, user(c)));
      })
      .post('/reader/signatures', viewer, async (c) => {
        const input = await readJson(c, createReaderSignatureInputSchema);
        return c.json<ReaderSignature>(await createSignature(deps, user(c), input), 201);
      })
      .delete('/reader/signatures/:signatureId', viewer, async (c) => {
        await deleteSignature(deps, user(c), c.req.param('signatureId'));
        return c.body(null, 204);
      })
      .get('/pdfs/:pdfId/comments', viewer, async (c) =>
        c.json<ReaderComment[]>(await listPdfComments(deps, user(c), c.req.param('pdfId'))),
      )
      .post('/pdfs/:pdfId/comments', viewer, async (c) => {
        const input = await readJson(c, createReaderCommentInputSchema);
        return c.json<ReaderComment>(
          await createPdfComment(deps, live, user(c), c.req.param('pdfId'), input),
          201,
        );
      })
      .patch('/pdf-comments/:commentId', viewer, async (c) => {
        const input = await readJson(c, updateReaderCommentInputSchema);
        return c.json<ReaderComment>(
          await updatePdfComment(deps, live, user(c), c.req.param('commentId'), input),
        );
      })
      .delete('/pdf-comments/:commentId', viewer, async (c) => {
        await deletePdfComment(deps, live, user(c), c.req.param('commentId'));
        return c.body(null, 204);
      })
      // A comment handed to the AI (`services/pdf-ai`): on the workspace's AI key.
      .get('/pdfs/:pdfId/ai-proposals', viewer, async (c) =>
        c.json<ReaderAiProposal[]>(await listPdfAi(deps, user(c), c.req.param('pdfId'))),
      )
      .post('/pdfs/:pdfId/ai-proposals', viewer, async (c) => {
        const userId = user(c);
        assertWithinLimit(
          c,
          aiLimits(deps).aiRequests.hit(userId),
          'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
        );
        const input = await readJson(c, createReaderAiProposalInputSchema);
        return c.json<ReaderAiProposal>(
          await startPdfAi(deps, live, userId, c.req.param('pdfId'), input),
          202,
        );
      })
      .post('/pdf-ai-proposals/:proposalId/stop', viewer, async (c) =>
        c.json<ReaderAiProposal>(await stopPdfAi(deps, live, user(c), c.req.param('proposalId'))),
      )
      .post('/pdf-ai-proposals/:proposalId/:action{revert|reapply}', viewer, async (c) =>
        c.json<ReaderAiProposal>(
          await movePdfAi(
            deps,
            live,
            user(c),
            c.req.param('proposalId'),
            c.req.param('action') === 'revert' ? 'revert' : 'reapply',
          ),
        ),
      )
      /** What happens on the PDF while it is open: marks, comments, who else is there. */
      .get('/pdfs/:pdfId/live', viewer, async (c) => {
        const userId = user(c);
        const pdfId = c.req.param('pdfId');
        await pdfOf(deps, userId, pdfId);
        const author = c.var.viewer.author;
        c.header('X-Accel-Buffering', 'no');
        const stillAllowed = async () => {
          try {
            const current = await resolveViewer(c, deps, { readOnly: true });
            if (current?.author.id !== author.id) return false;
            await pdfOf(deps, userId, pdfId);
            return true;
          } catch (error) {
            if (error instanceof ApiError) return false;
            deps.log.warn(`Live access check for PDF ${pdfId} failed`, error);
            return true;
          }
        };
        return streamSSE(c, async (stream) => {
          const open = () => !stream.aborted && !stream.closed;
          const leave = live.join(pdfId, author, (event) => {
            if (!open()) return;
            stream.writeSSE({ event: PDF_EVENT, data: JSON.stringify(event) }).catch(() => {});
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
  );
}
