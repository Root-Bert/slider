import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { parseShareLink, updateDeckInputSchema } from '@slider/shared';
import { deckAccess, requireDeckAccess, requireOwner, viewerAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { decks, type DeckRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, notAPowerPoint } from '../http/errors';
import { readJson } from '../http/validate';
import { createDeckFromFile, deleteDeck, listWorkspaceDecks, toDeckDto } from '../services/decks';
import { assertDeckSlot } from '../services/plans';
import { listSlides } from '../services/slides';
import { requireRole, resolveUploadWorkspace } from '../services/workspaces';

/** Headroom for multipart boundaries and headers on top of the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const linkBodySchema = z.object({
  url: z.string().max(4096),
  /** BER-129; omitted by old clients → the first workspace the user may create decks in. */
  workspaceId: z.string().max(100).optional(),
});

/** Opening a deck keeps it in the automatic update rotation (BER-107); written at most hourly. */
const LAST_VIEWED_THROTTLE_MS = 60 * 60 * 1000;

async function touchLastViewed(deps: AppDeps, deck: DeckRow): Promise<void> {
  const now = deps.clock.now();
  if (deck.lastViewedAt && now.getTime() - deck.lastViewedAt.getTime() < LAST_VIEWED_THROTTLE_MS) {
    return;
  }
  await deps.db.update(decks).set({ lastViewedAt: now }).where(eq(decks.id, deck.id));
}

const unsupportedLink = () =>
  new ApiError(400, 'unsupported_link', 'Kein gültiger OneDrive-, SharePoint- oder PPTX-Link.');

export function decksRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const maxBytes = deps.config.maxUploadBytes;

  return (
    new Hono<ViewerEnv>()
      /** `?workspaceId=` → that workspace (members only); without it: all my workspaces. */
      .get('/decks', viewer, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const access = await viewerAccess(deps.db, viewer);
        if (access.kind !== 'user') throw new Error('unreachable');
        const workspaceId = c.req.query('workspaceId');
        if (workspaceId) await requireRole(deps.db, workspaceId, viewer.author.id);
        const workspaceIds = workspaceId ? [workspaceId] : [...access.roles.keys()];
        return c.json(await listWorkspaceDecks(deps.db, workspaceIds, access));
      })

      .post(
        '/decks/upload',
        viewer,
        bodyLimit({
          maxSize: maxBytes + MULTIPART_OVERHEAD_BYTES,
          onError: (c) => c.json(fileTooLarge(maxBytes).toBody(), 413),
        }),
        async (c) => {
          const { viewer } = c.var;
          requireOwner(viewer);
          const body = await c.req.parseBody().catch(() => {
            throw badRequest('Der Upload konnte nicht gelesen werden.');
          });
          const file = body['file'];
          if (!(file instanceof File))
            throw badRequest('Bitte eine Datei im Feld „file“ mitsenden.');
          if (!file.name.toLowerCase().endsWith('.pptx')) throw notAPowerPoint();
          if (file.size > maxBytes) throw fileTooLarge(maxBytes);
          if (file.size === 0) throw badRequest('Die Datei ist leer.');

          const field = body['workspaceId'];
          const workspaceId = await resolveUploadWorkspace(
            deps,
            viewer.author.id,
            typeof field === 'string' && field ? field : undefined,
          );
          await assertDeckSlot(deps.db, deps.config, workspaceId);
          const deck = await createDeckFromFile(
            deps,
            { ownerId: viewer.author.id, workspaceId },
            {
              fileName: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
              source: 'upload',
            },
          );
          return c.json(deck, 201);
        },
      )

      .post('/decks/link', viewer, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const { url, workspaceId: requested } = await readJson(c, linkBodySchema);
        const link = parseShareLink(url);
        if (!link) throw unsupportedLink();
        const workspaceId = await resolveUploadWorkspace(deps, viewer.author.id, requested);
        // Fail before downloading; `createDeckFromFile` checks again under a lock.
        await assertDeckSlot(deps.db, deps.config, workspaceId);

        const adapter = deps.sources[link.kind];
        const context = { userId: viewer.author.id };
        const remote = await adapter.resolve(link, context);
        if (!remote.fileName.toLowerCase().endsWith('.pptx')) throw notAPowerPoint();
        if (remote.sizeBytes > maxBytes) throw fileTooLarge(maxBytes);
        const deck = await createDeckFromFile(
          deps,
          { ownerId: viewer.author.id, workspaceId },
          {
            fileName: remote.fileName,
            bytes: await adapter.download(remote, context),
            source: link.kind,
            sourceUrl: link.url.href,
            sourceRef: remote.ref,
            changeToken: remote.changeToken,
          },
        );
        return c.json(deck, 201);
      })

      .get('/decks/:deckId', viewer, async (c) => {
        const { viewer } = c.var;
        const { deck } = await deckAccess(deps.db, viewer, c.req.param('deckId'), 'view');
        await touchLastViewed(deps, deck);
        return c.json(
          await toDeckDto(deps.db, deck, { access: await viewerAccess(deps.db, viewer) }),
        );
      })

      .patch('/decks/:deckId', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'own');
        const input = await readJson(c, updateDeckInputSchema);
        const now = deps.clock.now();
        const [updated] = await deps.db
          .update(decks)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.archived !== undefined
              ? { archivedAt: input.archived ? (deck.archivedAt ?? now) : null }
              : {}),
            updatedAt: now,
          })
          .where(eq(decks.id, deck.id))
          .returning();
        if (!updated) throw new Error(`Deck ${deck.id} vanished during update`);
        return c.json(
          await toDeckDto(deps.db, updated, { access: await viewerAccess(deps.db, c.var.viewer) }),
        );
      })

      .delete('/decks/:deckId', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'own');
        await deleteDeck(deps, deck.id);
        return c.body(null, 204);
      })

      .get('/decks/:deckId/slides', viewer, async (c) => {
        const deck = await requireDeckAccess(deps.db, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listSlides(deps.db, deck));
      })
  );
}
