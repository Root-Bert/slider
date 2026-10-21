import { z } from 'zod';

/** Bytes per kind of stored file of a review. */
export const deckStorageBreakdownSchema = z.object({
  /** The PowerPoint files, one per version. */
  originals: z.number().int().nonnegative(),
  /** Slide images and thumbnails of every version. */
  slideImages: z.number().int().nonnegative(),
  /** Voice and video recordings and drawn images attached to comments – never freed here. */
  media: z.number().int().nonnegative(),
  /** Anything else under the deck (left-overs of interrupted imports). */
  other: z.number().int().nonnegative(),
});
export type DeckStorageBreakdown = z.infer<typeof deckStorageBreakdownSchema>;

/**
 * `GET /decks/:deckId/storage` (managers only): how much a review takes up, and what deleting the
 * files of every version but the newest would free.
 */
export const deckStorageSchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  breakdown: deckStorageBreakdownSchema,
  /** How many PowerPoint files `breakdown.originals` adds up – one per version still stored. */
  originalCount: z.number().int().nonnegative(),
  /** What `POST …/storage/prune` would free: files only older versions still use. */
  reclaimableBytes: z.number().int().nonnegative(),
  /** Older versions whose files are still (partly) stored. */
  olderVersionCount: z.number().int().nonnegative(),
  /** A version is being imported or rendered right now – pruning waits until it is done. */
  busy: z.boolean(),
});
export type DeckStorage = z.infer<typeof deckStorageSchema>;

/** `POST /decks/:deckId/storage/prune`: files of older versions deleted, comments and media kept. */
export const pruneDeckStorageResultSchema = z.object({
  freedBytes: z.number().int().nonnegative(),
  /** Older versions whose files were deleted by this call. */
  prunedVersionCount: z.number().int().nonnegative(),
  storage: deckStorageSchema,
});
export type PruneDeckStorageResult = z.infer<typeof pruneDeckStorageResultSchema>;
