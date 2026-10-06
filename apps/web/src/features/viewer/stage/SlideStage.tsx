import { Fragment, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useActiveSlide } from '../hooks/useActiveSlide';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import { gapKey } from '../lib/comment-selectors';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { GapDivider } from './GapDivider';
import { SlideFrame } from './SlideFrame';
import { GAP_DIVIDER_PX, slideWidthCss, STAGE_GAP_PX } from './stage-layout';

/**
 * Horizontal, scroll-snapping row of slides (BER-95). The active slide sits at the left, the
 * next one peeks in from the right. Slide items are memoised and only receive the props that
 * concern them, so scrolling or hovering doesn't re-render a 100+ slide deck.
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
          gap: STAGE_GAP_PX,
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
            width: `max(0px, calc(100cqw - 2 * var(--stage-pad) - ${slideWidthCss(lastSlide.aspectRatio)} - ${2 * STAGE_GAP_PX + GAP_DIVIDER_PX}px))`,
          }}
        />
      )}
    </div>
  );
}
