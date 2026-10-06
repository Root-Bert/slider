import {
  resolveShapeRef,
  type Anchor,
  type Author,
  type Comment,
  type Rect,
  type Shape,
  type Slide,
} from '@slider/shared';
import { strokesBounds } from './stroke-path';

/** A root comment together with its replies – the unit shown as a card and in the thread panel. */
export interface Thread {
  id: string;
  root: Comment;
  /** Oldest first. */
  replies: Comment[];
  /** Distinct reply authors (without the root author), in order of first reply. */
  repliers: Author[];
  /** Distinct authors of the whole thread, root author first. */
  participants: Author[];
  lastActivityAt: string;
}

export type StatusFilter = 'all' | 'open' | 'done';

export interface ThreadFilter {
  status: StatusFilter;
  pptxOnly: boolean;
}

export interface StatusCounts {
  all: number;
  open: number;
  done: number;
}

const byCreatedAt = (a: Comment, b: Comment) => a.createdAt.localeCompare(b.createdAt);

function uniqueAuthors(comments: readonly Comment[]): Author[] {
  const seen = new Map<string, Author>();
  for (const comment of comments)
    if (!seen.has(comment.author.id)) seen.set(comment.author.id, comment.author);
  return [...seen.values()];
}

/** Turns the flat comment list from the API into threads (root + replies), oldest root first. */
export function buildThreads(comments: readonly Comment[]): Thread[] {
  const repliesByParent = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  for (const comment of comments) {
    if (comment.parentId === null) {
      roots.push(comment);
      continue;
    }
    const siblings = repliesByParent.get(comment.parentId) ?? [];
    siblings.push(comment);
    repliesByParent.set(comment.parentId, siblings);
  }

  return roots.sort(byCreatedAt).map((root) => {
    const replies = (repliesByParent.get(root.id) ?? []).sort(byCreatedAt);
    const participants = uniqueAuthors([root, ...replies]);
    const last = replies.at(-1) ?? root;
    return {
      id: root.id,
      root,
      replies,
      repliers: uniqueAuthors(replies).filter((author) => author.id !== root.author.id),
      participants,
      lastActivityAt: last.updatedAt > last.createdAt ? last.updatedAt : last.createdAt,
    };
  });
}

export const isFromPowerPoint = (comment: Comment) => comment.source === 'pptx';

export function matchesFilter(thread: Thread, filter: ThreadFilter): boolean {
  if (filter.pptxOnly && !isFromPowerPoint(thread.root)) return false;
  return filter.status === 'all' || thread.root.status === filter.status;
}

export const filterThreads = (threads: readonly Thread[], filter: ThreadFilter): Thread[] =>
  threads.filter((thread) => matchesFilter(thread, filter));

/** Counts for the Alle / Offen / Erledigt chips; respects the PowerPoint filter but not the status. */
export function countByStatus(threads: readonly Thread[], pptxOnly: boolean): StatusCounts {
  const counts: StatusCounts = { all: 0, open: 0, done: 0 };
  for (const thread of threads) {
    if (pptxOnly && !isFromPowerPoint(thread.root)) continue;
    counts.all += 1;
    counts[thread.root.status] += 1;
  }
  return counts;
}

/**
 * The slide a thread is listed under. Gap comments belong to the slide *before* the gap
 * (or the first slide when the gap is in front of it).
 */
export function homeSlideId(comment: Comment, firstSlideId: string | null): string | null {
  if (comment.anchor.type !== 'gap') return comment.slideId;
  return comment.anchor.afterSlideId ?? comment.anchor.beforeSlideId ?? firstSlideId;
}

/** Threads per slide id, in thread order. Every slide gets an entry (possibly empty). */
export function groupThreadsBySlide(
  threads: readonly Thread[],
  slides: readonly Slide[],
): Map<string, Thread[]> {
  const groups = new Map<string, Thread[]>(slides.map((slide) => [slide.id, []]));
  const firstSlideId = slides[0]?.id ?? null;
  for (const thread of threads) {
    const slideId = homeSlideId(thread.root, firstSlideId);
    if (slideId) groups.get(slideId)?.push(thread);
  }
  return groups;
}

/** Key for a gap between two slides; `null` sides mean "before the first" / "after the last" slide. */
export const gapKey = (afterSlideId: string | null, beforeSlideId: string | null) =>
  `${afterSlideId ?? 'start'}→${beforeSlideId ?? 'end'}`;

/** Open gap threads per gap (BER-103) – used for markers on the stage and in the filmstrip. */
export function gapThreadsByGap(threads: readonly Thread[]): Map<string, Thread[]> {
  const groups = new Map<string, Thread[]>();
  for (const thread of threads) {
    const { anchor } = thread.root;
    if (anchor.type !== 'gap') continue;
    const key = gapKey(anchor.afterSlideId, anchor.beforeSlideId);
    groups.set(key, [...(groups.get(key) ?? []), thread]);
  }
  return groups;
}

/**
 * Where a comment sits on its slide, in normalised coordinates. Point anchors follow their shape
 * when it still exists; stroke-only comments use the bounds of their strokes.
 * `null` for slide-level and gap comments.
 */
export function anchorRect(
  comment: Pick<Comment, 'anchor' | 'strokes'>,
  shapes: readonly Shape[],
): Rect | null {
  const { anchor } = comment;
  switch (anchor.type) {
    case 'point': {
      const point = (anchor.shapeRef && resolveShapeRef(shapes, anchor.shapeRef)) ?? anchor.point;
      return { x: point.x, y: point.y, w: 0, h: 0 };
    }
    case 'rect':
      return anchor.rect;
    case 'slide':
      return comment.strokes.length > 0 ? strokesBounds(comment.strokes) : null;
    case 'gap':
      return null;
  }
}

export const isOnSlideAnchor = (anchor: Anchor) =>
  anchor.type === 'point' || anchor.type === 'rect';

/** Left-to-right order of the anchors, so cards line up under their marks and lines cross less. */
export function sortThreadsByAnchor(
  threads: readonly Thread[],
  shapes: readonly Shape[],
): Thread[] {
  const keyOf = (thread: Thread) => {
    const rect = anchorRect(thread.root, shapes);
    return rect ? rect.x + rect.w / 2 : Number.POSITIVE_INFINITY;
  };
  return threads
    .map((thread) => ({ thread, key: keyOf(thread) }))
    .sort((a, b) => a.key - b.key)
    .map(({ thread }) => thread);
}

/** True when the body only consists of a drawing (shown as "✏️ Markierung"). */
export const isStrokeOnly = (comment: Comment) =>
  comment.body.trim() === '' && comment.strokes.length > 0;
