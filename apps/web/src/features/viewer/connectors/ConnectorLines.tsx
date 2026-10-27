import { memo, useEffect, useId, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { accentColor } from '@/lib/accent';
import { useIsNarrow } from '@/ui';
import { threadsOf, useCommentThreads } from '../comments/hooks/useCommentThreads';
import {
  useConnectorLayout,
  type ConnectorItem,
  type ConnectorLine,
  type ConnectorRoute,
} from './hooks/useConnectorLayout';
import {
  connectorAnchor,
  connectorExits,
  fadesDone,
  gapKey,
  sortThreadsClockwise,
  type Thread,
} from '../comments/lib/comment-selectors';
import { useMarkPreview } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useHoveredThreadId, useViewerState } from '../state/viewer-state';

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
 * Lines are drawn for every slide, all at the same strength – whichever slide the pointer is over.
 * Only the thread actually hovered or focused stands out; the other lines step back.
 * Lines take the author's accent and pass behind cards and marks, the minimap's thumbnails and
 * the glass controls row. Hidden on narrow screens.
 *
 * The lines live inside the scrolled content (the connector layer), so horizontal scrolling
 * moves them natively.
 */
export const ConnectorLines = memo(function ConnectorLines({
  wrapperRef,
  layer,
}: ConnectorLinesProps) {
  const { slides } = useViewerData();
  const { focusedThreadId, draft, threadPanelOpen, statusFilter } = useViewerState();
  const hoveredThreadId = useHoveredThreadId();
  const { bySlide, byGap } = useCommentThreads();
  // A box being dragged: its line leaves it where it is shown, not where it is stored.
  const preview = useMarkPreview();
  const narrow = useIsNarrow();
  const maskId = `connector-mask-${useId().replace(/[^\w-]/g, '')}`;
  const enabled = !narrow;

  const { routes, threadMap } = useMemo(() => {
    const byId = new Map<string, Thread>();
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
      result.push({
        slideId: slide.id,
        prevGapKey: prev ? gapKey(prev.id, slide.id) : null,
        nextGapKey,
        items,
      });
    }
    return { routes: result, threadMap: byId };
  }, [slides, bySlide, byGap, preview]);

  const panelThreadId = threadPanelOpen ? focusedThreadId : null;
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const lines = useConnectorLayout({ layer, svg, routes, enabled });

  const keyboardThreadId = useFocusedCard(wrapperRef);

  if (!enabled || !layer) return null;

  return createPortal(
    // Height, path data and cutouts are set by `useConnectorLayout`, straight on the DOM.
    <svg
      ref={setSvg}
      aria-hidden
      data-connectors
      className="absolute inset-x-0 top-0 h-0 w-full overflow-hidden"
    >
      <ConnectorMask id={maskId} />
      <g mask={`url(#${maskId})`}>
        <ConnectorPaths
          lines={lines}
          threadMap={threadMap}
          dimmed={!!draft}
          fadeDone={fadesDone(statusFilter)}
          panelThreadId={panelThreadId}
          emphasisId={focusedThreadId ?? hoveredThreadId ?? keyboardThreadId}
        />
      </g>
    </svg>,
    layer,
  );
});

/** One path per line – re-rendered only when the lines or their emphasis change. */
const ConnectorPaths = memo(function ConnectorPaths({
  lines,
  threadMap,
  dimmed,
  fadeDone,
  panelThreadId,
  emphasisId,
}: {
  lines: readonly ConnectorLine[];
  threadMap: ReadonlyMap<string, Thread>;
  /** A draft is open: every line steps back. */
  dimmed: boolean;
  /** Done threads' lines step back – not while only done ones are shown. */
  fadeDone: boolean;
  panelThreadId: string | null;
  emphasisId: string | null;
}) {
  const opacityOf = (threadId: string) => {
    const base = fadeDone && threadMap.get(threadId)?.root.status === 'done' ? 0.5 : 1;
    if (dimmed) return 0.3;
    // B4: the open thread stays, the others step back half-way.
    if (panelThreadId) return threadId === panelThreadId ? base : Math.min(base, 0.5);
    // B3: hover / focus highlights one line.
    if (emphasisId) return threadId === emphasisId ? base : 0.3;
    return base;
  };
  return lines.map((line) => (
    <path
      key={line.threadId}
      data-connector-id={line.threadId}
      // Lets the comments' intro draw the line with a dash of length 1 (index.css).
      pathLength={1}
      fill="none"
      strokeWidth={2}
      strokeLinejoin="round"
      className="transition-opacity duration-200"
      // CSS (not the presentation attribute) so the colour may be a `var()`.
      style={{ stroke: line.color, opacity: opacityOf(line.threadId) }}
    />
  ));
});

/** Mask region: generous, the layer is as wide as the whole deck. */
const MASK_EXTENT = 1e6;

/**
 * The lines' mask: the marks on the slides and the visible cards cut out (into
 * `[data-connector-cutouts]`, by `useConnectorLayout`), so lines pass behind them. Minimap and
 * controls band cover the lines themselves, above the connector layer.
 */
const ConnectorMask = memo(function ConnectorMask({ id }: { id: string }) {
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
        <g data-connector-cutouts />
      </mask>
    </defs>
  );
});

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deferred = () => {
      clearTimeout(timer);
      timer = setTimeout(update);
    };
    board.addEventListener('focusin', update);
    board.addEventListener('focusout', deferred);
    return () => {
      clearTimeout(timer);
      board.removeEventListener('focusin', update);
      board.removeEventListener('focusout', deferred);
    };
  }, [areaRef]);
  return threadId;
}
