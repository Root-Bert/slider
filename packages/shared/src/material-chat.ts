import { z } from 'zod';

/*
 * The AI on the material page (✨ in its controls): a chat in a side panel, as Claude or ChatGPT
 * over MCP, but in Slider – it reads the deck's material, searches the web where the workspace's
 * AI can, and puts what it finds on the board (notes, links, text files). Each person's own,
 * kept in their tab; what it puts on the board is everyone's.
 */

/** Longest message one writes. */
export const MAX_MATERIAL_CHAT_MESSAGE = 8000;
/** Longest message sent along (an answer of the AI's longer is cut). */
export const MAX_MATERIAL_CHAT_TEXT = 60_000;
/** Messages sent along (the latest ones; older fall away). */
export const MAX_MATERIAL_CHAT_MESSAGES = 40;

export const materialChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(MAX_MATERIAL_CHAT_TEXT),
});
export type MaterialChatMessage = z.infer<typeof materialChatMessageSchema>;

/** The chat so far, ending with the person's new message. */
export const materialChatInputSchema = z.object({
  messages: z
    .array(materialChatMessageSchema)
    .min(1)
    .max(MAX_MATERIAL_CHAT_MESSAGES)
    .refine((messages) => messages.at(-1)?.role === 'user', 'The last message is the person’s.')
    .refine(
      (messages) => messages.at(-1)!.text.trim().length <= MAX_MATERIAL_CHAT_MESSAGE,
      'Die Nachricht ist zu lang.',
    ),
});
export type MaterialChatInput = z.infer<typeof materialChatInputSchema>;

/**
 * What the answer's stream tells: `text` – its next words; `reading` – what the AI does now
 * („Sucht im Web …“); `error` – it failed (German); `done` – over (`stopped`: the person stopped).
 */
export type MaterialChatEvent =
  | { type: 'text'; text: string }
  | { type: 'reading'; label: string }
  | { type: 'error'; message: string }
  | { type: 'done'; state: 'done' | 'failed' | 'stopped' };
