import { useMemo, type RefObject } from 'react';
import { cn } from '@/ui';
import { threadsOf, useCommentThreads } from '../hooks/useCommentThreads';
import { useConnectorLayout, type ConnectorItem } from '../hooks/useConnectorLayout';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { anchorRect } from '../lib/comment-selectors';
import { markColor } from '../lib/colors';
import { roundedPath } from '../lib/connector-routing';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

interface ConnectorLinesProps {
  containerRef: RefObject<HTMLElement | null>;
  boardRef: RefObject<HTMLElement | null>;
}

/**
 * One SVG overlay with all lines between marks on the active slide and their cards (B1).
 * Hidden on narrow screens and for slide-level / gap comments.
 */
export function ConnectorLines({ containerRef, boardRef }: ConnectorLinesProps) {
  const { slides } = useViewerData();
  const state = useViewerState();
  const { activeSlideId, focusedThreadId, hoveredThreadId, draft } = state;
  const { bySlide } = useCommentThreads();
  const narrow = useIsNarrow();
  const slide = slides.find((candidate) => candidate.id === activeSlideId);
  const threads = threadsOf(bySlide, activeSlideId);

  const items = useMemo<ConnectorItem[]>(() => {
    if (!slide) return [];
    return threads.flatMap((thread) => {
      const { anchor } = thread.root;
      const rect =
        anchor.type === 'point' || anchor.type === 'rect'
          ? anchorRect(thread.root, slide.shapes)
          : null;
      return rect ? [{ threadId: thread.id, rect, color: markColor(thread.root) }] : [];
    });
  }, [slide, threads]);

  const layoutKey = [
    state.zoom,
    state.filmstripOpen,
    state.threadPanelOpen,
    state.scope,
    state.statusFilter,
    state.pptxOnly,
  ].join('|');
  const connectors = useConnectorLayout({
    containerRef,
    boardRef,
    slideId: activeSlideId,
    items,
    enabled: !narrow,
    layoutKey,
  });

  if (narrow || connectors.length === 0) return null;
  const emphasisId = focusedThreadId ?? hoveredThreadId;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
    >
      {connectors.map((connector) => {
        const emphasized = connector.threadId === emphasisId;
        const dimmed = draft !== null || (emphasisId !== null && !emphasized);
        return (
          <path
            key={connector.threadId}
            d={roundedPath(connector.points)}
            fill="none"
            strokeWidth={emphasized ? 2 : 1.5}
            strokeLinejoin="round"
            className={cn('transition-opacity duration-200', dimmed ? 'opacity-20' : 'opacity-90')}
            style={{
              stroke: connector.color,
              filter: emphasized ? `drop-shadow(0 0 4px ${connector.color})` : undefined,
            }}
          />
        );
      })}
    </svg>
  );
}
