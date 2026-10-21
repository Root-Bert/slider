import type { Anchor, Comment, CommentSource } from '@slider/shared';

/** German copy for where a comment lives ("Folie 3", "Zwischen Folie 3 und 4"). */

export const slideLabel = (index: number) => `Folie ${index + 1}`;

/**
 * `indexOf` maps a slide id to its 0-based index. Gaps at the very start/end of the deck are
 * described relative to their single neighbour.
 */
export function gapLabel(
  anchor: Extract<Anchor, { type: 'gap' }>,
  indexOf: (slideId: string) => number | undefined,
): string {
  const after = anchor.afterSlideId ? indexOf(anchor.afterSlideId) : undefined;
  const before = anchor.beforeSlideId ? indexOf(anchor.beforeSlideId) : undefined;
  if (after !== undefined && before !== undefined)
    return `Zwischen Folie ${after + 1} und ${before + 1}`;
  if (after !== undefined) return `Nach Folie ${after + 1}`;
  if (before !== undefined) return `Vor Folie ${before + 1}`;
  return 'Zwischen Folien';
}

export function locationLabel(
  anchor: Anchor,
  slideId: string | null,
  indexOf: (slideId: string) => number | undefined,
): string {
  if (anchor.type === 'gap') return gapLabel(anchor, indexOf);
  const index = slideId ? indexOf(slideId) : undefined;
  return index === undefined ? 'Folie' : slideLabel(index);
}

const excerpt = (body: string) => (body.length > 60 ? `${body.slice(0, 57)}…` : body);

/** The app an imported comment comes from ("aus PowerPoint"); `null` for comments made here. */
export const sourceApp = (source: CommentSource): string | null =>
  source === 'pptx' ? 'PowerPoint' : source === 'gslides' ? 'Google Präsentationen' : null;

/** The file an imported comment's replies never reach ("die PowerPoint-Datei"). */
export const sourceFile = (source: CommentSource) =>
  source === 'gslides' ? 'die Google-Präsentation' : 'die PowerPoint-Datei';

/** "In PowerPoint entfernt": the comment was deleted where it came from (BER-114). */
export const removedInSourceLabel = (source: CommentSource) =>
  `In ${sourceApp(source) ?? 'der Quelle'} entfernt`;

/** Accessible name of a comment's mark on the slide. */
export const markLabel = (comment: Pick<Comment, 'author' | 'body'>) =>
  `Kommentar von ${comment.author.name}${comment.body ? `: ${excerpt(comment.body)}` : ''}`;
