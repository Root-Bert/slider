import { z } from 'zod';

/*
 * The AI on the material page (✨ in its controls): a chat in a side panel, as Claude or ChatGPT
 * over MCP, but in Slider – it reads the deck's material, searches the web where the workspace's
 * AI can, and puts what it finds on the board (notes, links, text files). Each person's own chats
 * per deck, kept until they delete them; what it puts on the board is everyone's.
 */

/** Longest message one writes. */
export const MAX_MATERIAL_CHAT_MESSAGE = 8000;
/** Longest message the AI is given of the chat so far (a longer answer is cut). */
export const MAX_MATERIAL_CHAT_TEXT = 60_000;
/** Messages of the chat so far the AI is given (the latest ones; older fall away). */
export const MAX_MATERIAL_CHAT_MESSAGES = 40;
/** A chat's title: the start of its first message. */
export const MAX_MATERIAL_CHAT_TITLE = 80;

/** `POST /decks/:deckId/material-chat`: a message, in a chat of one's own or a new one (`null`). */
export const materialChatInputSchema = z.object({
  chatId: z.string().min(1).max(100).nullable(),
  text: z
    .string()
    .trim()
    .min(1, 'Schreib eine Nachricht.')
    .max(MAX_MATERIAL_CHAT_MESSAGE, 'Die Nachricht ist zu lang.'),
});
export type MaterialChatInput = z.infer<typeof materialChatInputSchema>;

/** How an answer of the AI ended (`stopped`: the person stopped it). */
export type MaterialChatAnswerState = 'done' | 'failed' | 'stopped';

/** One message of a chat: the person's (`state` null) or the AI's answer. */
export interface MaterialChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  state: MaterialChatAnswerState | null;
  /** Why the answer failed (German). */
  error: string | null;
  createdAt: string;
}

/** `GET /decks/:deckId/material-chats`: one's own chats on the deck, latest first. */
export interface MaterialChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** `GET /decks/:deckId/material-chats/:chatId`: a chat with its messages, oldest first. */
export interface MaterialChatDto extends MaterialChatSummary {
  messages: MaterialChatMessage[];
}

/**
 * What the answer's stream tells: `chat` – first, the chat it is in (a new one's id and title);
 * `text` – its next words; `reading` – what the AI does now („Sucht im Web …“); `error` – it
 * failed (German); `done` – over, and kept.
 */
export type MaterialChatEvent =
  | { type: 'chat'; id: string; title: string }
  | { type: 'text'; text: string }
  | { type: 'reading'; label: string }
  | { type: 'error'; message: string }
  | { type: 'done'; state: MaterialChatAnswerState };
