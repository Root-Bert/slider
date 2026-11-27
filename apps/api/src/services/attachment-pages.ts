import { cloudFileType } from '@slider/shared';
import { eq } from 'drizzle-orm';
import { attachments } from '../db/schema';
import type { AppDeps } from '../deps';
import { imageSize } from '../import/any-file';
import { runPdfTask } from '../import/pdf-jobs';
import { attachmentRow, pagesPrefix } from './attachments';
import { officePreviewable, PAGE_WIDTH, toPdf } from './cloud/pictures';

/*
 * A document sent in a conversation as its pages – the preview Cloud shows of a file
 * (`PagePreview`), here for a file that lies on its message alone (`services/attachments.ts`).
 * A PDF as it is, an office file drawn as a PDF by LibreOffice once; what is drawn of it is kept
 * beside its bytes (`pagesPrefix`): the count and the shape of its first page, the first page
 * drawn small, each page drawn once it is asked for. The bytes never change, so neither does any
 * of this; it goes with the file (`attachmentBlobs`).
 */

/** A file bigger than this is not drawn: it would have to be held whole. */
const MAX_DOCUMENT_BYTES = 96 * 1024 * 1024;

/** What the preview needs before any page: how many there are, the first one's width / height. */
export interface AttachmentPages {
  pages: number;
  ratio: number;
}

type Row = Awaited<ReturnType<typeof attachmentRow>>;

/** Whether the file can be shown as pages here at all: a PDF, or an office file LibreOffice reads. */
function drawable(deps: AppDeps, row: Row): 'pdf' | 'office' | null {
  if (row.size > MAX_DOCUMENT_BYTES) return null;
  const type = cloudFileType(row.name, row.type);
  if (type === 'pdf') return 'pdf';
  if (type === 'document' || type === 'presentation' || type === 'spreadsheet') {
    return officePreviewable(deps, row.name) ? 'office' : null;
  }
  return null;
}

const INFO = 'info.json';
const SMALL = 'small.jpg';
const DRAWN = 'drawn.pdf';

/** One drawing per file at a time: whoever asks meanwhile waits for the first one's answer. */
const reading = new Map<string, Promise<AttachmentPages | null>>();

async function readInfo(deps: AppDeps, row: Row): Promise<AttachmentPages | null | undefined> {
  const kept = await deps.storage.get(pagesPrefix(row.key) + INFO);
  if (!kept) return undefined;
  try {
    const info = JSON.parse(new TextDecoder().decode(kept)) as Partial<AttachmentPages>;
    // Failed once (broken, protected, not drawable): remembered as no pages.
    return info.pages && info.ratio ? { pages: info.pages, ratio: info.ratio } : null;
  } catch {
    return undefined;
  }
}

/** The file as a PDF: its own bytes, or LibreOffice's drawing of it (kept). */
async function pdfOf(deps: AppDeps, row: Row, kind: 'pdf' | 'office') {
  if (kind === 'pdf') return deps.storage.get(row.key);
  return deps.storage.get(pagesPrefix(row.key) + DRAWN);
}

/**
 * How many pages a sent file has and its first page's shape – drawn now if not yet; `null` when
 * it is no document this server can show (then the message shows it as a file only).
 */
export async function attachmentPages(
  deps: AppDeps,
  userId: string,
  id: string,
): Promise<AttachmentPages | null> {
  const row = await attachmentRow(deps, userId, id);
  const kind = drawable(deps, row);
  if (!kind) return null;
  const known = await readInfo(deps, row);
  if (known !== undefined) return known;
  const running = reading.get(id);
  if (running) return running;
  const work = (async (): Promise<AttachmentPages | null> => {
    const prefix = pagesPrefix(row.key);
    let info: AttachmentPages | null = null;
    try {
      const bytes = await deps.storage.get(row.key);
      if (!bytes) return null;
      let pdf: Uint8Array | null = bytes;
      if (kind === 'office') {
        pdf = (await toPdf(deps, row, bytes, 'interactive'))?.pdf ?? null;
        if (pdf) await deps.storage.put(prefix + DRAWN, pdf);
      }
      if (pdf) {
        const { pageCount, preview } = await runPdfTask({ kind: 'text', bytes: pdf }, undefined, {
          interactive: true,
        });
        const size = preview ? imageSize(preview) : null;
        if (preview && size && pageCount > 0) {
          await deps.storage.put(prefix + SMALL, preview);
          info = { pages: pageCount, ratio: size.width / size.height };
        }
      }
    } catch (error) {
      deps.log.warn(`Could not draw the pages of sent file ${id}`, error);
    }
    await deps.storage.put(
      prefix + INFO,
      new TextEncoder().encode(JSON.stringify(info ?? { pages: 0 })),
    );
    // Deleted meanwhile: what was just written would be left behind.
    const [still] = await deps.db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.id, id));
    if (!still) {
      await deps.storage.deletePrefix(prefix);
      return null;
    }
    return info;
  })().finally(() => reading.delete(id));
  reading.set(id, work);
  return work;
}

/** The first page drawn small – what the preview shows until the sharp one is there. */
export async function attachmentSmallPage(
  deps: AppDeps,
  userId: string,
  id: string,
): Promise<Uint8Array | null> {
  const row = await attachmentRow(deps, userId, id);
  return deps.storage.get(pagesPrefix(row.key) + SMALL);
}

/** Page `page` (1-based) drawn sharp, once, then kept; `null` when there is no such page. */
export async function attachmentPage(
  deps: AppDeps,
  userId: string,
  id: string,
  page: number,
): Promise<Uint8Array | null> {
  const info = await attachmentPages(deps, userId, id);
  if (!info || page < 1 || page > info.pages) return null;
  const row = await attachmentRow(deps, userId, id);
  const key = `${pagesPrefix(row.key)}${page}.jpg`;
  const drawn = await deps.storage.get(key);
  if (drawn) return drawn;
  const kind = drawable(deps, row);
  const pdf = kind ? await pdfOf(deps, row, kind) : null;
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
    deps.log.warn(`Could not draw page ${page} of sent file ${id}`, error);
    return null;
  }
}
