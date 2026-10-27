import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { ODP_MIME, OdpDocument, OdpError, type OdpImage, type OdpSlide } from '@slider/odp';
import {
  imageCreditSchema,
  type ApplyEditInput,
  type DeckEditSource,
  type DeckEditState,
  type ImageCredit,
  type SlideOperation,
  type UploadedEditImage,
  type Viewer,
} from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import type { Executor } from '../db/client';
import {
  deckEdits,
  decks,
  revisions,
  slideVersions,
  slides,
  type DeckRow,
  type RevisionRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { imageSize } from '../import/any-file';
import { sha256Hex, toShape } from '../import/common';
import { ConversionAborted, fontSubstituteFor } from '../import/libreoffice';
import { isOdpKey, odpParsedSlide, odpPreviewSvg } from '../import/odp-deck';
import { storeSlideRender } from '../import/office-pages';
import { rasterizePdf } from '../import/pdf-pages';
import type { RemoteFile, SourceContext } from '../sources/source-adapter';
import { blobKeys } from '../storage/blob-storage';
import { mergeSyncState } from '../sync/state';
import { assertStorageFor } from './plans';
import { stockSource } from './stock-photos';
import { drawingFonts, workspaceFontsOf } from './workspace-fonts';
import { workspaceAiConnection } from './workspace-ai';

/*
 * Editing a deck in Slider (BER-180). The deck's current revision is the working copy: every
 * edit writes the whole file anew as a step of `deck_edits` (so undo and redo give back exactly
 * that file), points the revision at it and draws only the slides whose XML changed. Slides,
 * comments and boxes stay those of the revision – the history of versions is not filled with
 * every drag. Only ODP decks can be edited for now; LibreOffice draws them exactly.
 */

/** Editing waits for the deck's other edits: one at a time per deck. */
const locks = new Map<string, Promise<unknown>>();

async function withDeckLock<T>(deckId: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(deckId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  locks.set(deckId, run);
  try {
    return await run;
  } finally {
    if (locks.get(deckId) === run) locks.delete(deckId);
  }
}

/** Pictures for the editor: the formats LibreOffice and every browser show. */
const EDIT_IMAGE_TYPES: Record<string, { extension: string; mediaType: string }> = {
  png: { extension: 'png', mediaType: 'image/png' },
  jpg: { extension: 'jpg', mediaType: 'image/jpeg' },
  gif: { extension: 'gif', mediaType: 'image/gif' },
  webp: { extension: 'webp', mediaType: 'image/webp' },
};
export const MAX_EDIT_IMAGE_BYTES = 20 * 1024 ** 2;
const EDIT_IMAGE_ID = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

function imageKind(bytes: Uint8Array): keyof typeof EDIT_IMAGE_TYPES | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

const notEditable = (message: string) => new ApiError(409, 'bad_request', message);

interface EditTarget {
  deck: DeckRow;
  revision: RevisionRow;
}

/** Why the deck cannot be edited now, or `null`. */
function blocker(deps: AppDeps, deck: DeckRow, revision: RevisionRow | undefined): string | null {
  if (!revision || deck.importState.status !== 'ready' || revision.status !== 'ready') {
    return 'Die Präsentation wird gerade noch verarbeitet.';
  }
  if (!isOdpKey(revision.pptxKey)) {
    return 'Bearbeiten geht bisher nur bei ODP-Präsentationen (LibreOffice, Nextcloud Office).';
  }
  if (!deps.rendering?.renderers.libreOfficePdf?.pages) {
    return 'Auf diesem Server fehlt LibreOffice – ohne lassen sich Folien nicht neu zeichnen.';
  }
  return null;
}

async function currentRevision(db: Executor, deck: DeckRow): Promise<RevisionRow | undefined> {
  if (!deck.currentRevisionId) return undefined;
  const [revision] = await db
    .select()
    .from(revisions)
    .where(eq(revisions.id, deck.currentRevisionId));
  return revision;
}

async function editTarget(deps: AppDeps, viewer: Viewer, deckId: string): Promise<EditTarget> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'own');
  const revision = await currentRevision(deps.db, deck);
  const reason = blocker(deps, deck, revision);
  if (reason || !revision)
    throw notEditable(reason ?? 'Die Präsentation lässt sich nicht bearbeiten.');
  return { deck, revision };
}

async function readFile(deps: AppDeps, key: string | null): Promise<Uint8Array> {
  const bytes = key ? await deps.storage.get(key) : null;
  if (!bytes) throw new ApiError(500, 'internal', 'Die Datei der Präsentation fehlt.');
  return bytes;
}

async function openFile(bytes: Uint8Array): Promise<OdpDocument> {
  try {
    return await OdpDocument.open(bytes);
  } catch (error) {
    if (error instanceof OdpError)
      throw new ApiError(500, 'internal', 'Die Präsentation ist nicht lesbar.');
    throw error;
  }
}

/** The revision's slides in file order (`position` is the file's order, hidden ones included). */
async function slideIdsOf(db: Executor, revisionId: string): Promise<string[]> {
  const rows = await db
    .select({ slideId: slideVersions.slideId })
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, revisionId))
    .orderBy(asc(slideVersions.position));
  return rows.map((row) => row.slideId);
}

// ── State ────────────────────────────────────────────────────────────────

export async function getEditState(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<DeckEditState> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'own');
  const revision = await currentRevision(deps.db, deck);
  const reason = blocker(deps, deck, revision);
  const saveTarget = deck.source === 'nextcloud' && deck.sourceRef ? ('nextcloud' as const) : null;
  if (reason || !revision) {
    return {
      editable: false,
      reason,
      seq: 0,
      canUndo: false,
      canRedo: false,
      unsaved: false,
      saveTarget,
      changedInCloud: false,
      aiAvailable: false,
      stockPhotos: false,
      fonts: [],
      pageSize: { width: 28, height: 15.75 },
      slides: [],
    };
  }
  const [file, slideIds, [redo], ai, fonts] = await Promise.all([
    fileSlides(deps, revision.pptxKey),
    slideIdsOf(deps.db, revision.id),
    deps.db
      .select({ id: deckEdits.id })
      .from(deckEdits)
      .where(and(eq(deckEdits.revisionId, revision.id), eq(deckEdits.seq, revision.editSeq + 1))),
    workspaceAiConnection(deps, deck.workspaceId),
    workspaceFontsOf(deps, deck.workspaceId),
  ]);
  return {
    editable: true,
    reason: null,
    seq: revision.editSeq,
    canUndo: revision.editSeq > 0,
    canRedo: Boolean(redo),
    unsaved: revision.editSeq !== revision.savedSeq,
    saveTarget,
    changedInCloud: Boolean(deck.syncState.cloudChangedToken),
    aiAvailable: ai.connection !== null,
    stockPhotos: stockSource(deps) !== null,
    fonts,
    pageSize: file.pageSize,
    slides: file.slides.flatMap((slide) => {
      const slideId = slideIds[slide.index];
      return slideId
        ? [
            {
              slideId,
              index: slide.index,
              name: slide.name,
              hidden: slide.hidden,
              elements: slide.elements,
            },
          ]
        : [];
    }),
  };
}

// ── Pictures ─────────────────────────────────────────────────────────────

export async function uploadEditImage(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  bytes: Uint8Array,
): Promise<UploadedEditImage> {
  const { deck } = await editTarget(deps, viewer, deckId);
  if (bytes.byteLength > MAX_EDIT_IMAGE_BYTES) throw badRequest('Das Bild ist größer als 20 MB.');
  const { imageId, width, height } = await storeEditImage(deps, deck.id, bytes);
  return { imageId, width, height };
}

/** Keeps a picture for `replaceImage` – with a stock photo's credit, which goes into the file with it. */
export async function storeEditImage(
  deps: AppDeps,
  deckId: string,
  bytes: Uint8Array,
  credit?: ImageCredit,
): Promise<UploadedEditImage & { mediaType: string }> {
  const kind = imageKind(bytes);
  const size = kind ? imageSize(bytes) : null;
  if (!kind || !size) throw badRequest('Bitte ein Bild als PNG, JPEG, GIF oder WebP.');
  const imageId = `${crypto.randomUUID()}.${EDIT_IMAGE_TYPES[kind]!.extension}`;
  const files: [key: string, bytes: Uint8Array][] = [[blobKeys.editImage(deckId, imageId), bytes]];
  if (credit) {
    files.push([
      blobKeys.editImage(deckId, `${imageId}.credit.json`),
      new TextEncoder().encode(JSON.stringify(credit)),
    ]);
  }
  const addBytes = files.reduce((total, [, file]) => total + file.byteLength, 0);
  const [deck] = await deps.db
    .select({ workspaceId: decks.workspaceId })
    .from(decks)
    .where(eq(decks.id, deckId));
  if (!deck) throw badRequest('Diese Präsentation gibt es nicht mehr.');
  // The workspace's storage (BER-151) – early, before the files are stored; the binding check
  // runs again under the workspace lock, where the deck's files count them right away.
  await deps.db.transaction((tx) =>
    assertStorageFor(tx, deps.config, deck.workspaceId, addBytes, deps.clock.now()),
  );
  const stored: string[] = [];
  try {
    for (const [key, file] of files) {
      await deps.storage.put(key, file);
      stored.push(key);
    }
    await deps.db.transaction(async (tx) => {
      await assertStorageFor(tx, deps.config, deck.workspaceId, addBytes, deps.clock.now());
      // Counted among the deck's other files, as its next measurement finds them (a deck never
      // measured stays `null`: the backfill counts all its files), and kept in mind for removing
      // old pictures (`old-edit-images`).
      await tx
        .update(decks)
        .set({
          filesBytes: sql`jsonb_set(${decks.filesBytes}, '{other}', to_jsonb(coalesce((${decks.filesBytes}->>'other')::bigint, 0) + ${addBytes}::bigint))`,
          editImagesSince: sql`coalesce(${decks.editImagesSince}, ${deps.clock.now().toISOString()}::timestamptz)`,
        })
        .where(eq(decks.id, deckId));
    });
  } catch (error) {
    // Not counted – don't let them eat the storage.
    await Promise.all(stored.map((key) => deps.storage.delete(key).catch(() => undefined)));
    throw error;
  }
  return {
    imageId,
    width: size.width,
    height: size.height,
    mediaType: EDIT_IMAGE_TYPES[kind]!.mediaType,
  };
}

/** An edit picture of the deck with its credit, or `null` when it is gone. */
export async function loadEditImage(
  deps: AppDeps,
  deckId: string,
  imageId: string,
): Promise<OdpImage | null> {
  if (!EDIT_IMAGE_ID.test(imageId)) throw badRequest('Unbekanntes Bild.');
  const bytes = await deps.storage.get(blobKeys.editImage(deckId, imageId));
  const kind = bytes && imageKind(bytes);
  const size = bytes && imageSize(bytes);
  if (!bytes || !kind || !size) return null;
  const sidecar = await deps.storage.get(blobKeys.editImage(deckId, `${imageId}.credit.json`));
  const credit = sidecar
    ? imageCreditSchema.safeParse(JSON.parse(new TextDecoder().decode(sidecar))).data
    : undefined;
  return {
    bytes,
    mediaType: EDIT_IMAGE_TYPES[kind]!.mediaType,
    ...size,
    credit: credit ?? null,
  };
}

async function loadImages(
  deps: AppDeps,
  deckId: string,
  operations: readonly SlideOperation[],
): Promise<Map<string, OdpImage>> {
  const images = new Map<string, OdpImage>();
  for (const operation of operations) {
    if (operation.type !== 'replaceImage' || images.has(operation.imageId)) continue;
    const image = await loadEditImage(deps, deckId, operation.imageId);
    if (!image) throw badRequest('Das Bild ist nicht mehr da – bitte nochmal hochladen.');
    images.set(operation.imageId, image);
  }
  return images;
}

// ── Steps ────────────────────────────────────────────────────────────────

/**
 * Applies operations to a copy of the deck's file: the new file and its slides. Operations that
 * do not fit the deck are a 400 with the reason.
 */
export async function applyToFile(
  deps: AppDeps,
  deckId: string,
  bytes: Uint8Array,
  operations: readonly SlideOperation[],
): Promise<{ bytes: Uint8Array; slides: OdpSlide[]; document: OdpDocument }> {
  const images = await loadImages(deps, deckId, operations);
  const document = await openFile(bytes);
  try {
    document.apply(operations, images);
  } catch (error) {
    if (error instanceof OdpError) throw badRequest(error.message);
    throw error;
  }
  const next = await document.toBytes();
  return { bytes: next, slides: document.slides(), document };
}

/*
 * What a file's slides are, by its blob key – a key never names another file (`blobKeys.pptx`
 * is new for every step), so each file is read once while it is being edited, not on every
 * step and every look at the edit state.
 */

/** A file's slides as read (`getEditState`). */
interface FileSlides {
  pageSize: ReturnType<OdpDocument['pageSize']>;
  slides: OdpSlide[];
}

/** … and as steps are compared (`commitStep`): with the ids `ensureIds` gives it. */
interface StepSlides {
  /** Every page had its id written in the file. */
  hadPageIds: boolean;
  slides: OdpSlide[];
}

/** Files remembered, the most recent last. */
const FILE_CACHE_SIZE = 64;
const fileSlidesCache = new Map<string, FileSlides>();
const stepSlidesCache = new Map<string, StepSlides>();

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > FILE_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

/** The slides of a stored file as read. */
export async function fileSlides(deps: AppDeps, key: string | null): Promise<FileSlides> {
  const known = key === null ? undefined : fileSlidesCache.get(key);
  if (known) return known;
  const document = await openFile(await readFile(deps, key));
  const read = { pageSize: document.pageSize(), slides: document.slides() };
  if (key !== null) remember(fileSlidesCache, key, read);
  return read;
}

/** A file's slides as read, then as steps are compared – `ensureIds` writes ids into it. */
function describeSteps(document: OdpDocument): { read: FileSlides; steps: StepSlides } {
  const read = { pageSize: document.pageSize(), slides: document.slides() };
  const hadPageIds = document.pageIds().every(Boolean);
  document.ensureIds();
  return { read, steps: { hadPageIds, slides: document.slides() } };
}

interface DrawnSlide {
  imageKey: string;
  thumbnailKey: string;
}

/**
 * Draws some slides of a file (0-based file positions of visible slides) with LibreOffice,
 * stores their images under the revision and returns them by position.
 */
export async function drawSlides(
  deps: AppDeps,
  target: EditTarget,
  bytes: Uint8Array,
  slides: readonly OdpSlide[],
  indices: readonly number[],
  /** `bytes` already open, to be used for nothing else afterwards: spares opening it again. */
  opened?: OdpDocument,
  /**
   * Stored as JPEG for now (a tenth of WebP's time at full size); `quick` gets what
   * {@link sharpenLater} needs to replace them by their WebP once the step is committed.
   */
  quick?: QuickDrawing,
): Promise<Map<number, DrawnSlide>> {
  const drawn = new Map<number, DrawnSlide>();
  const visible = indices.filter((index) => !slides[index]?.hidden);
  if (visible.length === 0) return drawn;
  const toPdf = deps.rendering?.renderers.libreOfficePdf;
  if (!toPdf?.pages) throw notEditable('Auf diesem Server fehlt LibreOffice.');
  // LibreOffice's page range counts every slide, hidden ones too (it draws only the others).
  const pages = visible.map((index) => index + 1);
  let pdf: Uint8Array;
  try {
    // Only the pages drawn, as LibreOffice is to draw them – in the workspace's own fonts.
    const fonts = await drawingFonts(deps, target.deck.workspaceId);
    const document = opened ?? (await openFile(bytes));
    document.embedFonts(await fonts.faces(document.fontFamilies()));
    const deck = await document.toDrawingBytes(visible, fontSubstituteFor(fonts.families));
    pdf = await toPdf.pages(deck, pages, { prepared: true });
  } catch (error) {
    if (error instanceof ConversionAborted) throw error;
    deps.log.warn(`LibreOffice could not draw edited slides of deck ${target.deck.id}`, error);
    throw new ApiError(
      503,
      'internal',
      'Die Folie ließ sich gerade nicht zeichnen. Bitte versuch es gleich noch einmal.',
    );
  }
  let next = 0;
  await rasterizePdf(
    pdf,
    async (images) => {
      const index = visible[next++];
      if (index === undefined) return;
      const keys = {
        imageKey: blobKeys.slideRender(target.deck.id, target.revision.id, quick ? 'jpg' : 'webp'),
        thumbnailKey: blobKeys.slideRender(target.deck.id, target.revision.id, 'webp'),
      };
      await Promise.all([
        deps.storage.put(keys.imageKey, images.image),
        deps.storage.put(keys.thumbnailKey, images.thumbnail),
      ]);
      drawn.set(index, keys);
    },
    // Someone waits for it on screen: not after a running import.
    {
      expectedPages: visible.length,
      interactive: true,
      picture: quick ? 'quick' : 'slide',
    },
  );
  if (quick) {
    quick.pdf = pdf;
    quick.order = visible;
  }
  return drawn;
}

/** What {@link drawSlides} drew quick: its PDF and the slides of its pages, in order. */
interface QuickDrawing {
  pdf?: Uint8Array;
  order?: readonly number[];
}

/** A quick picture replaced by its WebP is deleted this much later – no viewer still loads it. */
const QUICK_PICTURE_GRACE_MS = 5 * 60_000;

/**
 * Replaces the JPEG pictures of a committed step by their WebP (drawn from the same PDF, after
 * what someone waits for): the same pixels at about half the bytes for everyone who looks at
 * the slide later. Viewers are told the slides changed, so they load the WebP; the JPEG goes a
 * while later, once nothing names it. Best effort: a picture that is not replaced stays JPEG.
 */
function sharpenLater(
  deps: AppDeps,
  target: EditTarget,
  quick: QuickDrawing,
  drawn: ReadonlyMap<number, DrawnSlide>,
): void {
  const { pdf, order } = quick;
  if (!pdf || !order || order.length === 0) return;
  const replaced: string[] = [];
  void (async () => {
    let next = 0;
    await rasterizePdf(
      pdf,
      async (images) => {
        const index = order[next++];
        const jpeg = index === undefined ? undefined : drawn.get(index)?.imageKey;
        if (!jpeg) return;
        const key = blobKeys.slideRender(target.deck.id, target.revision.id, 'webp');
        await deps.storage.put(key, images.image);
        const rows = await deps.db
          .update(slideVersions)
          .set({ imageKey: key })
          .where(eq(slideVersions.imageKey, jpeg))
          .returning({ id: slideVersions.id });
        if (rows.length > 0) replaced.push(jpeg);
        // Replaced meanwhile by a newer step: this one is not needed.
        else await deps.storage.delete(key).catch(() => {});
      },
      { expectedPages: order.length },
    );
    if (replaced.length === 0) return;
    deps.live?.slidesChanged(target.deck.id);
    setTimeout(() => {
      dropUnusedImages(deps, replaced).catch((error: unknown) =>
        deps.log.warn('Could not delete quick slide pictures', error),
      );
    }, QUICK_PICTURE_GRACE_MS).unref();
  })().catch((error: unknown) => {
    if (!(error instanceof ConversionAborted)) {
      deps.log.warn(`Could not sharpen the edited slides of deck ${target.deck.id}`, error);
    }
  });
}

/** Deletes blobs no row refers to any more; best effort. */
async function dropUnusedImages(deps: AppDeps, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const used = await deps.db
    .select({ imageKey: slideVersions.imageKey, thumbnailKey: slideVersions.thumbnailKey })
    .from(slideVersions)
    .where(
      or(
        inArray(slideVersions.imageKey, [...keys]),
        inArray(slideVersions.thumbnailKey, [...keys]),
      ),
    );
  const keep = new Set(used.flatMap((row) => [row.imageKey, row.thumbnailKey]));
  for (const key of keys) if (!keep.has(key)) await deps.storage.delete(key).catch(() => {});
}

type Step =
  | {
      kind: 'new';
      operations: readonly SlideOperation[];
      source: Exclude<DeckEditSource, 'original'>;
      authorId: string | null;
    }
  | { kind: 'move'; seq: number; fileKey: string };

/**
 * Makes `bytes` the revision's file: stores it (a new step) or points at a step's file (undo,
 * redo), draws the slides that differ from the current file and updates their versions.
 */
async function commitStep(
  deps: AppDeps,
  target: EditTarget,
  current: Uint8Array,
  bytes: Uint8Array,
  step: Step,
  /** `bytes` already open (the step just applied to it): not read again, then drawn from. */
  applied?: OdpDocument,
): Promise<void> {
  const { deck, revision } = target;
  const fileKey = step.kind === 'new' ? blobKeys.pptx(deck.id, revision.id, 'odp') : step.fileKey;
  const currentKey = revision.pptxKey;
  const previous =
    (currentKey === null ? undefined : stepSlidesCache.get(currentKey)) ??
    describeSteps(await openFile(current)).steps;
  // The new file: open already, or known from before (undo, redo), else read now.
  const knownNext = applied ? undefined : stepSlidesCache.get(fileKey);
  const knownRead = applied ? undefined : fileSlidesCache.get(fileKey);
  let next: OdpDocument | undefined = applied;
  let described: { read: FileSlides; steps: StepSlides };
  if (knownNext && knownRead) described = { read: knownRead, steps: knownNext };
  else {
    next ??= await openFile(bytes);
    described = describeSteps(next);
  }
  if (currentKey !== null) remember(stepSlidesCache, currentKey, previous);
  remember(stepSlidesCache, fileKey, described.steps);
  remember(fileSlidesCache, fileKey, described.read);
  // Slides that moved, came or went (the AI) have page ids written; other edits keep the order.
  // A file without them gets the ids it had when the AI started from it (`ensureIds` is the same
  // for the same file), so undoing and redoing the AI's step finds its slides too.
  const byPage = previous.hadPageIds || described.steps.hadPageIds;
  const before = previous.slides;
  const after = described.steps.slides;
  const beforeOf = new Map(before.map((slide) => [slide.pageId, slide.index]));
  /** For each slide of the new file, the one of the current file it is (`null`: new). */
  const source = after.map((slide) =>
    byPage
      ? (beforeOf.get(slide.pageId) ?? null)
      : slide.index < before.length
        ? slide.index
        : null,
  );
  const kept = new Set(source.filter((index): index is number => index !== null));
  const removed = before.filter((slide) => !kept.has(slide.index)).map((slide) => slide.index);
  const changed = after
    .filter((slide, index) => {
      const from = source[index];
      const old = from === null || from === undefined ? undefined : before[from];
      return !old || old.fingerprint !== slide.fingerprint || old.hidden !== slide.hidden;
    })
    .map((slide) => slide.index);
  const { pageSize } = described.read;
  // `next` is not needed any more: drawn from as it is.
  const quick: QuickDrawing = {};
  const drawn = await drawSlides(deps, target, bytes, after, changed, next, quick);
  // A new hidden slide is not drawn; its texts stand in, as on import.
  for (const index of changed) {
    const slide = after[index] as OdpSlide;
    if (drawn.has(index) || source[index] !== null) continue;
    drawn.set(
      index,
      await storeSlideRender(
        deps.storage,
        deck.id,
        revision.id,
        odpPreviewSvg(slide, pageSize),
        null,
      ),
    );
  }

  if (step.kind === 'new') await deps.storage.put(fileKey, bytes);

  const replacedImages: string[] = [];
  const droppedFiles: string[] = [];
  const seq = step.kind === 'new' ? revision.editSeq + 1 : step.seq;
  await deps.db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(revisions)
      .where(eq(revisions.id, revision.id))
      .for('update');
    if (!fresh || fresh.editSeq !== revision.editSeq || fresh.pptxKey !== revision.pptxKey) {
      throw new ApiError(
        409,
        'bad_request',
        'Die Präsentation wurde gerade geändert – bitte nochmal.',
      );
    }
    if (step.kind === 'new') {
      if (revision.editSeq === 0) {
        // The file as it came, so undo can go back to it.
        await tx
          .insert(deckEdits)
          .values({
            id: crypto.randomUUID(),
            deckId: deck.id,
            revisionId: revision.id,
            seq: 0,
            fileKey: revision.pptxKey as string,
            operations: [],
            source: 'original',
            authorId: null,
          })
          .onConflictDoNothing();
      }
      // A new step after an undo drops the steps that could have been redone.
      const dropped = await tx
        .delete(deckEdits)
        .where(and(eq(deckEdits.revisionId, revision.id), gt(deckEdits.seq, revision.editSeq)))
        .returning({ fileKey: deckEdits.fileKey });
      droppedFiles.push(...dropped.map((row) => row.fileKey));
      await tx.insert(deckEdits).values({
        id: crypto.randomUUID(),
        deckId: deck.id,
        revisionId: revision.id,
        seq,
        fileKey,
        operations: [...step.operations],
        source: step.source,
        authorId: step.authorId,
        // The server's clock, as the AI's proposals keep theirs (which step is whose).
        createdAt: deps.clock.now(),
      });
    }
    await tx
      .update(revisions)
      .set({ pptxKey: fileKey, editSeq: seq })
      .where(eq(revisions.id, revision.id));

    const versions = await tx
      .select()
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, revision.id))
      .orderBy(asc(slideVersions.position));
    // Slides that went lose their version in the revision; the slide and its comments stay.
    const gone = removed.flatMap((index) => (versions[index] ? [versions[index]] : []));
    for (const index of removed) {
      const version = versions[index];
      const pageId = before[index]?.pageId;
      if (!version || !pageId) continue;
      await tx
        .update(slides)
        .set({ pageId: `${revision.id}:${pageId}` })
        .where(eq(slides.id, version.slideId));
    }
    if (gone.length > 0) {
      await tx.delete(slideVersions).where(
        inArray(
          slideVersions.id,
          gone.map((version) => version.id),
        ),
      );
      for (const version of gone) replacedImages.push(version.imageKey, version.thumbnailKey);
    }
    const aspectRatio = versions[0]?.aspectRatio ?? pageSize.width / pageSize.height;
    for (const slide of after) {
      const from = source[slide.index];
      const version = from === null || from === undefined ? undefined : versions[from];
      const isChanged = changed.includes(slide.index);
      if (version && !isChanged && version.position === slide.index) continue;
      const parsed = odpParsedSlide(slide);
      const images = drawn.get(slide.index);
      const content = {
        position: slide.index,
        title: parsed.title,
        hidden: parsed.hidden,
        textHash: parsed.textHash,
        contentHash: parsed.contentHash,
        renderHash: slide.fingerprint,
        shapes: parsed.shapes.map(toShape),
      };
      if (version) {
        if (images) replacedImages.push(version.imageKey, version.thumbnailKey);
        await tx
          .update(slideVersions)
          .set(
            isChanged
              ? {
                  ...content,
                  ...(images
                    ? {
                        imageKey: images.imageKey,
                        thumbnailKey: images.thumbnailKey,
                        renderer: 'libreoffice' as const,
                      }
                    : {}),
                }
              : { position: slide.index },
          )
          .where(eq(slideVersions.id, version.id));
        continue;
      }
      // A page coming back (undo, redo) is the slide it was, comments and all; else a new slide.
      const pageKey = slide.pageId ? `${revision.id}:${slide.pageId}` : null;
      const [known] = pageKey
        ? await tx
            .select({ id: slides.id })
            .from(slides)
            .where(and(eq(slides.deckId, deck.id), eq(slides.pageId, pageKey)))
        : [];
      const slideId = known?.id ?? crypto.randomUUID();
      if (!known) await tx.insert(slides).values({ id: slideId, deckId: deck.id, pageId: pageKey });
      await tx.insert(slideVersions).values({
        id: crypto.randomUUID(),
        slideId,
        revisionId: revision.id,
        ...content,
        layoutName: parsed.layoutName,
        imageKey: images?.imageKey ?? blobKeys.slideRender(deck.id, revision.id, 'svg'),
        thumbnailKey: images?.thumbnailKey ?? blobKeys.slideRender(deck.id, revision.id, 'svg'),
        aspectRatio,
        renderer: images && slide.hidden ? null : 'libreoffice',
      });
    }
    await tx.update(decks).set({ updatedAt: deps.clock.now() }).where(eq(decks.id, deck.id));
  });

  deps.rendering?.progress.finish(deck.id, true, deps.clock.now());
  deps.live?.slidesChanged(deck.id);
  sharpenLater(deps, target, quick, drawn);
  await dropUnusedImages(deps, replacedImages);
  for (const key of droppedFiles) {
    if (key !== fileKey) await deps.storage.delete(key).catch(() => {});
  }
}

/**
 * Makes a new step from the deck's current file, under the deck's lock: `change` gets it and
 * returns the next file. `baseSeq` is the step the change was made on, if it matters. Returns
 * the new step.
 */
export async function editFile(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  step: {
    source: Exclude<DeckEditSource, 'original'>;
    operations: readonly SlideOperation[];
    baseSeq?: number;
  },
  /** The new file – with its document when it is open already (spares reading it again). */
  change: (
    current: Uint8Array,
    target: EditTarget,
  ) => Promise<Uint8Array | { bytes: Uint8Array; document: OdpDocument }>,
): Promise<number> {
  // Outsiders are turned away before they queue behind the deck's edits; checked again inside.
  await requireDeckAccess(deps, viewer, deckId, 'own');
  return withDeckLock(deckId, async () => {
    const target = await editTarget(deps, viewer, deckId);
    if (step.baseSeq !== undefined && step.baseSeq !== target.revision.editSeq) {
      throw new ApiError(
        409,
        'bad_request',
        'Die Präsentation wurde gerade geändert – deine Ansicht wird aktualisiert.',
      );
    }
    const current = await readFile(deps, target.revision.pptxKey);
    const changed = await change(current, target);
    const next = changed instanceof Uint8Array ? { bytes: changed, document: undefined } : changed;
    await commitStep(
      deps,
      target,
      current,
      next.bytes,
      {
        kind: 'new',
        operations: step.operations,
        source: step.source,
        authorId: viewer.author.id,
      },
      next.document,
    );
    return target.revision.editSeq + 1;
  });
}

/** Applies the editor's operations as a new step. */
export async function applyEdit(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: ApplyEditInput,
): Promise<DeckEditState> {
  await editFile(
    deps,
    viewer,
    deckId,
    { source: 'editor', operations: input.operations, baseSeq: input.baseSeq },
    async (current, target) => applyToFile(deps, target.deck.id, current, input.operations),
  );
  return getEditState(deps, viewer, deckId);
}

/** The step on top is not the one {@link moveEdit} was to undo. */
export class NotThatStep extends Error {}

/** Undo (`-1`) or redo (`+1`). */
export async function moveEdit(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  direction: -1 | 1,
  /** Undo only this step: checked under the lock – else {@link NotThatStep}. */
  only?: (top: typeof deckEdits.$inferSelect) => boolean,
): Promise<DeckEditState> {
  // Outsiders are turned away before they queue behind the deck's edits; checked again inside.
  await requireDeckAccess(deps, viewer, deckId, 'own');
  await withDeckLock(deckId, async () => {
    const target = await editTarget(deps, viewer, deckId);
    if (only) {
      const [top] = await deps.db
        .select()
        .from(deckEdits)
        .where(
          and(
            eq(deckEdits.revisionId, target.revision.id),
            eq(deckEdits.seq, target.revision.editSeq),
          ),
        );
      if (!top || !only(top)) throw new NotThatStep();
    }
    const seq = target.revision.editSeq + direction;
    const [step] =
      seq < 0
        ? []
        : await deps.db
            .select()
            .from(deckEdits)
            .where(and(eq(deckEdits.revisionId, target.revision.id), eq(deckEdits.seq, seq)));
    if (!step) {
      throw badRequest(
        direction < 0
          ? 'Es gibt nichts rückgängig zu machen.'
          : 'Es gibt nichts wiederherzustellen.',
      );
    }
    const current = await readFile(deps, target.revision.pptxKey);
    const bytes = await readFile(deps, step.fileKey);
    await commitStep(deps, target, current, bytes, { kind: 'move', seq, fileKey: step.fileKey });
  });
  return getEditState(deps, viewer, deckId);
}

/**
 * Saves the edited file over the deck's file in Nextcloud (BER-182), through the deck's (else
 * the owner's) account like its sync. A version saved in Nextcloud meanwhile is a 409
 * `edit_conflict` unless `overwrite` – Nextcloud keeps that version in its history either way.
 */
export async function saveEdit(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  { overwrite = false }: { overwrite?: boolean },
): Promise<DeckEditState> {
  // Outsiders are turned away before they queue behind the deck's edits; checked again inside.
  await requireDeckAccess(deps, viewer, deckId, 'own');
  await withDeckLock(deckId, async () => {
    const { deck, revision } = await editTarget(deps, viewer, deckId);
    if (deck.source !== 'nextcloud' || !deck.sourceRef) {
      throw badRequest('Diese Präsentation liegt in keiner Cloud – lade sie herunter.');
    }
    const bytes = await readFile(deps, revision.pptxKey);
    const context: SourceContext = {
      userId: deck.ownerId,
      nextcloudConnectionId: deck.nextcloudConnectionId,
    };
    const file: RemoteFile = {
      ref: deck.sourceRef,
      fileName: deck.fileName,
      sizeBytes: 0,
      changeToken: null,
    };
    const etag = await deps.sources.nextcloud.upload(
      file,
      bytes,
      ODP_MIME,
      overwrite ? null : revision.sourceChangeToken,
      context,
    );
    if (etag === null) {
      throw new ApiError(
        409,
        'edit_conflict',
        'Die Datei wurde in Nextcloud inzwischen geändert. Überschreiben? Nextcloud behält die andere Version in ihrem Verlauf.',
      );
    }
    await deps.db
      .update(revisions)
      .set({
        savedSeq: revision.editSeq,
        sourceChangeToken: etag || null,
        contentSha256: sha256Hex(bytes),
      })
      .where(eq(revisions.id, revision.id));
    await mergeSyncState(deps.db, deck.id, { cloudChangedToken: null });
    deps.live?.slidesChanged(deck.id);
  });
  return getEditState(deps, viewer, deckId);
}

/** The deck's file as it is now (download), with its name. */
export async function editedFile(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { deck, revision } = await editTarget(deps, viewer, deckId);
  const bytes = await readFile(deps, revision.pptxKey);
  const base = (deck.fileName ?? deck.title ?? 'Präsentation').replace(/\.[^./]+$/, '');
  return { bytes, fileName: `${base}.odp` };
}

export { editTarget, openFile, readFile, slideIdsOf, withDeckLock, type EditTarget };
