import type { Slide } from '@slider/shared';
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { accentColor } from '@/lib/accent';
import { cn, Icon } from '@/ui';
import { gapKey } from '../lib/comment-selectors';
import { rafThrottle } from '../lib/dom';
import { slideLabel } from '../lib/labels';
import type { SlideBadge } from '../lib/revision-changes';
import { ChangeBadge } from '../revisions/ChangeBadge';
import {
  bracketFor,
  edgeScrollSpeed,
  followScrollLeft,
  layoutMinimap,
  MINIMAP_PAD,
  minimapAsTrack,
  scrollLeftForBracket,
  THUMB_GAP,
  THUMB_H,
} from '../lib/minimap';
import type { TrackLayout } from '../lib/timeline-layout';
import { useRevisionData } from '../state/revision-data';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/** A pointer that moves this far after pressing drags the bracket instead of clicking. */
const DRAG_SLOP = 4;
/** The bracket stands this far out around the thumbnails it frames. */
const BRACKET_OUTSET = 3;
/** Width of the "Gelöscht (n)" entry after the last thumbnail (Figma D2). */
const DELETED_W = 112;
const DELETED_W_NARROW = 72;

interface MinimapProps {
  /** The big track's layout (null until the timeline has measured itself). */
  layout: TrackLayout | null;
  scrollerRef: RefObject<HTMLElement | null>;
  narrow: boolean;
}

/**
 * Thumbnail row of the whole deck under the big track (Figma D1, 87:327) – PowerPoint's
 * thumbnail pane turned sideways. Thumbnails have one fixed height (a long deck
 * scrolls), the active one is framed white, and a bracket marks the part of the
 * deck in view above; it follows scrolling and resizing live and can be dragged to scroll the
 * track. Clicking a thumbnail activates its slide and reveals it. The row has a fixed height and
 * moves with the split handle, right under the track.
 */
export function Minimap({ layout, scrollerRef, narrow }: MinimapProps) {
  const { slides, gapThreads } = useViewerData();
  const { activeSlideId, showChanges, deletedPanelOpen } = useViewerState();
  const { badges, deletedSlides } = useRevisionData();
  const deletedW = deletedSlides.length > 0 ? (narrow ? DELETED_W_NARROW : DELETED_W) : 0;
  const deletedRoom = deletedW > 0 ? deletedW + THUMB_GAP : 0;
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const listRef = useRef<HTMLDivElement>(null);
  const bracketRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    /** Last pointer x while dragging (the edge auto-scroll keeps using it). */
    clientX: number;
    offset: number;
    active: boolean;
  }>(null);
  const suppressClickRef = useRef(false);
  const [availableW, setAvailableW] = useState(0);

  const rowH = THUMB_H + 2 * MINIMAP_PAD;
  const aspectRatios = useMemo(() => slides.map((slide) => slide.aspectRatio), [slides]);
  const mini = useMemo(
    () =>
      availableW > 0
        ? layoutMinimap(aspectRatios, availableW - 2 * MINIMAP_PAD - deletedRoom)
        : null,
    [aspectRatios, availableW, deletedRoom],
  );
  const miniTrack = useMemo(() => mini && minimapAsTrack(mini), [mini]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setAvailableW(list.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const placeBracket = (follow: boolean) =>
    positionBracket({
      scroller: scrollerRef.current,
      bracket: bracketRef.current,
      list: listRef.current,
      layout,
      miniTrack,
      follow: follow && !!mini?.scrolls,
    });
  const updateBracket = useEffectEvent(placeBracket);

  // Slide size, resize, first paint: before paint, so the bracket never lags a frame behind.
  useLayoutEffect(() => {
    updateBracket(true);
  }, [layout, miniTrack]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const throttled = rafThrottle(() => updateBracket(!dragRef.current?.active));
    scroller.addEventListener('scroll', throttled.schedule, { passive: true });
    const observer = new ResizeObserver(throttled.schedule);
    observer.observe(scroller);
    return () => {
      throttled.cancel();
      observer.disconnect();
      scroller.removeEventListener('scroll', throttled.schedule);
    };
  }, [scrollerRef]);

  // Mouse wheels only scroll vertically: a row that overflows takes the wheel sideways. A row
  // that fits leaves it to the timeline, which scrolls the track – and hands a sideways swipe
  // (trackpad) on to the track too, which the row would otherwise swallow.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const max = list.scrollWidth - list.clientWidth;
      const scale = event.deltaMode === 1 ? 16 : 1;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        const scroller = scrollerRef.current;
        if (max > 1 || !scroller) return;
        event.preventDefault();
        scroller.scrollLeft += event.deltaX * scale;
        return;
      }
      if (max <= 1) return;
      const delta = event.deltaY * scale;
      if ((delta > 0 && list.scrollLeft >= max - 1) || (delta < 0 && list.scrollLeft <= 1)) return;
      event.preventDefault();
      list.scrollBy({ left: delta });
    };
    list.addEventListener('wheel', onWheel, { passive: false });
    return () => list.removeEventListener('wheel', onWheel);
  }, [scrollerRef]);

  // Keyboard ←/→ and clicks on the big track: the active thumbnail stays in a scrolling row.
  useEffect(() => {
    const list = listRef.current;
    const index = activeSlideId ? slides.findIndex((slide) => slide.id === activeSlideId) : -1;
    const box = mini?.slides[index];
    if (!list || !box || !mini.scrolls) return;
    const next = followScrollLeft(
      MINIMAP_PAD + box.x,
      box.w,
      list.scrollLeft,
      list.clientWidth,
      list.scrollWidth - list.clientWidth,
    );
    if (Math.abs(next - list.scrollLeft) >= 1) list.scrollTo({ left: next, behavior: 'smooth' });
  }, [activeSlideId, mini, slides]);

  const select = useCallback(
    (slideId: string) => {
      if (suppressClickRef.current) return;
      dispatch({ type: 'activeSlideChanged', slideId });
      registry.revealSlide(slideId, { align: 'nearest' });
    },
    [dispatch, registry],
  );

  // Dragging the bracket scrolls the track. Mouse and pen only: touch pans the row natively.
  // The pointer counts as inside the row, so the bracket never leaves the visible part of it.
  const contentX = (clientX: number) => {
    const list = listRef.current!;
    const box = list.getBoundingClientRect();
    const x = Math.min(Math.max(clientX, box.left), box.right);
    return x - box.left + list.scrollLeft - MINIMAP_PAD;
  };
  const overBracket = (clientX: number) => {
    const bracket = bracketRef.current;
    if (!bracket || bracket.hidden) return false;
    const box = bracket.getBoundingClientRect();
    return clientX >= box.left && clientX <= box.right;
  };
  const dragTo = (clientX: number) => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    const list = listRef.current;
    const bracket = bracketRef.current;
    if (!drag || !scroller || !list || !bracket || !layout || !miniTrack) return;
    // The whole bracket stays in the visible part of the row (the row scrolls along at its edges).
    const half = Math.max(0, bracket.offsetWidth / 2 - BRACKET_OUTSET);
    const lo = list.scrollLeft - MINIMAP_PAD + half;
    const hi = list.scrollLeft + list.clientWidth - MINIMAP_PAD - half;
    let centre = contentX(clientX) - drag.offset;
    if (hi > lo) centre = Math.min(Math.max(centre, lo), hi);
    // The user scrolls: the slide most in view becomes active (`useScrollActiveSlide`).
    registry.endProgrammaticScroll();
    scroller.scrollLeft = scrollLeftForBracket(layout, miniTrack, centre, scroller.clientWidth);
  };
  // A row that scrolls (long deck) scrolls along while the bracket is held near its edges.
  const [dragging, setDragging] = useState(false);
  const autoScrollStep = useEffectEvent(() => {
    const drag = dragRef.current;
    const list = listRef.current;
    if (!drag?.active || !list) return;
    const max = list.scrollWidth - list.clientWidth;
    const speed = edgeScrollSpeed(drag.clientX, list.getBoundingClientRect());
    if (speed === 0 || max <= 1) return;
    const before = list.scrollLeft;
    list.scrollLeft = Math.min(Math.max(before + speed, 0), max);
    if (list.scrollLeft !== before) dragTo(drag.clientX);
  });
  useEffect(() => {
    if (!dragging) return;
    let frame = requestAnimationFrame(function step() {
      autoScrollStep();
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    const bracket = bracketRef.current;
    if (event.pointerType === 'touch' || event.button !== 0 || !bracket) return;
    if (!overBracket(event.clientX)) return;
    const box = bracket.getBoundingClientRect();
    const centre = contentX((box.left + box.right) / 2);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      clientX: event.clientX,
      offset: contentX(event.clientX) - centre,
      active: false,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const scroller = scrollerRef.current;
    const list = event.currentTarget;
    if (!drag) {
      if (event.pointerType !== 'touch') setGrab(list, overBracket(event.clientX) ? 'hover' : null);
      return;
    }
    if (drag.pointerId !== event.pointerId || !scroller || !layout || !miniTrack) return;
    if (!drag.active) {
      if (Math.abs(event.clientX - drag.startX) < DRAG_SLOP) return;
      drag.active = true;
      list.setPointerCapture(event.pointerId);
      setGrab(list, 'drag');
      setDragging(true);
    }
    drag.clientX = event.clientX;
    dragTo(event.clientX);
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // The click that follows a drag must not select the thumbnail under the pointer.
    suppressClickRef.current = drag.active;
    dragRef.current = null;
    setDragging(false);
    setGrab(event.currentTarget, overBracket(event.clientX) ? 'hover' : null);
    placeBracket(true);
  };

  const activeIndex = activeSlideId ? slides.findIndex((slide) => slide.id === activeSlideId) : -1;

  return (
    <nav aria-label="Folienübersicht" data-minimap>
      <div
        ref={listRef}
        className={cn(
          'scrollbar-none relative overflow-x-auto overflow-y-hidden overscroll-x-contain select-none',
          // Over the bracket the pointer grabs it (the bracket itself lets clicks through).
          'data-[grab=drag]:cursor-grabbing data-[grab=drag]:**:cursor-grabbing data-[grab=hover]:cursor-grab data-[grab=hover]:**:cursor-grab',
        )}
        style={{ height: rowH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={(event) => {
          if (!dragRef.current) setGrab(event.currentTarget, null);
        }}
      >
        {mini && (
          <ol
            className="relative"
            style={{ width: mini.contentW + 2 * MINIMAP_PAD + deletedRoom, height: rowH }}
          >
            {slides.map((slide, index) => {
              const box = mini.slides[index];
              if (!box) return null;
              const next = slides[index + 1];
              const gap = next ? gapThreads.get(gapKey(slide.id, next.id)) : undefined;
              const gapColor = gap?.[0] ? accentColor(gap[0].root.author.color) : null;
              return (
                <Thumbnail
                  key={slide.id}
                  slide={slide}
                  index={index}
                  x={MINIMAP_PAD + box.x}
                  top={(rowH - mini.h) / 2}
                  w={box.w}
                  h={mini.h}
                  isActive={index === activeIndex}
                  gapColor={gapColor}
                  badge={showChanges ? (badges.get(slide.id) ?? null) : null}
                  onSelect={select}
                />
              );
            })}
            {deletedW > 0 && (
              <li
                className="absolute"
                style={{
                  left: MINIMAP_PAD + mini.contentW + THUMB_GAP,
                  top: (rowH - mini.h) / 2,
                  width: deletedW,
                  height: mini.h,
                }}
              >
                <button
                  type="button"
                  data-deleted-thumb
                  aria-expanded={deletedPanelOpen}
                  aria-label={`Gelöschte Folien (${deletedSlides.length}) anzeigen`}
                  title={`Gelöschte Folien (${deletedSlides.length})`}
                  onClick={() => {
                    if (!suppressClickRef.current)
                      dispatch({ type: 'deletedPanelSet', open: !deletedPanelOpen });
                  }}
                  className={cn(
                    'flex size-full items-center justify-center gap-1 rounded-thumb border border-dashed border-white/25 text-[11px] font-medium text-fg-muted transition-colors hover:border-white/40 hover:bg-white/5 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white',
                    deletedPanelOpen && 'border-white/50 bg-white/8 text-fg',
                  )}
                >
                  <Icon name="delete" size={14} className="shrink-0" />
                  <span className={cn('whitespace-nowrap', narrow && 'sr-only')}>Gelöscht</span>
                  <span className="text-fg-subtle tabular-nums">({deletedSlides.length})</span>
                  {!narrow && <Icon name="chevronRight" size={14} className="-mr-1 shrink-0" />}
                </button>
              </li>
            )}
          </ol>
        )}
        <div
          ref={bracketRef}
          aria-hidden
          data-minimap-bracket
          className="pointer-events-none absolute top-0 left-0 rounded-[calc(var(--radius-thumb)+3px)] border border-white/25 bg-white/[0.06] shadow-[0_0_0_1px_rgb(0_0_0/0.6)] will-change-transform"
          style={{
            top: mini ? (rowH - mini.h) / 2 - BRACKET_OUTSET : 0,
            height: mini ? mini.h + 2 * BRACKET_OUTSET : rowH,
          }}
        />
      </div>
    </nav>
  );
}

/**
 * Positions the bracket from the track's scroll position – straight on the DOM, no React render
 * per scroll frame – and, with `follow`, scrolls an overflowing row to keep it in view.
 */
function positionBracket({
  scroller,
  bracket,
  list,
  layout,
  miniTrack,
  follow,
}: {
  scroller: HTMLElement | null;
  bracket: HTMLElement | null;
  list: HTMLElement | null;
  layout: TrackLayout | null;
  miniTrack: TrackLayout | null;
  follow: boolean;
}) {
  if (!bracket) return;
  if (!scroller || !list || !layout || !miniTrack) {
    bracket.hidden = true;
    return;
  }
  const { left, width, all } = bracketFor(
    layout,
    miniTrack,
    scroller.scrollLeft,
    scroller.clientWidth,
  );
  bracket.hidden = all;
  bracket.style.transform = `translateX(${MINIMAP_PAD + left - BRACKET_OUTSET}px)`;
  bracket.style.width = `${width + 2 * BRACKET_OUTSET}px`;
  if (!follow || all) return;
  const next = followScrollLeft(
    MINIMAP_PAD + left,
    width,
    list.scrollLeft,
    list.clientWidth,
    list.scrollWidth - list.clientWidth,
  );
  if (Math.abs(next - list.scrollLeft) >= 1) list.scrollLeft = next;
}

function setGrab(list: HTMLElement, state: 'hover' | 'drag' | null) {
  if (state) list.dataset.grab = state;
  else delete list.dataset.grab;
}

interface ThumbnailProps {
  slide: Slide;
  index: number;
  x: number;
  top: number;
  w: number;
  h: number;
  isActive: boolean;
  /** Accent of a "missing slide" comment between this slide and the next (BER-103). */
  gapColor: string | null;
  /** Change of the latest revision while changes are shown (Figma D2). */
  badge: SlideBadge | null;
  onSelect: (slideId: string) => void;
}

const Thumbnail = memo(function Thumbnail({
  slide,
  index,
  x,
  top,
  w,
  h,
  isActive,
  gapColor,
  badge,
  onSelect,
}: ThumbnailProps) {
  const count = slide.openCommentCount;
  const label = `${slideLabel(index)}${slide.title ? `: ${slide.title}` : ''}${
    count ? ` – ${count} offene${count === 1 ? 'r' : ''} Kommentar${count === 1 ? '' : 'e'}` : ''
  }${badge ? ` – ${badge.description}` : ''}`;
  return (
    <li data-thumb={slide.id} className="absolute" style={{ left: x, top, width: w, height: h }}>
      <button
        type="button"
        onClick={() => onSelect(slide.id)}
        aria-label={label}
        aria-current={isActive ? 'true' : undefined}
        title={label}
        className={cn(
          'relative block size-full overflow-hidden rounded-thumb bg-placeholder transition-shadow focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-white',
          // Figma D1: 2px white frame outside the image.
          isActive ? 'shadow-[0_0_0_2px_white]' : 'hover:shadow-[0_0_0_2px_rgb(255_255_255/0.3)]',
          slide.hidden && 'opacity-40',
        )}
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
          // Thin black gap between frame and image.
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_black]"
          />
        )}
        {badge && (
          <ChangeBadge
            badge={badge}
            size="mini"
            className="pointer-events-none absolute bottom-0.5 left-0.5 max-w-[calc(100%-20px)]"
          />
        )}
        {count > 0 && (
          // Subtle open-comment count; a dot would read as a stray control on small thumbnails.
          <span
            aria-hidden
            className="absolute right-0.5 bottom-0.5 rounded-thumb bg-black/65 px-[3px] text-[9px] leading-3 font-medium text-white/80 tabular-nums"
          >
            {count}
          </span>
        )}
      </button>
      {gapColor && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 w-0.5 rounded-full"
          style={{ left: w + THUMB_GAP / 2 - 1, backgroundColor: gapColor }}
        />
      )}
    </li>
  );
});
