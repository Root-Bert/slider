import type { Slide } from '@slider/shared';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { accentColor } from '@/lib/accent';
import { pluralize } from '@/lib/format';
import { AvatarStack, Icon } from '@/ui';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { bandCapacity, brickLayout, planBands } from '../lib/card-layout';
import {
  countLeftExits,
  sortThreadsByAnchor,
  sortThreadsClockwise,
  type Thread,
} from '../lib/comment-selectors';
import { gapLabel, slideLabel } from '../lib/labels';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { CommentCard, type CardEmphasis } from './CommentCard';

/**
 * Comment cards below the stage (B1). Cards of the active slide follow their connector lines:
 * clockwise around the slide, staggered in two rows. While the thread panel is open they fold
 * into one stacked summary all lines merge into (B4). "Alle Folien" groups by slide.
 */
export function CommentBoard() {
  const { slides } = useViewerData();
  const { activeSlideId, scope, threadPanelOpen } = useViewerState();
  const { bySlide } = useCommentThreads();
  const activeSlide = slides.find((slide) => slide.id === activeSlideId);

  if (scope === 'deck') {
    const groups = slides
      .map((slide, index) => ({ slide, index, threads: threadsOf(bySlide, slide.id) }))
      .filter((group) => group.threads.length > 0);
    if (groups.length === 0) return <EmptyHint text="Keine Kommentare für diesen Filter." />;
    return (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <SlideGroup key={group.slide.id} {...group} />
        ))}
      </div>
    );
  }

  if (!activeSlide) return null;
  const threads = threadsOf(bySlide, activeSlide.id);
  if (threads.length === 0) {
    return (
      <EmptyHint text="Noch kein Feedback auf dieser Folie. Markiere eine Stelle, um zu kommentieren." />
    );
  }
  return (
    <SlideCards
      slide={activeSlide}
      index={slides.indexOf(activeSlide)}
      threads={threads}
      folded={threadPanelOpen}
    />
  );
}

/**
 * Brick layout on wide screens (where connector lines are drawn), a plain grid on phones. With
 * the thread panel open, the stacked thread blob instead.
 */
function SlideCards({
  slide,
  index,
  threads,
  folded,
}: {
  slide: Slide;
  index: number;
  threads: Thread[];
  folded: boolean;
}) {
  const narrow = useIsNarrow();
  const sorted = useMemo(
    () => sortThreadsClockwise(threads, slide.shapes),
    [threads, slide.shapes],
  );
  const leftCount = useMemo(() => countLeftExits(threads, slide.shapes), [threads, slide.shapes]);
  if (narrow) return <CardGrid slide={slide} threads={threads} />;
  if (folded) return <ThreadBlob label={slideLabel(index)} threads={threads} />;
  return <BrickCards threads={sorted} leftCount={leftCount} />;
}

/** Fallback height before a card is measured. */
const ESTIMATED_CARD_HEIGHT = 96;

/**
 * Cards absolutely positioned by `brickLayout` from their measured heights. Re-lays out when the
 * board width or any card's height changes (e.g. a thread expanded inline). When the cards need
 * more than one band, `planBands` orders them so the lines to lower bands run down the margins.
 */
function BrickCards({ threads, leftCount }: { threads: Thread[]; leftCount: number }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [size, setSize] = useState<{ width: number; heights: ReadonlyMap<string, number> }>({
    width: 0,
    heights: new Map(),
  });
  const cardProps = useCardProps();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const heights = new Map<string, number>();
      for (const item of list.children)
        if (item instanceof HTMLElement && item.dataset.brick)
          heights.set(item.dataset.brick, item.offsetHeight);
      const width = list.clientWidth;
      setSize((current) =>
        current.width === width &&
        current.heights.size === heights.size &&
        [...heights].every(([id, height]) => current.heights.get(id) === height)
          ? current
          : { width, heights },
      );
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(list);
    for (const item of list.children) resizeObserver.observe(item);
    return () => resizeObserver.disconnect();
  }, [threads]);

  const plan = planBands(threads.length, leftCount, bandCapacity(size.width));
  const ordered = plan.order.map((index) => threads[index]!);
  const layout = brickLayout(
    ordered.map((thread) => size.heights.get(thread.id) ?? ESTIMATED_CARD_HEIGHT),
    size.width,
    plan.bandGap,
  );

  return (
    <ul ref={listRef} data-brick-list className="relative" style={{ height: layout.height }}>
      {ordered.map((thread, index) => {
        const place = layout.cards[index]!;
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
            <CommentCard thread={thread} {...cardProps(thread)} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The slide's threads folded into one stacked card while the thread panel is open (Figma B4
 * 120:687): glass card with two paper layers below, the connector lines enter its top edge and
 * the link to the panel leaves its right edge. Clicking it closes the panel again.
 */
function ThreadBlob({ label, threads }: { label: string; threads: Thread[] }) {
  const dispatch = useViewerDispatch();
  const { focusedThreadId } = useViewerState();
  const focused = threads.find((thread) => thread.id === focusedThreadId);
  const open = threads.filter((thread) => thread.root.status === 'open').length;
  const comments = threads.reduce((sum, thread) => sum + 1 + thread.replies.length, 0);
  const drawings = threads.filter((thread) => thread.root.strokes.length > 0).length;
  const authors = [
    ...new Map(
      threads.flatMap((thread) => thread.participants).map((author) => [author.id, author]),
    ).values(),
  ];
  const accent = accentColor(focused?.root.author.color ?? 'blue');

  return (
    <div
      data-connector-blob
      className="relative w-[360px] max-w-full pb-7"
      // Figma: 260px in on a 1040px canvas – a quarter of the board, as far as it fits.
      style={{ marginLeft: 'clamp(0px, calc(25% - 16px), calc(100% - 360px))' }}
    >
      <span
        aria-hidden
        className="glass absolute inset-x-[26px] bottom-0 h-4 rounded-b-xl opacity-50"
      />
      <span aria-hidden className="glass absolute inset-x-3 bottom-3 h-4 rounded-b-xl" />
      <button
        type="button"
        onClick={() => dispatch({ type: 'threadPanelClosed' })}
        aria-label={`Thread schließen und alle ${pluralize(threads.length, 'Kommentar', 'Kommentare')} zeigen`}
        className="glass relative flex w-full flex-col gap-2.5 rounded-2xl border px-4 pt-3.5 pb-3 text-left"
        style={{
          borderColor: accent,
          boxShadow: `0 0 20px color-mix(in srgb, ${accent} 45%, transparent)`,
        }}
      >
        <span className="flex items-center gap-2.5">
          <AvatarStack authors={authors} size={24} max={4} className="shrink-0" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold text-fg">
              {pluralize(threads.length, 'Kommentar', 'Kommentare')} zu {label}
            </span>
            <span className="text-xs text-fg-subtle">
              {open} offen · {threads.length - open} erledigt
            </span>
          </span>
        </span>
        <span aria-hidden className="h-px w-full bg-white/8" />
        <span className="flex items-center gap-3 text-[11px] font-medium text-fg-muted">
          <span className="flex items-center gap-1" title="Nachrichten">
            <Icon name="notes" size={14} />
            {comments}
          </span>
          {drawings > 0 && (
            <span className="flex items-center gap-1" title="Zeichnungen">
              <Icon name="draw" size={14} />
              {drawings}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1 text-xs" style={{ color: accent }}>
            Thread geöffnet
            <Icon name="arrowForward" size={14} />
          </span>
        </span>
      </button>
    </div>
  );
}

function SlideGroup({ slide, index, threads }: { slide: Slide; index: number; threads: Thread[] }) {
  const registry = useStageRegistry();
  return (
    <section aria-labelledby={`group-${slide.id}`} className="flex flex-col gap-3">
      <h3 id={`group-${slide.id}`}>
        <button
          type="button"
          onClick={() => registry.scrollToSlide(slide.id)}
          className="flex items-center gap-3 rounded-lg text-left text-xs font-medium text-fg-muted hover:text-fg"
        >
          <img
            src={slide.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-8 rounded-[3px]"
            style={{ aspectRatio: slide.aspectRatio }}
          />
          {slideLabel(index)}
          {slide.title && <span className="font-normal text-fg-subtle">{slide.title}</span>}
        </button>
      </h3>
      <CardGrid slide={slide} threads={threads} />
    </section>
  );
}

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

function CardGrid({ slide, threads }: { slide: Slide; threads: Thread[] }) {
  const sorted = useMemo(() => sortThreadsByAnchor(threads, slide.shapes), [threads, slide.shapes]);
  const cardProps = useCardProps();

  return (
    <ul className="grid grid-cols-1 items-start gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(260px,300px))]">
      {sorted.map((thread) => (
        <li key={thread.id}>
          <CommentCard thread={thread} {...cardProps(thread)} />
        </li>
      ))}
    </ul>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="max-w-sm py-2 text-[13px] text-fg-subtle">{text}</p>;
}
