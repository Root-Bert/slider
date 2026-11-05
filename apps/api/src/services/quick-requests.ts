import type Anthropic from '@anthropic-ai/sdk';
import type { EditableSlide } from '@slider/shared';
import type { AppDeps } from '../deps';
import type { DeckDesign } from './ai-context';
import { runToolCall, type AiConnection } from './ai-providers';
import { readQuickEdits, type ContentArea, type QuickEdit } from './voice/quick-edits';
import { designLines, EDIT_ITEM_SCHEMA, elementLine } from './voice/router';

/*
 * A request asked in a comment (⌘↵) that is nothing but plain changes the editor makes itself –
 * „Titel fett“, „die Box nach rechts“, „Hintergrund der Form blau“ – is made in a second or two
 * instead of half a minute: the fast model says the changes, the server works out places and
 * applies them as the AI's change. Anything else, or changes that do not fit, go to the AI that
 * designs the slides, as before.
 */

/** Elements of the slide shown to the fast model at most. */
const MAX_ELEMENTS = 40;
/** What the fast model may write. */
const MAX_TOKENS = 4_000;
/** The fast model is asked once; past this the AI that designs does the request. */
const TIMEOUT_MS = 12_000;

export const QUICK_SYSTEM = `People review a presentation in Slider and ask in comments for changes to a slide. An AI that designs slides works on each request – thoroughly, but it takes half a minute. You come first: when the request is nothing but plain changes of listed elements that the editor itself can make, you give them as edits and they are applied at once.

Plain changes: moving or resizing („nach oben links“, „größer“, „unter den Titel“, „links bündig mit dem Titel“), fill or border colour, text size, font, colour, bold, italic, underline, alignment, the text replaced by exact words the person gives, to the front or back, deleting, grouping, ungrouping, locking, shadow, glow, soft edge, frosted glass, rounded corners, turning, mirroring – plain new elements the request names: shapes („zwei Kreise hier“, „ein Rechteck unter den Titel“), a text box with exact words, a line or arrow between two elements („Pfeil vom Bild zum Text“) – and plain changes of slides: a new slide (a layout from the list, or a copy) with exactly the title and points given, a slide duplicated, moved, hidden, shown, deleted, its background one colour or as in the master, its transition, its speaker notes with exact words.

Everything else gets no edits – call \`edit\` with an empty list and the designing AI does it: new content you would have to make up (text, a list, a slide about a topic), wording the person did not give word for word (shorter, better, translated, a title as a statement), pictures, charts, tables, gradients, layout or design work („schöner“, „aufräumen“, „passt das?“, a background „that fits“), changes on several slides alike, questions. Edits do the whole request or nothing: when one part of it cannot be said as edits, give none – every sentence of the last message must be done by your edits. The whole thread counts: a reply goes on with the request before it, so when that one is about several slides or new content, the reply is too. When unsure, give none – a wrong change is worse than waiting.

Writing edits: each names one \`element\` (its id from the list) and only what changes. \`place\`: a place on the slide in words – top_left, top, top_right, left, center, right, bottom_left, bottom, bottom_right; worked out for you inside the margins, clear of the others. \`align_with\` lines it up with other elements by an edge or the middle; \`size_like\` makes it as wide and/or high as another – both worked out for you. \`box\`: only for an exact place or size the request gives (% of the slide). „Größer“/„kleiner“ for text is \`font_scale\` (1.25 / 0.8 unless said), for a box its \`box\`. Colours as #rrggbb – the template's colours when the request names one of them. The comment names the element it is about („on element …“); „das“, „hier“ mean that one. \`add\` makes a new element instead of \`element\` – text, rectangle, ellipse (a circle: w and h the same size in cm, so h = w × the slide's width / height), isosceles-triangle, diamond, hexagon, right-arrow, star5, line, arrow – with \`box\` („hier“: around the point or area the comment marks, clear of other elements; several side by side with equal gaps), \`place\` or \`next_to\` another element (then a \`box\` gives only the size), and border, text as for any element; a line or arrow goes \`from\` one element \`to\` another. Give it a \`name\` when a later edit refers to it. Make new shapes look designed: always a \`fill\` – one of the template's colours, else a colour the slide already uses, else a calm blue like #2563eb (no white, grey or bare outline unless asked); several alike the same size (\`size_like\` the first) with equal gaps, lined up; a sensible size (a circle about 2–4 cm); inside the content area, never at the slide's edge. \`group\`: the ids instead of \`element\`. A slide's change names \`slide\` (its number) instead of \`element\` – \`background\`, \`transition\`, \`notes\`, \`hidden\`, \`move_after\` (0: first), \`duplicate\`, \`delete\` – a background turned dark gets light text: \`text_color\` with it (dark text on a light one); a new slide is \`new_slide\` {after, layout or copy_of} with \`title\` and \`text\` (one string per point) exactly as said („mit Titel Agenda und den Punkten A, B, C“); a slide about a topic („eine Folie zu unseren Zielen“) needs content made up: no edits.`;

const QUICK_TOOL: Anthropic.Beta.BetaTool & { input_schema: Anthropic.Beta.BetaTool.InputSchema } =
  {
    name: 'edit',
    description:
      'The plain changes the request asks for, applied at once – an empty list when it asks for anything more.',
    input_schema: {
      type: 'object',
      properties: {
        // No maxItems: with it the fast model answered every request to add an element with an
        // empty list (measured 4 of 4; without it 4 of 4 right) – `readQuickEdits` caps them.
        edits: { type: 'array', items: EDIT_ITEM_SCHEMA },
      },
      required: ['edits'],
    },
  };

/**
 * „auf allen Folien“, „jede Slide“, „überall“, „Folien 2 und 3“: a thread about several slides –
 * the fast model sees one, so it is not asked (it once made a reply's colour change and left the
 * rest of an all-slides request undone).
 */
const SEVERAL_SLIDES = new RegExp(
  String.raw`(?<!\p{L})(?:(?:alle[nms]?|all|jede[nmrs]?|sämtliche[nmr]?|beide[nm]?|every|each)\s+(?:[\p{L}-]+\s+){0,2}(?:folien?|slides?|seiten)|(?:folien|slides)\s+\d|überall|everywhere)(?!\p{L})`,
  'iu',
);

/** The thread is about several slides: the AI that designs does it, not the fast model. */
export const aboutSeveralSlides = (thread: string): boolean => SEVERAL_SLIDES.test(thread);

/** The content area inside the margins the design sets, as shares of the slide – or none. */
export function marginsOf(
  design: DeckDesign,
  page: { width: number; height: number },
): ContentArea | null {
  const grid = design.grid;
  if (!grid) return null;
  return {
    left: grid.columns.margin / page.width,
    top: grid.rows.margin / page.height,
    right: 1 - grid.columns.margin / page.width,
    bottom: 1 - grid.rows.margin / page.height,
  };
}

/** Slide titles named to the fast model at most. */
const MAX_TITLES = 100;

/** What the fast model reads: the deck's slides, the slide's page and design, its elements, the thread. */
export function quickPrompt(input: {
  slide: EditableSlide;
  number: number;
  page: { width: number; height: number };
  design: DeckDesign;
  thread: string;
  /** The deck's slides, in order. */
  slides?: readonly { title: string; hidden: boolean }[];
  /** The layouts a new slide can take, a line each. */
  layouts?: readonly string[];
}): string {
  const area = marginsOf(input.design, input.page);
  const lines = designLines({
    slides: new Map(),
    page: input.page,
    margins: area
      ? {
          left: area.left * 100,
          right: (1 - area.right) * 100,
          top: area.top * 100,
          bottom: (1 - area.bottom) * 100,
        }
      : null,
    guides: input.design.guides.map((guide) => ({
      orientation: guide.orientation,
      position: guide.position * 100,
    })),
    palette: input.design.palette,
    layouts: input.layouts,
  });
  const elements = input.slide.elements.slice(0, MAX_ELEMENTS).map(elementLine);
  const slides = input.slides ?? [];
  return [
    ...(slides.length > 0
      ? [
          `The presentation's slides (${slides.length}):`,
          ...slides
            .slice(0, MAX_TITLES)
            .map(
              (slide, index) =>
                `${index + 1}: ${slide.title.replace(/\s+/g, ' ').slice(0, 80) || '(no title)'}${slide.hidden ? ' (hidden)' : ''}`,
            ),
          ...(slides.length > MAX_TITLES ? ['…'] : []),
          '',
        ]
      : []),
    ...lines,
    '',
    `Slide ${input.number}, its elements (id „name“ (kind): text; box x, y, w, h in % of the slide; looks):`,
    ...elements.map((line) => `- ${line}`),
    '',
    'The comment thread (its last message asks):',
    input.thread,
  ].join('\n');
}

/** The plain edits the request is – `null` when it is more than that (or the model says so). */
export async function quickEdits(
  deps: Pick<AppDeps, 'config' | 'aiFetch' | 'anthropic'>,
  connection: AiConnection,
  prompt: string,
  signal: AbortSignal,
): Promise<QuickEdit[] | null> {
  const input = await runToolCall(deps, connection, {
    system: QUICK_SYSTEM,
    tool: QUICK_TOOL,
    user: prompt,
    maxTokens: MAX_TOKENS,
    signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    feature: 'edit',
  });
  const edits =
    input && typeof input === 'object' && 'edits' in input
      ? (input as { edits: unknown }).edits
      : null;
  return Array.isArray(edits) && edits.length > 0 ? readQuickEdits(edits) : null;
}
