import { z } from 'zod';

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

export const STROKE_TOOLS = ['pen', 'arrow', 'highlighter'] as const;
export const strokeSchema = z.object({
  tool: z.enum(STROKE_TOOLS),
  color: accentColorSchema,
  points: z.array(pointSchema).min(2).max(2000),
});
export type Stroke = z.infer<typeof strokeSchema>;
export type StrokeTool = Stroke['tool'];

export const commentStatusSchema = z.enum(['open', 'done']);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

export const commentSourceSchema = z.enum(['app', 'pptx']);
export type CommentSource = z.infer<typeof commentSourceSchema>;

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
  status: commentStatusSchema,
  resolvedBy: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  source: commentSourceSchema,
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
