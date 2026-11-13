import type Anthropic from '@anthropic-ai/sdk';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { asc, eq } from 'drizzle-orm';
import { formatFileSize, searchFold } from '@slider/shared';
import { z } from 'zod';
import { deckBoardItems, deckMaterials, materialChunks, type DeckMaterialRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { runPdfTask } from '../import/pdf-jobs';
import { materialAsPdf, readWorkbook, sheetRows } from './material-extract';

/*
 * What the AI reads of a deck's material page – through tools, never all at once: the first
 * message only lists the files (`materialsBrief`, `ai-context.ts`), the tools bring their text, a sheet's cells,
 * a search through all of them, or a look at a picture or page. For comment requests and for
 * creating a deck from a prompt alike (`ai-proposals.ts`).
 */

type ToolContent = Anthropic.Beta.BetaToolResultBlockParam['content'];

/** Characters one read_material call gives at most. */
const READ_CHARS = 24_000;
/** Rows and columns read_sheet gives at most. */
const SHEET_ROWS = 300;
const SHEET_COLUMNS = 40;
/** Places search_materials lists at most. */
const SEARCH_HITS = 12;
/** Width a page or picture is shown to the AI at. */
const VIEW_WIDTH = 1600;

const KIND_NAMES: Record<DeckMaterialRow['kind'], string> = {
  pdf: 'PDF',
  document: 'document',
  presentation: 'presentation',
  spreadsheet: 'spreadsheet',
  image: 'picture',
  text: 'text',
  other: 'file',
};

export const MATERIAL_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'list_materials',
    description:
      "Lists the presentation's material (its own page „Material“ beside the slides): files with id, name, kind, size, pages or sheets, whether their text is read, the beginning of their text and the notes people put on them; notes and links people put on the material page with their text.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_material',
    description:
      'The text of a file of the board, page by page (`from`/`to`: pages of a PDF, document or presentation; parts of a spreadsheet or text file). At most about 24 000 characters at once – read on with `from` where it stopped.',
    input_schema: {
      type: 'object',
      properties: {
        material: { type: 'string', description: 'Its id (list_materials) or exact name.' },
        from: { type: 'integer', minimum: 1 },
        to: { type: 'integer', minimum: 1 },
      },
      required: ['material'],
    },
  },
  {
    name: 'read_sheet',
    description:
      'Cells of a spreadsheet (or CSV) of the board as a table with their addresses – each row starts with its number, the head names the columns (A, B, …). `sheet`: its name (default: the first); `range`: e.g. "A1:F40" (default: from the top, at most 300 rows and 40 columns).',
    input_schema: {
      type: 'object',
      properties: {
        material: { type: 'string' },
        sheet: { type: 'string' },
        range: { type: 'string', pattern: '^[A-Za-z]{1,3}[0-9]{1,7}(:[A-Za-z]{1,3}[0-9]{1,7})?$' },
      },
      required: ['material'],
    },
  },
  {
    name: 'search_materials',
    description:
      'Finds words in the text of all files on the board (any case, accents ignored; several words: places with most of them first). Returns where – file, page or sheet and rows, part – with the text around it; read on with read_material or read_sheet.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
    },
  },
  {
    name: 'view_material',
    description:
      'Looks at a file of the board: a picture as it is, or page `page` (default 1) of a PDF, document or presentation drawn as it looks – for charts, photos, layouts the text does not tell.',
    input_schema: {
      type: 'object',
      properties: { material: { type: 'string' }, page: { type: 'integer', minimum: 1 } },
      required: ['material'],
    },
  },
];

export const MATERIAL_TOOL_NAMES = new Set(MATERIAL_TOOLS.map((tool) => tool.name));

const materialInput = z.object({ material: z.string().min(1) });
const readInput = materialInput.extend({
  from: z.number().int().min(1).optional(),
  to: z.number().int().min(1).optional(),
});
const sheetInput = materialInput.extend({
  sheet: z.string().optional(),
  range: z.string().optional(),
});
const searchInput = z.object({ query: z.string().min(1) });
const viewInput = materialInput.extend({ page: z.number().int().min(1).optional() });

/** The materials of a deck, oldest first. */
export async function materialsOf(deps: AppDeps, deckId: string): Promise<DeckMaterialRow[]> {
  return deps.db
    .select()
    .from(deckMaterials)
    .where(eq(deckMaterials.deckId, deckId))
    .orderBy(asc(deckMaterials.createdAt), asc(deckMaterials.id));
}

class ToolError extends Error {}

async function findMaterial(deps: AppDeps, deckId: string, wanted: string) {
  const rows = await materialsOf(deps, deckId);
  const key = wanted.trim();
  const row =
    rows.find((each) => each.id === key) ??
    rows.find((each) => each.name === key) ??
    rows.find((each) => each.name.toLowerCase() === key.toLowerCase());
  if (!row) throw new ToolError(`No material "${key}" on the board – list_materials names them.`);
  return row;
}

/** One line naming a file of the board: id, name, kind, size, pages or sheets, read or not. */
export function describeMaterial(row: DeckMaterialRow): string {
  const parts = [KIND_NAMES[row.kind], formatFileSize(row.sizeBytes)];
  if (row.kind === 'spreadsheet' && row.sheets.length > 0)
    parts.push(
      `sheets ${row.sheets.map((sheet) => `„${sheet.name}“ ${sheet.rows}×${sheet.columns}`).join(', ')}`,
    );
  else if (row.pages)
    parts.push(`${row.pages} ${row.kind === 'presentation' ? 'slides' : 'pages'}`);
  const state =
    row.readState === 'pending'
      ? ' – its text is still being read'
      : row.readState === 'failed'
        ? ' – its text could not be read'
        : '';
  return `${row.id}: „${row.name}“ (${parts.join(', ')})${state}`;
}

async function listMaterials(deps: AppDeps, deckId: string): Promise<string> {
  const [rows, items] = await Promise.all([
    materialsOf(deps, deckId),
    deps.db
      .select()
      .from(deckBoardItems)
      .where(eq(deckBoardItems.deckId, deckId))
      .orderBy(asc(deckBoardItems.createdAt)),
  ]);
  if (rows.length === 0 && items.length === 0) return 'The board is empty.';
  const folderOf = new Map(
    items
      .filter((item) => item.kind === 'folder')
      .flatMap((folder) => folder.boundIds.map((id) => [id, folder.text] as const)),
  );
  const lines = rows.map((row) => {
    const summary = row.summary?.replace(/\s+/g, ' ').trim();
    const folder = folderOf.get(row.id);
    const notes = notesOn(items, row.id).map((note) => `\n  ${note}`);
    return `- ${describeMaterial(row)}, put there by ${row.author.name}${folder ? `, in the folder „${folder}“` : ''}${summary ? `\n  ${summary}` : ''}${notes.join('')}`;
  });
  const files = new Set(rows.map((row) => row.id));
  for (const item of items) {
    if (item.kind === 'folder') {
      const names = item.boundIds.flatMap((id) => {
        const row = rows.find((each) => each.id === id);
        return row ? [`„${row.name}“`] : [];
      });
      lines.push(
        `- folder „${item.text}“ by ${item.author.name} with ${names.length} file(s)${names.length > 0 ? `: ${names.join(', ')}` : ''}`,
      );
      continue;
    }
    if (item.kind === 'box') {
      lines.push(
        `- box by ${item.author.name}${item.boundIds.length > 0 ? ` holding ${item.boundIds.length} thing(s) of the board` : ''}: ${item.text.slice(0, 2000)}`,
      );
      continue;
    }
    // A note on a file is listed with that file.
    if (item.boundIds.some((id) => files.has(id))) continue;
    if (item.kind === 'link') {
      const notes = notesOn(items, item.id, 'link').map((note) => `\n  ${note}`);
      lines.push(
        `- link ${item.url}${item.text ? ` „${item.text}“` : ''} (${item.author.name})${notes.join('')}`,
      );
    } else if (
      !item.boundIds.some((id) => items.some((each) => each.id === id && each.kind === 'link'))
    )
      lines.push(`- note by ${item.author.name}: ${item.text.slice(0, 2000)}`);
  }
  return lines.join('\n');
}

/**
 * The notes people hung on a file (or a link), as lines: by whom, what, and what else they hang on
 * – the AI reads them with the file.
 */
export function notesOn(
  items: readonly { kind: string; boundIds: string[]; text: string; author: { name: string } }[],
  thingId: string,
  thing: 'file' | 'link' = 'file',
): string[] {
  return items
    .filter((item) => item.boundIds.includes(thingId))
    .map((item) => {
      const others = item.boundIds.length - 1;
      return item.kind === 'box'
        ? `in the box „${item.text.slice(0, 200)}“ by ${item.author.name}${others > 0 ? ` with ${others} more thing(s) of the board` : ''}`
        : `note on this ${thing} by ${item.author.name}: ${item.text.slice(0, 2000)}`;
    });
}

async function readMaterial(
  deps: AppDeps,
  deckId: string,
  input: z.infer<typeof readInput>,
): Promise<string> {
  const row = await findMaterial(deps, deckId, input.material);
  const items = await deps.db
    .select()
    .from(deckBoardItems)
    .where(eq(deckBoardItems.deckId, deckId))
    .orderBy(asc(deckBoardItems.createdAt));
  const notes = notesOn(items, row.id);
  const withNotes = (text: string) =>
    notes.length > 0
      ? `${text}\n\nNotes people put on „${row.name}“:\n- ${notes.join('\n- ')}`
      : text;
  return withNotes(await readMaterialText(deps, row, input));
}

async function readMaterialText(
  deps: AppDeps,
  row: DeckMaterialRow,
  input: z.infer<typeof readInput>,
): Promise<string> {
  if (row.readState === 'pending') return `„${row.name}“ is still being read – try again shortly.`;
  if (row.kind === 'image') return `„${row.name}“ is a picture – view_material shows it.`;
  const chunks = await deps.db
    .select()
    .from(materialChunks)
    .where(eq(materialChunks.materialId, row.id))
    .orderBy(asc(materialChunks.seq));
  if (chunks.length === 0) return `„${row.name}“ has no text to read.`;
  const paged = chunks.some((chunk) => chunk.page !== null);
  const numberOf = (chunk: (typeof chunks)[number], index: number) =>
    paged ? (chunk.page ?? 1) : index + 1;
  const total = paged ? Math.max(...chunks.map((chunk) => chunk.page ?? 1)) : chunks.length;
  const from = input.from ?? 1;
  const to = Math.min(input.to ?? total, total);
  const unit = paged ? 'page' : 'part';
  let out = '';
  let lastNumber = from - 1;
  for (const [index, chunk] of chunks.entries()) {
    const number = numberOf(chunk, index);
    if (number < from || number > to) continue;
    const head =
      number !== lastNumber
        ? `\n— ${unit} ${number}${chunk.sheet ? ` (sheet „${chunk.sheet}“)` : ''} —\n`
        : '\n';
    if (out.length + head.length + chunk.text.length > READ_CHARS && out.length > 0) {
      out += `\n[stopped before ${unit} ${number} of ${total} – read on with from: ${number}]`;
      return `„${row.name}“, ${unit}s ${from}–${lastNumber} of ${total}:${out}`;
    }
    out += head + chunk.text;
    lastNumber = number;
  }
  if (!out) return `„${row.name}“ has ${total} ${unit}s – nothing in ${from}–${to}.`;
  return `„${row.name}“, ${unit}s ${from}–${to} of ${total}:${out}`;
}

async function readSheet(
  deps: AppDeps,
  deckId: string,
  input: z.infer<typeof sheetInput>,
): Promise<string> {
  const row = await findMaterial(deps, deckId, input.material);
  if (row.kind !== 'spreadsheet')
    return `„${row.name}“ is no spreadsheet – read_material reads it.`;
  const bytes = await deps.media.get(row.storageKey);
  if (!bytes) throw new ToolError(`„${row.name}“ is no longer stored.`);
  const book = readWorkbook(bytes, row.name);
  const name =
    input.sheet === undefined
      ? book.SheetNames[0]
      : (book.SheetNames.find((each) => each === input.sheet) ??
        book.SheetNames.find((each) => each.toLowerCase() === input.sheet!.toLowerCase()));
  const sheet = name ? book.Sheets[name] : undefined;
  if (!name || !sheet)
    throw new ToolError(
      `No sheet "${input.sheet}" – it has ${book.SheetNames.map((each) => `„${each}“`).join(', ')}.`,
    );
  const range = input.range ?? `A1:${columnLetters(SHEET_COLUMNS - 1)}${SHEET_ROWS}`;
  const { head, rows } = sheetRows(sheet, range);
  if (rows.length === 0) return `Sheet „${name}“ of „${row.name}“: nothing in ${range}.`;
  const shown = rows.slice(0, SHEET_ROWS);
  const sheetRowCount = row.sheets.find((each) => each.name === name)?.rows ?? 0;
  const more =
    rows.length > SHEET_ROWS || (!input.range && sheetRowCount > SHEET_ROWS)
      ? `\n[more rows below – ask for a range further down]`
      : '';
  return `Sheet „${name}“ of „${row.name}“ (${range}):\n${head}\n${shown.map((each) => each.line).join('\n')}${more}`;
}

const columnLetters = (index: number): string => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

/**
 * Finds the words in the pieces of text of every file of the deck – read and compared here, not
 * in SQL: the text is encrypted at rest. Places holding more of the words, more often, first.
 */
async function searchMaterials(deps: AppDeps, deckId: string, query: string): Promise<string> {
  const words = [
    ...new Set(
      searchFold(query)
        .split(/\s+/)
        .filter((word) => word.length > 0),
    ),
  ];
  if (words.length === 0) return 'Nothing to search for.';
  const [rows, chunks] = await Promise.all([
    materialsOf(deps, deckId),
    deps.db
      .select()
      .from(materialChunks)
      .where(eq(materialChunks.deckId, deckId))
      .orderBy(asc(materialChunks.materialId), asc(materialChunks.seq)),
  ]);
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const parts = new Map<string, number>();
  const hits: { score: number; line: string }[] = [];
  for (const chunk of chunks) {
    const part = (parts.get(chunk.materialId) ?? 0) + 1;
    parts.set(chunk.materialId, part);
    const folded = searchFold(chunk.text);
    let found = 0;
    let count = 0;
    let first = -1;
    for (const word of words) {
      let at = folded.indexOf(word);
      if (at === -1) continue;
      found += 1;
      if (first === -1 || at < first) first = at;
      while (at !== -1) {
        count += 1;
        at = folded.indexOf(word, at + word.length);
      }
    }
    if (found === 0) continue;
    // Folding keeps lengths for the letters that matter here; good enough for a snippet.
    const start = Math.max(0, first - 120);
    const snippet = chunk.text
      .slice(start, start + 360)
      .replace(/\s+/g, ' ')
      .trim();
    const where = chunk.page
      ? `page ${chunk.page}`
      : chunk.sheet
        ? `sheet „${chunk.sheet}“, ${chunk.text.split('\n')[0]?.split(', ').at(-1)?.replace(/:$/, '') ?? ''}`
        : `part ${part}`;
    hits.push({
      score: found * 1000 + count,
      line: `- „${names.get(chunk.materialId) ?? chunk.materialId}“ (${chunk.materialId}), ${where}: …${snippet}…`,
    });
  }
  if (hits.length === 0) {
    const pending = rows.filter((row) => row.readState === 'pending').length;
    return `Nothing found for "${query}".${pending > 0 ? ` ${pending} file(s) are still being read.` : ''}`;
  }
  hits.sort((a, b) => b.score - a.score);
  return `${hits.length} place(s) for "${query}"${hits.length > SEARCH_HITS ? `, the best ${SEARCH_HITS}` : ''}:\n${hits
    .slice(0, SEARCH_HITS)
    .map((hit) => hit.line)
    .join('\n')}`;
}

/** A picture as a JPEG at most {@link VIEW_WIDTH} on its longer side. */
export async function asJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const image = await loadImage(Buffer.from(bytes));
  const scale = Math.min(1, VIEW_WIDTH / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return new Uint8Array(await canvas.encode('jpeg', 88));
}

const jpegBlock = (bytes: Uint8Array): Anthropic.Beta.BetaImageBlockParam => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(bytes).toString('base64') },
});

async function viewMaterial(
  deps: AppDeps,
  deckId: string,
  input: z.infer<typeof viewInput>,
): Promise<ToolContent> {
  const row = await findMaterial(deps, deckId, input.material);
  const bytes = await deps.media.get(row.storageKey);
  if (!bytes) throw new ToolError(`„${row.name}“ is no longer stored.`);
  if (row.kind === 'image') {
    return [{ type: 'text', text: `„${row.name}“:` }, jpegBlock(await asJpeg(bytes))];
  }
  if (row.kind === 'spreadsheet' || row.kind === 'text' || row.kind === 'other') {
    return `„${row.name}“ has no pages to look at – read_material or read_sheet reads it.`;
  }
  const pdf = await materialAsPdf(deps, row, bytes);
  if (!pdf) return `„${row.name}“ cannot be drawn here – read_material reads its text.`;
  const page = input.page ?? 1;
  try {
    const image = await runPdfTask(
      { kind: 'page', bytes: pdf, page, width: VIEW_WIDTH },
      undefined,
      { interactive: true },
    );
    return [{ type: 'text', text: `„${row.name}“, page ${page}:` }, jpegBlock(image)];
  } catch (error) {
    if (error instanceof Error && error.name === 'RangeError') throw new ToolError(error.message);
    throw error;
  }
}

/**
 * Runs one of the material tools for the deck; `null` when `name` is none of them. A wrong
 * input or an unknown material comes back as the tool's error, for the AI to call again.
 */
export async function runMaterialTool(
  deps: AppDeps,
  deckId: string,
  name: string,
  input: unknown,
): Promise<{ content: ToolContent; isError: boolean } | null> {
  if (!MATERIAL_TOOL_NAMES.has(name)) return null;
  try {
    let content: ToolContent;
    if (name === 'list_materials') content = await listMaterials(deps, deckId);
    else if (name === 'read_material')
      content = await readMaterial(deps, deckId, readInput.parse(input));
    else if (name === 'read_sheet')
      content = await readSheet(deps, deckId, sheetInput.parse(input));
    else if (name === 'search_materials')
      content = await searchMaterials(deps, deckId, searchInput.parse(input).query);
    else content = await viewMaterial(deps, deckId, viewInput.parse(input));
    return { content, isError: false };
  } catch (error) {
    if (error instanceof ToolError) return { content: error.message, isError: true };
    if (error instanceof z.ZodError) return { content: z.prettifyError(error), isError: true };
    throw error;
  }
}
