import { createHash } from 'node:crypto';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { OdpDocument, blankOdp, isOdpBytes, type OdpDesign } from '@slider/odp';
import { openPptx } from '@slider/pptx';
import {
  WORKSPACE_MASTER_MAX_SETS,
  layoutGuidesOf,
  layoutPlaceholders,
  type DeckLayouts,
  type DeckTemplate,
  type SlideOperation,
  type UpdateDeckTemplateInput,
  type Viewer,
  type WorkspaceMaster,
  type WorkspaceRole,
} from '@slider/shared';
import { requireDeckAccess, requireOwner } from '../auth/access';
import {
  decks,
  workspaceMasters,
  workspaces,
  type DeckRow,
  type WorkspaceMasterLayoutRow,
  type WorkspaceMasterRow,
} from '../db/schema';
import type { Executor } from '../db/client';
import { runLater } from '../background-work';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { ConversionAborted, deckFonts, fontSubstituteFor } from '../import/libreoffice';
import {
  odpLayoutDeck,
  odpLayoutName,
  odpLayoutPages,
  readMasterFile,
  type MasterFile,
} from '../import/master-deck';
import { openOdpDeck } from '../import/odp-deck';
import { PAGE_IMAGE_WIDTH, rasterizePdf } from '../import/pdf-pages';
import { svgThumbnail } from '../import/svg-thumbnail';
import { blobKeys, fileUrl } from '../storage/blob-storage';
import { deleteBlobs, storageBlobs } from './blob-deletions';
import { createDeckFromFile, deleteDeck, EMPTY_TEMPLATE } from './decks';
import { currentRevision } from './edits/target';
import { assertStorageFor } from './plans';
import { drawingFonts } from './workspace-fonts';
import { requireRole } from './workspaces/roles';

/*
 * A workspace's slide masters: anyone who may edit uploads a company design – a PowerPoint
 * template or presentation, or its OpenDocument twin – and Slider keeps the file and draws each
 * of its layouts, LibreOffice where it runs (in the workspace's own fonts), else as its own
 * preview. Everyone sees them; only admins remove them.
 */

const FILE_EXTENSIONS = ['otp', 'potx', 'odp', 'pptx'] as const;

/** A design's file ending, from its key: `design.otp`, or `design.odp` from before. */
const fileExtensionOf = (row: WorkspaceMasterRow): WorkspaceMaster['fileExtension'] =>
  FILE_EXTENSIONS.find((extension) => row.fileKey.endsWith(`.${extension}`)) ??
  (row.format === 'odp' ? 'otp' : 'potx');

export const toWorkspaceMaster = (row: WorkspaceMasterRow): WorkspaceMaster => ({
  id: row.id,
  name: row.name,
  format: row.format,
  sizeBytes: row.sizeBytes,
  aspectRatio: row.aspectRatio,
  fileUrl: fileUrl(row.fileKey),
  fileExtension: fileExtensionOf(row),
  draftDeckId: row.draftDeckId,
  layouts: row.layouts.map((layout) => ({
    name: layout.name,
    master: layout.master,
    imageUrl: fileUrl(layout.imageKey),
    thumbnailUrl: fileUrl(layout.thumbnailKey),
  })),
  createdAt: row.createdAt.toISOString(),
});

async function rowsOf(deps: Pick<AppDeps, 'db'>, workspaceId: string) {
  return deps.db
    .select()
    .from(workspaceMasters)
    .where(eq(workspaceMasters.workspaceId, workspaceId))
    .orderBy(desc(workspaceMasters.createdAt));
}

/** The workspace's slide masters, for its members. */
export async function listWorkspaceMasters(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMaster[]> {
  await requireRole(deps.db, workspaceId, userId);
  return (await rowsOf(deps, workspaceId)).map(toWorkspaceMaster);
}

/** Who may upload slide masters – checked before the upload is read. */
export async function requireMasterUploader(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole> {
  return requireRole(
    deps.db,
    workspaceId,
    userId,
    'member',
    'Vorlagen hochladen können Mitglieder und Admins.',
  );
}

/** The design's name: its file's, without the extension. */
const designName = (fileName: string) =>
  fileName
    .replace(/\.(potx|pptx|ppsx|potm|pptm|otp|odp)$/i, '')
    .trim()
    .slice(0, 200) || 'Vorlage';

interface DrawnLayouts {
  layouts: WorkspaceMasterLayoutRow[];
  /** Of each layout's thumbnail: layouts that look the same have the same. */
  looks: string[];
  bytes: number;
}

const lookOf = (thumbnail: Uint8Array | string) =>
  createHash('sha256').update(thumbnail).digest('hex').slice(0, 16);

/**
 * The layouts' pictures, stored at the keys `keyOf` makes (by extension): LibreOffice's PDF of
 * the deck with a slide per layout, in the workspace's fonts – or, without LibreOffice or when it
 * fails, Slider's own preview of each slide. `what` names them in the log. `lean`: a file Slider
 * keeps already (a deck's own layouts), drawn by the LibreOffices kept running from a lean copy,
 * its large picture a JPEG – what someone waits for with the panel open; a design uploaded just
 * now is drawn by a LibreOffice of its own, as every upload is.
 */
async function drawLayouts(
  deps: AppDeps,
  workspaceId: string,
  read: Pick<MasterFile, 'format' | 'deck' | 'layouts'>,
  keyOf: (extension: string) => string,
  what: string,
  { lean = false }: { lean?: boolean } = {},
): Promise<DrawnLayouts> {
  const put = async (key: string, bytes: Uint8Array) => {
    await deps.storage.put(key, bytes);
    stored.push(key);
    return bytes.byteLength;
  };
  const stored: string[] = [];
  let bytes = 0;
  const libreOfficePdf = deps.rendering?.renderers.libreOfficePdf;
  if (libreOfficePdf) {
    try {
      const fonts = await drawingFonts(deps, workspaceId);
      let pdf: Uint8Array;
      if (lean && libreOfficePdf.pages) {
        const document = await OdpDocument.open(read.deck);
        document.embedFonts(await fonts.faces(document.fontFamilies()));
        const all = document.slides().map((_, index) => index);
        const deck = await document.toDrawingBytes(all, fontSubstituteFor(fonts.families));
        pdf = await libreOfficePdf.pages(
          deck,
          all.map((index) => index + 1),
          { prepared: true },
        );
      } else {
        pdf = await libreOfficePdf(read.deck, {
          fonts: await fonts.faces(await deckFonts(read.deck)),
        });
      }
      const pages: { imageKey: string; thumbnailKey: string }[] = [];
      const looks: string[] = [];
      await rasterizePdf(
        pdf,
        async (images) => {
          const page = { imageKey: keyOf(lean ? 'jpg' : 'webp'), thumbnailKey: keyOf('webp') };
          bytes += await put(page.imageKey, images.image);
          bytes += await put(page.thumbnailKey, images.thumbnail);
          pages.push(page);
          looks.push(lookOf(images.thumbnail));
        },
        {
          expectedPages: read.layouts.length,
          interactive: true,
          ...(lean ? { picture: 'quick' as const } : {}),
        },
      );
      return {
        layouts: read.layouts.map((layout, index) => ({ ...layout, ...pages[index]! })),
        looks,
        bytes,
      };
    } catch (error) {
      await Promise.all(stored.map((key) => deps.storage.delete(key).catch(() => undefined)));
      stored.length = 0;
      bytes = 0;
      if (error instanceof ConversionAborted) throw error;
      deps.log.warn(`LibreOffice could not draw ${what}; using the preview`, error);
    }
  }
  const document =
    read.format === 'pptx' ? await openPptx(read.deck) : await openOdpDeck(read.deck);
  const layouts: WorkspaceMasterLayoutRow[] = [];
  const looks: string[] = [];
  try {
    for (const [index, slide] of document.presentation.slides.entries()) {
      const layout = read.layouts[index];
      if (!layout) break;
      const full = await svgThumbnail(await document.renderSlideSvg(slide), PAGE_IMAGE_WIDTH);
      const thumbnail = await svgThumbnail(full);
      const imageKey = keyOf('svg');
      const thumbnailKey = keyOf('svg');
      bytes += await put(imageKey, new TextEncoder().encode(full));
      bytes += await put(thumbnailKey, new TextEncoder().encode(thumbnail));
      layouts.push({ ...layout, imageKey, thumbnailKey });
      looks.push(lookOf(thumbnail));
    }
  } catch (error) {
    await Promise.all(stored.map((key) => deps.storage.delete(key).catch(() => undefined)));
    throw error;
  }
  return { layouts, looks, bytes };
}

/**
 * Members and admins. Takes one design, a template (`.otp`, `.potx`), reads its masters and
 * layouts, draws them and keeps it. Returns the workspace's slide masters now.
 */
export async function uploadWorkspaceMaster(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  upload: { name: string; bytes: Uint8Array },
): Promise<WorkspaceMaster[]> {
  await requireMasterUploader(deps, userId, workspaceId);
  const read = await readMasterFile(upload.bytes);
  const [existing] = await deps.db
    .select({ n: count() })
    .from(workspaceMasters)
    .where(eq(workspaceMasters.workspaceId, workspaceId));
  if ((existing?.n ?? 0) >= WORKSPACE_MASTER_MAX_SETS) {
    throw badRequest(`Ein Workspace kann höchstens ${WORKSPACE_MASTER_MAX_SETS} Vorlagen haben.`);
  }
  // Early, before anything is drawn; the binding check runs again with the pictures counted.
  await deps.db.transaction((tx) =>
    assertStorageFor(tx, deps.config, workspaceId, read.file.byteLength, deps.clock.now()),
  );

  const id = crypto.randomUUID();
  const fileKey = blobKeys.workspaceMasterFile(
    workspaceId,
    id,
    read.format === 'odp' ? 'otp' : 'potx',
  );
  await deps.storage.put(fileKey, read.file);
  let drawn: DrawnLayouts | null = null;
  try {
    drawn = await drawLayouts(
      deps,
      workspaceId,
      read,
      (extension) => blobKeys.workspaceMasterLayout(workspaceId, id, extension),
      `the slide masters ${id}`,
    );
    const sizeBytes = read.file.byteLength + drawn.bytes;
    const layouts = drawn.layouts;
    await deps.db.transaction(async (tx) => {
      await assertStorageFor(tx, deps.config, workspaceId, sizeBytes, deps.clock.now());
      await tx.insert(workspaceMasters).values({
        id,
        workspaceId,
        name: designName(upload.name),
        format: read.format,
        fileKey,
        sizeBytes,
        aspectRatio: read.aspectRatio,
        layouts,
        uploadedById: userId,
      });
    });
  } catch (error) {
    // Nothing references the files – don't let them eat the storage.
    const keys = [
      fileKey,
      ...(drawn?.layouts.flatMap((layout) => [layout.imageKey, layout.thumbnailKey]) ?? []),
    ];
    await Promise.all(keys.map((key) => deps.storage.delete(key).catch(() => undefined)));
    throw error;
  }
  return (await rowsOf(deps, workspaceId)).map(toWorkspaceMaster);
}

/** Members and admins, like uploading. Names a design anew; returns the slide masters now. */
export async function renameWorkspaceMaster(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  masterId: string,
  name: string,
): Promise<WorkspaceMaster[]> {
  await requireRole(
    deps.db,
    workspaceId,
    userId,
    'member',
    'Vorlagen umbenennen können Mitglieder und Admins.',
  );
  const [renamed] = await deps.db
    .update(workspaceMasters)
    .set({ name })
    .where(and(eq(workspaceMasters.workspaceId, workspaceId), eq(workspaceMasters.id, masterId)))
    .returning({ id: workspaceMasters.id, draftDeckId: workspaceMasters.draftDeckId });
  if (!renamed) throw notFound('Diese Vorlage gibt es nicht (mehr).');
  // Designed in Slider: its draft takes the name too, or the next save would bring the old back.
  if (renamed.draftDeckId) {
    await deps.db.update(decks).set({ title: name }).where(eq(decks.id, renamed.draftDeckId));
  }
  return (await rowsOf(deps, workspaceId)).map(toWorkspaceMaster);
}

/** Admins only. Removes a design with its file and pictures. */
export async function deleteWorkspaceMaster(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  masterId: string,
): Promise<WorkspaceMaster[]> {
  await requireRole(deps.db, workspaceId, userId, 'admin', 'Vorlagen entfernen können nur Admins.');
  const [gone] = await deps.db
    .delete(workspaceMasters)
    .where(and(eq(workspaceMasters.workspaceId, workspaceId), eq(workspaceMasters.id, masterId)))
    .returning();
  if (!gone) throw notFound('Diese Vorlage gibt es nicht (mehr).');
  // Designed in Slider: the deck it was designed in goes with it – no one could reach it.
  if (gone.draftDeckId) await deleteDeck(deps, gone.draftDeckId, eq(decks.isTemplate, true));
  await deleteBlobs(
    deps,
    storageBlobs([
      gone.fileKey,
      ...gone.layouts.flatMap((layout) => [layout.imageKey, layout.thumbnailKey]),
    ]),
  );
  return (await rowsOf(deps, workspaceId)).map(toWorkspaceMaster);
}

/** Tiny differences of page size (cm rounded in the file) still count as the same design. */
const SAME_ASPECT = 0.01;

/**
 * Members and admins, like uploading: a new deck's file made from an ODP design – one slide of
 * its first layout, its placeholders empty; the design's own slides stay out. A PowerPoint design
 * cannot be edited in Slider yet, so nothing is made from it.
 */
export async function deckFileFromMaster(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  masterId: string,
): Promise<Uint8Array> {
  await requireMasterUploader(deps, userId, workspaceId);
  const [row] = await deps.db
    .select()
    .from(workspaceMasters)
    .where(and(eq(workspaceMasters.workspaceId, workspaceId), eq(workspaceMasters.id, masterId)));
  if (!row) throw notFound('Diese Vorlage gibt es nicht (mehr).');
  if (row.format !== 'odp') {
    throw badRequest('Aus dieser Vorlage lässt sich noch keine Präsentation erstellen.');
  }
  const bytes = await deps.storage.get(row.fileKey);
  if (!bytes) throw notFound('Diese Vorlage gibt es nicht (mehr).');
  const document = await OdpDocument.open(bytes);
  // A design is kept as a template; the deck is a presentation (older designs already are).
  document.markAsPresentation();
  const [first] = odpLayoutPages(document);
  if (!first) throw badRequest('In dieser Vorlage ist kein Layout.');
  const own = document.slides().length;
  document.addSlide(0, { master: first.name });
  for (let i = 0; i < own; i += 1) document.removeSlide(1);
  return document.toBytes();
}

/**
 * On import: links an ODP deck to the workspace's design it is built on – one whose layouts are
 * all among the file's master pages, on the same page shape; of several, the one with the most
 * layouts. A deck already linked stays as it is.
 */
export async function linkDeckMaster(
  db: Executor,
  deck: Pick<DeckRow, 'id' | 'workspaceId' | 'masterId'>,
  bytes: Uint8Array,
): Promise<void> {
  if (deck.masterId || !isOdpBytes(bytes)) return;
  const rows = await db
    .select()
    .from(workspaceMasters)
    .where(
      and(eq(workspaceMasters.workspaceId, deck.workspaceId), eq(workspaceMasters.format, 'odp')),
    );
  if (rows.length === 0) return;
  const document = await OdpDocument.open(bytes);
  const names = new Set(document.masterPages().map(odpLayoutName));
  const size = document.pageSize();
  const [match] = rows
    .filter(
      (row) =>
        row.layouts.length > 0 &&
        Math.abs(row.aspectRatio - size.width / size.height) < SAME_ASPECT &&
        row.layouts.every((layout) => layout.name !== null && names.has(layout.name)),
    )
    .sort((a, b) => b.layouts.length - a.layouts.length);
  if (!match) return;
  await db
    .update(decks)
    .set({ masterId: match.id })
    .where(and(eq(decks.id, deck.id), isNull(decks.masterId)));
}

/**
 * The workspace's templates `operations` take a layout from (`addSlide` with a `design`), open
 * for `apply`. One gone, or a PowerPoint one, is left out: its operation then does not fit.
 */
export async function loadDesigns(
  deps: Pick<AppDeps, 'db' | 'storage'>,
  workspaceId: string,
  operations: readonly SlideOperation[],
): Promise<Map<string, OdpDesign>> {
  const ids = [
    ...new Set(
      operations.flatMap((operation) =>
        operation.type === 'addSlide' && operation.design ? [operation.design.id] : [],
      ),
    ),
  ];
  const designs = new Map<string, OdpDesign>();
  if (ids.length === 0) return designs;
  const rows = await deps.db
    .select()
    .from(workspaceMasters)
    .where(and(eq(workspaceMasters.workspaceId, workspaceId), inArray(workspaceMasters.id, ids)));
  for (const row of rows) {
    if (row.format !== 'odp') continue;
    const bytes = await deps.storage.get(row.fileKey);
    if (bytes) designs.set(row.id, await (await OdpDocument.open(bytes)).design());
  }
  return designs;
}

/**
 * What lists the pictures of a deck's layouts under their prefix – named anew when they are
 * drawn otherwise, so those drawn before are drawn again.
 */
const LAYOUT_LIST = 'layouts-2.json';

/** Pictures of a deck's layouts being drawn, by their list: two asking at once wait for one. */
const drawingDeckLayouts = new Map<string, Promise<LayoutPictures>>();

/** `look`: of the thumbnail – layouts that look the same are offered once. */
type LayoutPictures = { imageKey: string; thumbnailKey: string; look?: string }[];

/**
 * The layouts of a deck's own design – the master pages in its file, whether or not it came from
 * one of the workspace's templates – for its editor's „Folie einfügen“, each with a picture. They
 * are drawn the first time they are asked for and kept with the deck, once per design of its
 * file (`designFingerprint`): edits of its slides draw nothing again, a layout taken in from a
 * template does. A deck that is no ODP has none.
 */
export async function getDeckLayouts(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<DeckLayouts> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'own');
  const revision = await currentRevision(deps.db, deck);
  const bytes = revision?.pptxKey ? await deps.storage.get(revision.pptxKey) : null;
  if (!bytes || !isOdpBytes(bytes)) return { aspectRatio: 16 / 9, layouts: [] };
  const document = await OdpDocument.open(bytes);
  const size = document.pageSize();
  const aspectRatio = size.width / size.height;
  const pages = odpLayoutPages(document);
  if (pages.length === 0) return { aspectRatio, layouts: [] };

  const pictures = await deckLayoutPictures(deps, deck, document);
  const seen = new Set<string>();
  return {
    aspectRatio,
    layouts: pages.flatMap((page, index) => {
      const picture = pictures[index];
      // A PowerPoint design often has a layout more than once (LibreOffice takes each in).
      if (picture?.look && seen.has(picture.look)) return [];
      if (picture?.look) seen.add(picture.look);
      return picture
        ? [
            {
              name: odpLayoutName(page),
              page: page.name,
              imageUrl: fileUrl(picture.imageKey),
              thumbnailUrl: fileUrl(picture.thumbnailKey),
            },
          ]
        : [];
    }),
  };
}

/**
 * The pictures of a deck's layouts, kept with the deck under its design's prefix, drawn first if
 * need be.
 */
async function deckLayoutPictures(
  deps: AppDeps,
  deck: Pick<DeckRow, 'id' | 'workspaceId'>,
  document: OdpDocument,
): Promise<LayoutPictures> {
  const prefix = blobKeys.deckLayoutsPrefix(deck.id, document.designFingerprint());
  const list = `${prefix}${LAYOUT_LIST}`;
  const kept = await keptLayoutPictures(deps, list, odpLayoutPages(document).length);
  if (kept) return kept;
  let drawing = drawingDeckLayouts.get(list);
  if (!drawing) {
    drawing = drawDeckLayouts(deps, deck.workspaceId, document, prefix, list).finally(() =>
      drawingDeckLayouts.delete(list),
    );
    drawingDeckLayouts.set(list, drawing);
  }
  return drawing;
}

/** The pictures listed in `list` drawn before, when there are all `count` of them. */
async function keptLayoutPictures(
  deps: Pick<AppDeps, 'storage'>,
  list: string,
  count: number,
): Promise<LayoutPictures | null> {
  const listed = await deps.storage.get(list);
  if (!listed) return null;
  try {
    const pictures = JSON.parse(new TextDecoder().decode(listed)) as LayoutPictures;
    return Array.isArray(pictures) && pictures.length === count ? pictures : null;
  } catch {
    return null;
  }
}

async function drawDeckLayouts(
  deps: AppDeps,
  workspaceId: string,
  document: OdpDocument,
  prefix: string,
  list: string,
): Promise<LayoutPictures> {
  const { layouts, looks } = await drawLayouts(
    deps,
    workspaceId,
    {
      format: 'odp',
      deck: await odpLayoutDeck(document),
      layouts: odpLayoutPages(document).map((page) => ({
        master: null,
        name: odpLayoutName(page),
      })),
    },
    (extension) => `${prefix}${crypto.randomUUID()}.${extension}`,
    `the layouts under ${prefix}`,
    { lean: true },
  );
  const pictures = layouts.map(({ imageKey, thumbnailKey }, index) => ({
    imageKey,
    thumbnailKey,
    look: looks[index],
  }));
  await deps.storage.put(list, new TextEncoder().encode(JSON.stringify(pictures)));
  return pictures;
}

// ── Templates designed in Slider ───────────────────────────────────────────

/** What a template is called that has no name and no workspace name to go by. */
const NEW_TEMPLATE_TITLE = 'Vorlage';

/**
 * What a template just started is called, until someone names it: after its workspace –
 * „Acme Vorlage“, then „Acme Vorlage 2“, „Acme Vorlage 3“ … while the library has that name already.
 */
async function newTemplateTitle(deps: AppDeps, workspaceId: string): Promise<string> {
  const [[workspace], masters] = await Promise.all([
    deps.db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId)),
    deps.db
      .select({ name: workspaceMasters.name })
      .from(workspaceMasters)
      .where(eq(workspaceMasters.workspaceId, workspaceId)),
  ]);
  const name = workspace?.name.trim().slice(0, 90);
  const base = name ? `${name} ${NEW_TEMPLATE_TITLE}` : NEW_TEMPLATE_TITLE;
  const taken = new Set(masters.map((master) => master.name.trim().toLowerCase()));
  let title = base;
  for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${base} ${n}`;
  return title;
}

/**
 * Members and admins, like uploading: a template to design in the editor – a deck marked as one
 * (`decks.is_template`), one empty slide, its first layout. No review: it takes no deck slot.
 */
export async function createTemplateDraft(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
): Promise<DeckRow> {
  await requireMasterUploader(deps, userId, workspaceId);
  // Saved to the library as it is made: a full library takes no new one.
  const [{ n } = { n: 0 }] = await deps.db
    .select({ n: count() })
    .from(workspaceMasters)
    .where(eq(workspaceMasters.workspaceId, workspaceId));
  if (n >= WORKSPACE_MASTER_MAX_SETS) {
    throw badRequest(`Ein Workspace kann höchstens ${WORKSPACE_MASTER_MAX_SETS} Vorlagen haben.`);
  }
  const title = await newTemplateTitle(deps, workspaceId);
  const deck = await createDeckFromFile(
    deps,
    { ownerId: userId, workspaceId },
    {
      fileName: `${title.replace(/[\\/]/g, '-')}.odp`,
      bytes: await blankOdp(deps.clock.now()),
      source: 'upload',
      template: { title },
    },
  );
  // In the library from the start; one that could not be saved yet is on its next change.
  await queueTemplateSave(deps, deck.id, userId).catch((error: unknown) =>
    deps.log.warn(`Could not save the template ${deck.id} to the library`, error),
  );
  const [row] = await deps.db.select().from(decks).where(eq(decks.id, deck.id));
  if (!row) throw notFound('Die Vorlage gibt es nicht (mehr).');
  return row;
}

/** A template being designed that `viewer` may edit, or a `400` for a review. */
async function requireTemplateDeck(deps: AppDeps, viewer: Viewer, deckId: string) {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'own');
  if (!deck.isTemplate) throw badRequest('Das ist keine Vorlage.');
  return deck;
}

/** Changes what the file of a template being designed cannot say: names, placeholders, guides. */
export async function updateDeckTemplate(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: UpdateDeckTemplateInput,
): Promise<DeckRow> {
  const deck = await requireTemplateDeck(deps, viewer, deckId);
  // Read again under a lock: a save to the library writes the same column meanwhile.
  const updated = await deps.db.transaction(async (tx) => {
    const [current] = await tx.select().from(decks).where(eq(decks.id, deck.id)).for('update');
    const design: DeckTemplate = {
      ...(current?.templateDesign ?? deck.templateDesign ?? EMPTY_TEMPLATE),
      ...input,
    };
    const [row] = await tx
      .update(decks)
      .set({ templateDesign: design, updatedAt: deps.clock.now() })
      .where(eq(decks.id, deck.id))
      .returning();
    return row ?? deck;
  });
  scheduleTemplateSave(deps, deck.id);
  return updated;
}

/** Saves of one template running, one after the other: two at once would add it twice. */
const savingTemplates = new Map<string, Promise<unknown>>();

/**
 * Saves a template being designed to the workspace's library: its slides become the layouts of
 * a template file (`OdpDocument.toTemplate`), drawn like an uploaded one. Saved before, the
 * template there is replaced – decks made from it keep their own copy of the layouts; one gone
 * meanwhile is made anew. Returns the template as now in the library.
 */
export async function saveTemplateToLibrary(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<WorkspaceMaster> {
  requireOwner(viewer);
  const deck = await requireTemplateDeck(deps, viewer, deckId);
  await requireMasterUploader(deps, viewer.author.id, deck.workspaceId);
  return queueTemplateSave(deps, deck.id, viewer.author.id);
}

/** {@link saveTemplateNow} after the saves of the template already running. */
function queueTemplateSave(
  deps: AppDeps,
  deckId: string,
  userId: string,
): Promise<WorkspaceMaster> {
  const before = savingTemplates.get(deckId) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(() => saveTemplateNow(deps, deckId, userId));
  const settled = run.catch(() => undefined);
  savingTemplates.set(deckId, settled);
  void settled.then(() => {
    if (savingTemplates.get(deckId) === settled) savingTemplates.delete(deckId);
  });
  return run;
}

/** How long a template rests after a change before it is saved to the library again. */
const TEMPLATE_SAVE_DELAY_MS = 2000;
/** The latest change to each template waiting to be saved: an earlier one's turn passes. */
const templateSaveDue = new Map<string, symbol>();

/**
 * A template being designed is saved to the library by itself, as a presentation is: a while
 * after its last change – its slides, names, placeholders, guides or title – in its owner's name.
 * Anything else is let be; a failure is logged and the next change tries again.
 */
export function scheduleTemplateSave(deps: AppDeps, deckId: string): void {
  const turn = Symbol(deckId);
  templateSaveDue.set(deckId, turn);
  runLater(deps, TEMPLATE_SAVE_DELAY_MS, async () => {
    if (templateSaveDue.get(deckId) !== turn) return;
    templateSaveDue.delete(deckId);
    try {
      const [deck] = await deps.db.select().from(decks).where(eq(decks.id, deckId));
      if (!deck?.isTemplate) return;
      await requireMasterUploader(deps, deck.ownerId, deck.workspaceId);
      await queueTemplateSave(deps, deck.id, deck.ownerId);
    } catch (error) {
      deps.log.warn(`Could not save the template ${deckId} to the library`, error);
    }
  });
}

/**
 * A template deck's file as the template (`.otp`) it designs: each slide a layout, named and
 * marked as in the editor – what the library keeps and „Exportieren“ hands out.
 */
export async function templateFile(
  bytes: Uint8Array,
  design: DeckTemplate = EMPTY_TEMPLATE,
): Promise<Uint8Array> {
  const document = await OdpDocument.open(bytes);
  document.ensureIds();
  const slides = document.slides();
  const layouts = document.pageIds().map((pageId, index) => ({
    pageId,
    name: design.layoutNames[pageId]?.trim() || `Layout ${index + 1}`,
    // Every text box a text placeholder asking for what was typed in it (save locked ones).
    placeholders: layoutPlaceholders(
      slides.find((slide) => slide.pageId === pageId)?.elements ?? [],
      design.placeholders,
    ),
    guides: layoutGuidesOf(design, pageId),
  }));
  document.toTemplate(layouts);
  // Pictures only the slides showed (a picture frame become a placeholder) stay out of it.
  return document.toBytes({ prune: 'pictures' });
}

/** Saves a template as it is now, uploaded by `userId` – who may (checked before). */
async function saveTemplateNow(
  deps: AppDeps,
  deckId: string,
  userId: string,
): Promise<WorkspaceMaster> {
  const [deck] = await deps.db.select().from(decks).where(eq(decks.id, deckId));
  if (!deck?.isTemplate) throw notFound('Die Vorlage gibt es nicht (mehr).');
  const design = deck.templateDesign ?? EMPTY_TEMPLATE;
  const revision = await currentRevision(deps.db, deck);
  const bytes = revision?.pptxKey ? await deps.storage.get(revision.pptxKey) : null;
  if (!bytes || !isOdpBytes(bytes)) throw badRequest('Die Vorlage ist noch nicht bereit.');
  const read = await readMasterFile(await templateFile(bytes, design));

  const [existing] = design.masterId
    ? await deps.db
        .select()
        .from(workspaceMasters)
        .where(
          and(
            eq(workspaceMasters.workspaceId, deck.workspaceId),
            eq(workspaceMasters.id, design.masterId),
          ),
        )
    : [];
  if (!existing) {
    const [{ n } = { n: 0 }] = await deps.db
      .select({ n: count() })
      .from(workspaceMasters)
      .where(eq(workspaceMasters.workspaceId, deck.workspaceId));
    if (n >= WORKSPACE_MASTER_MAX_SETS) {
      throw badRequest(`Ein Workspace kann höchstens ${WORKSPACE_MASTER_MAX_SETS} Vorlagen haben.`);
    }
  }
  const id = existing?.id ?? crypto.randomUUID();
  // A new key each time: a template saved again is never served from a cache as it was.
  const fileKey = blobKeys
    .workspaceMasterFile(deck.workspaceId, id, 'otp')
    .replace(/\.otp$/, `-${Date.now().toString(36)}.otp`);
  // The template it replaces frees its share (checked exactly once its pictures are drawn).
  await deps.db.transaction((tx) =>
    assertStorageFor(
      tx,
      deps.config,
      deck.workspaceId,
      read.file.byteLength - (existing?.sizeBytes ?? 0),
      deps.clock.now(),
    ),
  );
  await deps.storage.put(fileKey, read.file);
  let drawn: DrawnLayouts | null = null;
  try {
    drawn = await drawLayouts(
      deps,
      deck.workspaceId,
      read,
      (extension) => blobKeys.workspaceMasterLayout(deck.workspaceId, id, extension),
      `the template ${id} designed in deck ${deck.id}`,
    );
    const values = {
      name: deck.title.trim() || NEW_TEMPLATE_TITLE,
      format: read.format,
      fileKey,
      sizeBytes: read.file.byteLength + drawn.bytes,
      aspectRatio: read.aspectRatio,
      layouts: drawn.layouts,
      draftDeckId: deck.id,
      colors: design.colors ?? [],
    };
    const now = deps.clock.now();
    await deps.db.transaction(async (tx) => {
      await assertStorageFor(
        tx,
        deps.config,
        deck.workspaceId,
        values.sizeBytes - (existing?.sizeBytes ?? 0),
        now,
      );
      if (existing) {
        const updated = await tx
          .update(workspaceMasters)
          .set(values)
          .where(eq(workspaceMasters.id, id))
          .returning({ id: workspaceMasters.id });
        // Removed from the library meanwhile (its draft with it): the new blobs go again.
        if (updated.length === 0) throw notFound('Diese Vorlage gibt es nicht (mehr).');
      } else {
        await tx
          .insert(workspaceMasters)
          .values({ id, workspaceId: deck.workspaceId, uploadedById: userId, ...values });
      }
      // Names or guides changed while it was drawn stay: only where it is saved is set here.
      const [current] = await tx.select().from(decks).where(eq(decks.id, deck.id)).for('update');
      if (!current) throw notFound('Die Vorlage gibt es nicht (mehr).');
      await tx
        .update(decks)
        .set({
          templateDesign: {
            ...(current.templateDesign ?? design),
            masterId: id,
            savedAt: now.toISOString(),
          },
        })
        .where(eq(decks.id, deck.id));
    });
  } catch (error) {
    const keys = [
      fileKey,
      ...(drawn?.layouts.flatMap((layout) => [layout.imageKey, layout.thumbnailKey]) ?? []),
    ];
    await Promise.all(keys.map((key) => deps.storage.delete(key).catch(() => undefined)));
    throw error;
  }
  if (existing) {
    // The file and pictures it had before.
    await deleteBlobs(
      deps,
      storageBlobs([
        existing.fileKey,
        ...existing.layouts.flatMap((layout) => [layout.imageKey, layout.thumbnailKey]),
      ]),
    );
  }
  const [row] = await deps.db.select().from(workspaceMasters).where(eq(workspaceMasters.id, id));
  if (!row) throw notFound('Diese Vorlage gibt es nicht (mehr).');
  return toWorkspaceMaster(row);
}
