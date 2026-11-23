import { z } from 'zod';
import { authorSchema, commentReactionSchema } from './model';
import { imageCreditSchema } from './editing';
import { photoProviderSchema } from './integrations';

/*
 * Writer: a document is a real text file (.odt) in the workspace's Cloud – its id is the file's.
 * The browser draws its paragraphs itself and changes them by operations on paragraph ids; the
 * server writes each step into the file (`@slider/odt`), as its next version.
 */

/** Lengths of a page and of a paragraph's look are points (1/72 inch), as CSS `pt`. */
const points = z.number().finite();

/** An id inside the file (`xml:id`, a table's or a picture's name): safe as an XML name. */
export const writerIdSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/);

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A link a document may carry: the web, a mail, a phone number – nothing that runs. */
export const isWriterLink = (href: string): boolean => /^(https?:\/\/|mailto:|tel:)/i.test(href);

export const MAX_PARAGRAPH_TEXT = 20_000;
export const MAX_PARAGRAPH_RUNS = 400;

/** A picture standing in a paragraph. */
export const writerPictureSchema = z.object({
  /** Its part in the file (`Pictures/…`). */
  path: z.string().max(300),
  width: points,
  height: points,
  /** A photo service's photo: who took it, kept in the file as on a slide (`svg:desc`). */
  credit: imageCreditSchema.optional(),
});
export type WriterPicture = z.infer<typeof writerPictureSchema>;

/** The one character a picture standing in a line is in the text: every place counts it as one. */
export const WRITER_PICTURE_CHAR = '\uFFFC';

/** A stretch of text of one look. The marks say how it looks, not how it differs. */
export const writerRunSchema = z.object({
  text: z.string().max(MAX_PARAGRAPH_TEXT),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  /** Its own colour; absent: the paragraph's. */
  color: colorSchema.optional(),
  /** A marker behind it. */
  highlight: colorSchema.optional(),
  link: z.string().max(2000).refine(isWriterLink).optional(),
  /** Its own font (a family's name) and size; absent: the paragraph's. Read from the file, set by hand. */
  font: z.string().max(200).optional(),
  size: points.optional(),
  /** The file's own style of this stretch: kept through an edit, so nothing of it is lost. */
  style: z.string().max(200).optional(),
  /** A picture standing in the line like a letter: the stretch is `WRITER_PICTURE_CHAR` alone. */
  picture: writerPictureSchema.optional(),
});
export type WriterRun = z.infer<typeof writerRunSchema>;

export const WRITER_KINDS = [
  'text',
  'title',
  'subtitle',
  'heading',
  'quote',
  'preformatted',
  'caption',
] as const;
export const writerKindSchema = z.enum(WRITER_KINDS);
export type WriterKind = z.infer<typeof writerKindSchema>;

export const WRITER_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export const writerAlignSchema = z.enum(WRITER_ALIGNS);
export type WriterAlign = z.infer<typeof writerAlignSchema>;

export const MAX_LIST_LEVEL = 8;
/** A list level's step in points (0.75 cm): the marker hangs in it. File and browser draw with the same. */
export const WRITER_LIST_STEP_PT = (0.75 * 72) / 2.54;
export const writerListSchema = z.object({
  kind: z.enum(['bullet', 'number']),
  level: z.number().int().min(0).max(MAX_LIST_LEVEL),
});
export type WriterList = z.infer<typeof writerListSchema>;

/** A line spacing as a factor of the font's own line. */
export const writerLineHeightSchema = z.number().finite().min(0.5).max(4);

/** What a paragraph is, as the editor sets it. */
export const writerParagraphSchema = z
  .object({
    kind: writerKindSchema,
    /** A heading's level, 1–6. */
    level: z.number().int().min(1).max(6).optional(),
    /** Absent: as its format says. */
    align: writerAlignSchema.optional(),
    list: writerListSchema.optional(),
    /** Starts on a new page. */
    breakBefore: z.boolean().optional(),
    /** Its own line spacing, a factor of the font's line (1 = single). Absent: as its format says. */
    lineHeight: writerLineHeightSchema.optional(),
    runs: z.array(writerRunSchema).max(MAX_PARAGRAPH_RUNS),
  })
  .refine(
    (paragraph) =>
      paragraph.runs.reduce((sum, run) => sum + run.text.length, 0) <= MAX_PARAGRAPH_TEXT,
    { message: 'Der Absatz ist zu lang.' },
  );
export type WriterParagraph = z.infer<typeof writerParagraphSchema>;

/** How a paragraph is drawn where its runs say nothing else – read from the file's styles. */
export const writerLookSchema = z.object({
  font: z.string(),
  size: points,
  color: colorSchema,
  bold: z.boolean(),
  italic: z.boolean(),
  /** A factor of the font's own line (1 = single). */
  lineHeight: z.number().finite(),
  spaceBefore: points,
  spaceAfter: points,
  indentLeft: points,
  indentRight: points,
  indentFirst: points,
  align: writerAlignSchema,
});
export type WriterLook = z.infer<typeof writerLookSchema>;

export const writerParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  id: writerIdSchema,
  kind: writerKindSchema,
  level: z.number().int().min(1).max(6).optional(),
  align: writerAlignSchema.optional(),
  list: writerListSchema.optional(),
  breakBefore: z.boolean().optional(),
  /** Its own line spacing; absent: `look.lineHeight`, its format's. */
  lineHeight: writerLineHeightSchema.optional(),
  runs: z.array(writerRunSchema),
  look: writerLookSchema,
  /** Holds what the editor does not write (a field, a note, a frame): shown, not typed in. */
  locked: z.boolean().optional(),
  /** Locked in „Ebenen“ (⇧⌘L): neither typed in, moved nor deleted – see `protectBlock`. */
  protect: z.boolean().optional(),
  /** Pictures in it, in their order. */
  pictures: z.array(writerPictureSchema).optional(),
});
export type WriterParagraphBlock = z.infer<typeof writerParagraphBlockSchema>;

export interface WriterTableCell {
  blocks: WriterParagraphBlock[];
  colSpan?: number | undefined;
  rowSpan?: number | undefined;
}
export interface WriterTableBlock {
  type: 'table';
  id: string;
  /** Each column's share of the width, adding up to 1. */
  columns: number[];
  rows: WriterTableCell[][];
  /** Locked in „Ebenen“ (⇧⌘L): its cells neither typed in nor changed, it not moved or deleted. */
  protect?: boolean;
}
/**
 * Where a table's cells stand. A row holds only the cells that are there – one a neighbour
 * reaches over (`colSpan`, `rowSpan`) is not in it – so a cell's column is counted here:
 * `at[row][index]`. `owner[row][column]` names the cell lying on a place (`null`: none), `whole`
 * says every place has exactly one.
 */
export function writerTableGrid(
  rows: readonly (readonly { colSpan?: number | undefined; rowSpan?: number | undefined }[])[],
): {
  columns: number;
  at: number[][];
  owner: ({ row: number; index: number } | null)[][];
  whole: boolean;
} {
  const owner: ({ row: number; index: number } | null)[][] = rows.map(() => []);
  const at: number[][] = [];
  let columns = 0;
  let whole = true;
  rows.forEach((row, rowIndex) => {
    const taken = owner[rowIndex] ?? [];
    const places: number[] = [];
    let column = 0;
    row.forEach((cell, index) => {
      while (taken[column]) column += 1;
      places.push(column);
      const across = Math.max(1, cell.colSpan ?? 1);
      const down = Math.max(1, cell.rowSpan ?? 1);
      if (rowIndex + down > rows.length) whole = false;
      for (let y = rowIndex; y < Math.min(rows.length, rowIndex + down); y += 1) {
        const line = owner[y] ?? [];
        for (let x = column; x < column + across; x += 1) {
          if (line[x]) whole = false;
          line[x] = { row: rowIndex, index };
        }
      }
      column += across;
    });
    at.push(places);
  });
  for (const line of owner) columns = Math.max(columns, line.length);
  for (const line of owner) {
    for (let x = 0; x < columns; x += 1) {
      if (!line[x]) {
        line[x] = null;
        whole = false;
      }
    }
  }
  return { columns, at, owner, whole };
}

export const writerTableBlockSchema: z.ZodType<WriterTableBlock> = z.object({
  type: z.literal('table'),
  id: writerIdSchema,
  columns: z.array(z.number().finite()),
  rows: z.array(
    z.array(
      z.object({
        blocks: z.array(writerParagraphBlockSchema),
        colSpan: z.number().int().optional(),
        rowSpan: z.number().int().optional(),
      }),
    ),
  ),
  protect: z.boolean().optional(),
});

export const writerBlockSchema = z.union([writerParagraphBlockSchema, writerTableBlockSchema]);
export type WriterBlock = z.infer<typeof writerBlockSchema>;

export const writerPageSchema = z.object({
  width: points.min(72).max(4000),
  height: points.min(72).max(4000),
  marginTop: points.min(0).max(1000),
  marginRight: points.min(0).max(1000),
  marginBottom: points.min(0).max(1000),
  marginLeft: points.min(0).max(1000),
  /** The page's number at its foot. */
  numbers: z.boolean(),
  /** A line of words over every page's text (its head) and under it (its foot, over the number). */
  header: z.string().max(500).optional(),
  footer: z.string().max(500).optional(),
});
export type WriterPage = z.infer<typeof writerPageSchema>;

/** The formats of „Absatzformat“, in its order. */
export const WRITER_FORMATS = [
  'text',
  'title',
  'subtitle',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'quote',
  'preformatted',
  'caption',
] as const;
export type WriterFormat = (typeof WRITER_FORMATS)[number];

/** What of a format's look is set by hand – the fields of `WriterLook`, each on its own. */
export const WRITER_FORMAT_LOOK_KEYS = [
  'font',
  'size',
  'color',
  'bold',
  'italic',
  'lineHeight',
  'spaceBefore',
  'spaceAfter',
] as const;
export const writerFormatLookSchema = z
  .object({
    font: z.string().min(1).max(200),
    size: points.min(1).max(400),
    color: colorSchema,
    bold: z.boolean(),
    italic: z.boolean(),
    lineHeight: writerLineHeightSchema,
    spaceBefore: points.min(0).max(400),
    spaceAfter: points.min(0).max(400),
  })
  .partial();
export type WriterFormatLook = z.infer<typeof writerFormatLookSchema>;
export const writerFormatOf = (paragraph: { kind: WriterKind; level?: number | undefined }) =>
  (paragraph.kind === 'heading'
    ? `heading${Math.min(6, Math.max(1, paragraph.level ?? 1))}`
    : paragraph.kind) as WriterFormat;

export const writerContentSchema = z.object({
  /** The step the file stands at. */
  seq: z.number().int(),
  /** The file's version these blocks were read from. */
  versionId: z.string().nullable(),
  page: writerPageSchema,
  formats: z.record(z.enum(WRITER_FORMATS), writerLookSchema),
  blocks: z.array(writerBlockSchema),
});
export type WriterContent = z.infer<typeof writerContentSchema>;

// ── Operations ──────────────────────────────────────────────────────────────

const place = {
  /** The paragraph or table it comes after … */
  afterId: writerIdSchema.optional(),
  /** … or before (the first of the text, or of a cell). */
  beforeId: writerIdSchema.optional(),
};

export const MAX_TABLE_ROWS = 60;
export const MAX_TABLE_COLUMNS = 12;
/** What a table of a file may hold and still have its cells merged, parted or its rows changed around them. */
export const MAX_TABLE_GRID_ROWS = 500;
export const MAX_TABLE_GRID_COLUMNS = 64;

export const writerOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setParagraph'),
    id: writerIdSchema,
    paragraph: writerParagraphSchema,
  }),
  z.object({
    type: z.literal('insertParagraph'),
    id: writerIdSchema,
    ...place,
    paragraph: writerParagraphSchema,
  }),
  /** A paragraph, a picture's paragraph or a whole table. */
  z.object({ type: z.literal('remove'), id: writerIdSchema }),
  z.object({
    type: z.literal('insertTable'),
    id: writerIdSchema,
    ...place,
    /** The ids of its cells' paragraphs, row by row. */
    cells: z
      .array(z.array(writerIdSchema).min(1).max(MAX_TABLE_COLUMNS))
      .min(1)
      .max(MAX_TABLE_ROWS),
  }),
  z.object({
    type: z.literal('insertRow'),
    tableId: writerIdSchema,
    /** After this row (0-based); -1: first. */
    after: z.number().int().min(-1).max(MAX_TABLE_ROWS),
    cells: z.array(writerIdSchema).min(1).max(MAX_TABLE_COLUMNS),
  }),
  z.object({
    type: z.literal('removeRow'),
    tableId: writerIdSchema,
    row: z.number().int().min(0).max(MAX_TABLE_ROWS),
  }),
  /**
   * The table's cells as they stand now, row by row – cells merged, parted, rows come or gone
   * in a table that has merged cells. A cell names its paragraphs: the ones the table holds move
   * to it as they are, an id it does not know is a new, empty paragraph. A cell reached over by
   * another is not named. A cell none of whose paragraphs is named goes. With `columns` the
   * table has that many columns from now on (one came or went), each with its share of the width.
   */
  z.object({
    type: z.literal('setCells'),
    tableId: writerIdSchema,
    rows: z
      .array(
        z
          .array(
            z.object({
              ids: z.array(writerIdSchema).min(1).max(MAX_PARAGRAPH_RUNS),
              colSpan: z.number().int().min(1).max(MAX_TABLE_GRID_COLUMNS).optional(),
              rowSpan: z.number().int().min(1).max(MAX_TABLE_GRID_ROWS).optional(),
            }),
          )
          .max(MAX_TABLE_GRID_COLUMNS),
      )
      .min(1)
      .max(MAX_TABLE_GRID_ROWS),
    columns: z.array(z.number().finite().positive()).min(1).max(MAX_TABLE_GRID_COLUMNS).optional(),
  }),
  /** Each column's share of the table's width. */
  z.object({
    type: z.literal('setColumns'),
    tableId: writerIdSchema,
    columns: z.array(z.number().finite().positive()).min(1).max(MAX_TABLE_GRID_COLUMNS),
  }),
  /**
   * A block of the text (a paragraph, a picture's, a table) put elsewhere in the text, as it is
   * („Ebenen“). Out of a list it stands on its own; its paragraph is told again where it keeps one.
   */
  z.object({
    type: z.literal('moveBlock'),
    id: writerIdSchema,
    ...place,
  }),
  /**
   * A block of the text locked or unlocked, as a slide's element („Ebenen“, ⇧⌘L): in the file a
   * write-protected section around it (`text:section text:protected`), as LibreOffice protects.
   */
  z.object({
    type: z.literal('protectBlock'),
    id: writerIdSchema,
    protect: z.boolean(),
  }),
  /** A picture already in the file (sent with `…/pictures`), in a paragraph of its own. */
  z.object({
    type: z.literal('insertPicture'),
    id: writerIdSchema,
    ...place,
    picture: writerPictureSchema,
    /** Where it stands across the sheet; absent: as the format for text says. */
    align: writerAlignSchema.optional(),
  }),
  z.object({ type: z.literal('setPage'), page: writerPageSchema }),
  /**
   * A format's own look, for the whole document: what is named changes in the file's style of
   * that format, every paragraph of it follows where it says nothing else itself.
   */
  z.object({
    type: z.literal('setFormatLook'),
    format: z.enum(WRITER_FORMATS),
    look: writerFormatLookSchema,
  }),
]);
export type WriterOperation = z.infer<typeof writerOperationSchema>;

export const MAX_WRITER_OPERATIONS = 200;

export const writerEditInputSchema = z.object({
  operations: z.array(writerOperationSchema).min(1).max(MAX_WRITER_OPERATIONS),
  /** The step the sender had seen. */
  baseSeq: z.number().int().optional(),
  /** Made in the browser: the same edit sent twice is written once. */
  clientEditId: z.string().uuid(),
});
export type WriterEditInput = z.infer<typeof writerEditInputSchema>;

export const writerEditResultSchema = z.object({
  seq: z.number().int(),
  versionId: z.string().nullable(),
  /** Indexes of the operations that no longer fitted the file (their paragraph is gone). */
  dropped: z.array(z.number().int()),
});
export type WriterEditResult = z.infer<typeof writerEditResultSchema>;

// ── Comments ────────────────────────────────────────────────────────────────

/**
 * Where a comment points: a stretch of a paragraph, with its words as they were. With `to` the
 * stretch runs on from `start` through the paragraphs after it, up to `to.offset` in that one.
 */
export const writerAnchorSchema = z.object({
  paragraphId: writerIdSchema,
  start: z.number().int().min(0).max(MAX_PARAGRAPH_TEXT),
  end: z.number().int().min(0).max(MAX_PARAGRAPH_TEXT),
  quote: z.string().max(600),
  to: z
    .object({
      paragraphId: writerIdSchema,
      offset: z.number().int().min(0).max(MAX_PARAGRAPH_TEXT),
    })
    .optional(),
});
export type WriterAnchor = z.infer<typeof writerAnchorSchema>;

export const MAX_WRITER_COMMENT = 8000;

export const writerCommentSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  parentId: z.string().nullable(),
  author: authorSchema,
  body: z.string(),
  /** `null` on an answer: it stands where its comment stands. */
  anchor: writerAnchorSchema.nullable(),
  status: z.enum(['open', 'done']),
  resolvedBy: authorSchema.nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** 👍 / 👎 / egal, one per person – as on a slide's comment. */
  reactions: z.array(commentReactionSchema).optional(),
});
export type WriterComment = z.infer<typeof writerCommentSchema>;

export const createWriterCommentInputSchema = z.object({
  /** Made in the browser, so a comment written offline is sent once. */
  id: z.string().uuid(),
  parentId: z.string().nullable(),
  body: z.string().trim().min(1).max(MAX_WRITER_COMMENT),
  anchor: writerAnchorSchema.nullable(),
});
export type CreateWriterCommentInput = z.infer<typeof createWriterCommentInputSchema>;

export const updateWriterCommentInputSchema = z
  .object({
    body: z.string().trim().min(1).max(MAX_WRITER_COMMENT),
    status: z.enum(['open', 'done']),
  })
  .partial();
export type UpdateWriterCommentInput = z.infer<typeof updateWriterCommentInputSchema>;

/**
 * Where a stretch of a paragraph lies after its text changed: what was typed before it moves
 * it, what was typed in it stretches it. Told by the text's common start and end alone – right
 * for typing, deleting and pasting at one place, which is what a step is.
 */
export function movedRange(
  before: string,
  after: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (before === after) return { start, end };
  const limit = Math.min(before.length, after.length);
  let head = 0;
  while (head < limit && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < limit - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  const oldEnd = before.length - tail;
  const newEnd = after.length - tail;
  const move = (offset: number, edge: 'start' | 'end') => {
    if (offset <= head) return offset;
    if (offset >= oldEnd) return offset + (newEnd - oldEnd);
    return edge === 'start' ? head : newEnd;
  };
  const moved = { start: move(start, 'start'), end: move(end, 'end') };
  return { start: Math.min(moved.start, after.length), end: Math.min(moved.end, after.length) };
}

/**
 * A comment's place after paragraphs changed (`textOf`: a changed paragraph's words before and
 * after, `undefined` for one left alone). The same object when nothing moved.
 */
export function movedAnchor(
  anchor: WriterAnchor,
  textOf: (paragraphId: string) => { before: string; after: string } | undefined,
): WriterAnchor {
  let next = anchor;
  const first = textOf(anchor.paragraphId);
  if (first) {
    // Running on into the next paragraph, the stretch ends where this one ends.
    const moved = movedRange(
      first.before,
      first.after,
      anchor.start,
      anchor.to ? first.before.length : anchor.end,
    );
    const end = anchor.to ? first.after.length : moved.end;
    if (moved.start !== anchor.start || end !== anchor.end) {
      next = { ...next, start: moved.start, end };
    }
  }
  const last = anchor.to ? textOf(anchor.to.paragraphId) : undefined;
  if (anchor.to && last) {
    const offset = movedRange(last.before, last.after, 0, anchor.to.offset).end;
    if (offset !== anchor.to.offset) next = { ...next, to: { ...anchor.to, offset } };
  }
  return next;
}

export const writerText = (paragraph: { runs: readonly { text: string }[] }): string =>
  paragraph.runs.map((run) => run.text).join('');

// ── The document itself ─────────────────────────────────────────────────────

export const writerPermissionsSchema = z.object({
  canEdit: z.boolean(),
  canComment: z.boolean(),
  canManage: z.boolean(),
});
export type WriterPermissions = z.infer<typeof writerPermissionsSchema>;

export const writerDocumentSchema = z.object({
  /** The file's id in Cloud. */
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  fileName: z.string(),
  /** Where it lies („Meine Dateien“, an area, a folder in one). */
  place: z.string(),
  sizeBytes: z.number(),
  pinned: z.boolean().optional(),
  hasThumbnail: z.boolean(),
  versionId: z.string().nullable(),
  openComments: z.number().int(),
  comments: z.number().int(),
  updatedBy: authorSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  permissions: writerPermissionsSchema,
});
export type WriterDocument = z.infer<typeof writerDocumentSchema>;

export const writerOpenedSchema = z.object({
  document: writerDocumentSchema,
  content: writerContentSchema,
});
export type WriterOpened = z.infer<typeof writerOpenedSchema>;

/** The workspace's services the picture panel offers (`GET /documents/:id/tools`), as on a slide. */
export const writerToolsSchema = z.object({
  stockPhotos: z.boolean(),
  photoSource: photoProviderSchema.nullable(),
  imageGeneration: z.boolean(),
});
export type WriterTools = z.infer<typeof writerToolsSchema>;

export const WRITER_TEMPLATES = ['plain', 'letter', 'report', 'minutes'] as const;
export const writerTemplateSchema = z.enum(WRITER_TEMPLATES);
export type WriterTemplate = z.infer<typeof writerTemplateSchema>;

export const createWriterDocumentInputSchema = z.object({
  workspaceId: z.string(),
  title: z.string().trim().min(1).max(200).optional(),
  template: writerTemplateSchema.optional(),
  /** Made from inside a folder or an area (Cloud's „Neu“): it goes there, else „Meine Dateien“. */
  parentId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
});
export type CreateWriterDocumentInput = z.infer<typeof createWriterDocumentInputSchema>;

/** What Writer opens as it is, and what it takes in by making a document of it. */
export const WRITER_EXTENSION = 'odt';
export const WRITER_MIME = 'application/vnd.oasis.opendocument.text';
export const WRITER_IMPORTS = [
  'odt',
  'ott',
  'docx',
  'docm',
  'doc',
  'rtf',
  'txt',
  'md',
  'markdown',
] as const;
export const WRITER_PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_WRITER_PICTURE_BYTES = 20 * 1024 ** 2;

/** What a live connection of a document hears. */
export const writerStepSchema = z.object({
  seq: z.number().int(),
  versionId: z.string().nullable(),
  operations: z.array(writerOperationSchema),
  clientEditId: z.string().nullable(),
  authorId: z.string().nullable(),
});
export type WriterStep = z.infer<typeof writerStepSchema>;

/** Markdown files Writer opens as they are – drawn raw or rendered, never made into a document. */
export const WRITER_MARKDOWN_EXTENSIONS = ['md', 'markdown'] as const;
export const WRITER_MARKDOWN_MIME = 'text/markdown';
export const isWriterMarkdown = (name: string): boolean => /\.(md|markdown)$/i.test(name);
/** Every file Writer opens as it is. */
export const WRITER_OPENS: readonly string[] = [WRITER_EXTENSION, ...WRITER_MARKDOWN_EXTENSIONS];

/** Where someone's caret and selection stand in a document, as they are typing in it; `null`: nowhere. */
export const writerPresenceInputSchema = z.object({
  sel: z
    .object({
      anchor: z.object({ id: writerIdSchema, offset: z.number().int().min(0) }),
      focus: z.object({ id: writerIdSchema, offset: z.number().int().min(0) }),
    })
    .nullable(),
});
export type WriterPresence = z.infer<typeof writerPresenceInputSchema>;
