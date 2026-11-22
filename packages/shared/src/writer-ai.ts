import { z } from 'zod';
import { authorSchema } from './model';

/*
 * The AI in a document: a comment handed to it („An die KI geben“, ⌘↵). It reads the document
 * and the comment's thread and changes the text – written at once, a version of its own, taken
 * back and applied again from its card under the comment – or answers there without changing.
 */

/**
 * `applied`: it changed the text; `answered`: it only wrote back; `reverted`: its change was
 * taken back; `stopped`: someone stopped it at work.
 */
export const WRITER_AI_STATES = [
  'running',
  'applied',
  'answered',
  'failed',
  'stopped',
  'reverted',
] as const;
export const writerAiStateSchema = z.enum(WRITER_AI_STATES);
export type WriterAiState = z.infer<typeof writerAiStateSchema>;

export const writerAiProposalSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  /** The comment handed to it: its card stands under that one. */
  commentId: z.string(),
  /** The AI under the name its workspace gave it. */
  author: authorSchema,
  status: writerAiStateSchema,
  /** What it did, or its answer. */
  summary: z.string(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type WriterAiProposal = z.infer<typeof writerAiProposalSchema>;

export const createWriterAiProposalInputSchema = z.object({
  /** Made in the browser: asked twice is asked once. */
  id: z.string().uuid(),
  commentId: z.string().min(1).max(100),
});
export type CreateWriterAiProposalInput = z.infer<typeof createWriterAiProposalInputSchema>;
