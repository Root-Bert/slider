import { z } from 'zod';
import { deckSyncSchema, slideChangeSchema } from './sync';

/**
 * Domain model shared by API and web (BER-90).
 * Zod schemas are the single source of truth; TypeScript types are inferred from them.
 */

// ── Geometry ────────────────────────────────────────────────────────────────

const unit = z.number().min(0).max(1);

export const pointSchema = z.object({ x: unit, y: unit });
export const rectSchema = z.object({ x: unit, y: unit, w: unit, h: unit });

// ── People ──────────────────────────────────────────────────────────────────

/** Each reviewer gets a default accent colour for pins, lines and drawings (BER-99). */
export const ACCENT_COLORS = ['red', 'blue', 'violet', 'yellow'] as const;
export const accentColorSchema = z.enum(ACCENT_COLORS);
export type AccentColor = z.infer<typeof accentColorSchema>;

export const authorTypeSchema = z.enum(['owner', 'guest', 'external']);
export type AuthorType = z.infer<typeof authorTypeSchema>;

export const authorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: authorTypeSchema,
  color: accentColorSchema,
  avatarUrl: z.string().nullable(),
});
export type Author = z.infer<typeof authorSchema>;

// ── Decks, revisions, slides ────────────────────────────────────────────────

export const deckSourceSchema = z.enum(['onedrive', 'sharepoint', 'url', 'upload']);
export type DeckSource = z.infer<typeof deckSourceSchema>;

/** Import pipeline steps, in order (BER-97). */
export const IMPORT_STEPS = ['received', 'parsing', 'rendering', 'comments'] as const;
export const importStepSchema = z.enum(IMPORT_STEPS);
export type ImportStep = z.infer<typeof importStepSchema>;

export const importStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('queued') }),
  z.object({
    status: z.literal('running'),
    step: importStepSchema,
    progress: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
  }),
  z.object({ status: z.literal('ready') }),
  z.object({ status: z.literal('failed'), error: z.string() }),
]);
export type ImportState = z.infer<typeof importStateSchema>;

export const deckSchema = z.object({
  id: z.string(),
  title: z.string(),
  fileName: z.string(),
  source: deckSourceSchema,
  owner: authorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  revisionNumber: z.number().int(),
  slideCount: z.number().int(),
  openCommentCount: z.number().int(),
  thumbnailUrl: z.string().nullable(),
  participants: z.array(authorSchema),
  import: importStateSchema,
  /** The revision the slides belong to (BER-107). Optional for older API versions. */
  currentRevisionId: z.string().nullable().optional(),
  /** Automatic update state of link imports (BER-107). */
  sync: deckSyncSchema.optional(),
});
export type Deck = z.infer<typeof deckSchema>;

/** A shape found by the PPTX parser, used to attach anchors to objects (BER-93, BER-98). */
export const shapeSchema = z.object({
  /** `p:cNvPr/@id` – stable within a slide. */
  id: z.string(),
  name: z.string(),
  bbox: rectSchema,
  text: z.string(),
});
export type Shape = z.infer<typeof shapeSchema>;

/** A slide as seen in the current revision. `id` is Slider's stable slide id, never its number. */
export const slideSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  position: z.number().int(),
  title: z.string().nullable(),
  hidden: z.boolean(),
  aspectRatio: z.number().positive(),
  imageUrl: z.string(),
  thumbnailUrl: z.string(),
  shapes: z.array(shapeSchema),
  openCommentCount: z.number().int(),
  /** How the slide changed against the previous revision (BER-108); `null` in revision 1. */
  change: slideChangeSchema.nullable().optional(),
});
export type Slide = z.infer<typeof slideSchema>;

// ── Comments ────────────────────────────────────────────────────────────────

export const shapeRefSchema = z.object({ shapeId: z.string(), offset: pointSchema });
export type ShapeRef = z.infer<typeof shapeRefSchema>;

export const anchorSchema = z.discriminatedUnion('type', [
  /** Comment about the slide as a whole. */
  z.object({ type: z.literal('slide') }),
  z.object({ type: z.literal('point'), point: pointSchema, shapeRef: shapeRefSchema.nullable() }),
  z.object({ type: z.literal('rect'), rect: rectSchema, shapeRef: shapeRefSchema.nullable() }),
  /** "A slide is missing here" – sits between two slides (BER-103). */
  z.object({
    type: z.literal('gap'),
    afterSlideId: z.string().nullable(),
    beforeSlideId: z.string().nullable(),
  }),
]);
export type Anchor = z.infer<typeof anchorSchema>;
export type AnchorType = Anchor['type'];

/**
 * Drawn strokes: freehand, arrow and marker follow their points; `rect` and `ellipse` are shapes
 * spanned by their first and last point (two opposite corners of the bounding box).
 */
export const PATH_STROKE_TOOLS = ['pen', 'arrow', 'highlighter', 'rect', 'ellipse'] as const;
export const pathStrokeSchema = z.object({
  tool: z.enum(PATH_STROKE_TOOLS),
  color: accentColorSchema,
  points: z.array(pointSchema).min(2).max(2000),
});
export type PathStroke = z.infer<typeof pathStrokeSchema>;
export type PathStrokeTool = PathStroke['tool'];

/** Relative font size of on-slide text: a fraction of the slide height. */
export const TEXT_FONT_SIZE = { min: 0.01, max: 0.2, default: 0.04 } as const;
export const MAX_TEXT_ANNOTATION_LENGTH = 2000;
/** Tolerance for rounding when checking that a text box stays on the slide. */
const RECT_EPSILON = 1e-6;

/**
 * Text written directly on the slide ("Text auf Folie"). The box is normalised to the slide
 * (`x`/`y` top-left, `w`/`h` size); `fontSize` is relative to the slide height, so the text keeps
 * its proportions at every slide size. The comment body carries the same text.
 */
export const textStrokeSchema = z
  .object({
    tool: z.literal('text'),
    color: accentColorSchema,
    x: unit,
    y: unit,
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
    text: z.string().trim().min(1).max(MAX_TEXT_ANNOTATION_LENGTH),
    fontSize: z.number().min(TEXT_FONT_SIZE.min).max(TEXT_FONT_SIZE.max),
  })
  .refine((box) => box.x + box.w <= 1 + RECT_EPSILON && box.y + box.h <= 1 + RECT_EPSILON, {
    message: 'Das Textfeld muss auf der Folie liegen.',
  });
export type TextStroke = z.infer<typeof textStrokeSchema>;

/** Everything drawn or written on a slide as part of a comment (BER-99). */
export const STROKE_TOOLS = [...PATH_STROKE_TOOLS, 'text'] as const;
export const strokeSchema = z.union([pathStrokeSchema, textStrokeSchema]);
export type Stroke = z.infer<typeof strokeSchema>;
export type StrokeTool = Stroke['tool'];

export const isTextStroke = (stroke: Stroke): stroke is TextStroke => stroke.tool === 'text';
export const isPathStroke = (stroke: Stroke): stroke is PathStroke => stroke.tool !== 'text';

export const commentStatusSchema = z.enum(['open', 'done']);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

export const commentSourceSchema = z.enum(['app', 'pptx']);
export type CommentSource = z.infer<typeof commentSourceSchema>;

/** `removed_in_pptx`: an imported PowerPoint comment that was deleted in the file (BER-114). */
export const commentSourceStatusSchema = z.enum(['present', 'removed_in_pptx']);
export type CommentSourceStatus = z.infer<typeof commentSourceStatusSchema>;

// ── Voice and video (BER-116) ───────────────────────────────────────────────

export const MEDIA_KINDS = ['audio', 'video'] as const;
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/** Bars of the audio waveform stored with a recording (0–1, drawn as the player's scrubber). */
export const MAX_MEDIA_PEAKS = 64;

/**
 * Transcripts are made on the recording device (Whisper in the browser) and arrive after the
 * comment: `pending` until then, `failed` if the device could not transcribe.
 */
export const transcriptStatusSchema = z.enum(['pending', 'done', 'failed']);
export type TranscriptStatus = z.infer<typeof transcriptStatusSchema>;

export const commentMediaSchema = z.object({
  id: z.string(),
  kind: mediaKindSchema,
  /** Streams through the API with a permission check (`/api/media/:id`), supports Range. */
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  durationMs: z.number().int(),
  peaks: z.array(z.number().min(0).max(1)).max(MAX_MEDIA_PEAKS),
  transcript: z.string().nullable(),
  transcriptStatus: transcriptStatusSchema,
});
export type CommentMedia = z.infer<typeof commentMediaSchema>;

export const commentSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  /** `null` for gap comments. */
  slideId: z.string().nullable(),
  parentId: z.string().nullable(),
  author: authorSchema,
  body: z.string(),
  anchor: anchorSchema,
  strokes: z.array(strokeSchema),
  /** A voice or video recording (BER-116); `null` for text comments. */
  media: commentMediaSchema.nullable(),
  status: commentStatusSchema,
  resolvedBy: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  source: commentSourceSchema,
  /** Whether the comment still exists in the PowerPoint file; always `present` for app comments. */
  sourceStatus: commentSourceStatusSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Comment = z.infer<typeof commentSchema>;

// ── Sharing ─────────────────────────────────────────────────────────────────

export const reviewLinkRoleSchema = z.enum(['view', 'comment']);
export type ReviewLinkRole = z.infer<typeof reviewLinkRoleSchema>;

export const reviewLinkSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  token: z.string(),
  role: reviewLinkRoleSchema,
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReviewLink = z.infer<typeof reviewLinkSchema>;

/** Who is making a request: the deck owner or a guest who joined through a review link. */
export const viewerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner'), author: authorSchema }),
  z.object({
    kind: z.literal('guest'),
    author: authorSchema,
    deckId: z.string(),
    role: reviewLinkRoleSchema,
  }),
]);
export type Viewer = z.infer<typeof viewerSchema>;
