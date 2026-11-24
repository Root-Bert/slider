import { z } from 'zod';
import { attachmentIdsSchema, attachmentSchema } from './attachments';
import { authorSchema } from './model';
import { writerAiStateSchema } from './writer-ai';

/*
 * Reader – PDFs. A PDF is a file in Cloud and stays as it came: nothing is written into it while
 * it is open. What people add lies beside it – comments at a place on a page, what was filled in
 * (the file's own form fields, text, ticks and signatures put on a page) – and is drawn over its
 * pages for everyone at once; printing and exporting bake it into a copy.
 */

export const READER_EXTENSION = 'pdf';
export const READER_MIME = 'application/pdf';
/** The largest PDF Reader opens: the browser holds it whole. */
export const MAX_READER_FILE_BYTES = 200 * 1024 ** 2;

/** A stretch of a page as fractions of its width and height, from its top left corner. */
export const readerRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type ReaderRect = z.infer<typeof readerRectSchema>;

export const readerPermissionsSchema = z.object({
  /** Fill in, sign: who may change the file in Cloud. */
  canEdit: z.boolean(),
  canComment: z.boolean(),
  canManage: z.boolean(),
});
export type ReaderPermissions = z.infer<typeof readerPermissionsSchema>;

export const readerPdfSchema = z.object({
  /** The file's id in Cloud. */
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  fileName: z.string(),
  /** Where it lies („Meine Dateien“, an area, a folder in one). */
  place: z.string(),
  sizeBytes: z.number(),
  hasThumbnail: z.boolean(),
  versionId: z.string().nullable(),
  openComments: z.number().int(),
  comments: z.number().int(),
  /** Fields filled, texts, ticks and signatures put on it. */
  filled: z.number().int(),
  updatedBy: authorSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  permissions: readerPermissionsSchema,
});
export type ReaderPdf = z.infer<typeof readerPdfSchema>;

// ── What is filled in ───────────────────────────────────────────────────────

export const MAX_READER_MARKS = 2000;
export const MAX_READER_MARK_TEXT = 5000;
/** A signature is a small picture: a PNG as a data URL. */
export const MAX_READER_SIGNATURE_CHARS = 400_000;
export const READER_SIGNATURE_PREFIX = 'data:image/png;base64,';

export const readerMarkIdSchema = z
  .string()
  .min(1)
  .max(600)
  .regex(/^[^\s]/);

const signatureImageSchema = z
  .string()
  .max(MAX_READER_SIGNATURE_CHARS)
  .refine((value) => value.startsWith(READER_SIGNATURE_PREFIX), 'Eine Unterschrift ist ein Bild.');

/**
 * One thing filled in. `field`: a form field of the file, by its name (`id` is `field:<name>`),
 * a text or whether it is ticked or which choice is picked. The others lie on a page where they
 * were put: `text` typed there, `check` a tick, `signature` a signature's picture.
 */
export const readerMarkBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('field'),
    page: z.number().int().min(0).max(100_000),
    name: z.string().min(1).max(500),
    value: z.union([z.string().max(MAX_READER_MARK_TEXT), z.boolean()]),
  }),
  z.object({
    kind: z.literal('text'),
    page: z.number().int().min(0).max(100_000),
    rect: readerRectSchema,
    text: z.string().max(MAX_READER_MARK_TEXT),
    /** In points of the page. */
    size: z.number().min(6).max(72),
  }),
  z.object({
    kind: z.literal('check'),
    page: z.number().int().min(0).max(100_000),
    rect: readerRectSchema,
  }),
  z.object({
    kind: z.literal('signature'),
    page: z.number().int().min(0).max(100_000),
    rect: readerRectSchema,
    image: signatureImageSchema,
  }),
]);
export type ReaderMarkBody = z.infer<typeof readerMarkBodySchema>;

export const readerMarkSchema = z.intersection(
  readerMarkBodySchema,
  z.object({
    id: readerMarkIdSchema,
    author: authorSchema.nullable(),
    updatedAt: z.iso.datetime(),
  }),
);
export type ReaderMark = z.infer<typeof readerMarkSchema>;

/** A form field's mark id: one per field and PDF, whoever fills it. */
export const readerFieldMarkId = (name: string) => `field:${name}`;

export const readerOpenedSchema = z.object({
  pdf: readerPdfSchema,
  marks: z.array(readerMarkSchema),
});
export type ReaderOpened = z.infer<typeof readerOpenedSchema>;

// ── Signatures one keeps ────────────────────────────────────────────────────

export const MAX_READER_SIGNATURES = 6;

export const readerSignatureSchema = z.object({
  id: z.string(),
  image: z.string(),
  /** Its picture's size in px, to put it on a page in its shape. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type ReaderSignature = z.infer<typeof readerSignatureSchema>;

export const createReaderSignatureInputSchema = z.object({
  image: signatureImageSchema,
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
});
export type CreateReaderSignatureInput = z.infer<typeof createReaderSignatureInputSchema>;

// ── Comments ────────────────────────────────────────────────────────────────

/**
 * Where a comment points: a page, and on it a stretch (a box drawn, or the box round the words
 * picked – their lines in `rects`, their words in `quote`). Without `rect` it is the whole page.
 */
export const readerAnchorSchema = z.object({
  page: z.number().int().min(0).max(100_000),
  rect: readerRectSchema.optional(),
  rects: z.array(readerRectSchema).max(60).optional(),
  quote: z.string().max(600).optional(),
});
export type ReaderAnchor = z.infer<typeof readerAnchorSchema>;

export const MAX_READER_COMMENT = 8000;

export const readerCommentSchema = z.object({
  id: z.string(),
  pdfId: z.string(),
  parentId: z.string().nullable(),
  author: authorSchema,
  body: z.string(),
  /** Files put on it. */
  attachments: z.array(attachmentSchema).optional(),
  /** `null` on an answer: it stands where its comment stands. */
  anchor: readerAnchorSchema.nullable(),
  status: z.enum(['open', 'done']),
  resolvedBy: authorSchema.nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ReaderComment = z.infer<typeof readerCommentSchema>;

export const createReaderCommentInputSchema = z.object({
  /** Made in the browser, so a comment written offline is sent once. */
  id: z.string().uuid(),
  parentId: z.string().nullable(),
  /** May stay empty where files are put on it. */
  body: z.string().trim().max(MAX_READER_COMMENT),
  /** Files put on it (`attachments`). */
  attachments: attachmentIdsSchema,
  anchor: readerAnchorSchema.nullable(),
});
export type CreateReaderCommentInput = z.input<typeof createReaderCommentInputSchema>;

export const updateReaderCommentInputSchema = z
  .object({
    body: z.string().trim().min(1).max(MAX_READER_COMMENT),
    status: z.enum(['open', 'done']),
  })
  .partial();
export type UpdateReaderCommentInput = z.infer<typeof updateReaderCommentInputSchema>;

// ── The AI ──────────────────────────────────────────────────────────────────

/**
 * A comment handed to the AI: it reads the PDF's text and its form fields and answers under the
 * comment – or fills fields in (`applied`), taken back and filled again from its card.
 */
export const readerAiProposalSchema = z.object({
  id: z.string(),
  pdfId: z.string(),
  commentId: z.string(),
  author: authorSchema,
  status: writerAiStateSchema,
  summary: z.string(),
  error: z.string().nullable(),
  /** How many fields it filled. */
  filled: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ReaderAiProposal = z.infer<typeof readerAiProposalSchema>;

/** A form field as the browser read it from the file – what the AI may fill. */
export const readerFieldSchema = z.object({
  name: z.string().min(1).max(500),
  page: z.number().int().min(0).max(100_000),
  type: z.enum(['text', 'checkbox', 'radio', 'choice']),
  /** What it is called beside it or in its tooltip, if the file says. */
  label: z.string().max(300).optional(),
  options: z.array(z.string().max(300)).max(200).optional(),
});
export type ReaderField = z.infer<typeof readerFieldSchema>;

export const createReaderAiProposalInputSchema = z.object({
  /** Made in the browser: asked twice is asked once. */
  id: z.string().uuid(),
  commentId: z.string().min(1).max(100),
  /** The file's form fields, as the browser read them. */
  fields: z.array(readerFieldSchema).max(1000).default([]),
});
export type CreateReaderAiProposalInput = z.input<typeof createReaderAiProposalInputSchema>;

/** What a live connection of a PDF hears. */
export type ReaderEvent =
  | { type: 'mark'; mark: ReaderMark }
  | { type: 'unmark'; id: string; authorId: string | null }
  | { type: 'comments' }
  | { type: 'people'; people: z.infer<typeof authorSchema>[] };
