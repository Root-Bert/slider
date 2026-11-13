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
/** Ordered by hue; picked so every pair (and PowerPoint orange) stays as far apart as possible. */
export const ACCENT_COLORS = ['red', 'yellow', 'green', 'cyan', 'blue', 'violet'] as const;
export const accentColorSchema = z.enum(ACCENT_COLORS);
export type AccentColor = z.infer<typeof accentColorSchema>;

/**
 * Colours an author can show in: an accent, PowerPoint orange for whoever commented in the
 * file without being matched to a Slider account, or grey for a deleted account. Nobody picks
 * orange or grey.
 */
export const AUTHOR_COLORS = [...ACCENT_COLORS, 'powerpoint', 'deleted'] as const;
export const authorColorSchema = z.enum(AUTHOR_COLORS);
export type AuthorColor = z.infer<typeof authorColorSchema>;

/**
 * `owner`: someone with a Slider account (possibly no longer a member); `external`: PowerPoint;
 * `deleted`: an account that was deleted – its comments stay, without name or avatar (BER-145);
 * `ai`: the AI, for comments it leaves where it noticed something on its own.
 */
export const authorTypeSchema = z.enum(['owner', 'external', 'deleted', 'ai']);
export type AuthorType = z.infer<typeof authorTypeSchema>;

export const authorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: authorTypeSchema,
  color: authorColorSchema,
});
export type Author = z.infer<typeof authorSchema>;

/** What the AI is called until a workspace admin names it. */
export const DEFAULT_AI_NAME = 'KI';

/** The AI as the author of its own comments – grey like no person, never mentionable. */
export const AI_AUTHOR: Author = { id: 'ai', name: DEFAULT_AI_NAME, type: 'ai', color: 'deleted' };

/** The AI under the name its workspace gave it. */
export const aiAuthor = (name: string | null | undefined): Author => ({
  ...AI_AUTHOR,
  name: name || DEFAULT_AI_NAME,
});

/** What comments and @mentions of a deleted account show instead of the name (BER-145). */
export const DELETED_ACCOUNT_NAME = 'Gelöschtes Konto';

/** An author with a Slider account: always in a colour they picked. */
export const accountAuthorSchema = authorSchema.extend({
  type: z.literal('owner'),
  color: accentColorSchema,
});
export type AccountAuthor = z.infer<typeof accountAuthorSchema>;

// ── Decks, revisions, slides ────────────────────────────────────────────────

export const deckSourceSchema = z.enum([
  'onedrive',
  'sharepoint',
  'nextcloud',
  'google',
  'url',
  'upload',
]);
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

// ── Workspaces and rights (BER-129) ─────────────────────────────────────────

/**
 * Role in a workspace, strongest first. `viewer` only looks (people a deck was shared with);
 * `reviewer` views and comments; `member` also creates
 * decks and manages its own; `admin` may do everything: every deck, members, invites, renaming
 * and deleting the workspace. Who founded it (its creator) is no role but a fact – see
 * `WorkspaceMember.isCreator`.
 */
export const WORKSPACE_ROLES = ['admin', 'member', 'reviewer', 'viewer'] as const;
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** What the caller may do with a deck – the web app shows/hides actions from this, not from `viewer.kind`. */
export const deckPermissionsSchema = z.object({
  /** Rename, archive, delete, share (review links), new versions, sync, delete any comment. */
  canManage: z.boolean(),
  /** Write comments and replies, resolve threads. */
  canComment: z.boolean(),
});
export type DeckPermissions = z.infer<typeof deckPermissionsSchema>;

/** Who drew a slide's picture: Office's or LibreOffice's PDF, the SVG preview, or the PDF it came as. */
export const slideRendererSchema = z.enum(['office', 'libreoffice', 'svg', 'pdf']);
export type SlideRenderer = z.infer<typeof slideRendererSchema>;

/**
 * A PowerPoint drawing guide ("Führungslinie"): a horizontal line at `position` = y, or a
 * vertical one at `position` = x, normalised to the slide. From the presentation, its slide
 * master or the slide's layout.
 */
export const guideSchema = z.object({
  orientation: z.enum(['horizontal', 'vertical']),
  position: unit,
});
export type Guide = z.infer<typeof guideSchema>;

/** What a placeholder of a layout holds: a title, subtitle or text to type, or a picture. */
export const templatePlaceholderKindSchema = z.enum(['title', 'subtitle', 'outline', 'picture']);
export type TemplatePlaceholderKind = z.infer<typeof templatePlaceholderKindSchema>;

/** Guides a template may have. */
export const TEMPLATE_MAX_GUIDES = 40;
/** Named layouts and marked placeholders a template may have (each a map by id). */
export const TEMPLATE_MAX_ENTRIES = 10_000;

/** A map by page or element id, bounded: it is stored with the deck and sent with it. */
const templateMap = <T extends z.ZodType>(value: T) =>
  z
    .record(z.string().max(200), value)
    .refine((map) => Object.keys(map).length <= TEMPLATE_MAX_ENTRIES, {
      message: `At most ${TEMPLATE_MAX_ENTRIES} entries`,
    });

/** Columns or rows a layout grid may have. */
export const LAYOUT_GRID_MAX_TRACKS = 24;

/**
 * One direction of a layout grid („Layout-Ansicht“, as in Figma): `count` columns (or rows) of
 * equal size, `gutter` between them and `margin` before the first and after the last – both in
 * cm. `count` 0: none that way.
 */
export const layoutGridAxisSchema = z.object({
  count: z.number().int().min(0).max(LAYOUT_GRID_MAX_TRACKS),
  gutter: z.number().min(0).max(100),
  margin: z.number().min(0).max(100),
});
export type LayoutGridAxis = z.infer<typeof layoutGridAxisSchema>;

/** A template's layout grid: its columns and its rows. */
export const layoutGridSchema = z.object({
  columns: layoutGridAxisSchema,
  rows: layoutGridAxisSchema,
});
export type LayoutGrid = z.infer<typeof layoutGridSchema>;

/** Colours a template may set, and colours a deck may keep of its own. */
export const PALETTE_MAX_COLORS = 24;

/** A colour as `#rrggbb` – what the colour pickers take. */
export const paletteHexSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Farbe als #rrggbb.');

/** One of a template's colours: its value and, if given, what it is for („Primär“, „Text“). */
export const templateColorSchema = z.object({
  color: paletteHexSchema,
  name: z.string().max(60),
});
export type TemplateColor = z.infer<typeof templateColorSchema>;

export const templateColorsSchema = z.array(templateColorSchema).max(PALETTE_MAX_COLORS);

/** A deck's own colours beside its template's („Eigene“ in the colour pickers). */
export const customColorsSchema = z.array(paletteHexSchema).max(PALETTE_MAX_COLORS);

/**
 * The colours a deck's pickers offer: its template's – `null` when it has none, then the
 * pickers offer a few general ones – and the deck's own.
 */
export const deckColorsSchema = z.object({
  template: templateColorsSchema.nullable(),
  custom: customColorsSchema,
});
export type DeckColors = z.infer<typeof deckColorsSchema>;

/**
 * A template being designed in the editor (`Deck.template`): each slide is a layout. What the
 * file cannot say yet – the layouts’ names and guides (by page id), which elements are
 * placeholders (by element id) – until it is saved to the library as a template (`masterId`).
 */
export const deckTemplateSchema = z.object({
  layoutNames: templateMap(z.string().max(100)),
  placeholders: templateMap(templatePlaceholderKindSchema),
  /**
   * The guides of the layouts without their own in `layoutGuides` ({@link layoutGuidesOf}):
   * templates from before each layout had its own shared these; once one layout's guides change,
   * every layout has its own and this is empty.
   */
  guides: z.array(guideSchema).max(TEMPLATE_MAX_GUIDES),
  /** Each layout's own guides, by page id; missing in templates from before. */
  layoutGuides: templateMap(z.array(guideSchema).max(TEMPLATE_MAX_GUIDES)).optional(),
  /** Its layout grid; missing in templates begun before there was one. */
  grid: layoutGridSchema.optional(),
  /** Its colours – the only ones decks made from it offer; missing in templates from before. */
  colors: templateColorsSchema.optional(),
  /** The template in the library it was saved as; `null` = not yet. */
  masterId: z.string().nullable(),
  /** When it was last saved to the library. */
  savedAt: z.iso.datetime().nullable(),
});
export type DeckTemplate = z.infer<typeof deckTemplateSchema>;

/** The guides of a template's layout (by its page id): its own, else the template's shared ones. */
export function layoutGuidesOf(
  template: Pick<DeckTemplate, 'guides' | 'layoutGuides'>,
  pageId: string | null,
): Guide[] {
  return (pageId === null ? undefined : template.layoutGuides?.[pageId]) ?? template.guides;
}

/**
 * The change that gives a template's layout `pageId` the guides `next`: every other layout of
 * `pageIds` that still shared the template's guides keeps them as its own, so changing one
 * layout's guides changes no other.
 */
export function withLayoutGuides(
  template: Pick<DeckTemplate, 'guides' | 'layoutGuides'>,
  pageIds: readonly string[],
  pageId: string,
  next: Guide[],
): Pick<DeckTemplate, 'guides' | 'layoutGuides'> {
  const layoutGuides: Record<string, Guide[]> = { ...template.layoutGuides };
  if (template.guides.length > 0) {
    for (const id of pageIds) layoutGuides[id] ??= template.guides;
  }
  layoutGuides[pageId] = next;
  return { guides: [], layoutGuides };
}

/**
 * A template's guides once layouts were added: each of `added` (its page id → the layout it is a
 * copy of, `null`: a new, empty one) gets the guides of the layout it copies, a new one none; the
 * layouts of `kept` that still shared the template's guides keep them as their own. One that has
 * guides of its own already (back by undo) keeps them. `null`: nothing changes.
 */
export function withAddedLayouts(
  template: Pick<DeckTemplate, 'guides' | 'layoutGuides'>,
  kept: readonly string[],
  added: ReadonlyMap<string, string | null>,
): Pick<DeckTemplate, 'guides' | 'layoutGuides'> | null {
  const missing = [...added].filter(([pageId]) => !template.layoutGuides?.[pageId]);
  const shared = template.guides.length > 0;
  // Without shared guides a new layout has none anyway.
  if (!missing.some(([, copyOf]) => shared || copyOf !== null)) return null;
  const layoutGuides: Record<string, Guide[]> = { ...template.layoutGuides };
  if (shared) for (const id of kept) layoutGuides[id] ??= template.guides;
  for (const [pageId, copyOf] of missing) {
    layoutGuides[pageId] = copyOf === null ? [] : (layoutGuides[copyOf] ?? template.guides);
  }
  return { guides: [], layoutGuides };
}

/** `PATCH /decks/:id/template`: what changes of a template being designed. */
export const updateDeckTemplateInputSchema = deckTemplateSchema
  .pick({
    layoutNames: true,
    placeholders: true,
    guides: true,
    layoutGuides: true,
    grid: true,
    colors: true,
  })
  .partial();
export type UpdateDeckTemplateInput = z.infer<typeof updateDeckTemplateInputSchema>;

export const deckSchema = z.object({
  id: z.string(),
  /** The workspace the deck belongs to (BER-129). */
  workspaceId: z.string(),
  title: z.string(),
  fileName: z.string(),
  source: deckSourceSchema,
  owner: authorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
  revisionNumber: z.number().int(),
  /** Visible slides of the current revision – hidden ones (PowerPoint "Folie ausblenden") don't count. */
  slideCount: z.number().int(),
  openCommentCount: z.number().int(),
  thumbnailUrl: z.string().nullable(),
  /**
   * Who drew the thumbnail slide: LibreOffice, a PDF's own page or the built-in SVG preview
   * (`office`: decks drawn by Office before Slider stopped asking it). `null` when unknown.
   * Optional for older API versions.
   */
  thumbnailRenderer: slideRendererSchema.nullable().optional(),
  participants: z.array(authorSchema),
  /**
   * The workspace's AI: the name its admins gave it, and whether a working key is set – then it
   * shows among the participants. Optional for older API versions.
   */
  ai: z.object({ name: z.string(), available: z.boolean() }).optional(),
  import: importStateSchema,
  /** The revision the slides belong to (BER-107). Optional for older API versions. */
  currentRevisionId: z.string().nullable().optional(),
  /** Automatic update state of link imports (BER-107). */
  sync: deckSyncSchema.optional(),
  /** The caller's rights on this deck (BER-129). */
  permissions: deckPermissionsSchema,
  /** The folder the deck is sorted into; `null` = none. Optional for older API versions. */
  folderId: z.string().nullable().optional(),
  /** Only selected accounts may open it (see `deckAccessSchema`). Optional for older API versions. */
  restricted: z.boolean().optional(),
  /**
   * A template being designed, no review: its slides are the layouts. `null` for every review.
   * Optional for older API versions.
   */
  template: deckTemplateSchema.nullable().optional(),
  /** What its colour pickers offer. Optional for older API versions. */
  colors: deckColorsSchema.optional(),
  /**
   * „Layout-Ansicht“ of a review: the layout grid of the template it is made from, where that was
   * designed in Slider and has one; `null` – the standard grid. A template has its own in
   * `template.grid`. Optional for older API versions.
   */
  grid: layoutGridSchema.nullable().optional(),
});
export type Deck = z.infer<typeof deckSchema>;

/** A folder of a workspace to sort its decks into (one level, shared by all members). */
export const deckFolderSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type DeckFolder = z.infer<typeof deckFolderSchema>;

/** A shape found by the PPTX parser, used to attach anchors to objects (BER-93, BER-98). */
export const shapeSchema = z.object({
  /** `p:cNvPr/@id` – stable within a slide. */
  id: z.string(),
  name: z.string(),
  /** Where it lies – before it is turned and tilted, around the box's centre. */
  bbox: rectSchema,
  text: z.string(),
  /** Turned clockwise by this many degrees as seen (ODP elements). */
  rotation: z.number().optional(),
  /** Tilted in depth, degrees: its top away (`x`), its right side away (`y`) (ODP elements). */
  tilt: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type Shape = z.infer<typeof shapeSchema>;

/**
 * How a slide comes in when presenting – the few transitions LibreOffice and PowerPoint play
 * alike, and `morph`: Slider's own (elements of the slide before glide to their place on this
 * one), in the file a crossfade, which is what LibreOffice and PowerPoint play.
 */
export const slideTransitionSchema = z.enum([
  'none',
  'fade',
  'fadeBlack',
  'push',
  'cover',
  'wipe',
  'dissolve',
  'zoom',
  'morph',
]);
export type SlideTransition = z.infer<typeof slideTransitionSchema>;

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
  /** Drawing guides of the slide; optional for older API versions. */
  guides: z.array(guideSchema).optional(),
  openCommentCount: z.number().int(),
  /** How the slide changed against the previous revision (BER-108); `null` in revision 1. */
  change: slideChangeSchema.nullable().optional(),
  /**
   * A variant of another slide (made in Slider's editor): that slide's id – it shows above it, not
   * in the deck. `null` (or missing in older API versions) for every other slide.
   */
  variantOf: z.string().nullable().optional(),
  /**
   * How it comes in when presenting; `null` (or missing in older API versions): without one, or
   * one Slider does not play.
   */
  transition: slideTransitionSchema.nullable().optional(),
});
export type Slide = z.infer<typeof slideSchema>;

// ── Comments ────────────────────────────────────────────────────────────────

/**
 * Ties an anchor to a PowerPoint shape so it follows the shape across revisions (BER-111).
 * `offset`: the point (a box's centre) relative to the shape's bounds. `size`: a box's size
 * relative to them, so it also grows and shrinks with the shape – boxes without it (older ones)
 * only move along. `name` and `bbox`: the shape as it was when bound, so a shape that merely
 * inherited the id (producers like Google Slides renumber them) is not mistaken for it; older
 * references without them trust the id alone.
 */
export const shapeRefSchema = z.object({
  shapeId: z.string(),
  offset: pointSchema,
  size: z.object({ w: z.number().positive(), h: z.number().positive() }).optional(),
  name: z.string().optional(),
  bbox: rectSchema.optional(),
});
export type ShapeRef = z.infer<typeof shapeRefSchema>;

/** A box a comment marks: an area, bound to a PowerPoint shape or free. */
export const anchorBoxSchema = z.object({
  rect: rectSchema,
  shapeRef: shapeRefSchema.nullable(),
});
export type AnchorBox = z.infer<typeof anchorBoxSchema>;

/** How many boxes one comment may mark at most (its own and `more`). */
export const MAX_ANCHOR_BOXES = 50;

export const anchorSchema = z.discriminatedUnion('type', [
  /** Comment about the slide as a whole. */
  z.object({ type: z.literal('slide') }),
  z.object({ type: z.literal('point'), point: pointSchema, shapeRef: shapeRefSchema.nullable() }),
  z.object({
    type: z.literal('rect'),
    rect: rectSchema,
    shapeRef: shapeRefSchema.nullable(),
    /**
     * Further boxes the same comment is about (several boxes picked with ⇧/⌘ in box mode): one
     * comment, n boxes. `rect`/`shapeRef` stay the first one – badge, line and composer go there.
     */
    more: z
      .array(anchorBoxSchema)
      .max(MAX_ANCHOR_BOXES - 1)
      .optional(),
  }),
  /** "A slide is missing here" – sits between two slides (BER-103). */
  z.object({
    type: z.literal('gap'),
    afterSlideId: z.string().nullable(),
    beforeSlideId: z.string().nullable(),
  }),
]);
export type Anchor = z.infer<typeof anchorSchema>;

/** The boxes a comment marks, its first (`rect`, `shapeRef`) first; none for other anchors. */
export const anchorBoxes = (anchor: Anchor): AnchorBox[] =>
  anchor.type === 'rect'
    ? [{ rect: anchor.rect, shapeRef: anchor.shapeRef }, ...(anchor.more ?? [])]
    : [];

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
 * its proportions at every slide size. A sticker sent without a comment of its own carries the
 * same text as its body – so it counts, is listed and goes to the AI like any comment.
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
export const strokeSchema = z.union([pathStrokeSchema, textStrokeSchema]);
export type Stroke = z.infer<typeof strokeSchema>;

export const isTextStroke = (stroke: Stroke): stroke is TextStroke => stroke.tool === 'text';
export const isPathStroke = (stroke: Stroke): stroke is PathStroke => stroke.tool !== 'text';

/** A comment's sticker – its text written on the slide – if it has one. */
export const stickerOf = (comment: { strokes: readonly Stroke[] }): TextStroke | null =>
  comment.strokes.find(isTextStroke) ?? null;

/**
 * What a comment says in words: its body, else its sticker's text. A sticker is a comment like
 * any other – the AI reads it, ✨ and ⌘↵ give it to the AI.
 */
export const commentWords = (comment: { body: string; strokes: readonly Stroke[] }): string =>
  comment.body.trim() || (stickerOf(comment)?.text.trim() ?? '');

/** A comment that is only a drawing (freehand, arrow, marker, shapes): it moves as a whole. */
export const isDrawing = (comment: { strokes: readonly Stroke[] }): boolean =>
  comment.strokes.length > 0 && comment.strokes.every(isPathStroke);

type Placed = { anchor: Anchor; strokes: Stroke[] };

/**
 * The shift by (`dx`, `dy`) cut down so the drawing and its anchor stay on the slide.
 */
export function clampDrawingShift(
  { anchor, strokes }: Placed,
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const stroke of strokes)
    if (isPathStroke(stroke))
      for (const point of stroke.points) {
        xs.push(point.x);
        ys.push(point.y);
      }
  if (anchor.type === 'point') {
    xs.push(anchor.point.x);
    ys.push(anchor.point.y);
  } else if (anchor.type === 'rect') {
    xs.push(anchor.rect.x, anchor.rect.x + anchor.rect.w);
    ys.push(anchor.rect.y, anchor.rect.y + anchor.rect.h);
  }
  if (xs.length === 0) return { dx: 0, dy: 0 };
  const within = (value: number, values: number[]) =>
    Math.min(1 - Math.max(...values), Math.max(-Math.min(...values), value));
  return { dx: within(dx, xs), dy: within(dy, ys) };
}

/** Moves a comment's drawn strokes and its point/box anchor by (`dx`, `dy`), kept on the slide. */
export function moveDrawing<T extends Placed>(comment: T, dx: number, dy: number): T {
  const shift = clampDrawingShift(comment, dx, dy);
  const move = ({ x, y }: { x: number; y: number }) => ({
    x: Math.min(1, Math.max(0, x + shift.dx)),
    y: Math.min(1, Math.max(0, y + shift.dy)),
  });
  const { anchor } = comment;
  return {
    ...comment,
    strokes: comment.strokes.map((stroke) =>
      isPathStroke(stroke) ? { ...stroke, points: stroke.points.map(move) } : stroke,
    ),
    anchor:
      anchor.type === 'point'
        ? { ...anchor, point: move(anchor.point) }
        : anchor.type === 'rect'
          ? { ...anchor, rect: { ...anchor.rect, ...move(anchor.rect) } }
          : anchor,
  };
}

export const commentStatusSchema = z.enum(['open', 'done']);
export type CommentStatus = z.infer<typeof commentStatusSchema>;

/**
 * `gslides`: imported from Google Slides through Drive's comment API (BER-157) – retired, only on
 * old comments: never imported again, never editable.
 */
export const commentSourceSchema = z.enum(['app', 'pptx', 'gslides']);
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
 * A recording's transcript, made on the server after the upload (the workspace's key for speech
 * to text, else the server's own Whisper): `none` where neither was there.
 */
export const TRANSCRIPT_STATUSES = ['none', 'pending', 'done', 'failed'] as const;
export const transcriptStatusSchema = z.enum(TRANSCRIPT_STATUSES);
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
  /** What was said – `null` until it is `done`; empty when nothing was. */
  transcript: z.string().nullable(),
  transcriptStatus: transcriptStatusSchema,
  /** The transcript in short – made when the comment goes to the AI, shown in its place. */
  transcriptSummary: z.string().nullable(),
});
export type CommentMedia = z.infer<typeof commentMediaSchema>;

/**
 * An image of a comment, stored as PNG: a sketch drawn in the composer's Bild tab (beside an
 * optional voice memo) or pasted / picked ones (BER-174, up to `MAX_COMMENT_IMAGES`).
 */
export const commentImageSchema = z.object({
  id: z.string(),
  /** Same permission-checked route as recordings (`/api/media/:id`). */
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type CommentImage = z.infer<typeof commentImageSchema>;

/**
 * How someone reacts to a comment: thumbs up, thumbs down or „egal“ (`neutral`). One reaction
 * per person and comment; reacting again changes it.
 */
export const COMMENT_REACTIONS = ['up', 'down', 'neutral'] as const;
export const commentReactionKindSchema = z.enum(COMMENT_REACTIONS);
export type CommentReactionKind = z.infer<typeof commentReactionKindSchema>;

export const commentReactionSchema = z.object({
  kind: commentReactionKindSchema,
  /** Snapshot of who reacted, as for comments. */
  author: authorSchema,
});
export type CommentReaction = z.infer<typeof commentReactionSchema>;

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
  /**
   * Its images, in the order they were added: a drawn one (Bild tab; `media` then holds the voice
   * memo recorded while drawing) or pasted / picked ones.
   */
  images: z.array(commentImageSchema).optional(),
  /** Reactions to it (👍 / 👎 / egal), oldest first. */
  reactions: z.array(commentReactionSchema).optional(),
  status: commentStatusSchema,
  resolvedBy: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  source: commentSourceSchema,
  /** Whether the comment still exists in the PowerPoint file; always `present` for app comments. */
  sourceStatus: commentSourceStatusSchema.optional(),
  /**
   * Roots only: where the thread stands, in 1–3 sentences in its language – written by the AI
   * once the thread asked it more than three times, anew after each further request.
   */
  aiSummary: z.object({ text: z.string(), at: z.iso.datetime() }).nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Comment = z.infer<typeof commentSchema>;

/**
 * Who is making a request: always a signed-in account (BER-129 – `owner` is historical; what the
 * account may do with a deck is in `Deck.permissions`). There are no guests: sharing a deck
 * invites the person into the workspace as `viewer`.
 */
export const viewerSchema = z.object({ kind: z.literal('owner'), author: accountAuthorSchema });
export type Viewer = z.infer<typeof viewerSchema>;
