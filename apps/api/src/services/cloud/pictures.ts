import { createCanvas, loadImage } from '@napi-rs/canvas';
import { and, eq } from 'drizzle-orm';
import { CLOUD_INLINE_IMAGES, cloudExtension } from '@slider/shared';
import { runInBackground } from '../../background-work';
import {
  cloudNodes,
  cloudVersions,
  type CloudNodeRow,
  type CloudVersionRow,
} from '../../db/schema';
import { imageSize } from '../../import/any-file';
import {
  DOCUMENT_IMPORT_FILTERS,
  MATERIAL_PDF_FILTERS,
  type MaterialPdfKind,
  type OfficeDocumentKind,
} from '../../import/libreoffice';
import { runPdfTask } from '../../import/pdf-jobs';
import { blobKeys } from '../../storage/blob-storage';
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

async function toPdf(deps: CloudDeps, name: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  const extension = cloudExtension(name);
  if (deps.materialPdf && extension in MATERIAL_PDF_FILTERS) {
    return deps.materialPdf(bytes, extension as MaterialPdfKind);
  }
  if (deps.documentPdf && extension in DOCUMENT_IMPORT_FILTERS) {
    return deps.documentPdf(bytes, extension as OfficeDocumentKind);
  }
  return null;
}

/** One conversion per version at a time: a second asker waits for the first one's result. */
const converting = new Map<string, Promise<string | null>>();

/**
 * The key of the version drawn as a PDF, made now if it is not there yet; `null` when it
 * cannot be (no LibreOffice, a format it does not read, a broken file – remembered as failed).
 */
export async function previewPdfKey(
  deps: CloudDeps,
  node: CloudNodeRow,
  version: CloudVersionRow,
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
      const pdf = bytes ? await toPdf(deps, node.name, bytes) : null;
      if (pdf) {
        await deps.storage.put(key, pdf);
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
  const bytes = await deps.storage.get(key);
  if (!bytes) return null;
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
  const pdf = await pdfOf(deps, node, version);
  if (!pdf) return null;
  try {
    const picture = await runPdfTask(
      { kind: 'page', bytes: pdf, page, width: PAGE_WIDTH },
      undefined,
      { interactive: true },
    );
    await deps.storage.put(key, picture);
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
        const key = await previewPdfKey(deps, node, version);
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

/** After an upload, when nobody waits for it. Its failures are logged, never thrown. */
export function scheduleThumbnail(deps: CloudDeps, nodeId: string): void {
  runInBackground(deps, async () => {
    await makeThumbnail(deps, nodeId).catch((error: unknown) =>
      deps.log.warn(`Small picture of cloud file ${nodeId} failed`, error),
    );
  });
}
