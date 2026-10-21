import { and, eq } from 'drizzle-orm';
import type { ParsedComment, ParsedPresentation, ParsedSlide } from '@slider/pptx';
import type { Executor } from '../db/client';
import { comments, type DeckRow, type RevisionRow } from '../db/schema';
import type { Logger } from '../logger';
import type { GoogleSlideComment, GoogleSlidesExtras } from '../sources/google-drive';
import type { SourceAdapters } from '../sources/source-adapter';
import {
  CONVERSION_TIME_SLACK_MS,
  isLegacyId,
  upsertPptxComments,
  type ImportedSlide,
  type PptxCommentCounts,
} from './pptx-comments';

/**
 * What a Google Slides deck's PowerPoint export leaves out (BER-157), for one revision: each
 * slide's `objectId` and the comments as Drive tells them. `null` when it does not apply or could
 * not be read.
 */
export type SlidesExtrasReader = (
  deck: DeckRow,
  revision: RevisionRow,
) => Promise<GoogleSlidesExtras | null>;

/** A deck made from a Google Slides file (not a `.pptx` kept in Drive). */
export const isGoogleSlidesDeck = (deck: Pick<DeckRow, 'source' | 'sourceRef'>) =>
  deck.source === 'google' &&
  (deck.sourceRef?.startsWith('https://docs.google.com/presentation/') ?? false);

/** Reads the extras of Google Slides decks through the deck's Google connection. Best effort. */
export function createSlidesExtras(sources: SourceAdapters, log: Logger): SlidesExtrasReader {
  return async (deck, revision) => {
    if (!isGoogleSlidesDeck(deck) || !deck.sourceRef) return null;
    const file = { ref: deck.sourceRef, fileName: deck.fileName, sizeBytes: 0, changeToken: null };
    const context = { userId: deck.ownerId, googleConnectionId: deck.googleConnectionId };
    try {
      // Google answers for the file as it is now: changed since this revision, its slides would
      // belong to the next one.
      if (revision.sourceChangeToken) {
        const now = await sources.google.getChangeToken(file, context);
        if (now && now !== revision.sourceChangeToken) return null;
      }
      return await sources.google.readSlidesExtras(file, context);
    } catch (error) {
      log.warn(`Google slide ids and comments of deck ${deck.id} unavailable`, error);
      return null;
    }
  };
}

/** The slide ids, if they describe exactly these slides (one each, in order); else `null`. */
export function slideIdsFor(
  extras: GoogleSlidesExtras | null,
  slides: readonly ParsedSlide[],
): string[] | null {
  const ids = extras?.slideIds;
  if (!ids || ids.length !== slides.length) return null;
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
  return ids;
}

const normalText = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Export times carry no time zone; Google writes them in UTC. */
const exportTime = (value: string | null) => {
  if (!value) return Number.NaN;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`).getTime();
};

/**
 * The comments of a Google Slides revision, in the parser's shape (`upsertPptxComments`):
 *
 * - With Drive's comments: each one keeps Drive's id, author, status and replies, and takes its
 *   slide and position from the export's comment of the same text and about the same time (the
 *   export places comments; Drive does not say where). Failing that, the slide its anchor names;
 *   failing that it is left out (`unplaced`). Export comments without a Drive counterpart (replies
 *   flattened by the export) are dropped.
 * - Without them: the export's own comments, as they are.
 */
export function googleComments(
  extras: GoogleSlidesExtras | null,
  presentation: Pick<ParsedPresentation, 'comments' | 'slides'>,
  slideIds: readonly string[] | null,
): { comments: ParsedComment[]; unplaced: number } {
  if (!extras) return { comments: [...presentation.comments], unplaced: 0 };
  const exported = [...presentation.comments];
  const sldIdByObjectId = new Map(
    (slideIds ?? []).map((id, index) => [id, presentation.slides[index]?.sldId] as const),
  );
  const placeOf = (comment: GoogleSlideComment) => {
    const text = normalText(comment.text);
    const at = exportTime(comment.createdAt);
    let best = -1;
    let bestDistance = CONVERSION_TIME_SLACK_MS;
    exported.forEach((candidate, index) => {
      if (normalText(candidate.text) !== text) return;
      const distance = Math.abs(exportTime(candidate.createdAt) - at);
      if (distance <= bestDistance) [best, bestDistance] = [index, distance];
    });
    return best < 0 ? null : (exported.splice(best, 1)[0] ?? null);
  };
  const result: ParsedComment[] = [];
  let unplaced = 0;
  for (const comment of extras.comments) {
    const match = placeOf(comment);
    const sldId =
      match?.sldId ??
      (comment.slideObjectId ? sldIdByObjectId.get(comment.slideObjectId) : undefined);
    if (sldId === undefined) {
      unplaced += 1;
      continue;
    }
    result.push({
      externalId: comment.externalId,
      format: 'modern',
      sldId,
      author: comment.author,
      createdAt: comment.createdAt,
      text: comment.text,
      status: comment.status,
      anchor: match?.anchor ?? { type: 'slide' },
      replies: comment.replies,
    });
  }
  return { comments: result, unplaced };
}

/**
 * Imports a Google Slides revision's comments as `gslides` (BER-157). Comments imported before
 * as PowerPoint ones (the export's) become Google ones first; Drive's ids then take them over
 * (`takeOverLegacy`). A revision without Drive's comments leaves rows that came from Drive alone
 * – the export's loose copies would flag them removed and come back as duplicates.
 */
export async function upsertGoogleComments(
  db: Executor,
  deckId: string,
  extras: GoogleSlidesExtras | null,
  presentation: Pick<ParsedPresentation, 'comments' | 'slides'>,
  slideIds: readonly string[] | null,
  slidesBySldId: ReadonlyMap<number, ImportedSlide>,
  now: Date,
  log: Logger,
): Promise<PptxCommentCounts> {
  await db
    .update(comments)
    .set({ source: 'gslides' })
    .where(and(eq(comments.deckId, deckId), eq(comments.source, 'pptx')));
  if (!extras) {
    const known = await db
      .select({ externalId: comments.externalId })
      .from(comments)
      .where(and(eq(comments.deckId, deckId), eq(comments.source, 'gslides')));
    if (known.some((row) => row.externalId !== null && !isLegacyId(row.externalId)))
      return { inserted: 0, updated: 0, removed: 0, restored: 0, total: known.length };
  }
  const { comments: parsed, unplaced } = googleComments(extras, presentation, slideIds);
  if (unplaced > 0)
    log.info(`Deck ${deckId}: ${unplaced} Google comment(s) without a slide skipped`);
  return upsertPptxComments(db, deckId, parsed, slidesBySldId, now, 'gslides');
}
