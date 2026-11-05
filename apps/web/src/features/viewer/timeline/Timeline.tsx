import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import { cn, SelectionBox, useIsNarrow } from '@/ui';
import { useDeckCreation } from '@/lib/api';
import { opensOnBoard } from '@/lib/routes';
import { smoothScroll } from '@/lib/motion';
import { selectionStyle } from '@/lib/accent';
import { rafThrottle } from '@/lib/dom';
import { useMarqueeSelect } from '@/lib/marquee-select';
import { useMultiSelect } from '@/lib/multi-select';
import { CommentSelectionContext, type CommentSelection } from '../comments/comment-selection';
import { CommentSelectionBar } from '../comments/CommentSelectionBar';
import { useCommentThreads } from '../comments/hooks/useCommentThreads';
import type { Thread } from '../comments/lib/comment-selectors';
import { ConnectorLines } from '../connectors/ConnectorLines';
import { useFoldProgress } from './hooks/useFoldProgress';
import { useScrollActiveSlide } from './hooks/useScrollActiveSlide';
import { useTimelineMetrics } from './hooks/useTimelineMetrics';
import { useHandPan } from './hooks/useHandPan';
import { useHandleRoom } from './hooks/useHandleRoom';
import { useZoomToggle } from './hooks/useZoomToggle';
import { useTimelineWheel } from './hooks/useTimelineWheel';
import { useFrameAspects } from '../state/frame-format';
import {
  anchoredScrollLeft,
  revealScrollLeft,
  computeTrackGeometry,
  layoutTrack,
  leadingWidth,
  slideHeightAt,
  splitForHeight,
  splitForWidth,
  TRACK_PAD_TOP,
  trackStack,
  trailingWidth,
  visibleRange,
  type TrackLayout,
} from './lib/timeline-layout';
import { useRevisionData } from '../state/revision-data';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { isSidePanelOpen, useViewerDispatch, useViewerState } from '../state/viewer-state';
import { CommentColumns } from './CommentColumns';
import { MINIMAP_ROW_H } from './lib/minimap';
import { Minimap } from './Minimap';
import { SplitHandle } from './SplitHandle';
import { TimelineContext, type SizeAnchor } from './timeline-context';
import { Track } from './Track';
import { TrackDotsContext } from './TrackDots';
import { useTrackSwipe } from './hooks/useTrackSwipe';
import { useVariantFlow } from './hooks/useVariantFlow';
import { VariantSheet } from './VariantSheet';
import { useEditing } from '../editing/editing-context';

/** Clicks on these (or inside them) in the comment area keep the thread panel open. */
const KEEPS_PANEL =
  'button, a, input, textarea, select, label, [contenteditable], [role="button"], [data-comment-card], [data-connector-blob], [data-gap-bubble]';
/** Presses here never start a selection box: the header (slides, controls) and the composer. */
/** Room kept between a card glided to and the edges of the comment area. */
const CARD_MARGIN = 24;
const NO_BOX = `${KEEPS_PANEL}, [data-timeline-header], [data-composer]`;

/** How fast the minimap folds. */
const MINIMAP_FOLD_MS = 200;

/** Slides grow to at least this width when a drawing tool is picked. */
const DRAW_MIN_W = 640;
/** …and to this height while Folie 1 of a new deck shows the prompt to build it. */
const PROMPT_MIN_H = 560;
/** Less comment area than this left under the band counts as closed. */
const COMMENTS_CLOSED_H = 32;

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
export function Timeline({
  controls,
  findSlotRef,
}: {
  controls: ReactNode;
  /** Gets the split handle's spot, where the find bar docks (`null` while there is no handle). */
  findSlotRef?: (slot: HTMLElement | null) => void;
}) {
  const { slides, slideIndex, viewer, variantsOf, deck } = useViewerData();
  const editing = useEditing();
  const viewerState = useViewerState();
  const { split, activeSlideId, tool, threadPanelOpen, showMinimap } = viewerState;
  const sidePanelOpen = isSidePanelOpen(viewerState);
  const { deletedSlides } = useRevisionData();
  const hasDeleted = deletedSlides.length > 0;
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const narrow = useIsNarrow();
  const wrapperRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controlsRowRef = useRef<HTMLDivElement>(null);
  // The split handle's spot: the find bar docks there (`findSlotRef`); it fits into the gap the
  // controls leave in the middle (`useHandleRoom`).
  const [handleSlot, setHandleSlot] = useState<HTMLElement | null>(null);
  const slotRef = useCallback(
    (slot: HTMLElement | null) => {
      setHandleSlot(slot);
      findSlotRef?.(slot);
    },
    [findSlotRef],
  );
  useHandleRoom(handleSlot, controlsRowRef);
  const boxRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const foldRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<SizeAnchor | null>(null);
  const [connectorLayer, setConnectorLayer] = useState<HTMLDivElement | null>(null);
  const [initialSlideId] = useState(activeSlideId);
  // A new deck opens on Folie 0 (`OPEN_ON_BOARD`): its material goes there first.
  const location = useLocation();
  const [openOnBoard] = useState(() => opensOnBoard(location.state));
  // A split drag resizes from here: the viewer store only gets the split on release, so the
  // rest of the viewer (controls, panels, avatars) doesn't re-render with every frame of it.
  const [draggedSplit, setDraggedSplit] = useState<number | null>(null);
  const shownSplit = draggedSplit ?? split;

  const metrics = useTimelineMetrics(wrapperRef, scrollerRef, controlsRef, foldRef);
  // More tracks than the slides', swiped into the band: one per variant over them and the speaker
  // notes under them – not on phones, not in a template (its slides are its layouts).
  const ownTracks = !narrow && !deck.template;
  const mostVariants = useMemo(
    () => Math.max(0, ...[...variantsOf.values()].map((list) => list.length)),
    [variantsOf],
  );
  const stack = useMemo(
    () => (ownTracks ? trackStack(mostVariants, editing.available) : { above: 0, below: 0 }),
    [ownTracks, mostVariants, editing.available],
  );
  // The minimap folds in JS: band height and slide height change in the same frame (measuring
  // the band would lag a frame behind it and make the slides judder). The slides take exactly
  // the height the band gives up, so the comment area doesn't move.
  const fold = useFoldProgress(showMinimap, MINIMAP_FOLD_MS);
  const foldH = Math.round(fold * MINIMAP_ROW_H);
  // The frames' shapes: the slides' own, or 16:9 in the wide view.
  const { aspectRatios } = useFrameAspects();
  const geometry = useMemo(
    () =>
      metrics &&
      computeTrackGeometry({
        aspectRatios,
        viewportW: metrics.viewportW,
        viewportH: metrics.viewportH,
        controlsH: metrics.controlsH + MINIMAP_ROW_H,
        freedH: MINIMAP_ROW_H - foldH,
        narrow,
      }),
    [aspectRatios, metrics, foldH, narrow],
  );
  // Whole pixels: the track, the header and the comment area stay on crisp edges.
  const slideH = geometry && Math.round(slideHeightAt(narrow ? null : shownSplit, geometry));
  const swipe = useTrackSwipe(stack, slideH ?? 0);
  // „Variante erstellen“ from the right-click menu, a copy opened, the AI done with one.
  useVariantFlow(swipe.go, stack.above > 0);
  // For the dots in the gaps: memoised, so a gap only renders again when the track changes.
  const trackDots = useMemo(
    () => ({ stack, track: swipe.track, go: swipe.go }),
    [stack, swipe.track, swipe.go],
  );
  // What the handle leaves of the comment area: next to nothing closes it (see `commentsClosed`).
  const commentsClosed =
    !narrow &&
    !!metrics &&
    !!slideH &&
    metrics.viewportH - TRACK_PAD_TOP - slideH - metrics.controlsH - foldH < COMMENTS_CLOSED_H;
  useEffect(() => {
    dispatch({ type: 'commentsClosedSet', closed: commentsClosed });
  }, [dispatch, commentsClosed]);
  // Folie 0, „Material“: the board before slide 1 – every deck has one, a template none.
  const hasBoard = !deck.template;
  const layout = useMemo(
    () =>
      slideH
        ? layoutTrack(
            aspectRatios,
            slideH,
            hasDeleted ? trailingWidth(slideH) : 0,
            hasBoard ? leadingWidth(slideH) : 0,
          )
        : null,
    [aspectRatios, slideH, hasDeleted, hasBoard],
  );

  // Comments selected as the decks in "Präsentationen" are: a box drawn over them on the comment
  // area's background, ⌘/⇧-click, ⌘A, Esc. Only the threads the filters show count.
  const { bySlide, byGap } = useCommentThreads();
  const visibleThreads = useMemo(() => {
    const seen = new Map<string, Thread>();
    for (const slide of slides)
      for (const thread of bySlide.get(slide.id) ?? []) seen.set(thread.id, thread);
    for (const list of byGap.values()) for (const thread of list) seen.set(thread.id, thread);
    return [...seen.values()];
  }, [slides, bySlide, byGap]);
  const visibleIds = useMemo(() => visibleThreads.map((thread) => thread.id), [visibleThreads]);
  const selection = useMultiSelect(visibleIds);
  const selectedThreads = useMemo(
    () => visibleThreads.filter((thread) => selection.selected.has(thread.id)),
    [visibleThreads, selection.selected],
  );
  // A box just drawn: the click that ends it isn't a click on the background.
  const boxDrawn = useRef(false);
  const marquee = useMarqueeSelect(contentRef, boxRef, {
    attribute: 'data-comment-card',
    ignore: NO_BOX,
    scroller: scrollerRef,
    ...selection.marquee,
    onStart: (additive) => {
      boxDrawn.current = true;
      selection.marquee.onStart(additive);
    },
  });
  // The cards are memoised: they get a stable click handler and re-render only on a new selection.
  const [selectionMenuAt, setSelectionMenuAt] = useState<{ x: number; y: number } | null>(null);
  const latest = useRef({
    click: selection.onModifiedClick as CommentSelection['onModifiedClick'],
    menu: (() => {}) as CommentSelection['onContextMenuCapture'],
  });
  useEffect(() => {
    // Phones have no handle to grow the bar out of: no selection there.
    latest.current.click = narrow ? () => false : selection.onModifiedClick;
    latest.current.menu = (threadId, event) => {
      const { selected } = selection;
      if (narrow || event.shiftKey || selected.size < 2 || !selected.has(threadId)) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectionMenuAt({ x: event.clientX, y: event.clientY });
    };
  });
  const onModifiedClick = useCallback<CommentSelection['onModifiedClick']>(
    (threadId, event) => latest.current.click(threadId, event),
    [],
  );
  const onContextMenuCapture = useCallback<CommentSelection['onContextMenuCapture']>(
    (threadId, event) => latest.current.menu(threadId, event),
    [],
  );
  const commentSelection = useMemo<CommentSelection>(
    () => ({ selected: selection.selected, onModifiedClick, onContextMenuCapture }),
    [selection.selected, onModifiedClick, onContextMenuCapture],
  );

  useTimelineWheel({
    scrollerRef,
    geometry,
    anchorRef,
    enabled: !narrow,
    onTrackWheel: swipe.wheel,
  });
  // Space held and dragging, or the middle button: the hand.
  useHandPan({ scrollerRef, enabled: !narrow });
  // Space tapped twice: the active slide at 100 %, and back.
  useZoomToggle(!narrow);

  useLayoutEffect(() => {
    registry.setScroller(scrollerRef.current);
    return () => registry.setScroller(null);
  }, [registry]);
  useLayoutEffect(() => {
    registry.setLayout(layout ? { layout, slideIndex, snap: narrow } : null);
  }, [registry, layout, slideIndex, narrow]);

  // Windowing: only slides (and columns) within a viewport left and right are rendered.
  const [range, setRange] = useState<Range>({ first: 0, last: -1 });
  const slideOrder = useMemo(() => slides.map((slide) => slide.id).join(), [slides]);
  const shownOrder = useRef(slideOrder);
  /** The active slide's left edge on screen (px from the track's), as last seen. */
  const activeAt = useRef<{ slideId: string; viewportX: number } | null>(null);
  const scrollLeftRef = useRef(0);
  const prevLayout = useRef<TrackLayout | null>(null);
  const clientW = metrics?.clientW ?? 0;

  const updateRange = useEffectEvent(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !layout) return;
    scrollLeftRef.current = scroller.scrollLeft;
    // Where the active slide is on screen – kept there when the slides change around it. Not from
    // a layout of slides not yet taken in (the reorder below takes it then).
    const index = activeSlideId ? slideIndex.get(activeSlideId) : undefined;
    const box = index === undefined ? undefined : layout.slides[index];
    if (activeSlideId && box && slideOrder === shownOrder.current)
      activeAt.current = { slideId: activeSlideId, viewportX: box.x - scroller.scrollLeft };
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
      // Deep link (`?slide=`): centred on the first paint, without animation. A new deck: the
      // board before slide 1.
      if (openOnBoard && layout.leading) registry.scrollTrackTo(0, 'instant');
      else if (initialSlideId)
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
  }, [layout, clientW, registry, initialSlideId, openOnBoard]);

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

  // A comment picked (its mark on the slide, a list, a search hit): the comment area glides to its
  // card, as the slide glides into view – only when the card is not fully in view already.
  const { focusedThreadId } = viewerState;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!focusedThreadId || !scroller) return;
    // After the frame that dims the others and lays the cards out.
    const frame = requestAnimationFrame(() => {
      const card = scroller.querySelector<HTMLElement>(
        `[data-comment-card="${CSS.escape(focusedThreadId)}"]`,
      );
      if (!card) return;
      const view = scroller.getBoundingClientRect();
      const header = scroller.querySelector<HTMLElement>('[data-timeline-header]');
      const top = Math.max(view.top, header?.getBoundingClientRect().bottom ?? view.top);
      const box = card.getBoundingClientRect();
      let dy = 0;
      if (box.top < top + CARD_MARGIN) dy = box.top - top - CARD_MARGIN;
      else if (box.bottom > view.bottom - CARD_MARGIN)
        // Its top stays in view when it is taller than the room.
        dy = Math.min(box.bottom - view.bottom + CARD_MARGIN, box.top - top - CARD_MARGIN);
      let dx = 0;
      if (box.left < view.left + CARD_MARGIN) dx = box.left - view.left - CARD_MARGIN;
      else if (box.right > view.right - CARD_MARGIN && box.width < view.width)
        dx = box.right - view.right + CARD_MARGIN;
      if (Math.abs(dy) < 1 && Math.abs(dx) < 1) return;
      scroller.scrollTo({
        top: scroller.scrollTop + dy,
        left: scroller.scrollLeft + dx,
        behavior: smoothScroll(),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedThreadId]);

  // A new revision reorders the track, someone else puts a slide in before it: the active slide
  // (kept by its id) stays where it is on screen – no glide away and back – else in view.
  const revealActive = useEffectEvent(() => {
    if (!activeSlideId) return;
    const at = activeAt.current;
    const index = slideIndex.get(activeSlideId);
    const box = index === undefined ? undefined : layout?.slides[index];
    if (at?.slideId === activeSlideId && box)
      registry.scrollTrackTo(box.x - at.viewportX, 'instant');
    else registry.revealSlide(activeSlideId, { behavior: 'instant', align: 'nearest' });
    // The slides rendered around it from where the track is now – before this frame paints, else
    // the active one is out of the window for a frame and fades in anew.
    updateRange();
  });
  useLayoutEffect(() => {
    if (shownOrder.current === slideOrder || !layout) return;
    shownOrder.current = slideOrder;
    revealActive();
  }, [slideOrder, layout]);

  // Picking a drawing tool grows small slides to a comfortable drawing size, around the slide
  // most in view. No scrolling otherwise: every slide takes the tool.
  const growForDrawing = useEffectEvent(() => {
    if (narrow || !geometry || !layout || !activeSlideId) return;
    const index = slideIndex.get(activeSlideId);
    const box = index === undefined ? undefined : layout.slides[index];
    if (!box || box.w >= DRAW_MIN_W) return;
    // The frame's shape, not the slide's: in the wide view they differ.
    const target = splitForWidth(DRAW_MIN_W, box.w / layout.h, geometry);
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

  // Folie 1's prompt to build a new deck (`CreatePrompt`) needs room: the slides grow to it once,
  // the track's left edge kept where it is (the board, when the deck opened there).
  const creationPrompt = useDeckCreation(deck.id, !deck.template).data?.prompt ?? false;
  const showsPrompt = creationPrompt && editing.available && slides.length === 1;
  const growForPrompt = useEffectEvent(() => {
    if (narrow || !geometry || !layout || layout.h >= PROMPT_MIN_H) return;
    const target = splitForHeight(PROMPT_MIN_H, geometry);
    if (slideHeightAt(target, geometry) <= layout.h + 0.5) return;
    const scroller = scrollerRef.current;
    if (scroller) anchorRef.current = { contentX: scroller.scrollLeft, viewportX: 0 };
    dispatch({ type: 'splitChanged', split: target });
  });
  const hasLayout = layout !== null;
  useEffect(() => {
    if (showsPrompt && hasLayout) growForPrompt();
  }, [showsPrompt, hasLayout]);

  const context = useMemo(
    () => geometry && layout && { geometry, layout, anchorRef, scrollerRef },
    [geometry, layout],
  );

  // A click on the comment area's background (not on a card or control) closes the thread panel.
  const onCommentAreaClick = (event: MouseEvent<HTMLDivElement>) => {
    if (boxDrawn.current) {
      boxDrawn.current = false;
      return;
    }
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
        // Selected comments and the selection box in the viewer's own colour.
        style={selectionStyle(viewer.author.color)}
        className={cn(
          'absolute inset-0 overflow-auto overscroll-contain [container-type:inline-size] [scrollbar-color:var(--color-surface-4)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]',
          narrow && 'snap-x snap-mandatory [scroll-padding-inline:16px]',
        )}
      >
        {/* The dot grid lives on the content, so it scrolls (and pans) with the cards. With a
            side panel open the content runs on by the panel's room (12 + 400 + 12 gap), so the
            last slides can scroll clear of it – `revealSlide` already aims that far. */}
        <div
          ref={contentRef}
          onMouseDown={
            narrow
              ? undefined
              : (event) => {
                  boxDrawn.current = false;
                  marquee.onMouseDown(event);
                }
          }
          className={cn(
            'relative isolate min-h-full min-w-full bg-canvas',
            layout && 'w-(--content-w)',
            layout && sidePanelOpen && 'md:w-[calc(var(--content-w)+424px)]',
          )}
          style={layout ? ({ '--content-w': `${layout.contentW}px` } as CSSProperties) : undefined}
        >
          {/* Connector lines: in the content, so they scroll sideways with slides and cards in
              the same frame; sticky, so vertically they stay with the header's marks. */}
          {/* The dots belong to the comment area: none round the slides and thumbnails (Folie 0's
              own dots stand for themselves), faded in over the controls row, full below. Sticky,
              under everything (`isolate`), so cards and lines scroll over it. */}
          {slideH !== null && metrics && (
            <div aria-hidden className="pointer-events-none sticky top-0 -z-1 h-0">
              <div
                className="dot-grid absolute inset-x-0 top-0"
                style={{
                  height: metrics.viewportH,
                  maskImage: `linear-gradient(to bottom, transparent ${TRACK_PAD_TOP + slideH + foldH}px, black ${TRACK_PAD_TOP + slideH + foldH + metrics.controlsH}px)`,
                }}
              />
            </div>
          )}
          <div
            ref={setConnectorLayer}
            data-connector-layer
            className="pointer-events-none sticky top-0 z-(--z-sticky) h-0"
          />
          {/* Sticky header in two parts: the opaque track under the connector lines, and the
              see-through band over them – lines, cards and the dot grid show behind its glass
              controls and thumbnails. The comment area starts where the split handle puts it. */}
          <div
            data-timeline-header
            className="sticky top-0 z-(--z-overlay) bg-canvas"
            style={{ paddingTop: TRACK_PAD_TOP }}
          >
            {layout && context ? (
              <TimelineContext value={context}>
                <TrackDotsContext value={trackDots}>
                  <Track layout={layout} range={range} snap={narrow} stack={stack} swipe={swipe} />
                </TrackDotsContext>
              </TimelineContext>
            ) : (
              <div style={{ height: slideH ?? 0 }} />
            )}
          </div>
          {/* Minimap, controls row and split handle: one band of fixed height right under the
              track, part of where the comment area starts. Connector lines pass behind all of it.
              Slides and comments run on behind a side panel; this band makes room for it (its
              own container, so the controls row's container queries see the narrowed width).
              Over the track, yet the pointer passes through it except on its controls: a slide
              element reaching past the slide's bottom edge is still grabbed there – its border,
              corners and turning handle (the track's overflow lies under this band). */}
          <div
            ref={controlsRef}
            data-timeline-header
            data-connector-occluder
            className={cn(
              'pointer-events-none sticky left-0 z-(--z-chrome) w-[100cqw] pt-2 pb-2 transition-[padding] duration-300 @container',
              sidePanelOpen && 'md:pr-[412px]',
            )}
            style={{ top: TRACK_PAD_TOP + (slideH ?? 0) }}
          >
            {/* Thumbnails line up with the big track's slides (TRACK_PAD_X minus MINIMAP_PAD).
                Hidden (button left of the slide counter), it folds smoothly (`useFoldProgress`):
                the band shrinks frame by frame and the slides grow by the same amount, so the
                comments stay put. Stays mounted. */}
            <div
              ref={foldRef}
              inert={!showMinimap}
              // `invisible` once folded: hidden, it is out of the a11y tree.
              className={cn('overflow-hidden px-3', fold === 0 && 'invisible')}
              style={{ height: foldH, opacity: fold }}
            >
              <Minimap layout={layout} scrollerRef={scrollerRef} narrow={narrow} />
            </div>
            {/* Same gap below the thumbnails as above them (track to minimap), and the same
                edges: TRACK_PAD_X, like the slides and thumbnails. The split handle sits centred
                in the controls row, behind it: the row lets the pointer through except on its
                controls, so where they would overlap on a narrow band the controls win. */}
            <div className="relative px-4 pt-2">
              {geometry && slideH && !narrow && (
                // The find bar, the voice bar and the comment selection morph out of the handle and
                // take its place while open, its ends still sticking out beside them to drag; the
                // voice bar gives way to the others, the selection to the find bar and a hint.
                <div
                  ref={slotRef}
                  // Only what sits in it takes the pointer (the band lets it through).
                  className="absolute inset-x-0 top-2 bottom-0 flex items-center justify-center *:pointer-events-auto [&:has([data-handle-hint])>[data-split-handle]]:invisible [&:has([data-find-bar],[data-handle-hint],[data-comment-selection])>[data-voice-bar]]:invisible [&:has([data-find-bar],[data-handle-hint])>[data-comment-selection]]:invisible"
                >
                  <SplitHandle
                    geometry={geometry}
                    slideH={slideH}
                    split={shownSplit}
                    onDrag={setDraggedSplit}
                  />
                  <CommentSelectionBar
                    threads={selectedThreads}
                    onClear={selection.clear}
                    menuAt={selectionMenuAt}
                    onMenuClose={() => setSelectionMenuAt(null)}
                  />
                </div>
              )}
              <div
                ref={controlsRowRef}
                className="pointer-events-none relative [&>*>*]:pointer-events-auto"
              >
                {controls}
              </div>
            </div>
          </div>
          {layout && context && (
            <TimelineContext value={context}>
              <CommentSelectionContext value={commentSelection}>
                <CommentColumns layout={layout} range={range} narrow={narrow} />
              </CommentSelectionContext>
            </TimelineContext>
          )}
          {marquee.active && <SelectionBox ref={boxRef} raised />}
        </div>
      </div>
      <ConnectorLines wrapperRef={wrapperRef} layer={connectorLayer} />
      {/* „Variante erstellen“ on a phone: no variant tracks, the tile's field in a sheet. */}
      <VariantSheet />
    </main>
  );
}
