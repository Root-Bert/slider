import type { Slide } from '@slider/shared';
import { useMemo } from 'react';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import { sortThreadsByAnchor, type Thread } from '../lib/comment-selectors';
import { gapLabel, slideLabel } from '../lib/labels';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { CommentCard, type CardEmphasis } from './CommentCard';

/**
 * Comment cards below the stage (B1). Cards of the active slide are ordered by the horizontal
 * position of their anchors so they sit roughly under their marks; "Alle Folien" groups by slide.
 */
export function CommentBoard() {
  const { slides } = useViewerData();
  const { activeSlideId, scope } = useViewerState();
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
  return <CardGrid slide={activeSlide} threads={threads} />;
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

function CardGrid({ slide, threads }: { slide: Slide; threads: Thread[] }) {
  const { deck, canComment, slideIndex } = useViewerData();
  const { focusedThreadId, hoveredThreadId, draft } = useViewerState();
  const sorted = useMemo(() => sortThreadsByAnchor(threads, slide.shapes), [threads, slide.shapes]);
  const indexOf = (slideId: string) => slideIndex.get(slideId);

  const emphasisOf = (thread: Thread): CardEmphasis => {
    if (thread.id === focusedThreadId) return 'focused';
    if (thread.id === hoveredThreadId) return 'hovered';
    return draft || focusedThreadId || hoveredThreadId ? 'dimmed' : 'normal';
  };

  return (
    <ul className="grid grid-cols-1 items-start gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(260px,300px))]">
      {sorted.map((thread) => (
        <li key={thread.id}>
          <CommentCard
            thread={thread}
            deckId={deck.id}
            emphasis={emphasisOf(thread)}
            canResolve={canComment}
            location={
              thread.root.anchor.type === 'gap' ? gapLabel(thread.root.anchor, indexOf) : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="max-w-sm py-2 text-[13px] text-fg-subtle">{text}</p>;
}
