import { z } from 'zod';
import { commentSchema, importStateSchema } from './model';
import { deckSyncSchema, slideDiffSchema, syncSummarySchema } from './sync';

/** A slide that is no longer in the deck, shown with its last version and its comments. */
export const deletedSlideSchema = z.object({
  slideId: z.string(),
  title: z.string().nullable(),
  /** Its position in the revision before the one that removed it. */
  previousPosition: z.number().int(),
  imageUrl: z.string(),
  thumbnailUrl: z.string(),
  aspectRatio: z.number().positive(),
  /** The last revision that still had this slide. */
  lastRevisionNumber: z.number().int(),
  /** 0–1: how sure the matching is that the slide was really deleted. */
  confidence: z.number().min(0).max(1),
  /** Roots and replies; comments are never deleted with their slide. */
  comments: z.array(commentSchema),
});
export type DeletedSlide = z.infer<typeof deletedSlideSchema>;

/** `GET /decks/:deckId/revisions/:revisionId/diff`: what changed against the revision before. */
export const revisionDiffSchema = z.object({
  revisionId: z.string(),
  number: z.number().int(),
  /** `null` for revision 1 – then `slides` and `deletedSlides` are empty. */
  previousRevisionId: z.string().nullable(),
  slides: z.array(slideDiffSchema),
  deletedSlides: z.array(deletedSlideSchema),
  summary: syncSummarySchema.nullable(),
});
export type RevisionDiff = z.infer<typeof revisionDiffSchema>;

/** `GET /decks/:deckId/status`: cheap to poll; reload slides and comments when `revisionNumber` changes. */
export const deckStatusSchema = z.object({
  deckId: z.string(),
  revisionNumber: z.number().int(),
  currentRevisionId: z.string().nullable(),
  updatedAt: z.iso.datetime(),
  import: importStateSchema,
  sync: deckSyncSchema,
});
export type DeckStatus = z.infer<typeof deckStatusSchema>;
