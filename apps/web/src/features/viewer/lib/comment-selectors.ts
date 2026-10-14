import {
  isPathStroke,
  isTextStroke,
  resolveRectAnchor,
  resolveShapeRef,
  type Anchor,
  type Author,
  type Comment,
  type Point,
  type Rect,
  type Shape,
  type Slide,
} from '@slider/shared';
import { STROKE_STYLE, strokeOutline, strokesBounds, textBox } from './stroke-path';

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
 * Where a comment sits on its slide, in normalised coordinates. Point and box anchors follow
 * their shape while it exists (BER-111); stroke-only comments use the bounds of their strokes.
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
      return anchor.shapeRef
        ? resolveRectAnchor(shapes, anchor.rect, anchor.shapeRef)
        : anchor.rect;
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
  /** Start point when the line leaves downwards: the middle of the mark's bottom. */
  bottom: Point;
  /** Extra screen pixels outwards from the start: the pin's radius, half a stroke width. */
  inset: { left: number; right: number; bottom: number };
}

/** Radius of a pin (PowerPoint ones too: their "P" badge sits beside the dot), in px. */
const PIN_RADIUS = 7;

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
    const { x, y, w, h } = anchorRect(comment, shapes) ?? anchor.rect;
    const mid = y + h / 2;
    return {
      left: x,
      right: x + w,
      start: { left: { x, y: mid }, right: { x: x + w, y: mid } },
      bottom: { x: x + w / 2, y: y + h },
      inset: { left: 0, right: 0, bottom: 0 },
    };
  }
  if (strokes.length > 0) {
    let left: { point: Point; pad: number } | null = null;
    let right: { point: Point; pad: number } | null = null;
    let bottom: { point: Point; pad: number } | null = null;
    for (const stroke of strokes) {
      const pad = stroke.tool === 'text' ? 0 : STROKE_STYLE[stroke.tool].width / 2;
      for (const point of strokeOutline(stroke)) {
        if (!left || point.x < left.point.x) left = { point, pad };
        if (!right || point.x > right.point.x) right = { point, pad };
        if (!bottom || point.y > bottom.point.y) bottom = { point, pad };
      }
    }
    if (left && right && bottom)
      return {
        left: left.point.x,
        right: right.point.x,
        start: { left: left.point, right: right.point },
        bottom: bottom.point,
        inset: { left: left.pad, right: right.pad, bottom: bottom.pad },
      };
  }
  if (anchor.type !== 'point') return null;
  const rect = anchorRect(comment, shapes)!;
  const point = { x: rect.x, y: rect.y };
  return {
    left: point.x,
    right: point.x,
    start: { left: point, right: point },
    bottom: point,
    inset: { left: PIN_RADIUS, right: PIN_RADIUS, bottom: PIN_RADIUS },
  };
}

/** Exit side of a connector: the nearer vertical slide edge, ties go left. */
export const connectorSide = (anchor: Pick<ConnectorAnchor, 'left' | 'right'>) =>
  anchor.left <= 1 - anchor.right ? ('left' as const) : ('right' as const);

/** Where a connector line leaves its mark: sideways to a slide edge, or straight down. */
export type ConnectorExit = 'left' | 'right' | 'down';

/**
 * Exits for the marks of one slide (`aspectRatio` = width / height): straight down when the
 * slide's bottom edge is nearer than its side edge, else sideways. A drop never cuts through a
 * sideways start: a mark below it that leaves sideways is even nearer its edge, so it starts
 * outside the drop. Without an aspect ratio every line leaves sideways.
 */
export function connectorExits(
  anchors: readonly (ConnectorAnchor | null)[],
  aspectRatio?: number,
): (ConnectorExit | null)[] {
  return anchors.map((anchor) => {
    if (!anchor) return null;
    const side = connectorSide(anchor);
    if (aspectRatio === undefined) return side;
    // In slide heights, so both distances are on the same scale.
    const toSide = (side === 'left' ? anchor.left : 1 - anchor.right) * aspectRatio;
    return 1 - anchor.bottom.y < toSide ? 'down' : side;
  });
}

/**
 * Card order for the active slide (B1): clockwise around the slide – lines leaving to the left
 * from top to bottom, lines leaving downwards from left to right, then lines leaving to the right
 * from bottom to top, then comments without a line. Lanes and cards then follow the same order
 * and the lines don't cross.
 */
export function sortThreadsClockwise(
  threads: readonly Thread[],
  shapes: readonly Shape[],
  aspectRatio?: number,
): Thread[] {
  const anchors = threads.map((thread) => connectorAnchor(thread.root, shapes));
  const exits = connectorExits(anchors, aspectRatio);
  const keyed = threads.map((thread, index) => {
    const anchor = anchors[index];
    const exit = exits[index];
    if (!anchor || !exit) return { thread, group: 3, key: index };
    if (exit === 'down') return { thread, group: 1, key: anchor.bottom.x };
    const y = anchor.start[exit].y;
    return exit === 'left' ? { thread, group: 0, key: y } : { thread, group: 2, key: -y };
  });
  return keyed.sort((a, b) => a.group - b.group || a.key - b.key).map(({ thread }) => thread);
}

/** Number of threads whose line leaves the slide to the left – the head of the clockwise order. */
export const countLeftExits = (
  threads: readonly Thread[],
  shapes: readonly Shape[],
  aspectRatio?: number,
) =>
  connectorExits(
    threads.map((thread) => connectorAnchor(thread.root, shapes)),
    aspectRatio,
  ).filter((exit) => exit === 'left').length;

export const rectsMatch = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.w - b.w) < 1e-6 &&
  Math.abs(a.h - b.h) < 1e-6;

/**
 * The rect anchor only repeats what is drawn – a text box or the bounds of the drawing – so no
 * extra frame is drawn around it: the text box or drawing is the mark itself.
 */
export function isImplicitFrame(comment: Pick<Comment, 'anchor' | 'strokes'>): boolean {
  const { anchor, strokes } = comment;
  if (anchor.type !== 'rect' || strokes.length === 0) return false;
  if (strokes.some((stroke) => stroke.tool === 'text' && rectsMatch(textBox(stroke), anchor.rect)))
    return true;
  // Drawn without a box (freehand, arrow, marker, shapes): the box is the drawing's own bounds.
  const bounds = strokesBounds(strokes);
  return bounds !== null && rectsMatch(bounds, anchor.rect);
}

/** The text written on the slide, if the comment has one ("Text auf Folie"). */
export const textAnnotation = (comment: Pick<Comment, 'strokes'>) =>
  comment.strokes.find(isTextStroke) ?? null;

/** True when the body only consists of a drawing (shown as "✏️ Markierung"). */
export const isStrokeOnly = (comment: Comment) =>
  comment.body.trim() === '' && comment.strokes.length > 0;

/**
 * A drawing made without a comment: lines only, no text, recording or replies. It stays on the
 * slide but gets no card or connector line – a click on it opens the thread panel.
 */
export const isBareDrawing = ({ root, replies }: Thread) =>
  replies.length === 0 &&
  !root.media &&
  root.body.trim() === '' &&
  root.strokes.length > 0 &&
  root.strokes.every(isPathStroke);

/** Stand-in for an empty body: the text on the slide, if any, else "✏️ Markierung". */
export const strokeOnlyLabel = (comment: Pick<Comment, 'strokes'>) => {
  const text = textAnnotation(comment);
  return text ? `„${text.text}“` : '✏️ Markierung';
};

const MEDIA_ICONS = { audio: '🎙', video: '🎬' } as const;
const MEDIA_NOUNS = { audio: 'Sprachkommentar', video: 'Videokommentar' } as const;

const formatClock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * One line of text for a comment in tight spots (compact cards, tooltips): the body, else the
 * transcript or "🎙 Sprachkommentar · 0:42" for recordings, else the drawing label.
 */
export function commentPreview(comment: Comment): string {
  if (comment.body.trim()) return comment.body;
  const { media } = comment;
  if (media) {
    const icon = MEDIA_ICONS[media.kind];
    return media.transcript
      ? `${icon} ${media.transcript}`
      : `${icon} ${MEDIA_NOUNS[media.kind]} · ${formatClock(media.durationMs)}`;
  }
  return isStrokeOnly(comment) ? strokeOnlyLabel(comment) : comment.body;
}

/** An imported PowerPoint comment that was deleted in the file – kept, but shown muted (BER-114). */
export const isRemovedInPowerPoint = (comment: Pick<Comment, 'sourceStatus'>) =>
  comment.sourceStatus === 'removed_in_pptx';
