import { z } from 'zod';
import {
  MAX_MATERIAL_CHAT_MESSAGE,
  MAX_MATERIAL_CHAT_MESSAGES,
  MAX_MATERIAL_CHAT_TEXT,
  type MaterialChatEvent,
} from './material-chat';

/*
 * The AI in Cloud (✨ beside the files): one person's chat with the workspace's AI in a side
 * panel, as on a presentation's material page. It looks through the files the person may see,
 * finds things, names them, makes folders and tidies – with the person's own rights, nothing
 * more. The chat lives in the page (not kept on the server): each message brings the talk so far.
 */

export const cloudChatInputSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MATERIAL_CHAT_MESSAGE),
  /** The chat so far, oldest first. */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(MAX_MATERIAL_CHAT_TEXT),
      }),
    )
    .max(MAX_MATERIAL_CHAT_MESSAGES)
    .default([]),
  /** Where the person is: the open folder, or the area whose top is open. */
  folderId: z.string().min(1).max(100).nullable().optional(),
  areaId: z.string().min(1).max(100).nullable().optional(),
});
export type CloudChatInput = z.input<typeof cloudChatInputSchema>;

/** What the answer's stream tells: as a material chat's, and `changed` when files were touched. */
export type CloudChatEvent = Exclude<MaterialChatEvent, { type: 'chat' }> | { type: 'changed' };
