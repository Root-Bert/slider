import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/ui';
import { ConnectorLines } from '../comments/ConnectorLines';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { useTimelineMetrics } from '../hooks/useTimelineMetrics';
import { useTimelineZoom } from '../hooks/useTimelineZoom';
import {
  anchoredScrollLeft,
  revealScrollLeft,
  computeTrackGeometry,
  layoutTrack,
  slideHeightAt,
  TRACK_PAD_X,
  visibleRange,
  zoomForWidth,
  type TrackLayout,
} from '../lib/timeline-layout';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { CommentColumns } from './CommentColumns';
import { TimelineContext, type ZoomAnchor } from './timeline-context';
import { Track } from './Track';

/** The active slide is zoomed to at least this width when a drawing tool is picked. */
const DRAW_MIN_W = 640;
/** On phones the slide nearest to the snap point becomes active once scrolling settles. */
const SETTLE_MS = 120;

type Range = { first: number; last: number };
const sameRange = (a: Range, b: Range) => a.first === b.first && a.last === b.last;

/**
 * The deck as a timeline: a track with every slide side by side on top, the controls row below
 * it, and below that every slide's comments in a column exactly under its slide. One scroller
 * moves track and columns together horizontally; vertically only the comments scroll, under a
 * sticky header of fixed height – so zooming never moves the comment area.
 */
export function Timeline({ controls }: { controls: ReactNode }) {
  const { slides, slideIndex } = useViewerData();
  const { zoom, activeSlideId, tool } = useViewerState();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const narrow = useIsNarrow();
  const wrapperRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<ZoomAnchor | null>(null);
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
  const t = narrow ? 1 : zoom;
  const layout = useMemo(
    () => geometry && layoutTrack(aspectRatios, slideHeightAt(t, geometry)),
    [aspectRatios, geometry, t],
  );

  useTimelineZoom({ scrollerRef, geometry, anchorRef, enabled: !narrow });

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
   * Where zooming without a pointer (buttons, slider, resize) keeps things: the active slide's
   * centre if it is in view – and then the whole slide stays in view – else the middle.
   */
  const defaultAnchor = useEffectEvent(
    (prev: TrackLayout, scrollLeft: number, width: number): ZoomAnchor => {
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

  // Zoom anchoring before paint: the anchor keeps its slide fraction under the same viewport x.
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
      const anchor: ZoomAnchor =
        anchorRef.current ?? defaultAnchor(prev, scrollLeftRef.current, width);
      anchorRef.current = null;
      const left = anchoredScrollLeft(prev, layout, anchor.contentX, anchor.viewportX, width);
      scroller.scrollLeft =
        anchor.keep === undefined
          ? left
          : revealScrollLeft(layout, anchor.keep, left, width, 'nearest');
    }
    updateRange();
  }, [layout, clientW, registry, initialSlideId]);

  // Scrolling: update the window; on phones the slide at the snap point becomes active.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    let settle = 0;
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          updateRange();
        });
      if (!narrow) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const current = registry.getLayout();
        if (!current) return;
        const target = scroller.scrollLeft + TRACK_PAD_X;
        let best = 0;
        current.layout.slides.forEach((slide, index) => {
          if (Math.abs(slide.x - target) < Math.abs(current.layout.slides[best]!.x - target))
            best = index;
        });
        const slide = slides[best];
        if (slide) dispatch({ type: 'activeSlideChanged', slideId: slide.id });
      }, SETTLE_MS);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [narrow, registry, slides, dispatch]);

  // Picking a drawing tool zooms a small active slide up to a comfortable drawing size.
  const zoomForDrawing = useEffectEvent(() => {
    if (narrow || !geometry || !layout || !activeSlideId) return;
    const index = slideIndex.get(activeSlideId);
    const box = index === undefined ? undefined : layout.slides[index];
    const slide = index === undefined ? undefined : slides[index];
    if (!box || !slide) return;
    if (box.w >= DRAW_MIN_W) {
      registry.revealSlide(activeSlideId, { align: 'nearest' });
      return;
    }
    const target = zoomForWidth(DRAW_MIN_W, slide.aspectRatio, geometry);
    if (target <= zoom) return;
    const scroller = scrollerRef.current;
    if (scroller) {
      const contentX = box.x + box.w / 2;
      const viewportX = Math.min(Math.max(contentX - scroller.scrollLeft, 0), scroller.clientWidth);
      anchorRef.current = { contentX, viewportX, keep: index };
    }
    dispatch({ type: 'zoomChanged', zoom: target });
  });
  useEffect(() => {
    if (tool) zoomForDrawing();
  }, [tool]);

  const context = useMemo(
    () => geometry && layout && { geometry, layout, anchorRef, scrollerRef },
    [geometry, layout],
  );
  const trackH = geometry?.trackH ?? 0;

  return (
    <main ref={wrapperRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollerRef}
        data-timeline
        className={cn(
          'absolute inset-0 overflow-auto overscroll-contain [container-type:inline-size] [scrollbar-color:rgb(255_255_255/0.2)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]',
          narrow && 'snap-x snap-mandatory [scroll-padding-inline:16px]',
        )}
      >
        <div className="relative min-w-full" style={{ width: layout?.contentW }}>
          {/* Sticky header of fixed height: the comment area always starts at the same y. */}
          <div data-timeline-header className="sticky top-0 z-20 bg-canvas">
            {layout && context ? (
              <TimelineContext value={context}>
                <Track layout={layout} range={range} height={trackH} />
              </TimelineContext>
            ) : (
              <div style={{ height: trackH }} />
            )}
            <div
              ref={controlsRef}
              className="sticky left-0 w-[100cqw] px-4 pt-4 pb-2 md:px-[clamp(16px,3vw,32px)]"
            >
              {controls}
            </div>
          </div>
          {layout && context && (
            <TimelineContext value={context}>
              <CommentColumns layout={layout} range={range} narrow={narrow} />
            </TimelineContext>
          )}
        </div>
      </div>
      <ConnectorLines wrapperRef={wrapperRef} />
      {/* The floating tool dock and session controls sit on a scrim, not on top of card text:
          cards scrolling under them fade out (the comment area has room to scroll them clear). */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-[28] bg-linear-to-b from-transparent via-canvas/85 via-40% to-canvas transition-[height] duration-200',
          // Taller while a tool is picked: the tool options pill stacks above the tool bar.
          tool ? 'h-44' : 'h-28',
        )}
      />
    </main>
  );
}
