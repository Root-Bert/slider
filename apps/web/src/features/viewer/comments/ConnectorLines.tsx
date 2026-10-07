import { useEffect, useId, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { accentColor } from '@/lib/accent';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import {
  useConnectorLayout,
  type ConnectorItem,
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
  containerRef: RefObject<HTMLElement | null>;
  boardRef: RefObject<HTMLElement | null>;
}

/** Room above the cards for the bus rows: 18px below the controls, 10px per line, 20px above the cards. */
const busRoom = (lines: number) => Math.max(48, 18 + 10 * Math.max(0, lines - 1) + 20);

/**
 * One SVG overlay with all lines between marks on the active slide and their cards (B1), or the
 * thread blob and the thread panel (B4). Lines take the author's accent and fade out behind the
 * filmstrip and the control row (Figma gradient), so they never paint over thumbnails or pills.
 * Hidden on narrow screens and in "Alle Folien".
 */
export function ConnectorLines({ containerRef, boardRef }: ConnectorLinesProps) {
  const { slides } = useViewerData();
  const { activeSlideId, focusedThreadId, hoveredThreadId, draft, threadPanelOpen, scope } =
    useViewerState();
  const { bySlide } = useCommentThreads();
  const narrow = useIsNarrow();
  const maskId = `connector-fade-${useId().replace(/[^\w-]/g, '')}`;
  const enabled = !narrow && scope === 'slide';

  const slideIndex = slides.findIndex((candidate) => candidate.id === activeSlideId);
  const slide = slides[slideIndex];
  const nextSlideGapKey = slide ? gapKey(slide.id, slides[slideIndex + 1]?.id ?? null) : null;
  const threads = threadsOf(bySlide, activeSlideId);

  const { items, threadById } = useMemo(() => {
    const byId = new Map<string, Thread>();
    const result: ConnectorItem[] = [];
    if (!slide) return { items: result, threadById: byId };
    for (const thread of sortThreadsClockwise(threads, slide.shapes)) {
      const { anchor } = thread.root;
      const color = accentColor(thread.root.author.color);
      const mark = connectorAnchor(thread.root, slide.shapes);
      byId.set(thread.id, thread);
      if (mark) {
        result.push({ threadId: thread.id, color, source: { kind: 'mark', anchor: mark } });
      } else if (
        anchor.type === 'gap' &&
        gapKey(anchor.afterSlideId, anchor.beforeSlideId) === nextSlideGapKey
      ) {
        result.push({
          threadId: thread.id,
          color,
          source: { kind: 'gap', gapKey: nextSlideGapKey },
        });
      }
    }
    return { items: result, threadById: byId };
  }, [slide, threads, nextSlideGapKey]);

  const panelThreadId = threadPanelOpen ? focusedThreadId : null;
  const { lines, fade, cutouts, panelLink } = useConnectorLayout({
    containerRef,
    boardRef,
    slideId: activeSlideId,
    nextSlideGapKey,
    items,
    enabled,
    panelThreadId,
  });

  // The board's top padding holds one bus row per line.
  const room = enabled ? busRoom(items.length) : null;
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    if (room === null) board.style.removeProperty('--connector-room');
    else board.style.setProperty('--connector-room', `${room}px`);
  }, [boardRef, room]);

  const keyboardThreadId = useFocusedCard(boardRef);

  if (!enabled || lines.length === 0) return null;

  const emphasisId = focusedThreadId ?? hoveredThreadId ?? keyboardThreadId;
  const opacityOf = (threadId: string) => {
    const base = threadById.get(threadId)?.root.status === 'done' ? 0.5 : 1;
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
        className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
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
        </g>
        {panelLink && (
          <path
            data-connector-panel={panelLink.threadId}
            d={`M${panelLink.from.x} ${panelLink.from.y}H${panelLink.toX}`}
            fill="none"
            strokeWidth={3}
            style={{
              stroke: panelLink.color,
              filter: `drop-shadow(0 0 6px ${panelLink.color})`,
            }}
          />
        )}
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
function useFocusedCard(boardRef: RefObject<HTMLElement | null>): string | null {
  const [threadId, setThreadId] = useState<string | null>(null);
  useEffect(() => {
    const board = boardRef.current;
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
  }, [boardRef]);
  return threadId;
}
