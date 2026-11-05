import { deleteBlobs, storageBlobs } from '../services/blob-deletions';
import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { API_PREFIX, showRunSchema, type SavedShowRun } from '@slider/shared';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { requireDeckAccess } from '../auth/access';
import { advisoryXactLock } from '../db/client';
import { showRuns, slideVersions } from '../db/schema';
import type { AppDeps } from '../deps';
import { readJson } from '../http/validate';
import { badRequest, notFound } from '../http/errors';
import { parseRange } from '../http/range';
import { contentTypeForKey, fileUrl, isValidKey } from '../storage/blob-storage';
import { assertStorageFor } from '../services/plans';
import { measureDeckFiles } from '../services/deck-storage';
import { takeRecordingUpload } from './deck-tus';

const inputSchema = z.object({
  id: z.string().uuid(),
  run: showRunSchema,
  upload: z.string().max(200).optional(),
});
export function showRunRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const thumbnailsOf = async (revisionId: string | null) => {
    if (!revisionId) return new Map<string, string>();
    const rows = await deps.db
      .select({ slideId: slideVersions.slideId, key: slideVersions.thumbnailKey })
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, revisionId));
    return new Map(rows.map((slide) => [slide.slideId, slide.key]));
  };
  const dto = (
    row: typeof showRuns.$inferSelect,
    thumbnails: Map<string, string>,
  ): SavedShowRun => ({
    ...row.summary,
    rows: row.summary.rows.map((slide) => {
      // Persisted signatures expire after 6–12 hours; renew only this deck's blob links.
      const stored = slide.thumbnailUrl.split('?')[0]?.replace(/^\/files\//, '') ?? '';
      const key =
        thumbnails.get(slide.slideId) ??
        (stored.startsWith(`decks/${row.deckId}/`) && isValidKey(stored) ? stored : null);
      return { ...slide, thumbnailUrl: key ? fileUrl(key) : '' };
    }),
    id: row.id,
    recordingUrl: row.recordingKey
      ? `${API_PREFIX}/decks/${row.deckId}/runs/${row.id}/recording`
      : null,
  });
  return new Hono<ViewerEnv>()
    .get('/decks/:deckId/runs', viewer, async (c) => {
      const deckId = c.req.param('deckId');
      const deck = await requireDeckAccess(deps, c.var.viewer, deckId, 'view');
      const thumbnails = await thumbnailsOf(deck.currentRevisionId);
      const rows = await deps.db
        .select()
        .from(showRuns)
        .where(eq(showRuns.deckId, deckId))
        .orderBy(desc(showRuns.at), desc(showRuns.id))
        .limit(5);
      return c.json(rows.map((row) => dto(row, thumbnails)));
    })
    .post('/decks/:deckId/runs', viewer, async (c) => {
      const deckId = c.req.param('deckId');
      const deck = await requireDeckAccess(deps, c.var.viewer, deckId, 'comment');
      const input = await readJson(c, inputSchema);
      const thumbnails = await thumbnailsOf(deck.currentRevisionId);
      // A lost response may be retried without consuming the same upload twice.
      const [existing] = await deps.db
        .select()
        .from(showRuns)
        .where(and(eq(showRuns.id, input.id), eq(showRuns.deckId, deckId)));
      if (existing) return c.json(dto(existing, thumbnails));
      const upload = input.upload
        ? await takeRecordingUpload(deps, input.upload, c.var.viewer.author.id, { deckId })
        : null;
      let key: string | null = null;
      let committed = false;
      let wroteFile = false;
      try {
        if (upload) {
          const b = upload.bytes;
          const mp4 = new TextDecoder().decode(b.slice(4, 8)) === 'ftyp';
          const webm = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
          if (!mp4 && !webm) throw badRequest('Die Aufnahme muss eine MP4- oder WebM-Datei sein.');
          key = `decks/${deckId}/runs/${input.id}.${mp4 ? 'mp4' : 'webm'}`;
        }
        const saved = await deps.db.transaction(async (tx) => {
          await advisoryXactLock(tx, `show-runs:${deckId}`);
          const [again] = await tx.select().from(showRuns).where(eq(showRuns.id, input.id));
          if (again) {
            if (again.deckId !== deckId) throw badRequest('Diesen Durchgang gibt es schon.');
            return { row: again, older: [], created: false };
          }
          if (upload)
            await assertStorageFor(
              tx,
              deps.config,
              deck.workspaceId,
              upload?.bytes.length ?? 0,
              deps.clock.now(),
            );
          if (upload && key) {
            await deps.storage.put(key, upload.bytes);
            wroteFile = true;
          }
          const [row] = await tx
            .insert(showRuns)
            .values({
              id: input.id,
              deckId,
              at: deps.clock.now(),
              summary: input.run,
              recordingKey: key,
            })
            .returning();
          const older = await tx
            .select()
            .from(showRuns)
            .where(eq(showRuns.deckId, deckId))
            .orderBy(desc(showRuns.at), desc(showRuns.id))
            .offset(5);
          if (older.length)
            await tx.delete(showRuns).where(
              inArray(
                showRuns.id,
                older.map((each) => each.id),
              ),
            );
          await measureDeckFiles({ db: tx, storage: deps.storage }, deckId);
          return { row: row!, older, created: true };
        });
        committed = true;
        await deleteBlobs(
          deps,
          storageBlobs(saved.older.flatMap((old) => (old.recordingKey ? [old.recordingKey] : []))),
        );
        await measureDeckFiles(deps, deckId);
        await upload?.done();
        return c.json(dto(saved.row, thumbnails), saved.created ? 201 : 200);
      } catch (error) {
        if (!committed && wroteFile && key) await deleteBlobs(deps, storageBlobs([key]));
        await upload?.done(error);
        throw error;
      }
    })
    .get('/decks/:deckId/runs/:runId/recording', viewer, async (c) => {
      const deckId = c.req.param('deckId');
      await requireDeckAccess(deps, c.var.viewer, deckId, 'view');
      const [row] = await deps.db
        .select()
        .from(showRuns)
        .where(and(eq(showRuns.deckId, deckId), eq(showRuns.id, c.req.param('runId'))));
      if (!row?.recordingKey) throw notFound('Diese Aufnahme ist nicht mehr gespeichert.');
      const size = await deps.storage.size(row.recordingKey);
      if (size === null) throw notFound();
      const range = parseRange(c.req.header('Range'), size);
      c.header('Cache-Control', 'private, no-store');
      c.header('Accept-Ranges', 'bytes');
      c.header(
        'Content-Disposition',
        `inline; filename="Aufnahme.${row.recordingKey.endsWith('.mp4') ? 'mp4' : 'webm'}"`,
      );
      c.header('Content-Type', contentTypeForKey(row.recordingKey));
      if (range === 'unsatisfiable') {
        c.header('Content-Range', `bytes */${size}`);
        return c.body(null, 416);
      }
      if (range) c.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      c.header('Content-Length', String(range ? range.end - range.start + 1 : size));
      if (c.req.method === 'HEAD') return c.body(null, range ? 206 : 200);
      const stream = await deps.storage.stream(row.recordingKey, range || undefined);
      if (!stream) throw notFound();
      return c.body(stream, range ? 206 : 200);
    });
}
