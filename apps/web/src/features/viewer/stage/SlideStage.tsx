import {
  Fragment,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useActiveSlide } from '../hooks/useActiveSlide';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import { gapKey } from '../lib/comment-selectors';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { GapDivider } from './GapDivider';
import { SlideFrame } from './SlideFrame';
import { GAP_DIVIDER_PX, slideWidthCss, STAGE_GAP } from './stage-layout';

/**
 * Horizontal, scroll-snapping row of slides (BER-95). The active slide sits at the left, the
 * next one peeks in from the right. Zoom works like a timeline (BER-96): it only scales the
 * slides – zoomed out, more of the following slides fit beside the active one, which stays put.
 * Slide items are memoised and only receive the props that concern them, so scrolling or
 * hovering doesn't re-render a 100+ slide deck.
 */
export function SlideStage() {
  const { slides, gapThreads, canComment } = useViewerData();
  const { activeSlideId, zoom, tool, color, draft, focusedThreadId, hoveredThreadId } =
    useViewerState();
  const { bySlide } = useCommentThreads();
  const registry = useStageRegistry();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [initialSlideId] = useState(activeSlideId);

  const slideIds = useMemo(() => slides.map((slide) => slide.id), [slides]);
  useActiveSlide(scrollerRef, slideIds);

  useLayoutEffect(() => {
    registry.setScroller(scrollerRef.current);
    // Deep link (`?slide=`): jump there before the first paint.
    if (initialSlideId) registry.scrollToSlide(initialSlideId, 'instant');
    return () => registry.setScroller(null);
  }, [registry, initialSlideId]);

  // Keep the active slide anchored at the left edge while zooming – before paint, so neither
  // the user nor the active-slide observer ever sees an intermediate scroll position. If a
  // thumbnail click or ←/→ is still scrolling there, anchor its target instead: the active slide
  // is somewhere in between, and the instant scroll ends that animation. The observer only
  // reports the jump a frame later, so until the active slide changes, further zoom steps (slider
  // drag, wheel burst) keep the slide anchored before.
  const anchoredSlideId = useRef<string | null>(null);
  useEffect(() => {
    anchoredSlideId.current = null;
  }, [activeSlideId]);
  const anchorActiveSlide = useEffectEvent(() => {
    const slideId = registry.getScrollTarget() ?? anchoredSlideId.current ?? activeSlideId;
    if (!slideId) return null;
    registry.scrollToSlide(slideId, 'instant');
    anchoredSlideId.current = slideId;
    return slideId;
  });
  const anchoredZoom = useRef(zoom);
  useLayoutEffect(() => {
    if (anchoredZoom.current === zoom) return;
    anchoredZoom.current = zoom;
    const slideId = anchorActiveSlide();
    if (!slideId) return;
    // Chrome still applies the last frame of an aborted smooth scroll after the jump, leaving
    // the row a few dozen pixels off the snap point – put it back once that frame is through.
    const frame = requestAnimationFrame(() => registry.scrollToSlide(slideId, 'instant'));
    return () => cancelAnimationFrame(frame);
  }, [zoom, registry]);

  const emphasisId = focusedThreadId ?? hoveredThreadId;
  const draftGapKey =
    draft?.anchor.type === 'gap'
      ? gapKey(draft.anchor.afterSlideId, draft.anchor.beforeSlideId)
      : null;
  const lastSlide = slides.at(-1);

  return (
    <div
      ref={scrollerRef}
      role="region"
      aria-roledescription="Folienansicht"
      aria-label="Folien"
      className="scrollbar-none flex snap-x snap-mandatory items-start overflow-x-auto overscroll-x-contain px-[var(--stage-pad)] pt-[var(--stage-pad)] pb-4 [container-type:inline-size] [scroll-padding-inline:var(--stage-pad)]"
      style={
        {
          '--slide-h': `calc(min(552px, 56dvh) * ${zoom})`,
          gap: STAGE_GAP,
        } as CSSProperties
      }
    >
      {slides.map((slide, index) => {
        const next = slides[index + 1] ?? null;
        const key = gapKey(slide.id, next?.id ?? null);
        const ownsEmphasis =
          emphasisId !== null && threadsOf(bySlide, slide.id).some((t) => t.id === emphasisId);
        return (
          <Fragment key={slide.id}>
            <SlideFrame
              slide={slide}
              index={index}
              total={slides.length}
              isActive={slide.id === activeSlideId}
              threads={threadsOf(bySlide, slide.id)}
              emphasisId={ownsEmphasis ? emphasisId : null}
              draft={draft?.slideId === slide.id ? draft : null}
              tool={canComment ? tool : null}
              color={color}
            />
            <GapDivider
              gapKey={key}
              afterSlideId={slide.id}
              beforeSlideId={next?.id ?? null}
              threads={gapThreads.get(key)}
              isDrafting={draftGapKey === key}
              canComment={canComment}
            />
          </Fragment>
        );
      })}
      {lastSlide && (
        // Lets the last slide snap to the left edge like all others.
        <div
          aria-hidden
          className="shrink-0"
          style={{
            width: `max(0px, calc(100cqw - ${slideWidthCss(lastSlide.aspectRatio)} - 2 * ${STAGE_GAP} - ${GAP_DIVIDER_PX}px))`,
          }}
        />
      )}
    </div>
  );
}
