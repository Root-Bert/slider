import { createCanvas, loadImage } from '@napi-rs/canvas';
import { and, asc, eq } from 'drizzle-orm';
import { extensionOf, type MaterialSheet } from '@slider/shared';
import { read, utils, type WorkBook, type WorkSheet } from 'xlsx';
import { runInBackground } from '../background-work';
import { deckMaterials, materialChunks, type DeckMaterialRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { MATERIAL_PDF_FILTERS, type MaterialPdfKind } from '../import/libreoffice';
import { runPdfTask } from '../import/pdf-jobs';
import { PREVIEW_WIDTH } from '../import/pdf-text';
import { blobKeys } from '../storage/blob-storage';

/*
 * Reading the text of a deck's board's files (Folie 0) in the background, one file after the
 * other: a PDF with pdf.js (in its worker), Word and PowerPoint files as a PDF made by
 * LibreOffice (its pool), spreadsheets and CSV with SheetJS (each sheet a table), text as it is.
 * Pictures have no text – the AI looks at them (`view_material`); they only get a small picture,
 * as PDFs (their first page) and Office files do. The text goes into `material_chunks` in pieces
 * the AI reads and searches (`material-tools.ts`); the card says „wird gelesen …“ until then.
 */

/** A piece of text the AI reads at once, at most (characters). */
export const CHUNK_CHARS = 4000;
/** Files larger than this are not read (their card says so); the AI still sees their name. */
export const MAX_READ_BYTES = 150 * 1024 * 1024;
/** Rows of a sheet read at most. */
export const MAX_SHEET_ROWS = 50_000;
/** Characters of the summary the AI's list shows of a file. */
const SUMMARY_CHARS = 280;

interface Chunk {
  page: number | null;
  sheet: string | null;
  text: string;
}

const queues = new WeakMap<AppDeps, Promise<void>>();

/**
 * Reads the file's text (and makes its small picture) after the files put down before it – as
 * the server's background work, so a test (or a stopping server) can wait for it. A file whose
 * reading a stopped server left undone is taken up again on start (`resumeExtractions`).
 */
export function extractLater(deps: AppDeps, materialId: string): void {
  const before = queues.get(deps) ?? Promise.resolve();
  const next = before.then(() =>
    extractMaterial(deps, materialId).catch((error: unknown) =>
      deps.log.warn(`Material ${materialId} not read`, error),
    ),
  );
  queues.set(deps, next);
  runInBackground(deps, () => next);
}

/** Files whose text a stopped server left unread: read now, in the background. */
export async function resumeExtractions(deps: AppDeps): Promise<void> {
  const rows = await deps.db
    .select({ id: deckMaterials.id })
    .from(deckMaterials)
    .where(eq(deckMaterials.readState, 'pending'))
    .orderBy(asc(deckMaterials.createdAt));
  for (const row of rows) extractLater(deps, row.id);
}

/** The workbook of a spreadsheet or CSV file – values as shown, never formulas run. */
export function readWorkbook(bytes: Uint8Array, name: string): WorkBook {
  const extension = extensionOf(name);
  const options = {
    sheetRows: MAX_SHEET_ROWS,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    dense: true,
  } as const;
  if (extension === 'csv' || extension === 'tsv') {
    // UTF-8 text, so umlauts stay; SheetJS finds the separator.
    return read(new TextDecoder().decode(bytes), { ...options, type: 'string', raw: false });
  }
  return read(bytes, { ...options, type: 'array' });
}

/** A column's letters: 0 → A, 26 → AA. */
export const columnName = (index: number) => utils.encode_col(index);

/**
 * Rows of a sheet as a table with its cell addresses: a head of column letters, each row
 * starting with its number – so „B7“ can be found and named. `range` (A1:F40) cuts it.
 */
export function sheetRows(
  sheet: WorkSheet,
  range?: string,
): { head: string; rows: { number: number; line: string }[]; first: number; last: number } {
  const full = sheet['!ref'] ? utils.decode_range(sheet['!ref']) : null;
  if (!full) return { head: '', rows: [], first: 0, last: -1 };
  const wanted = range ? utils.decode_range(range.toUpperCase()) : full;
  const area = {
    s: { r: Math.max(full.s.r, wanted.s.r), c: Math.max(full.s.c, wanted.s.c) },
    e: { r: Math.min(full.e.r, wanted.e.r), c: Math.min(full.e.c, wanted.e.c) },
  };
  const matrix = utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
    range: area,
  });
  const columns: string[] = [];
  for (let c = area.s.c; c <= area.e.c; c++) columns.push(columnName(c));
  const rows = matrix.flatMap((cells, index) => {
    const values = cells.map((cell) =>
      String(cell ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (values.every((value) => value === '')) return [];
    return [
      { number: area.s.r + index + 1, line: `${area.s.r + index + 1} | ${values.join(' | ')}` },
    ];
  });
  return { head: `# | ${columns.join(' | ')}`, rows, first: area.s.r + 1, last: area.e.r + 1 };
}

/** A workbook's sheets with their sizes. */
export function sheetsOf(book: WorkBook): MaterialSheet[] {
  return book.SheetNames.map((name) => {
    const ref = book.Sheets[name]?.['!ref'];
    const range = ref ? utils.decode_range(ref) : null;
    return {
      name,
      rows: range ? range.e.r - range.s.r + 1 : 0,
      columns: range ? range.e.c - range.s.c + 1 : 0,
    };
  });
}

/** Long text in pieces of at most {@link CHUNK_CHARS}, cut between paragraphs where it can. */
export function splitText(text: string): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > CHUNK_CHARS) {
    let cut = rest.lastIndexOf('\n\n', CHUNK_CHARS);
    if (cut < CHUNK_CHARS / 2) cut = rest.lastIndexOf('\n', CHUNK_CHARS);
    if (cut < CHUNK_CHARS / 2) cut = rest.lastIndexOf(' ', CHUNK_CHARS);
    if (cut < CHUNK_CHARS / 2) cut = CHUNK_CHARS;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function workbookChunks(book: WorkBook): Chunk[] {
  const chunks: Chunk[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const { head, rows } = sheetRows(sheet);
    let lines: string[] = [];
    let from = 0;
    let size = 0;
    const flush = (to: number) => {
      if (lines.length === 0) return;
      chunks.push({
        page: null,
        sheet: name,
        text: `Sheet „${name}“, rows ${from}–${to}:\n${head}\n${lines.join('\n')}`,
      });
      lines = [];
      size = 0;
    };
    let last = 0;
    for (const row of rows) {
      if (size + row.line.length > CHUNK_CHARS && lines.length > 0) flush(last);
      if (lines.length === 0) from = row.number;
      lines.push(row.line.slice(0, CHUNK_CHARS));
      size += row.line.length + 1;
      last = row.number;
    }
    flush(last);
  }
  return chunks;
}

const pageChunks = (pages: string[]): Chunk[] =>
  pages.flatMap((text, index) =>
    splitText(text).map((piece) => ({ page: index + 1, sheet: null, text: piece })),
  );

/** The beginning of the text in one line, for the AI's list of materials. */
function summaryOf(chunks: Chunk[], sheets: MaterialSheet[]): string | null {
  if (sheets.length > 0) {
    // Each sheet's first row – mostly its column heads.
    const heads = sheets.map((sheet) => {
      const first = chunks.find((chunk) => chunk.sheet === sheet.name)?.text.split('\n')[2] ?? '';
      return `${sheet.name}: ${first.replace(/^\d+ \| /, '')}`;
    });
    return heads.join('; ').slice(0, SUMMARY_CHARS);
  }
  const text = chunks
    .map((chunk) => chunk.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS - 1)}…` : text;
}

/** A picture drawn small as a JPEG for its card; `null` when it cannot be read. */
async function imagePreview(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const image = await loadImage(Buffer.from(bytes));
    const scale = Math.min(1, PREVIEW_WIDTH / image.width);
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

/** The file as a PDF to read: itself, or made by LibreOffice; `null` when it can't be. */
export async function materialAsPdf(
  deps: AppDeps,
  row: Pick<DeckMaterialRow, 'kind' | 'name'>,
  bytes: Uint8Array,
): Promise<Uint8Array | null> {
  if (row.kind === 'pdf') return bytes;
  const extension = extensionOf(row.name);
  if (!deps.materialPdf || !(extension in MATERIAL_PDF_FILTERS)) return null;
  return deps.materialPdf(bytes, extension as MaterialPdfKind);
}

async function extractMaterial(deps: AppDeps, materialId: string): Promise<void> {
  const [row] = await deps.db.select().from(deckMaterials).where(eq(deckMaterials.id, materialId));
  if (!row) return;
  const bytes = await deps.media.get(row.storageKey);
  if (!bytes) return;
  let chunks: Chunk[] = [];
  let sheets: MaterialSheet[] = [];
  let pages: number | null = null;
  let preview: Uint8Array | null = null;
  let readState: DeckMaterialRow['readState'] =
    row.readState === 'pending' ? 'done' : row.readState;
  try {
    if (row.kind === 'image') {
      preview = await imagePreview(bytes);
    } else if (row.sizeBytes > MAX_READ_BYTES) {
      readState = 'failed';
    } else if (row.kind === 'spreadsheet') {
      const book = readWorkbook(bytes, row.name);
      sheets = sheetsOf(book);
      pages = sheets.length;
      chunks = workbookChunks(book);
    } else if (row.kind === 'text') {
      chunks = splitText(new TextDecoder().decode(bytes)).map((text) => ({
        page: null,
        sheet: null,
        text,
      }));
    } else {
      const pdf = await materialAsPdf(deps, row, bytes);
      if (!pdf) readState = 'failed';
      else {
        const read = await runPdfTask({ kind: 'text', bytes: pdf }, undefined, {
          background: true,
        });
        chunks = pageChunks(read.pages);
        pages = read.pageCount;
        preview = read.preview;
      }
    }
  } catch (error) {
    deps.log.warn(`Could not read material ${row.id} (${row.kind})`, error);
    readState = 'failed';
  }

  const previewKey = preview ? blobKeys.materialPreview(row.deckId, row.id) : null;
  if (preview && previewKey) await deps.media.put(previewKey, preview);
  const stored = await deps.db.transaction(async (tx) => {
    // Deleted meanwhile: nothing to keep (its preview goes below).
    const [still] = await tx
      .select({ id: deckMaterials.id })
      .from(deckMaterials)
      .where(eq(deckMaterials.id, row.id))
      .for('update');
    if (!still) return false;
    await tx.delete(materialChunks).where(eq(materialChunks.materialId, row.id));
    for (let at = 0; at < chunks.length; at += 200) {
      await tx.insert(materialChunks).values(
        chunks.slice(at, at + 200).map((chunk, index) => ({
          materialId: row.id,
          deckId: row.deckId,
          seq: at + index,
          page: chunk.page,
          sheet: chunk.sheet,
          text: chunk.text,
        })),
      );
    }
    await tx
      .update(deckMaterials)
      .set({
        readState,
        pages,
        sheets,
        summary: summaryOf(chunks, sheets),
        ...(previewKey && { previewKey }),
      })
      .where(and(eq(deckMaterials.id, row.id)));
    return true;
  });
  if (!stored) {
    if (previewKey) await deps.media.delete(previewKey).catch(() => undefined);
    return;
  }
  deps.live?.boardChanged(row.deckId);
}
