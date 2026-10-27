import { searchFold, type Shape, type Slide } from '@slider/shared';
import { placeGap, type Thread } from '../../comments/lib/comment-selectors';

/**
 * One place the in-review search (BER-176) found the query: the title or a box of a slide of
 * the current version, or a comment or reply. `key` stays the same across refetches, so the
 * current hit survives polling.
 */
export type FindHit =
  | {
      kind: 'slide';
      key: string;
      slideId: string;
      /** The box the text is in; `null` for a hit in the slide's title alone. */
      shape: Shape | null;
    }
  | {
      kind: 'comment';
      key: string;
      threadId: string;
      commentId: string;
      /** The slide the thread belongs to, if it is shown – `null` between slides or gone. */
      slideId: string | null;
    };

/** What is searched: the slides as the viewer shows them and every thread of the deck. */
export interface FindSource {
  slides: readonly Slide[];
  slideIndex: ReadonlyMap<string, number>;
  threads: readonly Thread[];
}

/** The form query and text are compared in: folded (case, accents), whitespace collapsed. */
const normalize = (text: string): string => searchFold(text.replace(/\s+/g, ' ').trim());

/** A blank query finds nothing. */
export const findNeedle = (query: string): string => normalize(query);

/** "3 von 12", "Keine Treffer" – nothing while the field is blank. */
export function findCounter(query: string, hits: readonly FindHit[], index: number): string {
  if (!findNeedle(query)) return '';
  if (hits.length === 0) return 'Keine Treffer';
  return index < 0 ? `${hits.length} Treffer` : `${index + 1} von ${hits.length}`;
}

/** Per slide: its text first, then its comments, then those in the gap after it. */
const SLIDE_TEXT = 0;
const SLIDE_COMMENTS = 1;
const GAP_AFTER = 2;
const STEPS = 3;

/**
 * Every hit of `query` in reading order: slide by slide, a slide's boxes (top to bottom, left to
 * right) before its comments, comments between slides after the slide before them (in front of
 * the first slide: first of all), comments on slides that are not shown (hidden, deleted) last.
 * A box, the title or a comment counts once, however often the text is in it. The title only
 * counts when none of the slide's boxes matched – it is usually one of them.
 */
export function findHits(query: string, { slides, slideIndex, threads }: FindSource): FindHit[] {
  const needle = findNeedle(query);
  if (!needle) return [];
  const matches = (text: string | null) => text !== null && normalize(text).includes(needle);
  const ranked: { rank: number; hit: FindHit }[] = [];

  slides.forEach((slide, index) => {
    const rank = (index + 1) * STEPS + SLIDE_TEXT;
    const shapes = slide.shapes
      .filter((shape) => matches(shape.text))
      .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    for (const shape of shapes)
      ranked.push({
        rank,
        hit: { kind: 'slide', key: `slide:${slide.id}:${shape.id}`, slideId: slide.id, shape },
      });
    if (shapes.length === 0 && matches(slide.title))
      ranked.push({
        rank,
        hit: { kind: 'slide', key: `slide:${slide.id}:title`, slideId: slide.id, shape: null },
      });
  });

  for (const thread of threads) {
    const { rank, slideId } = threadPlace(thread, slides, slideIndex);
    for (const comment of [thread.root, ...thread.replies]) {
      if (!matches(comment.body)) continue;
      ranked.push({
        rank,
        hit: {
          kind: 'comment',
          key: `comment:${comment.id}`,
          threadId: thread.id,
          commentId: comment.id,
          slideId,
        },
      });
    }
  }

  // Stable: within a rank, boxes keep their order and threads theirs (oldest first).
  return ranked.sort((a, b) => a.rank - b.rank).map(({ hit }) => hit);
}

/** Where a thread's hits go in reading order, and the shown slide it belongs to. */
function threadPlace(
  { root }: Thread,
  slides: readonly Slide[],
  slideIndex: ReadonlyMap<string, number>,
): { rank: number; slideId: string | null } {
  if (root.anchor.type === 'gap') {
    const gap = placeGap(root.anchor, slides, slideIndex);
    if (!gap) return { rank: Infinity, slideId: null };
    // In front of the first slide: before everything (rank of a "slide −1" gap).
    const after = gap.afterSlideId === null ? -1 : slideIndex.get(gap.afterSlideId)!;
    return { rank: (after + 1) * STEPS + GAP_AFTER, slideId: null };
  }
  const index = root.slideId === null ? undefined : slideIndex.get(root.slideId);
  if (index === undefined) return { rank: Infinity, slideId: null };
  return { rank: (index + 1) * STEPS + SLIDE_COMMENTS, slideId: root.slideId };
}
