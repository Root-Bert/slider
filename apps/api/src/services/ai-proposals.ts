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
  type OdpDesign,
  type OdpMasterPage,
  type OdpSlide,
  type SlideConflict,
} from '@slider/odp';
import {
  AI_AUTHOR,
  anchorBoxes,
  commentWords,
  MAX_TEXT_ANNOTATION_LENGTH,
  stickerOf,
  stockOrientationSchema,
  stockPhotoUrl,
  type AiProposal,
  type UpdateAiProposalInput,
  type Anchor,
  type AnchorBox,
  type CreateAiProposalInput,
  type Rect,
  type Shape,
  type SlideOperation,
  type TextStroke,
  type StockOrientation,
  type Viewer,
  AI_RUNNING_LIMIT_MS,
  isTilted,
  rectShapeRefOver,
} from '@slider/shared';
import {
  aiProposals,
  comments,
  media,
  slideVersions,
  slides,
  users,
  decks,
  workspaceMasters,
  type AiSlideChange,
  type AiTakenLayout,
  type DeckEditRow,
  type AiStockPhotos,
  type StockPhotoRecord,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { fileUrl } from '../storage/file-urls';
import { ApiError, badRequest, notFound } from '../http/errors';
import { requireDeckAccess } from '../auth/access';
import {
  drawSlides,
  editFile,
  editTarget,
  getEditState,
  loadEditImage,
  moveAiStep,
  NotThatStep,
  openFile,
  readFile,
  storeEditImage,
  withFileProblems,
  withProposalLock,
  type EditTarget,
} from './edits';
import { cropPicture, cutOutSource, type PictureArea } from './cut-outs';
import { fetchPhoto, photoSource, searchPhotos, toStockPhoto, trackPhoto } from './stock-photos';
import {
  failureMessage,
  isProviderError,
  keyProblem,
  refusesKey,
  effortMessage,
  runTurn,
  type TurnTiming,
  type AiConnection,
} from './ai-providers';
import {
  markKeyRefused,
  workspaceAiConnection,
  workspaceImageConnection,
} from './integration-keys';
import { generatePicture } from './image-generation';
import {
  contactSheet,
  deckDesign,
  designBrief,
  layoutCheckText,
  masterOf,
  measureDeck,
  notesOf,
  slideInventory,
  uniqueGuides,
  withTextLooks,
  zoomArea,
  type DeckDesign,
  type DeckStats,
  type SheetCell,
} from './ai-context';
import { touchDeck } from './decks';
import { elementAlone } from './edit-backgrounds';
import { bakeTilt } from './tilt-pictures';
import { summarizeTranscriptsLater } from './transcripts';
import {
  NEW_KINDS,
  NEXT_TO_SIDES,
  placesAgree,
  quickEditSchema,
  quickOperations,
  quickPlan,
  quickSummary,
  type QuickEdit,
} from './voice/quick-edits';
import { aboutSeveralSlides, marginsOf, quickEdits, quickPrompt } from './quick-requests';

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
const MAX_TURNS = 24;
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
/** Pictures one run may generate with the workspace's key for pictures – each one is paid. */
const MAX_GENERATED = 3;
/** The AI's choice and the alternatives it offers. */
const MAX_ALTERNATIVES = 2;
/**
 * Tokens one run may spend – what the model writes and the tool results it reads; it paces
 * itself to it (a task budget), the turn cap stops it for sure.
 */
const TASK_BUDGET_TOKENS = 400_000;
/** How hard it thinks: designing slides repays thought. */
const EFFORT = 'high' as const;
/**
 * How hard it thinks once it has written: looking at the drawing and correcting what is off
 * needs less thought than the design, and each turn is waited for.
 */
const CHECK_EFFORT = 'medium' as const;
/** Tools that change the deck: after the first of them, it checks at {@link CHECK_EFFORT}. */
const WRITING_TOOLS = new Set([
  'write_slide',
  'edit_slide',
  'change_elements',
  'insert_slide',
  'add_variant',
  'delete_slide',
  'move_slide',
  'tilt_element',
]);
/**
 * Old tool results – slides looked at, drawings of earlier writes – leave the conversation once
 * it grows past this; the latest few stay, and those that name a path to use stay always. The
 * design brief, the overview and the commented slide come in the first message and stay.
 */
const CLEAR_TOOL_RESULTS = {
  trigger: 140_000,
  keep: 8,
  clearAtLeast: 30_000,
  exclude: ['add_picture', 'add_photo', 'generate_image', 'cut_out', 'add_comment', 'ask_back'],
};
/** Slides one overview picture shows at most. */
const SHEET_SLIDES = 30;
/** Open comments of the deck list_comments returns at most. */
const MAX_COMMENTS_LISTED = 60;
/** Elements a slide lists when it is shown; inspect_slide lists up to the larger number. */
const MAX_INVENTORY = 60;
const MAX_INSPECTED = 250;
/** Layout pictures list_layouts shows at most. */
const MAX_LAYOUT_PICTURES = 24;
/** Element changes of one change_elements call at most. */
const MAX_ELEMENT_CHANGES = 40;
/** Comments the AI leaves on its own in one run, and how long one may be. */
const MAX_NOTES = 3;
const MAX_NOTE_CHARS = 1_000;

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

const BASE_SYSTEM = `You edit an existing presentation in Slider, a tool where teams review and improve presentations together. People discuss a slide – or the place between two slides – in a comment thread; its last message asks you for a change. Earlier messages of the thread – including your own earlier answers – are context; act on the last one. When that is a comment you left yourself about something you noticed, the people want you to fix what it says.

The presentation is an OpenDocument presentation (ODP), and you work on its XML:
- view_slide shows a slide: how it looks, its <draw:page> XML and the styles it names. You see the commented slide (or the slides around the commented place) already; look at others when the request refers to them or you want to know how the deck does things.
- search_deck finds text or XML (any case) in all slides – speaker notes included – and in the styles and master pages, so you know where something is without looking at every slide.
- read_styles shows styles, master pages, gradients and the like by name – or, without names, the deck's common styles and master pages.
- list_pictures lists the pictures in the file (size in pixels, which slides show them); view_picture shows one.
- add_picture makes a picture attached to the comment thread available as a file path for write_slide and edit_slide.
- change_elements changes and adds elements as the editor does – without XML – and shows the slide drawn: box, fill, border, text and its font, size, colour, weight, alignment, order, deleting; new text boxes, shapes (rectangle, ellipse/circle, triangle, diamond, hexagon, block arrow, star), lines and arrows, copies of elements, placed by cm or next to others. It is by far the quickest way to write, and what it makes is what a person makes in the editor – the deck's text style, editable at once: use it for everything it can say.
- write_slide replaces a slide's <draw:page> with yours, optionally adding styles, and shows the slide drawn; edit_slide changes parts of a slide's <draw:page> (each edit replaces a piece of its XML by yours). Use them only for what change_elements cannot do: tables, charts, pictures, gradients or anything beyond one colour, custom geometry or rounded corners, fields, a style of part of a text, lists set up anew.
- insert_slide adds a slide – an empty slide of a layout, a copy of a slide, or your <draw:page> – and shows it drawn; delete_slide removes one, move_slide moves one. Slide numbers change with them: the results give the new order. A new slide with content: insert_slide with a layout (or copy_of a slide like it), then its placeholders' text and anything more with change_elements – not XML.
- add_variant makes a variant of a slide: a copy kept beside it, hidden in the show, that the people compare with the slide and use instead with one click. Use it whenever the thread asks for a variant, an alternative or another version of a slide („mach mir mal eine Variante …“) – then change the variant, never the slide itself: what the whole thread says about the slide is the brief for it. Several variants asked for: one add_variant each. In your reply, say that you made a variant of the slide (the people find it above the slide), not its number.
- list_layouts lists the layouts a new slide can take: the deck's own master pages and the layouts of the workspace's templates (the company designs), with a picture of each.
- tilt_element tilts an element in depth (3D), as the editor's turning handle does, and shows the slide drawn.
- add_comment leaves a comment of yours at a place in the deck, about something you noticed there – or, as a sticker, a short note written right on the slide; ask_back marks your reply as a question to the people.

What you know and how to learn more:
- Your first message brings the design brief (the deck's page, template, colours, fonts and the text sizes each role takes, grid, guides, margins, master pages and where titles and text usually sit), an overview picture of the deck's slides, the commented slide with its picture, XML, styles, a list of its elements measured in cm and a layout check, the slides next to it, and other open comments there.
- deck_overview shows slides side by side (numbered, with their layouts and word counts) – the deck's look at a glance, and how other slides solve what you are about to do.
- read_text gives the text of slides – speaker notes included – to keep wording, terms and figures consistent.
- inspect_slide lists a slide's elements measured in cm (box, text, fonts, sizes, colours, fills) and runs the layout check, without picture or XML.
- zoom_slide shows a part of a slide close up, sharp – small text, spacing, edges.
- view_layout shows a layout big with its placeholders: a template's (list_layouts) or one of the deck's master pages.
- list_comments lists the deck's open comments – what people want elsewhere.
Look up what the request needs; you need not look at everything. Ask for everything you want to see in one answer – several looks called together run at the same time – rather than one look per turn: each turn takes time.

Writing:
- With write_slide, write the complete <draw:page>, starting from its current XML, and keep everything the request is not about as it is – element ids (xml:id), names, placeholders (presentation:class), notes and animations included. Use the file's namespace prefixes (draw, svg, text, style, fo, presentation, table, …) without declaring them.
- With edit_slide, give only the pieces you change: each one copied exactly from the slide's XML as you were last shown it, long enough to occur only once, and what replaces it. Use it when the request is about some elements or attributes and the rest of the slide stays – always on a large slide (a table, many shapes), which is never too large for it. Do the whole request in one run; there is no later one.
- Styles are shared between slides. To change how an element looks, add a style of your own (e.g. a style:style of family graphic, paragraph or text, under a new name, with the properties you want and the same parent as the old one) and point the element at it. Existing styles stay as they are; your own you can write again.
- Pictures can be ones already in the file (Pictures/…, the same path on several slides is fine) or ones from the thread after add_picture. Keep a picture's proportions (its pixel size) when you size its frame. Scripts, events and links out are removed.
- A draw:frame is always a rectangle. For a picture with rounded corners, as a circle or in another shape, replace its frame by a shape filled with the picture: a draw:rect with draw:corner-radius (or a draw:ellipse, or a draw:custom-shape) of the frame's position and size, whose graphic style has draw:fill="bitmap", draw:fill-image-name naming a draw:fill-image you add (draw:name, xlink:href the Pictures/… path, xlink:type="simple", xlink:show="embed", xlink:actuate="onLoad"), style:repeat="stretch" and draw:stroke="none". The shape needs the picture's proportions, or it is stretched.
- A new slide is best one of a layout (insert_slide with \`master\` or \`template\`): its placeholders are where the design wants title and text, and it keeps the deck's look. Prefer the deck's own master pages; take a template's layout when the request asks for it or the deck has nothing fitting. Then fill it with change_elements: the placeholders' \`text\` (one string per paragraph – a list placeholder makes them its points), new elements with \`add\`; delete a placeholder you leave empty.
- New shapes, text boxes, lines and arrows: change_elements with \`add\` – in the deck's colours (\`fill\`, \`border\`, \`text_color\`) and fonts, lined up with what is there (\`next_to\`, \`align_with\`, \`size_like\`, boxes on the grid). Several alike: make one, then \`copy_of\` it with \`next_to\` the one before.
- Tilting in depth: the element stays in the file, hidden, and a picture of it tilted lies over it (a draw:frame whose svg:desc starts with "Slider 3D:"). Never write such a frame or its description yourself, and leave it alone in your writes – tilt_element draws it; to change a tilted element, change the hidden element and tilt it again (or with 0, 0 to lay it flat).
- Change only the slides the request is about – usually the commented one.
- Others work on the deck at the same time – people, and other requests like yours. Your change is merged with theirs element by element and attribute by attribute, so on the slides you write, change only the elements, attributes and text the request is about and leave everything else exactly as it is in the XML you were shown.
- Check each drawn slide: text fits its box, nothing overlaps by accident or leaves the slide, it fits the look of the deck. Each drawing comes with a layout check of the slide – edges that almost line up, uneven gaps, text off the margins or the grid, sizes, fonts or colours foreign to the deck, low contrast. It only measures; the picture decides. If something is off, write the slide again.

Design – the slides should look made by a good designer who knows this deck's design:
- Keep to the design brief: the template's palette (else the colours the deck uses), its fonts, the text size the deck gives each role, its grid, guides and margins, where titles and text usually sit. Other colours, fonts or sizes only when the request asks for them. New text names a font by its free name – Carlito, Caladea, Liberation Sans, Liberation Serif, Liberation Mono for Calibri, Cambria, Arial, Times New Roman, Courier New (they look and measure the same) – never Microsoft's names.
- Fit in: a new or rewritten slide follows how the other slides do the same thing (the overview shows them) and uses the layout's placeholders and the master's styles rather than free boxes of its own.
- Hierarchy: one message per slide; the title, then the key point, then the detail – told apart by size, weight and colour, not by many of each. Say it in fewer words rather than set text smaller than the deck's body text; split a slide that has too much.
- Order: every element on the grid or lined up with the edges of others; equal things the same size with equal gaps; generous, even white space; nothing crowded against the edge of the slide or of its box.
- Readable: enough contrast between text and what lies behind it; one accent colour for emphasis, not several.
- Keep the deck's language and tone. Do not invent facts, figures or names – if the request needs information you do not have, keep the text general or say so.

Noticing and asking:
- Something important you notice that the request is not about – a problem elsewhere on the slide or on another slide (text cut off, a wrong figure, a typo) – you leave as it is: put a comment at that place with add_comment instead, one per problem, in the language of the request. The people take it up there. Only what matters, no matters of taste.
- If you need something from the people to do the request – what exactly is meant, which of two ways, a fact you do not have – ask it in your reply and call ask_back: the thread then waits for their answer. Do what you can without the answer first; do not ask about what you can sensibly decide yourself.
- A sticker (add_comment with sticker) is for what the people must notice on the slide itself, at one spot, even if they never read your reply: a placeholder you put in for a fact you do not have, a figure you could not verify, a stand-in picture to replace, a question about that spot, a decision between two ways that is theirs to make. Never instead of a change you can make, never for what only concerns your reply; one is usually enough.

When the slides are right, or when the request cannot be done, stop. What you wrote is applied right away; the people can take it back with one click. Then reply in the language of the request with one short sentence saying what you changed (or why nothing) – the slides show the rest. Then, at most one short sentence each: that you left a comment about something you noticed (where, in a few words), and your question. Address the person directly, without preamble.`;

const STOCK_SYSTEM = `

Stock photos (Unsplash): when the request asks for a photo or picture you do not have – a new one, a better or different one – search_photos finds photos (you see small previews) and add_photo makes one available as a file path for write_slide and edit_slide, cut to the frame's proportions. Search with a short English query for what the photo should show; search again only if nothing fits. Pass the best photo and up to two good alternatives to add_photo: the people can switch to an alternative with one click. Put the photo into a draw:frame with the proportions you gave (replacing an existing picture: its draw:image inside the existing frame, same size). The photographer's credit is added to the frame automatically – do not write it on the slide. Never use stock photos for logos, charts, screenshots or people the deck names.`;

const CUT_OUT_SYSTEM = `

Cutting out: when the request asks to remove a picture's background – a person, a product, a logo on a white or coloured box – cut_out makes a copy of the picture with its background transparent (the subject stays as it is) and gives you its path; the original stays in the file. Put the copy where the original was: the xlink:href of its draw:image, same frame. Look at the result it shows: only the main subject is kept, so a picture whose background belongs to it (a screenshot, a chart, a scene) is not for cutting out. When only one thing of several is wanted – the wordmark without the symbol, one person of a group – or the whole picture lost a part that matters, pass the area around that thing (view_picture shows the picture and its size in pixels). A copy of an area has that area's proportions: size its frame to them.`;

const GENERATE_SYSTEM = `

Generated pictures: generate_image makes a new picture from a description with the workspace's image model and gives you its path for write_slide and edit_slide, cut to the frame's proportions. Use it when the request asks for a picture to be generated, created or drawn, for an illustration or a scene no real photo shows – and for any new picture when there are no stock photos. Describe in English what the picture shows, its style, light and colours (fitting the deck's look), and that it has no text or lettering in it. Look at the result it shows: if it does not fit, generate once more with a better description. Put it into a draw:frame with the proportions you gave (replacing an existing picture: its draw:image inside the existing frame, same size). Never generate logos, charts, screenshots or people the deck names.`;

/**
 * What the AI is told – with stock photos, cutting out and generated pictures when this server
 * and the workspace can do them.
 */
const systemPrompt = (stock: boolean, cutOut: boolean, generate: boolean) =>
  BASE_SYSTEM +
  (stock ? STOCK_SYSTEM : '') +
  (cutOut ? CUT_OUT_SYSTEM : '') +
  (generate ? GENERATE_SYSTEM : '');

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
    name: 'deck_overview',
    description:
      'Shows slides side by side as they look now (your changes included), numbered, in one picture, with a line per slide: its title, layout, elements and words. `from`/`to`: the slides to show (at most 30 at once; default: the first 30).',
    input_schema: {
      type: 'object',
      properties: { from: slideNumber, to: slideNumber },
    },
  },
  {
    name: 'read_text',
    description:
      'The text of slides as plain text, element by element with its role, and their speaker notes. `slides`: which (default: all).',
    input_schema: {
      type: 'object',
      properties: { slides: { type: 'array', items: slideNumber, maxItems: 200 } },
    },
  },
  {
    name: 'inspect_slide',
    description:
      "Lists a slide's elements measured in cm from its top left corner – id, kind, role, box, text, fonts, sizes, colours, fill and border, contrast – and runs the layout check on it. No picture or XML: cheap to call for several slides.",
    input_schema: { type: 'object', properties: { slide: slideNumber }, required: ['slide'] },
  },
  {
    name: 'zoom_slide',
    description:
      'Shows a part of a slide as it looks now, close up and sharp: `area` in cm from its top left corner (inspect_slide gives the boxes). For small text, spacing and edges the whole-slide picture shows too small.',
    input_schema: {
      type: 'object',
      properties: {
        slide: slideNumber,
        area: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['x', 'y', 'width', 'height'],
        },
      },
      required: ['slide', 'area'],
    },
  },
  {
    name: 'view_layout',
    description:
      "Shows a layout big with its placeholders in cm: layout `layout` of the workspace's template `template` (list_layouts), or the deck's master page `master` – with a slide that uses it.",
    input_schema: {
      type: 'object',
      properties: {
        template: { type: 'string' },
        layout: { type: 'integer', minimum: 1 },
        master: { type: 'string' },
      },
    },
  },
  {
    name: 'list_comments',
    description:
      "Lists the deck's open comments – who wrote what, where, with replies – or those of slide `slide`. What people want elsewhere in the deck; the thread you work for is left out.",
    input_schema: { type: 'object', properties: { slide: slideNumber } },
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
      "Adds a slide after slide `after` (0: as the first) – one of: your <draw:page> XML (with your styles, like write_slide); a copy of slide `copy_of` – usually the quickest start for a slide like an existing one; an empty slide of the deck's master page `master`; or an empty slide of layout `layout` of the workspace's template `template` (list_layouts), the layout taken into the deck. An empty slide has its layout's placeholders – fill them and add more with change_elements, not XML. Returns it drawn, its XML and the new order of the slides.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        after: { type: 'integer', minimum: 0 },
        copy_of: slideNumber,
        xml: { type: 'string', description: 'The complete <draw:page> element.' },
        styles: { type: 'string', description: 'New styles, as for write_slide.' },
        master: { type: 'string', description: 'A master page of the deck (its style:name).' },
        template: { type: 'string', description: 'The id of a template of list_layouts.' },
        layout: {
          type: 'integer',
          minimum: 1,
          description: 'The number of a layout of `template`, as list_layouts gives it.',
        },
      },
      required: ['after'],
    },
  },
  {
    name: 'add_variant',
    description:
      'Makes a variant of a slide: a copy of it right after the slide (and its other variants), hidden in the show, marked as its variant – the people see it beside the slide and can use it instead. Change the copy afterwards (change_elements, edit_slide, write_slide); the slide itself stays. Returns the variant drawn, its number and the new order of the slides.',
    input_schema: { type: 'object', properties: { slide: slideNumber }, required: ['slide'] },
  },
  {
    name: 'list_layouts',
    description:
      "Lists the layouts a new slide can take (insert_slide): the deck's own master pages, with the slides on each, and the layouts of the workspace's templates – the company designs – each with a small picture.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'tilt_element',
    description:
      "Tilts an element in depth, seen in perspective: `x` degrees about the slide's horizontal axis (its top away from the viewer; negative: its bottom away) and `y` about the vertical one (its right side away; negative: its left side). Both 0 lays it flat again. `element`: its xml:id. Pictures, shapes and text frames can be tilted, groups not. Returns the slide drawn. Takes a few seconds.",
    input_schema: {
      type: 'object',
      properties: {
        slide: slideNumber,
        element: { type: 'string' },
        x: { type: 'number', minimum: -80, maximum: 80 },
        y: { type: 'number', minimum: -80, maximum: 80 },
      },
      required: ['slide', 'element', 'x', 'y'],
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
      'Replaces a slide with your <draw:page> XML, after adding your styles, and returns it drawn – only for what change_elements cannot do (tables, charts, pictures, gradients, custom geometry, fields, …). Problems (unknown style, malformed XML, …) come back as an error to correct.',
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
      'Changes parts of a slide: replaces each `find` – XML copied exactly from the slide as last shown, occurring there once – by its `replace`, in order, after adding your styles, and returns the slide drawn – only for what change_elements cannot do. All edits apply or none; a `find` not there or there more than once comes back as an error.',
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
  {
    name: 'change_elements',
    description:
      'Changes and adds elements of a slide as the editor does – far quicker than writing XML, and the result is what a person makes in the editor (the deck’s text style, editable at once): where they are and how big, fill, border, their text and its font, size, colour, weight and alignment, order, deleting. A change names an existing element by its xml:id (inspect_slide and the element list give them) and only what changes. `add` makes a new element instead – a text box, a shape (rectangle, ellipse – a circle when width = height –, triangle, diamond, hexagon, block arrow, star) or a line/arrow – on top, with everything else of the change (fill, border, text and its look); `copy_of` makes a copy of an element (its look and text), changed by the rest. Give a new one a `name`: later changes of the same call refer to it by that name (element, next_to, align_with, size_like, from, to), and the result gives its xml:id. Place a new one by `box`, or relative to others: `next_to` (beside or below another, a gap between, lined up with it), then `align_with`; its size by width/height, `size_like` or the box. A line or arrow runs `from` an element or a point `to` another – between two elements it starts and ends at their facing edges, straight across when they lie side by side. Changes apply in order; all apply or none. One the editor cannot make (a field, a table cell, a style of only part of the text) comes back as an error – do it with edit_slide then.',
    input_schema: {
      type: 'object',
      properties: {
        slide: slideNumber,
        changes: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_ELEMENT_CHANGES,
          items: {
            type: 'object',
            properties: {
              element: {
                type: 'string',
                description: 'Its xml:id – or the name of an element added before in this call.',
              },
              add: {
                type: 'string',
                enum: [...NEW_KINDS],
                description:
                  'A new element of this kind instead of changing one: text (a text box), a shape, line or arrow (heads at its end).',
              },
              copy_of: {
                type: 'string',
                description: 'A new copy of this element (xml:id or name) instead.',
              },
              name: {
                type: 'string',
                description: 'What later changes of this call call the new element.',
              },
              width: { type: 'number', exclusiveMinimum: 0, description: 'A new one’s width, cm.' },
              height: {
                type: 'number',
                exclusiveMinimum: 0,
                description: 'A new one’s height, cm.',
              },
              next_to: {
                type: 'object',
                description:
                  'A new one beside another element – right or left of it (middles level), below or above it (left edges lined up) – `gap` cm between (default about half a cm).',
                properties: {
                  element: { type: 'string' },
                  side: { type: 'string', enum: [...NEXT_TO_SIDES] },
                  gap: { type: 'number', minimum: 0 },
                },
                required: ['element', 'side'],
              },
              from: {
                description:
                  'A new line’s start: {element} (its edge facing the end) or {x, y} in cm.',
                anyOf: [
                  {
                    type: 'object',
                    properties: { element: { type: 'string' } },
                    required: ['element'],
                  },
                  {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                  },
                ],
              },
              to: {
                description: 'A new line’s end, as `from`.',
                anyOf: [
                  {
                    type: 'object',
                    properties: { element: { type: 'string' } },
                    required: ['element'],
                  },
                  {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                  },
                ],
              },
              heads: {
                type: 'string',
                enum: ['none', 'start', 'end', 'both'],
                description: 'A new line’s arrow heads (arrow: end, line: none unless given).',
              },
              box: {
                type: 'object',
                description: 'Where it goes, in cm from the slide’s top left corner.',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  width: { type: 'number', exclusiveMinimum: 0 },
                  height: { type: 'number', exclusiveMinimum: 0 },
                },
                required: ['x', 'y', 'width', 'height'],
              },
              align_with: {
                type: 'array',
                maxItems: 2,
                description:
                  'Lined up with other elements – by an edge or its middle – after `box`.',
                items: {
                  type: 'object',
                  properties: {
                    element: { type: 'string' },
                    edge: {
                      type: 'string',
                      enum: ['left', 'right', 'top', 'bottom', 'center_x', 'center_y'],
                    },
                  },
                  required: ['element', 'edge'],
                },
              },
              size_like: {
                type: 'object',
                description: 'As wide and/or as high as another element.',
                properties: {
                  element: { type: 'string' },
                  width: { type: 'boolean' },
                  height: { type: 'boolean' },
                },
                required: ['element'],
              },
              fill: { type: 'string', description: '#rrggbb, or "none".' },
              border: {
                description: '{color: #rrggbb, width in pt}, or "none".',
                anyOf: [
                  {
                    type: 'object',
                    properties: { color: { type: 'string' }, width: { type: 'number' } },
                    required: ['color', 'width'],
                  },
                  { type: 'string', enum: ['none'] },
                ],
              },
              vertical_align: { type: 'string', enum: ['top', 'middle', 'bottom'] },
              text: {
                type: 'array',
                items: { type: 'string' },
                description: 'Its text anew, one string per paragraph; its formatting stays.',
              },
              font_size: { type: 'number', description: 'pt, all of its text.' },
              font_scale: {
                type: 'number',
                description: 'Every size of its text times this – for text of mixed sizes.',
              },
              font: {
                type: 'string',
                description: 'A font of the brief, by its free name (Carlito, not Calibri).',
              },
              text_color: { type: 'string', description: '#rrggbb' },
              bold: { type: 'boolean' },
              italic: { type: 'boolean' },
              underline: { type: 'boolean' },
              align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
              order: { type: 'string', enum: ['front', 'back'] },
              delete: { type: 'boolean' },
            },
          },
        },
      },
      required: ['slide', 'changes'],
    },
  },
  {
    name: 'add_comment',
    description: `Leaves a comment of yours on a slide, about a problem you noticed there that the request is not about – the people find it in the deck as an open comment. \`text\`: what is wrong (and what could be done), short. \`area\`: where on the slide, in cm from its top left corner – the element in question; without it the comment is about the whole slide. \`sticker\`: write the text right on the slide as a sticker – a small note that everyone sees on the slide at once, without opening a comment: for a short note, hint or question about one spot – something to look at, a decision the people have to make there, a placeholder for a fact you do not have. Its \`area\` (needed) is the sticker's own box, not the element it is about: free space right beside that element, never over text or anything that matters (at least 4 cm wide; its height grows with the text). A sticker is never part of the slide and never a way to do the request: what you can change, you change. Keep it to a few words. Posted when you are done, if your change goes through. At most ${MAX_NOTES}, stickers included.`,
    input_schema: {
      type: 'object',
      properties: {
        slide: slideNumber,
        text: { type: 'string', minLength: 1, maxLength: MAX_NOTE_CHARS },
        area: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['x', 'y', 'width', 'height'],
        },
        sticker: { type: 'boolean' },
      },
      required: ['slide', 'text'],
    },
  },
  {
    name: 'ask_back',
    description:
      'Marks your reply as a question to the people about this request: the thread waits for their answer instead of counting as done. Ask the question itself in your reply.',
    input_schema: { type: 'object', properties: {} },
  },
];

const CUT_OUT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'cut_out',
    description:
      'Removes the background of a picture (a Pictures/… path from list_pictures, a slide, add_picture or add_photo) with an image model: makes a copy with the background transparent (PNG) available to write_slide and edit_slide, returns its Pictures/… path and size in pixels and shows it. The model keeps the most prominent thing of the picture. `area`: only this part of the picture, in its pixels from the top left corner – a rectangle around the one thing to keep (with a little margin) when the request is about one of several things in the picture; the copy is then that part only. Takes a few seconds.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        area: {
          type: 'object',
          properties: {
            x: { type: 'number', minimum: 0 },
            y: { type: 'number', minimum: 0 },
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['x', 'y', 'width', 'height'],
        },
      },
      required: ['path'],
    },
  },
];

const GENERATE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'generate_image',
    description:
      'Generates a new picture from a description (English) with the workspace’s image model, cut to `aspect` (the frame’s width / height): makes it available to write_slide and edit_slide, returns its Pictures/… path and size in pixels and shows it. Takes up to a minute; at most three per request.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 3, description: 'What the picture shows, its style.' },
        aspect: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Width / height of the frame it goes into (e.g. 1.78 for 16:9).',
        },
      },
      required: ['prompt', 'aspect'],
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
const generateInput = z.object({
  prompt: z.string().min(3).max(2000),
  aspect: z.number().min(0.1).max(10),
});
const searchInput = z.object({ query: z.string().min(1).max(500) });
const overviewInput = z.object({
  from: z.number().int().min(1).optional(),
  to: z.number().int().min(1).optional(),
});
const readTextInput = z.object({ slides: z.array(z.number().int().min(1)).max(200).optional() });
const zoomInput = z.object({
  slide: z.number().int().min(1),
  area: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
});
const layoutInput = z
  .object({
    template: z.string().min(1).max(100).optional(),
    layout: z.number().int().min(1).optional(),
    master: z.string().min(1).max(500).optional(),
  })
  .refine(
    (input) =>
      input.master !== undefined
        ? input.template === undefined && input.layout === undefined
        : input.template !== undefined && input.layout !== undefined,
    { message: 'Give master, or template and layout.' },
  );
const commentsInput = z.object({ slide: z.number().int().min(1).optional() });
const pictureInput = z.object({ path: z.string().max(500) });
const cutOutInput = pictureInput.extend({
  area: z
    .object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
});
const addPictureInput = z.object({ picture: z.number().int().min(1) });
const insertInput = z
  .object({
    after: z.number().int().min(0),
    copy_of: z.number().int().min(1).optional(),
    xml: z.string().optional(),
    styles: z.string().optional(),
    master: z.string().min(1).max(500).optional(),
    template: z.string().min(1).max(100).optional(),
    layout: z.number().int().min(1).optional(),
  })
  .refine(
    (input) =>
      [input.copy_of, input.xml, input.master, input.template].filter(
        (given) => given !== undefined,
      ).length === 1,
    { message: 'Give one of xml, copy_of, master or template.' },
  )
  .refine((input) => (input.template === undefined) === (input.layout === undefined), {
    message: 'Give template and layout together.',
  });
const tiltInput = z.object({
  slide: z.number().int().min(1),
  element: z.string().min(1).max(200),
  x: z.number().min(-80).max(80),
  y: z.number().min(-80).max(80),
});
const moveInput = z.object({ slide: z.number().int().min(1), to: z.number().int().min(1) });
const stylesInput = z.object({ names: z.array(z.string()).max(200).optional() });
const writeInput = z.object({
  slide: z.number().int().min(1),
  xml: z.string(),
  styles: z.string().optional(),
});
const commentInput = z.object({
  slide: z.number().int().min(1),
  text: z.string().trim().min(1).max(MAX_NOTE_CHARS),
  area: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  sticker: z.boolean().optional(),
});
/** A line's end in cm: an element, or a point. */
const cmEnd = z.union([
  z.object({ element: z.string().min(1).max(200) }),
  z.object({ x: z.number(), y: z.number() }),
]);
const elementChange = quickEditSchema
  .omit({ place: true, box: true, size: true, next_to: true, from: true, to: true })
  .extend({
    box: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .nullish(),
    width: z.number().positive().nullish(),
    height: z.number().positive().nullish(),
    next_to: z
      .object({
        element: z.string().min(1).max(200),
        side: z.enum(NEXT_TO_SIDES),
        gap: z.number().min(0).max(100).nullish(),
      })
      .nullish(),
    from: cmEnd.nullish(),
    to: cmEnd.nullish(),
  });
const changeInput = z.object({
  slide: z.number().int().min(1),
  changes: z.array(elementChange).min(1).max(MAX_ELEMENT_CHANGES),
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

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ── Listing ──────────────────────────────────────────────────────────────

type ProposalRow = typeof aiProposals.$inferSelect;

/** What a run of this process is doing now, and its latest drawing – shown in its thread. */
const progressOf = new Map<string, { step: string; preview: string | null }>();

/** Tells the thread what the run does now (and shows its latest drawing). */
function report(deps: AppDeps, proposal: ProposalRow, step: string, preview?: string) {
  const now = progressOf.get(proposal.id);
  const next = { step, preview: preview ?? now?.preview ?? null };
  if (now?.step === next.step && now.preview === next.preview) return;
  progressOf.set(proposal.id, next);
  deps.live?.proposalsChanged(proposal.deckId);
}

/** What the thread says the AI does while it runs a group of tools. */
function stepOf(calls: readonly Anthropic.Beta.BetaToolUseBlock[]): string {
  const call = calls.find((each) => WRITING_TOOLS.has(each.name)) ?? calls[0];
  const input = (call?.input ?? {}) as { slide?: unknown };
  const slide = typeof input.slide === 'number' ? input.slide : null;
  switch (call?.name) {
    case 'write_slide':
    case 'edit_slide':
    case 'change_elements':
    case 'tilt_element':
      return slide ? `Ändert Folie ${slide}` : 'Ändert die Folie';
    case 'insert_slide':
      return 'Fügt eine Folie ein';
    case 'add_variant':
      return 'Erstellt eine Variante';
    case 'delete_slide':
      return 'Löscht eine Folie';
    case 'move_slide':
      return 'Verschiebt eine Folie';
    case 'search_photos':
    case 'add_photo':
      return 'Sucht ein Foto';
    case 'generate_image':
      return 'Erzeugt ein Bild';
    case 'cut_out':
      return 'Stellt ein Bild frei';
    case 'add_comment':
      return 'Schreibt einen Kommentar';
    case 'view_slide':
    case 'inspect_slide':
    case 'zoom_slide':
      return slide ? `Schaut sich Folie ${slide} an` : 'Schaut sich die Folien an';
    default:
      return 'Schaut sich die Präsentation an';
  }
}

function toDto(row: ProposalRow, now: Date, createdByName: string | null): AiProposal {
  const cutOff = row.status === 'running' && now.getTime() - row.createdAt.getTime() > CUT_OFF_MS;
  return {
    id: row.id,
    slideId: row.slideId,
    commentId: row.commentId,
    prompt: row.prompt,
    status: cutOff ? 'failed' : row.status,
    summary: row.summary ?? null,
    asks: row.asks,
    error: cutOff ? 'Die KI wurde unterbrochen. Bitte nochmal senden.' : row.error,
    photos: photosOf(row.changes),
    progress: row.status === 'running' && !cutOff ? progressDto(row.id) : null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

const progressDto = (id: string): AiProposal['progress'] => {
  const progress = progressOf.get(id);
  return progress
    ? { step: progress.step, previewUrl: progress.preview ? fileUrl(progress.preview) : null }
    : null;
};

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
  /** `heard`: comments said aloud (speaking to the AI) – what speech recognition heard, raw. */
  { heard }: { heard?: ReadonlyMap<string, string> } = {},
): Promise<AiProposal> {
  const target = await editTarget(deps, viewer, deckId);
  const ai = await workspaceAiConnection(deps, target.deck.workspaceId);
  if (ai.connection === null) throw new ApiError(409, 'ai_not_configured', ai.error);
  const { connection, keyId } = ai;
  // „Variante erstellen“ with words: no thread – the words are the brief for the variant.
  const variant = 'variantOf' in input ? input : null;
  let thread: ThreadAsk | null = null;
  let place: CommentPlace;
  let prompt: string;
  if ('variantOf' in input) {
    if (target.deck.isTemplate) throw badRequest('Die Folien einer Vorlage haben keine Varianten.');
    place = await slidePlace(deps, target, input.variantOf);
    prompt = input.prompt.trim();
  } else {
    thread = await threadOf(deps, target.deck.id, input.commentId);
    // A voice memo asks as well as text, once it is transcribed.
    if (
      !commentWords(thread.asking) &&
      !(await recordingTranscripts(deps, [thread.asking.id])).size
    ) {
      throw badRequest(
        'Schreib oder sprich in den Kommentar, was die KI an der Folie ändern soll.',
      );
    }
    place = await commentPlace(deps, target, thread.root);
    prompt = await threadPrompt(deps, thread, heard);
  }
  const slideId = place.slideId;

  const now = deps.clock.now();
  const [row] = await deps.db
    .insert(aiProposals)
    .values({
      id: crypto.randomUUID(),
      deckId: target.deck.id,
      revisionId: target.revision.id,
      slideId,
      commentId: thread?.asking.id ?? null,
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
  // The memos it reads, in short for the people (the AI itself reads them whole).
  if (thread) {
    summarizeTranscriptsLater(
      deps,
      connection,
      thread.messages.map((message) => message.id),
    );
  }
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
      : runProposal(
          deps,
          viewer,
          target,
          proposal,
          place,
          connection,
          keyId,
          stopper.signal,
          !heard && !variant,
          !!variant,
        ),
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

/** A slide of the deck as the place of a request without a thread („Variante erstellen“). */
async function slidePlace(
  deps: AppDeps,
  target: EditTarget,
  slideId: string,
): Promise<CommentPlace> {
  const [row] = await deps.db
    .select({ position: slideVersions.position })
    .from(slideVersions)
    .where(
      and(eq(slideVersions.revisionId, target.revision.id), eq(slideVersions.slideId, slideId)),
    );
  if (!row) throw badRequest('Diese Folie ist in der aktuellen Version nicht mehr da.');
  return {
    slideId,
    shown: [row.position],
    text: `The request is about slide ${row.position + 1}.`,
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
    const area = ({ rect: { x, y, w, h }, shapeRef }: AnchorBox) =>
      `x ${pct(x)}, y ${pct(y)}, w ${pct(w)}, h ${pct(h)}${shapeRef ? ` on element ${shapeRef.shapeId}` : ''}`;
    const boxes = anchorBoxes(anchor);
    // Several boxes picked for one comment: it is about all of them together.
    if (boxes.length > 1)
      return ` [marks ${boxes.length} areas together – the comment is about all of them: ${boxes.map((box) => `(${area(box)})`).join(', ')}]`;
    return ` [marks the area ${area(boxes[0]!)}]`;
  }
  return '';
}

/**
 * Where a root comment points, for the AI – a sticker as the note written on the slide that it is:
 * not part of the slide (the AI's pictures do not show it), its box the area meant („hier“).
 */
function markText(comment: Pick<CommentRow, 'anchor' | 'strokes' | 'body'>): string {
  const sticker = stickerOf(comment);
  if (!sticker) return anchorText(comment.anchor);
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const own = comment.body.trim() && comment.body.trim() !== sticker.text.trim();
  return ` [a sticker – a note stuck on the slide, not part of it, not in your pictures – over the area x ${pct(sticker.x)}, y ${pct(sticker.y)}, w ${pct(sticker.w)}, h ${pct(sticker.h)}: where the sticker says „here“, it means this area and what lies under it${own ? `; it reads: ${sticker.text.trim()}` : ''}]`;
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

/** What the recordings of the given comments say, by comment – those transcribed. */
async function recordingTranscripts(
  deps: AppDeps,
  commentIds: readonly string[],
): Promise<Map<string, string>> {
  if (commentIds.length === 0) return new Map();
  const rows = await deps.db
    .select({ commentId: media.commentId, transcript: media.transcript })
    .from(media)
    .where(and(inArray(media.commentId, [...commentIds]), eq(media.transcriptStatus, 'done')));
  return new Map(
    rows.flatMap((row) => (row.transcript?.trim() ? [[row.commentId, row.transcript.trim()]] : [])),
  );
}

/** The thread as the AI reads it: who said what, its own earlier answers in between. */
async function threadPrompt(
  deps: AppDeps,
  thread: ThreadAsk,
  heard?: ReadonlyMap<string, string>,
): Promise<string> {
  const ids = thread.messages.map((message) => message.id);
  const [earlier, said] = await Promise.all([
    deps.db
      .select()
      .from(aiProposals)
      .where(inArray(aiProposals.commentId, ids))
      .orderBy(asc(aiProposals.createdAt)),
    recordingTranscripts(deps, ids),
  ]);
  const lines: string[] = [];
  for (const message of thread.messages) {
    const marks = message.id === thread.root.id ? markText(message) : '';
    const raw = heard?.get(message.id);
    const transcript = said.get(message.id);
    const spoken =
      raw && raw !== message.body.trim()
        ? `(said aloud – the text above is cleaned up from this raw speech recognition, which may have misheard words, e.g. English design terms like „alignen“ turned into German look-alikes; where the text above makes no sense, go by what was meant) ${raw}`
        : transcript
          ? `(said in a recording) ${transcript}`
          : '';
    const body =
      [commentWords(message), spoken].filter(Boolean).join('\n') ||
      '(recording or picture without text)';
    const who = message.author.type === 'ai' ? 'You (AI, a comment you left)' : message.author.name;
    lines.push(`${who}${marks}: ${body}`);
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
  { onlyRunning = false }: { onlyRunning?: boolean } = {},
): Promise<void> {
  const id = eq(aiProposals.id, proposal.id);
  await deps.db
    .update(aiProposals)
    .set({ ...values, updatedAt: deps.clock.now() })
    .where(onlyRunning ? and(id, eq(aiProposals.status, 'running')) : id);
  deps.live?.proposalsChanged(proposal.deckId);
}

/** Like `finish`, unless someone stopped the run meanwhile – then it stays stopped. */
const settle = (deps: AppDeps, proposal: ProposalRow, values: Partial<ProposalRow>) =>
  finish(deps, proposal, values, { onlyRunning: true });

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
  const pictures = await Promise.all(
    rows
      .slice(-MAX_THREAD_PICTURES)
      .filter((row) => row.sizeBytes <= MAX_SHOWN_PICTURE_BYTES)
      .map(async (row): Promise<ThreadPicture[]> => {
        const bytes = await deps.media.get(row.storageKey);
        const size = bytes && imageSize(bytes);
        if (!bytes || !size || !isShowable(size.mediaType)) return [];
        return [
          {
            mediaId: row.id,
            bytes,
            mediaType: size.mediaType,
            width: size.width,
            height: size.height,
            from: authors.get(row.commentId) ?? '',
          },
        ];
      }),
  );
  return pictures.flat();
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
  /** Pictures generated so far. */
  private generated = 0;
  private readonly found = new Map<string, StockPhotoRecord>();
  /**
   * Stock photos, cut-out and generated pictures made available by path (edit pictures of the deck); of
   * the stock photos the last one counts.
   */
  private readonly photos = new Map<
    string,
    { imageId: string; bytes: Uint8Array; mediaType: string }
  >();
  private photo: Omit<AiStockPhotos, 'elementId' | 'reported'> | null = null;
  /** Layouts taken in from the workspace's templates, and the templates read so far, by id. */
  private taken: AiTakenLayout[] = [];
  private readonly designs = new Map<string, Promise<OdpDesign>>();
  /** The deck measured as it is now – again after each change. */
  private measured: { slides: OdpSlide[]; stats: DeckStats } | null = null;
  /** The comment thread the run works for, left out of the comments it lists. */
  thread: string | null = null;
  /**
   * Told the key of each written slide's small drawing – the run's progress in its thread. The
   * one told owns it (deletes it); without a listener it goes at once.
   */
  onDrawn: ((thumbnailKey: string) => void) | null = null;

  private constructor(
    private readonly deps: AppDeps,
    private readonly target: EditTarget,
    readonly base: OdpDocument,
    bytes: Uint8Array,
    document: OdpDocument,
    /** The stored drawing of each slide of the file, by page id. */
    private readonly pictures: ReadonlyMap<string, string>,
    /** Slider's slide of each page of the file, by page id. */
    private readonly slideIds: ReadonlyMap<string, string>,
    readonly threadPictures: readonly ThreadPicture[],
    /** How the ids of elements and slides it adds begin – its own, see `OdpDocument.idPrefix`. */
    private readonly idPrefix: string,
    /** The stored small drawing of each slide of the file, by page id. */
    private readonly thumbnails: ReadonlyMap<string, string>,
    /** What the workspace says of the deck's design – its template's colours, grid, guides. */
    readonly design: DeckDesign,
  ) {
    this.bytes = bytes;
    this.document = document;
  }

  static async open(
    deps: AppDeps,
    target: EditTarget,
    threadPictures: readonly ThreadPicture[],
    idPrefix: string,
    design?: DeckDesign,
  ): Promise<DeckCopy> {
    const [bytes, versions] = await Promise.all([
      readFile(deps, target.revision.pptxKey),
      deps.db
        .select({
          slideId: slideVersions.slideId,
          imageKey: slideVersions.imageKey,
          thumbnailKey: slideVersions.thumbnailKey,
        })
        .from(slideVersions)
        .where(eq(slideVersions.revisionId, target.revision.id))
        .orderBy(asc(slideVersions.position)),
    ]);
    // Page ids as every other reading of this file gets them (`ensureIds` is the same each time).
    const base = await OdpDocument.open(bytes);
    base.ensureIds();
    const document = await OdpDocument.open(bytes);
    document.ensureIds();
    const pictures = new Map<string, string>();
    const thumbnails = new Map<string, string>();
    const slideIds = new Map<string, string>();
    base.pageIds().forEach((pageId, index) => {
      const version = versions[index];
      if (version) slideIds.set(pageId, version.slideId);
      if (version?.imageKey.endsWith('.webp')) pictures.set(pageId, version.imageKey);
      if (version?.thumbnailKey) thumbnails.set(pageId, version.thumbnailKey);
    });
    document.idPrefix = idPrefix;
    return new DeckCopy(
      deps,
      target,
      base,
      bytes,
      document,
      pictures,
      slideIds,
      threadPictures,
      idPrefix,
      thumbnails,
      design ??
        (await deckDesign(deps, target, {
          pageIds: base.pageIds(),
          guides: async () => uniqueGuides((await base.slideGuides()).flat()),
        })),
    );
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
    const deck = await DeckCopy.open(
      this.deps,
      target,
      this.threadPictures,
      this.idPrefix,
      this.design,
    );
    deck.thread = this.thread;
    const document = deck.document;
    const outcome = await withFileProblems(() =>
      applyChanges(this.deps, target.deck.id, document, this.changes(), 'apply', {
        partial: true,
      }),
    );
    deck.bytes = await document.toBytes();
    deck.measured = null;
    for (const pageId of outcome.written) deck.written.add(pageId);
    for (const pageId of outcome.moved) deck.moved.add(pageId);
    for (const name of this.ownStyles) deck.ownStyles.add(outcome.renames.get(name) ?? name);
    for (const [path, picture] of this.added) deck.added.set(path, picture);
    for (const [path, photo] of this.photos) deck.photos.set(path, photo);
    for (const [id, photo] of this.found) deck.found.set(id, photo);
    deck.photo = this.photo;
    deck.photoSearches = this.photoSearches;
    deck.generated = this.generated;
    deck.taken = this.taken;
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

  /**
   * Where a comment on a slide goes: its page id (it stays when slides move), and Slider's slide
   * when the slide was there before – one it added has its slide once the change is in.
   */
  placeOf(slide: number): { pageId: string; slideId: string | null } {
    const pageId = this.slides[this.index(slide)]?.pageId;
    if (!pageId) throw new ToolProblem(`Slide ${slide} cannot take a comment.`);
    return { pageId, slideId: this.slideIds.get(pageId) ?? null };
  }

  /** The slides by number and title, as the AI reads the deck. */
  outline(): string {
    const ids = this.slides.map((item) => item.pageId);
    return this.slides
      .map(
        (item) =>
          `${item.index + 1}. ${item.title}${
            item.variantOf
              ? ` (variant of slide ${ids.indexOf(item.variantOf) + 1}, hidden in the show)`
              : item.hidden
                ? ' (hidden)'
                : ''
          }`,
      )
      .join('\n');
  }

  /** Slide `index` drawn as it is now – its stored drawing unless the AI changed it. */
  private async drawing(index: number): Promise<Uint8Array | null> {
    const info = this.slides[index];
    // Hidden slides are not drawn – variants are (they show beside their slide).
    if (!info || (info.hidden && !info.variantOf)) return null;
    const pageId = info.pageId ?? '';
    let picture = this.drawn.get(pageId);
    if (picture === undefined && this.written.has(pageId)) {
      picture = await this.draw(this.bytes, this.slides, index);
      this.drawn.set(pageId, picture);
    } else if (picture === undefined) {
      const stored = this.pictures.get(pageId);
      picture = stored ? await this.deps.storage.get(stored) : null;
    }
    return picture;
  }

  /**
   * The slides as now, the text of those the live editor cannot take read from their styles –
   * with the deck measured on them; both again after each change.
   */
  private measure(): { slides: OdpSlide[]; stats: DeckStats } {
    if (!this.measured) {
      const document = this.document;
      const slides = withTextLooks(
        document.slides(),
        (index) => document.slideXml(index),
        (name) => document.stylesXml([name]).xml[0] ?? null,
        document.fontFamilies(),
      );
      this.measured = {
        slides,
        stats: measureDeck(slides, document.pageSize(), this.design),
      };
    }
    return this.measured;
  }

  stats(): DeckStats {
    return this.measure().stats;
  }

  /** A slide's elements measured – the first `limit` – and its layout check. */
  private measuredSlide(index: number, limit = MAX_INVENTORY): string {
    const { slides, stats } = this.measure();
    const info = slides[index]!;
    const master = masterOf(this.document.slideXml(index));
    return `${slideInventory(info, this.document.pageSize(), master, limit)}\n\n${layoutCheckText(info, stats)}`;
  }

  /** The design of the deck in words. */
  brief(): string {
    const fonts = [...new Set(this.document.embeddedFontFiles().map((font) => font.family))];
    return designBrief(
      this.stats(),
      this.design,
      this.document.masterPages(),
      this.slides,
      (index) => masterOf(this.document.slideXml(index)),
      fonts,
    );
  }

  /** A slide as the AI sees it: drawn, its XML, the styles it names, its elements measured. */
  async view(slide: number): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const index = this.index(slide);
    const info = this.slides[index]!;
    const picture = await this.drawing(index);
    const names = this.document.styleNamesOf(index);
    const styles = this.document.stylesXml(names);
    const inline = styles.xml.join('\n');
    return [
      {
        type: 'text',
        text: `Slide ${slide}${info.hidden ? ' (hidden, not drawn)' : ''}:`,
      },
      ...(picture ? [imageBlock(picture)] : []),
      { type: 'text', text: `Its XML:\n${this.document.slideXml(index)}` },
      {
        type: 'text',
        text:
          inline.length <= MAX_INLINE_STYLES
            ? `The styles it names (master pages: read_styles):\n${inline}`
            : `It names these styles (read_styles shows them): ${names.join(', ')}`,
      },
      { type: 'text', text: this.measuredSlide(index) },
    ];
  }

  /** A slide's elements measured and its layout check, without picture or XML. */
  inspect(slide: number): string {
    return this.measuredSlide(this.index(slide), MAX_INSPECTED);
  }

  /** Slides drawn, seen together: as the AI looks at its neighbours. */
  async glance(
    numbers: readonly number[],
    say: (slide: number) => string,
  ): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const slide of numbers) {
      const picture = await this.drawing(this.index(slide));
      blocks.push({ type: 'text', text: say(slide) });
      if (picture) blocks.push(imageBlock(picture));
    }
    return blocks;
  }

  /** Slides `from`–`to` side by side in one picture, with a line about each. */
  async overview(
    from = 1,
    to = from + SHEET_SLIDES - 1,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const count = this.slides.length;
    if (count === 0) return 'The deck has no slides.';
    const first = Math.min(Math.max(1, from), count);
    const last = Math.min(count, Math.max(first, to), first + SHEET_SLIDES - 1);
    const cells: SheetCell[] = [];
    const lines: string[] = [];
    for (let slide = first; slide <= last; slide += 1) {
      const info = this.slides[slide - 1]!;
      const pageId = info.pageId ?? '';
      const changed = this.written.has(pageId);
      let picture: Uint8Array | null = null;
      if (!info.hidden) {
        const small = !changed && this.thumbnails.get(pageId);
        picture = small ? await this.deps.storage.get(small) : await this.drawing(slide - 1);
      }
      cells.push({
        number: slide,
        picture,
        ...(info.hidden ? { note: 'hidden' } : changed ? { note: 'changed' } : {}),
      });
      const xml = this.document.slideXml(slide - 1);
      const text = info.elements.map((element) => (element.paragraphs ?? []).join(' ')).join(' ');
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      lines.push(
        `${slide}. ${info.title || '(no title)'} – layout ${masterOf(xml) ?? '?'}, ${info.elements.length} elements, ${wordCount} words${info.hidden ? ', hidden' : ''}${changed ? ', changed by you' : ''}`,
      );
    }
    const size = this.document.pageSize();
    const sheet = await contactSheet(cells, size.width / size.height);
    return [
      {
        type: 'text',
        text: `Slides ${first}–${last} of ${count}, left to right, top to bottom${last < count || first > 1 ? ' (deck_overview with from/to shows others)' : ''}:`,
      },
      imageBlock(sheet),
      { type: 'text', text: lines.join('\n') },
    ];
  }

  /** The text of slides, element by element, and their notes. */
  readText(numbers: readonly number[] | undefined): string {
    const chosen = numbers?.length
      ? [...new Set(numbers)].map((slide) => this.index(slide))
      : this.slides.map((info) => info.index);
    return chosen
      .map((index) => {
        const info = this.slides[index]!;
        const parts = info.elements.flatMap((element) => {
          const text = (element.paragraphs ?? []).join('\n').trim();
          return text ? [`[${element.role ?? element.kind} ${element.id}] ${text}`] : [];
        });
        const notes = notesOf(this.document.slideXml(index));
        return [
          `── Slide ${index + 1}${info.hidden ? ' (hidden)' : ''}`,
          ...(parts.length > 0 ? parts : ['(no text)']),
          ...(notes ? [`Notes: ${notes}`] : []),
        ].join('\n');
      })
      .join('\n\n');
  }

  /** A part of a slide as it looks now, close up. */
  async zoom(
    slide: number,
    area: { x: number; y: number; width: number; height: number },
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const index = this.index(slide);
    if (this.slides[index]!.hidden) throw new ToolProblem(`Slide ${slide} is hidden – not drawn.`);
    const picture = await this.drawing(index);
    if (!picture) throw new ToolProblem(`Slide ${slide} has no drawing to zoom into.`);
    const zoomed = await zoomArea(picture, area, this.document.pageSize());
    if (!zoomed) throw new ToolProblem('That area is not on the slide.');
    const { x, y, width, height } = zoomed.area;
    return [
      { type: 'text', text: `Slide ${slide}, x ${x}–${x + width}, y ${y}–${y + height} cm:` },
      imageBlock(zoomed.bytes),
    ];
  }

  /** A layout big with its placeholders: a template's, or a master page of the deck. */
  async viewLayout(
    source: { template: string; layout: number } | { master: string },
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const placeholders = (page: { placeholders: OdpMasterPage['placeholders'] }) =>
      page.placeholders.length > 0
        ? page.placeholders
            .map(
              (holder) =>
                `- ${holder.kind}${holder.prompt ? ` (asks „${holder.prompt.replace(/\s+/g, ' ')}“)` : ''}: x ${holder.x}, y ${holder.y}, w ${holder.width}, h ${holder.height}`,
            )
            .join('\n')
        : '- no placeholders';
    if ('master' in source) {
      const page = this.document
        .masterPages()
        .find((candidate) => candidate.name === source.master);
      if (!page)
        throw new ToolProblem(
          `The deck has no master page ${source.master} – list_layouts lists them.`,
        );
      const user = this.slides.find(
        (info) => masterOf(this.document.slideXml(info.index)) === page.name && !info.hidden,
      );
      const picture = user ? await this.drawing(user.index) : null;
      return [
        {
          type: 'text',
          text: `Master page ${page.name}${page.displayName ? ` („${page.displayName}“)` : ''} – its placeholders:\n${placeholders(page)}${user ? `\nSlide ${user.index + 1} uses it:` : '\nNo slide uses it yet.'}`,
        },
        ...(picture ? [imageBlock(picture)] : []),
      ];
    }
    const row = (await this.templates()).find((candidate) => candidate.id === source.template);
    if (!row)
      throw new ToolProblem(`There is no template ${source.template} – list_layouts lists them.`);
    const layout = row.layouts[source.layout - 1];
    if (!layout)
      throw new ToolProblem(`The template ${source.template} has no layout ${source.layout}.`);
    const design = await this.templateDesign(row);
    const page = design.document.masterPages()[source.layout - 1];
    const bytes = await this.deps.storage.get(layout.imageKey);
    const type = bytes && imageSize(bytes)?.mediaType;
    return [
      {
        type: 'text',
        text: `Layout ${source.layout} „${layout.name ?? page?.name ?? ''}“ of template „${row.name}“ – its placeholders:\n${page ? placeholders(page) : '- unknown'}`,
      },
      ...(bytes && isShowable(type ?? null) && bytes.length <= MAX_SHOWN_PICTURE_BYTES
        ? [imageBlock(bytes, type as Showable)]
        : []),
    ];
  }

  /** The deck's open comments – or a slide's – but the thread the run works for. */
  async comments(slide: number | undefined): Promise<string> {
    const at = new Map<string, number>();
    for (const info of this.slides) {
      const slideId = info.pageId ? this.slideIds.get(info.pageId) : undefined;
      if (slideId) at.set(slideId, info.index + 1);
    }
    const only = slide === undefined ? null : this.placeOf(slide).slideId;
    if (slide !== undefined && !only) return `Slide ${slide} is new – no comments yet.`;
    const rows = await this.deps.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.deckId, this.target.deck.id),
          eq(comments.status, 'open'),
          ...(only ? [eq(comments.slideId, only)] : []),
        ),
      )
      .orderBy(asc(comments.createdAt));
    const roots = rows.filter(
      (row) => !row.parentId && row.id !== this.thread && !row.removedInSourceAt,
    );
    if (roots.length === 0)
      return slide === undefined
        ? 'No other open comments.'
        : `No other open comments on slide ${slide}.`;
    const replies = new Map<string, typeof rows>();
    for (const row of rows) {
      if (row.parentId) replies.set(row.parentId, [...(replies.get(row.parentId) ?? []), row]);
    }
    const short = (body: string) => {
      const text = body.trim().replace(/\s+/g, ' ');
      return text.length > 300 ? `${text.slice(0, 300)}…` : text || '(no text)';
    };
    const lines = roots.slice(0, MAX_COMMENTS_LISTED).map((root) => {
      const where =
        root.slideId && at.has(root.slideId)
          ? `slide ${at.get(root.slideId)}`
          : root.anchor.type === 'gap'
            ? 'between slides'
            : 'a slide no longer there';
      const thread = (replies.get(root.id) ?? []).map(
        (reply) =>
          `\n    ${reply.author.type === 'ai' ? 'AI' : reply.author.name}: ${short(reply.body)}`,
      );
      return `- ${where}, ${root.author.type === 'ai' ? 'AI' : root.author.name}${markText(root)}: ${short(commentWords(root))}${thread.join('')}`;
    });
    return [
      ...lines,
      ...(roots.length > MAX_COMMENTS_LISTED
        ? [`… and ${roots.length - MAX_COMMENTS_LISTED} more.`]
        : []),
    ].join('\n');
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

  /** A picture of the file, or one made available to writes, by its path. */
  private async pictureBytes(path: string): Promise<Uint8Array> {
    const bytes =
      this.added.get(path)?.bytes ??
      this.photos.get(path)?.bytes ??
      (await this.document.picture(path));
    if (!bytes) throw new ToolProblem(`There is no picture ${path} in the file.`);
    return bytes;
  }

  async viewPicture(path: string): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const bytes = await this.pictureBytes(path);
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
    const photos = (
      await searchPhotos(this.deps, this.target.deck.workspaceId, query, { orientation })
    ).slice(0, PHOTOS_SHOWN);
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

  /**
   * Cuts a picture of the file (or one made available) out of its background and makes the cut
   * out copy available to writes, by its path.
   */
  async cutOut(
    path: string,
    area: PictureArea | undefined,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const source = cutOutSource(this.deps);
    if (!source) throw new ToolProblem('Cutting out is not set up on this server.');
    const bytes = await this.pictureBytes(path);
    const size = imageSize(bytes);
    if (!size || !isShowable(size.mediaType)) {
      throw new ToolProblem(`${path} is no PNG, JPEG, GIF or WebP picture and cannot be cut out.`);
    }
    const part = area ? await cropPicture(bytes, area) : null;
    if (area && !part) {
      throw new ToolProblem(`The area misses ${path}: it is ${size.width} × ${size.height} px.`);
    }
    const cut = await source.cutOut(part?.bytes ?? bytes);
    const stored = await storeEditImage(this.deps, this.target.deck.id, cut);
    // Only names it here; write puts it into the file once a slide shows it.
    const copy = this.document.addPicture(cut, stored.mediaType);
    this.photos.set(copy, { imageId: stored.imageId, bytes: cut, mediaType: stored.mediaType });
    return [
      {
        type: 'text',
        text: `${part ? `The area x ${part.area.x}, y ${part.area.y}, ${part.area.width} × ${part.area.height} px of ${path}` : path} cut out as ${copy} (${stored.width} × ${stored.height} px, background transparent)${cut.length <= MAX_SHOWN_PICTURE_BYTES ? ':' : ' – too large to show here, look at the slide once it shows it.'}`,
      },
      ...(cut.length <= MAX_SHOWN_PICTURE_BYTES && isShowable(stored.mediaType)
        ? [imageBlock(cut, stored.mediaType)]
        : []),
    ];
  }

  /** Generates a picture of `prompt` cut to `aspect` and makes it available to writes, by its path. */
  async generateImage(
    prompt: string,
    aspect: number,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    if (this.generated >= MAX_GENERATED) {
      throw new ToolProblem('No more pictures – take one of those generated.');
    }
    this.generated += 1;
    const bytes = await generatePicture(this.deps, this.target.deck, prompt, aspect);
    const stored = await storeEditImage(this.deps, this.target.deck.id, bytes);
    // Only names it here; write puts it into the file once a slide shows it.
    const path = this.document.addPicture(bytes, stored.mediaType);
    this.photos.set(path, { imageId: stored.imageId, bytes, mediaType: stored.mediaType });
    const type = stored.mediaType;
    const shown = bytes.length <= MAX_SHOWN_PICTURE_BYTES && isShowable(type) ? type : null;
    return [
      {
        type: 'text',
        text: `The picture can be used as ${path} (${stored.width} × ${stored.height} px), e.g. <draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/> in a draw:frame of width / height ${aspect.toFixed(2)}${shown ? ':' : ' – too large to show here, look at the slide once it shows it.'}`,
      },
      ...(shown ? [imageBlock(bytes, shown)] : []),
    ];
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
    /** `false`: not drawn – nobody looks at it now (a quick request). */
    draw = true,
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
    const index = pageId === null || !draw ? -1 : document.pageIds().indexOf(pageId);
    const picture = index === -1 ? null : await this.draw(bytes, document.slides(), index);
    this.bytes = bytes;
    this.document = document;
    this.measured = null;
    if (pageId !== null) {
      if (draw) this.drawn.set(pageId, picture);
      else this.drawn.delete(pageId);
    }
    return { pageId, picture };
  }

  /** Slide `index` of the file `bytes` drawn by LibreOffice (`null` when hidden). */
  private async draw(
    bytes: Uint8Array,
    slides: OdpSlide[],
    index: number,
  ): Promise<Uint8Array | null> {
    const slide = slides[index];
    if (slide?.hidden && !slide.variantOf) return null;
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
    const shown = this.onDrawn;
    await Promise.all(
      [keys.imageKey, ...(shown ? [] : [keys.thumbnailKey])].map((key) =>
        this.deps.storage.delete(key).catch(() => {}),
      ),
    );
    shown?.(keys.thumbnailKey);
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
    const info = this.measure().slides[slide - 1];
    return [
      {
        type: 'text',
        text: picture ? `Slide ${slide} ${what}:` : `Slide ${slide} ${what} (hidden, not drawn).`,
      },
      ...(picture ? [imageBlock(picture)] : []),
      // What a designer would measure on it, to correct before stopping.
      ...(info && picture
        ? [{ type: 'text' as const, text: layoutCheckText(info, this.stats()) }]
        : []),
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
    // A variant stays one – marked as its slide's, hidden in the show – however it is written.
    const of = this.slides[index]?.variantOf ?? null;
    const written =
      of && !/^\s*<draw:page\b[^>]*\sslider:variant-of=/.test(xml)
        ? xml.replace(/<draw:page\b/, `<draw:page slider:variant-of="${of}"`)
        : xml;
    const { pageId, picture } = await this.change((document) => {
      added = this.prepare(document, written, styles);
      document.replaceSlide(index, written);
      if (of) {
        document.setSlideHidden(index, true);
        for (const name of this.base.stylesXml(document.styleNamesOf(index)).missing) {
          added.push(name);
        }
      }
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

  /**
   * Changes and adds elements of a slide with the editor's own operations – a box in cm becomes
   * shares of the slide – and draws it. A change the editor cannot make refuses them all.
   */
  async changeElements(
    slide: number,
    changes: readonly z.infer<typeof elementChange>[],
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const index = this.index(slide);
    const info = this.slides[index]!;
    const size = this.document.pageSize();
    const names = new Set(changes.flatMap((change) => (change.name ? [change.name] : [])));
    for (const change of changes) {
      if (
        change.element &&
        !names.has(change.element) &&
        !info.elements.some((element) => element.id === change.element)
      ) {
        throw new ToolProblem(
          `Slide ${slide} has no element ${change.element} – give its xml:id (or the name of an element added before in this call). Nothing was changed.`,
        );
      }
    }
    const percent = { x: 100 / size.width, y: 100 / size.height };
    const edits = changes.map((change): QuickEdit => {
      const { box, width, height, next_to: nextTo, from, to, ...rest } = change;
      const end = (value: typeof from) =>
        value && 'x' in value ? { x: value.x * percent.x, y: value.y * percent.y } : value;
      const across = nextTo?.side === 'left' || nextTo?.side === 'right';
      return {
        ...rest,
        ...(box
          ? {
              box: {
                x: box.x * percent.x,
                y: box.y * percent.y,
                w: box.width * percent.x,
                h: box.height * percent.y,
              },
            }
          : {}),
        ...(width || height
          ? {
              size: {
                ...(width ? { w: width * percent.x } : {}),
                ...(height ? { h: height * percent.y } : {}),
              },
            }
          : {}),
        ...(nextTo
          ? {
              next_to: {
                ...nextTo,
                gap:
                  nextTo.gap !== null && nextTo.gap !== undefined
                    ? nextTo.gap * (across ? percent.x : percent.y)
                    : null,
              },
            }
          : {}),
        ...(from ? { from: end(from) } : {}),
        ...(to ? { to: end(to) } : {}),
      };
    });
    const plan = quickPlan(edits, [info], null, { page: size });
    if ('problem' in plan) {
      const which =
        plan.index === -1
          ? 'The changes'
          : `${edits.length > 1 ? `Change ${plan.index + 1} ` : ''}(${changes[plan.index]!.element ?? changes[plan.index]!.name ?? changes[plan.index]!.add ?? changes[plan.index]!.copy_of})`;
      throw new ToolProblem(
        `${which}: ${plan.problem} – correct it, or use edit_slide for what the editor cannot do. Nothing was changed.`,
      );
    }
    const pageId = info.pageId as string;
    const { picture } = await this.change((document) => {
      document.apply(plan.operations);
      // The styles its operations made come along with the change.
      const named = document.styleNamesOf(index);
      for (const name of this.base.stylesXml(named).missing) this.ownStyles.add(name);
      return pageId;
    });
    this.written.add(pageId);
    const result = this.drawnResult(slide, picture, 'now');
    if (plan.added.length === 0) return result;
    const ids = plan.added
      .map((each) => (each.name ? `${each.name}: ${each.id}` : each.id))
      .join(', ');
    return [{ type: 'text', text: `New elements (xml:id): ${ids}.` }, ...result];
  }

  /** The slide at 0-based `index` as the editor sees it. */
  editable(index: number): OdpSlide | undefined {
    return this.slides[index];
  }

  /**
   * A quick request's edits applied to slide `index` – places worked out inside the design's
   * margins – without drawing it. `false` when they do not fit or change nothing: the AI does
   * the request then, on the copy as it was.
   */
  async applyQuick(index: number, edits: readonly QuickEdit[]): Promise<boolean> {
    const info = this.slides[index];
    const pageId = info?.pageId;
    if (!info || !pageId) return false;
    const page = this.document.pageSize();
    const operations = quickOperations(edits, [info], marginsOf(this.design, page), { page });
    if (!operations) return false;
    const before = this.document.slideXml(index);
    const made = new Set<string>();
    try {
      await this.change((document) => {
        const outcome = document.applyWhatFits(operations);
        if (outcome.dropped.length > 0 || outcome.applied.length === 0) {
          throw new ToolProblem(outcome.reason ?? 'does not fit');
        }
        for (const name of this.base.stylesXml(document.styleNamesOf(index)).missing) {
          made.add(name);
        }
        return pageId;
      }, false);
    } catch (error) {
      if (error instanceof ToolProblem || error instanceof OdpError) return false;
      throw error;
    }
    if (this.document.slideXml(index) === before) return false;
    for (const name of made) this.ownStyles.add(name);
    this.written.add(pageId);
    return true;
  }

  /**
   * A variant of slide `slide` (of its slide, when it is a variant itself): a copy right after the
   * slide's variants, hidden and marked as its variant (`OdpDocument.addVariant`) – drawn, with its
   * number.
   */
  async addVariant(
    slide: number,
  ): Promise<{ number: number; content: Anthropic.Beta.BetaToolResultBlockParam['content'] }> {
    const index = this.index(slide);
    const pageId = `${this.idPrefix}v${crypto.randomUUID().slice(0, 8)}`;
    const { picture } = await this.change((document) => {
      document.addVariant(index, pageId);
      // Its page style (hidden) is new: it comes along with the change.
      const at = document.pageIds().indexOf(pageId);
      for (const name of this.base.stylesXml(document.styleNamesOf(at)).missing) {
        this.ownStyles.add(name);
      }
      return pageId;
    });
    this.written.add(pageId);
    const ids = this.slides.map((item) => item.pageId);
    const number = ids.indexOf(pageId) + 1;
    const main = ids.indexOf(this.slides[number - 1]?.variantOf ?? '') + 1;
    return {
      number,
      content: [
        ...this.drawnResult(number, picture, `added – a variant of slide ${main}`),
        { type: 'text', text: `The deck's slides now:\n${this.outline()}` },
      ],
    };
  }

  /**
   * Adds a slide after slide `after` (0: first) – written, a copy of a slide, or an empty slide
   * of a layout (the deck's own, or a template's taken in) – and draws it.
   */
  async insert(
    after: number,
    source:
      | { xml: string; styles?: string }
      | { copyOf: number }
      | { master: string }
      | { template: string; layout: number },
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    if (after > this.slides.length) {
      throw new ToolProblem(`There is no slide ${after}; the deck has ${this.slides.length}.`);
    }
    const template =
      'template' in source ? await this.templateLayout(source.template, source.layout) : null;
    let added: string[] = [];
    let taken: AiTakenLayout | null = null;
    const { pageId, picture } = await this.change((document) => {
      if ('copyOf' in source) return document.duplicateSlide(this.index(source.copyOf), after);
      // In the look of the slide before it (the first: of the one after), as the editor's gap.
      const like = Math.max(0, after - 1);
      if ('master' in source) return document.addSlide(after, { like, master: source.master });
      if (template) {
        const as = document.takeMasterPageFrom(template.design, template.master);
        taken = { template: template.id, master: template.master, as };
        return document.addSlide(after, { like, master: as });
      }
      const xml = (source as { xml: string; styles?: string }).xml;
      added = this.prepare(document, xml, (source as { styles?: string }).styles);
      return document.insertSlide(after, xml);
    });
    this.written.add(pageId as string);
    for (const name of added) this.ownStyles.add(name);
    const took = taken as AiTakenLayout | null;
    if (took && !this.taken.some((other) => other.as === took.as)) {
      this.taken = [...this.taken, took];
    }
    const empty = !('xml' in source) && !('copyOf' in source);
    return [
      ...this.drawnResult(after + 1, picture, 'added'),
      ...(empty
        ? [{ type: 'text' as const, text: `Its XML:\n${this.document.slideXml(after)}` }]
        : []),
      { type: 'text', text: `The deck's slides now:\n${this.outline()}` },
    ];
  }

  /** The workspace's templates a slide of this deck can take layouts from. */
  private async templates() {
    const rows = await this.deps.db
      .select()
      .from(workspaceMasters)
      .where(eq(workspaceMasters.workspaceId, this.target.deck.workspaceId))
      .orderBy(desc(workspaceMasters.createdAt));
    return rows.filter((row) => row.format === 'odp');
  }

  /** A template's design, read once. */
  private templateDesign(row: { id: string; fileKey: string }): Promise<OdpDesign> {
    let design = this.designs.get(row.id);
    if (!design) {
      design = (async () => {
        const bytes = await this.deps.storage.get(row.fileKey);
        if (!bytes) throw new ToolProblem('This template’s file is gone.');
        return (await OdpDocument.open(bytes)).design();
      })();
      design.catch(() => this.designs.delete(row.id));
      this.designs.set(row.id, design);
    }
    return design;
  }

  /** Layout `layout` (1 = first) of the workspace's template `id`: its master page. */
  private async templateLayout(id: string, layout: number) {
    const row = (await this.templates()).find((candidate) => candidate.id === id);
    if (!row) throw new ToolProblem(`There is no template ${id} – list_layouts lists them.`);
    const design = await this.templateDesign(row);
    const master = design.document.masterPages()[layout - 1]?.name;
    if (!master) {
      throw new ToolProblem(
        `The template ${id} has no layout ${layout} – list_layouts lists them.`,
      );
    }
    return { id, design, master };
  }

  /** The layouts a new slide can take: the deck's master pages and the templates' layouts. */
  async listLayouts(): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const users = new Map<string, number[]>();
    for (const slide of this.slides) {
      const master = /draw:master-page-name="([^"]*)"/.exec(
        this.document.slideXml(slide.index),
      )?.[1];
      if (master) users.set(master, [...(users.get(master) ?? []), slide.index + 1]);
    }
    const own = this.document.masterPages().map((page) => {
      const shown = page.displayName ? ` („${page.displayName}“)` : '';
      const on = users.get(page.name);
      return `- ${page.name}${shown}${on ? ` – slides ${on.join(', ')}` : ' – no slide yet'}`;
    });
    const size = this.document.pageSize();
    const aspect = size.width / size.height;
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
      {
        type: 'text',
        text: `The deck's master pages (insert_slide with master):\n${own.join('\n') || 'none'}`,
      },
    ];
    let shown = 0;
    for (const row of await this.templates()) {
      if (Math.abs(row.aspectRatio - aspect) > 0.01) {
        blocks.push({
          type: 'text',
          text: `Template ${row.id} „${row.name}“: another page shape than the deck's – its layouts do not fit.`,
        });
        continue;
      }
      blocks.push({
        type: 'text',
        text: `Template ${row.id} „${row.name}“ (insert_slide with template and layout):`,
      });
      for (const [i, layout] of row.layouts.entries()) {
        blocks.push({ type: 'text', text: `${i + 1}. ${layout.name}` });
        if (shown >= MAX_LAYOUT_PICTURES) continue;
        const thumbnail = await this.deps.storage.get(layout.thumbnailKey);
        const type = thumbnail && imageSize(thumbnail)?.mediaType;
        if (thumbnail && isShowable(type ?? null)) {
          blocks.push(imageBlock(thumbnail, type as Showable));
          shown += 1;
        }
      }
    }
    return blocks as Anthropic.Beta.BetaToolResultBlockParam['content'];
  }

  /**
   * Tilts an element of a slide in depth – drawn alone by LibreOffice, tilted here, put over it as
   * the editor does (`setTilt`) – or lays it flat, and draws the slide.
   */
  async tilt(
    slide: number,
    elementId: string,
    tilt: { x: number; y: number },
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam['content']> {
    const index = this.index(slide);
    const info = this.slides[index]!;
    const element = info.elements.find((candidate) => candidate.id === elementId);
    if (!element) {
      throw new ToolProblem(`Slide ${slide} has no element ${elementId} – give its xml:id.`);
    }
    const pageId = info.pageId as string;
    if (!isTilted(tilt)) {
      const { picture } = await this.change((document) => {
        document.apply([{ type: 'setTilt', elementId, tilt: null, picture: null }]);
        return pageId;
      });
      this.written.add(pageId);
      return this.drawnResult(slide, picture, 'now, the element flat');
    }
    const { deck, revision } = this.target;
    const alone = await elementAlone(
      this.deps,
      { deckId: deck.id, revisionId: revision.id, workspaceId: deck.workspaceId },
      this.bytes,
      index,
      elementId,
    );
    if (!alone) throw new ToolProblem(`Element ${elementId} draws nothing to tilt.`);
    const size = this.document.pageSize();
    const { bbox } = element;
    const baked = await bakeTilt({
      bytes: alone.image,
      box: alone.box,
      centre: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 },
      tilt,
      aspect: size.width / size.height,
    });
    const stored = await storeEditImage(this.deps, deck.id, baked.bytes);
    const image = {
      bytes: baked.bytes,
      mediaType: stored.mediaType,
      width: stored.width,
      height: stored.height,
    };
    const { picture } = await this.change((document) => {
      document.apply(
        [
          {
            type: 'setTilt',
            elementId,
            tilt: { ...tilt, source: alone.source },
            picture: { imageId: stored.imageId, box: baked.box },
          },
        ],
        new Map([[stored.imageId, image]]),
      );
      return pageId;
    });
    // Its picture goes into the file with the change, as a cut-out one does.
    this.photos.set(picturePath(baked.bytes, stored.mediaType), {
      imageId: stored.imageId,
      bytes: baked.bytes,
      mediaType: stored.mediaType,
    });
    this.written.add(pageId);
    return this.drawnResult(slide, picture, 'now, the element tilted');
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
        ...(this.taken.length > 0 ? { layouts: this.taken } : {}),
      });
    }
    return changes.sort((a, b) => a.index - b.index);
  }
}

/** A comment the AI leaves on its own: on a slide (see `DeckCopy.placeOf`), maybe on an area of it. */
interface Note {
  pageId: string;
  slideId: string | null;
  text: string;
  rect: Rect | null;
  /** Written on the slide as a sticker over `rect`, as people stick one (`stickerStroke`). */
  sticker?: TextStroke;
}

/** What the AI says besides its change: comments to leave, and whether its reply asks back. */
class Remarks {
  readonly notes: Note[] = [];
  asks = false;
}

/** An area in cm on a slide of `size`, as a rect of the slide (0–1), clamped to it. */
function slideRect(
  area: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
): Rect {
  const unit = (value: number) => Math.min(1, Math.max(0, value));
  const x = unit(area.x / size.width);
  const y = unit(area.y / size.height);
  return {
    x,
    y,
    w: Math.max(0.01, unit((area.x + area.width) / size.width) - x),
    h: Math.max(0.01, unit((area.y + area.height) / size.height) - y),
  };
}

/** Sticker text, as a share of the slide's height – about what people's stickers start with. */
const STICKER_FONT_SIZE = 0.03;
/** A sticker is at least this wide (cm), so a few words fit on a line. */
const STICKER_MIN_WIDTH_CM = 4;

/**
 * The AI's sticker over `rect` (0–1 of a slide of `size` cm): at least a few words wide, as high
 * as its text roughly needs (the viewer grows it to the text), kept on the slide.
 */
function stickerStroke(
  text: string,
  rect: Rect,
  size: { width: number; height: number },
): TextStroke {
  const fontSize = STICKER_FONT_SIZE;
  const w = Math.min(1, Math.max(rect.w, STICKER_MIN_WIDTH_CM / size.width));
  // Semibold Inter averages ~0.55 em a letter; padding as `TEXT_BOX_LOOK` (0.35 em, 0.15 em).
  const lineChars = Math.max(
    1,
    Math.floor(((w * size.width) / (fontSize * size.height) - 0.7) / 0.55),
  );
  const lines = text
    .trim()
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / lineChars)), 0);
  const h = Math.min(1, Math.max(rect.h, fontSize * (lines * 1.25 + 0.3)));
  const round = (value: number) => Math.round(value * 10_000) / 10_000;
  const x = round(Math.min(Math.max(0, rect.x), 1 - w));
  const y = round(Math.min(Math.max(0, rect.y), 1 - h));
  return {
    tool: 'text',
    color: 'violet',
    x,
    y,
    // Rounded down: the box stays on the slide.
    w: Math.floor(Math.min(w, 1 - x) * 10_000) / 10_000,
    h: Math.floor(Math.min(h, 1 - y) * 10_000) / 10_000,
    text: text.trim().slice(0, MAX_TEXT_ANNOTATION_LENGTH),
    fontSize,
  };
}

/** What a call whose input came as broken JSON gets back. */
const UNREADABLE_CALL =
  'Your input for this call was not valid JSON – most likely a " or \\ inside the XML left unescaped. Nothing was done: send the call again, with every " in a string written as \\".';

/** Tools that only look at the deck: several of them in one answer run side by side. */
const LOOKING_TOOLS = new Set([
  'view_slide',
  'search_deck',
  'deck_overview',
  'read_text',
  'inspect_slide',
  'zoom_slide',
  'view_layout',
  'list_comments',
  'list_pictures',
  'view_picture',
  'list_layouts',
  'read_styles',
]);

/** An answer's calls in groups to run: neighbouring looks together, every other call alone. */
export function callGroups<T extends { name: string }>(calls: readonly T[]): T[][] {
  const groups: T[][] = [];
  for (const call of calls) {
    const last = groups.at(-1);
    if (last?.[0] && LOOKING_TOOLS.has(call.name) && LOOKING_TOOLS.has(last[0].name)) {
      last.push(call);
    } else groups.push([call]);
  }
  return groups;
}

async function runTool(
  deck: DeckCopy,
  remarks: Remarks,
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
    if (call.name === 'deck_overview') {
      const input = overviewInput.parse(call.input);
      return result(await deck.overview(input.from, input.to));
    }
    if (call.name === 'read_text') {
      return result(deck.readText(readTextInput.parse(call.input).slides));
    }
    if (call.name === 'inspect_slide') {
      return result(deck.inspect(viewInput.parse(call.input).slide));
    }
    if (call.name === 'zoom_slide') {
      const input = zoomInput.parse(call.input);
      return result(await deck.zoom(input.slide, input.area));
    }
    if (call.name === 'view_layout') {
      const input = layoutInput.parse(call.input);
      return result(
        await deck.viewLayout(
          input.master !== undefined
            ? { master: input.master }
            : { template: input.template as string, layout: input.layout as number },
        ),
      );
    }
    if (call.name === 'list_comments') {
      return result(await deck.comments(commentsInput.parse(call.input).slide));
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
    if (call.name === 'cut_out') {
      const input = cutOutInput.parse(call.input);
      return result(await deck.cutOut(input.path, input.area));
    }
    if (call.name === 'generate_image') {
      const input = generateInput.parse(call.input);
      return result(await deck.generateImage(input.prompt, input.aspect));
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
            : input.master !== undefined
              ? { master: input.master }
              : input.template !== undefined
                ? { template: input.template, layout: input.layout as number }
                : { xml: input.xml as string, styles: input.styles },
        ),
      );
    }
    if (call.name === 'add_variant') {
      return result((await deck.addVariant(viewInput.parse(call.input).slide)).content);
    }
    if (call.name === 'list_layouts') {
      return result(await deck.listLayouts());
    }
    if (call.name === 'tilt_element') {
      const input = tiltInput.parse(call.input);
      return result(await deck.tilt(input.slide, input.element, { x: input.x, y: input.y }));
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
    if (call.name === 'change_elements') {
      const input = changeInput.parse(call.input);
      return result(await deck.changeElements(input.slide, input.changes));
    }
    if (call.name === 'add_comment') {
      const input = commentInput.parse(call.input);
      if (remarks.notes.length >= MAX_NOTES)
        return result(`You left ${MAX_NOTES} comments already – no more.`, true);
      const size = deck.base.pageSize();
      if (input.sticker && !input.area)
        return result('A sticker needs an `area`: where on the slide it sits.', true);
      const rect = input.area ? slideRect(input.area, size) : null;
      const sticker = input.sticker && rect ? stickerStroke(input.text, rect, size) : undefined;
      remarks.notes.push({
        ...deck.placeOf(input.slide),
        text: input.text,
        rect: sticker ? { x: sticker.x, y: sticker.y, w: sticker.w, h: sticker.h } : rect,
        ...(sticker ? { sticker } : {}),
      });
      return result(
        `${sticker ? 'Sticker' : 'Comment'} on slide ${input.slide} noted; it is posted when you are done.`,
      );
    }
    if (call.name === 'ask_back') {
      remarks.asks = true;
      return result('Your reply asks back: the thread waits for the answer.');
    }
    return result(`There is no tool ${call.name}.`, true);
  } catch (error) {
    if (error instanceof ToolProblem) return result(error.message, true);
    // Unsplash out of reach or out of requests: the AI goes on without a photo.
    if (error instanceof ApiError && ['search_photos', 'add_photo'].includes(call.name)) {
      return result(`Stock photos are not available right now: ${error.message}`, true);
    }
    if (error instanceof ApiError && call.name === 'generate_image') {
      return result(`Generating pictures is not available right now: ${error.message}`, true);
    }
    if (error instanceof ApiError && call.name === 'cut_out') {
      return result(`Cutting out is not available right now: ${error.message}`, true);
    }
    if (error instanceof ApiError && call.name === 'tilt_element') {
      return result(`Tilting is not available right now: ${error.message}`, true);
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

/** The first comment of the thread a comment is in. */
async function threadRoot(deps: AppDeps, commentId: string | null): Promise<string | null> {
  if (!commentId) return null;
  const [row] = await deps.db
    .select({ id: comments.id, parentId: comments.parentId })
    .from(comments)
    .where(eq(comments.id, commentId));
  return row ? (row.parentId ?? row.id) : null;
}

/**
 * What the AI sees before its first turn besides the thread: the design of the deck in words,
 * an overview of the slides around the place, the commented slide (or the slides around the
 * place) with its XML, styles, elements measured and layout check, the slides next to it, and
 * the other open comments there.
 */
async function firstLook(
  deck: DeckCopy,
  place: CommentPlace,
): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const count = deck.slides.length;
  const numbers = place.shown.map((at) => at + 1);
  const centre = numbers[0] ?? 1;
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'text', text: `The design of the deck – keep to it:\n${deck.brief()}` },
  ];
  try {
    const from = Math.max(
      1,
      Math.min(centre - Math.floor(SHEET_SLIDES / 2), count - SHEET_SLIDES + 1),
    );
    blocks.push(
      { type: 'text', text: 'The deck at a glance:' },
      ...((await deck.overview(
        from,
        from + SHEET_SLIDES - 1,
      )) as Anthropic.Beta.BetaContentBlockParam[]),
    );
  } catch {
    // Without the overview the AI still has the outline; deck_overview may try again.
  }
  for (const slide of numbers) {
    blocks.push(...((await deck.view(slide)) as Anthropic.Beta.BetaContentBlockParam[]));
  }
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  const neighbours = [first - 1, last + 1].filter((slide) => slide >= 1 && slide <= count);
  if (neighbours.length > 0) {
    blocks.push(
      ...(await deck.glance(
        neighbours,
        (slide) =>
          `Slide ${slide}, ${slide < first ? 'before' : 'after'} – for the slides to fit together:`,
      )),
    );
  }
  const open: string[] = [];
  for (const slide of numbers) {
    const listed = await deck.comments(slide);
    if (listed.startsWith('- ')) open.push(`On slide ${slide}:\n${listed}`);
  }
  if (open.length > 0) {
    blocks.push({
      type: 'text',
      text: `Other open comments there – context, not your request:\n${open.join('\n')}`,
    });
  }
  return blocks;
}

/**
 * A request that is nothing but plain changes, made with the fast model's edits (see
 * `quick-requests`): its answer in the thread, or `null` when the AI that designs does it.
 */
async function quickly(
  deps: AppDeps,
  connection: AiConnection,
  deck: DeckCopy,
  place: CommentPlace,
  proposal: ProposalRow,
  signal: AbortSignal,
  clock: RunClock,
): Promise<string | null> {
  const startedAt = Date.now();
  const index = place.shown[0];
  const slide = index === undefined ? undefined : deck.editable(index);
  if (index === undefined || !slide) return null;
  const attempt = async (): Promise<{ edits: QuickEdit[] | null; outcome: string }> => {
    try {
      const edits = await quickEdits(
        deps,
        connection,
        quickPrompt({
          slide,
          number: index + 1,
          page: deck.base.pageSize(),
          design: deck.design,
          thread: proposal.prompt,
        }),
        signal,
      );
      if (!edits) return { edits: null, outcome: 'to the AI – more than plain changes' };
      if (!placesAgree(edits, proposal.prompt)) {
        return { edits: null, outcome: 'to the AI – places disagree with the words' };
      }
      if (!(await deck.applyQuick(index, edits))) {
        return { edits: null, outcome: 'to the AI – edits do not fit' };
      }
      return { edits, outcome: 'made at once' };
    } catch (error) {
      // The AI that designs tries the key again and tells what is wrong with it.
      if (signal.aborted) throw error;
      return {
        edits: null,
        outcome: `to the AI – ${error instanceof Error ? error.message : 'failed'}`,
      };
    }
  };
  const { edits, outcome } = await attempt();
  clock.quick(Date.now() - startedAt, outcome);
  return edits ? quickSummary(edits) : null;
}

/**
 * A variant of the place's slide made in the copy – the place the AI works at from then on: the
 * variant, to change as asked, the slide itself left as it is.
 */
async function variantPlace(deck: DeckCopy, place: CommentPlace): Promise<CommentPlace> {
  const slide = (place.shown[0] ?? 0) + 1;
  const { number } = await deck.addVariant(slide);
  return {
    slideId: place.slideId,
    shown: [number - 1],
    text: `Slide ${number} is a new variant of slide ${slide} – a copy of it, hidden in the show, that the people compare with the slide and can use instead. Make the variant as asked below, on slide ${number} only: slide ${slide} itself stays as it is. Change only what the request is about; the variant keeps the deck's design.`,
  };
}

/**
 * Whether a thread asks for a variant of a slide – a slide more, never edits of the slide itself:
 * „Variante“, „Alternative“, „andere/zweite/weitere Version“ or „Fassung“, „noch eine Version“,
 * „Version B“, „Gegenentwurf“, „Plan B“ – in English „variant“, „alternative“, „another/second/
 * different version“, „version B“, „another take“. Any case; „Alternativtext“ (alt text) is none.
 */
const VARIANT_ASKED = new RegExp(
  [
    String.raw`\bvariant`,
    String.raw`\balternativ(?!e?\s*-?\s*text)`,
    String.raw`\b(?:andere|zweite|weitere|alternative|noch\s+(?:so\s+)?eine)[nrsm]?\s+(?:version|fassung)`,
    String.raw`\b(?:version|fassung)\s+[b-d]\b`,
    String.raw`\bgegenentwurf`,
    String.raw`\bplan\s+b\b`,
    String.raw`\b(?:another|second|different|alternate|other)\s+(?:version|take)\b`,
  ].join('|'),
  'i',
);
export const asksForVariant = (thread: string): boolean => VARIANT_ASKED.test(thread);

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
  /** Plain changes are tried first with the fast model (not for requests said aloud). */
  quick: boolean,
  /**
   * „Variante erstellen“ with words: a variant of the place's slide is made first, and the AI
   * changes it as the words (`proposal.prompt`) say.
   */
  variant = false,
): Promise<void> {
  const clock = new RunClock(deps, proposal.id);
  /** The small drawings shown in the thread – deleted when the run ends. */
  const previews: string[] = [];
  const shown = (key: string) => {
    previews.push(key);
    report(deps, proposal, progressOf.get(proposal.id)?.step ?? 'Ändert die Folie', key);
  };
  try {
    const pictures = proposal.commentId
      ? await threadPictures(deps, target.deck.id, proposal.commentId)
      : [];
    // Ids of its own for what it adds, so they never meet another request's.
    let deck = await DeckCopy.open(deps, target, pictures, `ai${proposal.id.slice(0, 8)}-`);
    deck.thread = await threadRoot(deps, proposal.commentId);
    deck.onDrawn = shown;
    if (variant) place = await variantPlace(deck, place);
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    /**
     * The first message – the design brief, the deck at a glance, the slide drawn – made when the
     * AI that designs is needed: a quick request does without.
     */
    const open = async () => {
      if (messages.length > 0) return;
      const outline = deck.outline();
      const size = deck.base.pageSize();
      const others = await othersAtWork(deps, target, proposal);
      const context = await firstLook(deck, place);
      clock.prepared();
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `The deck's slides (${size.width} × ${size.height} cm):\n${outline}\n\n${place.text}`,
          },
          ...context,
          {
            type: 'text',
            text: variant
              ? `What the variant should be, in the words of ${viewer.author.name}:\n${proposal.prompt}\n\nYour reply shows on the variant: when done, one short sentence in the language of these words (not the language of this message) saying how the variant differs from the slide – what you made, not what you checked.`
              : `The comment thread (the last message asks you):\n${proposal.prompt}`,
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
      });
    };

    const stock = (await photoSource(deps, target.deck.workspaceId)) !== null;
    const cutOut = cutOutSource(deps) !== null;
    const generate =
      (await workspaceImageConnection(deps, target.deck.workspaceId)).connection !== null;
    const remarks = new Remarks();
    /** It has written: it thinks less hard from now on. */
    let checking = false;
    /** The AI at work until it stops: its last words, or `null` when it refused. */
    const converse = async (
      turns: number,
    ): Promise<{ refused: boolean; summary: string | null }> => {
      await open();
      for (let turn = 0; turn < turns; turn += 1) {
        // Stopped through another instance of the API too: no further paid turn.
        if (await stopped(deps, proposal, signal)) return { refused: false, summary: null };
        report(deps, proposal, checking ? 'Prüft das Ergebnis' : 'Überlegt');
        const message = await runTurn(deps, connection, {
          system: systemPrompt(stock, cutOut, generate),
          tools: [
            ...TOOLS,
            ...(cutOut ? CUT_OUT_TOOLS : []),
            ...(stock ? STOCK_TOOLS : []),
            ...(generate ? GENERATE_TOOLS : []),
          ],
          messages,
          taskBudgetTokens: TASK_BUDGET_TOKENS,
          effort: EFFORT,
          clearToolResults: CLEAR_TOOL_RESULTS,
          fast: true,
          signal,
        });
        clock.turn(message.timing);
        if (message.stop === 'refusal') return { refused: true, summary: null };
        messages.push({ role: 'assistant', content: message.content });
        const calls = message.content.filter(
          (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use',
        );
        if (calls.length === 0) {
          clock.tools([], 0);
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
        const toolsAt = Date.now();
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        const answer = (call: Anthropic.Beta.BetaToolUseBlock) =>
          message.unreadable?.includes(call.id)
            ? Promise.resolve<Anthropic.Beta.BetaToolResultBlockParam>({
                type: 'tool_result',
                tool_use_id: call.id,
                is_error: true,
                content: UNREADABLE_CALL,
              })
            : runTool(deck, remarks, call);
        // Looking runs side by side; writing one after another, in the order asked.
        for (const group of callGroups(calls)) {
          if (signal.aborted) return { refused: false, summary: null };
          report(deps, proposal, stepOf(group));
          results.push(...(await Promise.all(group.map(answer))));
        }
        clock.tools(
          calls.map((call) => call.name),
          Date.now() - toolsAt,
        );
        if (!checking && calls.some((call) => WRITING_TOOLS.has(call.name))) {
          // From now on it checks and corrects – with less thought, so each turn is quicker. The
          // text makes this turn new input, which the change of effort waits for.
          checking = true;
          messages.push(
            {
              role: 'user',
              content: [
                ...results,
                {
                  type: 'text',
                  text: 'Check the drawing: correct what is off, else stop. Your reply then says what you changed, not what you checked.',
                },
              ],
            },
            effortMessage(CHECK_EFFORT),
          );
        } else messages.push({ role: 'user', content: results });
      }
      return { refused: false, summary: null };
    };
    /** Tells the AI something after its last turn – in the last user message if that is one. */
    const tell = async (content: Anthropic.Beta.BetaContentBlockParam[]) => {
      await open();
      const last = messages.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(...content);
      else messages.push({ role: 'user', content });
    };

    let summary: string | null = null;
    let talk = true;
    // The fast model is Anthropic's (Haiku); other services' models are no quicker than the AI.
    if (
      quick &&
      connection.provider === 'anthropic' &&
      pictures.length === 0 &&
      !place.text.includes('between') &&
      // It sees one slide: a thread about several (a reply to one included) is the AI's.
      !aboutSeveralSlides(proposal.prompt) &&
      // A variant asked for is a slide more – the AI's (add_variant).
      !asksForVariant(proposal.prompt)
    ) {
      summary = await quickly(deps, connection, deck, place, proposal, signal, clock);
      talk = summary === null;
    }
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
          asks: remarks.asks,
        });
        await postNotes(deps, proposal, remarks.notes);
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
            appliedEditId: written.editId,
            error: null,
            changes: written.changes,
            summary,
            asks: remarks.asks,
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
        await postNotes(deps, proposal, remarks.notes);
        return;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error instanceof MergeConflict && rebases < MAX_REBASES) {
          // Its part again on the deck as it is now: what fits goes in, the rest it does again.
          const rebased = await deck.rebase(viewer);
          deck = rebased.deck;
          deck.onDrawn = shown;
          talk = rebased.conflicts.length > 0;
          if (talk) await tell(await conflictNote(deck, rebased.conflicts));
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
    if (problem && refusesKey(error)) await markKeyRefused(deps, keyId, problem);
    else if (!isProviderError(error)) deps.log.warn(`AI proposal ${proposal.id} failed`, error);
    await settle(deps, proposal, {
      status: 'failed',
      error: problem ?? failureMessage(error, connection),
    });
  } finally {
    clock.done();
    progressOf.delete(proposal.id);
    await Promise.all(previews.map((key) => deps.storage.delete(key).catch(() => {})));
  }
}

/** Seconds, for the timing log. */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Where a run's time goes, in the log: a line per turn (the model's time – until its first token
 * and in all –, its tokens, the tools it called and their time) and one for the whole run.
 */
class RunClock {
  private readonly startedAt = Date.now();
  private preparedMs = 0;
  private turns = 0;
  private modelMs = 0;
  private toolMs = 0;
  private outputTokens = 0;
  private last: TurnTiming | undefined;

  constructor(
    private readonly deps: AppDeps,
    private readonly id: string,
  ) {}

  /** The fast model's try at a quick request. */
  quick(ms: number, outcome: string) {
    this.deps.log.info(`AI ${this.id.slice(0, 8)} quick request in ${seconds(ms)}: ${outcome}`);
  }

  /** The first look – brief, overview, the commented slide – is ready. */
  prepared() {
    this.preparedMs = Date.now() - this.startedAt;
  }

  turn(timing: TurnTiming | undefined) {
    this.turns += 1;
    this.last = timing;
    if (!timing) return;
    this.modelMs += timing.ms;
    this.outputTokens += timing.outputTokens;
  }

  tools(names: readonly string[], ms: number) {
    this.toolMs += ms;
    const timing = this.last;
    this.deps.log.info(
      `AI ${this.id.slice(0, 8)} turn ${this.turns}: model ${timing ? `${seconds(timing.ms)} (first token ${timing.firstTokenMs === null ? '?' : seconds(timing.firstTokenMs)}, ${timing.outputTokens} out, ${timing.inputTokens + timing.cacheReadTokens} in of which ${timing.cacheReadTokens} cached${timing.speed === 'fast' ? ', fast' : ''})` : '?'}, ${names.length > 0 ? `tools ${seconds(ms)}: ${names.join(', ')}` : 'done'}`,
    );
  }

  done() {
    const total = Date.now() - this.startedAt;
    this.deps.log.info(
      `AI ${this.id.slice(0, 8)} done in ${seconds(total)}: ${this.turns} turns, first look ${seconds(this.preparedMs)}, model ${seconds(this.modelMs)} (${this.outputTokens} tokens out), tools ${seconds(this.toolMs)}, rest ${seconds(Math.max(0, total - this.preparedMs - this.modelMs - this.toolMs))}`,
    );
  }
}

/**
 * The comments the AI left on its own, posted as open threads of its own at their places – on
 * slides still there (or that its change added). Each is a thread to take up like any other.
 */
async function postNotes(deps: AppDeps, proposal: ProposalRow, notes: readonly Note[]) {
  if (notes.length === 0) return;
  const keys = notes.map((note) => `${proposal.revisionId}:${note.pageId}`);
  // Slides it added: theirs now that the change is in.
  const pages = await deps.db
    .select({ id: slides.id, pageId: slides.pageId })
    .from(slides)
    .where(and(eq(slides.deckId, proposal.deckId), inArray(slides.pageId, keys)));
  const slideIdOf = (note: Note, i: number) =>
    note.slideId ?? pages.find((page) => page.pageId === keys[i])?.id;
  // The slides' elements as the change left them: a box keeps to the one it is about, so it
  // moves along when someone moves that element.
  const ids = notes.flatMap((note, i) => slideIdOf(note, i) ?? []);
  const versions =
    ids.length > 0
      ? await deps.db
          .select({ slideId: slideVersions.slideId, shapes: slideVersions.shapes })
          .from(slideVersions)
          .where(
            and(
              eq(slideVersions.revisionId, proposal.revisionId),
              inArray(slideVersions.slideId, ids),
            ),
          )
      : [];
  const shapesOf = new Map<string, Shape[]>(versions.map((row) => [row.slideId, row.shapes]));
  const now = deps.clock.now();
  const rows = notes.flatMap((note, i) => {
    const slideId = slideIdOf(note, i);
    if (!slideId) return [];
    // A sticker's box is its anchor, free on the slide – as a sticker people write.
    const anchor: Anchor = note.sticker
      ? { type: 'rect', rect: note.rect!, shapeRef: null }
      : note.rect
        ? {
            type: 'rect',
            rect: note.rect,
            shapeRef: rectShapeRefOver(shapesOf.get(slideId) ?? [], note.rect),
          }
        : { type: 'slide' };
    // One after another, so they list in the order the AI left them.
    const at = new Date(now.getTime() + i);
    return [
      {
        id: crypto.randomUUID(),
        deckId: proposal.deckId,
        slideId,
        parentId: null,
        author: AI_AUTHOR,
        body: note.text,
        anchor,
        strokes: note.sticker ? [note.sticker] : [],
        status: 'open' as const,
        source: 'app' as const,
        createdAt: at,
        updatedAt: at,
      },
    ];
  });
  if (rows.length === 0) return;
  try {
    await deps.db.insert(comments).values(rows);
    await touchDeck(deps.db, proposal.deckId, now);
    deps.live?.commentsChanged(proposal.deckId);
  } catch (error) {
    // The change went through all the same; only the remarks are lost.
    deps.log.warn(`AI proposal ${proposal.id}: comments not posted`, error);
  }
}

// ── Changed at once ──────────────────────────────────────────────────────

/** The operations of a change made at once do not fit the deck as it is now: the AI does it. */
export class QuickMisfit extends Error {}

/** Tries to write a change made at once – again on the deck as it is when someone was faster. */
const QUICK_TRIES = 2;

/**
 * A request said so plainly that the editor's own operations do it (speaking to the AI: „die
 * Box nach oben links“, see `voice/quick-edits`): applied at once as the proposal of the
 * comment `commentId` – shown in its thread, taken back and applied again like the AI's own
 * change –, without the AI at work. The operations name elements by id, so they find them where
 * they are now; written like the AI's change, merged with what others changed meanwhile.
 * Throws {@link QuickMisfit} when they do not fit (an element gone, someone changed the same
 * thing): then nothing is written and no proposal made.
 */
export async function applyQuickProposal(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: { commentId: string; operations: readonly SlideOperation[]; summary: string },
  { heard }: { heard?: ReadonlyMap<string, string> } = {},
): Promise<AiProposal> {
  const target = await editTarget(deps, viewer, deckId);
  const thread = await threadOf(deps, target.deck.id, input.commentId);
  const place = await commentPlace(deps, target, thread.root);
  const prompt = await threadPrompt(deps, thread, heard);
  let written: Written | null = null;
  for (let attempt = 1; !written; attempt += 1) {
    const current = attempt === 1 ? target : await editTarget(deps, viewer, deckId);
    const changes = await quickChanges(deps, current, input.operations);
    try {
      written = await writeChanges(deps, viewer, target.deck.id, changes, 'apply');
    } catch (error) {
      if (!(error instanceof MergeConflict)) throw error;
      if (attempt >= QUICK_TRIES) throw new QuickMisfit(error.message);
    }
  }
  const now = deps.clock.now();
  const [row] = await deps.db
    .insert(aiProposals)
    .values({
      id: crypto.randomUUID(),
      deckId: target.deck.id,
      revisionId: target.revision.id,
      slideId: place.slideId,
      commentId: thread.asking.id,
      prompt,
      status: 'applied',
      baseSeq: written.seq - 1,
      appliedSeq: written.seq,
      appliedEditId: written.editId,
      changes: written.changes,
      summary: input.summary,
      createdById: viewer.author.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  deps.live?.proposalsChanged(target.deck.id);
  return toDto(row as ProposalRow, now, viewer.author.name);
}

/**
 * The operations applied to a copy of the deck's file, as a change of the AI: the slides they
 * changed, before and after, with the styles they made.
 */
async function quickChanges(
  deps: AppDeps,
  target: EditTarget,
  operations: readonly SlideOperation[],
): Promise<AiSlideChange[]> {
  const bytes = await readFile(deps, target.revision.pptxKey);
  const [base, document] = await Promise.all([OdpDocument.open(bytes), OdpDocument.open(bytes)]);
  // Page ids as every other reading of this file gets them (`ensureIds` is the same each time).
  base.ensureIds();
  document.ensureIds();
  // Styles it makes are named its own, so they never meet another change's.
  document.idPrefix = `vq${crypto.randomUUID().slice(0, 8)}-`;
  const outcome = await withFileProblems(() => document.applyWhatFits(operations));
  if (outcome.dropped.length > 0 || outcome.applied.length === 0) {
    throw new QuickMisfit(outcome.reason ?? 'Die Änderung passt nicht mehr.');
  }
  const pages = base.pageIds();
  const changed = document
    .pageIds()
    .flatMap((pageId, index) =>
      pageId && pages[index] === pageId && base.slideXml(index) !== document.slideXml(index)
        ? [{ pageId, index }]
        : [],
    );
  if (changed.length === 0) throw new QuickMisfit('Die Änderung ändert nichts.');
  // The styles its slides name that the file did not have: they come along with the change.
  const named = [...new Set(changed.flatMap(({ index }) => document.styleNamesOf(index)))];
  const made = base.stylesXml(named).missing;
  const styles = made.length > 0 ? document.stylesXml(made).xml : [];
  return changed.map(({ pageId, index }) => ({
    pageId,
    index,
    before: base.slideXml(index),
    after: document.slideXml(index),
    beforeIndex: index,
    afterIndex: index,
    styles,
  }));
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

// ── Its card done, open again ────────────────────────────────────────────

/**
 * Its card done („Erledigt“, ✕) or open again – for everyone, as a thread is resolved
 * (`updateComment`): whoever may comment may do it; the others hear it on the live channel.
 */
export async function resolveProposal(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
  input: UpdateAiProposalInput,
): Promise<AiProposal> {
  await requireDeckAccess(deps, viewer, deckId, 'comment');
  const [current] = await deps.db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.id, proposalId), eq(aiProposals.deckId, deckId)));
  if (!current) throw notFound('Diesen Vorschlag gibt es nicht.');
  const now = deps.clock.now();
  const done = input.status === 'done';
  const row =
    done === (current.resolvedAt !== null)
      ? current
      : (
          await deps.db
            .update(aiProposals)
            .set(
              done
                ? { resolvedBy: viewer.author.id, resolvedAt: now, updatedAt: now }
                : { resolvedBy: null, resolvedAt: null, updatedAt: now },
            )
            .where(eq(aiProposals.id, current.id))
            .returning()
        )[0];
  if (!row) throw notFound('Diesen Vorschlag gibt es nicht.');
  if (row !== current) deps.live?.proposalsChanged(deckId);
  const [creator] = row.createdById
    ? await deps.db.select({ name: users.name }).from(users).where(eq(users.id, row.createdById))
    : [];
  return toDto(row, now, creator?.name ?? null);
}

// ── Taking back, applying again ──────────────────────────────────────────

const CHANGED_SINCE =
  'Die Folie wurde seitdem weiter bearbeitet – das geht nur noch mit „Rückgängig“ im Bearbeiten-Panel.';

const PICTURE_GONE =
  'Ein Bild aus dem Kommentar, das die Änderung zeigt, gibt es nicht mehr – bitte die KI nochmal fragen.';
const TEMPLATE_GONE =
  'Die Vorlage, aus der die KI ein Layout genommen hat, gibt es nicht mehr – bitte die KI nochmal fragen.';

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

/**
 * Takes the workspace templates' layouts the AI took into its copy into `document` – before the
 * slides that name them – and returns the names they got here where those differ.
 */
async function takeLayouts(
  deps: AppDeps,
  deckId: string,
  document: OdpDocument,
  layouts: readonly AiTakenLayout[],
): Promise<Map<string, string>> {
  const renames = new Map<string, string>();
  if (layouts.length === 0) return renames;
  const [deck] = await deps.db
    .select({ workspaceId: decks.workspaceId })
    .from(decks)
    .where(eq(decks.id, deckId));
  const rows = deck
    ? await deps.db
        .select({ id: workspaceMasters.id, fileKey: workspaceMasters.fileKey })
        .from(workspaceMasters)
        .where(
          and(
            eq(workspaceMasters.workspaceId, deck.workspaceId),
            eq(workspaceMasters.format, 'odp'),
            inArray(workspaceMasters.id, [...new Set(layouts.map((layout) => layout.template))]),
          ),
        )
    : [];
  const designs = new Map<string, OdpDesign>();
  for (const row of rows) {
    const bytes = await deps.storage.get(row.fileKey);
    if (bytes) designs.set(row.id, await (await OdpDocument.open(bytes)).design());
  }
  for (const layout of layouts) {
    const design = designs.get(layout.template);
    if (!design) throw badRequest(TEMPLATE_GONE);
    const name = document.takeMasterPageFrom(design, layout.master);
    if (name !== layout.as) renames.set(layout.as, name);
  }
  return renames;
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
  const masters =
    direction === 'apply'
      ? await takeLayouts(deps, deckId, document, changes[0]?.layouts ?? [])
      : new Map<string, string>();
  const changed = changes
    .map((change) =>
      renames.size === 0
        ? change
        : {
            ...change,
            after: change.after === null ? null : renameStyles(change.after, renames),
            styles: change.styles.map((xml) => renameStyles(xml, renames, { own: true })),
          },
    )
    .map((change) => {
      let after = change.after;
      for (const [as, name] of masters) {
        after =
          after?.split(`draw:master-page-name="${as}"`).join(`draw:master-page-name="${name}"`) ??
          null;
      }
      return after === change.after ? change : { ...change, after };
    });

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

/** A change as {@link writeChanges} put it in: its step, that step's row, the slides as written. */
interface Written {
  seq: number;
  editId: string | null;
  changes: AiSlideChange[];
}

/**
 * Whether `step` is the one that applied the proposal – its row, kept since. A proposal applied
 * before rows were kept: a step of the AI at its place, made before the proposal last changed (a
 * step made in its place after an undo is newer than that undo).
 */
function isOwnStep(proposal: ProposalRow, step: DeckEditRow): boolean {
  if (proposal.appliedEditId !== null) return step.id === proposal.appliedEditId;
  return (
    step.source === 'ai' &&
    step.seq === proposal.appliedSeq &&
    step.createdAt.getTime() <= proposal.updatedAt.getTime()
  );
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
): Promise<Written> {
  if (changes.length === 0) throw badRequest(CHANGED_SINCE);
  let written: AiSlideChange[] = [...changes];
  const { seq, editId } = await editFile(
    deps,
    viewer,
    deckId,
    { source: 'ai', operations: [] },
    async (current) => {
      const document = await openFile(current);
      // The page ids the AI saw (the same file gets the same ids).
      document.ensureIds();
      const outcome = await withFileProblems(() =>
        applyChanges(deps, deckId, document, changes, direction),
      );
      if (outcome.conflicts.length > 0) throw new MergeConflict(outcome.conflicts, changedSince);
      written = outcome.changes;
      return { bytes: await document.toBytes(), document };
    },
  );
  return { seq, editId, changes: written };
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
    await moveAiStep(deps, viewer, deckId, -1, (top) => isOwnStep(proposal, top));
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
  written: Written,
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
      appliedEditId: written.editId,
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
  // Its status read under the proposal's lock: taken back twice at once, it goes back once.
  await withProposalLock(proposalId, async () => {
    const proposal = await proposalOf(deps, target, proposalId);
    if (proposal.status !== 'applied') throw badRequest('Diese Änderung ist nicht angewendet.');
    // Where the thread goes back to is known only while its slide is there; it moves once the
    // change is taken back – not when that fails.
    const moveBack = await planThreadMove(deps, proposal, proposal.changes, 'revert');
    await takeBack(deps, viewer, deckId, proposal);
    await moveBack?.();
    await finish(deps, proposal, { status: 'reverted' });
  });
  return getEditState(deps, viewer, deckId);
}

/**
 * Applies a taken-back change again: redo while its step is next – checked under the deck's
 * lock, so never someone else's step –, else as a new step.
 */
export async function reapplyProposal(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
) {
  const target = await editTarget(deps, viewer, deckId);
  // Its status read under the proposal's lock: applied twice at once, it goes in once.
  await withProposalLock(proposalId, async () => {
    const proposal = await proposalOf(deps, target, proposalId);
    if (proposal.status !== 'reverted') throw badRequest('Diese Änderung ist schon angewendet.');
    try {
      // Its own step, not another one undone at its place since (see `isOwnStep`).
      await moveAiStep(deps, viewer, deckId, 1, (next) => isOwnStep(proposal, next));
      await finish(deps, proposal, { status: 'applied' });
      await moveThread(deps, proposal, proposal.changes, 'apply');
    } catch (error) {
      if (!(error instanceof NotThatStep)) throw error;
      const written = await writeChanges(deps, viewer, deckId, proposal.changes, 'apply');
      await finish(deps, proposal, {
        status: 'applied',
        appliedSeq: written.seq,
        appliedEditId: written.editId,
        changes: written.changes,
      });
      await moveThread(deps, proposal, written.changes, 'apply');
    }
  });
  return getEditState(deps, viewer, deckId);
}

// ── Another of its photos ────────────────────────────────────────────────

/**
 * Puts another of the AI's photos in place of the one in the slide – cut to the same frame, with
 * its credit – as a step of its own. The change holds that photo from then on, so taking it back
 * and applying it again keep working. Unsplash hears of it when the thread is done or the file
 * leaves Slider (see `stock-photos`), at once if the thread is done already.
 */
export function choosePhoto(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
  photoId: string,
) {
  // One at a time per proposal, like taking it back or applying it again: the proposal read here
  // is the one written back at the end.
  return withProposalLock(proposalId, () =>
    choosePhotoNow(deps, viewer, deckId, proposalId, photoId),
  );
}

async function choosePhotoNow(
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
  const current = await openFile(await readFile(deps, target.revision.pptxKey));
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
  if (reported) await trackPhoto(deps, target.deck.workspaceId, photo);
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
