import { useEffect, useId, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { accentColor } from '@/lib/accent';
import { useIsNarrow } from '@/ui';
import { threadsOf, useCommentThreads } from '../comments/hooks/useCommentThreads';
import {
  useConnectorLayout,
  type ConnectorItem,
  type ConnectorLayout,
  type ConnectorRoute,
} from './hooks/useConnectorLayout';
import {
  connectorAnchor,
  connectorExits,
  gapKey,
  sortThreadsClockwise,
  type Thread,
} from '../comments/lib/comment-selectors';
import { useMarkPreview } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

interface ConnectorLinesProps {
  /** The timeline wrapper (outside the scroller): keyboard focus on its cards highlights lines. */
  wrapperRef: RefObject<HTMLElement | null>;
  /**
   * The connector layer: a zero-height sticky element at the top of the scrolled content. The
   * lines' SVG is portalled into it, so they scroll sideways together with slides and cards.
   */
  layer: HTMLElement | null;
}

/**
 * The lines between marks and their cards (B1).
 * Lines are drawn for every slide, all at full strength. While a slide or a thread is hovered or
 * a thread focused, the lines of that slide stay; the others step back half-way, like the lines
 * of the other threads while one is open.
 * Lines take the author's accent and pass behind cards and marks, the minimap's thumbnails and
 * the glass controls row. Hidden on narrow screens.
 *
 * The lines live inside the scrolled content (the connector layer), so horizontal scrolling
 * moves them natively.
 */
export function ConnectorLines({ wrapperRef, layer }: ConnectorLinesProps) {
  const { slides, threadById } = useViewerData();
  const { hoveredSlideId, focusedThreadId, hoveredThreadId, draft, threadPanelOpen } =
    useViewerState();
  const { bySlide, byGap } = useCommentThreads();
  // A box being dragged: its line leaves it where it is shown, not where it is stored.
  const preview = useMarkPreview();
  const narrow = useIsNarrow();
  const maskId = `connector-mask-${useId().replace(/[^\w-]/g, '')}`;
  const enabled = !narrow;

  const ownerOf = (threadId: string | null) => {
    const root = threadId ? threadById.get(threadId)?.root : undefined;
    if (!root) return null;
    if (root.anchor.type !== 'gap') return root.slideId;
    return root.anchor.afterSlideId ?? root.anchor.beforeSlideId;
  };
  const hoveredOwner = ownerOf(hoveredThreadId);
  const focusedOwner = ownerOf(focusedThreadId);

  const emphasized = useMemo(
    () =>
      new Set(
        [hoveredSlideId, hoveredOwner, focusedOwner].filter((id): id is string => id !== null),
      ),
    [hoveredSlideId, hoveredOwner, focusedOwner],
  );

  const { routes, threadMap, slideOf } = useMemo(() => {
    const byId = new Map<string, Thread>();
    const owner = new Map<string, string>();
    const result: ConnectorRoute[] = [];
    for (const [index, slide] of slides.entries()) {
      const nextGapKey = gapKey(slide.id, slides[index + 1]?.id ?? null);
      const prev = slides[index - 1];
      const items: ConnectorItem[] = [];
      const threads = sortThreadsClockwise(
        threadsOf(bySlide, slide.id),
        slide.shapes,
        slide.aspectRatio,
      );
      const marks = threads.map((thread) => {
        byId.set(thread.id, thread);
        const root =
          preview?.threadId === thread.id
            ? {
                ...thread.root,
                anchor: { type: 'rect' as const, rect: preview.rect, shapeRef: null },
              }
            : thread.root;
        return connectorAnchor(root, slide.shapes);
      });
      const exits = connectorExits(marks, slide.aspectRatio);
      threads.forEach((thread, markIndex) => {
        const mark = marks[markIndex];
        const exit = exits[markIndex];
        if (mark && exit)
          items.push({
            threadId: thread.id,
            color: accentColor(thread.root.author.color),
            source: { kind: 'mark', anchor: mark, exit },
          });
      });
      const gap = byGap.get(nextGapKey);
      const first = gap?.[0];
      if (first) {
        for (const thread of gap) byId.set(thread.id, thread);
        items.push({
          threadId: first.id,
          color: accentColor(first.root.author.color),
          source: { kind: 'gap', gapKey: nextGapKey },
        });
      }
      if (items.length === 0) continue;
      for (const item of items) owner.set(item.threadId, slide.id);
      result.push({
        slideId: slide.id,
        prevGapKey: prev ? gapKey(prev.id, slide.id) : null,
        nextGapKey,
        items,
      });
    }
    return { routes: result, threadMap: byId, slideOf: owner };
  }, [slides, bySlide, byGap, preview]);

  const panelThreadId = threadPanelOpen ? focusedThreadId : null;
  const layout = useConnectorLayout({
    layer,
    routes,
    enabled,
  });

  const keyboardThreadId = useFocusedCard(wrapperRef);

  const { lines, height } = layout;
  if (!enabled || !layer || lines.length === 0) return null;

  const emphasisId = focusedThreadId ?? hoveredThreadId ?? keyboardThreadId;
  const opacityOf = (threadId: string) => {
    const done = threadMap.get(threadId)?.root.status === 'done';
    const muted = emphasized.size > 0 && !emphasized.has(slideOf.get(threadId) ?? '');
    // Lines of slides out of focus step back half-way, like the other threads' lines in B4.
    const base = Math.min(done ? 0.5 : 1, muted ? 0.5 : 1);
    if (draft) return 0.3;
    // B4: the open thread stays, the others step back half-way.
    if (panelThreadId) return threadId === panelThreadId ? base : Math.min(base, 0.5);
    // B3: hover / focus highlights one line.
    if (emphasisId) return threadId === emphasisId ? base : 0.3;
    return base;
  };

  return createPortal(
    <svg
      aria-hidden
      data-connectors
      className="absolute inset-x-0 top-0 w-full overflow-hidden"
      style={{ height }}
    >
      <ConnectorMask id={maskId} layout={layout} />
      <g mask={`url(#${maskId})`}>
        {lines.map((line) => (
          <path
            key={line.threadId}
            data-connector-id={line.threadId}
            d={line.d}
            // Lets the comments' intro draw the line with a dash of length 1 (index.css).
            pathLength={1}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            className="transition-opacity duration-200"
            // CSS (not the presentation attribute) so the colour may be a `var()`.
            style={{ stroke: line.color, opacity: opacityOf(line.threadId) }}
          />
        ))}
      </g>
    </svg>,
    layer,
  );
}

/** Mask region: generous, the layer is as wide as the whole deck. */
const MASK_EXTENT = 1e6;

/**
 * The lines' mask: the marks on the slides and the visible cards cut out, so lines pass behind
 * them. Minimap and controls band cover the lines themselves, above the connector layer.
 */
function ConnectorMask({ id, layout }: { id: string; layout: ConnectorLayout }) {
  const { cutouts } = layout;
  return (
    <defs>
      <mask
        id={id}
        maskUnits="userSpaceOnUse"
        x={-MASK_EXTENT}
        y={-MASK_EXTENT}
        width={2 * MASK_EXTENT}
        height={2 * MASK_EXTENT}
      >
        <rect
          x={-MASK_EXTENT}
          y={-MASK_EXTENT}
          width={2 * MASK_EXTENT}
          height={2 * MASK_EXTENT}
          fill="white"
        />
        {/* Lines pass behind the marks on the slide. */}
        {cutouts.map((cutout, index) =>
          cutout.kind === 'circle' ? (
            <circle key={index} cx={cutout.cx} cy={cutout.cy} r={cutout.r} fill="black" />
          ) : cutout.kind === 'fill' ? (
            <rect
              key={index}
              x={cutout.box.left}
              y={cutout.box.top}
              width={cutout.box.right - cutout.box.left}
              height={cutout.box.bottom - cutout.box.top}
              rx={12}
              fill="black"
            />
          ) : cutout.kind === 'rect' ? (
            <rect
              key={index}
              x={cutout.box.left}
              y={cutout.box.top}
              width={cutout.box.right - cutout.box.left}
              height={cutout.box.bottom - cutout.box.top}
              rx={4}
              fill="none"
              stroke="black"
              strokeWidth={6}
            />
          ) : (
            <path
              key={index}
              d={cutout.d}
              transform={cutout.transform}
              fill="none"
              stroke="black"
              strokeWidth={cutout.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
      </mask>
    </defs>
  );
}

/** Thread id of the card holding keyboard focus (B3: focus highlights its line like hover). */
function useFocusedCard(areaRef: RefObject<HTMLElement | null>): string | null {
  const [threadId, setThreadId] = useState<string | null>(null);
  useEffect(() => {
    const board = areaRef.current;
    if (!board) return;
    const update = () => {
      const active = document.activeElement;
      const card =
        active instanceof HTMLElement && board.contains(active) && active.matches(':focus-visible')
          ? active.closest<HTMLElement>('[data-comment-card]')
          : null;
      setThreadId(card?.dataset.commentCard ?? null);
    };
    // `focusout` fires before focus lands elsewhere – read the new focus a task later.
    const deferred = () => setTimeout(update);
    board.addEventListener('focusin', update);
    board.addEventListener('focusout', deferred);
    return () => {
      board.removeEventListener('focusin', update);
      board.removeEventListener('focusout', deferred);
    };
  }, [areaRef]);
  return threadId;
}
