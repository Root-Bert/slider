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

/** Background re-render of a deck's slide images (BER-94). */
export const slideRenderingSchema = z.object({
  status: z.enum(['queued', 'running']),
  done: z.number().int(),
  /** `0` while queued. */
  total: z.number().int(),
});
export type SlideRendering = z.infer<typeof slideRenderingSchema>;

/** `POST /decks/:deckId/rerender`. */
export const rerenderResultSchema = z.object({
  status: z.enum(['queued', 'running']),
  /** `renderedAt` of the deck status before this run – it changes once new images are in. */
  renderedAt: z.iso.datetime().nullable(),
});
export type RerenderResult = z.infer<typeof rerenderResultSchema>;

/** `GET /decks/:deckId/status`: cheap to poll; reload slides and comments when `revisionNumber` changes. */
export const deckStatusSchema = z.object({
  deckId: z.string(),
  revisionNumber: z.number().int(),
  currentRevisionId: z.string().nullable(),
  updatedAt: z.iso.datetime(),
  import: importStateSchema,
  sync: deckSyncSchema,
  /** "Folienbilder neu erzeugen" queued or running (BER-94); `null` otherwise. */
  rendering: slideRenderingSchema.nullable().optional(),
  /**
   * When the current revision's slide images were last replaced in the background; viewers
   * reload the slide list when it changes (the old image files are gone). `null` if not since
   * the API started.
   */
  renderedAt: z.iso.datetime().nullable().optional(),
});
export type DeckStatus = z.infer<typeof deckStatusSchema>;
