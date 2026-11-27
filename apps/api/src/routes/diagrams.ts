import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  askDiagramInputSchema,
  createDiagramInputSchema,
  saveDiagramInputSchema,
  type DiagramAnswer,
  type DiagramFile,
  type DiagramOpened,
  type DiagramSaved,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { resolveViewer, viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { ApiError } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  askDiagram,
  createDiagram,
  loadDiagramNode,
  openDiagram,
  saveDiagram,
} from '../services/diagrams';
import { DocumentLive } from '../services/documents';
import { DOCUMENT_EVENT } from './documents';

const HEARTBEAT_MS = 15_000;
const ACCESS_CHECK_MS = 30_000;
/** A diagram is sent whole: 1000 boxes with their words fit in this. */
const MAX_DIAGRAM_BODY_BYTES = 8 * 1024 ** 2;

/**
 * Diagrams (`services/diagrams`). A diagram is a file in Cloud: renaming, moving, deleting,
 * restoring and its versions go through Cloud's own routes with its id.
 */
export function diagramsRoutes(deps: AppDeps, live = new DocumentLive()) {
  const viewer = viewerMiddleware(deps);
  const user = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return c.var.viewer.author.id;
  };
  // The editor saves a moment after the last change, one save after the other – as a document's
  // steps (`documents.ts`), a window of its own.
  const saveWindow = fixedWindow({ limit: 120, windowMs: 60_000, clock: deps.clock });

  return (
    new Hono<ViewerEnv>()
      .post('/diagrams', viewer, async (c) => {
        const { diagram, ...input } = await readJson(c, createDiagramInputSchema);
        return c.json<DiagramFile>(await createDiagram(deps, user(c), input, diagram), 201);
      })
      .get('/diagrams/:diagramId', viewer, async (c) => {
        c.header('Cache-Control', 'private, no-store');
        return c.json<DiagramOpened>(await openDiagram(deps, user(c), c.req.param('diagramId')));
      })
      .put('/diagrams/:diagramId', viewer, async (c) => {
        const userId = user(c);
        assertWithinLimit(
          c,
          saveWindow.hit(userId),
          'Zu viele Änderungen auf einmal. Bitte warte einen Moment.',
        );
        const input = await readJson(c, saveDiagramInputSchema, MAX_DIAGRAM_BODY_BYTES);
        return c.json<DiagramSaved>(
          await saveDiagram(deps, live, userId, c.req.param('diagramId'), input),
        );
      })
      /** „Was soll sich ändern?“: the AI's changes, applied by the editor as one step. */
      .post('/diagrams/:diagramId/ask', viewer, async (c) => {
        const userId = user(c);
        assertWithinLimit(
          c,
          aiLimits(deps).aiRequests.hit(userId),
          'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
        );
        const input = await readJson(c, askDiagramInputSchema, MAX_DIAGRAM_BODY_BYTES);
        return c.json<DiagramAnswer>(
          await askDiagram(deps, userId, c.req.param('diagramId'), input),
        );
      })
      /** Who has it open, and each save – as a document's stream (`documents.ts`). */
      .get('/diagrams/:diagramId/live', viewer, async (c) => {
        const userId = user(c);
        const diagramId = c.req.param('diagramId');
        await loadDiagramNode(deps, userId, diagramId);
        const author = c.var.viewer.author;
        c.header('X-Accel-Buffering', 'no');
        const stillAllowed = async () => {
          try {
            const current = await resolveViewer(c, deps, { readOnly: true });
            if (current?.author.id !== author.id) return false;
            await loadDiagramNode(deps, userId, diagramId);
            return true;
          } catch (error) {
            if (error instanceof ApiError) return false;
            deps.log.warn(`Live access check for diagram ${diagramId} failed`, error);
            return true;
          }
        };
        return streamSSE(c, async (stream) => {
          const open = () => !stream.aborted && !stream.closed;
          const leave = live.join(diagramId, author, (event) => {
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
  );
}
