import { useEffect, useRef, useState } from 'react';
import { CORNER_HALF, DOME_RADIUS, type FrameHandle } from '../lib/frame-outline';

/**
 * How near the pointer opens a handle's bracket or dome (screen px): with the box's shorter side
 * on screen (`side`), from one of the handle's widths for a small box to five for a large one – a
 * large box shows them early, on a small one they do not all open at once.
 */
const reach = (handle: FrameHandle, side: number) =>
  Math.min(5, Math.max(1, side / 50)) * 2 * (handle === 'turn' ? DOME_RADIUS : CORNER_HALF);

/**
 * The handles whose grips (`grips`) the pointer is within reach of (`reach`, for a box whose
 * shorter side shows `side` px), followed while `on`. Without a
 * hovering pointer (touch) every handle counts as near: there is no coming close first.
 */
export function useNearHandles(
  on: boolean,
  side: number,
  grips: { current: Partial<Record<FrameHandle, HTMLElement | null>> },
): FrameHandle[] | undefined {
  const [near, setNear] = useState<FrameHandle[]>([]);
  // Read when measured: a resize does not start the following over (nor close what is open).
  const sideNow = useRef(side);
  useEffect(() => {
    sideNow.current = side;
  }, [side]);
  const [hoverless] = useState(() => window.matchMedia('(hover: none)').matches);
  useEffect(() => {
    if (!on || hoverless) return;
    let frame = 0;
    let at: { x: number; y: number } | null = null;
    const measure = () => {
      frame = 0;
      const next = (Object.keys(grips.current) as FrameHandle[]).filter((handle) => {
        const grip = grips.current[handle];
        if (!grip || !at) return false;
        // Its middle as seen on screen, turned or tilted as the box is.
        const box = grip.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return Math.hypot(at.x - x, at.y - y) <= reach(handle, sideNow.current);
      });
      setNear((was) => (was.join() === next.join() ? was : next));
    };
    const follow = (event: PointerEvent) => {
      at = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // Out of the window: nowhere near.
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      at = null;
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('pointermove', follow, { passive: true });
    document.addEventListener('pointerout', leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', follow);
      document.removeEventListener('pointerout', leave);
      setNear([]);
    };
  }, [on, hoverless, grips]);
  return hoverless ? undefined : near;
}
