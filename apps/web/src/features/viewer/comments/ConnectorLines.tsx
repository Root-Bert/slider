import { useEffect, useId, useMemo, useState, type RefObject } from 'react';
import { accentColor } from '@/lib/accent';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import {
  useConnectorLayout,
  type ConnectorItem,
  type ConnectorRoute,
  type PanelLink,
} from '../hooks/useConnectorLayout';
import { useIsNarrow } from '../hooks/useMediaQuery';
import {
  connectorAnchor,
  gapKey,
  sortThreadsClockwise,
  type Thread,
} from '../lib/comment-selectors';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

interface ConnectorLinesProps {
  /** The timeline wrapper: the overlay covers it and all coordinates are relative to it. */
  wrapperRef: RefObject<HTMLElement | null>;
}

/**
 * One SVG overlay with the lines between marks and their cards (B1), or the thread blob and the
 * thread panel (B4). Lines are drawn for the active slide, the hovered slide and the slide of the
 * hovered or focused thread – the other slides only show their marks, so the timeline stays
 * readable. Lines take the author's accent, fade out behind the control row and pass behind
 * cards and marks. Hidden on narrow screens.
 */
export function ConnectorLines({ wrapperRef }: ConnectorLinesProps) {
  const { slides, slideIndex, threadById } = useViewerData();
  const {
    activeSlideId,
    hoveredSlideId,
    focusedThreadId,
    hoveredThreadId,
    draft,
    threadPanelOpen,
  } = useViewerState();
  const { bySlide, byGap } = useCommentThreads();
  const narrow = useIsNarrow();
  const maskId = `connector-fade-${useId().replace(/[^\w-]/g, '')}`;
  const enabled = !narrow;

  const ownerOf = (threadId: string | null) => {
    const root = threadId ? threadById.get(threadId)?.root : undefined;
    if (!root) return null;
    if (root.anchor.type !== 'gap') return root.slideId;
    return root.anchor.afterSlideId ?? root.anchor.beforeSlideId;
  };
  const hoveredOwner = ownerOf(hoveredThreadId);
  const focusedOwner = ownerOf(focusedThreadId);

  const routed = useMemo(
    () =>
      [...new Set([activeSlideId, hoveredSlideId, hoveredOwner, focusedOwner])].filter(
        (id): id is string => id !== null && slideIndex.has(id),
      ),
    [activeSlideId, hoveredSlideId, hoveredOwner, focusedOwner, slideIndex],
  );

  const { routes, threadMap } = useMemo(() => {
    const byId = new Map<string, Thread>();
    const result: ConnectorRoute[] = [];
    for (const slideId of routed) {
      const index = slideIndex.get(slideId)!;
      const slide = slides[index]!;
      const nextGapKey = gapKey(slide.id, slides[index + 1]?.id ?? null);
      const prev = slides[index - 1];
      const items: ConnectorItem[] = [];
      for (const thread of sortThreadsClockwise(threadsOf(bySlide, slide.id), slide.shapes)) {
        const mark = connectorAnchor(thread.root, slide.shapes);
        byId.set(thread.id, thread);
        if (mark)
          items.push({
            threadId: thread.id,
            color: accentColor(thread.root.author.color),
            source: { kind: 'mark', anchor: mark },
          });
      }
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
      result.push({
        slideId,
        prevGapKey: prev ? gapKey(prev.id, slide.id) : null,
        nextGapKey,
        items,
      });
    }
    return { routes: result, threadMap: byId };
  }, [routed, slides, slideIndex, bySlide, byGap]);

  const panelThreadId = threadPanelOpen ? focusedThreadId : null;
  const { lines, fade, cutouts, panelLink } = useConnectorLayout({
    wrapperRef,
    routes,
    enabled,
    panelThreadId,
  });

  const keyboardThreadId = useFocusedCard(wrapperRef);

  if (!enabled || lines.length === 0) return null;

  const emphasisId = focusedThreadId ?? hoveredThreadId ?? keyboardThreadId;
  const opacityOf = (threadId: string) => {
    const base = threadMap.get(threadId)?.root.status === 'done' ? 0.5 : 1;
    if (draft) return 0.3;
    // B4: the open thread stays, the others step back half-way.
    if (panelThreadId) return threadId === panelThreadId ? base : Math.min(base, 0.5);
    // B3: hover / focus highlights one line.
    if (emphasisId) return threadId === emphasisId ? base : 0.3;
    return base;
  };

  const first = fade[0];
  const last = fade.at(-1);
  const span = first && last ? Math.max(1, last.y - first.y) : 1;

  return (
    <>
      <svg
        aria-hidden
        data-connectors
        className="pointer-events-none absolute inset-0 z-[25] size-full overflow-hidden"
      >
        {first && (
          <defs>
            <linearGradient
              id={`${maskId}-gradient`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1={first.y}
              x2="0"
              y2={first.y + span}
            >
              {fade.map((stop, index) => (
                <stop
                  key={index}
                  offset={(stop.y - first.y) / span}
                  stopColor="white"
                  stopOpacity={stop.opacity}
                />
              ))}
            </linearGradient>
          </defs>
        )}
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <rect width="100%" height="100%" fill={first ? `url(#${maskId}-gradient)` : 'white'} />
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
        <g mask={`url(#${maskId})`}>
          {lines.map((line) => (
            <path
              key={line.threadId}
              data-connector-id={line.threadId}
              d={line.d}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className="transition-opacity duration-200"
              // CSS (not the presentation attribute) so the colour may be a `var()`.
              style={{ stroke: line.color, opacity: opacityOf(line.threadId) }}
            />
          ))}
          {panelLink && (
            <path
              data-connector-panel={panelLink.threadId}
              d={panelLink.d}
              fill="none"
              strokeWidth={3}
              strokeLinejoin="round"
              style={{
                stroke: panelLink.color,
                filter: `drop-shadow(0 0 6px ${panelLink.color})`,
              }}
            />
          )}
        </g>
      </svg>
      {panelLink && <PanelDock link={panelLink} />}
    </>
  );
}

/**
 * Where the panel link docks (Figma 112:759, 120:735): a 4×40 pill on the panel's left edge and
 * a 3px rail up that edge into the root message. The panel is fixed and above <main>, so this is
 * a fixed overlay of its own in viewport coordinates.
 */
function PanelDock({ link }: { link: PanelLink }) {
  const { x, y, railTop, rootLeft } = link.dock;
  const railX = x + 1.5;
  const radius = rootLeft === null ? 0 : Math.min(8, Math.max(0, y - railTop), rootLeft - railX);
  const rail =
    rootLeft === null
      ? `M${railX} ${y}V${railTop}`
      : `M${railX} ${y}V${railTop + radius}Q${railX} ${railTop} ${railX + radius} ${railTop}H${rootLeft}`;
  return (
    <svg
      aria-hidden
      data-connector-dock
      className="pointer-events-none fixed inset-0 z-[41] size-full overflow-visible max-md:hidden"
      style={{ filter: `drop-shadow(0 0 6px ${link.color})` }}
    >
      {railTop < y && <path d={rail} fill="none" strokeWidth={3} style={{ stroke: link.color }} />}
      <rect x={x} y={y - 20} width={4} height={40} rx={2} style={{ fill: link.color }} />
    </svg>
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
