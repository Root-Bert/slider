import { useEffect, useState, type RefObject } from 'react';
import type { ConnectorAnchor } from '../lib/comment-selectors';
import {
  fadeStops,
  layoutBlobConnectors,
  layoutConnectors,
  roundedPath,
  type Band,
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
  /** A mark on the slide, or – for a comment in the gap right of the slide – the gap key. */
  source: { kind: 'mark'; anchor: ConnectorAnchor } | { kind: 'gap'; gapKey: string };
}

export interface MeasuredConnector {
  threadId: string;
  color: string;
  /** SVG path data, relative to the container. */
  d: string;
}

/** The thick line from the focused thread (blob or card) to the thread panel (B4). */
export interface PanelLink {
  threadId: string;
  color: string;
  from: Px;
  toX: number;
  /**
   * Dock pill and rail inside the panel, in viewport coordinates (the panel is fixed): the rail
   * runs up the panel's left edge from the link to the root message's middle.
   */
  dock: { x: number; y: number; railTop: number; rootLeft: number | null };
}

/** Marks on the active slide the lines pass behind – cut out of the lines' mask. */
export type Cutout =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; box: Box }
  | { kind: 'path'; d: string; transform: string; width: number };

export interface ConnectorLayout {
  lines: MeasuredConnector[];
  /** Opacity profile along y that hides the lines behind the filmstrip and the controls. */
  fade: FadeStop[];
  cutouts: Cutout[];
  panelLink: PanelLink | null;
}

const EMPTY: ConnectorLayout = { lines: [], fade: [], cutouts: [], panelLink: null };

/** Lines enter the card next to its avatar. */
const CARD_ENTRY_X = 26;
/** Bus rows start this far below the control row and end this far above the cards. */
const BUS_BELOW_CONTROLS = 18;
const BUS_ABOVE_CARDS = 20;
/** The panel link leaves the blob / card at the middle of its first 96px (Figma blob +49). */
const PANEL_LINK_Y = 48;
/** Lines to lower bands run down the margin beside the board, this far from both edges. */
const MARGIN_INSET = 8;
/** Gap kept around a mark the lines pass behind. */
const CUTOUT_PAD = 2;

const relative = (rect: DOMRect, origin: DOMRect): Box => ({
  left: rect.left - origin.left,
  right: rect.right - origin.left,
  top: rect.top - origin.top,
  bottom: rect.bottom - origin.top,
});

/**
 * Measures marks (on the active slide), cards, the filmstrip and control rows and routes the
 * connector lines between marks and cards. Purely geometry-driven: re-measures – batched to one
 * per frame – whenever any of these boxes resizes or moves (zoom, filters, inline threads, the
 * thread panel), on stage scroll and window resize. Coordinates are relative to `containerRef`,
 * so vertical page scrolling needs no work at all. A passive effect (not a layout effect) on
 * purpose: the container is an ancestor, and ancestor refs are attached after child layout
 * effects run.
 */
export function useConnectorLayout({
  containerRef,
  boardRef,
  slideId,
  nextSlideGapKey,
  items,
  enabled,
  panelThreadId,
}: {
  containerRef: RefObject<HTMLElement | null>;
  boardRef: RefObject<HTMLElement | null>;
  slideId: string | null;
  /** Gap right of the active slide: its divider bounds the right lanes. */
  nextSlideGapKey: string | null;
  items: readonly ConnectorItem[];
  enabled: boolean;
  /** Focused thread while the thread panel is open. */
  panelThreadId: string | null;
}): ConnectorLayout {
  const registry = useStageRegistry();
  const [layout, setLayout] = useState<ConnectorLayout>(EMPTY);

  useEffect(() => {
    const container = containerRef.current;
    const board = boardRef.current;
    const scroller = registry.getScroller();
    const slideElement = slideId ? registry.getSlideElement(slideId) : null;
    const gapElement = nextSlideGapKey ? registry.getGapElement(nextSlideGapKey) : null;
    const panel = () => document.querySelector<HTMLElement>('[data-thread-panel]');

    const measure = () => {
      if (!enabled || !container || !board || !scroller || !slideElement || items.length === 0) {
        setLayout((current) => (current === EMPTY ? current : EMPTY));
        return;
      }
      const origin = container.getBoundingClientRect();
      const slideRect = slideElement.getBoundingClientRect();
      const stage = scroller.getBoundingClientRect();
      const slide = relative(slideRect, origin);
      const gapX = gapElement
        ? (() => {
            const gap = gapElement.getBoundingClientRect();
            return (gap.left + gap.right) / 2 - origin.left;
          })()
        : null;

      const cards = new Map<string, Box>();
      for (const card of board.querySelectorAll<HTMLElement>('[data-comment-card]'))
        cards.set(card.dataset.commentCard!, relative(card.getBoundingClientRect(), origin));
      // Brick bands: cards below the first band are reached through a side margin.
      const bandTops = new Map<string, number>();
      const placements = new Map<string, { band: string; margin: string | undefined }>();
      for (const brick of board.querySelectorAll<HTMLElement>('[data-brick]')) {
        const { brick: id, band = '0', margin } = brick.dataset;
        const top = brick.getBoundingClientRect().top - origin.top;
        bandTops.set(band, Math.min(bandTops.get(band) ?? top, top));
        placements.set(id!, { band, margin });
      }
      const marginOf = (threadId: string): ConnectorRequest['margin'] => {
        const placement = placements.get(threadId);
        if (placement?.margin !== 'left' && placement?.margin !== 'right') return undefined;
        return { side: placement.margin, bandTop: bandTops.get(placement.band)! };
      };

      const blobElement = panelThreadId
        ? board.querySelector<HTMLElement>('[data-connector-blob]')
        : null;
      const blob = blobElement ? relative(blobElement.getBoundingClientRect(), origin) : null;

      const requests: ConnectorRequest[] = [];
      for (const item of items) {
        const card = cards.get(item.threadId);
        // With the blob, every line ends there (the target is set by the routing).
        if (!card && !blob) continue;
        const target = card ? { x: card.left + CARD_ENTRY_X, y: card.top } : { x: 0, y: 0 };
        const margin = card ? marginOf(item.threadId) : undefined;
        if (item.source.kind === 'gap') {
          const marker = gapElement?.querySelector('[data-gap-marker]');
          if (gapX === null || !marker) continue;
          const y = marker.getBoundingClientRect().bottom - origin.top;
          const start = { x: gapX, y };
          requests.push({
            id: item.threadId,
            anchor: { left: gapX, right: gapX },
            start: { left: start, right: start },
            target,
            fixedLaneX: gapX,
            margin,
          });
          continue;
        }
        const { anchor } = item.source;
        const x = (value: number) => slide.left + value * slideRect.width;
        const y = (value: number) => slide.top + value * slideRect.height;
        // Mark scrolled out of the stage: no line.
        const centre = (x(anchor.left) + x(anchor.right)) / 2 + origin.left;
        if (centre < stage.left || centre > stage.right) continue;
        requests.push({
          id: item.threadId,
          anchor: { left: x(anchor.left), right: x(anchor.right) },
          start: {
            left: { x: x(anchor.start.left.x) - anchor.inset.left, y: y(anchor.start.left.y) },
            right: { x: x(anchor.start.right.x) + anchor.inset.right, y: y(anchor.start.right.y) },
          },
          target,
          margin,
        });
      }

      const bandOf = (name: string): Band | null => {
        const element = container.querySelector(`[data-connector-occluder="${name}"]`);
        if (!element) return null;
        const box = relative(element.getBoundingClientRect(), origin);
        return box.bottom > box.top ? box : null;
      };
      const filmstrip = bandOf('filmstrip');
      const controls = bandOf('controls');
      const corridor = { left: stage.left - origin.left, right: gapX ?? stage.right - origin.left };

      let routed;
      if (blob) {
        routed = layoutBlobConnectors(requests, { slide, corridor, blob });
      } else {
        const busTop =
          (controls?.bottom ?? board.getBoundingClientRect().top - origin.top) + BUS_BELOW_CONTROLS;
        const cardsTop = Math.min(...requests.map((request) => request.target.y));
        const list = board.querySelector('[data-brick-list]');
        const content = list ? relative(list.getBoundingClientRect(), origin) : null;
        const margins = content && {
          left: { from: MARGIN_INSET, to: content.left - MARGIN_INSET },
          right: {
            from: content.right + MARGIN_INSET,
            to: content.right + content.left - MARGIN_INSET,
          },
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

      const colorOf = new Map(items.map((item) => [item.threadId, item.color]));
      const lines = routed.map((connector) => ({
        threadId: connector.id,
        color: colorOf.get(connector.id) ?? 'white',
        d: roundedPath(connector.points),
      }));

      let panelLink: PanelLink | null = null;
      const panelElement = panelThreadId ? panel() : null;
      const source = blob ?? (panelThreadId ? cards.get(panelThreadId) : undefined);
      if (panelElement && source && lines.some((line) => line.threadId === panelThreadId)) {
        const toX = panelElement.getBoundingClientRect().left - origin.left;
        const height = Math.min(source.bottom - source.top, 2 * PANEL_LINK_Y);
        if (toX > source.right + 8) {
          const from = { x: source.right, y: source.top + height / 2 };
          const panelBox = panelElement.getBoundingClientRect();
          const root = panelElement.querySelector('article')?.getBoundingClientRect();
          const history = panelElement
            .querySelector('[data-thread-history]')
            ?.getBoundingClientRect();
          const rootMiddle = root ? (root.top + root.bottom) / 2 : null;
          // Root scrolled out of the history: the rail ends at the history's top edge.
          const visible = rootMiddle !== null && (!history || rootMiddle >= history.top);
          panelLink = {
            threadId: panelThreadId!,
            color: colorOf.get(panelThreadId!) ?? 'white',
            from,
            toX,
            dock: {
              x: panelBox.left,
              y: from.y + origin.top,
              railTop: visible ? rootMiddle : (history?.top ?? panelBox.top),
              rootLeft: visible && root ? root.left : null,
            },
          };
        }
      }

      setLayout({
        lines,
        fade: fadeStops(filmstrip, controls),
        cutouts: measureCutouts(slideElement, origin),
        panelLink,
      });
    };

    const throttled = rafThrottle(measure);
    throttled.schedule();

    const resizeObserver = new ResizeObserver(throttled.schedule);
    const observe = (element: Element | null | undefined) => {
      if (element) resizeObserver.observe(element);
    };
    observe(container);
    observe(board);
    observe(slideElement);
    const panelElement = panel();
    observe(panelElement);
    container?.querySelectorAll('[data-connector-occluder]').forEach(observe);
    // Cards move without resizing when the brick layout reflows: watch their inline styles too.
    const mutationObserver = new MutationObserver(() => {
      board?.querySelectorAll('[data-comment-card], [data-connector-blob]').forEach(observe);
      throttled.schedule();
    });
    if (board) {
      board.querySelectorAll('[data-comment-card], [data-connector-blob]').forEach(observe);
      mutationObserver.observe(board, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style'],
      });
    }
    scroller?.addEventListener('scroll', throttled.schedule, { passive: true });
    container?.addEventListener('transitionend', throttled.schedule);
    panelElement?.addEventListener('transitionend', throttled.schedule);
    // The rail follows the root message when the thread history scrolls.
    panelElement?.addEventListener('scroll', throttled.schedule, { capture: true, passive: true });
    window.addEventListener('resize', throttled.schedule);

    return () => {
      throttled.cancel();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller?.removeEventListener('scroll', throttled.schedule);
      container?.removeEventListener('transitionend', throttled.schedule);
      panelElement?.removeEventListener('transitionend', throttled.schedule);
      panelElement?.removeEventListener('scroll', throttled.schedule, { capture: true });
      window.removeEventListener('resize', throttled.schedule);
    };
  }, [containerRef, boardRef, registry, slideId, nextSlideGapKey, items, enabled, panelThreadId]);

  return layout;
}

/**
 * Mark shapes on the active slide ([data-mark] in the annotation layer) as mask cutouts, so the
 * lines run behind pins, frames and drawings instead of over them.
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
