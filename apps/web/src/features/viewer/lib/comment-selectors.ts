import {
  isTextStroke,
  resolveShapeRef,
  type Anchor,
  type Author,
  type Comment,
  type Point,
  type Rect,
  type Shape,
  type Slide,
} from '@slider/shared';
import { isShapeTool, STROKE_STYLE, strokeOutline, strokesBounds, textBox } from './stroke-path';

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
 * Threads that are listed on the current slides – i.e. without those on slides a later
 * revision deleted (they live in "Gelöschte Folien"). Threads without a slide stay.
 */
export function threadsOnCurrentSlides(
  threads: readonly Thread[],
  slideIds: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): Thread[] {
  return threads.filter((thread) => {
    const slideId = homeSlideId(thread.root, null);
    return slideId === null || slideIds.has(slideId);
  });
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

/** Where a connector line leaves its mark – normalised slide coordinates (B1). */
export interface ConnectorAnchor {
  /** Horizontal extent of the mark; the line exits towards the nearer slide edge. */
  left: number;
  right: number;
  /** Start point per exit side. */
  start: { left: Point; right: Point };
  /** Extra screen pixels outwards from the start: the pin's radius, half a stroke width. */
  inset: { left: number; right: number };
}

/** Radius of an accent pin and half the PowerPoint "P" square (incl. its ring), in px. */
const PIN_RADIUS = 7;
const POWERPOINT_PIN_RADIUS = 12;

/**
 * Start of the connector line for a comment: the edge of its pin, the middle of its frame's
 * left / right edge, or – for drawings – the drawing's outermost point (an arrow's tail, a
 * circle's side). `null` for gap comments and slide-level comments without a drawing.
 */
export function connectorAnchor(
  comment: Pick<Comment, 'anchor' | 'strokes' | 'source'>,
  shapes: readonly Shape[],
): ConnectorAnchor | null {
  const { anchor, strokes } = comment;
  if (anchor.type === 'rect') {
    const { x, y, w, h } = anchor.rect;
    const mid = y + h / 2;
    return {
      left: x,
      right: x + w,
      start: { left: { x, y: mid }, right: { x: x + w, y: mid } },
      inset: { left: 0, right: 0 },
    };
  }
  if (strokes.length > 0) {
    let left: { point: Point; pad: number } | null = null;
    let right: { point: Point; pad: number } | null = null;
    for (const stroke of strokes) {
      const pad = stroke.tool === 'text' ? 0 : STROKE_STYLE[stroke.tool].width / 2;
      for (const point of strokeOutline(stroke)) {
        if (!left || point.x < left.point.x) left = { point, pad };
        if (!right || point.x > right.point.x) right = { point, pad };
      }
    }
    if (left && right)
      return {
        left: left.point.x,
        right: right.point.x,
        start: { left: left.point, right: right.point },
        inset: { left: left.pad, right: right.pad },
      };
  }
  if (anchor.type !== 'point') return null;
  const rect = anchorRect(comment, shapes)!;
  const point = { x: rect.x, y: rect.y };
  const radius = comment.source === 'pptx' ? POWERPOINT_PIN_RADIUS : PIN_RADIUS;
  return {
    left: point.x,
    right: point.x,
    start: { left: point, right: point },
    inset: { left: radius, right: radius },
  };
}

/** Exit side of a connector: the nearer vertical slide edge, ties go left. */
export const connectorSide = (anchor: Pick<ConnectorAnchor, 'left' | 'right'>) =>
  anchor.left <= 1 - anchor.right ? ('left' as const) : ('right' as const);

/**
 * Card order for the active slide (B1): clockwise around the slide – lines leaving to the left
 * from top to bottom, then lines leaving to the right from bottom to top, then comments without
 * a line. Lanes and cards then follow the same order and the lines don't cross.
 */
export function sortThreadsClockwise(
  threads: readonly Thread[],
  shapes: readonly Shape[],
): Thread[] {
  const keyed = threads.map((thread, index) => {
    const anchor = connectorAnchor(thread.root, shapes);
    if (!anchor) return { thread, group: 2, key: index };
    const side = connectorSide(anchor);
    const y = anchor.start[side].y;
    return side === 'left' ? { thread, group: 0, key: y } : { thread, group: 1, key: -y };
  });
  return keyed.sort((a, b) => a.group - b.group || a.key - b.key).map(({ thread }) => thread);
}

/** Number of threads whose line leaves the slide to the left – the head of the clockwise order. */
export const countLeftExits = (threads: readonly Thread[], shapes: readonly Shape[]) =>
  threads.filter((thread) => {
    const anchor = connectorAnchor(thread.root, shapes);
    return anchor !== null && connectorSide(anchor) === 'left';
  }).length;

const rectsMatch = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.w - b.w) < 1e-6 &&
  Math.abs(a.h - b.h) < 1e-6;

/**
 * The rect anchor only repeats what is drawn – a text box or the bounds of shapes – so no extra
 * frame is drawn around it: the text box or shape is the mark itself.
 */
export function isImplicitFrame(comment: Pick<Comment, 'anchor' | 'strokes'>): boolean {
  const { anchor, strokes } = comment;
  if (anchor.type !== 'rect' || strokes.length === 0) return false;
  if (strokes.some((stroke) => stroke.tool === 'text' && rectsMatch(textBox(stroke), anchor.rect)))
    return true;
  const bounds = strokesBounds(strokes);
  return (
    bounds !== null &&
    strokes.some((stroke) => stroke.tool === 'text' || isShapeTool(stroke.tool)) &&
    rectsMatch(bounds, anchor.rect)
  );
}

/** The text written on the slide, if the comment has one ("Text auf Folie"). */
export const textAnnotation = (comment: Pick<Comment, 'strokes'>) =>
  comment.strokes.find(isTextStroke) ?? null;

/** True when the body only consists of a drawing (shown as "✏️ Markierung"). */
export const isStrokeOnly = (comment: Comment) =>
  comment.body.trim() === '' && comment.strokes.length > 0;

/** An imported PowerPoint comment that was deleted in the file – kept, but shown muted (BER-114). */
export const isRemovedInPowerPoint = (comment: Pick<Comment, 'sourceStatus'>) =>
  comment.sourceStatus === 'removed_in_pptx';
