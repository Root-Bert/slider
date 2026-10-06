import type { Slide } from '@slider/shared';
import { Fragment, memo, useEffect, useRef } from 'react';
import { accentColor } from '@/lib/accent';
import { cn } from '@/ui';
import { gapKey, type Thread } from '../lib/comment-selectors';
import { scrollChildIntoView } from '../lib/dom';
import { slideLabel } from '../lib/labels';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

/** Row of slide thumbnails (Desktop-1): click jumps, active one outlined, dots for open feedback. */
export function Filmstrip() {
  const { slides, gapThreads } = useViewerData();
  const { activeSlideId } = useViewerState();
  const registry = useStageRegistry();
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the active thumbnail in view while the stage scrolls.
  useEffect(() => {
    const list = listRef.current;
    const active = activeSlideId
      ? list?.querySelector<HTMLElement>(`[data-thumb="${CSS.escape(activeSlideId)}"]`)
      : null;
    if (list && active) scrollChildIntoView(list, active);
  }, [activeSlideId]);

  return (
    <nav aria-label="Folienübersicht" className="min-w-0 flex-1">
      <ol ref={listRef} className="scrollbar-none flex items-center gap-2 overflow-x-auto p-1">
        {slides.map((slide, index) => {
          const gap = gapThreads.get(gapKey(slide.id, slides[index + 1]?.id ?? null));
          return (
            <Fragment key={slide.id}>
              <Thumbnail
                slide={slide}
                index={index}
                isActive={slide.id === activeSlideId}
                onSelect={registry.scrollToSlide}
              />
              {gap && <GapMarker threads={gap} />}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

interface ThumbnailProps {
  slide: Slide;
  index: number;
  isActive: boolean;
  onSelect: (slideId: string) => void;
}

const Thumbnail = memo(function Thumbnail({ slide, index, isActive, onSelect }: ThumbnailProps) {
  const label = `${slideLabel(index)}${slide.title ? `: ${slide.title}` : ''}${
    slide.openCommentCount ? ` – ${slide.openCommentCount} offene Kommentare` : ''
  }`;
  return (
    <li data-thumb={slide.id} className="shrink-0">
      <button
        type="button"
        onClick={() => onSelect(slide.id)}
        aria-label={label}
        aria-current={isActive ? 'true' : undefined}
        title={label}
        className={cn(
          'relative block h-16 overflow-hidden rounded-thumb bg-placeholder transition-[box-shadow,opacity]',
          isActive ? 'shadow-[0_0_0_2px_white]' : 'opacity-80 hover:opacity-100',
          slide.hidden && 'opacity-40',
        )}
        style={{ aspectRatio: slide.aspectRatio }}
      >
        <img
          src={slide.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
        {slide.openCommentCount > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/70 px-1 text-[10px] font-semibold text-white backdrop-blur"
          >
            {slide.openCommentCount}
          </span>
        )}
      </button>
    </li>
  );
});

/** Tiny marker between two thumbnails that have a "missing slide" comment (BER-103). */
function GapMarker({ threads }: { threads: Thread[] }) {
  const open = threads.filter((thread) => thread.root.status === 'open').length;
  return (
    <li
      aria-label={`${threads.length} Kommentar${threads.length === 1 ? '' : 'e'} zwischen den Folien`}
      className="flex h-12 w-1 shrink-0 rounded-full"
      style={{
        backgroundColor: accentColor(threads[0]!.root.author.color),
        opacity: open > 0 ? 1 : 0.4,
      }}
    />
  );
}
