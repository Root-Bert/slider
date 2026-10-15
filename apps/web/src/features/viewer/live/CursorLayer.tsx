import { useEffect, useRef } from 'react';
import { withColorOverride, useColorOverrides } from '../lib/color-overrides';
import { useStageRegistry } from '../state/stage-registry';
import { LiveCursor } from './LiveCursor';
import { getLiveSnapshot, lastMoved, useLiveSnapshot } from './live-store';

/** A cursor resting this long folds its name away. */
const IDLE_MS = 3_000;
/** Smoothing between position updates (~25 per second): time constant in ms. */
const EASE_MS = 45;

/**
 * Other people's pointers over the slides (BER-104). Positions are normalised to a slide, so they
 * land on the same spot whatever window size or scroll position each viewer has. One frame loop
 * places all cursors – it follows scrolling and resizing as well as the peers' moves.
 */
export function CursorLayer() {
  const registry = useStageRegistry();
  const overrides = useColorOverrides();
  const { peers } = useLiveSnapshot();
  const elements = useRef(new Map<string, HTMLDivElement>());

  // Every other open viewer – your own other windows too.
  const others = [...peers.values()];
  const hasOthers = others.length > 0;

  useEffect(() => {
    if (!hasOthers) return;
    const shown = new Map<string, { x: number; y: number }>();
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const blend = 1 - Math.exp(-(now - last) / EASE_MS);
      last = now;
      const scroller = registry.getScroller()?.getBoundingClientRect() ?? null;
      const panel = document.querySelector('[data-side-panel]')?.getBoundingClientRect() ?? null;

      for (const [connectionId, element] of elements.current) {
        const cursor = getLiveSnapshot().peers.get(connectionId)?.cursor ?? null;
        const box = cursor ? registry.getSlideElement(cursor.slideId) : null;
        if (!cursor || !box || !scroller) {
          element.removeAttribute('data-visible');
          shown.delete(connectionId);
          continue;
        }
        const rect = box.getBoundingClientRect();
        const x = rect.left + cursor.point.x * rect.width;
        const y = rect.top + cursor.point.y * rect.height;
        // Only over the visible track – not under a side panel or scrolled out of view.
        const visible =
          x >= scroller.left &&
          x <= scroller.right &&
          y >= scroller.top &&
          y <= scroller.bottom &&
          !(panel && x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom);
        const previous = shown.get(connectionId);
        // A cursor (re)appearing jumps to its place instead of gliding in from somewhere else.
        const next =
          previous && element.hasAttribute('data-visible')
            ? { x: previous.x + (x - previous.x) * blend, y: previous.y + (y - previous.y) * blend }
            : { x, y };
        shown.set(connectionId, next);
        element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
        element.toggleAttribute('data-visible', visible);
        element.toggleAttribute('data-idle', now - (lastMoved.get(connectionId) ?? 0) > IDLE_MS);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hasOthers, registry]);

  if (!hasOthers) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-20 overflow-hidden">
      {others.map((peer) => (
        <LiveCursor
          key={peer.connectionId}
          author={withColorOverride(peer.author, overrides)}
          ref={(element) => {
            if (element) elements.current.set(peer.connectionId, element);
            else elements.current.delete(peer.connectionId);
          }}
        />
      ))}
    </div>
  );
}
