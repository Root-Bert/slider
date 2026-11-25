import { createCanvas, loadImage } from '@napi-rs/canvas';
import { and, eq } from 'drizzle-orm';
import { CLOUD_INLINE_IMAGES, cloudExtension } from '@slider/shared';
import { runInBackground } from '../../background-work';
import {
  cloudNodes,
  cloudVersions,
  workspaceFonts,
  type CloudNodeRow,
  type CloudVersionRow,
} from '../../db/schema';
import { imageSize } from '../../import/any-file';
import {
  DOCUMENT_IMPORT_FILTERS,
  MATERIAL_PDF_FILTERS,
  deckFonts,
  type MaterialPdfKind,
  type OfficeDocumentKind,
} from '../../import/libreoffice';
import type { PoolPriority } from '../../import/office-pool';
import { runPdfTask } from '../../import/pdf-jobs';
import { blobKeys } from '../../storage/blob-storage';
import { drawingFonts } from '../workspace-fonts';
import type { CloudDeps } from './context';

/**
 * What a file looks like without loading it: a small picture for its tile (pictures, PDFs and –
 * with LibreOffice – office files), and an office file drawn as a PDF to read it in the browser.
 * Both are made once per version, after the upload or when first asked for, and kept beside it.
 */

const THUMBNAIL_WIDTH = 480;
/** Larger files get no small picture: they would have to be held whole to draw one. */
const MAX_IMAGE_BYTES = 48 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 96 * 1024 * 1024;
/** A picture claiming more pixels than this is not decoded (a small file can unpack to GBs). */
const MAX_PIXELS = 120_000_000;

async function imageThumbnail(bytes: Uint8Array): Promise<Uint8Array | null> {
  const size = imageSize(bytes);
  if (size && size.width * size.height > MAX_PIXELS) return null;
  try {
    const image = await loadImage(Buffer.from(bytes));
    if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) return null;
    const scale = Math.min(1, THUMBNAIL_WIDTH / image.width);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return new Uint8Array(await canvas.encode('jpeg', 85));
  } catch {
    return null;
  }
}

/** Whether this server can draw the file as a PDF: LibreOffice is there and reads its format. */
export function officePreviewable(deps: CloudDeps, name: string): boolean {
  const extension = cloudExtension(name);
  return (
    (Boolean(deps.materialPdf) && extension in MATERIAL_PDF_FILTERS) ||
    (Boolean(deps.documentPdf) && extension in DOCUMENT_IMPORT_FILTERS)
  );
}

/**
 * Presentation files drawn as their presentation is (`renderSlidePages`): with LibreOffice's
 * replacement table and the workspace's fonts – so one opened from Cloud keeps the look of its
 * pictures here (`openingPages`) when LibreOffice's pictures of the deck come.
 */
const DECK_KINDS: ReadonlySet<string> = new Set(['pptx', 'pptm', 'ppsx', 'odp']);

/**
 * What a presentation file's PDF was drawn with (kept in its marker, `cloudPreviewAsDeck`): the
 * families it names and the workspace's faces of them – one of those added or deleted later, it
 * is drawn anew ({@link redrawOld}).
 */
interface DrawnWith {
  names: string[];
  faces: string;
}

/** The workspace's fonts as {@link DrawnWith} counts them. */
const fontRowsOf = (deps: CloudDeps, workspaceId: string) =>
  deps.db
    .select({ id: workspaceFonts.id, family: workspaceFonts.family })
    .from(workspaceFonts)
    .where(eq(workspaceFonts.workspaceId, workspaceId));
type FontRows = Awaited<ReturnType<typeof fontRowsOf>>;

function facesNamed(rows: FontRows, names: readonly string[]): string {
  const wanted = new Set(names);
  return rows
    .filter((row) => wanted.has(row.family.toLowerCase()))
    .map((row) => row.id)
    .sort()
    .join(',');
}

async function toPdf(
  deps: CloudDeps,
  node: CloudNodeRow,
  bytes: Uint8Array,
  priority?: PoolPriority,
): Promise<{ pdf: Uint8Array; drawnWith?: DrawnWith } | null> {
  const extension = cloudExtension(node.name);
  if (deps.materialPdf && extension in MATERIAL_PDF_FILTERS) {
    if (!DECK_KINDS.has(extension)) {
      return { pdf: await deps.materialPdf(bytes, extension as MaterialPdfKind) };
    }
    const names = (await deckFonts(bytes)).map((name) => name.toLowerCase());
    const drawnWith = { names, faces: facesNamed(await fontRowsOf(deps, node.workspaceId), names) };
    const fonts = await (await drawingFonts(deps, node.workspaceId)).faces(names);
    return {
      pdf: await deps.materialPdf(bytes, extension as MaterialPdfKind, { fonts, priority }),
      drawnWith,
    };
  }
  if (deps.documentPdf && extension in DOCUMENT_IMPORT_FILTERS) {
    return { pdf: await deps.documentPdf(bytes, extension as OfficeDocumentKind, priority) };
  }
  return null;
}

/**
 * Whether the version is still kept: one gone meanwhile (a Writer document saved again replaces
 * its last version) gets nothing written beside it – nothing would delete that.
 */
async function stillKept(deps: CloudDeps, versionId: string): Promise<boolean> {
  const [kept] = await deps.db
    .select({ id: cloudVersions.id })
    .from(cloudVersions)
    .where(eq(cloudVersions.id, versionId));
  return Boolean(kept);
}

/** One conversion per version at a time: a second asker waits for the first one's result. */
const converting = new Map<string, Promise<string | null>>();

/**
 * The key of the version drawn as a PDF, made now if it is not there yet; `null` when it
 * cannot be (no LibreOffice, a format it does not read, a broken file – remembered as failed).
 * `background`: nobody waits for it.
 */
export async function previewPdfKey(
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
  priority: PoolPriority = 'interactive',
): Promise<string | null> {
  const key = blobKeys.cloudPreview(node.workspaceId, node.id, version.id);
  if (version.preview === 'ready') return key;
  if (version.preview === 'failed' || !officePreviewable(deps, node.name)) return null;
  if (version.sizeBytes > MAX_DOCUMENT_BYTES) return null;
  const running = converting.get(version.id);
  if (running) return running;
  const work = (async () => {
    let state: 'ready' | 'failed' = 'failed';
    try {
      const bytes = await deps.storage.get(version.storageKey);
      const drawn = bytes ? await toPdf(deps, node, bytes, priority) : null;
      if (drawn && !(await stillKept(deps, version.id))) return null;
      if (drawn) {
        await deps.storage.put(key, drawn.pdf);
        if (drawn.drawnWith) await markedAsDeck(deps, node, version, drawn.drawnWith);
        state = 'ready';
      }
    } catch (error) {
      deps.log.warn(`Could not draw cloud file ${node.id} as a PDF`, error);
    }
    await deps.db
      .update(cloudVersions)
      .set({ preview: state })
      .where(eq(cloudVersions.id, version.id));
    return state === 'ready' ? key : null;
  })().finally(() => converting.delete(version.id));
  converting.set(version.id, work);
  return work;
}

// ── Pages ───────────────────────────────────────────────────────────────────

/** The width a page is drawn at for the preview – sharp on a doubled screen at reading size. */
export const PAGE_WIDTH = 1600;
/** PDFs just read, kept a moment: the pages of one file are asked for one after another. */
const recentPdfs = new Map<string, { bytes: Uint8Array; at: number }>();
const RECENT_PDFS = 3;
const RECENT_PDF_MS = 2 * 60_000;

/** The version as a PDF: itself, or the one drawn of an office file; `null` when there is none. */
async function pdfOf(
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
): Promise<Uint8Array | null> {
  if (version.sizeBytes > MAX_DOCUMENT_BYTES) return null;
  const key =
    cloudExtension(node.name) === 'pdf'
      ? version.storageKey
      : await previewPdfKey(deps, node, version);
  if (!key) return null;
  const now = Date.now();
  for (const [each, entry] of recentPdfs) {
    if (now - entry.at > RECENT_PDF_MS) recentPdfs.delete(each);
  }
  const kept = recentPdfs.get(key);
  if (kept) {
    kept.at = now;
    return kept.bytes;
  }
  const generation = generationOf(version.id);
  const bytes = await deps.storage.get(key);
  if (!bytes) return null;
  // Drawn anew meanwhile: these bytes may be the old ones – handed out, not kept.
  if (generationOf(version.id) !== generation) return bytes;
  recentPdfs.set(key, { bytes, at: now });
  while (recentPdfs.size > RECENT_PDFS) {
    const oldest = [...recentPdfs].sort((a, b) => a[1].at - b[1].at)[0];
    if (!oldest) break;
    recentPdfs.delete(oldest[0]);
  }
  return bytes;
}

/**
 * The version's text, page by page (a PDF's, or an office file's as drawn); `null` when it
 * cannot be read that way. For the AI in Cloud (`services/cloud-chat.ts`).
 */
export async function pageTexts(
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
): Promise<string[] | null> {
  const pdf = await pdfOf(deps, node, version);
  if (!pdf) return null;
  try {
    return (await runPdfTask({ kind: 'text', bytes: pdf })).pages;
  } catch (error) {
    deps.log.warn(`Could not read the text of cloud file ${node.id}`, error);
    return null;
  }
}

/** Files that are their own text. */
const PLAIN_TEXT = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'html', 'log', 'yml']);
const MAX_PLAIN_BYTES = 2 * 1024 * 1024;
/** Characters of a file's text kept for the search. */
const MAX_KEPT_TEXT = 400_000;

/**
 * What the version says, as one text, for the search in what files say: read once and kept
 * beside it (empty for a file without text). `read: false` only looks it up – `undefined` when
 * it is not read yet.
 */
export async function searchText(
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
  read: boolean,
): Promise<string | undefined> {
  const key = blobKeys.cloudText(node.workspaceId, node.id, version.id);
  const known = await deps.storage.get(key);
  if (known) return new TextDecoder().decode(known);
  if (!read) return undefined;
  let text = '';
  if (PLAIN_TEXT.has(cloudExtension(node.name))) {
    const bytes =
      version.sizeBytes <= MAX_PLAIN_BYTES ? await deps.storage.get(version.storageKey) : null;
    if (bytes) text = new TextDecoder().decode(bytes);
  } else text = ((await pageTexts(deps, node, version)) ?? []).join('\n');
  text = text.replace(/\s+/g, ' ').trim().slice(0, MAX_KEPT_TEXT);
  await deps.storage.put(key, new TextEncoder().encode(text));
  return text;
}

/** How many pages the version has as a PDF; `null` when it cannot be shown as pages. */
export async function pageCount(
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
): Promise<number | null> {
  const key = blobKeys.cloudPages(node.workspaceId, node.id, version.id);
  const known = await deps.storage.get(key);
  if (known) {
    try {
      return (JSON.parse(new TextDecoder().decode(known)) as { pages: number }).pages;
    } catch {
      // Unreadable: counted again below.
    }
  }
  const pdf = await pdfOf(deps, node, version);
  if (!pdf) return null;
  try {
    const { pageCount: pages } = await runPdfTask({ kind: 'text', bytes: pdf });
    await deps.storage.put(key, new TextEncoder().encode(JSON.stringify({ pages })));
    return pages;
  } catch (error) {
    deps.log.warn(`Could not count the pages of cloud file ${node.id}`, error);
    return null;
  }
}

/** One page as a JPEG, drawn once and kept; `null` when there is no such page. */
export async function pagePicture(
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
  page: number,
): Promise<Uint8Array | null> {
  const key = blobKeys.cloudPage(node.workspaceId, node.id, version.id, page);
  const drawn = await deps.storage.get(key);
  if (drawn) return drawn;
  const generation = generationOf(version.id);
  const pdf = await pdfOf(deps, node, version);
  if (!pdf) return null;
  try {
    const picture = await runPdfTask(
      { kind: 'page', bytes: pdf, page, width: PAGE_WIDTH },
      undefined,
      { interactive: true },
    );
    // Of a PDF drawn anew meanwhile it is not kept: its pages went with it.
    if (generationOf(version.id) === generation) await deps.storage.put(key, picture);
    return picture;
  } catch (error) {
    deps.log.warn(`Could not draw page ${page} of cloud file ${node.id}`, error);
    return null;
  }
}

/** Makes the small picture of the file's current version; says on the row whether there is one. */
export async function makeThumbnail(deps: CloudDeps, nodeId: string): Promise<boolean> {
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
  if (!node || node.kind !== 'file' || !node.currentVersionId) return false;
  const [version] = await deps.db
    .select()
    .from(cloudVersions)
    .where(eq(cloudVersions.id, node.currentVersionId));
  if (!version) return false;
  const extension = cloudExtension(node.name);
  let picture: Uint8Array | null = null;
  try {
    if (CLOUD_INLINE_IMAGES.has(extension) || extension === 'svg') {
      if (version.sizeBytes <= MAX_IMAGE_BYTES) {
        const bytes = await deps.storage.get(version.storageKey);
        picture = bytes ? await imageThumbnail(bytes) : null;
      }
    } else if (version.sizeBytes <= MAX_DOCUMENT_BYTES) {
      let pdf: Uint8Array | null = null;
      if (extension === 'pdf') pdf = await deps.storage.get(version.storageKey);
      else if (officePreviewable(deps, node.name)) {
        const key = await previewPdfKey(deps, node, version, 'background');
        pdf = key ? await deps.storage.get(key) : null;
      }
      if (pdf) {
        picture = await runPdfTask(
          { kind: 'page', bytes: pdf, page: 1, width: THUMBNAIL_WIDTH },
          undefined,
          { background: true },
        );
      }
    }
  } catch (error) {
    deps.log.warn(`Could not draw a small picture of cloud file ${node.id}`, error);
  }
  if (picture && !(await stillKept(deps, version.id))) return false;
  if (picture) {
    await deps.storage.put(blobKeys.cloudThumbnail(node.workspaceId, node.id, version.id), picture);
  }
  // Only while this is still the current version: a newer one draws its own.
  await deps.db
    .update(cloudNodes)
    .set({ thumbnail: picture ? 'ready' : 'failed' })
    .where(and(eq(cloudNodes.id, node.id), eq(cloudNodes.currentVersionId, version.id)));
  return Boolean(picture);
}

const markedAsDeck = (
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
  drawnWith: DrawnWith,
) =>
  deps.storage.put(
    blobKeys.cloudPreviewAsDeck(node.workspaceId, node.id, version.id),
    new TextEncoder().encode(JSON.stringify(drawnWith)),
  );

/** Whether the marker says the PDF was drawn with the workspace's fonts as they are now. */
function drawnAsNow(marker: Uint8Array | null, fonts: FontRows): boolean {
  if (!marker) return false;
  try {
    const drawnWith = JSON.parse(new TextDecoder().decode(marker)) as DrawnWith;
    return facesNamed(fonts, drawnWith.names) === drawnWith.faces;
  } catch {
    return false;
  }
}

/** Versions remembered per run, forgotten all at once past this many (looked at again then). */
const MAX_REMEMBERED = 5000;
function remember(versions: Set<string>, version: string): void {
  if (versions.size >= MAX_REMEMBERED) versions.clear();
  versions.add(version);
}

/**
 * Presentation files' versions looked at for a PDF drawn the old way or with other fonts (once
 * each per run and state of the workspace's fonts).
 */
const lookedAt = new Set<string>();
/**
 * When a version's PDF was last drawn anew (a count rising across all; forgetting counts too):
 * what was read of an older one is not kept ({@link pagePicture}, {@link pdfOf}).
 */
const drawnAnew = new Map<string, number>();
let redraws = 0;
let forgotten = 0;
const generationOf = (versionId: string) => drawnAnew.get(versionId) ?? -forgotten;
/** Old PDFs drawn anew right now – each a LibreOffice of its own, so only a few at a time. */
let redrawing = 0;
const MAX_REDRAWS = 2;

/**
 * A presentation file's PDF drawn before Cloud drew them as their presentation is (pool, no
 * workspace fonts), or before a font it names was added or deleted, is drawn anew, and its small
 * picture and pages with it – the file keeps its pictures until then. Failing leaves them as
 * they were.
 */
async function redrawOld(
  deps: CloudDeps,
  node: CloudNodeRow,
  versionId: string,
  fonts: FontRows,
  lookKey: string,
): Promise<void> {
  const marker = blobKeys.cloudPreviewAsDeck(node.workspaceId, node.id, versionId);
  if (drawnAsNow(await deps.storage.get(marker), fonts)) return;
  const [version] = await deps.db
    .select()
    .from(cloudVersions)
    .where(eq(cloudVersions.id, versionId));
  if (!version || version.preview !== 'ready' || version.sizeBytes > MAX_DOCUMENT_BYTES) return;
  if (redrawing >= MAX_REDRAWS) {
    // Looked at again with a later list.
    lookedAt.delete(lookKey);
    return;
  }
  redrawing++;
  try {
    const bytes = await deps.storage.get(version.storageKey);
    const drawn = bytes ? await toPdf(deps, node, bytes, 'background') : null;
    if (!drawn?.drawnWith) return;
    // Its small picture first: a PDF whose first page cannot be drawn changes nothing.
    const picture = await runPdfTask(
      { kind: 'page', bytes: drawn.pdf, page: 1, width: THUMBNAIL_WIDTH },
      undefined,
      { background: true },
    ).catch((error: unknown) => {
      deps.log.warn(`Cloud file ${node.id} drawn anew has no first page`, error);
      return null;
    });
    if (!picture || !(await stillKept(deps, version.id))) return;
    const key = blobKeys.cloudPreview(node.workspaceId, node.id, version.id);
    // Pages drawn of the old one go; how many there are stays (the same file).
    const pages = await pageCount(deps, node, version);
    await deps.storage.put(key, drawn.pdf);
    recentPdfs.delete(key);
    // Only now: a page read of the old PDF until here is not kept, nor one deleted below.
    if (drawnAnew.size >= MAX_REMEMBERED) {
      drawnAnew.clear();
      forgotten++;
    }
    drawnAnew.set(version.id, ++redraws);
    await markedAsDeck(deps, node, version, drawn.drawnWith);
    for (let page = 1; page <= (pages ?? 0); page++) {
      await deps.storage.delete(blobKeys.cloudPage(node.workspaceId, node.id, version.id, page));
    }
    await deps.storage.put(blobKeys.cloudThumbnail(node.workspaceId, node.id, version.id), picture);
  } finally {
    redrawing--;
  }
}

/** Files whose small picture is being drawn right now. */
const drawing = new Set<string>();
/** Versions {@link healThumbnails} asked a picture for already (once each per run). */
const healed = new Set<string>();
/**
 * Small pictures {@link healThumbnails} draws right now: each reads its file whole, so a large old
 * folder listed the first time is drawn a few at a time, with its next lists.
 */
let healing = 0;
const MAX_HEALS = 2;
/** A file changed this recently is left to its next list: a Writer document typed in saves anew. */
const SETTLED_MS = 60_000;

/** After an upload, when nobody waits for it. Its failures are logged, never thrown. */
export function scheduleThumbnail(deps: CloudDeps, nodeId: string): void {
  drawing.add(nodeId);
  runInBackground(deps, async () => {
    await makeThumbnail(deps, nodeId)
      .catch((error: unknown) =>
        deps.log.warn(`Small picture of cloud file ${nodeId} failed`, error),
      )
      .finally(() => drawing.delete(nodeId));
  });
}

/**
 * Listed files still without a small picture and none on its way get one: a presentation's file
 * moved on to a newer step where no picture could be drawn (the importer, a read), or one from
 * before pictures were drawn. The lists show it with their next refresh. A presentation file's
 * PDF drawn the old way is drawn anew ({@link redrawOld}).
 */
export function healThumbnails(deps: CloudDeps, rows: readonly CloudNodeRow[]): void {
  const decks = rows.filter(
    (row) =>
      row.kind === 'file' &&
      row.currentVersionId &&
      !row.deletedAt &&
      row.thumbnail === 'ready' &&
      DECK_KINDS.has(cloudExtension(row.name)),
  );
  if (deps.materialPdf && decks.length > 0) {
    // One look at the workspace's fonts per list; the files one after another.
    runInBackground(deps, async () => {
      const fonts = new Map<string, FontRows>();
      for (const row of decks) {
        let rowsOfFonts = fonts.get(row.workspaceId);
        if (!rowsOfFonts) {
          rowsOfFonts = await fontRowsOf(deps, row.workspaceId);
          fonts.set(row.workspaceId, rowsOfFonts);
        }
        const version = row.currentVersionId!;
        const lookKey = `${version} ${rowsOfFonts
          .map((font) => font.id)
          .sort()
          .join(',')}`;
        if (lookedAt.has(lookKey)) continue;
        remember(lookedAt, lookKey);
        await redrawOld(deps, row, version, rowsOfFonts, lookKey).catch((error: unknown) =>
          deps.log.warn(`Drawing cloud file ${row.id} anew failed`, error),
        );
      }
    });
  }
  for (const row of rows) {
    const version = row.currentVersionId;
    if (row.kind !== 'file' || !version || row.deletedAt) continue;
    if (row.thumbnail !== 'none' || drawing.has(row.id) || healed.has(version)) continue;
    if (healing >= MAX_HEALS) continue;
    if (deps.clock.now().getTime() - row.updatedAt.getTime() < SETTLED_MS) continue;
    remember(healed, version);
    healing++;
    drawing.add(row.id);
    runInBackground(deps, async () => {
      await makeThumbnail(deps, row.id)
        .catch((error: unknown) =>
          deps.log.warn(`Small picture of cloud file ${row.id} failed`, error),
        )
        .finally(() => {
          drawing.delete(row.id);
          healing--;
        });
    });
  }
}
