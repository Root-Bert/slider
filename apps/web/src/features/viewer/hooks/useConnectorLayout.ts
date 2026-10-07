import { useEffect, useState, type RefObject } from 'react';
import type { ConnectorAnchor } from '../lib/comment-selectors';
import {
  fadeStops,
  layoutBlobConnectors,
  layoutConnectors,
  panelLinkPoints,
  roundedPath,
  type Box,
  type ConnectorRequest,
  type FadeStop,
  type Px,
} from '../lib/connector-routing';
import { rafThrottle } from '../lib/dom';
import { useStageRegistry } from '../state/stage-registry';

export interface ConnectorItem {
  threadId: string;
  color: string;
  /** A mark on the slide, or – for comments in the gap right of the slide – the gap key. */
  source: { kind: 'mark'; anchor: ConnectorAnchor } | { kind: 'gap'; gapKey: string };
}

/** One slide whose lines are drawn: its marks → its comment column (and its gap's bubble). */
export interface ConnectorRoute {
  slideId: string;
  /** Divider left of the slide (`null` for the first slide) and right of it. */
  prevGapKey: string | null;
  nextGapKey: string;
  items: ConnectorItem[];
}

export interface MeasuredConnector {
  threadId: string;
  color: string;
  /** SVG path data, relative to the timeline wrapper. */
  d: string;
}

/** The thick line from the focused thread (blob or card) to the thread panel (B4). */
export interface PanelLink {
  threadId: string;
  color: string;
  from: Px;
  /** Path from the thread to the panel's left edge (detours around other columns' cards). */
  d: string;
  /**
   * Dock pill and rail inside the panel, in viewport coordinates (the panel is fixed): the rail
   * runs up the panel's left edge from the link to the root message's middle.
   */
  dock: { x: number; y: number; railTop: number; rootLeft: number | null };
}

/** Shapes the lines pass behind – cut out of the lines' mask. */
export type Cutout =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; box: Box }
  | { kind: 'fill'; box: Box }
  | { kind: 'path'; d: string; transform: string; width: number };

export interface ConnectorLayout {
  lines: MeasuredConnector[];
  /** Opacity profile along y that hides the lines behind the controls row. */
  fade: FadeStop[];
  cutouts: Cutout[];
  panelLink: PanelLink | null;
}

const EMPTY: ConnectorLayout = { lines: [], fade: [], cutouts: [], panelLink: null };

/** Lines enter the card next to its avatar. */
const CARD_ENTRY_X = 26;
const COMPACT_ENTRY_X = 18;
/** Bus rows start this far below the control pills and end this far above the cards. */
const BUS_BELOW_CONTROLS = 18;
const BUS_ABOVE_CARDS = 20;
/** The panel link leaves the blob / card at the middle of its first 96px (Figma blob +49). */
const PANEL_LINK_Y = 48;
/** A panel link blocked by other cards detours this far below the sticky header … */
const PANEL_LANE_BELOW_HEADER = 8;
/** … and drops to the dock this far left of the panel (when there is no scrollbar gutter). */
const PANEL_ENTRY_INSET = 4;
/** Lines to lower bands run down the half-gap beside the column, this far from both edges. */
const MARGIN_INSET = 4;
/** Lanes of the first slide stay this far right of the timeline's left edge. */
const FIRST_SLIDE_CORRIDOR = 12;
/** A card whose top is hidden under the header gets no line. */
const VISIBLE_SLACK = 4;
/** Gap kept around a mark the lines pass behind. */
const CUTOUT_PAD = 2;

const relative = (rect: DOMRect, origin: DOMRect): Box => ({
  left: rect.left - origin.left,
  right: rect.right - origin.left,
  top: rect.top - origin.top,
  bottom: rect.bottom - origin.top,
});

const centreX = (element: Element, origin: DOMRect) => {
  const rect = element.getBoundingClientRect();
  return (rect.left + rect.right) / 2 - origin.left;
};

/**
 * Measures marks, cards and the control row of every routed slide and routes the connector
 * lines between them. Each slide routes in its own corridor – from the middle of the gap before
 * it to the middle of the gap after it – so lines of different slides never cross. Coordinates
 * are relative to the timeline wrapper (the overlay's box). Re-measures, batched to one per
 * frame, when the timeline scrolls (both axes), anything in it resizes or moves, the thread
 * panel slides, or the window resizes. A passive effect on purpose: the wrapper is an ancestor,
 * and ancestor refs are attached after child layout effects run.
 */
export function useConnectorLayout({
  wrapperRef,
  routes,
  enabled,
  panelThreadId,
}: {
  wrapperRef: RefObject<HTMLElement | null>;
  routes: readonly ConnectorRoute[];
  enabled: boolean;
  /** Focused thread while the thread panel is open. */
  panelThreadId: string | null;
}): ConnectorLayout {
  const registry = useStageRegistry();
  const [layout, setLayout] = useState<ConnectorLayout>(EMPTY);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const scroller = registry.getScroller();
    const panel = () => document.querySelector<HTMLElement>('[data-thread-panel]');

    const measure = () => {
      if (!enabled || !wrapper || !scroller || routes.length === 0) {
        setLayout((current) => (current === EMPTY ? current : EMPTY));
        return;
      }
      const origin = wrapper.getBoundingClientRect();
      const stage = relative(scroller.getBoundingClientRect(), origin);
      const controlsElement = wrapper.querySelector('[data-connector-occluder="controls"]');
      const controls = controlsElement
        ? relative(controlsElement.getBoundingClientRect(), origin)
        : null;
      const header = wrapper.querySelector('[data-timeline-header]');
      // Top of the visible comment area: everything above it is the sticky header.
      const commentTop = header ? header.getBoundingClientRect().bottom - origin.top : 0;
      const busTop = (controls?.bottom ?? commentTop) + BUS_BELOW_CONTROLS;
      const visible = (box: Box) => box.bottom > commentTop && box.top < stage.bottom;
      const clipped = (box: Box): Box => ({ ...box, top: Math.max(box.top, commentTop) });

      const lines: MeasuredConnector[] = [];
      const cutouts: Cutout[] = [];
      const colorOf = new Map<string, string>();
      let panelSource: Box | null = null;
      let panelExitX = 0;
      const obstacles: Box[] = [];

      // Lines (and the panel link) pass behind every visible card, bubble and blob.
      const area = scroller.querySelector('[data-comment-area]');
      for (const element of area?.querySelectorAll(
        '[data-comment-card], [data-connector-blob], [data-gap-bubble]',
      ) ?? []) {
        const box = relative(element.getBoundingClientRect(), origin);
        if (visible(box) && box.right > stage.left && box.left < stage.right) {
          cutouts.push({ kind: 'fill', box: clipped(box) });
          obstacles.push(box);
        }
      }

      for (const route of routes) {
        for (const item of route.items) colorOf.set(item.threadId, item.color);
        const slideElement = registry.getSlideElement(route.slideId);
        if (!slideElement) continue;
        const slideRect = slideElement.getBoundingClientRect();
        const slide = relative(slideRect, origin);
        const column = scroller.querySelector<HTMLElement>(
          `[data-column="${CSS.escape(route.slideId)}"]`,
        );
        const prevGap = route.prevGapKey ? registry.getGapElement(route.prevGapKey) : null;
        const nextGap = registry.getGapElement(route.nextGapKey);
        const corridor = {
          left: prevGap ? centreX(prevGap, origin) : slide.left - FIRST_SLIDE_CORRIDOR,
          right: nextGap ? centreX(nextGap, origin) : slide.right + FIRST_SLIDE_CORRIDOR,
        };

        // Cards of this column; lower brick bands are reached through the half-gaps.
        const cards = new Map<string, Box>();
        const compact = column?.dataset.mode === 'compact';
        const bandTops = new Map<string, number>();
        const placements = new Map<string, { band: string; margin: string | undefined }>();
        if (column) {
          for (const card of column.querySelectorAll<HTMLElement>('[data-comment-card]')) {
            const box = relative(card.getBoundingClientRect(), origin);
            cards.set(card.dataset.commentCard!, box);
          }
          for (const brick of column.querySelectorAll<HTMLElement>('[data-brick]')) {
            const { brick: id, band = '0', margin } = brick.dataset;
            const top = brick.getBoundingClientRect().top - origin.top;
            bandTops.set(band, Math.min(bandTops.get(band) ?? top, top));
            placements.set(id!, { band, margin });
          }
        }
        const marginOf = (threadId: string): ConnectorRequest['margin'] | null => {
          const placement = placements.get(threadId);
          if (placement?.margin !== 'left' && placement?.margin !== 'right') return undefined;
          const bandTop = bandTops.get(placement.band)!;
          // The turn-in above a band scrolled under the header can't be drawn.
          if (bandTop < commentTop + 30) return null;
          return { side: placement.margin, bandTop };
        };

        const blobElement = column?.querySelector<HTMLElement>('[data-connector-blob]');
        const blob = blobElement ? relative(blobElement.getBoundingClientRect(), origin) : null;
        if (panelThreadId && route.items.some((item) => item.threadId === panelThreadId)) {
          panelSource = blob ?? cards.get(panelThreadId) ?? null;
          panelExitX = corridor.right;
        }

        const requests: ConnectorRequest[] = [];
        for (const item of route.items) {
          if (item.source.kind === 'gap') {
            // Straight down the divider from its marker to the gap bubble.
            const marker = nextGap?.querySelector('[data-gap-marker]');
            const bubble = scroller.querySelector(
              `[data-gap-bubble="${CSS.escape(item.source.gapKey)}"]`,
            );
            if (!marker || !bubble) continue;
            const x = centreX(marker, origin);
            const from = marker.getBoundingClientRect().bottom - origin.top;
            const box = relative(bubble.getBoundingClientRect(), origin);
            if (box.top < commentTop + VISIBLE_SLACK) continue;
            lines.push({
              threadId: item.threadId,
              color: item.color,
              d: `M${x} ${from}V${box.top}`,
            });
            continue;
          }
          const card = cards.get(item.threadId);
          // With the blob, every line ends there (the target is set by the routing).
          if (!blob && (!card || card.top < commentTop + VISIBLE_SLACK)) continue;
          const margin = card && !blob ? marginOf(item.threadId) : undefined;
          if (margin === null) continue;
          const entry = compact ? COMPACT_ENTRY_X : CARD_ENTRY_X;
          const target = card ? { x: card.left + entry, y: card.top } : { x: 0, y: 0 };
          const { anchor } = item.source;
          const x = (value: number) => slide.left + value * slideRect.width;
          const y = (value: number) => slide.top + value * slideRect.height;
          // Mark scrolled out of the timeline: no line.
          const centre = (x(anchor.left) + x(anchor.right)) / 2;
          if (centre < stage.left || centre > stage.right) continue;
          requests.push({
            id: item.threadId,
            anchor: { left: x(anchor.left), right: x(anchor.right) },
            start: {
              left: { x: x(anchor.start.left.x) - anchor.inset.left, y: y(anchor.start.left.y) },
              right: {
                x: x(anchor.start.right.x) + anchor.inset.right,
                y: y(anchor.start.right.y),
              },
            },
            target,
            margin,
          });
        }
        if (requests.length === 0) {
          cutouts.push(...measureCutouts(slideElement, origin));
          continue;
        }

        let routed;
        if (blob) {
          if (blob.top < commentTop + VISIBLE_SLACK) continue;
          routed = layoutBlobConnectors(requests, { slide, corridor, blob });
        } else {
          const cardsTop = Math.min(...requests.map((request) => request.target.y));
          const columnBox = column ? relative(column.getBoundingClientRect(), origin) : null;
          const margins = columnBox && {
            left: { from: corridor.left + MARGIN_INSET, to: columnBox.left - MARGIN_INSET },
            right: { from: columnBox.right + MARGIN_INSET, to: corridor.right - MARGIN_INSET },
          };
          routed = layoutConnectors(requests, {
            slide,
            corridor,
            busTop,
            busBottom: Math.max(busTop, cardsTop - BUS_ABOVE_CARDS),
            obstacles: cards,
            margins: margins ?? undefined,
          });
        }
        for (const connector of routed)
          lines.push({
            threadId: connector.id,
            color: colorOf.get(connector.id) ?? 'white',
            d: roundedPath(connector.points),
          });
        cutouts.push(...measureCutouts(slideElement, origin));
      }

      let panelLink: PanelLink | null = null;
      const panelElement = panelThreadId ? panel() : null;
      const source = panelSource;
      if (
        panelElement &&
        source &&
        visible(source) &&
        lines.some((line) => line.threadId === panelThreadId)
      ) {
        const toX = panelElement.getBoundingClientRect().left - origin.left;
        const height = Math.min(source.bottom - source.top, 2 * PANEL_LINK_Y);
        if (toX > source.right + 8) {
          const from = { x: source.right, y: source.top + height / 2 };
          // Back to the panel through the scrollbar gutter, where no card ever is.
          const gutter = scroller.offsetWidth - scroller.clientWidth;
          const entryX =
            gutter >= 6 ? stage.left + scroller.clientWidth + gutter / 2 : toX - PANEL_ENTRY_INSET;
          const d = roundedPath(
            panelLinkPoints(from, toX, obstacles, {
              exitX: panelExitX,
              laneY: commentTop + PANEL_LANE_BELOW_HEADER,
              entryX,
            }),
          );
          const panelBox = panelElement.getBoundingClientRect();
          const root = panelElement.querySelector('article')?.getBoundingClientRect();
          const history = panelElement
            .querySelector('[data-thread-history]')
            ?.getBoundingClientRect();
          const rootMiddle = root ? (root.top + root.bottom) / 2 : null;
          // Root scrolled out of the history: the rail ends at the history's top edge.
          const rootVisible = rootMiddle !== null && (!history || rootMiddle >= history.top);
          panelLink = {
            threadId: panelThreadId!,
            color: colorOf.get(panelThreadId!) ?? 'white',
            from,
            d,
            dock: {
              x: panelBox.left,
              y: from.y + origin.top,
              railTop: rootVisible ? rootMiddle : (history?.top ?? panelBox.top),
              rootLeft: rootVisible && root ? root.left : null,
            },
          };
        }
      }

      setLayout({ lines, fade: fadeStops(null, controls), cutouts, panelLink });
    };

    const throttled = rafThrottle(measure);
    throttled.schedule();

    const resizeObserver = new ResizeObserver(throttled.schedule);
    const observe = (element: Element | null | undefined) => {
      if (element) resizeObserver.observe(element);
    };
    observe(wrapper);
    observe(wrapper?.querySelector('[data-timeline-header]'));
    observe(wrapper?.querySelector('[data-comment-area]'));
    const panelElement = panel();
    observe(panelElement);
    // Slides, columns and cards move without resizing when zoom or the brick layout change:
    // watch their inline styles and the rendered window too.
    const mutationObserver = new MutationObserver(throttled.schedule);
    if (scroller)
      mutationObserver.observe(scroller, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style'],
      });
    scroller?.addEventListener('scroll', throttled.schedule, { passive: true });
    wrapper?.addEventListener('transitionend', throttled.schedule);
    panelElement?.addEventListener('transitionend', throttled.schedule);
    // The rail follows the root message when the thread history scrolls.
    panelElement?.addEventListener('scroll', throttled.schedule, { capture: true, passive: true });
    window.addEventListener('resize', throttled.schedule);

    return () => {
      throttled.cancel();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller?.removeEventListener('scroll', throttled.schedule);
      wrapper?.removeEventListener('transitionend', throttled.schedule);
      panelElement?.removeEventListener('transitionend', throttled.schedule);
      panelElement?.removeEventListener('scroll', throttled.schedule, { capture: true });
      window.removeEventListener('resize', throttled.schedule);
    };
  }, [wrapperRef, registry, routes, enabled, panelThreadId]);

  return layout;
}

/**
 * Mark shapes on a slide ([data-mark] in the annotation layer) as mask cutouts, so the lines run
 * behind pins, frames and drawings instead of over them.
 */
function measureCutouts(slideElement: HTMLElement, origin: DOMRect): Cutout[] {
  const cutouts: Cutout[] = [];
  for (const mark of slideElement.querySelectorAll<HTMLElement | SVGElement>('[data-mark]')) {
    const kind = mark.dataset.mark;
    if (kind === 'pin') {
      const dot = (mark.firstElementChild ?? mark).getBoundingClientRect();
      cutouts.push({
        kind: 'circle',
        cx: (dot.left + dot.right) / 2 - origin.left,
        cy: (dot.top + dot.bottom) / 2 - origin.top,
        r: Math.max(dot.width, dot.height) / 2 + CUTOUT_PAD,
      });
    } else if (kind === 'frame') {
      cutouts.push({ kind: 'rect', box: relative(mark.getBoundingClientRect(), origin) });
    } else if (kind === 'stroke' && mark instanceof SVGPathElement) {
      const svg = mark.ownerSVGElement?.getBoundingClientRect();
      if (!svg) continue;
      cutouts.push({
        kind: 'path',
        d: mark.getAttribute('d') ?? '',
        transform: `translate(${svg.left - origin.left} ${svg.top - origin.top}) scale(${svg.width} ${svg.height})`,
        width: Number(mark.getAttribute('stroke-width') ?? 2) + 2 * CUTOUT_PAD,
      });
    }
  }
  return cutouts;
}
