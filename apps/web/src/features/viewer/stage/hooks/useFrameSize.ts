import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { seenCorners } from '../../editing/layers/seen-on-plane';

interface FrameSize {
  /** Its own size (layout px, untouched by its turn or a zoom). */
  width: number;
  height: number;
  /**
   * How large a layout px of it shows on screen: on a plane of the 3D slide (zoomed, spread,
   * turned) not 1 – its line is drawn in screen px all the same.
   */
  scale: number;
}

/** A change of the scale smaller than this is none: no redraw every frame for nothing. */
const SCALE_STEP = 0.01;

/** The plane of the 3D slide (`LayerStage`) an element lies on – its corners show how it is seen. */
const PLANE = '[data-plane], [data-layer-marks]';

/** How large a layout px on `plane` shows on screen, from its corners as seen. */
function planeScale(plane: HTMLElement): number {
  const quad = seenCorners(plane);
  if (!quad || plane.offsetWidth <= 0 || plane.offsetHeight <= 0) return 1;
  const [a, b, , d] = quad;
  const across = Math.hypot(b.x - a.x, b.y - a.y) / plane.offsetWidth;
  const down = Math.hypot(d.x - a.x, d.y - a.y) / plane.offsetHeight;
  return across > 0 && down > 0 ? Math.sqrt(across * down) : 1;
}

/**
 * The frame's own size and scale on screen, read before each paint – a drag resizes it every
 * frame – and on any other resize; on a plane of the 3D slide during transforms and their transitions (turn, spread, zoom). `null` until it has one or unused.
 */
export function useFrameSize(
  frameRef: RefObject<HTMLElement | null>,
  active: boolean,
): FrameSize | null {
  const [size, setSize] = useState<FrameSize | null>(null);
  const measure = useCallback(() => {
    const frame = frameRef.current;
    const plane = frame?.closest<HTMLElement>(PLANE);
    const next =
      active && frame && frame.offsetWidth > 0 && frame.offsetHeight > 0
        ? {
            width: frame.offsetWidth,
            height: frame.offsetHeight,
            scale: plane ? planeScale(plane) : 1,
          }
        : null;
    setSize((current) =>
      current?.width === next?.width &&
      current?.height === next?.height &&
      Math.abs((current?.scale ?? 0) - (next?.scale ?? 0)) < SCALE_STEP
        ? current
        : next,
    );
  }, [frameRef, active]);
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!active || !frame) return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    let tick = 0;
    const plane = frame.closest<HTMLElement>(PLANE);
    const ancestors: HTMLElement[] = [];
    const scope = frame.closest('[data-layer-stage]') ?? plane;
    if (plane) {
      for (let node: HTMLElement | null = frame; node; node = node.parentElement) {
        ancestors.push(node);
        if (node === scope) break;
      }
    }
    const follow = () => {
      tick = 0;
      measure();
      // CSS turns ease between React updates. Follow only while those transitions run,
      // rather than forcing layout forever for every selected frame on an idle slide.
      if (
        ancestors.some((node) =>
          node
            .getAnimations?.()
            .some((animation) => animation.playState === 'running' || animation.pending),
        )
      )
        tick = requestAnimationFrame(follow);
    };
    const schedule = () => {
      if (!tick) tick = requestAnimationFrame(follow);
    };
    const changes = new MutationObserver(schedule);
    for (const ancestor of ancestors) {
      changes.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class'] });
      ancestor.addEventListener('transitionrun', schedule);
    }
    if (plane) schedule();
    return () => {
      observer.disconnect();
      changes.disconnect();
      for (const ancestor of ancestors) ancestor.removeEventListener('transitionrun', schedule);
      cancelAnimationFrame(tick);
    };
  }, [frameRef, active, measure]);
  return size;
}
