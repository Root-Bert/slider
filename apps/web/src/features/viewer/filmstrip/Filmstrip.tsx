import type { Slide } from '@slider/shared';
import {
  Fragment,
  memo,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { accentColor } from '@/lib/accent';
import { cn } from '@/ui';
import { gapKey, type Thread } from '../lib/comment-selectors';
import { overflowEdges, rafThrottle, scrollChildIntoView } from '../lib/dom';
import { slideLabel } from '../lib/labels';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

/** Width of the fade on a clipped edge of the strip. */
const FADE_PX = 24;

/**
 * Row of slide thumbnails (Desktop-1, 87:327): click jumps, active one framed, badges for open
 * feedback. Thumbnails keep their size at every zoom. Overflowing thumbnails fade out at the
 * clipped edge, and a vertical mouse wheel scrolls the strip sideways.
 */
export function Filmstrip() {
  const { slides, gapThreads } = useViewerData();
  const { activeSlideId } = useViewerState();
  const registry = useStageRegistry();
  const listRef = useRef<HTMLOListElement>(null);
  const firstScroll = useRef(true);
  const [edges, setEdges] = useState({ start: false, end: false });

  // Keep the active thumbnail in view while the stage scrolls – without animation on the first
  // paint (a deep link via `?slide=` shows its thumbnail right away) and when the strip resizes.
  const revealActive = useEffectEvent((behavior: ScrollBehavior) => {
    const list = listRef.current;
    const active = activeSlideId
      ? list?.querySelector<HTMLElement>(`[data-thumb="${CSS.escape(activeSlideId)}"]`)
      : null;
    if (list && active) scrollChildIntoView(list, active, behavior);
  });
  useEffect(() => {
    revealActive(firstScroll.current ? 'instant' : 'smooth');
    firstScroll.current = false;
  }, [activeSlideId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const update = rafThrottle(() => {
      const next = overflowEdges(list.scrollLeft, list.scrollWidth, list.clientWidth);
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    });
    update.schedule();
    const resizeObserver = new ResizeObserver(() => {
      revealActive('instant');
      update.schedule();
    });
    resizeObserver.observe(list);

    // Mouse wheels only scroll vertically. Take the delta while the strip can still move that
    // way, otherwise leave it to the page. ⌘/Ctrl + wheel is the stage zoom.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX))
        return;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const max = list.scrollWidth - list.clientWidth;
      if ((delta > 0 && list.scrollLeft >= max - 1) || (delta < 0 && list.scrollLeft <= 1)) return;
      event.preventDefault();
      list.scrollBy({ left: delta });
    };

    list.addEventListener('scroll', update.schedule, { passive: true });
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      update.cancel();
      resizeObserver.disconnect();
      list.removeEventListener('scroll', update.schedule);
      list.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    // Connector lines fade out behind the thumbnails.
    <nav
      aria-label="Folienübersicht"
      data-connector-occluder="filmstrip"
      className="min-w-0 flex-1"
    >
      {/* 2px padding keeps the active frame from being clipped by the scroller. */}
      <ol
        ref={listRef}
        className="scrollbar-none flex items-center gap-2 overflow-x-auto p-0.5"
        style={edgeFade(edges)}
      >
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

/** Fades the clipped edge(s), so a cut thumbnail reads as "there is more". */
function edgeFade({ start, end }: { start: boolean; end: boolean }): CSSProperties | undefined {
  if (!start && !end) return undefined;
  const mask = `linear-gradient(to right, ${start ? `transparent, #000 ${FADE_PX}px` : '#000'}, ${
    end ? `#000 calc(100% - ${FADE_PX}px), transparent` : '#000'
  })`;
  return { maskImage: mask, WebkitMaskImage: mask };
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
          'relative block h-16 overflow-hidden rounded-thumb bg-placeholder transition-shadow',
          // Figma: 2px white frame outside the image; inactive thumbnails stay at full brightness.
          isActive ? 'shadow-[0_0_0_2px_white]' : 'hover:shadow-[0_0_0_2px_rgb(255_255_255/0.3)]',
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
        {isActive && (
          // Thin black gap between frame and image – an inset shadow on the button would sit
          // under the image.
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_black]"
          />
        )}
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
      className="flex h-16 w-1 shrink-0 rounded-full"
      style={{
        backgroundColor: accentColor(threads[0]!.root.author.color),
        opacity: open > 0 ? 1 : 0.4,
      }}
    />
  );
}
