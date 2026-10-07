import { Fragment } from 'react';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import { gapKey } from '../lib/comment-selectors';
import type { TrackLayout } from '../lib/timeline-layout';
import { GapDivider } from '../stage/GapDivider';
import { SlideFrame } from '../stage/SlideFrame';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

const DIVIDER_MIN_H = 64;

interface TrackProps {
  layout: TrackLayout;
  /** Rendered slide indices (windowing) – the rest of the deck only reserves its width. */
  range: { first: number; last: number };
  height: number;
  /** Phones snap slide by slide: every slide needs a snap target, rendered or not. */
  snap: boolean;
}

/**
 * The deck as a horizontal track: every slide side by side at the zoomed size, centred in
 * a track of fixed height, with a ⊕ divider after each slide. Slide items are
 * memoised and only get the props that concern them, so hovering or scrolling a 100+ slide
 * deck doesn't re-render it.
 */
export function Track({ layout, range, height, snap }: TrackProps) {
  const { slides, gapThreads, canComment } = useViewerData();
  const { activeSlideId, tool, color, draft, focusedThreadId, hoveredThreadId } = useViewerState();
  const { bySlide } = useCommentThreads();
  const emphasisId = focusedThreadId ?? hoveredThreadId;
  const draftGapKey =
    draft?.anchor.type === 'gap'
      ? gapKey(draft.anchor.afterSlideId, draft.anchor.beforeSlideId)
      : null;
  // Slides are centred in the track, like a slide in PowerPoint's editing pane: at max zoom they
  // fill it (16px above and below, Figma D1), zoomed out the free height is split evenly instead
  // of piling up as one empty band above or below them.
  const top = Math.max(0, Math.round((height - layout.h) / 2));
  // The divider line spans the slides (never shorter than the ⊕ with its pauses), centred on them.
  const dividerH = Math.min(height, Math.max(layout.h, DIVIDER_MIN_H));
  const dividerTop = Math.min(Math.max(0, top + (layout.h - dividerH) / 2), height - dividerH);

  const items = [];
  for (let index = range.first; index <= range.last; index++) {
    const slide = slides[index];
    const box = layout.slides[index];
    const gap = layout.gaps[index];
    if (!slide || !box || !gap) continue;
    const next = slides[index + 1] ?? null;
    const key = gapKey(slide.id, next?.id ?? null);
    const threads = threadsOf(bySlide, slide.id);
    const ownsEmphasis = emphasisId !== null && threads.some((t) => t.id === emphasisId);
    items.push(
      <Fragment key={slide.id}>
        <SlideFrame
          slide={slide}
          index={index}
          total={slides.length}
          x={box.x}
          top={top}
          w={box.w}
          h={layout.h}
          isActive={slide.id === activeSlideId}
          threads={threads}
          emphasisId={ownsEmphasis ? emphasisId : null}
          draft={draft?.slideId === slide.id ? draft : null}
          tool={canComment ? tool : null}
          color={color}
        />
        <GapDivider
          gapKey={key}
          x={gap.x}
          top={dividerTop}
          width={gap.w}
          height={dividerH}
          afterSlideId={slide.id}
          beforeSlideId={next?.id ?? null}
          threads={gapThreads.get(key)}
          isDrafting={draftGapKey === key}
          canComment={canComment}
        />
      </Fragment>,
    );
  }

  // Without a snap target the browser would snap a reveal of an unrendered slide (minimap tap,
  // ←/→) back to the nearest rendered one.
  const snapTargets = snap
    ? layout.slides.map((box, index) =>
        index >= range.first && index <= range.last ? null : (
          <div
            key={index}
            aria-hidden
            className="pointer-events-none absolute top-0 h-px snap-start"
            style={{ left: box.x, width: box.w }}
          />
        ),
      )
    : null;

  return (
    <div
      data-track
      role="region"
      aria-roledescription="Folienleiste"
      aria-label="Folien"
      className="relative"
      style={{ width: layout.contentW, height }}
    >
      {snapTargets}
      {items}
    </div>
  );
}
