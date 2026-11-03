import type { Slide } from '@slider/shared';
import { Fragment, type ReactNode } from 'react';
import { threadsOf, useCommentThreads } from '../comments/hooks/useCommentThreads';
import { fadesDone, gapKey } from '../comments/lib/comment-selectors';
import type { TrackLayout, TrackStack } from './lib/timeline-layout';
import { DeletedSlidesEntry } from '../revisions/DeletedSlidesEntry';
import { GapDivider, gapButtons, gapDotsLift } from '../stage/GapDivider';
import { useLayers } from '../editing/layers/layers-context';
import { useEditing } from '../editing/editing-context';
import { SlideFrame } from '../stage/SlideFrame';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { isBoxModeActive, useHoveredThreadId, useViewerState } from '../state/viewer-state';
import type { TrackSwipe } from './hooks/useTrackSwipe';
import { GapDots } from './TrackDots';
import { SlideNotes, VariantBadge, VariantGhost, VariantNoteHint } from './TrackRows';

interface TrackProps {
  layout: TrackLayout;
  /** Rendered slide indices (windowing) – the rest of the deck only reserves its width. */
  range: { first: number; last: number };
  /** Phones snap slide by slide: every slide needs a snap target, rendered or not. */
  snap: boolean;
  /** The tracks over and under the slides', and which one the band shows. */
  stack: TrackStack;
  swipe: TrackSwipe;
}

/**
 * The deck as a horizontal track: every slide side by side, filling the track's height (set by
 * the split handle), with a ⊕ divider after each slide (shown on hover). Slide items are
 * memoised and only get the props that concern them, so hovering or scrolling a 100+ slide
 * deck doesn't re-render it.
 *
 * More tracks lie over and under it, as tall and wide as it (`trackStack`): one per variant over
 * it – each slide's first variant right over it, full size and edited like a slide, and over the
 * last one a „Variante erstellen“ – and the speaker notes under it. The band shows one track at a
 * time; paged (`useTrackSwipe`), its tracks slide up and down, clipped to the band, and only
 * then are the tracks beside it drawn.
 */
export function Track({ layout, range, snap, stack, swipe }: TrackProps) {
  const { slides, gapThreads, canComment, viewer, variantsOf } = useViewerData();
  // Editing: a click picks an element instead of starting a comment.
  const editing = useEditing();
  // „Ebenen“: the active slide shows taken apart in 3D – the others as they are, few planes to draw.
  const layers = useLayers();
  const {
    activeSlideId,
    tool,
    draft,
    focusedThreadId,
    showChanges,
    boxMode,
    boxModeFlipped,
    showGuides,
    showLayoutGrid,
    slideZooms,
    statusFilter,
  } = useViewerState();
  const hoveredThreadId = useHoveredThreadId();
  const boxes = isBoxModeActive({ boxMode, boxModeFlipped });
  const { badges, deletedSlides, deletedThreads, revisionNumber } = useRevisionData();
  const { marksBySlide } = useCommentThreads();
  const emphasisId = focusedThreadId ?? hoveredThreadId;
  const draftGapKey =
    draft?.anchor.type === 'gap'
      ? gapKey(draft.anchor.afterSlideId, draft.anchor.beforeSlideId)
      : null;
  // The track is exactly as tall as the slides – no empty band above or below them – and the
  // divider lines span its full height.
  const height = layout.h;
  const { track, moving, reach, attachBand } = swipe;

  /** A slide (or a variant) as a frame on a track. */
  const frame = (slide: Slide, index: number, box: { x: number; w: number }) => {
    const threads = threadsOf(marksBySlide, slide.id);
    const ownsEmphasis = emphasisId !== null && threads.some((t) => t.id === emphasisId);
    return (
      <SlideFrame
        slide={slide}
        index={index}
        total={slides.length}
        x={box.x}
        top={0}
        w={box.w}
        h={height}
        isActive={slide.id === activeSlideId}
        threads={threads}
        emphasisId={ownsEmphasis ? emphasisId : null}
        draft={draft?.slideId === slide.id ? draft : null}
        fadeDone={fadesDone(statusFilter)}
        tool={canComment ? tool : null}
        canSelect={canComment && tool === null && !editing.active}
        // Live, not captured once: picking a new colour mid-session changes pen and frames too.
        color={viewer.author.color}
        badge={showChanges ? (badges.get(slide.id) ?? null) : null}
        badgeVersion={revisionNumber}
        boxMode={boxes}
        showGuides={showGuides}
        showLayoutGrid={showLayoutGrid}
        zoom={slideZooms.get(slide.id) ?? null}
        layered={layers.open && slide.id === activeSlideId}
      />
    );
  };

  /** What track `level` holds over the slides shown (windowing). */
  const levelItems = (level: number): ReactNode[] => {
    const items: ReactNode[] = [];
    for (let index = range.first; index <= range.last; index++) {
      const slide = slides[index];
      const box = layout.slides[index];
      const gap = layout.gaps[index];
      if (!slide || !box || !gap) continue;
      const next = slides[index + 1] ?? null;
      // Tracks without the gaps' buttons still have the dots in them, where the slides' has.
      if (level !== 0) {
        const buttons = gapButtons({
          afterSlideId: slide.id,
          beforeSlideId: next?.id ?? null,
          canInsert: editing.available,
          canComment,
        }).count;
        items.push(
          <GapDots
            key={`dots:${slide.id}`}
            x={gap.x}
            width={gap.w}
            height={height}
            lift={gapDotsLift(buttons, gap.w)}
          />,
        );
      }
      if (level > 0) {
        items.push(
          <SlideNotes
            key={slide.id}
            slideId={slide.id}
            index={index}
            x={box.x}
            w={box.w}
            h={height}
          />,
        );
        continue;
      }
      if (level < 0) {
        const variants = variantsOf.get(slide.id) ?? [];
        const variant = variants[-level - 1];
        if (variant)
          items.push(
            <Fragment key={variant.id}>
              {frame(variant, index, box)}
              <VariantBadge
                variantId={variant.id}
                number={-level}
                x={box.x}
                w={box.w}
                canEdit={editing.available}
              />
            </Fragment>,
          );
        else if (editing.available && -level === variants.length + 1)
          items.push(
            <VariantGhost key={slide.id} slideId={slide.id} x={box.x} w={box.w} h={height} />,
          );
        continue;
      }
      const key = gapKey(slide.id, next?.id ?? null);
      items.push(
        <Fragment key={slide.id}>
          {frame(slide, index, box)}
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
            canInsert={editing.available}
          />
          {(variantsOf.get(slide.id)?.length ?? 0) > 0 && (
            <VariantNoteHint slideId={slide.id} x={box.x} h={height} />
          )}
        </Fragment>,
      );
    }
    if (level === 0 && layout.trailing && deletedSlides.length > 0)
      items.push(
        <DeletedSlidesEntry
          key="deleted"
          deletedSlides={deletedSlides}
          commentCount={[...deletedThreads.values()].reduce((sum, list) => sum + list.length, 0)}
          x={layout.trailing.x}
          w={layout.trailing.w}
          h={height}
        />,
      );
    return items;
  };

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

  // At rest the track shown alone, as before: no transform, nothing clipped – a slide's element
  // reaching past its edge is still grabbed there.
  const levels: number[] = [];
  for (let level = -stack.above; level <= stack.below; level++)
    if (level === track || reach.includes(level)) levels.push(level);

  return (
    <div
      ref={attachBand}
      data-track
      data-track-level={track}
      role="region"
      aria-roledescription="Folienleiste"
      aria-label="Folien"
      className="relative"
      style={{
        width: layout.contentW,
        height,
        // Clipped up and down only, while its tracks slide.
        clipPath: moving ? 'inset(0 -100vw)' : undefined,
      }}
    >
      {snapTargets}
      {levels.map((level) => (
        <div
          key={level}
          data-track-of={level}
          className="absolute inset-x-0 top-0"
          style={{
            height,
            // Moved by `useTrackSwipe` frame by frame (its spring), never by a CSS transition.
            transform: moving
              ? `translateY(calc(${(level - track) * height}px + var(--track-drag, 0px)))`
              : undefined,
          }}
        >
          {levelItems(level)}
        </div>
      ))}
    </div>
  );
}
