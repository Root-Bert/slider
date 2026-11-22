import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  writerText,
  type DocumentVoiceContext,
  type WriterAnchor,
  type WriterBlock,
  type WriterParagraphBlock,
} from '@slider/shared';
import { actionList, MAX_ACTIONS, MAX_COMMENT_CHARS } from './router';

/*
 * What a piece of speech is, said over a text document (`router.ts` is the same for a deck): a
 * fast model reads it with the paragraphs that stood in the window, where the caret was and
 * what the pointer rested on, and answers with actions – a new comment at a paragraph's words,
 * more of the one being said, finished, an addition, taken back, or a command.
 */

/** Paragraphs of the window named to the model at most, and how much of each one's text. */
const MAX_PARAGRAPHS = 40;
const MAX_PARAGRAPH_CHARS = 500;
/** Headings of the whole document listed at most. */
const MAX_HEADINGS = 80;
const MAX_ITEMS = 12;
const MAX_HISTORY = 6;
/** What a comment's anchor keeps of its words (`writerAnchorSchema`). */
const MAX_QUOTE = 600;

export const DOCUMENT_ROUTER_SYSTEM = `You listen along while a person goes through a text document in Writer – an editor where teams write and review documents – and speaks their thoughts out loud. Their speech reaches you in pieces, cut at their pauses and turned into text by speech recognition: expect recognition errors, filler words, false starts and sentences cut in the middle. For every new piece you decide what it is and call \`act\` once with the actions it calls for – none when the piece says nothing about the document (small talk, thinking aloud without content, „ähm“, noise, a recognition artefact).

The person's remarks become comments at the words they mean; an AI that edits the text works on each finished comment right away, while the person goes on speaking. One comment is one thing to change, ask or note, at one place: two changes at two places are two comments; several changes of the same sentence or paragraph said in one go are one comment. Questions and remarks without a change are comments too – the AI answers them in the thread.

Actions:
- new: a remark about something no comment of this session covers yet. \`paragraph\`: the id of the paragraph it is about, from the list – what the person says („dieser Absatz“, „die Überschrift“, „der Satz mit …“, „hier“, „das da“) together with where the caret stands, what is picked and where the pointer rested tells you which; without any such hint, the paragraph in the middle of the window that fits what is said. \`quote\`: the words of that paragraph it means, copied exactly as they stand there (a word, a phrase, a sentence) – when it is about some of its words; leave it out when it is about the paragraph as a whole. When words are picked and the person means them („das hier“, „diese Stelle“), leave \`quote\` out: the comment stands at the picked words. \`text\`: the comment.
- continue: the piece goes on with a comment still being said – \`item\` and its complete new \`text\` (what it said so far and what is new, merged into one comment).
- finish: a comment being said is complete – \`item\`. A comment is complete when the person moved on (another place, another topic) or clearly ended the thought. Finish it as soon as it stands on its own – don't wait for more: the AI can start sooner. A request complete in one piece („kürz den Absatz“, „mach daraus eine Aufzählung“, „das klingt zu steif“) is a new comment with \`finished\`: true in the same step – a complete sentence is finished. When a piece is clearly cut off mid-thought, keep the comment open instead.
- new, continue and add_to take \`finished\`: true finishes the comment in the same step.
- add_to: the person adds to a comment that is finished already – about the same place („und noch etwas freundlicher“, „ach, und ohne das Fremdwort“) – \`item\` and the addition as \`text\`. It becomes a reply in that comment's thread, and the AI takes it up with the comment. A new thing at another place is a new comment, not an addition.
- drop: the person takes a comment back („nee, vergiss das“, „streich das wieder“) – \`item\`.
- undo: the person wants the AI's change of a comment taken back („mach das rückgängig“) – \`item\`.
- scroll_to: the person asks to go somewhere in the document („geh zum Fazit“, „zeig mir die Einleitung“, „zurück zum Anfang“) – \`paragraph\`: the id of the paragraph or heading to show, from the outline or the list. Only for such requests: scrolling by hand is not one.
- stop_session: the person ends speaking to you („Stopp, ich bin fertig“, „das war's“).

Writing a comment's text: in the language the person speaks, as their remark or request to the AI that edits the text – clear and complete, without filler words, false starts or recognition errors, keeping everything they meant (what, where, how, why). Speech recognition mishears words that sound alike: where a word makes no sense in its place, write the similar-sounding word that does – never a different meaning. Words the person dictates for the text („schreib stattdessen: …“) stay word for word. Name what „hier“, „das“, „dieser Satz“ point at when the comment's place alone does not say it. Add nothing they did not say. Keep their voice: a request stays a request, a question a question.`;

const ACTION_TYPES = [
  'new',
  'continue',
  'finish',
  'add_to',
  'drop',
  'undo',
  'scroll_to',
  'stop_session',
] as const;

/** The one tool the model calls. */
export const DOCUMENT_ROUTER_TOOL: Anthropic.Beta.BetaTool & {
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
            type: { type: 'string', enum: [...ACTION_TYPES] },
            item: { type: 'string', description: 'A comment of this session, e.g. "K2".' },
            paragraph: { type: 'string', description: 'A paragraph id from the list or outline.' },
            quote: {
              type: 'string',
              maxLength: MAX_QUOTE,
              description: 'The words of that paragraph the comment means, exactly as they stand.',
            },
            text: { type: 'string', maxLength: MAX_COMMENT_CHARS },
            finished: { type: 'boolean' },
          },
          required: ['type'],
        },
      },
    },
    required: ['actions'],
  },
};

const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  item: z.string().max(20).nullish(),
  paragraph: z.string().max(100).nullish(),
  quote: z.string().nullish(),
  text: z.string().nullish(),
  finished: z.boolean().nullish(),
});
export type DocumentRouterAction = z.infer<typeof actionSchema>;

/** The model's actions, those that can be read – a broken one is left out, not the others. */
export function readDocumentActions(input: unknown): DocumentRouterAction[] {
  return actionList(input)
    .slice(0, MAX_ACTIONS)
    .flatMap((raw) => {
      const action = actionSchema.safeParse(raw);
      if (!action.success) return [];
      const text = action.data.text?.trim().slice(0, MAX_COMMENT_CHARS);
      return [{ ...action.data, text: text || null, quote: action.data.quote?.trim() || null }];
    });
}

/** Every paragraph of a document in reading order, those in table cells too. */
export const paragraphsIn = (blocks: readonly WriterBlock[]): WriterParagraphBlock[] =>
  blocks.flatMap((block) =>
    block.type === 'paragraph'
      ? [block]
      : block.rows.flatMap((row) => row.flatMap((cell) => cell.blocks)),
  );

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where a quote stands in a text – whatever its case, its spaces and the marks around it. */
function rangeOfQuote(text: string, quote: string): { start: number; end: number } | null {
  const words = quote
    .replace(/^[\s„“”"'‚‘’«»…]+|[\s„“”"'‚‘’«»…]+$/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  const found = new RegExp(words.map(escapeRegExp).join('\\s+'), 'iu').exec(text);
  return found ? { start: found.index, end: found.index + found[0].length } : null;
}

/**
 * Where a spoken comment stands in its paragraph: at the words quoted, when they are found
 * there; else at the words picked, when they are picked in that paragraph; else at the whole
 * paragraph – as a comment made by hand with nothing picked.
 */
export function anchorFor(
  paragraph: { id: string; text: string },
  quote: string | null | undefined,
  selection: DocumentVoiceContext['selection'],
): WriterAnchor {
  const { id, text } = paragraph;
  const at = (start: number, end: number): WriterAnchor => ({
    paragraphId: id,
    start,
    end,
    quote: text.slice(start, end).slice(0, MAX_QUOTE),
  });
  const quoted = quote ? rangeOfQuote(text, quote) : null;
  if (quoted) return at(quoted.start, quoted.end);
  if (selection?.paragraphId === id) {
    const start = Math.min(selection.start, text.length);
    const end = Math.min(selection.end, text.length);
    if (end > start) return at(start, end);
  }
  return at(0, text.length);
}

/** A comment of the session as the model sees it. */
export interface DocumentRouterItem {
  /** `K1`, `K2`, … */
  label: string;
  /** Where it stands, in words. */
  place: string;
  text: string;
  /** In words: being said, waiting for the AI, applied, … */
  status: string;
}

export interface DocumentRouterInput {
  title: string;
  blocks: readonly WriterBlock[];
  context: DocumentVoiceContext;
  items: readonly DocumentRouterItem[];
  /** The pieces before, as heard. */
  history: readonly string[];
  text: string;
  /** How long the piece took, ms. */
  durationMs: number;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function paragraphLine(block: WriterParagraphBlock): string {
  const said = [
    `id="${block.id}"`,
    ...(block.kind !== 'text' ? [`kind="${block.kind}"`] : []),
    ...(block.kind === 'heading' ? [`level="${block.level ?? 1}"`] : []),
    ...(block.list ? [`list="${block.list.kind}"`] : []),
  ];
  return `<p ${said.join(' ')}>${clip(writerText(block), MAX_PARAGRAPH_CHARS)}</p>`;
}

/** The user message: the document, what was in the window, the comments so far, the new piece. */
export function documentRouterPrompt(input: DocumentRouterInput): string {
  const { context } = input;
  const all = paragraphsIn(input.blocks);
  const byId = new Map(all.map((block) => [block.id, block]));
  const lines: string[] = [];
  lines.push(`Document „${clip(input.title, 200)}“, ${all.length} paragraphs. Its outline:`);
  const headings = all.filter(
    (block) => (block.kind === 'title' || block.kind === 'heading') && writerText(block).trim(),
  );
  if (headings.length === 0) lines.push('(no headings)');
  for (const block of headings.slice(0, MAX_HEADINGS)) {
    const level = block.kind === 'title' ? 'title' : `heading ${block.level ?? 1}`;
    lines.push(`- ${block.id} (${level}): ${clip(writerText(block), 100)}`);
  }
  if (headings.length > MAX_HEADINGS) lines.push('…');

  lines.push('', `While the new piece was said (${seconds(input.durationMs)}):`);
  const seen = new Set(
    context.paragraphs.filter((entry) => byId.has(entry.paragraphId)).map((e) => e.paragraphId),
  );
  // In reading order; of too many, those around the middle of the window.
  let inView = all.filter((block) => seen.has(block.id));
  if (inView.length > MAX_PARAGRAPHS) {
    const from = Math.floor((inView.length - MAX_PARAGRAPHS) / 2);
    inView = inView.slice(from, from + MAX_PARAGRAPHS);
  }
  if (inView.length === 0) lines.push('No paragraph was in the window.');
  else {
    lines.push('These paragraphs stood in the window, top to bottom:');
    for (const block of inView) lines.push(paragraphLine(block));
  }
  const pointer = context.pointer.filter((entry) => byId.has(entry.paragraphId));
  for (const entry of pointer) {
    lines.push(`The pointer rested ${seconds(entry.ms)} on paragraph ${entry.paragraphId}.`);
  }
  if (pointer.length === 0) lines.push('The pointer was not on the text.');
  const selection = context.selection;
  const selected = selection ? byId.get(selection.paragraphId) : undefined;
  if (selection && selected) {
    const text = writerText(selected);
    if (selection.end > selection.start && selection.text.trim()) {
      lines.push(
        `Picked in paragraph ${selected.id}: the words „${clip(selection.text, MAX_QUOTE)}“.`,
      );
    } else {
      const at = Math.min(selection.start, text.length);
      lines.push(
        `The caret stands in paragraph ${selected.id}: „${clip(text.slice(Math.max(0, at - 40), at), 60)}|${clip(text.slice(at, at + 40), 60)}“ (| is the caret).`,
      );
    }
  }

  lines.push('', 'Comments said in this session so far (oldest first):');
  const items = input.items.slice(-MAX_ITEMS);
  if (items.length === 0) lines.push('None yet.');
  for (const item of items) {
    lines.push(`${item.label} [${item.place}; ${item.status}]: "${clip(item.text, 600)}"`);
  }

  const history = input.history.slice(-MAX_HISTORY);
  if (history.length > 0) {
    lines.push('', 'The pieces before (already taken into account):');
    for (const piece of history) lines.push(`"${clip(piece, 400)}"`);
  }

  lines.push('', 'The new piece:', `"${clip(input.text, 3000)}"`);
  return lines.join('\n');
}
