import {
  anchorBoxes,
  commentWords,
  hitTestShapes,
  isPathStroke,
  isTextStroke,
  type Anchor,
  type PathStroke,
  type Rect,
  type Shape,
  type Slide,
  type Stroke,
} from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { hereLink, hereQuote, useCallHere } from '@/lib/call-here';
import { locateCursor } from '../live/lib/cursor-anchor';
import { useEditing } from '../editing/editing-context';
import type { Thread } from '../comments/lib/comment-selectors';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

/** Of a slide's text the agent hears this much – enough for „was steht da?“. */
const SLIDE_TEXT = 900;
/** A shape covered this much by a box or circle counts as marked. */
const MARKED_COVER = 0.5;
/** An arrow's tip this close to a shape (of the slide's width) points at it. */
const TIP_NEAR = 0.08;
/** One's drawings since the page opened count as „das hier“ once their tool is put away. */
const OPENED = Date.now();

const TOOL_WORDS: Record<string, string> = {
  pen: 'gezeichnet',
  arrow: 'Pfeil',
  highlighter: 'Textmarker',
  rect: 'Rechteck',
  ellipse: 'Kreis',
};

/**
 * What Slider shows its person, told to the agent of their call with each turn (`callHere`): the
 * presentation and slide in front, its text, the element picked, what a comment being written
 * marks – an arrow's tip, a box or circle round shapes – and the comment open beside it.
 */
export function SliderHere() {
  const { deck, slides, fileIndex, threads, threadById, viewer } = useViewerData();
  const { activeSlideId, draft, lastDrawing, focusedThreadId } = useViewerState();
  const { selection } = useEditing();
  const pointed = usePointedShape(slides, activeSlideId);
  const index = slides.findIndex((slide) => slide.id === activeSlideId);
  const slide = slides[index];
  // Hidden slides out of sight: the number the file (and the agents' tools) give it beside.
  const inFile = (id: string, shown: number) => {
    const at = fileIndex.get(id);
    return at === undefined || at === shown ? '' : ` (in der Datei Folie ${at + 1})`;
  };
  const lines = [
    `Slider: Präsentation ${hereLink('presentation', deck.id, deck.title)}${
      slide
        ? `, Folie ${index + 1} von ${slides.length}${inFile(slide.id, index)}${
            slide.title ? ` „${slide.title}“` : ''
          }`
        : ''
    }`,
  ];
  if (slide) {
    const text = slide.shapes
      .map((shape) => shape.text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | ');
    if (text) lines.push(`Auf der Folie: ${hereQuote(text, SLIDE_TEXT)}`);
  }
  const slideOf = (id: string | null) => slides.find((each) => each.id === id);
  if (selection) {
    const shape = slideOf(selection.slideId)?.shapes.find(
      (each) => each.id === selection.elementId,
    );
    if (shape) lines.push(`Ausgewählt: ${shapeWords(shape)}`);
  }
  // What one is commenting on or just drew: a draft's mark, the drawing the pen, arrow or marker
  // still picked just made – else one's latest bare drawing since the page opened.
  const mark =
    (draft?.slideId ? draft : null) ?? lastDrawing ?? latestDrawing(threads, viewer.author.id);
  const markedOn = mark?.slideId ? slideOf(mark.slideId) : undefined;
  if (mark && markedOn) {
    const marks = markWords(mark.strokes);
    const shapes = markedShapes(markedOn, mark.anchor, mark.strokes);
    const at = slides.indexOf(markedOn);
    const where = markedOn.id === slide?.id ? '' : ` auf Folie ${at + 1}${inFile(markedOn.id, at)}`;
    lines.push(
      `Markiert${mark === draft ? ' für einen Kommentar' : ''}${where}${marks ? ` (${marks})` : ''}: ${
        shapes.length > 0 ? shapes.map(shapeWords).join(', ') : 'eine Stelle ohne Text'
      }`,
    );
  }
  // „Das hier“ said while pointing: the shape the pointer is on, or was on last (gone to speak).
  const pointedShape = pointed
    ? slideOf(pointed.slideId)?.shapes.find((each) => each.id === pointed.shapeId)
    : undefined;
  if (pointedShape && pointedShape.id !== selection?.elementId) {
    const at = slides.findIndex((each) => each.id === pointed?.slideId);
    const where =
      pointed?.slideId === slide?.id ? '' : ` auf Folie ${at + 1}${inFile(pointed!.slideId, at)}`;
    lines.push(`Mit dem Zeiger gezeigt${where}: ${shapeWords(pointedShape)}`);
  }
  // The open thread: whose it is and what it marks – never its words (another's message would
  // reach orders as one's own; one's own draft goes with `Composer`).
  const thread = focusedThreadId ? threadById.get(focusedThreadId) : undefined;
  if (thread) {
    const on = slideOf(thread.root.slideId);
    const shapes = on ? markedShapes(on, thread.root.anchor, thread.root.strokes) : [];
    lines.push(
      `Offener Kommentar von ${thread.root.author.name}${
        shapes.length > 0 ? ` zu ${shapes.map(shapeWords).join(', ')}` : ''
      }${thread.replies.length > 0 ? ` (${thread.replies.length} Antworten)` : ''}`,
    );
  }
  useCallHere('slider', lines.join('\n'));
  return null;
}

/**
 * The shape the pointer is on – kept when it leaves the slides (to the panel, to speak), let go
 * over a slide's empty room and when another slide comes in front. Set only when it changes.
 */
function usePointedShape(slides: readonly Slide[], activeSlideId: string | null) {
  const [pointed, setPointed] = useState<{ slideId: string; shapeId: string } | null>(null);
  // Another slide in front: what was pointed at on the last one is not „das hier“ any more.
  const [shownSlide, setShownSlide] = useState(activeSlideId);
  if (shownSlide !== activeSlideId) {
    setShownSlide(activeSlideId);
    setPointed(null);
  }
  const latest = useRef(slides);
  useEffect(() => {
    latest.current = slides;
  });
  useEffect(() => {
    let frame = 0;
    let at: { x: number; y: number } | null = null;
    const look = () => {
      frame = 0;
      if (!at) return;
      const cursor = locateCursor(document.elementFromPoint(at.x, at.y), at.x, at.y);
      if (!cursor) return;
      const slide = latest.current.find((each) => each.id === cursor.slideId);
      const shape = slide ? hitTestShapes(slide.shapes, cursor.point, slide.aspectRatio) : null;
      setPointed((now) =>
        shape
          ? now?.slideId === cursor.slideId && now.shapeId === shape.id
            ? now
            : { slideId: cursor.slideId, shapeId: shape.id }
          : null,
      );
    };
    const onMove = (event: PointerEvent) => {
      at = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(look);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return pointed;
}

/** One's latest drawing without words since the page opened – a circle, an arrow, a stroke. */
function latestDrawing(
  threads: readonly Thread[],
  authorId: string,
): { slideId: string | null; anchor: Anchor; strokes: Stroke[] } | null {
  let latest: Thread['root'] | null = null;
  for (const { root } of threads) {
    if (root.author.id !== authorId || !root.strokes.some(isPathStroke)) continue;
    if (commentWords(root) || Date.parse(root.createdAt) < OPENED) continue;
    if (!latest || root.createdAt > latest.createdAt) latest = root;
  }
  return latest;
}

const shapeWords = (shape: Shape) =>
  shape.text.trim() ? hereQuote(shape.text, 200) : `ein Element ohne Text („${shape.name}“)`;

function markWords(strokes: readonly Stroke[]): string {
  const words = new Set<string>();
  for (const stroke of strokes) {
    if (isTextStroke(stroke)) words.add(`dazugeschrieben ${hereQuote(stroke.text, 120)}`);
    else words.add(TOOL_WORDS[stroke.tool] ?? stroke.tool);
  }
  return [...words].join(', ');
}

/**
 * The shapes a mark means: where its arrows point; else those its boxes (a frame, a circle, a
 * drawing's bounds) cover for the most part, or the one under its point.
 */
function markedShapes(
  slide: Pick<Slide, 'shapes' | 'aspectRatio'>,
  anchor: Anchor,
  strokes: readonly Stroke[],
): Shape[] {
  const found = new Set<Shape>();
  const arrows = strokes.filter(
    (stroke) => isPathStroke(stroke) && stroke.tool === 'arrow',
  ) as PathStroke[];
  for (const arrow of arrows) {
    const tip = arrow.points.at(-1);
    const shape = tip
      ? (hitTestShapes(slide.shapes, tip, slide.aspectRatio) ?? nearest(slide.shapes, tip))
      : null;
    if (shape) found.add(shape);
  }
  // Arrows point: what lies under their length is not meant.
  if (arrows.length > 0) return [...found];
  if (anchor.type === 'point') {
    const shape = hitTestShapes(slide.shapes, anchor.point, slide.aspectRatio);
    return shape ? [shape] : [];
  }
  for (const { rect } of anchorBoxes(anchor)) {
    for (const shape of slide.shapes) if (cover(shape.bbox, rect) >= MARKED_COVER) found.add(shape);
  }
  if (found.size === 0) {
    // A small mark inside one shape (a word circled): the shape it lies in.
    for (const { rect } of anchorBoxes(anchor)) {
      const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      const shape = hitTestShapes(slide.shapes, centre, slide.aspectRatio);
      if (shape) found.add(shape);
    }
  }
  return [...found];
}

/** The shape closest to a point, if one is within {@link TIP_NEAR}. */
function nearest(shapes: readonly Shape[], point: { x: number; y: number }): Shape | null {
  let best: Shape | null = null;
  let bestGap = TIP_NEAR;
  for (const shape of shapes) {
    const { x, y, w, h } = shape.bbox;
    const gap = Math.hypot(
      Math.max(x - point.x, 0, point.x - (x + w)),
      Math.max(y - point.y, 0, point.y - (y + h)),
    );
    if (gap <= bestGap) {
      best = shape;
      bestGap = gap;
    }
  }
  return best;
}

/** How much of `box` lies inside `rect`. */
function cover(box: Rect, rect: Rect): number {
  const w = Math.min(box.x + box.w, rect.x + rect.w) - Math.max(box.x, rect.x);
  const h = Math.min(box.y + box.h, rect.y + rect.h) - Math.max(box.y, rect.y);
  if (w <= 0 || h <= 0 || box.w <= 0 || box.h <= 0) return 0;
  return (w * h) / (box.w * box.h);
}
