import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { EditableElement, EditableSlide, Slide, VoiceContext } from '@slider/shared';
import { MAX_QUICK_EDITS, NEW_KINDS, NEXT_TO_SIDES, PLACES } from './quick-edits';

/*
 * What a piece of speech is: a fast model reads it with what was on screen while it was said
 * and the comments said so far, and answers with actions – a new comment at a place, more of the
 * one being said, finished, an addition to one already sent, taken back, or a command.
 */

/** Elements of a slide in front named to the model at most, and how much of each one's text. */
const MAX_ELEMENTS = 30;
const MAX_ELEMENT_TEXT = 90;
/** Slide titles listed at most (the rest is „…“). */
const MAX_TITLES = 150;
/** Comments of the session named at most (the newest), and earlier pieces given as context. */
const MAX_ITEMS = 12;
const MAX_HISTORY = 6;
/** Actions of one answer at most. */
export const MAX_ACTIONS = 8;
/** What a comment may say at most. */
export const MAX_COMMENT_CHARS = 4_000;

export const ROUTER_SYSTEM = `You listen along while a person goes through a presentation in Slider – a tool where teams review and improve presentations – and speaks their thoughts out loud. Their speech reaches you in pieces, cut at their pauses and turned into text by speech recognition: expect recognition errors, filler words, false starts and sentences cut in the middle. For every new piece you decide what it is and call \`act\` once with the actions it calls for – none when the piece says nothing about the presentation (small talk, thinking aloud without content, „ähm“, noise, a recognition artefact).

The person's remarks become comments on the slides; an AI that edits the slides works on each finished comment right away, while the person goes on speaking. One comment is one thing to change, ask or note, at one place: two changes at two places are two comments; several changes of the same element said in one go are one comment. Questions and remarks without a change are comments too – the AI answers them in the thread.

Actions:
- new: a remark about something no comment of this session covers yet. \`slide\`: the slide it is about – usually the one in front while it was said, unless the person names another („auf Folie 5 …“). \`elements\`: the elements it is about, by their ids from the list, when it is about some – what the person says („der Titel“, „das Bild“, „hier“, „das da“) together with where the pointer rested and what is picked tells you which. Several when the person means several („die Shapes“, „die drei Kreise“, „Bild und Text“) – all of them, so the comment marks them together. Without elements the comment is about the slide as a whole. \`gap_after\`: instead of slide and element, when the person says a slide is missing between two slides – the number of the slide after which it is missing (0: before the first). \`text\`: the comment.
- continue: the piece goes on with a comment still being said – \`item\` and its complete new \`text\` (what it said so far and what is new, merged into one comment).
- finish: a comment being said is complete – \`item\`. A comment is complete when the person moved on (another element, another slide, another topic) or clearly ended the thought. Finish it as soon as it stands on its own – don't wait for more: the AI can start sooner. A request complete in one piece („mach die Box nach oben links“, „den Titel fett“, „die Aufzählung kleiner und die Box gleich hoch“) is a new comment with \`finished\`: true in the same step – a complete sentence is finished. When a piece is clearly cut off mid-thought, keep the comment open instead.
- new, continue and add_to take \`finished\`: true finishes the comment in the same step.
- edits: new, continue and add_to (with \`finished\`: true) also take \`edits\` when the comment asks only for plain changes of listed elements that the editor itself can make – moving or resizing („nach oben links“, „größer“, „unter den Titel“, „links bündig mit dem Titel“), fill or border colour, text size, font, colour, bold, italic, underline, alignment, the text replaced by words the person dictates, to the front or back, deleting – and adding plain new elements the person names: shapes („zwei Kreise hier“, „ein Rechteck unter den Titel“), a text box with dictated words, a line or an arrow between two elements („ein Pfeil vom Bild zum Text“). Edits are applied at once – the person sees the change within a second instead of waiting for the AI that edits the slides –, so give them whenever the request is that plain. Edits do the whole request or nothing: when one part of it cannot be said as edits, give none – the AI does all of it. Everything else gets no edits, the AI does it: new content you would have to make up (text, a list, a new slide), wording the person did not dictate (shorter, better, translated), pictures, charts, tables, layout and design judgement („schöner“, „aufräumen“, „passend“, „mehr Luft“), arranging several elements in a way you cannot work out exactly, anything unclear. When unsure, no edits. A follow-up correction („nee, weiter rechts“, „noch größer“) to a change made so is an add_to with edits, worked out from the element as it is now (the list shows it changed).
- add_to: the person adds to a comment that is finished already – about the same thing or place („und beim Titel noch …“, „ach, und die Farbe auch“) – \`item\` and the addition as \`text\`. It becomes a reply in that comment's thread, and the AI takes it up with the comment. A new thing at another place is a new comment, not an addition.
- drop: the person takes a comment back („nee, vergiss das“, „streich das wieder“) – \`item\`.
- undo: the person wants the AI's change of a comment taken back („mach das rückgängig“) – \`item\`.
- go_to_slide: the person asks to go to a slide („nächste Folie“, „zurück“, „geh zu Folie fünf“) – \`slide\`. Only for such requests: going through the slides by hand is not one.
- stop_session: the person ends speaking to you („Stopp, ich bin fertig“, „das war's“).

Writing edits: each names one \`element\` (its id) and only what changes. \`place\`: for a place on the slide in words – „nach oben links“, „nach rechts“, „in die Mitte“, „unten rechts in die Ecke“: top_left, top, top_right, left, center, right, bottom_left, bottom, bottom_right. It is worked out for you: the corner or edge of the content area inside the slide's margins, clear of the other elements (below the title when it sits there). With \`place\` or \`next_to\`, \`box\` only when the size changes too (its x and y are then ignored). \`align_with\`: lined up with other elements – „rechtsbündig mit dem Titel“ (right), „links bündig mit dem Text“ (left), „mittig unter dem Bild“ (center_x), „auf einer Höhe mit der Box“ (top), „oben bündig“ (top); \`size_like\`: „so hoch wie die Aufzählung“ (height), „gleich groß wie das Bild“ (width and height) – both worked out for you, with \`place\` or \`box\` or alone. \`box\`: the element's new place and size in % of the slide – x and y of its top left corner from the slide's top left, w and h – for any other place or size („unter den Titel“, „neben das Bild“, „doppelt so breit“); keep w and h when it only moves, keep it on the slide, line it up with what is there (the same left edge as the title, the same top as its neighbour, the same gap) and never put it over other elements. Colours as #rrggbb – the template's colours first, the nearest fitting one for „blau“, „rot“; \`none\` takes the fill or border away. Keep text readable: a fill turned dark gets light text (\`text_color\`, e.g. white or the template's light colour), one turned light gets dark text. \`font_size\` in pt sets all its text; for text of mixed sizes use \`font_scale\` instead („größer“ about 1.3, „deutlich größer“ about 1.6, „kleiner“ about 0.8). \`text\`: its text anew, one string per paragraph, exactly as dictated. \`order\`: front or back. \`delete\`: true. \`add\`: a new element instead of \`element\` – text, rectangle, ellipse (a circle: w and h the same size in cm, so h = w × the slide's width / height), isosceles-triangle, diamond, hexagon, right-arrow, star5, line, arrow – with \`box\` („hier“: around where the pointer rested, clear of other elements; several side by side with equal gaps), \`place\` or \`next_to\` another element, and the rest as for any element (border, text). A line or arrow goes \`from\` one element \`to\` another. Give it a \`name\` when a later edit refers to it. Make new shapes look designed: always a \`fill\` – one of the template's colours, else a colour the slide already uses, else a calm blue like #2563eb (no white, grey or bare outline unless asked); several alike the same size (\`size_like\` the first) with equal gaps, lined up; a sensible size (a circle about 2–4 cm); inside the content area, never at the slide's edge. The comment's text is written as always – it stays as the record of the request.

Writing a comment's text: in the language the person speaks, as their remark or request to the AI that edits the slides – clear and complete, without filler words, false starts or recognition errors, keeping everything they meant (what, where, how, why). Speech recognition mishears words that sound alike: where a word makes no sense in its place, write the similar-sounding word that does (e.g. „größer und fit“ → „größer und fett“) – never a different meaning. People mix in English design words (alignen, Shapes, Slide, centern, Font, Spacing, Layout) – recognition often turns them into German look-alikes: „horizontal Leine“ → „horizontal alignen“ (ausrichten), „zentern“ → „zentrieren“; the elements and what is asked of them tell you which makes sense. Name what „hier“, „das“, „dieses“ point at (e.g. „Den Titel „Agenda“ größer …“). Add nothing they did not say. Keep their voice: a request stays a request, a question a question.`;

/** One plain change of an element the editor makes itself – for the router and quick requests. */
export const EDIT_ITEM_SCHEMA: Anthropic.Beta.BetaTool.InputSchema = {
  type: 'object',
  properties: {
    element: {
      type: 'string',
      description: 'An element id from the list (or the name of one added before).',
    },
    add: {
      type: 'string',
      enum: [...NEW_KINDS],
      description:
        'A new element instead – text box, shape (ellipse: a circle), line or arrow – with the rest of this edit (box or place or next_to, fill, border, text…).',
    },
    name: { type: 'string', description: 'A new one’s name, for later edits to refer to it.' },
    next_to: {
      type: 'object',
      description: 'A new one beside another element (a gap between, lined up).',
      properties: {
        element: { type: 'string' },
        side: { type: 'string', enum: [...NEXT_TO_SIDES] },
      },
      required: ['element', 'side'],
    },
    from: {
      type: 'object',
      description: 'A new line or arrow from this element…',
      properties: { element: { type: 'string' } },
      required: ['element'],
    },
    to: {
      type: 'object',
      description: '…to this one (their facing edges).',
      properties: { element: { type: 'string' } },
      required: ['element'],
    },
    place: {
      type: 'string',
      enum: [...PLACES],
      description:
        'Where in the content area it goes („oben links“: top_left, „in die Mitte“: center) – worked out for you, clear of the others.',
    },
    align_with: {
      type: 'array',
      maxItems: 2,
      description:
        'Lined up with another element by an edge or the middle („rechtsbündig mit dem Titel“: right) – worked out for you.',
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
      description: 'As wide and/or as high as another element – worked out for you.',
      properties: {
        element: { type: 'string' },
        width: { type: 'boolean' },
        height: { type: 'boolean' },
      },
      required: ['element'],
    },
    box: {
      type: 'object',
      description: 'New place and size, % of the slide (top left corner, width, height).',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' },
      },
      required: ['x', 'y', 'w', 'h'],
    },
    fill: { type: 'string', description: '#rrggbb, or "none".' },
    border: {
      description: '{color: "#rrggbb", width: pt}, or "none".',
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
      description: 'Its text anew, one string per paragraph.',
    },
    font_size: { type: 'number', description: 'pt, all of its text.' },
    font_scale: { type: 'number', description: 'Every text size times this.' },
    font: { type: 'string', description: 'By its free name: Carlito, not Calibri.' },
    text_color: { type: 'string', description: '#rrggbb' },
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    underline: { type: 'boolean' },
    align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
    order: { type: 'string', enum: ['front', 'back'] },
    delete: { type: 'boolean' },
  },
};

/** The one tool the model calls. */
export const ROUTER_TOOL: Anthropic.Beta.BetaTool & {
  input_schema: Anthropic.Beta.BetaTool.InputSchema;
} = {
  name: 'act',
  description:
    'What the new piece of speech calls for: a list of actions, in the order they happen (empty when it calls for none).',
  input_schema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        maxItems: MAX_ACTIONS,
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: [
                'new',
                'continue',
                'finish',
                'add_to',
                'drop',
                'undo',
                'go_to_slide',
                'stop_session',
              ],
            },
            item: { type: 'string', description: 'A comment of this session, e.g. "K2".' },
            slide: { type: 'integer', minimum: 1, description: 'A slide number.' },
            elements: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 50,
              description: 'Element ids from the list – all the comment is about.',
            },
            gap_after: {
              type: 'integer',
              minimum: 0,
              description: 'A slide is missing after this slide number (0: before the first).',
            },
            text: { type: 'string', maxLength: MAX_COMMENT_CHARS },
            finished: { type: 'boolean' },
            edits: {
              type: 'array',
              maxItems: MAX_QUICK_EDITS,
              description:
                'Plain changes of listed elements, applied at once (with finished: true) – only when the request is nothing but these.',
              items: EDIT_ITEM_SCHEMA,
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['actions'],
  },
};

const actionSchema = z.object({
  type: z.enum([
    'new',
    'continue',
    'finish',
    'add_to',
    'drop',
    'undo',
    'go_to_slide',
    'stop_session',
  ]),
  item: z.string().max(20).nullish(),
  slide: z.number().int().positive().nullish(),
  elements: z.array(z.string().max(200)).max(50).nullish(),
  /** One element – older answers. */
  element: z.string().max(200).nullish(),
  gap_after: z.number().int().nonnegative().nullish(),
  text: z.string().nullish(),
  finished: z.boolean().nullish(),
  /** Read by `readQuickEdits`: a broken one sends the comment to the AI, not the action away. */
  edits: z.unknown().nullish(),
});
export type RouterAction = z.infer<typeof actionSchema>;

/**
 * The actions as given – also as the fast model now and then wraps them: the list as a JSON
 * string, or in another `{ actions }` inside it.
 */
function actionList(input: unknown, depth = 0): unknown[] {
  if (depth > 3) return [];
  if (typeof input === 'string') {
    // Now and then with a bracket too many at its end: cut off until it reads.
    for (let end = input.length; end > 0 && end >= input.length - 4; end -= 1) {
      try {
        return actionList(JSON.parse(input.slice(0, end)) as unknown, depth + 1);
      } catch {
        // One character less.
      }
    }
    return [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((entry: unknown) =>
      entry && typeof entry === 'object' && !('type' in entry) && 'actions' in entry
        ? actionList(entry, depth + 1)
        : [entry],
    );
  }
  if (input && typeof input === 'object' && 'actions' in input) {
    return actionList((input as { actions: unknown }).actions, depth + 1);
  }
  return [];
}

/** The model's actions, those that can be read – a broken one is left out, not the others. */
export function readActions(input: unknown): RouterAction[] {
  return actionList(input)
    .slice(0, MAX_ACTIONS)
    .flatMap((raw) => {
      const action = actionSchema.safeParse(raw);
      if (!action.success) return [];
      const text = action.data.text?.trim().slice(0, MAX_COMMENT_CHARS);
      return [{ ...action.data, text: text || null }];
    });
}

/** A comment of the session as the model sees it. */
export interface RouterItem {
  /** `K1`, `K2`, … */
  label: string;
  slideNumber: number | null;
  /** Where on the slide, in words. */
  place: string;
  text: string;
  /** In words: being said, waiting for the AI, applied, … */
  status: string;
}

export interface RouterPiece {
  slideNumber: number | null;
  text: string;
}

export interface RouterInput {
  deckTitle: string;
  slides: readonly Slide[];
  context: VoiceContext;
  items: readonly RouterItem[];
  history: readonly RouterPiece[];
  text: string;
  /** How long the piece took, ms. */
  durationMs: number;
  /**
   * What edits need, when the AI may change the deck: the slides in front as the editor knows
   * them (by Slider's slide id) – boxes, text looks, fill and border –, the page and its design.
   */
  editing?: RouterEditing | null;
}

export interface RouterEditing {
  slides: ReadonlyMap<string, EditableSlide>;
  /** The page, cm. */
  page: { width: number; height: number };
  /** The content area's margins, % of the page – `null`: none set. */
  margins: { left: number; right: number; top: number; bottom: number } | null;
  /** Guides, % of the page. */
  guides: readonly { orientation: 'horizontal' | 'vertical'; position: number }[];
  /** The template's colours. */
  palette: readonly { color: string; name: string }[];
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The user message: the deck, what was on screen, the comments so far, the new piece. */
export function routerPrompt(input: RouterInput): string {
  const { slides, context } = input;
  const numberOf = new Map(slides.map((slide, index) => [slide.id, index + 1]));
  const lines: string[] = [];
  lines.push(`Presentation „${clip(input.deckTitle, 200)}“, ${slides.length} slides:`);
  for (const [index, slide] of slides.slice(0, MAX_TITLES).entries()) {
    lines.push(
      `${index + 1}: ${clip(slide.title ?? '(no title)', 100)}${slide.hidden ? ' (hidden)' : ''}`,
    );
  }
  if (slides.length > MAX_TITLES) lines.push('…');

  lines.push('', `While the new piece was said (${seconds(input.durationMs)}):`);
  const inFront = context.slides.filter((entry) => numberOf.has(entry.slideId));
  if (inFront.length === 0) lines.push('No slide was in front.');
  const editing = input.editing ?? null;
  if (editing && inFront.some((entry) => editing.slides.has(entry.slideId))) {
    lines.push(...designLines(editing));
  }
  for (const entry of inFront) {
    const slide = slides.find((candidate) => candidate.id === entry.slideId)!;
    const editable = editing?.slides.get(slide.id);
    if (editable) {
      lines.push(
        `Slide ${numberOf.get(slide.id)} was in front for ${seconds(entry.ms)}. Its elements, bottom to top (box: x, y of the top left corner, w, h – % of the slide):`,
      );
      const elements = editable.elements.slice(-MAX_ELEMENTS);
      if (elements.length === 0) lines.push('  (none)');
      if (editable.elements.length > MAX_ELEMENTS) lines.push('  …');
      for (const element of elements) lines.push(`  - ${elementLine(element)}`);
      continue;
    }
    lines.push(
      `Slide ${numberOf.get(slide.id)} was in front for ${seconds(entry.ms)}. Its elements:`,
    );
    const shapes = slide.shapes.slice(0, MAX_ELEMENTS);
    if (shapes.length === 0) lines.push('  (none known)');
    for (const shape of shapes) {
      const { x, y, w, h } = shape.bbox;
      const text = shape.text.trim() ? `"${clip(shape.text, MAX_ELEMENT_TEXT)}"` : '(no text)';
      lines.push(
        `  - ${shape.id} „${clip(shape.name, 40)}“: ${text} – x ${pct(x)}–${pct(x + w)}, y ${pct(y)}–${pct(y + h)}`,
      );
    }
    if (slide.shapes.length > MAX_ELEMENTS) lines.push('  …');
  }
  const pointer = context.pointer.filter((entry) => numberOf.has(entry.slideId));
  for (const entry of pointer) {
    const where = entry.shapeId ? `element ${entry.shapeId}` : 'the slide’s background';
    lines.push(
      `The pointer rested ${seconds(entry.ms)} on ${where} of slide ${numberOf.get(entry.slideId)}, at x ${pct(entry.point.x)}, y ${pct(entry.point.y)}.`,
    );
  }
  if (pointer.length === 0) lines.push('The pointer was not on a slide.');
  if (context.selection && numberOf.has(context.selection.slideId)) {
    lines.push(
      `Picked in the editor: element ${context.selection.elementId} of slide ${numberOf.get(context.selection.slideId)}.`,
    );
  }

  lines.push('', 'Comments said in this session so far (oldest first):');
  const items = input.items.slice(-MAX_ITEMS);
  if (items.length === 0) lines.push('None yet.');
  for (const item of items) {
    const slide = item.slideNumber === null ? '' : `slide ${item.slideNumber}, `;
    lines.push(`${item.label} [${slide}${item.place}; ${item.status}]: "${clip(item.text, 600)}"`);
  }

  const history = input.history.slice(-MAX_HISTORY);
  if (history.length > 0) {
    lines.push('', 'The pieces before (already taken into account):');
    for (const piece of history) {
      const slide = piece.slideNumber === null ? '' : `[slide ${piece.slideNumber}] `;
      lines.push(`${slide}"${clip(piece.text, 400)}"`);
    }
  }

  lines.push('', `The new piece:`, `"${clip(input.text, 3000)}"`);
  return lines.join('\n');
}

const num = (value: number) => String(Math.round(value * 10) / 10);

/** The page, its margins, guides and colours – what „oben links“ and „blau“ mean on it. */
export function designLines(editing: RouterEditing): string[] {
  const { page, margins } = editing;
  const lines = [`The slides are ${num(page.width)} × ${num(page.height)} cm.`];
  lines.push(
    margins
      ? `Content area inside the margins: x ${num(margins.left)}–${num(100 - margins.right)}%, y ${num(margins.top)}–${num(100 - margins.bottom)}%.`
      : 'No margins set: the content area begins where the title and body text begin.',
  );
  const guides = editing.guides.slice(0, 12);
  if (guides.length > 0) {
    lines.push(
      `Guides: ${guides.map((guide) => `${guide.orientation === 'vertical' ? 'x' : 'y'} ${num(guide.position)}%`).join(', ')}.`,
    );
  }
  if (editing.palette.length > 0) {
    lines.push(
      `The template's colours: ${editing.palette.map((entry) => (entry.name ? `${entry.name} ${entry.color}` : entry.color)).join(', ')}.`,
    );
  }
  return lines;
}

/** An element as edits need it: what it is, its box, its text and how it looks. */
export function elementLine(element: EditableElement): string {
  const { x, y, w, h } = element.bbox;
  const what = element.role ? `${element.role} placeholder` : element.kind;
  const text = element.paragraphs?.join(' / ').trim();
  const parts = [
    `${element.id} „${clip(element.name, 40)}“ (${what})${text ? `: "${clip(text, MAX_ELEMENT_TEXT)}"` : ''}`,
    `box ${num(x * 100)}, ${num(y * 100)}, ${num(w * 100)}, ${num(h * 100)} (covers x ${num(x * 100)}–${num((x + w) * 100)}, y ${num(y * 100)}–${num((y + h) * 100)})${element.rotation ? `, turned ${num(element.rotation)}°` : ''}`,
  ];
  const looks = element.live ? textLooks(element.live.paragraphs) : null;
  if (looks) parts.push(looks);
  if (element.look) {
    const { fill, fills, stroke } = element.look;
    parts.push(
      `fill ${fill ?? (fills.length > 0 ? 'gradient/picture' : 'none')}, border ${stroke ? `${num(stroke.width)} pt ${stroke.color}` : 'none'}`,
    );
  }
  if (element.locked) parts.push('locked in place by the user – cannot be moved or resized');
  if (!element.movable) parts.push('cannot be moved');
  else if (!element.resizable) parts.push('only moves');
  if (element.paragraphs && !element.live) parts.push('text not editable directly');
  return parts.join('; ');
}

/** How an element's text looks, in short: sizes, fonts, colours, weight, alignment. */
function textLooks(paragraphs: NonNullable<EditableElement['live']>['paragraphs']): string | null {
  const runs = paragraphs.flatMap((paragraph) => paragraph.runs.filter((run) => run.text.trim()));
  if (runs.length === 0) return null;
  const set = <T>(values: T[]) => [...new Set(values)];
  const sizes = set(runs.map((run) => run.size)).sort((a, b) => a - b);
  const fonts = set(runs.map((run) => run.font));
  const colors = set(runs.map((run) => run.color.toLowerCase()));
  const aligns = set(paragraphs.map((paragraph) => paragraph.align));
  const flag = (key: 'bold' | 'italic' | 'underline') =>
    runs.every((run) => run[key]) ? key : runs.some((run) => run[key]) ? `partly ${key}` : '';
  return [
    'text',
    sizes.length === 1 ? `${num(sizes[0]!)} pt` : `${num(sizes[0]!)}–${num(sizes.at(-1)!)} pt`,
    fonts.slice(0, 2).join('/'),
    colors.slice(0, 3).join('/'),
    flag('bold'),
    flag('italic'),
    flag('underline'),
    aligns.join('/'),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Speech recognition makes text of silence and noise now and then – the closing words of TV
 * subtitles it was trained on. Such a piece is dropped before it costs a decision.
 */
const ARTEFACTS = [
  /untertitel(ung)? (im auftrag|von|des|der)/i,
  /\b(zdf|wdr|swr|ard|br|ndr)\b.{0,20}\b(20\d\d)\b/i,
  /amara\.org/i,
  /vielen dank (fürs|für's|für das) zu(schauen|sehen|hören)/i,
  /^(thank you|thanks) for watching[.!]?$/i,
  /^(bis zum nächsten mal|tschüss)[.!]?$/i,
];

/** Whether a transcript is nothing but such an artefact (or no words at all). */
export function isArtefact(text: string): boolean {
  const flat = text.trim();
  if (!/[\p{L}\p{N}]/u.test(flat)) return true;
  return ARTEFACTS.some((pattern) => pattern.test(flat));
}
