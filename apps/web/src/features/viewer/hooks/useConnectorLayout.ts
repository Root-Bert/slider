import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ConnectorAnchor } from '../lib/comment-selectors';
import {
  fadeStops,
  layoutBlobConnectors,
  layoutConnectors,
  roundedPath,
  type Box,
  type ConnectorRequest,
  type FadeStop,
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
  /** SVG path data, relative to the connector layer (see `useConnectorLayout`). */
  d: string;
}

/** Shapes the lines pass behind – cut out of the lines' mask. */
export type Cutout =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; box: Box }
  | { kind: 'fill'; box: Box }
  | { kind: 'path'; d: string; transform: string; width: number };

export interface ConnectorLayout {
  lines: MeasuredConnector[];
  /** Height of the scroller's viewport: the layer's SVG covers it. */
  height: number;
  /** Opacity profile along y that hides the lines behind the minimap, controls row and handle. */
  fade: FadeStop[];
  cutouts: Cutout[];
}

const EMPTY: ConnectorLayout = { lines: [], height: 0, fade: [], cutouts: [] };

/** Lines enter the card next to its avatar. */
const CARD_ENTRY_X = 26;
const COMPACT_ENTRY_X = 18;
/** Bus rows start this far below the header (past the lines' fade-in) and end this far above the cards. */
const BUS_BELOW_HEADER = 14;
const BUS_ABOVE_CARDS = 20;
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
 * it to the middle of the gap after it – so lines of different slides never cross.
 *
 * Coordinates are relative to the connector layer: a zero-height `sticky top-0` element inside
 * the scrolled content, so x is in content space (the lines scroll sideways natively, in the
 * same frame as slides and cards – no re-measure) and y is in the scroller's viewport, like
 * the sticky header holding the marks. Re-measures, batched to one per frame and committed
 * before that frame paints, when the comment area scrolls vertically (cards move under the
 * fixed marks), anything in the timeline resizes or moves, or the window resizes.
 */
export function useConnectorLayout({
  layer,
  routes,
  enabled,
}: {
  /** The connector layer (see above); its parent is the scrolled content. */
  layer: HTMLElement | null;
  routes: readonly ConnectorRoute[];
  enabled: boolean;
}): ConnectorLayout {
  const registry = useStageRegistry();
  const [layout, setLayout] = useState<ConnectorLayout>(EMPTY);

  useEffect(() => {
    const scroller = registry.getScroller();
    const wrapper = scroller?.parentElement;
    // Committed before the frame paints, so the lines never trail the cards by a frame.
    const commit = (next: ConnectorLayout) =>
      flushSync(() =>
        setLayout((current) => (current === EMPTY && next === EMPTY ? current : next)),
      );

    const measure = () => {
      if (!enabled || !layer || !wrapper || !scroller || routes.length === 0) {
        commit(EMPTY);
        return;
      }
      const origin = layer.getBoundingClientRect();
      const stage = relative(scroller.getBoundingClientRect(), origin);
      const header = wrapper.querySelector('[data-timeline-header]');
      // Top of the visible comment area: everything above it is the sticky header.
      const commentTop = header ? header.getBoundingClientRect().bottom - origin.top : 0;
      // The band the lines hide behind: from the minimap (or the controls row) down to the
      // comment area, split handle included.
      const occluder = wrapper.querySelector('[data-connector-occluder]');
      const band = occluder
        ? { top: occluder.getBoundingClientRect().top - origin.top, bottom: commentTop }
        : null;
      const busTop = commentTop + BUS_BELOW_HEADER;
      const visible = (box: Box) => box.bottom > commentTop && box.top < stage.bottom;
      const clipped = (box: Box): Box => ({ ...box, top: Math.max(box.top, commentTop) });

      const lines: MeasuredConnector[] = [];
      const cutouts: Cutout[] = [];
      const colorOf = new Map<string, string>();

      // Lines pass behind every visible card, bubble and blob. All rendered
      // ones, not just those in view: the lines scroll sideways without a re-measure.
      const area = scroller.querySelector('[data-comment-area]');
      for (const element of area?.querySelectorAll(
        '[data-comment-card], [data-connector-blob], [data-gap-bubble]',
      ) ?? []) {
        const box = relative(element.getBoundingClientRect(), origin);
        if (!visible(box)) continue;
        cutouts.push({ kind: 'fill', box: clipped(box) });
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

      commit({
        lines,
        height: stage.bottom - stage.top,
        fade: fadeStops(band),
        cutouts,
      });
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
    // Slides, columns and cards move without resizing when the split or the brick layout change:
    // watch their inline styles and the rendered window too. The lines themselves live in the
    // scroller as well – their own updates don't count.
    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !layer?.contains(record.target))) throttled.schedule();
    });
    if (scroller)
      mutationObserver.observe(scroller, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style'],
      });
    // Sideways the lines scroll with the content; only a vertical scroll (cards moving under the
    // fixed marks) needs a re-measure.
    let scrollTop = scroller?.scrollTop ?? 0;
    const onScroll = () => {
      if (!scroller || scroller.scrollTop === scrollTop) return;
      scrollTop = scroller.scrollTop;
      throttled.schedule();
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    wrapper?.addEventListener('transitionend', throttled.schedule);
    window.addEventListener('resize', throttled.schedule);

    return () => {
      throttled.cancel();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      scroller?.removeEventListener('scroll', onScroll);
      wrapper?.removeEventListener('transitionend', throttled.schedule);
      window.removeEventListener('resize', throttled.schedule);
    };
  }, [layer, registry, routes, enabled]);

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
