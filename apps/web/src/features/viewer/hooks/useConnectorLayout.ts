import type { Rect } from '@slider/shared';
import { useEffect, useState, type RefObject } from 'react';
import {
  layoutConnectors,
  type Box,
  type ConnectorRequest,
  type Px,
} from '../lib/connector-routing';
import { rafThrottle } from '../lib/dom';
import { denormalizeRect } from '../lib/geometry';
import { useStageRegistry } from '../state/stage-registry';

export interface ConnectorItem {
  threadId: string;
  rect: Rect;
  color: string;
}

export interface MeasuredConnector {
  threadId: string;
  color: string;
  points: Px[];
}

/** Room for the bus lines above the first row of cards (inside the board's top padding). */
const BUS_SPACE = 32;
/** Lines enter the card next to its avatar. */
const CARD_ENTRY_X = 26;

const shift = (box: Box, origin: DOMRect): Box => ({
  left: box.left - origin.left,
  right: box.right - origin.left,
  top: box.top - origin.top,
  bottom: box.bottom - origin.top,
});

/**
 * Measures anchors (on the active slide) and cards and routes the connector lines between them.
 * Re-measures – batched to one per frame – on resize of the layout, horizontal stage scroll and
 * whenever `items` or `layoutKey` (zoom, filter, panels …) change. Coordinates are relative to
 * `containerRef`, so vertical page scrolling needs no work at all. A passive effect (not a layout
 * effect) on purpose: the container is an ancestor, and ancestor refs are attached after child
 * layout effects run.
 */
export function useConnectorLayout({
  containerRef,
  boardRef,
  slideId,
  items,
  enabled,
  layoutKey,
}: {
  containerRef: RefObject<HTMLElement | null>;
  boardRef: RefObject<HTMLElement | null>;
  slideId: string | null;
  items: readonly ConnectorItem[];
  enabled: boolean;
  layoutKey: string;
}): MeasuredConnector[] {
  const registry = useStageRegistry();
  const [connectors, setConnectors] = useState<MeasuredConnector[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    const board = boardRef.current;
    const scroller = registry.getScroller();

    const measure = () => {
      const slideElement = slideId ? registry.getSlideElement(slideId) : null;
      if (!enabled || !container || !board || !scroller || !slideElement || items.length === 0) {
        setConnectors((current) => (current.length === 0 ? current : []));
        return;
      }
      const origin = container.getBoundingClientRect();
      const slideBox = slideElement.getBoundingClientRect();
      const stageBox = scroller.getBoundingClientRect();
      const colorOf = new Map(items.map((item) => [item.threadId, item.color]));

      const requests: ConnectorRequest[] = [];
      for (const item of items) {
        const card = container.querySelector(`[data-comment-card="${CSS.escape(item.threadId)}"]`);
        if (!card) continue;
        const anchor = denormalizeRect(item.rect, slideBox);
        const centerX = (anchor.left + anchor.right) / 2;
        // Anchor scrolled out of the stage: no line.
        if (centerX < stageBox.left || centerX > stageBox.right) continue;
        const cardBox = card.getBoundingClientRect();
        requests.push({
          id: item.threadId,
          anchor: shift(anchor, origin),
          anchorCenterX: item.rect.x + item.rect.w / 2,
          target: { x: cardBox.left - origin.left + CARD_ENTRY_X, y: cardBox.top - origin.top },
        });
      }

      const slide = shift(slideBox, origin);
      // The board reserves BUS_SPACE + margins as top padding for the bus band.
      const busTop = board.getBoundingClientRect().top - origin.top + 8;
      const routed = layoutConnectors(requests, {
        slide,
        busTop,
        laneSpace: { left: Math.max(12, slideBox.left - stageBox.left), right: 16 },
        busSpace: BUS_SPACE,
      });
      setConnectors(
        routed.map((connector) => ({
          threadId: connector.id,
          color: colorOf.get(connector.id) ?? 'white',
          points: connector.points,
        })),
      );
    };

    const throttled = rafThrottle(measure);
    throttled.schedule();

    const resizeObserver = new ResizeObserver(throttled.schedule);
    if (container) resizeObserver.observe(container);
    if (board) resizeObserver.observe(board);
    scroller?.addEventListener('scroll', throttled.schedule, { passive: true });
    window.addEventListener('resize', throttled.schedule);

    return () => {
      throttled.cancel();
      resizeObserver.disconnect();
      scroller?.removeEventListener('scroll', throttled.schedule);
      window.removeEventListener('resize', throttled.schedule);
    };
  }, [containerRef, boardRef, registry, slideId, items, enabled, layoutKey]);

  return connectors;
}
