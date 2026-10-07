import { z } from 'zod';

/**
 * Automatic updates of link-imported decks (BER-107, BER-108, BER-114).
 *
 * Only the building blocks that `model.ts` embeds as optional fields live here, so this file
 * imports nothing from the model (no import cycle). Composite payloads that contain decks or
 * comments are in `revisions.ts`.
 */

/** Why the last automatic update failed. The current revision always stays visible. */
export const SYNC_ERROR_CODES = [
  'auth_required',
  'consent_required',
  'not_configured',
  'access_revoked',
  'not_found',
  'unreachable',
  'not_a_powerpoint',
  'file_too_large',
  'parse_failed',
  'internal',
] as const;
export const syncErrorCodeSchema = z.enum(SYNC_ERROR_CODES);
export type SyncErrorCode = z.infer<typeof syncErrorCodeSchema>;

export const syncErrorSchema = z.object({
  code: syncErrorCodeSchema,
  /** German text for the banner. */
  message: z.string(),
  at: z.iso.datetime(),
  /** With `auth_required`: sign in again and come back to the deck (owner only). */
  loginUrl: z.string().optional(),
});
export type SyncError = z.infer<typeof syncErrorSchema>;

const count = z.number().int().min(0);

/** What one new revision changed, with a ready-made German sentence. */
export const syncSummarySchema = z.object({
  slidesModified: count,
  slidesNew: count,
  slidesDeleted: count,
  slidesMoved: count,
  commentsNew: count,
  commentsUpdated: count,
  commentsRemoved: count,
  /** e.g. "3 Folien geändert, 1 neu, 1 gelöscht, 5 neue Kommentare aus PowerPoint". */
  text: z.string(),
});
export type SyncSummary = z.infer<typeof syncSummarySchema>;
export type SyncCounts = Omit<SyncSummary, 'text'>;

/** Sync state of a deck, for the "updated" / "could not update" banner. */
export const deckSyncSchema = z.object({
  /** `true` for decks imported from a link; uploads are never polled. */
  enabled: z.boolean(),
  lastCheckedAt: z.iso.datetime().nullable(),
  /** When the last new revision was imported successfully. */
  lastSyncAt: z.iso.datetime().nullable(),
  lastSyncError: syncErrorSchema.nullable(),
  /** A change was seen and is waiting for PowerPoint to settle, or is being imported. */
  pending: z.boolean(),
  pendingSince: z.iso.datetime().nullable(),
  /** Summary of the current revision (`null` for revision 1). */
  latestSummary: syncSummarySchema.nullable(),
});
export type DeckSync = z.infer<typeof deckSyncSchema>;

/** How a slide of the current revision relates to the previous revision (BER-108). */
export const slideDiffStatusSchema = z.enum(['unchanged', 'moved', 'modified', 'new']);
export type SlideDiffStatus = z.infer<typeof slideDiffStatusSchema>;

export const slideChangeSchema = z.object({
  status: slideDiffStatusSchema,
  /** Also `true` for a modified slide that changed its place. */
  moved: z.boolean(),
  /** 0–1: how sure the matching is that this is the same slide as before. */
  confidence: z.number().min(0).max(1),
});
export type SlideChange = z.infer<typeof slideChangeSchema>;

export const slideDiffSchema = slideChangeSchema.extend({
  slideId: z.string(),
  position: z.number().int(),
  previousPosition: z.number().int().nullable(),
  matchedBy: z.enum(['sldId', 'content']).nullable(),
});
export type SlideDiff = z.infer<typeof slideDiffSchema>;

export const revisionStatusSchema = z.enum(['pending', 'ready', 'failed']);
export type RevisionStatus = z.infer<typeof revisionStatusSchema>;

export const revisionTriggerSchema = z.enum(['initial', 'poll', 'manual', 'upload']);
export type RevisionTrigger = z.infer<typeof revisionTriggerSchema>;

export const revisionSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  createdAt: z.iso.datetime(),
  status: revisionStatusSchema,
  /** `null` for revisions made before automatic updates existed. */
  trigger: revisionTriggerSchema.nullable(),
  isCurrent: z.boolean(),
  summary: syncSummarySchema.nullable(),
});
export type Revision = z.infer<typeof revisionSchema>;

/** Response of `POST /decks/:deckId/sync`. Failures come back here, never as HTTP errors. */
export const syncResultSchema = z.object({
  status: z.enum(['unchanged', 'updated', 'queued', 'error']),
  revisionId: z.string().optional(),
  summary: syncSummarySchema.optional(),
  error: syncErrorSchema.optional(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The German one-liner for a sync summary, e.g. for a toast. */
export function formatSyncSummary(counts: SyncCounts): string {
  const parts: string[] = [];
  if (counts.slidesModified > 0)
    parts.push(plural(counts.slidesModified, 'Folie geändert', 'Folien geändert'));
  if (counts.slidesNew > 0) parts.push(`${counts.slidesNew} neu`);
  if (counts.slidesDeleted > 0) parts.push(`${counts.slidesDeleted} gelöscht`);
  if (counts.slidesMoved > 0) parts.push(`${counts.slidesMoved} verschoben`);
  if (counts.commentsNew > 0) {
    parts.push(
      plural(
        counts.commentsNew,
        'neuer Kommentar aus PowerPoint',
        'neue Kommentare aus PowerPoint',
      ),
    );
  }
  if (counts.commentsUpdated > 0) {
    parts.push(
      plural(
        counts.commentsUpdated,
        'Kommentar in PowerPoint geändert',
        'Kommentare in PowerPoint geändert',
      ),
    );
  }
  if (counts.commentsRemoved > 0) {
    parts.push(
      plural(
        counts.commentsRemoved,
        'Kommentar in PowerPoint entfernt',
        'Kommentare in PowerPoint entfernt',
      ),
    );
  }
  return parts.length > 0 ? parts.join(', ') : 'Keine sichtbaren Änderungen';
}

export const toSyncSummary = (counts: SyncCounts): SyncSummary => ({
  ...counts,
  text: formatSyncSummary(counts),
});
