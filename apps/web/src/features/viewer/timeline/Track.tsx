import { Fragment } from 'react';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import { gapKey } from '../lib/comment-selectors';
import type { TrackLayout } from '../lib/timeline-layout';
import { DeletedSlidesEntry } from '../revisions/DeletedSlidesEntry';
import { GapDivider } from '../stage/GapDivider';
import { SlideFrame } from '../stage/SlideFrame';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

interface TrackProps {
  layout: TrackLayout;
  /** Rendered slide indices (windowing) – the rest of the deck only reserves its width. */
  range: { first: number; last: number };
  /** Phones snap slide by slide: every slide needs a snap target, rendered or not. */
  snap: boolean;
}

/**
 * The deck as a horizontal track: every slide side by side, filling the track's height (set by
 * the split handle), with a ⊕ divider after each slide (shown on hover). Slide items are
 * memoised and only get the props that concern them, so hovering or scrolling a 100+ slide
 * deck doesn't re-render it.
 */
export function Track({ layout, range, snap }: TrackProps) {
  const { slides, gapThreads, canComment, canInsertSlides } = useViewerData();
  const {
    activeSlideId,
    tool,
    color,
    draft,
    focusedThreadId,
    hoveredThreadId,
    showChanges,
    showShapes,
    showGuides,
  } = useViewerState();
  const { badges, deletedSlides, deletedThreads, revisionNumber } = useRevisionData();
  const { bySlide } = useCommentThreads();
  const emphasisId = focusedThreadId ?? hoveredThreadId;
  const draftGapKey =
    draft?.anchor.type === 'gap'
      ? gapKey(draft.anchor.afterSlideId, draft.anchor.beforeSlideId)
      : null;
  // The track is exactly as tall as the slides – no empty band above or below them – and the
  // divider lines span its full height.
  const height = layout.h;

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
          top={0}
          w={box.w}
          h={layout.h}
          isActive={slide.id === activeSlideId}
          threads={threads}
          emphasisId={ownsEmphasis ? emphasisId : null}
          draft={draft?.slideId === slide.id ? draft : null}
          tool={canComment ? tool : null}
          canSelect={canComment && tool === null}
          color={color}
          badge={showChanges ? (badges.get(slide.id) ?? null) : null}
          badgeVersion={revisionNumber}
          showShapes={showShapes}
          showGuides={showGuides}
        />
        <GapDivider
          gapKey={key}
          x={gap.x}
          top={0}
          width={gap.w}
          height={height}
          afterSlideId={slide.id}
          beforeSlideId={next?.id ?? null}
          threads={gapThreads.get(key)}
          isDrafting={draftGapKey === key}
          canComment={canComment}
          canInsert={canInsertSlides}
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
      {layout.trailing && deletedSlides.length > 0 && (
        <DeletedSlidesEntry
          deletedSlides={deletedSlides}
          commentCount={[...deletedThreads.values()].reduce((sum, list) => sum + list.length, 0)}
          x={layout.trailing.x}
          w={layout.trailing.w}
          h={layout.h}
        />
      )}
    </div>
  );
}
