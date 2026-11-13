import { z } from 'zod';

/*
 * „Fragen“ on the material page: a note on the board handed to the AI with ⌘↵, like a comment –
 * its text the question. The AI answers from the deck's material – reading the files through
 * its tools, never from what it knows otherwise – citing where each part comes from, and the
 * answer stands under the note for everyone who sees the board. One per note: asked again, the
 * answer is written anew. It comes word by word to whoever asked; the others see it once it is
 * there.
 */

/** Longest question. */
export const MAX_MATERIAL_QUESTION = 4000;

/** `answering` while the AI is at it; `stopped`: stopped before it was done. */
export const MATERIAL_QUESTION_STATES = ['answering', 'done', 'failed', 'stopped'] as const;
export type MaterialQuestionState = (typeof MATERIAL_QUESTION_STATES)[number];

export const materialQuestionSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  /** The note asked (`BoardItem.id`). */
  noteId: z.string(),
  question: z.string(),
  /** Markdown with citations (`[[<material id>]]`, `[[<material id>#<page>]]`). */
  answer: z.string(),
  state: z.enum(MATERIAL_QUESTION_STATES),
  /** Why it failed (German). */
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type MaterialQuestion = z.infer<typeof materialQuestionSchema>;

/**
 * A note asked; `id` made by the browser, so the page knows it before the answer. `question`:
 * the note's text as it is now (it may be typed into still).
 */
export const askMaterialInputSchema = z.object({
  id: z.uuid(),
  noteId: z.string().min(1).max(100),
  question: z.string().trim().min(1).max(MAX_MATERIAL_QUESTION),
});
export type AskMaterialInput = z.infer<typeof askMaterialInputSchema>;

/**
 * What the answer's stream (`text/event-stream`) tells, one JSON per event: `text` – the next
 * words of the answer; `reading` – what the AI looks at now („Liest „Bericht.pdf“ …“); `done` –
 * the answer as kept; `error` – it failed (German).
 */
export type MaterialAnswerEvent =
  | { type: 'text'; text: string }
  | { type: 'reading'; label: string }
  | { type: 'done'; question: MaterialQuestion }
  | { type: 'error'; message: string };

/**
 * A citation in an answer: `[[id]]` a file of the board, `[[id#4]]` its page (sheet part, slide)
 * 4. Ids are the board's (`Material.id`, also `BoardItem.id` for a note or link).
 */
export const MATERIAL_CITATION = /\[\[([A-Za-z0-9_-]{6,100})(?:#(\d{1,5}))?\]\]/g;
