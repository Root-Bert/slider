import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Wheel distance (px) for one step: a notch of a mouse wheel, a short swipe on a trackpad. */
const WHEEL_STEP = 50;
/** Pointer travel (px) for one step while the handle is dragged. */
const DRAG_STEP = 3;

/** How a step is taken: ⇧ ten at once, ⌥ a tenth. */
export interface StepKeys {
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Figma's way with a number: over the field the wheel steps it (only while the pointer is on it,
 * the panel under it does not scroll), and dragging its handle sideways runs it up and down –
 * `onStep` with +1 or -1 and the keys held, each time. The drag locks the pointer where the
 * browser allows (it runs on past the screen's edge), else it is captured.
 */
export function useScrub(
  field: RefObject<HTMLElement | null>,
  handle: RefObject<HTMLElement | null>,
  onStep: (direction: 1 | -1, keys: StepKeys) => void,
): { dragging: boolean } {
  const latest = useRef(onStep);
  useLayoutEffect(() => {
    latest.current = onStep;
  });
  const [dragging, setDragging] = useState(false);

  // Native and not passive: React's wheel listener cannot keep the panel from scrolling.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    let scrolled = 0;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : -event.deltaX;
      if (delta === 0) return;
      event.preventDefault();
      // A change of direction starts over.
      if (Math.sign(scrolled) !== Math.sign(delta)) scrolled = 0;
      scrolled += delta;
      while (Math.abs(scrolled) >= WHEEL_STEP) {
        scrolled -= Math.sign(scrolled) * WHEEL_STEP;
        latest.current(delta < 0 ? 1 : -1, event);
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [field]);

  useEffect(() => {
    const grip = handle.current;
    if (!grip) return;
    let moved = 0;
    let pointer: number | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      pointer = event.pointerId;
      moved = 0;
      grip.setPointerCapture(event.pointerId);
      // Not everywhere (Safari asks first, jsdom has none): captured is enough.
      void Promise.resolve(grip.requestPointerLock?.()).catch(() => {});
      setDragging(true);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      moved += event.movementX;
      while (Math.abs(moved) >= DRAG_STEP) {
        const direction = moved > 0 ? 1 : -1;
        moved -= direction * DRAG_STEP;
        latest.current(direction, event);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (document.pointerLockElement === grip) document.exitPointerLock();
      setDragging(false);
    };
    grip.addEventListener('pointerdown', onDown);
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
    return () => {
      grip.removeEventListener('pointerdown', onDown);
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
  }, [handle]);
  return { dragging };
}

export const decimalsOf = (step: number) => {
  const text = String(step);
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
};

/** `value` one step on (`direction`), ⇧ ten steps, ⌥ a tenth; rounded to that step, in range. */
export function steppedValue(
  value: number,
  direction: 1 | -1,
  keys: StepKeys,
  { min, max, step = 1, bigStep = step * 10, wrap }: NumberRange,
): number {
  const by = keys.shiftKey ? bigStep : keys.altKey ? step / 10 : step;
  // On the step's grid (a tenth of it with ⌥), however far it went.
  const grid = keys.altKey ? step / 10 : step;
  const next = Number(
    (Math.round((value + direction * by) / grid) * grid).toFixed(decimalsOf(grid) + 2),
  );
  if (wrap) return ((next % wrap) + wrap) % wrap;
  return Math.min(max, Math.max(min, next));
}

export interface NumberRange {
  min: number;
  max: number;
  /** One step of ↑ ↓, the wheel and the handle. */
  step?: number;
  /** A step with ⇧ (ten steps by default). */
  bigStep?: number;
  /** Goes round at this (an angle: 360) instead of stopping at `min`/`max`. */
  wrap?: number;
}
