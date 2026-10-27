import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, gte, inArray, lte, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  OdpDocument,
  OdpError,
  frameIdShowing,
  imageSize,
  mergeSlide,
  picturePath,
  renameStyles,
  sameSlide,
  swapPicture,
  type OdpSlide,
  type SlideConflict,
} from '@slider/odp';
import {
  stockOrientationSchema,
  stockPhotoUrl,
  type AiProposal,
  type Anchor,
  type CreateAiProposalInput,
  type StockOrientation,
  type Viewer,
  AI_RUNNING_LIMIT_MS,
} from '@slider/shared';
import {
  aiProposals,
  comments,
  deckEdits,
  media,
  slideVersions,
  slides,
  users,
  type AiSlideChange,
  type AiStockPhotos,
  type StockPhotoRecord,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import { requireDeckAccess } from '../auth/access';
import {
  drawSlides,
  editFile,
  editTarget,
  getEditState,
  loadEditImage,
  moveEdit,
  NotThatStep,
  readFile,
  type EditTarget,
} from './edits';
import { fetchPhoto, searchPhotos, stockSource, toStockPhoto, trackPhoto } from './stock-photos';
import {
  failureMessage,
  isProviderError,
  keyProblem,
  runTurn,
  type AiConnection,
} from './ai-providers';
import { markKeyRefused, workspaceAiConnection } from './workspace-ai';

/*
 * The AI edits the deck (BER-183): asked from a comment (⌘↵), it works on the ODP's XML
 * itself – looks at any slide and its styles, rewrites slides, sees them drawn, corrects
 * itself – and its result is applied right away as an edit step of its own. Only what keeps
 * the file safe and whole is checked (no scripts or links out, every style and picture
 * named exists); what it does with the slides is up to the model. Its answer in the thread can
 * take the change back and apply it again. Runs on the workspace's Anthropic key, on the
 * server, in the background; the viewer hears about it through the live channel.
 */

/**
 * Proposals at work at once on this server; more wait. They mostly wait for the model, so
 * several people with several requests each work side by side.
 */
const MAX_RUNNING = 10;
/** Turns of one run: look around, write, look, correct. */
const MAX_TURNS = 20;
/**
 * How often a run whose change met someone else's – the same thing changed two ways – does its
 * part again on the deck as it is now, before it gives up.
 */
const MAX_REBASES = 2;
/** Turns to do a change again after it met another. */
const MAX_REBASE_TURNS = 8;
/** Other requests at work named to the AI at most. */
const MAX_OTHERS_SHOWN = 12;
/** Style XML shown with a slide at most; beyond, only the names. */
const MAX_INLINE_STYLES = 30_000;
/** A proposal still „running“ this long after it was asked was cut off (a restart) – failed. */
const CUT_OFF_MS = AI_RUNNING_LIMIT_MS + 2 * 60_000;
const TIMED_OUT =
  'Die KI hat länger als 10 Minuten gebraucht und wurde gestoppt. Bitte nochmal senden – oder den Auftrag kleiner fassen.';
/** The thread the AI reads: its last messages, at most this much text. */
const MAX_THREAD_MESSAGES = 20;
const MAX_THREAD_CHARS = 8_000;
/** Pictures of the thread shown to the AI (the latest), and how large one may be. */
const MAX_THREAD_PICTURES = 6;
const MAX_SHOWN_PICTURE_BYTES = 3_500_000;
/** Search places returned at once. */
const MAX_SEARCH_PLACES = 40;
/** Photo searches of one run, and the photos each shows the AI. */
const MAX_PHOTO_SEARCHES = 3;
const PHOTOS_SHOWN = 8;
/** The AI's choice and the alternatives it offers. */
const MAX_ALTERNATIVES = 2;
/**
 * Tokens one run may spend – what the model writes and the tool results it reads; it paces
 * itself to it (a task budget), the turn cap stops it for sure.
 */
const TASK_BUDGET_TOKENS = 250_000;

let running = 0;
const waiting: (() => void)[] = [];
/** The runs of this process, to stop one when someone asks. */
const stoppers = new Map<string, AbortController>();

async function inSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_RUNNING) running += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

const BASE_SYSTEM = `You edit an existing presentation in Slider, a tool where teams review and improve presentations together. People discuss a slide – or the place between two slides – in a comment thread; its last message asks you for a change. Earlier messages of the thread – including your own earlier answers – are context; act on the last one.

The presentation is an OpenDocument presentation (ODP), and you work on its XML:
- view_slide shows a slide: how it looks, its <draw:page> XML and the styles it names. You see the commented slide (or the slides around the commented place) already; look at others when the request refers to them or you want to know how the deck does things.
- search_deck finds text or XML (any case) in all slides – speaker notes included – and in the styles and master pages, so you know where something is without looking at every slide.
- read_styles shows styles, master pages, gradients and the like by name – or, without names, the deck's common styles and master pages.
- list_pictures lists the pictures in the file (size in pixels, which slides show them); view_picture shows one.
- add_picture makes a picture attached to the comment thread available as a file path for write_slide and edit_slide.
- write_slide replaces a slide's <draw:page> with yours, optionally adding styles, and shows the slide drawn.
- edit_slide changes parts of a slide's <draw:page>: each edit replaces a piece of its XML by yours. It optionally adds styles, and shows the slide drawn.
- insert_slide adds a slide – your <draw:page>, or a copy of a slide to rewrite afterwards – and shows it drawn; delete_slide removes one, move_slide moves one. Slide numbers change with them: the results give the new order.

Writing:
- With write_slide, write the complete <draw:page>, starting from its current XML, and keep everything the request is not about as it is – element ids (xml:id), names, placeholders (presentation:class), notes and animations included. Use the file's namespace prefixes (draw, svg, text, style, fo, presentation, table, …) without declaring them.
- With edit_slide, give only the pieces you change: each one copied exactly from the slide's XML as you were last shown it, long enough to occur only once, and what replaces it. Use it when the request is about some elements or attributes and the rest of the slide stays – always on a large slide (a table, many shapes), which is never too large for it. Do the whole request in one run; there is no later one.
- Styles are shared between slides. To change how an element looks, add a style of your own (e.g. a style:style of family graphic, paragraph or text, under a new name, with the properties you want and the same parent as the old one) and point the element at it. Existing styles stay as they are; your own you can write again.
- Pictures can be ones already in the file (Pictures/…, the same path on several slides is fine) or ones from the thread after add_picture. Keep a picture's proportions (its pixel size) when you size its frame. Scripts, events and links out are removed.
- A draw:frame is always a rectangle. For a picture with rounded corners, as a circle or in another shape, replace its frame by a shape filled with the picture: a draw:rect with draw:corner-radius (or a draw:ellipse, or a draw:custom-shape) of the frame's position and size, whose graphic style has draw:fill="bitmap", draw:fill-image-name naming a draw:fill-image you add (draw:name, xlink:href the Pictures/… path, xlink:type="simple", xlink:show="embed", xlink:actuate="onLoad"), style:repeat="stretch" and draw:stroke="none". The shape needs the picture's proportions, or it is stretched.
- Change only the slides the request is about – usually the commented one.
- Others work on the deck at the same time – people, and other requests like yours. Your change is merged with theirs element by element and attribute by attribute, so on the slides you write, change only the elements, attributes and text the request is about and leave everything else exactly as it is in the XML you were shown.
- Check each drawn slide: text fits its box, nothing overlaps by accident or leaves the slide, it fits the look of the deck. If something is off, write the slide again.
- Keep the deck's language and tone. Do not invent facts, figures or names – if the request needs information you do not have, keep the text general or say so.

When the slides are right, or when the request cannot be done, stop. What you wrote is applied right away; the people can take it back with one click. Then reply in the language of the request with one short sentence saying what you changed (or why nothing) – the slides show the rest. Mention something important you noticed but did not change in a second short sentence at most. Address the person directly, without preamble.`;

const STOCK_SYSTEM = `

Stock photos (Unsplash): when the request asks for a photo or picture you do not have – a new one, a better or different one – search_photos finds photos (you see small previews) and add_photo makes one available as a file path for write_slide and edit_slide, cut to the frame's proportions. Search with a short English query for what the photo should show; search again only if nothing fits. Pass the best photo and up to two good alternatives to add_photo: the people can switch to an alternative with one click. Put the photo into a draw:frame with the proportions you gave (replacing an existing picture: its draw:image inside the existing frame, same size). The photographer's credit is added to the frame automatically – do not write it on the slide. Never use stock photos for logos, charts, screenshots or people the deck names.`;

/** What the AI is told – with stock photos when this server can search them. */
const systemPrompt = (stock: boolean) => BASE_SYSTEM + (stock ? STOCK_SYSTEM : '');

const slideNumber = {
  type: 'integer',
  minimum: 1,
  description: 'The slide’s number in the deck (1 = first).',
} as const;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'view_slide',
    description:
      'Shows a slide as it looks now (with your writes), its <draw:page> XML and the styles it names.',
    input_schema: { type: 'object', properties: { slide: slideNumber }, required: ['slide'] },
  },
  {
    name: 'search_deck',
    description:
      'Finds text or XML (any case, no patterns) in all slides – notes included – and in the styles and master pages. Returns where (slide n or style name) with some XML around each place.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
    },
  },
  {
    name: 'list_pictures',
    description:
      'Lists the pictures in the file: path, media type, size in pixels and bytes, and which slides or styles show them.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'view_picture',
    description: 'Shows a picture of the file (a Pictures/… path from list_pictures or a slide).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'add_picture',
    description:
      'Makes a picture attached to the comment thread (numbered as shown to you) available to write_slide and edit_slide, and returns its Pictures/… path and size in pixels.',
    input_schema: {
      type: 'object',
      properties: { picture: { type: 'integer', minimum: 1 } },
      required: ['picture'],
    },
  },
  {
    name: 'insert_slide',
    description:
      'Adds a slide after slide `after` (0: as the first): your <draw:page> XML (with your styles, like write_slide), or a copy of slide `copy_of` – usually the quickest start for a slide like an existing one. Returns it drawn and the new order of the slides.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        after: { type: 'integer', minimum: 0 },
        copy_of: slideNumber,
        xml: { type: 'string', description: 'The complete <draw:page> element.' },
        styles: { type: 'string', description: 'New styles, as for write_slide.' },
      },
      required: ['after'],
    },
  },
  {
    name: 'delete_slide',
    description: 'Removes a slide. Returns the new order of the slides.',
    input_schema: { type: 'object', properties: { slide: slideNumber }, required: ['slide'] },
  },
  {
    name: 'move_slide',
    description:
      'Moves a slide so that it becomes slide `to`. Returns the new order of the slides.',
    input_schema: {
      type: 'object',
      properties: { slide: slideNumber, to: slideNumber },
      required: ['slide', 'to'],
    },
  },
  {
    name: 'read_styles',
    description:
      'Shows styles, master pages, gradients etc. by name as XML. Without names: the deck’s common styles and master pages, one per line.',
    input_schema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'write_slide',
    description:
      'Replaces a slide with your <draw:page> XML, after adding your styles, and returns it drawn. Problems (unknown style, malformed XML, …) come back as an error to correct.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        slide: slideNumber,
        xml: { type: 'string', description: 'The complete <draw:page> element.' },
        styles: {
          type: 'string',
          description:
            'New styles as XML elements one after another: style:style, text:list-style and number styles (automatic styles), draw:gradient, draw:hatch, draw:marker, draw:stroke-dash, draw:opacity, draw:fill-image, style:presentation-page-layout (common styles). Each needs a name not used by the deck.',
        },
      },
      required: ['slide', 'xml'],
    },
  },
  {
    name: 'edit_slide',
    description:
      'Changes parts of a slide: replaces each `find` – XML copied exactly from the slide as last shown, occurring there once – by its `replace`, in order, after adding your styles, and returns the slide drawn. All edits apply or none; a `find` not there or there more than once comes back as an error.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        slide: slideNumber,
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', minLength: 1 },
              replace: { type: 'string' },
            },
            required: ['find', 'replace'],
          },
        },
        styles: { type: 'string', description: 'New styles, as for write_slide.' },
      },
      required: ['slide', 'edits'],
    },
  },
];

const STOCK_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_photos',
    description:
      'Searches Unsplash for stock photos (an English query of a few words). Returns the best few with id, description, size and photographer, and a small preview of each.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2 },
        orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'] },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_photo',
    description:
      'Makes a found photo available to write_slide and edit_slide, cut to `aspect` (the frame’s width / height), and returns its Pictures/… path and size in pixels. `alternatives`: up to two other good photos found – people can switch to them.',
    input_schema: {
      type: 'object',
      properties: {
        photo: { type: 'string', description: 'The id of the photo to use.' },
        alternatives: { type: 'array', items: { type: 'string' }, maxItems: MAX_ALTERNATIVES },
        aspect: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Width / height of the frame it goes into (e.g. 1.78 for 16:9).',
        },
      },
      required: ['photo', 'aspect'],
    },
  },
];

const viewInput = z.object({ slide: z.number().int().min(1) });
const searchPhotosInput = z.object({
  query: z.string().min(2).max(200),
  orientation: stockOrientationSchema.optional(),
});
const addPhotoInput = z.object({
  photo: z.string().min(1),
  alternatives: z.array(z.string().min(1)).max(MAX_ALTERNATIVES).default([]),
  aspect: z.number().min(0.1).max(10),
});
const searchInput = z.object({ query: z.string().min(1).max(500) });
const pictureInput = z.object({ path: z.string().max(500) });
const addPictureInput = z.object({ picture: z.number().int().min(1) });
const insertInput = z
  .object({
    after: z.number().int().min(0),
    copy_of: z.number().int().min(1).optional(),
    xml: z.string().optional(),
    styles: z.string().optional(),
  })
  .refine((input) => (input.copy_of === undefined) !== (input.xml === undefined), {
    message: 'Give either xml or copy_of.',
  });
const moveInput = z.object({ slide: z.number().int().min(1), to: z.number().int().min(1) });
const stylesInput = z.object({ names: z.array(z.string()).max(200).optional() });
const writeInput = z.object({
  slide: z.number().int().min(1),
  xml: z.string(),
  styles: z.string().optional(),
});
const editInput = z.object({
  slide: z.number().int().min(1),
  edits: z
    .array(z.object({ find: z.string().min(1), replace: z.string() }))
    .min(1)
    .max(500),
  styles: z.string().optional(),
});

/** Media types the model reads as pictures. */
const SHOWABLE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
type Showable = (typeof SHOWABLE)[number];
const isShowable = (type: string | null): type is Showable =>
  (SHOWABLE as readonly (string | null)[]).includes(type);

const imageBlock = (
  bytes: Uint8Array,
  mediaType: Showable = 'image/webp',
): Anthropic.Beta.BetaImageBlockParam => ({
  type: 'image',
  source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') },
});
const webpBlock = (bytes: Uint8Array) => imageBlock(bytes);

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ── Listing ──────────────────────────────────────────────────────────────

type ProposalRow = typeof aiProposals.$inferSelect;

function toDto(row: ProposalRow, now: Date, createdByName: string | null): AiProposal {
  const cutOff = row.status === 'running' && now.getTime() - row.createdAt.getTime() > CUT_OFF_MS;
  return {
    id: row.id,
    slideId: row.slideId,
    commentId: row.commentId,
    prompt: row.prompt,
    status: cutOff ? 'failed' : row.status,
    summary: row.summary ?? null,
    error: cutOff ? 'Die KI wurde unterbrochen. Bitte nochmal senden.' : row.error,
    photos: photosOf(row.changes),
    createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The stock photo a change put on a slide, for the thread. */
function photosOf(changes: readonly AiSlideChange[]): AiProposal['photos'] {
  const stock = changes.find((change) => change.stock)?.stock;
  if (!stock) return null;
  return {
    elementId: stock.elementId,
    aspect: stock.aspect,
    chosenId: stock.chosenId,
    candidates: stock.candidates.map(toStockPhoto),
  };
}

/**
 * The deck's proposals, shown in the comment threads that asked for them – to everyone who sees
 * the comments; taking one over needs the right to edit.
 */
export async function listProposals(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<AiProposal[]> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'view');
  if (!deck.currentRevisionId) return [];
  const now = deps.clock.now();
  const rows = await deps.db
    .select({ proposal: aiProposals, name: users.name })
    .from(aiProposals)
    .leftJoin(users, eq(users.id, aiProposals.createdById))
    .where(eq(aiProposals.revisionId, deck.currentRevisionId))
    .orderBy(desc(aiProposals.createdAt))
    .limit(200);
  return rows.map(({ proposal, name }) => toDto(proposal, now, name));
}

async function proposalOf(
  deps: AppDeps,
  target: EditTarget,
  proposalId: string,
): Promise<ProposalRow> {
  const [row] = await deps.db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.id, proposalId), eq(aiProposals.deckId, target.deck.id)));
  if (!row) throw notFound('Diesen Vorschlag gibt es nicht.');
  return row;
}

// ── Creating ─────────────────────────────────────────────────────────────

export async function createProposal(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: CreateAiProposalInput,
): Promise<AiProposal> {
  const target = await editTarget(deps, viewer, deckId);
  const ai = await workspaceAiConnection(deps, target.deck.workspaceId);
  if (ai.connection === null) throw new ApiError(409, 'ai_not_configured', ai.error);
  const { connection, keyId } = ai;
  const thread = await threadOf(deps, target.deck.id, input.commentId);
  if (!thread.asking.body.trim()) {
    throw badRequest('Schreib in den Kommentar, was die KI an der Folie ändern soll.');
  }
  const place = await commentPlace(deps, target, thread.root);
  const slideId = place.slideId;
  const prompt = await threadPrompt(deps, thread);

  const now = deps.clock.now();
  const [row] = await deps.db
    .insert(aiProposals)
    .values({
      id: crypto.randomUUID(),
      deckId: target.deck.id,
      revisionId: target.revision.id,
      slideId,
      commentId: thread.asking.id,
      prompt,
      status: 'running',
      baseSeq: target.revision.editSeq,
      createdById: viewer.author.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const proposal = row as ProposalRow;
  deps.live?.proposalsChanged(target.deck.id);
  const stopper = new AbortController();
  stoppers.set(proposal.id, stopper);
  // Past the limit it stops like a person stopped it – only with another reason.
  const limit = setTimeout(() => {
    void settle(deps, proposal, { status: 'failed', error: TIMED_OUT })
      .catch((error: unknown) => deps.log.warn(`AI proposal ${proposal.id} not timed out`, error))
      .finally(() => stopper.abort());
  }, AI_RUNNING_LIMIT_MS);
  limit.unref?.();
  void inSlot(() =>
    stopper.signal.aborted
      ? Promise.resolve()
      : runProposal(deps, viewer, target, proposal, place, connection, keyId, stopper.signal),
  )
    .catch((error: unknown) => deps.log.error(`AI proposal ${proposal.id} crashed`, error))
    .finally(() => {
      clearTimeout(limit);
      stoppers.delete(proposal.id);
    });
  return toDto(proposal, now, viewer.author.name);
}

type CommentRow = typeof comments.$inferSelect;

/** Where in the deck a thread is: the slides the AI sees first, and how to say it. */
interface CommentPlace {
  /** The commented slide – between two slides, the one before (else after) the place. */
  slideId: string;
  /** 0-based positions of the slides to show. */
  shown: number[];
  text: string;
}

async function commentPlace(
  deps: AppDeps,
  target: EditTarget,
  root: CommentRow,
): Promise<CommentPlace> {
  const gap = root.anchor.type === 'gap' ? root.anchor : null;
  const ids = (gap ? [gap.afterSlideId, gap.beforeSlideId] : [root.slideId]).filter(
    (id): id is string => id !== null,
  );
  const rows =
    ids.length === 0
      ? []
      : await deps.db
          .select({ slideId: slideVersions.slideId, position: slideVersions.position })
          .from(slideVersions)
          .where(
            and(
              eq(slideVersions.revisionId, target.revision.id),
              inArray(slideVersions.slideId, ids),
            ),
          );
  const position = (id: string | null) => rows.find((row) => row.slideId === id)?.position ?? null;
  if (!gap) {
    const at = position(root.slideId);
    if (at === null) throw badRequest('Diese Folie ist in der aktuellen Version nicht mehr da.');
    return { slideId: root.slideId!, shown: [at], text: `The comment is on slide ${at + 1}.` };
  }
  const after = position(gap.afterSlideId);
  const before = position(gap.beforeSlideId);
  if (after === null && before === null) {
    throw badRequest('Die Folien um diesen Kommentar sind in der aktuellen Version nicht mehr da.');
  }
  const text =
    after !== null && before === after + 1
      ? `The comment is between slide ${after + 1} and slide ${before + 1}.`
      : after !== null
        ? `The comment is after slide ${after + 1}.`
        : `The comment is before slide ${before! + 1}.`;
  return {
    slideId: (after !== null ? gap.afterSlideId : gap.beforeSlideId)!,
    shown: [after, before].filter((at): at is number => at !== null),
    text,
  };
}

interface ThreadAsk {
  root: CommentRow;
  /** The comment that asks the AI (the root or a reply). */
  asking: CommentRow;
  /** The thread up to and including it, oldest first. */
  messages: CommentRow[];
}

async function threadOf(deps: AppDeps, deckId: string, commentId: string): Promise<ThreadAsk> {
  const [asking] = await deps.db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.deckId, deckId)));
  if (!asking) throw notFound('Diesen Kommentar gibt es nicht.');
  const rootId = asking.parentId ?? asking.id;
  const messages = await deps.db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.deckId, deckId),
        or(eq(comments.id, rootId), eq(comments.parentId, rootId)),
        lte(comments.createdAt, asking.createdAt),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id));
  const root = messages.find((message) => message.id === rootId);
  if (!root) throw notFound('Diesen Kommentar gibt es nicht.');
  return { root, asking, messages };
}

/** Where on the slide a comment points, for the AI (shape ids are the element ids). */
function anchorText(anchor: Anchor): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const shape =
    'shapeRef' in anchor && anchor.shapeRef ? ` on element ${anchor.shapeRef.shapeId}` : '';
  if (anchor.type === 'point') {
    return ` [points at x ${pct(anchor.point.x)}, y ${pct(anchor.point.y)}${shape}]`;
  }
  if (anchor.type === 'rect') {
    const { x, y, w, h } = anchor.rect;
    return ` [marks the area x ${pct(x)}, y ${pct(y)}, w ${pct(w)}, h ${pct(h)}${shape}]`;
  }
  return '';
}

const PROPOSAL_OUTCOME: Record<AiProposal['status'], string> = {
  running: 'still working',
  ready: 'changed nothing',
  failed: 'failed',
  applied: 'applied',
  reverted: 'taken back by the people',
  discarded: 'discarded',
  cancelled: 'stopped by the people before you finished',
};

/** The thread as the AI reads it: who said what, its own earlier answers in between. */
async function threadPrompt(deps: AppDeps, thread: ThreadAsk): Promise<string> {
  const ids = thread.messages.map((message) => message.id);
  const earlier = await deps.db
    .select()
    .from(aiProposals)
    .where(inArray(aiProposals.commentId, ids))
    .orderBy(asc(aiProposals.createdAt));
  const lines: string[] = [];
  for (const message of thread.messages) {
    const marks = message.id === thread.root.id ? anchorText(message.anchor) : '';
    const body = message.body.trim() || '(recording or picture without text)';
    lines.push(`${message.author.name}${marks}: ${body}`);
    for (const proposal of earlier.filter((item) => item.commentId === message.id)) {
      const said = proposal.summary ?? proposal.error ?? '';
      lines.push(`You (AI, change ${PROPOSAL_OUTCOME[proposal.status]}): ${said}`.trim());
    }
  }
  const recent = lines.slice(-MAX_THREAD_MESSAGES);
  let text = recent.join('\n\n');
  // The last message is the request: if the thread is long, the oldest part goes.
  if (text.length > MAX_THREAD_CHARS) text = `…${text.slice(-MAX_THREAD_CHARS)}`;
  return text;
}

async function finish(
  deps: AppDeps,
  proposal: ProposalRow,
  values: Partial<ProposalRow>,
): Promise<void> {
  await deps.db
    .update(aiProposals)
    .set({ ...values, updatedAt: deps.clock.now() })
    .where(eq(aiProposals.id, proposal.id));
  deps.live?.proposalsChanged(proposal.deckId);
}

/** Like `finish`, unless someone stopped the run meanwhile – then it stays stopped. */
async function settle(
  deps: AppDeps,
  proposal: ProposalRow,
  values: Partial<ProposalRow>,
): Promise<void> {
  await deps.db
    .update(aiProposals)
    .set({ ...values, updatedAt: deps.clock.now() })
    .where(and(eq(aiProposals.id, proposal.id), eq(aiProposals.status, 'running')));
  deps.live?.proposalsChanged(proposal.deckId);
}

/** Whether someone stopped the run – here, or through another instance of the API. */
async function stopped(deps: AppDeps, proposal: ProposalRow, signal: AbortSignal) {
  if (signal.aborted) return true;
  const [row] = await deps.db
    .select({ status: aiProposals.status })
    .from(aiProposals)
    .where(eq(aiProposals.id, proposal.id));
  return row?.status !== 'running';
}

/** Why a slide can be neither seen nor written, for the AI. */
class ToolProblem extends Error {}

/** A picture attached to the comment thread, offered to the AI. */
interface ThreadPicture {
  mediaId: string;
  bytes: Uint8Array;
  mediaType: Showable;
  width: number;
  height: number;
  /** Who attached it. */
  from: string;
}

/** The pictures attached to the thread up to the asking comment – the latest few. */
async function threadPictures(
  deps: AppDeps,
  deckId: string,
  commentId: string,
): Promise<ThreadPicture[]> {
  const thread = await threadOf(deps, deckId, commentId);
  const authors = new Map(thread.messages.map((message) => [message.id, message.author.name]));
  const rows = await deps.db
    .select()
    .from(media)
    .where(and(inArray(media.commentId, [...authors.keys()]), eq(media.kind, 'image')))
    .orderBy(asc(media.createdAt), asc(media.position));
  const pictures: ThreadPicture[] = [];
  for (const row of rows.slice(-MAX_THREAD_PICTURES)) {
    if (row.sizeBytes > MAX_SHOWN_PICTURE_BYTES) continue;
    const bytes = await deps.media.get(row.storageKey);
    const size = bytes && imageSize(bytes);
    if (!bytes || !size || !isShowable(size.mediaType)) continue;
    pictures.push({
      mediaId: row.id,
      bytes,
      mediaType: size.mediaType,
      width: size.width,
      height: size.height,
      from: authors.get(row.commentId) ?? '',
    });
  }
  return pictures;
}

/**
 * The deck as the AI works on it: a copy of the file its changes go to, and – by page id, so
 * they stay with a slide that moves – the slides it wrote, added, moved or removed, how they
 * look, the styles it added.
 */
class DeckCopy {
  private bytes: Uint8Array;
  private document: OdpDocument;
  private readonly drawn = new Map<string, Uint8Array | null>();
  /** Slides written or added, and slides moved. */
  private readonly written = new Set<string>();
  private readonly moved = new Set<string>();
  readonly ownStyles = new Set<string>();
  /** Thread pictures made available by path; a write puts in those it shows. */
  private readonly added = new Map<string, ThreadPicture>();
  /** Photo searches so far, and the photos they found, by id. */
  private photoSearches = 0;
  private readonly found = new Map<string, StockPhotoRecord>();
  /** Stock photos made available by path (edit pictures of the deck); the last one counts. */
  private readonly photos = new Map<
    string,
    { imageId: string; bytes: Uint8Array; mediaType: string }
  >();
  private photo: Omit<AiStockPhotos, 'elementId' | 'reported'> | null = null;

  private constructor(
    private readonly deps: AppDeps,
    private readonly target: EditTarget,
    readonly base: OdpDocument,
    bytes: Uint8Array,
    document: OdpDocument,
    /** The stored drawing of each slide of the file, by page id. */
    private readonly pictures: ReadonlyMap<string, string>,
    readonly threadPictures: readonly ThreadPicture[],
    /** How the ids of elements and slides it adds begin – its own, see `OdpDocument.idPrefix`. */
    private readonly idPrefix: string,
  ) {
    this.bytes = bytes;
    this.document = document;
  }

  static async open(
    deps: AppDeps,
    target: EditTarget,
    threadPictures: readonly ThreadPicture[] = [],
    idPrefix = 'sl',
  ): Promise<DeckCopy> {
    const bytes = await readFile(deps, target.revision.pptxKey);
    const versions = await deps.db
      .select({ imageKey: slideVersions.imageKey })
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, target.revision.id))
      .orderBy(asc(slideVersions.position));
    // Page ids as every other reading of this file gets them (`ensureIds` is the same each time).
    const base = await OdpDocument.open(bytes);
    base.ensureIds();
    const document = await OdpDocument.open(bytes);
    document.ensureIds();
    const pictures = new Map<string, string>();
    base.pageIds().forEach((pageId, index) => {
      const key = versions[index]?.imageKey;
      if (key?.endsWith('.webp')) pictures.set(pageId, key);
    });
    document.idPrefix = idPrefix;
    return new DeckCopy(deps, target, base, bytes, document, pictures, threadPictures, idPrefix);
  }

  /**
   * The copy again on the deck as it is now, with its changes merged in – those that fit with
   * what others changed meanwhile. The slides where someone changed the same thing another way
   * stay as they are now: the AI does its part there again.
   */
  async rebase(viewer: Viewer): Promise<{ deck: DeckCopy; conflicts: ChangeConflict[] }> {
    const target = await editTarget(this.deps, viewer, this.target.deck.id);
    if (target.revision.id !== this.target.revision.id) {
      throw badRequest(
        'Die Präsentation ist inzwischen in einer neuen Version da – bitte nochmal senden.',
      );
    }
    const deck = await DeckCopy.open(this.deps, target, this.threadPictures, this.idPrefix);
    const document = deck.document;
    let outcome: Awaited<ReturnType<typeof applyChanges>>;
    try {
      outcome = await applyChanges(this.deps, target.deck.id, document, this.changes(), 'apply', {
        partial: true,
      });
    } catch (error) {
      if (error instanceof OdpError) throw badRequest(error.message);
      throw error;
    }
    deck.bytes = await document.toBytes();
    for (const pageId of outcome.written) deck.written.add(pageId);
    for (const pageId of outcome.moved) deck.moved.add(pageId);
    for (const name of this.ownStyles) deck.ownStyles.add(outcome.renames.get(name) ?? name);
    for (const [path, picture] of this.added) deck.added.set(path, picture);
    for (const [path, photo] of this.photos) deck.photos.set(path, photo);
    for (const [id, photo] of this.found) deck.found.set(id, photo);
    deck.photo = this.photo;
    deck.photoSearches = this.photoSearches;
    return { deck, conflicts: outcome.conflicts };
  }

  get slides() {
    return this.document.slides();
  }

  private index(slide: number): number {
    if (slide > this.slides.length) {
      throw new ToolProblem(`There is no slide ${slide}; the deck has ${this.slides.length}.`);
    }
    return slide - 1;
  }

  /** The slides by number and title, as the AI reads the deck. */
  outline(): string {
    return this.slides
      .map((item) => `${item.index + 1}. ${item.title}${item.hidden ? ' (hidden)' : ''}`)
      .join('\n');
  }

  /** A slide as the AI sees it: drawn, its XML, the styles it names. */
  async view(slide: number): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const index = this.index(slide);
    const info = this.slides[index]!;
    const pageId = info.pageId ?? '';
    const stored = this.pictures.get(pageId);
    const picture = this.drawn.has(pageId)
      ? this.drawn.get(pageId)
      : this.written.has(pageId)
        ? await this.draw(this.bytes, this.slides, index)
        : stored
          ? await this.deps.storage.get(stored)
          : null;
    if (!this.drawn.has(pageId) && this.written.has(pageId))
      this.drawn.set(pageId, picture ?? null);
    const names = this.document.styleNamesOf(index);
    const styles = this.document.stylesXml(names);
    const inline = styles.xml.join('\n');
    return [
      {
        type: 'text',
        text: `Slide ${slide}${info.hidden ? ' (hidden, not drawn)' : ''}:`,
      },
      ...(picture ? [webpBlock(picture)] : []),
      { type: 'text', text: `Its XML:\n${this.document.slideXml(index)}` },
      {
        type: 'text',
        text:
          inline.length <= MAX_INLINE_STYLES
            ? `The styles it names (master pages: read_styles):\n${inline}`
            : `It names these styles (read_styles shows them): ${names.join(', ')}`,
      },
    ];
  }

  styles(names: readonly string[] | undefined): string {
    if (!names || names.length === 0) return this.document.styleCatalog().join('\n');
    const { xml, missing } = this.document.stylesXml(names);
    return [...xml, ...(missing.length > 0 ? [`Not found: ${missing.join(', ')}`] : [])].join('\n');
  }

  search(query: string): string {
    const { places, total } = this.document.search(query, MAX_SEARCH_PLACES);
    if (total === 0) return `Nothing found for “${query}”.`;
    return [
      ...places.map((place) => `${place.where}: ${place.excerpt}`),
      ...(total > places.length
        ? [`… and ${total - places.length} more places – search for something more precise.`]
        : []),
    ].join('\n\n');
  }

  async listPictures(): Promise<string> {
    const lines = (await this.document.pictures()).map((picture) =>
      [
        picture.path,
        picture.mediaType ?? 'unknown type',
        picture.width && picture.height ? `${picture.width} × ${picture.height} px` : null,
        kb(picture.bytes),
        picture.usedBy.length > 0 ? `shown by ${picture.usedBy.join(', ')}` : 'not shown',
      ]
        .filter(Boolean)
        .join(' | '),
    );
    const thread = this.threadPictures.map(
      (picture, i) =>
        `${i + 1}. from ${picture.from} | ${picture.mediaType} | ${picture.width} × ${picture.height} px`,
    );
    return [
      lines.length > 0 ? lines.join('\n') : 'The file has no pictures.',
      ...(thread.length > 0
        ? [`\nPictures of the thread (add_picture):\n${thread.join('\n')}`]
        : []),
    ].join('\n');
  }

  async viewPicture(path: string): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const bytes =
      this.added.get(path)?.bytes ??
      this.photos.get(path)?.bytes ??
      (await this.document.picture(path));
    if (!bytes) throw new ToolProblem(`There is no picture ${path} in the file.`);
    const size = imageSize(bytes);
    if (!size || !isShowable(size.mediaType)) {
      throw new ToolProblem(
        `${path} is no PNG, JPEG, GIF or WebP picture and cannot be shown here – look at a slide that shows it.`,
      );
    }
    if (bytes.length > MAX_SHOWN_PICTURE_BYTES) {
      throw new ToolProblem(`${path} is too large to show here – look at a slide that shows it.`);
    }
    return [
      { type: 'text', text: `${path} (${size.width} × ${size.height} px):` },
      imageBlock(bytes, size.mediaType),
    ];
  }

  /** Makes a thread picture available to writes, by the path it will have in the file. */
  addPicture(number: number): string {
    const picture = this.threadPictures[number - 1];
    if (!picture) {
      throw new ToolProblem(
        this.threadPictures.length === 0
          ? 'The thread has no pictures.'
          : `There is no picture ${number}; the thread has ${this.threadPictures.length}.`,
      );
    }
    // Only names it here; write puts it into the file once a slide shows it.
    const path = this.document.addPicture(picture.bytes, picture.mediaType);
    this.added.set(path, picture);
    return `Picture ${number} can be used as ${path} (${picture.width} × ${picture.height} px), e.g. <draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/> in a draw:frame.`;
  }

  /** Stock photos for a search, shown small – their ids for {@link addPhoto}. */
  async searchPhotos(
    query: string,
    orientation: StockOrientation | undefined,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    if (this.photoSearches >= MAX_PHOTO_SEARCHES) {
      throw new ToolProblem('No more searches – take one of the photos found.');
    }
    this.photoSearches += 1;
    const photos = (await searchPhotos(this.deps, query, { orientation })).slice(0, PHOTOS_SHOWN);
    if (photos.length === 0) return `Nothing found for “${query}” – try other words.`;
    for (const photo of photos) this.found.set(photo.id, photo);
    return photos.flatMap((photo): Anthropic.Beta.BetaContentBlockParam[] => [
      {
        type: 'text',
        text: `${photo.id}: ${photo.description ?? 'no description'} (${photo.width} × ${photo.height} px, by ${photo.credit.name})`,
      },
      { type: 'image', source: { type: 'url', url: stockPhotoUrl(photo, 300) } },
    ]) as Anthropic.Beta.BetaToolResultBlockParam['content'];
  }

  /** Fetches a found photo cut to `aspect` and makes it available to writes, by its path. */
  async addPhoto(id: string, alternatives: readonly string[], aspect: number): Promise<string> {
    const pick = (photoId: string) => {
      const photo = this.found.get(photoId);
      if (!photo) throw new ToolProblem(`There is no photo ${photoId} in your searches.`);
      return photo;
    };
    const chosen = pick(id);
    const others = [...new Set(alternatives)].filter((other) => other !== id).map(pick);
    const fetched = await fetchPhoto(this.deps, this.target.deck.id, chosen, aspect);
    // Only names it here; write puts it into the file once a slide shows it.
    const path = this.document.addPicture(fetched.bytes, fetched.mediaType);
    this.photos.set(path, fetched);
    this.photo = {
      path,
      imageId: fetched.imageId,
      aspect,
      chosenId: chosen.id,
      candidates: [chosen, ...others],
    };
    return `The photo can be used as ${path} (${fetched.width} × ${fetched.height} px), e.g. <draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/> in a draw:frame of width / height ${aspect.toFixed(2)}. Its credit is added to the frame for you.`;
  }

  /** Writes the stock photo's credit into the frames that show it. */
  async creditPhoto(): Promise<void> {
    const photo = this.photo;
    const credit = photo && this.found.get(photo.chosenId)?.credit;
    if (!photo || !credit) return;
    let pages: string[] = [];
    await this.change((document) => {
      pages = document.creditPicture(photo.path, credit);
      return null;
    });
    for (const pageId of pages) if (pageId) this.written.add(pageId);
  }

  /**
   * Changes the copy – `change` gets a fresh document of it and returns the page id of the slide
   * to draw, if any – and draws that slide; problems throw for the AI to correct.
   */
  private async change(
    change: (document: OdpDocument) => string | null,
  ): Promise<{ pageId: string | null; picture: Uint8Array | null }> {
    const document = await OdpDocument.open(this.bytes);
    document.ensureIds();
    document.idPrefix = this.idPrefix;
    let pageId: string | null;
    try {
      pageId = change(document);
    } catch (error) {
      if (error instanceof OdpError) throw new ToolProblem(error.message);
      throw error;
    }
    const bytes = await document.toBytes();
    const index = pageId === null ? -1 : document.pageIds().indexOf(pageId);
    const picture = index === -1 ? null : await this.draw(bytes, document.slides(), index);
    this.bytes = bytes;
    this.document = document;
    if (pageId !== null) this.drawn.set(pageId, picture);
    return { pageId, picture };
  }

  /** Slide `index` of the file `bytes` drawn by LibreOffice (`null` when hidden). */
  private async draw(
    bytes: Uint8Array,
    slides: OdpSlide[],
    index: number,
  ): Promise<Uint8Array | null> {
    if (slides[index]?.hidden) return null;
    let keys;
    try {
      keys = (await drawSlides(this.deps, this.target, bytes, slides, [index])).get(index);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      throw new ToolProblem(
        'LibreOffice could not draw the deck with this slide – the XML is probably not valid ODF.',
      );
    }
    if (!keys) return null;
    const picture = await this.deps.storage.get(keys.imageKey);
    await this.deps.storage.delete(keys.imageKey).catch(() => {});
    await this.deps.storage.delete(keys.thumbnailKey).catch(() => {});
    return picture;
  }

  /** Puts the thread pictures the XML shows and the styles into a document; returns the names. */
  private prepare(document: OdpDocument, xml: string, styles: string | undefined): string[] {
    for (const [path, picture] of [...this.added, ...this.photos]) {
      if (xml.includes(path) || styles?.includes(path)) {
        document.addPicture(picture.bytes, picture.mediaType);
      }
    }
    return styles?.trim() ? document.addStyles(styles, { replace: this.ownStyles }) : [];
  }

  private drawnResult(
    slide: number,
    picture: Uint8Array | null,
    what: string,
  ): (Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam)[] {
    return [
      {
        type: 'text',
        text: picture ? `Slide ${slide} ${what}:` : `Slide ${slide} ${what} (hidden, not drawn).`,
      },
      ...(picture ? [webpBlock(picture)] : []),
    ];
  }

  /** Writes a slide into the copy and draws it. */
  async write(
    slide: number,
    xml: string,
    styles: string | undefined,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const index = this.index(slide);
    let added: string[] = [];
    const { pageId, picture } = await this.change((document) => {
      added = this.prepare(document, xml, styles);
      document.replaceSlide(index, xml);
      return document.pageIds()[index] as string;
    });
    this.written.add(pageId as string);
    for (const name of added) this.ownStyles.add(name);
    return this.drawnResult(slide, picture, 'now');
  }

  /** Changes pieces of a slide's XML – each found exactly once – and writes and draws it. */
  async edit(
    slide: number,
    edits: { find: string; replace: string }[],
    styles: string | undefined,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    let xml = this.document.slideXml(this.index(slide));
    for (const [i, { find, replace }] of edits.entries()) {
      const at = xml.indexOf(find);
      const which = edits.length > 1 ? `Edit ${i + 1}: its find` : 'The find';
      if (at === -1) {
        throw new ToolProblem(
          `${which} is not in slide ${slide}'s XML${i > 0 ? ' after the edits before it' : ''} – copy it exactly from the XML view_slide shows. Nothing was changed.`,
        );
      }
      if (xml.includes(find, at + 1)) {
        throw new ToolProblem(
          `${which} occurs more than once in slide ${slide}'s XML – include more around it. Nothing was changed.`,
        );
      }
      xml = xml.slice(0, at) + replace + xml.slice(at + find.length);
    }
    return this.write(slide, xml, styles);
  }

  /** Adds a slide after slide `after` (0: first) – written, or a copy of a slide – and draws it. */
  async insert(
    after: number,
    source: { xml: string; styles?: string } | { copyOf: number },
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    if (after > this.slides.length) {
      throw new ToolProblem(`There is no slide ${after}; the deck has ${this.slides.length}.`);
    }
    let added: string[] = [];
    const { pageId, picture } = await this.change((document) => {
      if ('copyOf' in source) return document.duplicateSlide(this.index(source.copyOf), after);
      added = this.prepare(document, source.xml, source.styles);
      return document.insertSlide(after, source.xml);
    });
    this.written.add(pageId as string);
    for (const name of added) this.ownStyles.add(name);
    return [
      ...this.drawnResult(after + 1, picture, 'added'),
      { type: 'text', text: `The deck's slides now:\n${this.outline()}` },
    ];
  }

  async remove(slide: number): Promise<string> {
    const index = this.index(slide);
    await this.change((document) => {
      document.removeSlide(index);
      return null;
    });
    return `Slide ${slide} removed. The deck's slides now:\n${this.outline()}`;
  }

  async move(slide: number, to: number): Promise<string> {
    const index = this.index(slide);
    const target = this.index(to);
    const pageId = this.slides[index]?.pageId as string;
    await this.change((document) => {
      document.moveSlide(index, target);
      return null;
    });
    this.moved.add(pageId);
    return `Slide ${slide} is now slide ${to}. The deck's slides now:\n${this.outline()}`;
  }

  /**
   * What the AI changed, by page id: slides it wrote or added (their XML before and after),
   * moved, or removed – with their positions before and after – and the styles and pictures
   * they need.
   */
  changes(): AiSlideChange[] {
    const styles = this.document.stylesXml([...this.ownStyles]).xml;
    const before = this.base.pageIds();
    const after = this.document.pageIds();
    const touched = new Set([
      ...this.written,
      ...this.moved,
      ...before.filter((pageId) => !after.includes(pageId)),
    ]);
    const changes: AiSlideChange[] = [];
    for (const pageId of touched) {
      const from = before.indexOf(pageId);
      const to = after.indexOf(pageId);
      const old = from === -1 ? null : this.base.slideXml(from);
      const now = to === -1 ? null : this.document.slideXml(to);
      if (old === null && now === null) continue;
      if (old === now && (from === to || !this.moved.has(pageId))) continue;
      const shows = (path: string) =>
        Boolean(now?.includes(path) || (now && styles.some((xml) => xml.includes(path))));
      const pictures: NonNullable<AiSlideChange['pictures']> = [
        ...[...this.added]
          .filter(([path]) => shows(path))
          .map(([path, picture]) => ({ path, mediaId: picture.mediaId })),
        ...[...this.photos]
          .filter(([path]) => shows(path))
          .map(([path, photo]) => ({ path, imageId: photo.imageId })),
      ];
      const photo = this.photo;
      const stock: AiStockPhotos | null =
        photo && now?.includes(photo.path)
          ? { ...photo, elementId: frameIdShowing(now, photo.path), reported: [] }
          : null;
      changes.push({
        pageId,
        index: to === -1 ? from : to,
        before: old,
        after: now,
        beforeIndex: from === -1 ? null : from,
        afterIndex: to === -1 ? null : to,
        styles,
        ...(pictures.length > 0 ? { pictures } : {}),
        // One slide carries the photo and its choices.
        ...(stock && !changes.some((other) => other.stock) ? { stock } : {}),
      });
    }
    return changes.sort((a, b) => a.index - b.index);
  }
}

async function runTool(
  deck: DeckCopy,
  call: Anthropic.Beta.BetaToolUseBlock,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const result = (
    content: Anthropic.Beta.BetaToolResultBlockParam['content'],
    isError = false,
  ) => ({
    type: 'tool_result' as const,
    tool_use_id: call.id,
    content,
    ...(isError ? { is_error: true } : {}),
  });
  try {
    if (call.name === 'view_slide') {
      const input = viewInput.parse(call.input);
      return result(await deck.view(input.slide));
    }
    if (call.name === 'search_deck') {
      return result(deck.search(searchInput.parse(call.input).query));
    }
    if (call.name === 'list_pictures') {
      return result(await deck.listPictures());
    }
    if (call.name === 'view_picture') {
      return result(await deck.viewPicture(pictureInput.parse(call.input).path));
    }
    if (call.name === 'add_picture') {
      return result(deck.addPicture(addPictureInput.parse(call.input).picture));
    }
    if (call.name === 'search_photos') {
      const input = searchPhotosInput.parse(call.input);
      return result(await deck.searchPhotos(input.query, input.orientation));
    }
    if (call.name === 'add_photo') {
      const input = addPhotoInput.parse(call.input);
      return result(await deck.addPhoto(input.photo, input.alternatives, input.aspect));
    }
    if (call.name === 'insert_slide') {
      const input = insertInput.parse(call.input);
      return result(
        await deck.insert(
          input.after,
          input.copy_of !== undefined
            ? { copyOf: input.copy_of }
            : { xml: input.xml as string, styles: input.styles },
        ),
      );
    }
    if (call.name === 'delete_slide') {
      return result(await deck.remove(viewInput.parse(call.input).slide));
    }
    if (call.name === 'move_slide') {
      const input = moveInput.parse(call.input);
      return result(await deck.move(input.slide, input.to));
    }
    if (call.name === 'read_styles') {
      const input = stylesInput.parse(call.input);
      return result(deck.styles(input.names) || 'None.');
    }
    if (call.name === 'write_slide') {
      const input = writeInput.parse(call.input);
      return result(await deck.write(input.slide, input.xml, input.styles));
    }
    if (call.name === 'edit_slide') {
      const input = editInput.parse(call.input);
      return result(await deck.edit(input.slide, input.edits, input.styles));
    }
    return result(`There is no tool ${call.name}.`, true);
  } catch (error) {
    if (error instanceof ToolProblem) return result(error.message, true);
    // Unsplash out of reach or out of requests: the AI goes on without a photo.
    if (error instanceof ApiError && ['search_photos', 'add_photo'].includes(call.name)) {
      return result(`Stock photos are not available right now: ${error.message}`, true);
    }
    if (error instanceof z.ZodError)
      return result(`Invalid input: ${error.message.slice(0, 800)}`, true);
    throw error;
  }
}

/** The other requests at work on the deck right now, for the AI: the slide and what they ask. */
async function othersAtWork(
  deps: AppDeps,
  target: EditTarget,
  proposal: ProposalRow,
): Promise<string[]> {
  const since = new Date(deps.clock.now().getTime() - CUT_OFF_MS);
  const rows = await deps.db
    .select({
      id: aiProposals.id,
      prompt: aiProposals.prompt,
      position: slideVersions.position,
    })
    .from(aiProposals)
    .leftJoin(
      slideVersions,
      and(
        eq(slideVersions.revisionId, aiProposals.revisionId),
        eq(slideVersions.slideId, aiProposals.slideId),
      ),
    )
    .where(
      and(
        eq(aiProposals.revisionId, target.revision.id),
        eq(aiProposals.status, 'running'),
        ne(aiProposals.id, proposal.id),
        // Runs cut off by a restart stay `running`: they must not take the places.
        gte(aiProposals.createdAt, since),
      ),
    )
    .orderBy(asc(aiProposals.createdAt))
    .limit(MAX_OTHERS_SHOWN);
  return rows.map((row) => {
    // The thread ends with the request; its last message is enough here.
    const ask = row.prompt.split('\n\n').at(-1)?.trim() ?? '';
    const short = ask.length > 200 ? `${ask.slice(0, 200)}…` : ask;
    return `- ${row.position === null ? 'a slide' : `slide ${row.position + 1}`}: ${short}`;
  });
}

/** What the AI hears when its change met someone else's: where, and those slides as they are now. */
async function conflictNote(
  deck: DeckCopy,
  conflicts: readonly ChangeConflict[],
): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const lines = conflicts.map((conflict) => {
    const slide =
      conflict.index === null ? 'A slide no longer there' : `Slide ${conflict.index + 1}`;
    const places = conflict.places.map((place) => {
      const element = place.elementId
        ? `element ${place.elementId}${place.name ? ` (${place.name})` : ''}`
        : 'the slide itself';
      return `${element}: ${place.what}`;
    });
    return `- ${slide}: ${conflict.reason}${places.length > 0 ? ` Both changed ${places.join('; ')}.` : ''}`;
  });
  const shown = [
    ...new Set(
      conflicts.flatMap((conflict) => (conflict.index === null ? [] : [conflict.index + 1])),
    ),
  ];
  const views = [];
  for (const slide of shown)
    views.push(...((await deck.view(slide)) as Anthropic.Beta.BetaContentBlockParam[]));
  return [
    {
      type: 'text',
      text: `While you worked, others changed the deck too. Your changes were merged with theirs and are in place – except here, where someone changed the same things:\n${lines.join('\n')}\n\nThe deck's slides now:\n${deck.outline()}\n\n${shown.length > 0 ? 'Those slides as they are now follow. ' : ''}Do your part of the request there again on top of what is there now, keeping what the others did – unless their change already does what was asked. Then stop and reply as before.`,
    },
    ...views,
  ];
}

async function runProposal(
  deps: AppDeps,
  viewer: Viewer,
  target: EditTarget,
  proposal: ProposalRow,
  place: CommentPlace,
  connection: AiConnection,
  /** The workspace key it runs on: refused, it is marked so. */
  keyId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const pictures = proposal.commentId
      ? await threadPictures(deps, target.deck.id, proposal.commentId)
      : [];
    // Ids of its own for what it adds, so they never meet another request's.
    let deck = await DeckCopy.open(deps, target, pictures, `ai${proposal.id.slice(0, 8)}-`);
    const outline = deck.outline();
    const size = deck.base.pageSize();
    const others = await othersAtWork(deps, target, proposal);
    const shown: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const at of place.shown) {
      shown.push(...((await deck.view(at + 1)) as Anthropic.Beta.BetaContentBlockParam[]));
    }

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `The deck's slides (${size.width} × ${size.height} cm):\n${outline}\n\n${place.text}`,
          },
          ...shown,
          {
            type: 'text',
            text: `The comment thread (the last message asks you):\n${proposal.prompt}`,
          },
          ...(others.length > 0
            ? [
                {
                  type: 'text' as const,
                  text: `Other requests at work on the deck right now – leave what they are about to them:\n${others.join('\n')}`,
                },
              ]
            : []),
          ...pictures.flatMap((picture, i): Anthropic.Beta.BetaContentBlockParam[] => [
            {
              type: 'text',
              text: `${i === 0 ? 'Pictures attached to the thread (add_picture puts one on a slide).\n' : ''}Picture ${i + 1}, from ${picture.from} (${picture.width} × ${picture.height} px):`,
            },
            imageBlock(picture.bytes, picture.mediaType),
          ]),
        ],
      },
    ];

    const stock = stockSource(deps) !== null;
    /** The AI at work until it stops: its last words, or `null` when it refused. */
    const converse = async (
      turns: number,
    ): Promise<{ refused: boolean; summary: string | null }> => {
      for (let turn = 0; turn < turns; turn += 1) {
        // Stopped through another instance of the API too: no further paid turn.
        if (await stopped(deps, proposal, signal)) return { refused: false, summary: null };
        const message = await runTurn(deps, connection, {
          system: systemPrompt(stock),
          tools: stock ? [...TOOLS, ...STOCK_TOOLS] : TOOLS,
          messages,
          taskBudgetTokens: TASK_BUDGET_TOKENS,
          signal,
        });
        if (message.stop === 'refusal') return { refused: true, summary: null };
        messages.push({ role: 'assistant', content: message.content });
        const calls = message.content.filter(
          (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
        );
        if (calls.length === 0) {
          // Done: its last words are the summary.
          const summary = message.content
            .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
            .trim();
          return { refused: false, summary };
        }
        if (message.stop === 'max_tokens') {
          messages.push({
            role: 'user',
            content: calls.map((call) => ({
              type: 'tool_result' as const,
              tool_use_id: call.id,
              is_error: true,
              content:
                'Your output was cut off. Write one slide per call – or change only the parts of it the request is about with edit_slide.',
            })),
          });
          continue;
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          if (signal.aborted) return { refused: false, summary: null };
          results.push(await runTool(deck, call));
        }
        messages.push({ role: 'user', content: results });
      }
      return { refused: false, summary: null };
    };
    /** Tells the AI something after its last turn – in the last user message if that is one. */
    const tell = (content: Anthropic.Beta.BetaContentBlockParam[]) => {
      const last = messages.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(...content);
      else messages.push({ role: 'user', content });
    };

    let summary: string | null = null;
    let talk = true;
    for (let rebases = 0; ; rebases += 1) {
      if (talk) {
        const outcome = await converse(rebases === 0 ? MAX_TURNS : MAX_REBASE_TURNS);
        if (outcome.refused) {
          await settle(deps, proposal, {
            status: 'failed',
            error: 'Die KI hat diesen Auftrag abgelehnt.',
          });
          return;
        }
        summary = outcome.summary || summary;
        await deck.creditPhoto();
      }
      // Stopped: nothing it did reaches the deck.
      if (await stopped(deps, proposal, signal)) return;
      const changes = deck.changes();
      if (changes.length === 0) {
        await settle(deps, proposal, {
          status: 'ready',
          summary: summary || 'Die KI hat nichts geändert.',
        });
        return;
      }
      try {
        const written = await writeChanges(
          deps,
          viewer,
          target.deck.id,
          changes,
          'apply',
          'Die Folie wurde gleichzeitig an derselben Stelle geändert – bitte nochmal senden.',
        );
        // Only while it still runs: stopped meanwhile (or past the limit), it goes back.
        const [applied] = await deps.db
          .update(aiProposals)
          .set({
            status: 'applied',
            appliedSeq: written.seq,
            error: null,
            changes: written.changes,
            summary,
            updatedAt: deps.clock.now(),
          })
          .where(and(eq(aiProposals.id, proposal.id), eq(aiProposals.status, 'running')))
          .returning({ id: aiProposals.id });
        if (!applied) {
          await takeBackStopped(deps, viewer, target.deck.id, proposal, written);
          return;
        }
        deps.live?.proposalsChanged(proposal.deckId);
        await moveThread(deps, proposal, written.changes, 'apply');
        return;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error instanceof MergeConflict && rebases < MAX_REBASES) {
          // Its part again on the deck as it is now: what fits goes in, the rest it does again.
          const rebased = await deck.rebase(viewer);
          deck = rebased.deck;
          talk = rebased.conflicts.length > 0;
          if (talk) tell(await conflictNote(deck, rebased.conflicts));
          continue;
        }
        await settle(deps, proposal, {
          status: 'failed',
          error: `Die Änderung ließ sich nicht anwenden: ${error.message}`,
          changes,
          summary,
        });
        return;
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    const problem = keyProblem(error, connection);
    if (problem) await markKeyRefused(deps, keyId, problem);
    else if (!isProviderError(error)) deps.log.warn(`AI proposal ${proposal.id} failed`, error);
    await settle(deps, proposal, {
      status: 'failed',
      error: problem ?? failureMessage(error, connection),
    });
  }
}

// ── Stopping ─────────────────────────────────────────────────────────────

/** Stops the AI at work on a comment: nothing it did so far reaches the deck. */
export async function cancelProposal(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
): Promise<void> {
  const target = await editTarget(deps, viewer, deckId);
  const proposal = await proposalOf(deps, target, proposalId);
  const [row] = await deps.db
    .update(aiProposals)
    .set({ status: 'cancelled', error: null, updatedAt: deps.clock.now() })
    .where(and(eq(aiProposals.id, proposal.id), eq(aiProposals.status, 'running')))
    .returning({ id: aiProposals.id });
  if (!row) throw badRequest('Die KI ist damit schon fertig.');
  stoppers.get(proposal.id)?.abort();
  deps.live?.proposalsChanged(proposal.deckId);
}

// ── Taking back, applying again ──────────────────────────────────────────

const CHANGED_SINCE =
  'Die Folie wurde seitdem weiter bearbeitet – das geht nur noch mit „Rückgängig“ im Bearbeiten-Panel.';

const PICTURE_GONE =
  'Ein Bild aus dem Kommentar, das die Änderung zeigt, gibt es nicht mehr – bitte die KI nochmal fragen.';

/** Puts a picture attached to a comment of the deck into the file; returns its path there. */
async function addThreadPicture(
  deps: AppDeps,
  deckId: string,
  document: OdpDocument,
  mediaId: string,
): Promise<string> {
  const [row] = await deps.db
    .select({ storageKey: media.storageKey })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.deckId, deckId), eq(media.kind, 'image')));
  const bytes = row && (await deps.media.get(row.storageKey));
  const size = bytes && imageSize(bytes);
  if (!bytes || !size) throw badRequest(PICTURE_GONE);
  return document.addPicture(bytes, size.mediaType);
}

/** Puts a stock photo the AI fetched (an edit picture of the deck) into the file. */
async function addEditPicture(
  deps: AppDeps,
  deckId: string,
  document: OdpDocument,
  imageId: string,
): Promise<string> {
  const image = await loadEditImage(deps, deckId, imageId);
  if (!image) throw badRequest(PICTURE_GONE);
  return document.addPicture(image.bytes, image.mediaType);
}

/** A slide of a change that did not fit with what others changed meanwhile. */
interface ChangeConflict {
  pageId: string;
  /** Its 0-based position in the deck now, `null` when it is not there. */
  index: number | null;
  /** What happened, for the AI. */
  reason: string;
  /** Where both changed the same thing, if that was it. */
  places: SlideConflict[];
}

/** A change could not go in: someone changed the same things meanwhile. */
class MergeConflict extends ApiError {
  constructor(
    readonly conflicts: ChangeConflict[],
    message: string,
  ) {
    super(400, 'bad_request', message);
  }
}

/**
 * Puts the slides of a change into `document` – `after` (apply) or `before` (revert) – merged
 * with what others changed on them since: each slide three ways, from the side the change
 * started from. Slides that do not fit (the same thing changed two ways, a slide changed that
 * the change removes, …) are returned; with `partial` the others still go in, else nothing does.
 * Applying, the change's styles come along – renamed where another style took the name – and
 * the change is returned as it went in.
 */
async function applyChanges(
  deps: AppDeps,
  deckId: string,
  document: OdpDocument,
  changes: readonly AiSlideChange[],
  direction: 'apply' | 'revert',
  { partial = false }: { partial?: boolean } = {},
): Promise<{
  conflicts: ChangeConflict[];
  changes: AiSlideChange[];
  renames: Map<string, string>;
  /** Page ids of the slides written, and of those moved. */
  written: string[];
  moved: string[];
}> {
  const styles = changes[0]?.styles ?? [];
  const renames =
    direction === 'apply' && styles.length > 0
      ? document.addOwnStyles(styles.join(''))
      : new Map<string, string>();
  const changed = changes.map((change) =>
    renames.size === 0
      ? change
      : {
          ...change,
          after: change.after === null ? null : renameStyles(change.after, renames),
          styles: change.styles.map((xml) => renameStyles(xml, renames, { own: true })),
        },
  );

  const ids = document.pageIds();
  const conflicts: ChangeConflict[] = [];
  const sides: { pageId: string; to: string | null; xml?: string; at: number | null }[] = [];
  for (const change of changed) {
    const [from, to, at] =
      direction === 'apply'
        ? [change.before, change.after, change.afterIndex]
        : [change.after, change.before, change.beforeIndex];
    const index = change.pageId ? ids.indexOf(change.pageId) : -1;
    const now = index === -1 ? null : document.slideXml(index);
    const conflict = (reason: string, places: SlideConflict[] = []) =>
      conflicts.push({ pageId: change.pageId, index: index === -1 ? null : index, reason, places });
    // Older rows have no page id: their slides cannot be found any more.
    if (!change.pageId) conflict('The slide cannot be found any more.');
    else if (from === null) {
      // The slide comes in (added, or put back).
      if (now === null) sides.push({ pageId: change.pageId, to, xml: to ?? undefined, at });
      else if (to === null || !sameSlide(to, now)) conflict('The slide is there already.');
    } else if (now === null) {
      if (to !== null) conflict('Someone removed this slide meanwhile.');
    } else if (to === null) {
      if (sameSlide(from, now)) sides.push({ pageId: change.pageId, to: null, at });
      else conflict('Someone changed this slide meanwhile, so it was not removed.');
    } else {
      const merged = mergeSlide(from, to, now);
      if (merged.xml === null) {
        conflict('Someone changed the same things on this slide meanwhile.', merged.conflicts);
      } else {
        sides.push({
          pageId: change.pageId,
          to,
          xml: sameSlide(merged.xml, now) ? undefined : merged.xml,
          at,
        });
      }
    }
  }
  const failed = new Set(conflicts.map((conflict) => conflict.pageId));
  const empty = { conflicts, changes: changed, renames, written: [], moved: [] };
  if (conflicts.length > 0 && !partial) return empty;
  if (sides.length === 0) return empty;

  if (direction === 'apply') {
    const pictures = changed
      .filter((change) => !failed.has(change.pageId))
      .flatMap((change) => change.pictures ?? []);
    for (const picture of pictures) {
      if (await document.picture(picture.path)) continue;
      const path =
        'mediaId' in picture
          ? await addThreadPicture(deps, deckId, document, picture.mediaId)
          : await addEditPicture(deps, deckId, document, picture.imageId);
      if (path !== picture.path) throw badRequest(PICTURE_GONE);
    }
  }
  // The other slides keep their order; the changed ones go to their positions.
  const touched = new Set(sides.map((side) => side.pageId));
  const order = ids.filter((pageId) => !touched.has(pageId));
  const placed = sides.filter((side) => side.to !== null).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  for (const side of placed) {
    order.splice(Math.min(side.at ?? order.length, order.length), 0, side.pageId);
  }
  document.arrange(
    order,
    new Map(
      placed.flatMap((side) => (side.xml === undefined ? [] : [[side.pageId, side.xml] as const])),
    ),
  );
  const after = document.pageIds();
  return {
    conflicts,
    changes: changed,
    renames,
    written: placed.filter((side) => side.xml !== undefined).map((side) => side.pageId),
    moved: placed
      .filter((side) => ids.indexOf(side.pageId) !== after.indexOf(side.pageId))
      .map((side) => side.pageId),
  };
}

/**
 * Writes the slides of a change as a step of the AI – `after` (apply) or `before` (revert) –
 * merged with what others changed on them since (see {@link applyChanges}); where they changed
 * the same things it throws a {@link MergeConflict} with `changedSince`. Returns the new step
 * and the change as it went in.
 */
async function writeChanges(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  changes: readonly AiSlideChange[],
  direction: 'apply' | 'revert',
  changedSince = CHANGED_SINCE,
): Promise<{ seq: number; changes: AiSlideChange[] }> {
  if (changes.length === 0) throw badRequest(CHANGED_SINCE);
  let written: AiSlideChange[] = [...changes];
  const seq = await editFile(
    deps,
    viewer,
    deckId,
    { source: 'ai', operations: [] },
    async (current) => {
      const document = await OdpDocument.open(current);
      // The page ids the AI saw (the same file gets the same ids).
      document.ensureIds();
      try {
        const outcome = await applyChanges(deps, deckId, document, changes, direction);
        if (outcome.conflicts.length > 0) throw new MergeConflict(outcome.conflicts, changedSince);
        written = outcome.changes;
      } catch (error) {
        if (error instanceof OdpError) throw badRequest(error.message);
        throw error;
      }
      return document.toBytes();
    },
  );
  return { seq, changes: written };
}

/**
 * A thread between two slides that got a slide of its own (an agenda asked for "here") moves onto
 * the first one added – and back between the slides around it when the change is taken back.
 */
async function moveThread(
  deps: AppDeps,
  proposal: ProposalRow,
  changes: readonly AiSlideChange[],
  direction: 'apply' | 'revert',
): Promise<void> {
  await (
    await planThreadMove(deps, proposal, changes, direction)
  )?.();
}

/**
 * Where {@link moveThread} puts the thread, worked out now – taking a change back, while the
 * slides around its own are still there – and done by the function returned, once the change
 * went through; `null` when the thread stays.
 */
async function planThreadMove(
  deps: AppDeps,
  proposal: ProposalRow,
  changes: readonly AiSlideChange[],
  direction: 'apply' | 'revert',
): Promise<(() => Promise<void>) | null> {
  const added = changes
    .filter((change) => change.before === null && change.after !== null)
    .sort((a, b) => (a.afterIndex ?? a.index) - (b.afterIndex ?? b.index))
    .map((change) => `${proposal.revisionId}:${change.pageId}`);
  if (!proposal.commentId || added.length === 0) return null;
  const [asking] = await deps.db
    .select({ id: comments.id, parentId: comments.parentId })
    .from(comments)
    .where(eq(comments.id, proposal.commentId));
  const rootId = asking ? (asking.parentId ?? asking.id) : null;
  const [root] = rootId
    ? await deps.db
        .select({ slideId: comments.slideId, anchor: comments.anchor })
        .from(comments)
        .where(eq(comments.id, rootId))
    : [];
  if (!rootId || !root) return null;
  const pages = await deps.db
    .select({ id: slides.id, pageId: slides.pageId })
    .from(slides)
    .where(and(eq(slides.deckId, proposal.deckId), inArray(slides.pageId, added)));
  const ids = new Set(pages.map((page) => page.id));

  let slideId: string | null;
  let anchor: Anchor;
  if (direction === 'apply') {
    const first = added.map((key) => pages.find((page) => page.pageId === key)).find(Boolean);
    if (root.anchor.type !== 'gap' || !first) return null;
    slideId = first.id;
    anchor = { type: 'slide' };
  } else {
    if (root.anchor.type !== 'slide' || !root.slideId || !ids.has(root.slideId)) return null;
    // The place it was asked for: between the slides around its own, before they go.
    const versions = await deps.db
      .select({ slideId: slideVersions.slideId })
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, proposal.revisionId))
      .orderBy(asc(slideVersions.position));
    const at = versions.findIndex((version) => version.slideId === root.slideId);
    if (at === -1) return null;
    const around = (side: typeof versions) => side.find((version) => !ids.has(version.slideId));
    slideId = null;
    anchor = {
      type: 'gap',
      afterSlideId: around(versions.slice(0, at).reverse())?.slideId ?? null,
      beforeSlideId: around(versions.slice(at + 1))?.slideId ?? null,
    };
  }
  return async () => {
    const now = deps.clock.now();
    await deps.db.transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ slideId, updatedAt: now })
        .where(or(eq(comments.id, rootId), eq(comments.parentId, rootId)));
      await tx.update(comments).set({ anchor }).where(eq(comments.id, rootId));
    });
    deps.live?.commentsChanged(proposal.deckId);
  };
}

/**
 * Takes an applied change back: undo while its step is still the last (exact, and it can be
 * redone) – checked under the deck's lock, so never someone else's step – else its slides as they
 * were, as a new step.
 */
async function takeBack(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposal: ProposalRow,
): Promise<void> {
  try {
    await moveEdit(
      deps,
      viewer,
      deckId,
      -1,
      // Its step: by the AI, at its place, and made before it was marked applied (a step made
      // in its place after an undo is newer).
      (top) =>
        top.source === 'ai' &&
        top.seq === proposal.appliedSeq &&
        top.createdAt.getTime() <= proposal.updatedAt.getTime(),
    );
  } catch (error) {
    if (!(error instanceof NotThatStep)) throw error;
    await writeChanges(deps, viewer, deckId, proposal.changes, 'revert');
  }
}

/**
 * The run was stopped (or ran out of time) while its change was being written: it goes back, as
 * a step of its own (an undo would leave it to be redone). If that fails – the slides were changed
 * further meanwhile – it stays, as applied, so „Rückgängig“ can take it back.
 */
async function takeBackStopped(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposal: ProposalRow,
  written: { seq: number; changes: AiSlideChange[] },
): Promise<void> {
  try {
    await writeChanges(deps, viewer, deckId, written.changes, 'revert');
    // What it wrote is gone: a stopped run keeps no photos to report.
    await finish(deps, proposal, { changes: [] });
  } catch (error) {
    deps.log.warn(`AI proposal ${proposal.id}: stopped change not taken back`, error);
    await finish(deps, proposal, {
      status: 'applied',
      appliedSeq: written.seq,
      changes: written.changes,
      error: null,
    });
    await moveThread(deps, proposal, written.changes, 'apply');
  }
}

/**
 * Takes an applied change back: undo while it is the last step (exact, and it can be redone),
 * else its slides as they were, as a new step.
 */
export async function revertProposal(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
) {
  const target = await editTarget(deps, viewer, deckId);
  const proposal = await proposalOf(deps, target, proposalId);
  if (proposal.status !== 'applied') throw badRequest('Diese Änderung ist nicht angewendet.');
  // Where the thread goes back to is known only while its slide is there; it moves once the
  // change is taken back – not when that fails.
  const moveBack = await planThreadMove(deps, proposal, proposal.changes, 'revert');
  await takeBack(deps, viewer, deckId, proposal);
  await moveBack?.();
  await finish(deps, proposal, { status: 'reverted' });
  return getEditState(deps, viewer, deckId);
}

/** Applies a taken-back change again: redo while its step is next, else as a new step. */
export async function reapplyProposal(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
) {
  const target = await editTarget(deps, viewer, deckId);
  const proposal = await proposalOf(deps, target, proposalId);
  if (proposal.status !== 'reverted') throw badRequest('Diese Änderung ist schon angewendet.');
  const [next] =
    proposal.appliedSeq === target.revision.editSeq + 1
      ? await deps.db
          .select({ source: deckEdits.source })
          .from(deckEdits)
          .where(
            and(
              eq(deckEdits.revisionId, target.revision.id),
              eq(deckEdits.seq, proposal.appliedSeq),
            ),
          )
      : [];
  if (next?.source === 'ai') {
    await moveEdit(deps, viewer, deckId, 1);
    await finish(deps, proposal, { status: 'applied' });
    await moveThread(deps, proposal, proposal.changes, 'apply');
  } else {
    const written = await writeChanges(deps, viewer, deckId, proposal.changes, 'apply');
    await finish(deps, proposal, {
      status: 'applied',
      appliedSeq: written.seq,
      changes: written.changes,
    });
    await moveThread(deps, proposal, written.changes, 'apply');
  }
  return getEditState(deps, viewer, deckId);
}

// ── Another of its photos ────────────────────────────────────────────────

/**
 * Puts another of the AI's photos in place of the one in the slide – cut to the same frame, with
 * its credit – as a step of its own. The change holds that photo from then on, so taking it back
 * and applying it again keep working. Unsplash hears of it when the thread is done or the file
 * leaves Slider (see `stock-photos`), at once if the thread is done already.
 */
export async function choosePhoto(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
  photoId: string,
) {
  const target = await editTarget(deps, viewer, deckId);
  const proposal = await proposalOf(deps, target, proposalId);
  if (proposal.status !== 'applied') throw badRequest('Diese Änderung ist nicht angewendet.');
  const at = proposal.changes.findIndex((change) => change.stock);
  const change = proposal.changes[at];
  const stock = change?.stock;
  if (!change || !stock || change.after === null) throw badRequest('Diese Änderung hat kein Foto.');
  if (stock.chosenId === photoId) return getEditState(deps, viewer, deckId);
  const photo = stock.candidates.find((candidate) => candidate.id === photoId);
  if (!photo) throw notFound('Dieses Foto gehört nicht zu der Änderung.');

  const fetched = await fetchPhoto(deps, target.deck.id, photo, stock.aspect);
  const path = picturePath(fetched.bytes, fetched.mediaType);
  const after = swapPicture(change.after, stock.path, { path, credit: photo.credit });
  // The slide stays where it is now.
  const current = await OdpDocument.open(await readFile(deps, target.revision.pptxKey));
  current.ensureIds();
  const index = current.pageIds().indexOf(change.pageId);
  if (index === -1) throw badRequest(CHANGED_SINCE);
  await writeChanges(
    deps,
    viewer,
    deckId,
    [
      {
        pageId: change.pageId,
        index,
        before: change.after,
        after,
        beforeIndex: index,
        afterIndex: index,
        styles: [],
        pictures: [{ path, imageId: fetched.imageId }],
      },
    ],
    'apply',
  );

  const reported = (await threadDone(deps, proposal)) && !stock.reported.includes(photo.id);
  if (reported) await trackPhoto(deps, photo);
  const changes = proposal.changes.map((item, i): AiSlideChange => {
    if (i !== at) return item;
    return {
      ...item,
      after,
      pictures: [
        ...(item.pictures ?? []).filter((picture) => picture.path !== stock.path),
        { path, imageId: fetched.imageId },
      ],
      stock: {
        ...stock,
        path,
        imageId: fetched.imageId,
        chosenId: photo.id,
        reported: reported ? [...stock.reported, photo.id] : stock.reported,
      },
    };
  });
  await finish(deps, proposal, { changes });
  return getEditState(deps, viewer, deckId);
}

/** Whether the thread that asked for the proposal is done. */
async function threadDone(deps: AppDeps, proposal: ProposalRow): Promise<boolean> {
  if (!proposal.commentId) return false;
  const [asking] = await deps.db
    .select({ parentId: comments.parentId, status: comments.status })
    .from(comments)
    .where(eq(comments.id, proposal.commentId));
  if (!asking) return false;
  if (!asking.parentId) return asking.status === 'done';
  const [root] = await deps.db
    .select({ status: comments.status })
    .from(comments)
    .where(eq(comments.id, asking.parentId));
  return root?.status === 'done';
}
