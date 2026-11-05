import { z } from 'zod';
import { accentColorSchema, authorSchema } from './model';

/*
 * Folie 0 („Material“): a free board before slide 1 where the material of a deck lies – files
 * (PDF, Word, PowerPoint, Excel, pictures …), notes and links. It is never part of the deck's
 * file: not in the ODP, not in an export, not counted as a slide. The AI reads the files through
 * its tools (`list_materials`, `read_material`, `read_sheet`, `search_materials`,
 * `view_material`), never all at once.
 */

/** What a file on the board is, by its type – the card's icon and how its text is read. */
export const MATERIAL_KINDS = [
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'image',
  'text',
  'other',
] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/**
 * How far reading a file's text is: `pending` while the server reads it („wird gelesen …“),
 * `done`, `failed` (unreadable, or no LibreOffice for Office files), `none` for files without
 * text to read (pictures, unknown types).
 */
export const MATERIAL_READ_STATES = ['pending', 'done', 'failed', 'none'] as const;
export type MaterialReadState = (typeof MATERIAL_READ_STATES)[number];

/** The smallest side of anything on the board (board units). */
export const BOARD_MIN_SIDE = 8;

/**
 * Where an item lies on the board and how big it is, in board units (px at 100 %). As small as a
 * note's box drawn on the board may be.
 */
export const boardFrameSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  w: z.number().finite().min(BOARD_MIN_SIDE).max(4000),
  h: z.number().finite().min(BOARD_MIN_SIDE).max(4000),
});
export type BoardFrame = z.infer<typeof boardFrameSchema>;

/** A sheet of a spreadsheet as read: its name and size. */
export const materialSheetSchema = z.object({
  name: z.string(),
  rows: z.number().int(),
  columns: z.number().int(),
});
export type MaterialSheet = z.infer<typeof materialSheetSchema>;

export const materialSchema = boardFrameSchema.extend({
  id: z.string(),
  deckId: z.string(),
  author: authorSchema,
  name: z.string(),
  kind: z.enum(MATERIAL_KINDS),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  /** `/api/materials/:id/file`: the file as it was put down. */
  url: z.string(),
  /** A small picture (first PDF page, the picture itself); `null` without. */
  previewUrl: z.string().nullable(),
  readState: z.enum(MATERIAL_READ_STATES),
  /** Pages of a PDF or document, slides of a presentation, sheets of a spreadsheet. */
  pages: z.number().int().nullable(),
  sheets: z.array(materialSheetSchema),
  /** Opened up on the board (later: read in place); kept per item. */
  expanded: z.boolean(),
  /** Came from this folder on the board (in it while the folder's `boundIds` hold it). */
  folderId: z.string().nullable(),
  createdAt: z.string(),
});
export type Material = z.infer<typeof materialSchema>;

/**
 * `box`: a box on the board with its (rich) text – holding the things that lie in it
 * (`boundIds`, kept as they are moved in and out), or none; `note`: a text beside one thing
 * (`boundIds` that one: a file, link or folder), no box of its own; `link`: a web address as a
 * card; `folder`: a folder put down (`text` its name, `boundIds` the files in it, shown only when
 * it is opened – a file taken out keeps its `folderId`).
 */
export const BOARD_ITEM_KINDS = ['box', 'note', 'link', 'folder'] as const;
export type BoardItemKind = (typeof BOARD_ITEM_KINDS)[number];

/** Longest note on the board. */
export const MAX_BOARD_NOTE_LENGTH = 10_000;
export const MAX_BOARD_URL_LENGTH = 2048;

/** Largest rich text a sticker keeps (its editor state as JSON). */
export const MAX_BOARD_RICH_BYTES = 200_000;

/**
 * A sticker's rich text: the editor's (Lexical's) serialised state, kept as it is – the server
 * only bounds its size; `text` holds the same as Markdown.
 */
export const boardRichSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= MAX_BOARD_RICH_BYTES,
    'Die Notiz ist zu lang.',
  );

export const boardItemSchema = boardFrameSchema.extend({
  id: z.string(),
  deckId: z.string(),
  author: authorSchema,
  kind: z.enum(BOARD_ITEM_KINDS),
  /** A note's text; a link's title (may be empty). */
  text: z.string(),
  /** A link's address; `null` for a note. */
  url: z.string().nullable(),
  /** What a note hangs on (files, links, notes); empty for one on its own and for links. */
  boundIds: z.array(z.string()),
  /** A note's or frame's colour of its own (the comment colours); `null`: its author's. */
  color: accentColorSchema.nullable(),
  /** A sticker's rich text; `null`: plain `text`. */
  rich: boardRichSchema.nullable(),
  createdAt: z.string(),
});
export type BoardItem = z.infer<typeof boardItemSchema>;

/** Everything on a deck's board. */
export const boardSchema = z.object({
  materials: z.array(materialSchema),
  items: z.array(boardItemSchema),
});
export type Board = z.infer<typeof boardSchema>;

/** A link's address: http(s) only. */
export const boardUrlSchema = z
  .string()
  .trim()
  .max(MAX_BOARD_URL_LENGTH)
  .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), 'Nur http- und https-Links.');

/**
 * A note or link put on the board. `id` is made by the browser (a UUID), so one made offline is
 * known before the server has it; sent again, the one saved first is the answer.
 */
export const createBoardItemInputSchema = boardFrameSchema
  .extend({
    id: z.uuid(),
    kind: z.enum(BOARD_ITEM_KINDS),
    text: z.string().max(MAX_BOARD_NOTE_LENGTH).default(''),
    url: boardUrlSchema.nullable().default(null),
    /** What a note hangs on: files, links or notes of this board. */
    boundIds: z.array(z.string().min(1).max(100)).max(100).default([]),
    color: accentColorSchema.nullable().default(null),
    rich: boardRichSchema.nullable().default(null),
  })
  .refine((input) => input.boundIds.length === 0 || input.kind !== 'link', {
    message: 'Ein Link hält nichts.',
  })
  .refine((input) => input.kind !== 'note' || input.boundIds.length === 1, {
    message: 'Eine Notiz steht neben genau einem Ding.',
  });
export type CreateBoardItemInput = z.input<typeof createBoardItemInputSchema>;

/** A note's text or a link changed (its author only). */
export const updateBoardItemInputSchema = z.object({
  text: z.string().max(MAX_BOARD_NOTE_LENGTH).optional(),
  url: boardUrlSchema.optional(),
  /** What a frame holds now (moved in or out – by anyone who may move things). */
  boundIds: z.array(z.string().min(1).max(100)).max(100).optional(),
  /** Its colour (its author only); `null`: the author's own again. */
  color: accentColorSchema.nullable().optional(),
  /** A sticker's rich text, with `text` as its Markdown (its author only). */
  rich: boardRichSchema.nullable().optional(),
});
export type UpdateBoardItemInput = z.input<typeof updateBoardItemInputSchema>;

/** Items moved or resized together (files, notes and links alike), by id. */
export const moveBoardInputSchema = z.object({
  frames: z
    .array(boardFrameSchema.extend({ id: z.string().min(1).max(100) }))
    .min(1)
    .max(500),
});
export type MoveBoardInput = z.infer<typeof moveBoardInputSchema>;

/**
 * A file put on the board: sent over tus (`purpose material`, `deckId`) and named here by its
 * upload id, or as the multipart field `file` with these fields beside it.
 */
export const addMaterialInputSchema = boardFrameSchema.extend({
  id: z.uuid(),
  upload: z.string().min(1).max(100).optional(),
  /** Put into this folder of the board (one dropped or picked as a folder). */
  folderId: z.string().min(1).max(100).optional(),
});
export type AddMaterialInput = z.infer<typeof addMaterialInputSchema>;

/** Card size a new file gets on the board. */
export const MATERIAL_CARD = { w: 220, h: 200 } as const;
export const BOARD_NOTE = { w: 200, h: 160 } as const;
export const BOARD_LINK = { w: 240, h: 96 } as const;

const EXTENSION_KINDS: Record<string, MaterialKind> = {
  pdf: 'pdf',
  doc: 'document',
  docx: 'document',
  docm: 'document',
  odt: 'document',
  rtf: 'document',
  ppt: 'presentation',
  pptx: 'presentation',
  pptm: 'presentation',
  ppsx: 'presentation',
  odp: 'presentation',
  key: 'presentation',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  svg: 'image',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  json: 'text',
};

/** The file's extension in lower case, `''` without one. */
export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** What a file is by its name – the server checks the bytes again. */
export const materialKindOf = (name: string): MaterialKind =>
  EXTENSION_KINDS[extensionOf(name)] ?? 'other';

/** „2,4 MB“: a file's size for its card. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}
