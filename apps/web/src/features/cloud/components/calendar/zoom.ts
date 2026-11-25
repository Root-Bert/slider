import { useEffect, useEffectEvent, type RefObject } from 'react';
import { iso, startOfWeek } from './days';
import type { CalendarView } from './entries';

/**
 * Zooming through the calendar, as Apple's: pinched on a week of the month, the month opens onto
 * that week – the weeks above move up and away, those below down, the day's numbers and events fly
 * to where they are in the week. Out again, the reverse. One keeps sight of where one is.
 *
 * What the views mark for it:
 * - `data-pane="0"` the page in sight (`CalendarStrip`),
 * - `data-seg` the parts that move apart (a month's days and weeks' numbers, a week's columns and
 *   their heads, a year's months),
 * - `data-day`, `data-week`, `data-month` what a part shows (where the finer view lies),
 * - `data-morph` what is the same in both (a day's number `n:2026-11-25`, an event on a day
 *   `e:<entry>@2026-11-25`): it flies from where it was to where it is,
 * - `data-scroller` what scrolls in a page (only what is in sight of it flies; a copy keeps it).
 */

/** Finer to coarser: a pinch outwards goes one down, inwards one up. The list is not in it. */
export const ZOOM_CHAIN = ['tag', 'woche', 'monat', 'jahr'] as const satisfies CalendarView[];
export const zoomLevel = (view: CalendarView): number | undefined =>
  (ZOOM_CHAIN as readonly CalendarView[]).indexOf(view) === -1
    ? undefined
    : (ZOOM_CHAIN as readonly CalendarView[]).indexOf(view);

/** Fast, as the user asked: there to show the way, not to wait for. */
const DURATION = 320;
const EASE = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * What moves, moves as a spring does: quick away, a hair past its place, settled – damped so it
 * overshoots by about 1 %. As `linear()` points; where the browser has no `linear()`, `EASE`.
 */
const SPRING = (() => {
  const damping = 0.82;
  const decay = 7; // e^-7: settled within a thousandth by the end
  const omega = decay / damping;
  const ringing = omega * Math.sqrt(1 - damping * damping);
  const points = Array.from({ length: 41 }, (_, index) => {
    const t = index / 40;
    const x =
      1 -
      Math.exp(-decay * t) * (Math.cos(ringing * t) + (decay / ringing) * Math.sin(ringing * t));
    return index === 40 ? 1 : Math.round(x * 10000) / 10000;
  });
  const curve = `linear(${points.join(', ')})`;
  return typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', curve)
    ? curve
    : EASE;
})();

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Morph {
  el: HTMLElement;
  box: Box;
}

const boxIn = (frame: DOMRect, rect: DOMRect): Box => ({
  x: rect.left - frame.left,
  y: rect.top - frame.top,
  w: rect.width,
  h: rect.height,
});
const meets = (a: DOMRect, b: DOMRect) =>
  a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
const overlaps = (a: Box, b: Box) =>
  a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;

/** Where the finer of the two views lies in the coarser one, and which way it goes. */
function spotOf(from: CalendarView, to: CalendarView, day: Date) {
  const a = zoomLevel(from);
  const b = zoomLevel(to);
  if (a === undefined || b === undefined || a === b) return null;
  const finer = a < b ? from : to;
  const selector =
    finer === 'tag'
      ? `[data-day="${iso(day)}"]`
      : finer === 'woche'
        ? `[data-week="${iso(startOfWeek(day))}"]`
        : `[data-month="${iso(day).slice(0, 7)}"]`;
  return { selector, zoomIn: b < a };
}

/** What may fly: in sight of the frame and of what scrolls around it. */
function morphsIn(root: HTMLElement, frame: DOMRect) {
  const found = new Map<string, Morph>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-morph]')) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !meets(rect, frame)) continue;
    const scroller = el.closest<HTMLElement>('[data-scroller]');
    if (scroller && !meets(rect, scroller.getBoundingClientRect())) continue;
    found.set(el.dataset.morph!, { el, box: boxIn(frame, rect) });
  }
  return found;
}

/** The spot's box: all its parts together, within the frame. */
function spotBox(root: HTMLElement, selector: string, frame: DOMRect): Box | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of root.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    if (!rect.width) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  left = Math.max(left, frame.left);
  top = Math.max(top, frame.top);
  right = Math.min(right, frame.right);
  bottom = Math.min(bottom, frame.bottom);
  if (!(right > left && bottom > top)) return null;
  return boxIn(frame, new DOMRect(left, top, right - left, bottom - top));
}

/** The page's place as laid out (a pinch's scaling left out): where it sits in the strip. */
function laidOut(pane: HTMLElement) {
  const strip = pane.parentElement!;
  const rect = strip.getBoundingClientRect();
  return {
    left: rect.left + pane.offsetLeft - strip.scrollLeft,
    top: rect.top + pane.offsetTop - strip.scrollTop,
  };
}

/** A transform about the page's corner: scaling by `scale` about a point of it stays put there. */
const scaledAbout = (scale: number, x: number, y: number) =>
  `translate(${x * (1 - scale)}px, ${y * (1 - scale)}px) scale(${scale})`;

export interface ZoomStart {
  frame: HTMLElement;
  overlay: HTMLElement;
  clone: HTMLElement;
  morphs: Map<string, Morph>;
  spot: ReturnType<typeof spotOf>;
  spotBox: Box | null;
}

let running: (() => void) | null = null;

const motionOk = () =>
  typeof Element.prototype.animate === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Before the view changes: the page as it is, copied over it (`overlay`), and where what will fly
 * is now. `null` where nothing moves (reduced motion).
 */
export function startZoom({
  frame,
  overlay,
  pane,
  from,
  to,
  day,
}: {
  frame: HTMLElement;
  overlay: HTMLElement;
  pane: HTMLElement;
  from: CalendarView;
  to: CalendarView;
  day: Date;
}): ZoomStart | null {
  running?.();
  if (!motionOk()) return null;
  const frameRect = frame.getBoundingClientRect();
  const spot = spotOf(from, to, day);
  const morphs = morphsIn(pane, frameRect);
  const box = spot?.zoomIn ? spotBox(pane, spot.selector, frameRect) : null;
  const place = laidOut(pane);
  const clone = pane.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-pane');
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  Object.assign(clone.style, {
    position: 'absolute',
    left: `${place.left - frameRect.left}px`,
    top: `${place.top - frameRect.top}px`,
    width: `${pane.offsetWidth}px`,
    height: `${pane.offsetHeight}px`,
    margin: '0',
  });
  overlay.append(clone);
  const scrolled = pane.querySelectorAll<HTMLElement>('[data-scroller]');
  clone.querySelectorAll<HTMLElement>('[data-scroller]').forEach((el, index) => {
    el.scrollTop = scrolled[index]?.scrollTop ?? 0;
    el.scrollLeft = scrolled[index]?.scrollLeft ?? 0;
  });
  // What flies, as the copy has it (the copy's own stays hidden behind the flight).
  const copies = new Map<string, HTMLElement>();
  for (const el of clone.querySelectorAll<HTMLElement>('[data-morph]'))
    copies.set(el.dataset.morph!, el);
  const inCopy = new Map<string, Morph>();
  for (const [key, morph] of morphs) {
    const el = copies.get(key);
    if (el) inCopy.set(key, { el, box: morph.box });
  }
  running = () => overlay.replaceChildren();
  return { frame, overlay, clone, morphs: inCopy, spot, spotBox: box };
}

/** Once the new view is laid out (before it is painted): everything moves to where it is now. */
export function finishZoom(start: ZoomStart, pane: HTMLElement) {
  const { frame, overlay, clone, spot } = start;
  const frameRect = frame.getBoundingClientRect();
  const whole: Box = { x: 0, y: 0, w: frameRect.width, h: frameRect.height };
  const now = morphsIn(pane, frameRect);
  const spot2 = spot && !spot.zoomIn ? spotBox(pane, spot.selector, frameRect) : null;
  const area = spot ? (spot.zoomIn ? start.spotBox : spot2) : null;
  const animations: Animation[] = [];
  const hidden: HTMLElement[] = [];
  const run = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions = {}) =>
    animations.push(
      el.animate(frames, { duration: DURATION, easing: EASE, fill: 'both', ...options }),
    );
  /** Points of `from` to where they are once `from` fills `to` (no scaling: they move apart). */
  const mapping = (from: Box, to: Box) => (x: number, y: number) => ({
    x: to.x + (x - from.x) * (to.w / from.w),
    y: to.y + (y - from.y) * (to.h / from.h),
  });
  const shift = (el: HTMLElement, move: (x: number, y: number) => { x: number; y: number }) => {
    const box = boxIn(frameRect, el.getBoundingClientRect());
    const x = box.x + box.w / 2;
    const y = box.y + box.h / 2;
    const to = move(x, y);
    return `translate(${to.x - x}px, ${to.y - y}px)`;
  };

  // The copy's own space (it may still be scaled as the pinch left it): a box of the frame in it.
  const copyRect = clone.getBoundingClientRect();
  const ratio = copyRect.width / clone.offsetWidth || 1;
  const local = (box: Box) => ({
    left: (box.x - (copyRect.left - frameRect.left)) / ratio,
    top: (box.y - (copyRect.top - frameRect.top)) / ratio,
    right: (box.x + box.w - (copyRect.left - frameRect.left)) / ratio,
    bottom: (box.y + box.h - (copyRect.top - frameRect.top)) / ratio,
  });

  // Everything is read before anything is written: a box or a look read after an animation
  // started or a copy was added makes the browser lay out the whole page again, each time (the
  // year's small months: some 75 times, 350 ms of a stuck first frame).
  const w = clone.offsetWidth;
  const h = clone.offsetHeight;
  const left = clone.offsetLeft;
  const top = clone.offsetTop;
  const page = boxIn(frameRect, pane.getBoundingClientRect());
  const moved = area ? (spot?.zoomIn ? clone : pane) : null;
  const moves = moved
    ? [...moved.querySelectorAll<HTMLElement>('[data-seg]')].map(
        (seg) => [seg, shift(seg, mapping(area!, whole))] as const,
      )
    : [];
  const look = (el: HTMLElement) => {
    const style = getComputedStyle(el);
    return TEXT.map((name) => [name, style.getPropertyValue(name)] as const);
  };
  const flights = [...start.morphs].flatMap(([key, before]) => {
    const after = now.get(key);
    // Zoomed in, what was in the spot flies; out, what lands in it.
    if (!after || (area && !overlaps(spot?.zoomIn ? before.box : after.box, area))) return [];
    return [{ before, after, beforeLook: look(before.el), afterLook: look(after.el) }];
  });

  if (area && spot?.zoomIn) {
    // In: the old page's parts move apart from the spot, and the spot opens – a hole in the copy,
    // growing with them to the whole, the new page in it. Neither is ever half seen through.
    for (const [seg, to] of moves)
      run(seg, [{ transform: 'none' }, { transform: to }], { easing: SPRING });
    const hole = (b: ReturnType<typeof local>) =>
      `polygon(evenodd, -1px -1px, ${w + 1}px -1px, ${w + 1}px ${h + 1}px, -1px ${h + 1}px, -1px -1px, ${b.left}px ${b.top}px, ${b.right}px ${b.top}px, ${b.right}px ${b.bottom}px, ${b.left}px ${b.bottom}px, ${b.left}px ${b.top}px)`;
    const opened = local({ x: -2, y: -2, w: whole.w + 4, h: whole.h + 4 });
    run(clone, [{ clipPath: hole(local(area)) }, { clipPath: hole(opened) }], { easing: SPRING });
    // The new page grows out of the spot as one piece, as small as it still fills it (a month
    // from the year's small one: its size; a week from a month's row: as it is, moving there).
    const grow = Math.min(1, Math.max(area.w / page.w, area.h / page.h));
    const gx = area.x + area.w / 2 - page.x - (grow * page.w) / 2;
    const gy = area.y + area.h / 2 - page.y - (grow * page.h) / 2;
    run(
      pane,
      [
        { transformOrigin: '0 0', transform: `translate(${gx}px, ${gy}px) scale(${grow})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { easing: SPRING },
    );
  } else if (area) {
    // Out: the new page is there at once, its parts coming together on the spot; the old one,
    // over it, is cut down to the spot as they come (not squashed) and fades into it at the end.
    for (const [seg, from] of moves)
      run(seg, [{ transform: from }, { transform: 'none' }], { easing: SPRING });
    // Shrunk evenly just as far as it still covers the spot (a week into a month's row: not at
    // all, a month into the year's small one: to its size), the rest cut away.
    const scale = Math.min(1, Math.max(area.w / whole.w, area.h / whole.h));
    const tx = area.x + area.w / 2 - left - scale * (whole.w / 2 - left);
    const ty = area.y + area.h / 2 - top - scale * (whole.h / 2 - top);
    const cut = {
      left: (area.x - left - tx) / scale,
      top: (area.y - top - ty) / scale,
      right: w - (area.x + area.w - left - tx) / scale,
      bottom: h - (area.y + area.h - top - ty) / scale,
    };
    run(
      clone,
      [
        {
          transformOrigin: '0 0',
          transform: clone.style.transform || 'none',
          clipPath: 'inset(0px 0px 0px 0px round 0px)',
        },
        {
          transformOrigin: '0 0',
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          clipPath: `inset(${cut.top}px ${cut.right}px ${cut.bottom}px ${cut.left}px round ${10 / scale}px)`,
        },
      ],
      { easing: SPRING },
    );
    // Gone before it is small: what it showed is not read in the spot over what is there now.
    run(
      clone,
      [{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0, offset: 0.7 }, { opacity: 0 }],
      {
        easing: 'linear',
      },
    );
  } else {
    // Nothing to open onto (to or from the list): the one fades into the other.
    run(clone, [{ opacity: 1 }, { opacity: 0 }], { duration: DURATION * 0.75, easing: 'ease-out' });
    run(pane, [{ opacity: 0 }, { opacity: 1 }], { easing: 'ease-out' });
  }

  // The same things fly from the old box to the new: the new look over the old, coming in early,
  // the old under it going once the new nearly covers it – never a thing half there, the two
  // texts barely seen at once.
  const fly = (
    source: HTMLElement,
    text: ReturnType<typeof look>,
    from: Box,
    to: Box,
    appear: boolean,
  ) => {
    const el = source.cloneNode(true) as HTMLElement;
    el.removeAttribute('data-morph');
    // Its text as where it was (a small month's numbers are small by their month, not by themselves).
    for (const [name, value] of text) el.style.setProperty(name, value);
    // A box of about the same shape grows as a whole, its text with it; another one (an hour's
    // block into a day's line) is laid out anew in each size.
    const sx = to.w / from.w;
    const sy = to.h / from.h;
    const scaled = Math.max(sx / sy, sy / sx) < 1.35;
    const own = appear ? to : from;
    Object.assign(el.style, {
      position: 'absolute',
      left: `${own.x}px`,
      top: `${own.y}px`,
      width: `${own.w}px`,
      height: `${own.h}px`,
      margin: '0',
      transform: 'none',
      transformOrigin: '0 0',
      boxSizing: 'border-box',
      visibility: 'visible',
      zIndex: '1',
    });
    overlay.append(el);
    if (scaled) {
      const there = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${sx}, ${sy})`;
      const back = `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${1 / sx}, ${1 / sy})`;
      run(
        el,
        appear
          ? [{ transform: back }, { transform: 'none' }]
          : [{ transform: 'none' }, { transform: there }],
        { easing: SPRING },
      );
    } else {
      const shift = `translate(${to.x - own.x}px, ${to.y - own.y}px)`;
      const start = `translate(${from.x - own.x}px, ${from.y - own.y}px)`;
      run(
        el,
        [
          { transform: start, width: `${from.w}px`, height: `${from.h}px` },
          { transform: shift, width: `${to.w}px`, height: `${to.h}px` },
        ],
        { easing: SPRING },
      );
    }
    run(
      el,
      appear
        ? [{ opacity: 0 }, { opacity: 0, offset: 0.1 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }]
        : [
            { opacity: 1 },
            { opacity: 1, offset: 0.25 },
            { opacity: 0, offset: 0.4 },
            { opacity: 0 },
          ],
      { easing: 'linear' },
    );
  };
  for (const { before, after, beforeLook, afterLook } of flights) {
    fly(before.el, beforeLook, before.box, after.box, false);
    fly(after.el, afterLook, before.box, after.box, true);
    before.el.style.visibility = 'hidden';
    after.el.style.visibility = 'hidden';
    hidden.push(after.el);
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const animation of animations) animation.cancel();
    for (const el of hidden) el.style.visibility = '';
    overlay.replaceChildren();
    if (running === finish) running = null;
  };
  running = finish;
  void Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);
}

/** What a thing's text takes from around it, carried onto its flying copy. */
const TEXT = [
  'font-size',
  'line-height',
  'font-weight',
  'letter-spacing',
  'color',
  'text-align',
  'white-space',
] as const;

/** A pinch this far (a wheel's units) changes the view; short of it, the page follows a little. */
const STEP = 40;
const FOLLOW = 0.04;

/**
 * Pinching on the calendar: a trackpad (Chrome, Edge, Firefox, the desktop app: the wheel with
 * Ctrl; Safari: its gesture events), two fingers on a touch screen, Ctrl and the mouse's wheel.
 * The page follows the fingers a little; past `STEP` `onZoom` is asked (1 in, -1 out, where) –
 * false where there is no further (the page springs back). One step per pinch.
 */
export function useZoomGestures(
  frameRef: RefObject<HTMLElement | null>,
  onZoom: (direction: 1 | -1, x: number, y: number) => boolean,
) {
  const zoom = useEffectEvent(onZoom);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let sum = 0;
    let done = false;
    let timer = 0;
    let lastScale = 1;
    let distance = 0;
    const page = () => frame.querySelector<HTMLElement>('[data-pane="0"]');
    const follow = (x: number, y: number) => {
      const el = page();
      if (!el || !motionOk()) return;
      const place = laidOut(el);
      const scale = 1 + Math.max(-1, Math.min(1, sum / STEP)) * FOLLOW;
      el.style.transition = 'none';
      el.style.transformOrigin = '0 0';
      el.style.transform = scaledAbout(scale, x - place.left, y - place.top);
    };
    const springBack = () => {
      const el = page();
      if (!el?.style.transform) return;
      el.style.transition = `transform 180ms ${EASE}`;
      el.style.transform = '';
    };
    const end = () => {
      if (!done) springBack();
      sum = 0;
      done = false;
    };
    const push = (delta: number, x: number, y: number) => {
      if (done) return;
      sum += delta;
      if (Math.abs(sum) < STEP) return follow(x, y);
      done = true;
      if (!zoom(sum > 0 ? 1 : -1, x, y)) springBack();
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      window.clearTimeout(timer);
      timer = window.setTimeout(end, 220);
      push(-event.deltaY * (event.deltaMode === 1 ? 20 : 1), event.clientX, event.clientY);
    };
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
      sum = 0;
      done = false;
    };
    const onGestureChange = (event: Event) => {
      const gesture = event as Gesture;
      event.preventDefault();
      push((gesture.scale - lastScale) * STEP * 4, gesture.clientX, gesture.clientY);
      lastScale = gesture.scale;
    };
    const apart = (touches: TouchList) =>
      Math.hypot(
        touches[0]!.clientX - touches[1]!.clientX,
        touches[0]!.clientY - touches[1]!.clientY,
      );
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      distance = apart(event.touches);
      sum = 0;
      done = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !distance) return;
      event.preventDefault();
      const now = apart(event.touches);
      push(
        ((now - distance) / distance) * STEP * 4,
        (event.touches[0]!.clientX + event.touches[1]!.clientX) / 2,
        (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2,
      );
      distance = now;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!distance || event.touches.length >= 2) return;
      distance = 0;
      end();
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    frame.addEventListener('gesturestart', onGestureStart);
    frame.addEventListener('gesturechange', onGestureChange);
    frame.addEventListener('gestureend', end);
    frame.addEventListener('touchstart', onTouchStart, { passive: true });
    frame.addEventListener('touchmove', onTouchMove, { passive: false });
    frame.addEventListener('touchend', onTouchEnd);
    frame.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.clearTimeout(timer);
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('gesturestart', onGestureStart);
      frame.removeEventListener('gesturechange', onGestureChange);
      frame.removeEventListener('gestureend', end);
      frame.removeEventListener('touchstart', onTouchStart);
      frame.removeEventListener('touchmove', onTouchMove);
      frame.removeEventListener('touchend', onTouchEnd);
      frame.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [frameRef]);
}
