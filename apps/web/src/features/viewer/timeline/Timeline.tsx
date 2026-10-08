import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/ui';
import { ConnectorLines } from '../comments/ConnectorLines';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { useScrollActiveSlide } from '../hooks/useScrollActiveSlide';
import { useTimelineMetrics } from '../hooks/useTimelineMetrics';
import { useTimelineWheel } from '../hooks/useTimelineWheel';
import { rafThrottle } from '../lib/dom';
import {
  anchoredScrollLeft,
  revealScrollLeft,
  computeTrackGeometry,
  layoutTrack,
  slideHeightAt,
  splitForWidth,
  TRACK_PAD_TOP,
  trailingWidth,
  visibleRange,
  type TrackLayout,
} from '../lib/timeline-layout';
import { useRevisionData } from '../state/revision-data';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { CommentColumns } from './CommentColumns';
import { Minimap } from './Minimap';
import { SplitHandle } from './SplitHandle';
import { TimelineContext, type SizeAnchor } from './timeline-context';
import { Track } from './Track';

/** Clicks on these (or inside them) in the comment area keep the thread panel open. */
const KEEPS_PANEL =
  'button, a, input, textarea, select, label, [contenteditable], [role="button"], [data-comment-card], [data-connector-blob], [data-gap-bubble]';

/** The active slide grows to at least this width when a drawing tool is picked. */
const DRAW_MIN_W = 640;

type Range = { first: number; last: number };
const sameRange = (a: Range, b: Range) => a.first === b.first && a.last === b.last;

/**
 * The deck as a timeline: a track with every slide side by side on top, the minimap (thumbnails
 * of the whole deck), the controls row and the split handle below it, and below that every
 * slide's comments in a column exactly under its slide. One scroller moves track and columns
 * together horizontally; vertically only the comments scroll, under a sticky header. The split
 * handle sets the slide height – the track is always exactly as tall as the slides, and the
 * minimap, controls row and comment area move with it.
 */
export function Timeline({ controls }: { controls: ReactNode }) {
  const { slides, slideIndex } = useViewerData();
  const { split, activeSlideId, tool, threadPanelOpen } = useViewerState();
  const { deletedSlides } = useRevisionData();
  const hasDeleted = deletedSlides.length > 0;
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const narrow = useIsNarrow();
  const wrapperRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<SizeAnchor | null>(null);
  const [connectorLayer, setConnectorLayer] = useState<HTMLDivElement | null>(null);
  const [initialSlideId] = useState(activeSlideId);

  const metrics = useTimelineMetrics(wrapperRef, scrollerRef, controlsRef);
  const aspectRatios = useMemo(() => slides.map((slide) => slide.aspectRatio), [slides]);
  const geometry = useMemo(
    () =>
      metrics &&
      computeTrackGeometry({
        aspectRatios,
        viewportW: metrics.viewportW,
        viewportH: metrics.viewportH,
        controlsH: metrics.controlsH,
        narrow,
      }),
    [aspectRatios, metrics, narrow],
  );
  // Whole pixels: the track, the header and the comment area stay on crisp edges.
  const slideH = geometry && Math.round(slideHeightAt(narrow ? null : split, geometry));
  const layout = useMemo(
    () =>
      slideH ? layoutTrack(aspectRatios, slideH, hasDeleted ? trailingWidth(slideH) : 0) : null,
    [aspectRatios, slideH, hasDeleted],
  );

  useTimelineWheel({ scrollerRef, geometry, anchorRef, enabled: !narrow });

  useLayoutEffect(() => {
    registry.setScroller(scrollerRef.current);
    return () => registry.setScroller(null);
  }, [registry]);
  useLayoutEffect(() => {
    registry.setLayout(layout ? { layout, slideIndex, snap: narrow } : null);
  }, [registry, layout, slideIndex, narrow]);

  // Windowing: only slides (and columns) within a viewport left and right are rendered.
  const [range, setRange] = useState<Range>({ first: 0, last: -1 });
  const scrollLeftRef = useRef(0);
  const prevLayout = useRef<TrackLayout | null>(null);
  const clientW = metrics?.clientW ?? 0;

  const updateRange = useEffectEvent(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !layout) return;
    scrollLeftRef.current = scroller.scrollLeft;
    const next = visibleRange(layout, scroller.scrollLeft, scroller.clientWidth);
    setRange((current) => (sameRange(current, next) ? current : next));
  });

  /**
   * Where resizing without a pointer (split handle, keys, window) keeps things: the active
   * slide's centre if it is in view – and then the whole slide stays in view – else the middle.
   */
  const defaultAnchor = useEffectEvent(
    (prev: TrackLayout, scrollLeft: number, width: number): SizeAnchor => {
      const index = activeSlideId ? slideIndex.get(activeSlideId) : undefined;
      const box = index === undefined ? undefined : prev.slides[index];
      if (index !== undefined && box) {
        const centre = box.x + box.w / 2;
        if (centre >= scrollLeft && centre <= scrollLeft + width)
          return { contentX: centre, viewportX: centre - scrollLeft, keep: index };
      }
      return { contentX: scrollLeft + width / 2, viewportX: width / 2 };
    },
  );

  // Anchoring before paint: the anchor keeps its slide fraction under the same viewport x.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !layout) return;
    const prev = prevLayout.current;
    prevLayout.current = layout;
    const width = scroller.clientWidth;
    if (!prev) {
      // Deep link (`?slide=`): centred on the first paint, without animation.
      if (initialSlideId)
        registry.revealSlide(initialSlideId, { behavior: 'instant', align: 'center' });
    } else if (prev.h !== layout.h) {
      const anchor: SizeAnchor =
        anchorRef.current ?? defaultAnchor(prev, scrollLeftRef.current, width);
      anchorRef.current = null;
      const left = anchoredScrollLeft(prev, layout, anchor.contentX, anchor.viewportX, width);
      registry.scrollTrackTo(
        anchor.keep === undefined
          ? left
          : revealScrollLeft(layout, anchor.keep, left, width, 'nearest'),
      );
    }
    updateRange();
  }, [layout, clientW, registry, initialSlideId]);

  // Scrolling: update the window.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = rafThrottle(updateRange);
    scroller.addEventListener('scroll', update.schedule, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', update.schedule);
      update.cancel();
    };
  }, []);
  // … and the slide most in view becomes active.
  useScrollActiveSlide(scrollerRef);

  // A new revision reorders the track: the active slide (kept by its id) stays in view.
  const slideOrder = useMemo(() => slides.map((slide) => slide.id).join(), [slides]);
  const shownOrder = useRef(slideOrder);
  const revealActive = useEffectEvent(() => {
    if (activeSlideId)
      registry.revealSlide(activeSlideId, { behavior: 'instant', align: 'nearest' });
  });
  useLayoutEffect(() => {
    if (shownOrder.current === slideOrder || !layout) return;
    shownOrder.current = slideOrder;
    revealActive();
  }, [slideOrder, layout]);

  // Picking a drawing tool grows a small active slide to a comfortable drawing size.
  const growForDrawing = useEffectEvent(() => {
    if (narrow || !geometry || !layout || !activeSlideId) return;
    const index = slideIndex.get(activeSlideId);
    const box = index === undefined ? undefined : layout.slides[index];
    const slide = index === undefined ? undefined : slides[index];
    if (!box || !slide) return;
    if (box.w >= DRAW_MIN_W) {
      registry.revealSlide(activeSlideId, { align: 'nearest' });
      return;
    }
    const target = splitForWidth(DRAW_MIN_W, slide.aspectRatio, geometry);
    if (slideHeightAt(target, geometry) <= layout.h + 0.5) return;
    const scroller = scrollerRef.current;
    if (scroller) {
      const contentX = box.x + box.w / 2;
      const viewportX = Math.min(Math.max(contentX - scroller.scrollLeft, 0), scroller.clientWidth);
      anchorRef.current = { contentX, viewportX, keep: index };
    }
    dispatch({ type: 'splitChanged', split: target });
  });
  useEffect(() => {
    if (tool) growForDrawing();
  }, [tool]);

  const context = useMemo(
    () => geometry && layout && { geometry, layout, anchorRef, scrollerRef },
    [geometry, layout],
  );

  // A click on the comment area's background (not on a card or control) closes the thread panel.
  const onCommentAreaClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!threadPanelOpen || !(event.target instanceof Element)) return;
    if (event.target.closest('[data-timeline-header]') || event.target.closest(KEEPS_PANEL)) return;
    // Selecting text ends in a click too.
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    dispatch({ type: 'threadPanelClosed' });
  };

  return (
    <main ref={wrapperRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollerRef}
        data-timeline
        onClick={onCommentAreaClick}
        className={cn(
          'absolute inset-0 overflow-auto overscroll-contain [container-type:inline-size] [scrollbar-color:rgb(255_255_255/0.2)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]',
          narrow && 'snap-x snap-mandatory [scroll-padding-inline:16px]',
        )}
      >
        <div className="relative min-w-full" style={{ width: layout?.contentW }}>
          {/* Connector lines: in the content, so they scroll sideways with slides and cards in
              the same frame; sticky, so vertically they stay with the header's marks. */}
          <div
            ref={setConnectorLayer}
            data-connector-layer
            className="pointer-events-none sticky top-0 z-[25] h-0"
          />
          {/* Sticky header: the comment area starts where the split handle puts it. */}
          <div
            data-timeline-header
            className="sticky top-0 z-20 bg-canvas"
            style={{ paddingTop: TRACK_PAD_TOP }}
          >
            {layout && context ? (
              <TimelineContext value={context}>
                <Track layout={layout} range={range} snap={narrow} />
              </TimelineContext>
            ) : (
              <div style={{ height: slideH ?? 0 }} />
            )}
            {/* Minimap, controls row and split handle: one band of fixed height right under the
                track, part of where the comment area starts. Connector lines hide behind all of it. */}
            <div
              ref={controlsRef}
              data-connector-occluder
              className="sticky left-0 w-[100cqw] pt-2 max-md:pb-2"
            >
              {/* Thumbnails line up with the big track's slides (TRACK_PAD_X minus MINIMAP_PAD). */}
              <div className="px-3">
                <Minimap layout={layout} scrollerRef={scrollerRef} narrow={narrow} />
              </div>
              {/* Figma D1: ~28px from the thumbnails to the controls row. */}
              <div className="px-4 pt-2 md:px-[clamp(16px,3vw,32px)] md:pt-5">{controls}</div>
              {geometry && slideH && !narrow && (
                <div className="pt-1">
                  <SplitHandle geometry={geometry} slideH={slideH} />
                </div>
              )}
            </div>
          </div>
          {layout && context && (
            <TimelineContext value={context}>
              <CommentColumns layout={layout} range={range} narrow={narrow} />
            </TimelineContext>
          )}
        </div>
      </div>
      <ConnectorLines wrapperRef={wrapperRef} layer={connectorLayer} />
      {/* The floating avatar dock and session controls sit on a scrim, not on top of card text:
          cards scrolling under them fade out (the comment area has room to scroll them clear). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[28] h-28 bg-linear-to-b from-transparent via-canvas/85 via-40% to-canvas"
      />
    </main>
  );
}
