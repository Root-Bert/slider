import { useEffect, useRef } from 'react';
import { useColorOverrides } from '../hooks/useColorOverrides';
import { withColorOverride } from '../lib/color-overrides';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerState } from '../state/viewer-state';
import { LiveCursor } from './LiveCursor';
import { getLiveSnapshot, lastMoved, useLiveSnapshot } from './lib/live-store';

/** A cursor resting this long folds its name away. */
const IDLE_MS = 3_000;
/** Smoothing between position updates (~25 per second): time constant in ms. */
const EASE_MS = 45;
/** Closer than this (px) to its target, a gliding cursor has arrived. */
const SETTLED_PX = 0.5;
/**
 * After a scroll, resize or panel change the loop keeps placing a while: smooth scrolls and the
 * side panel's slide-in (300 ms) move things without further events.
 */
const WAKE_MS = 400;
/** A frame's length for the first frame after a pause (no previous frame to measure from). */
const FRAME_MS = 1000 / 60;

/**
 * Other people's pointers over the slides (BER-104). Positions are normalised to a slide, so they
 * land on the same spot whatever window size or scroll position each viewer has. One frame loop
 * places all cursors – it follows scrolling and resizing as well as the peers' moves. It only runs
 * while there is something to place: a peer's move, a scroll, a resize or a panel wakes it, and it
 * stops once every cursor has arrived – a deck open side by side with someone idle costs nothing.
 */
export function CursorLayer() {
  const registry = useStageRegistry();
  const overrides = useColorOverrides();
  const { peers } = useLiveSnapshot();
  const { threadPanelOpen, deletedPanelOpen } = useViewerState();
  const elements = useRef(new Map<string, HTMLDivElement>());
  const wakeRef = useRef<(() => void) | null>(null);

  // Every other open viewer – your own other windows too.
  const others = [...peers.values()];
  const hasOthers = others.length > 0;

  useEffect(() => {
    if (!hasOthers) return;
    const shown = new Map<string, { x: number; y: number }>();
    const transforms = new Map<HTMLElement, string>();
    let frame = 0;
    let last: number | null = null;
    let runUntil = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    // Zoom and split resize the slides without a scroll event.
    const resizes = new ResizeObserver(() => wake());

    const tick = (now: number) => {
      frame = 0;
      const blend = 1 - Math.exp(-Math.max(now - (last ?? now - FRAME_MS), 0) / EASE_MS);
      last = now;
      const scroller = registry.getScroller();
      const scrollerBox = scroller?.getBoundingClientRect() ?? null;
      if (scroller) resizes.observe(scroller);
      const panel = document.querySelector('[data-side-panel]')?.getBoundingClientRect() ?? null;
      let moving = false;
      let nextIdleAt = Infinity;

      for (const [connectionId, element] of elements.current) {
        const cursor = getLiveSnapshot().peers.get(connectionId)?.cursor ?? null;
        const box = cursor ? registry.getSlideElement(cursor.slideId) : null;
        if (!cursor || !box || !scrollerBox) {
          element.removeAttribute('data-visible');
          shown.delete(connectionId);
          continue;
        }
        resizes.observe(box);
        const rect = box.getBoundingClientRect();
        const x = rect.left + cursor.point.x * rect.width;
        const y = rect.top + cursor.point.y * rect.height;
        // Only over the visible track – not under a side panel or scrolled out of view.
        const visible =
          x >= scrollerBox.left &&
          x <= scrollerBox.right &&
          y >= scrollerBox.top &&
          y <= scrollerBox.bottom &&
          !(panel && x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom);
        const previous = shown.get(connectionId);
        // A cursor (re)appearing jumps to its place instead of gliding in from somewhere else.
        let next =
          previous && element.hasAttribute('data-visible')
            ? { x: previous.x + (x - previous.x) * blend, y: previous.y + (y - previous.y) * blend }
            : { x, y };
        if (Math.abs(next.x - x) < SETTLED_PX && Math.abs(next.y - y) < SETTLED_PX) next = { x, y };
        else moving = true;
        shown.set(connectionId, next);
        const transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
        if (transforms.get(element) !== transform) {
          transforms.set(element, transform);
          element.style.transform = transform;
        }
        element.toggleAttribute('data-visible', visible);
        const idleAt = (lastMoved.get(connectionId) ?? 0) + IDLE_MS;
        element.toggleAttribute('data-idle', now > idleAt);
        if (now <= idleAt) nextIdleAt = Math.min(nextIdleAt, idleAt);
      }

      if (moving || now < runUntil) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // Settled: sleep until something happens – or a cursor's name is due to fold away.
      last = null;
      clearTimeout(idleTimer);
      if (nextIdleAt !== Infinity) {
        idleTimer = setTimeout(wake, Math.max(nextIdleAt - performance.now(), 0) + 1);
      }
    };

    function wake() {
      runUntil = performance.now() + WAKE_MS;
      if (!frame) frame = requestAnimationFrame(tick);
    }
    wakeRef.current = wake;
    wake();
    // Scrolling anywhere (the track, the page) and resizing move the slides under the cursors.
    const options = { capture: true, passive: true } as const;
    document.addEventListener('scroll', wake, options);
    window.addEventListener('resize', wake, { passive: true });
    return () => {
      wakeRef.current = null;
      cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
      resizes.disconnect();
      document.removeEventListener('scroll', wake, options);
      window.removeEventListener('resize', wake);
    };
  }, [hasOthers, registry]);

  // A peer moved, came or left; a side panel opened or closed (it hides cursors under it).
  useEffect(() => {
    wakeRef.current?.();
  }, [peers, threadPanelOpen, deletedPanelOpen]);

  if (!hasOthers) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-(--z-overlay) overflow-hidden">
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
