import { z } from 'zod';
import { workspaceFontSchema } from './workspaces';

/*
 * Editing decks in Slider (BER-177): the editor and the AI change a deck through the same small set
 * of operations on its elements. The operations know nothing about the file format – a format
 * adapter (ODP first, `@slider/odp`) applies them to the file. Geometry is normalised to the slide
 * (0–1), like every other on-slide geometry.
 */

/** Like `rectSchema`, but an element may reach beyond the slide. */
export const elementBoxSchema = z.object({
  x: z.number().min(-10).max(10),
  y: z.number().min(-10).max(10),
  w: z.number().min(0).max(20),
  h: z.number().min(0).max(20),
});
export type ElementBox = z.infer<typeof elementBoxSchema>;

export const editableElementKindSchema = z.enum([
  'text',
  'image',
  'shape',
  'table',
  'group',
  'other',
]);
export type EditableElementKind = z.infer<typeof editableElementKindSchema>;

// ── Live elements ────────────────────────────────────────────────────────

/*
 * Texts the browser draws itself while they are typed in or formatted (the live editor): their
 * look read from the file's styles, resolved, so the editor shows a change at once – over
 * LibreOffice's picture of the slide with that one text left out. Everything else is always
 * LibreOffice's picture. Lengths are points, sizes of text too.
 */

export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Farbe als #rrggbb.');

export const liveTextStyleSchema = z.object({
  /** The font as the file names it (`Calibri`); the browser maps it like LibreOffice does. */
  font: z.string().min(1).max(100),
  size: z.number().min(1).max(999),
  color: colorSchema,
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  /** Drawn in capitals (or small letters) whatever is typed – the file's text transform. */
  caps: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  /** Extra room between letters, points. */
  letterSpacing: z.number().min(-50).max(200).optional(),
});
export type LiveTextStyle = z.infer<typeof liveTextStyleSchema>;

/** A stretch of text in one style; `\n` is a line break inside the paragraph. */
export const liveRunSchema = liveTextStyleSchema.extend({ text: z.string().max(5_000) });
export type LiveRun = z.infer<typeof liveRunSchema>;

export const textAlignSchema = z.enum(['left', 'center', 'right', 'justify']);
export type TextAlign = z.infer<typeof textAlignSchema>;

export const liveParagraphSchema = z.object({
  runs: z.array(liveRunSchema),
  /** The style of an empty paragraph and of text typed at its end. */
  mark: liveTextStyleSchema,
  align: textAlignSchema,
  /**
   * Lines as high as 1.2 × the font size, not as the font's own metrics say (LibreOffice's
   * „font-independent line spacing“, which presentation placeholders use).
   */
  fontIndependent: z.boolean(),
  /** `proportional`: of the font's line height (1 = single); else points. */
  lineSpacing: z.object({
    type: z.enum(['proportional', 'fixed', 'minimum']),
    value: z.number(),
  }),
  spaceBefore: z.number(),
  spaceAfter: z.number(),
  /** Where the text starts, from the box's inner left; `indent` moves the first line. */
  marginLeft: z.number(),
  indent: z.number(),
  /** List level, 0 outside a list. */
  level: z.number().int().nonnegative(),
  bullet: z
    .object({
      char: z.string().max(4),
      font: z.string().nullable(),
      size: z.number(),
      color: colorSchema,
      /** Where the bullet sits and how wide its room is, from the box's inner left. */
      at: z.number(),
      width: z.number(),
    })
    .nullable(),
});
export type LiveParagraph = z.infer<typeof liveParagraphSchema>;

export const elementStrokeSchema = z.object({
  color: colorSchema,
  width: z.number().min(0).max(100),
});
export type ElementStroke = z.infer<typeof elementStrokeSchema>;

export const verticalAlignSchema = z.enum(['top', 'middle', 'bottom']);
export type VerticalAlign = z.infer<typeof verticalAlignSchema>;

export const liveElementSchema = z.object({
  fill: colorSchema.nullable(),
  stroke: elementStrokeSchema.nullable(),
  padding: z.object({
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  }),
  verticalAlign: verticalAlignSchema,
  /** The box grows with its text (LibreOffice's „Höhe an Text anpassen“) … */
  autoGrow: z.boolean(),
  /** … and shrinks with it down to this height (points; `null`: as low as the text). */
  minHeight: z.number().nullable(),
  /** Empty placeholder: LibreOffice draws nothing, the editor its prompt. */
  placeholder: z.boolean(),
  /** The text shrinks to fit the box (autofit); the browser does so as LibreOffice roughly does. */
  shrink: z.boolean().optional(),
  paragraphs: z.array(liveParagraphSchema),
});
export type LiveElement = z.infer<typeof liveElementSchema>;

/** One element of a slide as the editor and the AI see it. */
/**
 * Who took a stock photo (Unsplash), kept with the picture in the file (its description) so the
 * credit travels with it. Links without tracking parameters – see {@link stockLink}.
 */
export const imageCreditSchema = z.object({
  name: z.string(),
  /** The photographer's profile. */
  profileUrl: z.string(),
  /** The photo's own page. */
  photoUrl: z.string(),
});
export type ImageCredit = z.infer<typeof imageCreditSchema>;

/** Unsplash wants every link back to it tagged with the app it comes from. */
export const stockLink = (url: string): string =>
  `${url}${url.includes('?') ? '&' : '?'}utm_source=Slider&utm_medium=referral`;

/** Unsplash itself, linked from every credit. */
export const STOCK_HOME = 'https://unsplash.com/';

export const editableElementSchema = z.object({
  /** Stable while the deck is edited in Slider. */
  id: z.string(),
  kind: editableElementKindSchema,
  /** The element's name in the file (e.g. „Title 1“), may repeat across slides. */
  name: z.string(),
  /** Placeholder role from the layout: `title`, `subtitle`, `outline`, … – `null` otherwise. */
  role: z.string().nullable(),
  bbox: elementBoxSchema,
  /** One entry per paragraph; `null` when the element holds no editable text. */
  paragraphs: z.array(z.string()).nullable(),
  /** Whether {@link setBox} works on it (rotated or line-like elements are read-only for now). */
  movable: z.boolean(),
  resizable: z.boolean(),
  /** Set when its text can be typed on the slide (the browser draws it then); `null`: it cannot. */
  live: liveElementSchema.nullable().default(null),
  /** A picture that is a stock photo: whose it is (shown with it). */
  credit: imageCreditSchema.nullable().default(null),
});
export type EditableElement = z.infer<typeof editableElementSchema>;

export const editableSlideSchema = z.object({
  /** 0-based position in the file, hidden slides included. */
  index: z.number().int().nonnegative(),
  name: z.string(),
  hidden: z.boolean(),
  elements: z.array(editableElementSchema),
});
export type EditableSlide = z.infer<typeof editableSlideSchema>;

/** Longest text the editor or the AI may put into one element. */
export const MAX_ELEMENT_TEXT = 5_000;

const elementId = z.string().min(1).max(100);

export const setTextOperationSchema = z.object({
  type: z.literal('setText'),
  elementId,
  /** Replaces the element's text; formatting of the first run of each paragraph stays. */
  paragraphs: z
    .array(z.string().max(MAX_ELEMENT_TEXT))
    .max(200)
    .refine((paragraphs) => paragraphs.join('').length <= MAX_ELEMENT_TEXT, 'Text zu lang.'),
});

export const setBoxOperationSchema = z.object({
  type: z.literal('setBox'),
  elementId,
  box: elementBoxSchema.refine((box) => box.w > 0 && box.h > 0, 'Leere Box.'),
});

/** A paragraph as the editor writes it: its runs carry their whole style. */
export const richParagraphSchema = z.object({
  align: textAlignSchema,
  runs: z.array(liveRunSchema).max(200),
});
export type RichParagraph = z.infer<typeof richParagraphSchema>;

const richParagraphs = z
  .array(richParagraphSchema)
  .max(200)
  .refine(
    (paragraphs) =>
      paragraphs.reduce(
        (sum, paragraph) => sum + paragraph.runs.reduce((n, run) => n + run.text.length, 0),
        0,
      ) <= MAX_ELEMENT_TEXT,
    'Text zu lang.',
  );

/** Replaces a live element's text with formatted text; paragraph spacing and lists stay. */
export const setRichTextOperationSchema = z.object({
  type: z.literal('setRichText'),
  elementId,
  paragraphs: richParagraphs,
});

/** Fill, border and vertical alignment of a live element; what is left out stays. */
export const setShapeStyleOperationSchema = z.object({
  type: z.literal('setShapeStyle'),
  elementId,
  fill: colorSchema.nullable().optional(),
  stroke: elementStrokeSchema.nullable().optional(),
  verticalAlign: verticalAlignSchema.optional(),
});

/** A new text box or box on a slide, on top; the editor picks its id (`sl…`). */
export const addElementOperationSchema = z.object({
  type: z.literal('addElement'),
  slideIndex: z.number().int().nonnegative().max(10_000),
  elementId: z.string().regex(/^sl[a-z0-9-]{4,60}$/),
  kind: z.enum(['text', 'rect']),
  box: elementBoxSchema.refine((box) => box.w > 0 && box.h > 0, 'Leere Box.'),
  fill: colorSchema.nullable(),
  stroke: elementStrokeSchema.nullable(),
  paragraphs: richParagraphs,
});

export const replaceImageOperationSchema = z.object({
  type: z.literal('replaceImage'),
  elementId,
  /** An image uploaded for this deck before (`POST /decks/:id/edit/images`). */
  imageId: z.string().min(1).max(100),
});

export const deleteElementOperationSchema = z.object({
  type: z.literal('deleteElement'),
  elementId,
});

/**
 * Puts an element at another place in its slide's stacking order: `to` counts the slide's
 * elements from the bottom (0: under all others), without the element itself.
 */
export const moveElementOperationSchema = z.object({
  type: z.literal('moveElement'),
  elementId,
  to: z.number().int().nonnegative().max(10_000),
});

/** 0-based position in the file, hidden slides included (like {@link EditableSlide.index}). */
const slideIndex = z.number().int().nonnegative().max(10_000);

export const deleteSlideOperationSchema = z.object({
  type: z.literal('deleteSlide'),
  slideIndex,
});

/** PowerPoint's „Folie ausblenden“: the slide stays in the file, but is not shown. */
export const setSlideHiddenOperationSchema = z.object({
  type: z.literal('setSlideHidden'),
  slideIndex,
  hidden: z.boolean(),
});

export const moveSlideOperationSchema = z.object({
  type: z.literal('moveSlide'),
  slideIndex,
  /** The new position, counted without the slide. */
  to: slideIndex,
});

export const slideOperationSchema = z.discriminatedUnion('type', [
  setTextOperationSchema,
  setBoxOperationSchema,
  setRichTextOperationSchema,
  setShapeStyleOperationSchema,
  addElementOperationSchema,
  replaceImageOperationSchema,
  deleteElementOperationSchema,
  moveElementOperationSchema,
  deleteSlideOperationSchema,
  setSlideHiddenOperationSchema,
  moveSlideOperationSchema,
]);
export type SlideOperation = z.infer<typeof slideOperationSchema>;
export type SetTextOperation = z.infer<typeof setTextOperationSchema>;
export type SetBoxOperation = z.infer<typeof setBoxOperationSchema>;
export type SetRichTextOperation = z.infer<typeof setRichTextOperationSchema>;
export type SetShapeStyleOperation = z.infer<typeof setShapeStyleOperationSchema>;
export type AddElementOperation = z.infer<typeof addElementOperationSchema>;
export type ReplaceImageOperation = z.infer<typeof replaceImageOperationSchema>;
export type DeleteElementOperation = z.infer<typeof deleteElementOperationSchema>;
export type MoveElementOperation = z.infer<typeof moveElementOperationSchema>;
export type DeleteSlideOperation = z.infer<typeof deleteSlideOperationSchema>;
export type SetSlideHiddenOperation = z.infer<typeof setSlideHiddenOperationSchema>;
export type MoveSlideOperation = z.infer<typeof moveSlideOperationSchema>;

/** Most operations one request (or one AI proposal) may carry. */
export const MAX_OPERATIONS_PER_EDIT = 100;

export const slideOperationsSchema = z
  .array(slideOperationSchema)
  .min(1)
  .max(MAX_OPERATIONS_PER_EDIT);

// ── API ──────────────────────────────────────────────────────────────────

/** Who made a step of a deck's edit history: `original` is the file as it came. */
export const deckEditSourceSchema = z.enum(['original', 'editor', 'ai']);
export type DeckEditSource = z.infer<typeof deckEditSourceSchema>;

/** A slide of an editable deck: the editor's view, tied to the viewer's slide by `slideId`. */
export const editSlideSchema = editableSlideSchema.extend({
  slideId: z.string(),
});
export type EditSlide = z.infer<typeof editSlideSchema>;

/** `GET /decks/:id/edit` – whether and how the deck can be edited, and its elements. */
export const deckEditStateSchema = z.object({
  /** Only ODP decks can be edited for now (BER-177). */
  editable: z.boolean(),
  /** Why not, in German; `null` when it can. */
  reason: z.string().nullable(),
  /** The edit step the deck shows (0 = as it came). */
  seq: z.number().int().nonnegative(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  /** Edits not saved back to the deck's cloud yet. */
  unsaved: z.boolean(),
  /** Where „Speichern“ writes the file: the deck's cloud, or `null` (download only). */
  saveTarget: z.enum(['nextcloud']).nullable(),
  /** The cloud's file changed since the deck was opened or last saved. */
  changedInCloud: z.boolean(),
  /** The workspace has a working AI key: the AI can propose changes (BER-183). */
  aiAvailable: z.boolean(),
  /** Stock photos (Unsplash) can be searched: the server has an access key. */
  stockPhotos: z.boolean().default(false),
  /** The workspace's own fonts: slides are drawn in them, the editor offers them. */
  fonts: z.array(workspaceFontSchema).default([]),
  /** The slides' size in centimetres, for drawing live elements to scale. */
  pageSize: z
    .object({ width: z.number().positive(), height: z.number().positive() })
    .default({ width: 28, height: 15.75 }),
  slides: z.array(editSlideSchema),
});
export type DeckEditState = z.infer<typeof deckEditStateSchema>;

export const applyEditInputSchema = z.object({
  operations: slideOperationsSchema,
  /** The step the editor saw; a different current step is a conflict (409). */
  baseSeq: z.number().int().nonnegative().optional(),
});
export type ApplyEditInput = z.infer<typeof applyEditInputSchema>;

/**
 * `POST /decks/:id/edit/slides/:slideId/layers` – a slide taken apart for the layers view: what
 * is under every element (page and master background, master shapes) and each element drawn
 * alone, see-through around it, bottom first – in the order of the slide's `elements`.
 */
export const slideLayersSchema = z.object({
  /** The edit step they were drawn from. */
  seq: z.number().int().nonnegative(),
  background: z.string(),
  layers: z.array(
    z.object({
      elementId: z.string(),
      /** PNG cut to `box` (0–1 of the slide); `null` when the element draws nothing. */
      url: z.string().nullable(),
      box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
    }),
  ),
});
export type SlideLayers = z.infer<typeof slideLayersSchema>;

/** `POST /decks/:id/edit/images` – a picture ready for `replaceImage`. */
export const uploadedEditImageSchema = z.object({
  imageId: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type UploadedEditImage = z.infer<typeof uploadedEditImageSchema>;

// ── Stock photos (Unsplash) ──────────────────────────────────────────────

/**
 * A photo found on Unsplash. Its pictures are always loaded from Unsplash itself (hotlinked);
 * only when one goes into a slide does the server fetch it into the file.
 */
export const stockPhotoSchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Its average colour, shown while it loads. */
  color: z.string().nullable(),
  /** A small picture (~400 px wide) for lists. */
  thumbUrl: z.string(),
  /** The picture's base address; `w`, `h` and `fit=crop` give any size (see `stockPhotoUrl`). */
  rawUrl: z.string(),
  credit: imageCreditSchema,
});
export type StockPhoto = z.infer<typeof stockPhotoSchema>;

/** The photo cut to `aspect` (width / height), about `width` px wide – as it goes into the file. */
export function stockPhotoUrl(
  photo: Pick<StockPhoto, 'rawUrl'>,
  width: number,
  aspect?: number | null,
) {
  const url = new URL(photo.rawUrl);
  url.searchParams.set('w', String(Math.round(width)));
  if (aspect) {
    url.searchParams.set('h', String(Math.round(width / aspect)));
    url.searchParams.set('fit', 'crop');
    url.searchParams.set('crop', 'entropy');
  }
  url.searchParams.set('fm', 'jpg');
  url.searchParams.set('q', '80');
  return url.toString();
}

export const stockOrientationSchema = z.enum(['landscape', 'portrait', 'squarish']);
export type StockOrientation = z.infer<typeof stockOrientationSchema>;

/** `GET /decks/:id/stock/photos?q=…&orientation=…` */
export const stockSearchSchema = z.object({ photos: z.array(stockPhotoSchema) });
export type StockSearch = z.infer<typeof stockSearchSchema>;

/** `POST /decks/:id/stock/photos/:photoId` – the photo cut to the frame it goes into. */
export const pickStockPhotoInputSchema = z.object({
  /** The frame's width / height; without it the photo keeps its own proportions. */
  aspect: z.number().min(0.05).max(20).optional(),
});
export type PickStockPhotoInput = z.infer<typeof pickStockPhotoInputSchema>;

export const saveEditInputSchema = z.object({
  /** Save although the cloud's file changed meanwhile (the other version stays in its history). */
  overwrite: z.boolean().optional(),
});

// ── AI proposals ─────────────────────────────────────────────────────────

/**
 * `running` → `applied` (the AI applies its proposal right away) ⇄ `reverted`; `ready` when it
 * changed nothing, `failed`, `cancelled` when someone stopped it. `discarded`: from before
 * proposals applied themselves.
 */
/** How long the AI may work on a request, waiting included: then it stops, and its change goes back. */
export const AI_RUNNING_LIMIT_MS = 10 * 60_000;

export const aiProposalStatusSchema = z.enum([
  'running',
  'ready',
  'failed',
  'applied',
  'reverted',
  'discarded',
  'cancelled',
]);
export type AiProposalStatus = z.infer<typeof aiProposalStatusSchema>;

/** Asked from a comment (⌘↵): the AI reads its thread and edits the deck, starting at the comment's slide. */
export const createAiProposalInputSchema = z.object({
  commentId: z.string().min(1),
});
export type CreateAiProposalInput = z.infer<typeof createAiProposalInputSchema>;

export const aiProposalSchema = z.object({
  id: z.string(),
  slideId: z.string(),
  /** The comment that asked for it; the proposal shows in its thread, right after it. */
  commentId: z.string().nullable(),
  prompt: z.string(),
  status: aiProposalStatusSchema,
  /** What the AI did, in its words. */
  summary: z.string().nullable(),
  error: z.string().nullable(),
  /**
   * The stock photo the AI put on the slide, and the others it would take: one click puts
   * another in its place.
   */
  photos: z
    .object({
      /** The frame showing it, when it is one the editor knows. */
      elementId: z.string().nullable(),
      /** The frame's width / height: every choice is cut to it. */
      aspect: z.number().nullable(),
      chosenId: z.string(),
      /** The AI's choice first. */
      candidates: z.array(stockPhotoSchema),
    })
    .nullable()
    .default(null),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AiProposal = z.infer<typeof aiProposalSchema>;

/** `POST /decks/:id/ai/proposals/:proposalId/photo` – another of its photos. */
export const choosePhotoInputSchema = z.object({ photoId: z.string().min(1).max(100) });
export type ChoosePhotoInput = z.infer<typeof choosePhotoInputSchema>;

// ── Workspace AI keys ────────────────────────────────────────────────────

/**
 * Who runs the workspace's AI: Anthropic, OpenAI, Google (Gemini) – or any service that speaks
 * OpenAI's API at an address of its own (OpenRouter, Mistral, Azure, a local Ollama, …).
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'custom'] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  custom: 'OpenAI-kompatibel',
};

/** One stored key – the AI runs on the active one. */
export const workspaceAiKeySchema = z.object({
  id: z.string(),
  provider: aiProviderSchema,
  /** The service's address – only for `custom`. */
  baseUrl: z.string().nullable(),
  /** `sk-…AbCd` – all that is shown of the key. */
  hint: z.string(),
  /** The model the AI runs on with this key. */
  model: z.string(),
  active: z.boolean(),
  setByName: z.string(),
  setAt: z.iso.datetime(),
  /** Why the provider refused it last; `null` while it works. */
  error: z.string().nullable(),
});
export type WorkspaceAiKey = z.infer<typeof workspaceAiKeySchema>;

export const workspaceAiSchema = z.object({
  /** Newest first. */
  keys: z.array(workspaceAiKeySchema),
});
export type WorkspaceAi = z.infer<typeof workspaceAiSchema>;

/** `GET /workspaces/:id/ai/keys/:keyId/models` – what the key may run on, newest first. */
export const aiModelListSchema = z.object({
  models: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type AiModelList = z.infer<typeof aiModelListSchema>;

/** `POST /workspaces/:id/ai/keys` – a key, checked with its provider before it is stored. */
export const addWorkspaceAiKeyInputSchema = z
  .object({
    provider: aiProviderSchema,
    apiKey: z.string().trim().min(8, 'Das ist kein gültiger API-Key.').max(400),
    baseUrl: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((input, context) => {
    const issue = (message: string, path: 'apiKey' | 'baseUrl' = 'apiKey') =>
      context.addIssue({ code: 'custom', message, path: [path] });
    if (/\s/.test(input.apiKey)) issue('Der Key enthält Leerzeichen – bitte nochmal kopieren.');
    if (input.provider === 'anthropic') {
      if (!input.apiKey.startsWith('sk-ant-')) {
        issue('Das ist kein Anthropic-API-Key (er beginnt mit „sk-ant-“).');
      } else if (input.apiKey.startsWith('sk-ant-admin')) {
        issue('Das ist ein Admin-Key. Bitte einen normalen API-Key anlegen.');
      }
    }
    if (input.provider === 'custom') {
      const url = URL.canParse(input.baseUrl ?? '') ? new URL(input.baseUrl!) : null;
      if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
        issue(
          'Bitte die Adresse des Dienstes angeben, z. B. https://openrouter.ai/api/v1.',
          'baseUrl',
        );
      }
    }
  });
export type AddWorkspaceAiKeyInput = z.infer<typeof addWorkspaceAiKeyInputSchema>;

/** `PATCH /workspaces/:id/ai/keys/:keyId` – make it the active one, or pick its model. */
export const updateWorkspaceAiKeyInputSchema = z
  .object({
    active: z.literal(true).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    /** A refused key asked again – e.g. once the account was topped up. */
    recheck: z.literal(true).optional(),
  })
  .refine(
    (input) =>
      input.active !== undefined || input.model !== undefined || input.recheck !== undefined,
  );
export type UpdateWorkspaceAiKeyInput = z.infer<typeof updateWorkspaceAiKeyInputSchema>;
