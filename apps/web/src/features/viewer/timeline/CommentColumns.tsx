import type { Slide } from '@slider/shared';
import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pluralize } from '@/lib/format';
import { CountBubble } from '@/ui';
import { threadsOf, useCommentThreads } from '../comments/hooks/useCommentThreads';
import { afterCommit } from '@/lib/dom';
import { prefersReducedMotion } from '@/lib/motion';
import { followConnectors } from '../connectors/hooks/useConnectorLayout';
import { bandCapacity, brickLayout, planBands } from '../connectors/lib/card-layout';
import {
  countLeftExits,
  gapKey,
  sortThreadsByAnchor,
  sortThreadsClockwise,
  type Thread,
} from '../comments/lib/comment-selectors';
import { gapLabel, slideLabel } from '../comments/lib/labels';
import {
  busRoom,
  cardMode,
  slideHeightAt,
  splitForWidth,
  type TrackLayout,
} from './lib/timeline-layout';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { CommentBubble } from '../comments/CommentBubble';
import { CommentCard, type CardEmphasis } from '../comments/CommentCard';
import { CompactCard } from '../comments/CompactCard';
import { useTimeline } from './timeline-context';

/** Clicking a bubble grows the slides until the column is this wide (full cards). */
const BUBBLE_TARGET_W = 300;
/** More lines than this share the bus room by squeezing the rows. */
const BUS_ROOM_MAX_LINES = 8;
/** Top padding of the columns on phones (no connector lines there). */
const NARROW_PAD = 16;

interface CommentColumnsProps {
  layout: TrackLayout;
  range: { first: number; last: number };
  narrow: boolean;
}

/**
 * The comment area: below every slide a column exactly as wide as the slide, holding that
 * slide's comments – full cards (B1/B3), compact cards or one bubble, depending on the width.
 * Gap comments sit in a column under their ⊕ divider. All columns share one grid cell, so the
 * area is as tall as the tallest column without measuring; columns never overlap because slides
 * and gaps don't.
 */
export function CommentColumns({ layout, range, narrow }: CommentColumnsProps) {
  const { slides } = useViewerData();
  const { bySlide, byGap } = useCommentThreads();

  // Same bus room for every column and slide size: cards don't jump when lines appear or the split moves.
  const padTop = useMemo(() => {
    if (narrow) return NARROW_PAD;
    let lines = 1;
    for (const list of bySlide.values()) lines = Math.max(lines, list.length);
    return busRoom(Math.min(lines, BUS_ROOM_MAX_LINES));
  }, [bySlide, narrow]);

  const columns: ReactNode[] = [];
  for (let index = range.first; index <= range.last; index++) {
    const slide = slides[index];
    const box = layout.slides[index];
    const gap = layout.gaps[index];
    if (!slide || !box || !gap) continue;
    const threads = threadsOf(bySlide, slide.id);
    columns.push(
      <SlideColumn
        key={slide.id}
        slide={slide}
        index={index}
        x={box.x}
        width={box.w}
        padTop={padTop}
        threads={threads}
        narrow={narrow}
      />,
    );
    const key = gapKey(slide.id, slides[index + 1]?.id ?? null);
    const gapThreads = byGap.get(key);
    if (gapThreads)
      columns.push(
        <GapColumn
          key={key}
          gapKey={key}
          x={gap.x}
          width={gap.w}
          padTop={padTop}
          threads={gapThreads}
        />,
      );
  }

  return (
    <section
      data-comment-area
      aria-label="Kommentare"
      // Own stacking context: raised (hovered) cards stay below the sticky header. Only a small
      // margin below the cards: the area scrolls vertically only once the comments overflow.
      className="relative isolate grid items-start pb-6"
      style={{ width: layout.contentW, gridTemplateColumns: '100%' }}
    >
      {columns}
    </section>
  );
}

interface SlideColumnProps {
  slide: Slide;
  index: number;
  x: number;
  width: number;
  padTop: number;
  threads: Thread[];
  narrow: boolean;
}

const SlideColumn = memo(function SlideColumn({
  slide,
  index,
  x,
  width,
  padTop,
  threads,
  narrow,
}: SlideColumnProps) {
  const mode = narrow ? 'full' : cardMode(width);
  const sorted = useMemo(
    () => sortThreadsClockwise(threads, slide.shapes, slide.aspectRatio),
    [threads, slide.shapes, slide.aspectRatio],
  );
  const leftCount = useMemo(
    () => countLeftExits(threads, slide.shapes, slide.aspectRatio),
    [threads, slide.shapes, slide.aspectRatio],
  );

  let content: ReactNode = null;
  if (threads.length > 0) {
    if (narrow) content = <StackedCards slide={slide} threads={threads} />;
    else if (mode === 'bubble')
      content = <SlideBubble slide={slide} index={index} threads={threads} width={width} />;
    else
      content = (
        <BrickCards
          threads={sorted}
          leftCount={leftCount}
          width={width}
          compact={mode === 'compact'}
        />
      );
  }

  return (
    <div
      data-column={slide.id}
      data-mode={mode}
      className="min-w-0"
      style={{ gridArea: '1 / 1', marginLeft: x, width, paddingTop: padTop }}
    >
      {content}
    </div>
  );
});

/** Bubble mode: clicking activates the slide and grows the slides until its cards fit. */
function SlideBubble({
  slide,
  index,
  threads,
  width,
}: {
  slide: Slide;
  index: number;
  threads: Thread[];
  width: number;
}) {
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const { geometry, layout, anchorRef, scrollerRef } = useTimeline();

  const activate = () => {
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    const scroller = scrollerRef.current;
    const box = layout.slides[index];
    if (!scroller || !box) return;
    const target = splitForWidth(BUBBLE_TARGET_W, box.w / layout.h, geometry);
    if (slideHeightAt(target, geometry) <= layout.h + 0.5) {
      registry.revealSlide(slide.id);
      return;
    }
    // Grow around the bubble, then pull the whole (now larger) slide into view – at the deck's
    // start that means scrollLeft 0, not the bubble's old x.
    const contentX = box.x + box.w / 2;
    anchorRef.current = { contentX, viewportX: contentX - scroller.scrollLeft, keep: index };
    dispatch({ type: 'splitChanged', split: target });
  };

  return (
    <CommentBubble
      threads={threads}
      slideLabel={slideLabel(index)}
      width={Math.min(width, 104)}
      onActivate={activate}
    />
  );
}

/** Fallback height before a card is measured. */
const ESTIMATED_CARD_HEIGHT = 96;
const ESTIMATED_COMPACT_HEIGHT = 64;
/**
 * A card that changes its slot (band, column, row) glides there and its line follows; one that
 * keeps its slot moves along at once, so it never trails a dragged split handle.
 */
const SLOT_MOVE_MS = 200;
const SLOT_MOVE_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

interface Placed {
  slot: string;
  /** In the page layout (`layoutOrigin` of the list + the card's place in it). */
  left: number;
  top: number;
}

/**
 * Cards absolutely positioned by `brickLayout` from their measured heights, within the column's
 * width. Re-lays out when any card's height changes (e.g. a thread expanded inline). When the
 * cards need more than one band, `planBands` orders them so the lines to lower bands run down the
 * half-gaps beside the column.
 */
function BrickCards({
  threads,
  leftCount,
  width,
  compact,
}: {
  threads: Thread[];
  leftCount: number;
  width: number;
  compact: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const placedRef = useRef<ReadonlyMap<string, Placed>>(new Map());
  const cardProps = useCardProps();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const next = new Map<string, number>();
      for (const item of list.children)
        if (item instanceof HTMLElement && item.dataset.brick)
          next.set(item.dataset.brick, item.offsetHeight);
      setHeights((current) =>
        current.size === next.size && [...next].every(([id, h]) => current.get(id) === h)
          ? current
          : next,
      );
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    for (const item of list.children) resizeObserver.observe(item);
    return () => resizeObserver.disconnect();
  }, [threads, compact]);

  const plan = planBands(threads.length, leftCount, bandCapacity(width));
  const ordered = plan.order.map((index) => threads[index]!);
  const fallback = compact ? ESTIMATED_COMPACT_HEIGHT : ESTIMATED_CARD_HEIGHT;
  const layout = brickLayout(
    ordered.map((thread) => heights.get(thread.id) ?? fallback),
    width,
    plan.bandGap,
  );

  // Resizing slides moves cards to other slots (split handle, minimap fold): instead of a jump,
  // they glide from where they were. Only once every card is measured – not on the way in.
  // Measured in the page layout, so a column that moved along (its margin follows the slides)
  // counts too, and from where a glide still running has got to. Every column reads before any
  // starts its glides (`afterCommit`): one layout per commit instead of one per column and card.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measured = ordered.every((thread) => heights.has(thread.id));
    const slots = ordered.map((thread, index) => {
      const { band, column, row, left, top } = layout.cards[index]!;
      return { id: thread.id, slot: `${band}:${column}:${row}`, x: left, y: top };
    });
    afterCommit(() => {
      const previous = placedRef.current;
      const next = new Map<string, Placed>();
      const origin = layoutOrigin(list);
      const glides: { item: HTMLElement; dx: number; dy: number }[] = [];
      for (const { id, slot, x, y } of slots) {
        const left = origin.x + x;
        const top = origin.y + y;
        next.set(id, { slot, left, top });
        const before = previous.get(id);
        if (!before || before.slot === slot || prefersReducedMotion()) continue;
        const item = list.querySelector(`[data-brick="${CSS.escape(id)}"]`);
        // Not in jsdom.
        if (!(item instanceof HTMLElement) || typeof item.animate !== 'function') continue;
        const gliding = currentTranslate(item);
        glides.push({ item, dx: before.left + gliding.x - left, dy: before.top + gliding.y - top });
      }
      placedRef.current = measured ? next : new Map();
      return () => {
        for (const { item, dx, dy } of glides) {
          slotGlides.get(item)?.cancel();
          slotGlides.set(
            item,
            item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
              duration: SLOT_MOVE_MS,
              easing: SLOT_MOVE_EASE,
            }),
          );
        }
        if (glides.length > 0) followConnectors(list, SLOT_MOVE_MS);
      };
    });
  });

  return (
    <ul ref={listRef} data-brick-list className="relative" style={{ height: layout.height }}>
      {ordered.map((thread, index) => {
        const place = layout.cards[index]!;
        const props = cardProps(thread);
        return (
          <li
            key={thread.id}
            // Read by the connector routing: band and side margin of the card's line.
            data-brick={thread.id}
            data-band={place.band}
            data-margin={plan.margin[index] ?? undefined}
            className="absolute"
            style={{ left: place.left, top: place.top, width: place.width }}
          >
            {compact ? (
              <CompactCard thread={thread} deckId={props.deckId} emphasis={props.emphasis} />
            ) : (
              <CommentCard thread={thread} {...props} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Phones: the slide's cards stacked at full column width (no connector lines there). */
function StackedCards({ slide, threads }: { slide: Slide; threads: Thread[] }) {
  const sorted = useMemo(() => sortThreadsByAnchor(threads, slide.shapes), [threads, slide.shapes]);
  const cardProps = useCardProps();
  return (
    <ul className="flex flex-col gap-5">
      {sorted.map((thread) => (
        <li key={thread.id}>
          <CommentCard thread={thread} {...cardProps(thread)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Gap comments ("hier fehlt eine Folie") under their ⊕ divider: one count bubble in the author's
 * colour. Clicking opens the first thread in the panel.
 */
const GapColumn = memo(function GapColumn({
  gapKey: key,
  x,
  width,
  padTop,
  threads,
}: {
  gapKey: string;
  x: number;
  width: number;
  padTop: number;
  threads: Thread[];
}) {
  const dispatch = useViewerDispatch();
  const first = threads[0]!;
  const open = threads.some((thread) => thread.root.status === 'open');
  const label = `${pluralize(threads.length, 'Kommentar', 'Kommentare')} zwischen den Folien`;
  return (
    <div
      data-gap-column={key}
      className="flex justify-center"
      style={{ gridArea: '1 / 1', marginLeft: x, width, paddingTop: padTop }}
    >
      <CountBubble
        count={threads.length}
        color={first.root.author.color}
        dim={!open}
        size="md"
        data-gap-bubble={key}
        data-hover-thread={first.id}
        onClick={() => dispatch({ type: 'threadFocused', threadId: first.id, openPanel: true })}
        aria-label={label}
        title={label}
        className="max-w-full"
      />
    </div>
  );
});

/** Props every card gets from the viewer state (emphasis, permissions, gap location). */
function useCardProps() {
  const { deck, canComment, slideIndex } = useViewerData();
  const { focusedThreadId, hoveredThreadId, draft } = useViewerState();
  const indexOf = (slideId: string) => slideIndex.get(slideId);

  const emphasisOf = (thread: Thread): CardEmphasis => {
    if (thread.id === focusedThreadId) return 'focused';
    if (thread.id === hoveredThreadId) return 'hovered';
    return draft || focusedThreadId || hoveredThreadId ? 'dimmed' : 'normal';
  };

  return (thread: Thread) => ({
    deckId: deck.id,
    emphasis: emphasisOf(thread),
    canResolve: canComment,
    location: thread.root.anchor.type === 'gap' ? gapLabel(thread.root.anchor, indexOf) : undefined,
  });
}

/** Where an element sits in the page layout: unaffected by scrolling, moved by its ancestors' margins. */
function layoutOrigin(element: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let at: Element | null = element; at instanceof HTMLElement; at = at.offsetParent) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }
  return { x, y };
}

/** The slot glide of each card, while it may run. */
const slotGlides = new WeakMap<Element, Animation>();

/** How far a running slot glide has moved the card off its place (0 when none runs). */
function currentTranslate(element: HTMLElement): { x: number; y: number } {
  // Only a running glide moves it: without one, no style needs to be read.
  const glide = slotGlides.get(element);
  if (!glide || glide.playState === 'finished' || glide.playState === 'idle') return { x: 0, y: 0 };
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.m41, y: matrix.m42 };
}
