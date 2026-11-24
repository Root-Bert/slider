import type { z } from 'zod';
import { cloudChatInputSchema, type CloudChatEvent } from './cloud-chat';

/*
 * The AI on Slider's start (✨ beside the presentations): one person's chat with the workspace's
 * AI in a side panel, as beside the files in Cloud. It finds presentations (by title, by what
 * stands on slides and in comments), shows them in the list, renames, files, archives and
 * deletes them, says who may open them, and makes new ones – with the person's own rights. The
 * chat lives in the page: each message brings the talk so far.
 */

export const homeChatInputSchema = cloudChatInputSchema.pick({
  text: true,
  attachments: true,
  history: true,
});
export type HomeChatInput = z.input<typeof homeChatInputSchema>;

/**
 * What the answer's stream tells: as Cloud's chat (`changed`: presentations were touched), and
 * `filter` – the list should show what matches these words („zeig mir …“).
 */
export type HomeChatEvent = CloudChatEvent | { type: 'filter'; query: string };
