import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import {
  DECK_SEARCH_MAX_LENGTH,
  DECK_SEARCH_MIN_LENGTH,
  importDriveItemInputSchema,
  importGoogleItemInputSchema,
  importNextcloudItemInputSchema,
  LINK_CREDENTIALS_MESSAGE,
  linkHasCredentials,
  parseShareLink,
  updateDeckAccessInputSchema,
  updateDeckInputSchema,
  type Deck,
  type DeckSearchResult,
  type DeckSource,
  type Viewer,
} from '@slider/shared';
import { deckAccess, requireDeckAccess, requireOwner, viewerAccess } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import { decks, revisions, type DeckRow } from '../db/schema';
import { toDeckBytes } from '../import/any-file';
import { sha256Hex } from '../import/common';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, notFound } from '../http/errors';
import { deckUploadSlot, importLimit } from '../http/import-limit';
import { fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import { withConnections } from '../sources/connections';
import { pickerContext, withPickerLogin } from '../sources/onedrive-picker';
import {
  readContributors,
  type RemoteFile,
  type SourceAdapter,
  type SourceContext,
} from '../sources/source-adapter';
import {
  createDeckFromFile,
  deleteDeck,
  listDeckPeople,
  listWorkspaceDecks,
  toDeckDto,
} from '../services/decks';
import { getDeckAccess, updateDeckAccess } from '../services/deck-access';
import { searchDecks } from '../services/deck-search';
import { findFolder } from '../services/folders';
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
/** Text searches per account and minute (BER-175): a search asks once typing pauses. */
export const SEARCHES_PER_MINUTE = 60;

async function touchLastViewed(deps: AppDeps, deck: DeckRow): Promise<void> {
  const now = deps.clock.now();
  if (deck.lastViewedAt && now.getTime() - deck.lastViewedAt.getTime() < LAST_VIEWED_THROTTLE_MS) {
    return;
  }
  await deps.db.update(decks).set({ lastViewedAt: now }).where(eq(decks.id, deck.id));
}

/**
 * The deck in `workspaceId` that matches `condition` and I may open – the newest, active ones
 * before archived ones. A deck I may not open (its source refuses me) doesn't count.
 */
async function findExistingDeck(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  condition: SQL | undefined,
) {
  const rows = await deps.db
    .select({ id: decks.id })
    .from(decks)
    .leftJoin(revisions, eq(revisions.id, decks.currentRevisionId))
    .where(and(eq(decks.workspaceId, workspaceId), condition))
    .orderBy(sql`${decks.archivedAt} is not null`, desc(decks.updatedAt));
  for (const { id } of rows) {
    const found = await deckAccess(deps, viewer, id, 'view').catch((error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    });
    if (found) return found.deck;
  }
  return null;
}

/** The deck already linked to this source file. */
const findLinkedDeck = (deps: AppDeps, viewer: Viewer, workspaceId: string, ref: string) =>
  findExistingDeck(deps, viewer, workspaceId, eq(decks.sourceRef, ref));

/**
 * The deck whose current version is exactly this file (by the SHA-256 of the file as it came) –
 * the same file reached another way (OneDrive picker vs. pasted link, uploaded twice). `linkedOnly`: only decks linked to a source,
 * so a linked file never ends up on an uploaded copy that would not sync.
 */
const findDeckWithContent = (
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  sourceSha256: string,
  { linkedOnly }: { linkedOnly: boolean },
) =>
  findExistingDeck(
    deps,
    viewer,
    workspaceId,
    and(
      eq(revisions.contentSha256, sourceSha256),
      linkedOnly ? ne(decks.source, 'upload') : undefined,
    ),
  );

const existingDeckDto = async (deps: AppDeps, viewer: Viewer, deck: DeckRow) =>
  toDeckDto(deps.db, deck, { access: await viewerAccess(deps.db, viewer) });

/**
 * Downloads a resolved source file and starts its import – unless the workspace has a deck of
 * that file already: picking it again opens that one instead of a second review.
 */
async function importRemote(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  adapter: SourceAdapter,
  context: SourceContext,
  remote: RemoteFile,
  source: { kind: Exclude<DeckSource, 'upload'>; url?: string },
  /** The Microsoft connection that read the file; `null` for public files. */
  microsoftConnectionId: string | null,
): Promise<{ deck: Deck; created: boolean }> {
  const linked = await findLinkedDeck(deps, viewer, workspaceId, remote.ref);
  if (linked) return { deck: await existingDeckDto(deps, viewer, linked), created: false };
  // Only a new deck needs a slot; `createDeckFromFile` checks again under a lock.
  await assertDeckSlot(deps.db, deps.config, workspaceId);

  const nextcloudConnectionId = context.nextcloudConnectionId ?? null;
  const googleConnectionId = context.googleConnectionId ?? null;
  const maxBytes = deps.config.maxUploadBytes;
  if (remote.sizeBytes > maxBytes) throw fileTooLarge(maxBytes);
  const [file, contributors] = await Promise.all([
    adapter.download(remote, context),
    readContributors(adapter, remote, context, deps.log),
  ]);
  // A PowerPoint or a PDF as it is; any other file becomes a PDF.
  const bytes = await toDeckBytes(remote.fileName, file, deps.documentPdf);
  const sourceSha256 = sha256Hex(file);
  const same = await findDeckWithContent(deps, viewer, workspaceId, sourceSha256, {
    linkedOnly: true,
  });
  if (same) return { deck: await existingDeckDto(deps, viewer, same), created: false };
  const deck = await createDeckFromFile(
    deps,
    { ownerId: viewer.author.id, workspaceId },
    {
      fileName: remote.fileName,
      bytes,
      sourceSha256,
      source: source.kind,
      sourceUrl: source.url,
      sourceRef: remote.ref,
      contributors,
      changeToken: remote.changeToken,
      microsoftConnectionId,
      nextcloudConnectionId,
      googleConnectionId,
    },
  );
  return { deck, created: true };
}

/** Work and school drives have `b!…` ids; personal OneDrive ids are plain hex. */
const driveKind = (driveId: string) => (driveId.startsWith('b!') ? 'sharepoint' : 'onedrive');

/**
 * Link and picker imports one account may have in flight at once: each downloads up to
 * `maxUploadBytes` into memory. Separate from {@link deckUploadSlot}, so a slow source download
 * never blocks a plain upload (or the other way round).
 */
export const REMOTE_IMPORTS_IN_FLIGHT = 2;
/** All accounts together: bounds the memory of parallel downloads (up to 200 MB each). */
export const REMOTE_IMPORTS_IN_FLIGHT_TOTAL = 6;

/** Caps link and picker imports in flight, per account and in total (after {@link importLimit}). */
function remoteImportSlot() {
  const byUser = new Map<string, number>();
  let total = 0;
  return createMiddleware<ViewerEnv>(async (c, next) => {
    const userId = c.var.viewer.author.id;
    const running = byUser.get(userId) ?? 0;
    if (running >= REMOTE_IMPORTS_IN_FLIGHT || total >= REMOTE_IMPORTS_IN_FLIGHT_TOTAL) {
      c.header('Retry-After', '5');
      throw new ApiError(
        429,
        'rate_limited',
        running >= REMOTE_IMPORTS_IN_FLIGHT
          ? 'Deine anderen Präsentationen werden noch geladen. Bitte warte einen Moment.'
          : 'Gerade werden viele Präsentationen gleichzeitig geladen. Bitte versuch es gleich noch einmal.',
      );
    }
    byUser.set(userId, running + 1);
    total += 1;
    try {
      await next();
    } finally {
      total -= 1;
      const left = (byUser.get(userId) ?? 1) - 1;
      if (left > 0) byUser.set(userId, left);
      else byUser.delete(userId);
    }
  });
}

const unsupportedLink = () =>
  new ApiError(
    400,
    'unsupported_link',
    'Kein gültiger OneDrive-, SharePoint-, Nextcloud-, Google- oder Datei-Link.',
  );

export function decksRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const imports = importLimit(deps);
  const uploads = deckUploadSlot(deps);
  const downloads = remoteImportSlot();
  const maxBytes = deps.config.maxUploadBytes;
  // Every search reads and decrypts the text of all decks: typing pauses ask, a loop does not.
  const searches = fixedWindow({ limit: SEARCHES_PER_MINUTE, windowMs: 60_000, clock: deps.clock });

  return (
    new Hono<ViewerEnv>()
      /** `?workspaceId=` → that workspace (members only); without it: all my workspaces. */
      .get('/decks', viewer, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const access = await viewerAccess(deps.db, viewer);
        const workspaceId = c.req.query('workspaceId');
        if (workspaceId) await requireRole(deps.db, workspaceId, viewer.author.id);
        const workspaceIds = workspaceId ? [workspaceId] : [...access.roles.keys()];
        return c.json(await listWorkspaceDecks(deps, workspaceIds, access));
      })

      /**
       * Text search through slides and comments (BER-175), like `/decks` for `?workspaceId=`
       * or all my workspaces. Before `/decks/:deckId`, which would take `search` for an id.
       */
      .get('/decks/search', viewer, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const searched = searches.hit(viewer.author.id);
        if (!searched.allowed) {
          c.header('Retry-After', String(searched.retryAfterS));
          throw new ApiError(
            429,
            'rate_limited',
            'Zu viele Suchen auf einmal – gleich noch einmal.',
          );
        }
        const query = c.req.query('q') ?? '';
        if (query.trim().length < DECK_SEARCH_MIN_LENGTH || query.length > DECK_SEARCH_MAX_LENGTH) {
          throw badRequest(
            `Bitte zwischen ${DECK_SEARCH_MIN_LENGTH} und ${DECK_SEARCH_MAX_LENGTH} Zeichen suchen.`,
          );
        }
        const access = await viewerAccess(deps.db, viewer);
        const workspaceId = c.req.query('workspaceId');
        if (workspaceId) await requireRole(deps.db, workspaceId, viewer.author.id);
        const workspaceIds = workspaceId ? [workspaceId] : [...access.roles.keys()];
        return c.json<DeckSearchResult[]>(await searchDecks(deps, workspaceIds, access, query));
      })

      /**
       * `?workspaceId=` names the target before the body is read (the form field `workspaceId`
       * still works for old clients); without either, the first workspace I may create decks in.
       */
      .post(
        '/decks/upload',
        viewer,
        // Before a single byte is buffered: may this account create a deck there at all?
        createMiddleware<ViewerEnv>(async (c, next) => {
          requireOwner(c.var.viewer);
          const requested = c.req.query('workspaceId') || undefined;
          const workspaceId = await resolveUploadWorkspace(deps, c.var.viewer.author.id, requested);
          if (requested) await assertDeckSlot(deps.db, deps.config, workspaceId);
          await next();
        }),
        imports,
        uploads,
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
          if (file.size > maxBytes) throw fileTooLarge(maxBytes);
          if (file.size === 0) throw badRequest('Die Datei ist leer.');

          const field = body['workspaceId'];
          const workspaceId = await resolveUploadWorkspace(
            deps,
            viewer.author.id,
            c.req.query('workspaceId') || (typeof field === 'string' && field ? field : undefined),
          );
          // A PowerPoint or a PDF as it is; any other file becomes a PDF.
          const original = new Uint8Array(await file.arrayBuffer());
          const bytes = await toDeckBytes(file.name, original, deps.documentPdf);
          const sourceSha256 = sha256Hex(original);
          // The same file uploaded (or linked) before: open that review instead of a second one.
          const same = await findDeckWithContent(deps, viewer, workspaceId, sourceSha256, {
            linkedOnly: false,
          });
          if (same) return c.json(await existingDeckDto(deps, viewer, same), 200);
          await assertDeckSlot(deps.db, deps.config, workspaceId, { addBytes: bytes.byteLength });
          const deck = await createDeckFromFile(
            deps,
            { ownerId: viewer.author.id, workspaceId },
            {
              fileName: file.name,
              bytes,
              sourceSha256,
              source: 'upload',
            },
          );
          return c.json(deck, 201);
        },
      )

      .post('/decks/link', viewer, imports, downloads, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const { url, workspaceId: requested } = await readJson(c, linkBodySchema);
        const link = parseShareLink(url, { trustedNextcloud: deps.config.nextcloud.server });
        if (!link) {
          throw linkHasCredentials(url)
            ? new ApiError(400, 'unsupported_link', LINK_CREDENTIALS_MESSAGE)
            : unsupportedLink();
        }
        const workspaceId = await resolveUploadWorkspace(deps, viewer.author.id, requested);

        const adapter = deps.sources[link.kind];
        // Each of my Microsoft accounts in turn, until one may read the file. Nextcloud and
        // Google try my accounts (Google: then the public link) themselves.
        const resolved =
          link.kind === 'nextcloud' || link.kind === 'google'
            ? await (async () => {
                const context: SourceContext = { userId: viewer.author.id };
                const value = await adapter.resolve(link, context);
                return { value, context, connectionId: null };
              })()
            : await withConnections(deps.microsoft, viewer.author.id, (context) =>
                adapter.resolve(link, context),
              );
        const { deck, created } = await importRemote(
          deps,
          viewer,
          workspaceId,
          adapter,
          resolved.context,
          resolved.value,
          { kind: link.kind, url: link.url.href },
          resolved.connectionId,
        );
        return c.json(deck, created ? 201 : 200);
      })

      /** A file picked in Microsoft's OneDrive file picker. */
      .post('/decks/drive-item', viewer, imports, downloads, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const input = await readJson(c, importDriveItemInputSchema);
        const workspaceId = await resolveUploadWorkspace(deps, viewer.author.id, input.workspaceId);

        const kind = driveKind(input.driveId);
        const adapter = deps.sources[kind];
        if (!adapter.resolveItem) throw unsupportedLink();
        const resolveItem = adapter.resolveItem.bind(adapter);
        // The account the picker was opened with.
        const context = await pickerContext(deps, viewer.author.id, input.connectionId);
        const remote = await withPickerLogin(() =>
          resolveItem({ driveId: input.driveId, itemId: input.itemId }, context),
        );
        if (context.connectionId) await deps.microsoft.markUsed(context.connectionId);
        const { deck, created } = await importRemote(
          deps,
          viewer,
          workspaceId,
          adapter,
          context,
          remote,
          // Re-syncs go by `sourceRef`; the URL is for "open in PowerPoint".
          { kind, url: remote.webUrl },
          context.connectionId ?? null,
        );
        return c.json(deck, created ? 201 : 200);
      })

      /** A presentation picked in the Nextcloud browser (`routes/nextcloud`). */
      .post('/decks/nextcloud-item', viewer, imports, downloads, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const input = await readJson(c, importNextcloudItemInputSchema);
        const workspaceId = await resolveUploadWorkspace(deps, viewer.author.id, input.workspaceId);

        const adapter = deps.sources.nextcloud;
        const { server } = (await adapter.client(viewer.author.id, input.connectionId)).credentials;
        const context: SourceContext = {
          userId: viewer.author.id,
          nextcloudConnectionId: input.connectionId,
        };
        const remote = await adapter.resolveFile(server, input.fileId, context);
        const { deck, created } = await importRemote(
          deps,
          viewer,
          workspaceId,
          adapter,
          context,
          remote,
          // Syncs go by `sourceRef` (the file id); the URL opens the file in Nextcloud.
          { kind: 'nextcloud', url: remote.webUrl },
          null,
        );
        return c.json(deck, created ? 201 : 200);
      })

      /** A file picked in Google's picker (`routes/google`): Google Slides or a `.pptx`. */
      .post('/decks/google-item', viewer, imports, downloads, async (c) => {
        const { viewer } = c.var;
        requireOwner(viewer);
        const input = await readJson(c, importGoogleItemInputSchema);
        const workspaceId = await resolveUploadWorkspace(deps, viewer.author.id, input.workspaceId);

        const adapter = deps.sources.google;
        if (!(await deps.googleDrive.findConnection(viewer.author.id, input.connectionId))) {
          throw notFound('Dieses Google-Konto ist nicht verbunden.');
        }
        const context: SourceContext = {
          userId: viewer.author.id,
          googleConnectionId: input.connectionId,
        };
        const remote = await adapter.resolvePicked(input.fileId, context);
        const { deck, created } = await importRemote(
          deps,
          viewer,
          workspaceId,
          adapter,
          context,
          remote,
          // Syncs go by `sourceRef` (the file id); the URL opens the file in Google.
          { kind: 'google', url: remote.webUrl },
          null,
        );
        return c.json(deck, created ? 201 : 200);
      })

      .get('/decks/:deckId', viewer, async (c) => {
        const { viewer } = c.var;
        const { deck } = await deckAccess(deps, viewer, c.req.param('deckId'), 'view');
        await touchLastViewed(deps, deck);
        return c.json(
          await toDeckDto(deps.db, deck, { access: await viewerAccess(deps.db, viewer) }),
        );
      })

      .patch('/decks/:deckId', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'own');
        const input = await readJson(c, updateDeckInputSchema);
        // Only into a folder of the deck's own workspace.
        if (input.folderId) await findFolder(deps.db, deck.workspaceId, input.folderId);
        const now = deps.clock.now();
        const [updated] = await deps.db
          .update(decks)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.archived !== undefined
              ? { archivedAt: input.archived ? (deck.archivedAt ?? now) : null }
              : {}),
            ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
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
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'own');
        await deleteDeck(deps, deck.id);
        return c.body(null, 204);
      })

      /** "Zugriff einschränken" (`services/deck-access`): its managers and the admins only. */
      .get('/decks/:deckId/access', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'own');
        return c.json(await getDeckAccess(deps.db, deck));
      })

      .put('/decks/:deckId/access', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'own');
        const input = await readJson(c, updateDeckAccessInputSchema);
        return c.json(await updateDeckAccess(deps, deck, input));
      })

      .get('/decks/:deckId/people', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listDeckPeople(deps.db, deck));
      })

      .get('/decks/:deckId/slides', viewer, async (c) => {
        const deck = await requireDeckAccess(deps, c.var.viewer, c.req.param('deckId'), 'view');
        return c.json(await listSlides(deps.db, deck));
      })
  );
}
