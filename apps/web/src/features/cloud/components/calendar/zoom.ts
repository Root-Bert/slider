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
 * - `data-frame` its frame (glass), where it has one: it stays put as a pinch follows the fingers,
 *   and the old page's copy of it is not seen through,
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

/** A curve as `linear()` points; where the browser has no `linear()`, `EASE`. */
const curveOf = (at: (t: number) => number) => {
  const points = Array.from({ length: 41 }, (_, index) =>
    index === 40 ? 1 : Math.round(at(index / 40) * 10000) / 10000,
  );
  const curve = `linear(${points.join(', ')})`;
  return typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', curve)
    ? curve
    : EASE;
};

/**
 * What moves, moves as a spring does: quick away, a hair past its place, settled – damped so it
 * overshoots by about 1 %.
 */
const DECAY = 7; // e^-7: settled within a thousandth by the end
const RINGING = (DECAY / 0.82) * Math.sqrt(1 - 0.82 * 0.82);
const springAt = (t: number) =>
  1 - Math.exp(-DECAY * t) * (Math.cos(RINGING * t) + (DECAY / RINGING) * Math.sin(RINGING * t));
const SPRING = curveOf(springAt);
/**
 * The frame – the new page growing out of its spot, the old one cut down into it, the hole – comes
 * as quickly but never past its place: a frame a hair too big and back read as a jump.
 */
const SETTLE_RATE = 9.2;
const SETTLE = curveOf((t) => 1 - (1 + SETTLE_RATE * t) * Math.exp(-SETTLE_RATE * t));

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

/** A thing's place as laid out (a pinch's scaling left out). */
function laidOut(el: HTMLElement) {
  const parent = el.offsetParent as HTMLElement | null;
  if (!parent) return { left: 0, top: 0 };
  const rect = parent.getBoundingClientRect();
  return {
    left: rect.left + parent.clientLeft + el.offsetLeft - parent.scrollLeft,
    top: rect.top + parent.clientTop + el.offsetTop - parent.scrollTop,
  };
}

/**
 * What a pinch scales as it follows the fingers: what is in the page's frame (`data-frame`, the
 * frame stays where it is), the page itself where it has none (the year).
 */
const followed = (pane: HTMLElement) => {
  const frame = pane.querySelector<HTMLElement>('[data-frame]');
  return frame ? [...(frame.children as HTMLCollectionOf<HTMLElement>)] : [pane];
};

/**
 * The strip held where it is while its page is scaled: it snaps to its pages by their boxes as
 * scaled – a month growing out of the year's right-hand column scrolled the strip by as much, the
 * months beside it in sight. Undone, it snaps again (to the page as laid out).
 */
function pinStrip(pane: HTMLElement) {
  const strip = pane.closest<HTMLElement>('[data-strip]');
  if (!strip) return () => {};
  strip.style.scrollSnapType = 'none';
  return () => {
    strip.style.scrollSnapType = '';
  };
}

/** A transform about the page's corner: scaling by `scale` about a point of it stays put there. */
const scaledAbout = (scale: number, x: number, y: number) =>
  `translate(${x * (1 - scale)}px, ${y * (1 - scale)}px) scale(${scale})`;

/**
 * A zoom the fingers hold (a touch screen's or a trackpad's pinch): it goes as far as they have
 * come and, let go (`released`), on to its end or back to where it began. The gesture writes how
 * far they have stretched past the hold (`stretch`, a logarithm of their distance) and reads how
 * much stretch is the whole way (`whole`, set once the zoom knows how far its spot opens); the zoom
 * takes it up once the new view is laid out (`to`), the page undoes going back (`back`, given what
 * clears the old page's copy once the old view is there again).
 */
export interface ZoomDrive {
  stretch: number;
  whole?: number;
  /** `speed`: of the whole way a second, as the fingers left it. */
  released: { commit: boolean; speed: number } | null;
  to?: { seek: () => void; release: (commit: boolean, speed: number) => void };
  back?: (done: () => void) => void;
}

/** The fingers' stretch for the whole way, without a spot to measure (and at least, at most). */
export const WHOLE = 0.5;
const WHOLE_LEAST = 0.45;
const WHOLE_MOST = 0.9;

export interface ZoomStart {
  frame: HTMLElement;
  overlay: HTMLElement;
  clone: HTMLElement;
  morphs: Map<string, Morph>;
  spot: ReturnType<typeof spotOf>;
  spotBox: Box | null;
  drive?: ZoomDrive;
  /** The page's title (`data-word` spans) as it was: its words, where, how they look. */
  title?: { el: HTMLElement; words: { text: string; rect: DOMRect }[]; look: TextLook };
}

let running: (() => void) | null = null;

/** A zoom on its way ends now, nothing undone (the page goes away). */
export const stopZoom = () => running?.();

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
  drive,
  title,
}: {
  frame: HTMLElement;
  overlay: HTMLElement;
  pane: HTMLElement;
  from: CalendarView;
  to: CalendarView;
  day: Date;
  drive?: ZoomDrive;
  title?: HTMLElement | null;
}): ZoomStart | null {
  running?.();
  if (!motionOk()) return null;
  const frameRect = frame.getBoundingClientRect();
  const spot = spotOf(from, to, day);
  const morphs = morphsIn(pane, frameRect);
  const box = spot?.zoomIn ? spotBox(pane, spot.selector, frameRect) : null;
  const titleThen = title
    ? {
        el: title,
        words: [...title.querySelectorAll<HTMLElement>('[data-word]')].map((el) => ({
          text: el.textContent ?? '',
          rect: el.getBoundingClientRect(),
        })),
        look: textLook(title, true),
      }
    : undefined;
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
  // Its frame as it looks, but not seen through: a frame is glass, and the copy's cut (`clip-path`)
  // turns its blur off – the new page under it showed through, its frame flying there, and the
  // dots behind. Blurred, the dots are the canvas; the glass's tint over that.
  for (const el of clone.querySelectorAll<HTMLElement>('[data-frame]'))
    Object.assign(el.style, {
      backgroundColor: 'var(--color-canvas)',
      backgroundImage: 'linear-gradient(var(--color-glass), var(--color-glass))',
      backdropFilter: 'none',
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
  return { frame, overlay, clone, morphs: inCopy, spot, spotBox: box, drive, title: titleThen };
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
  // Held by the fingers, everything goes on one even clock (where they are is where it is, the
  // end of their way the end of its); played, each with its own curve.
  const driven = Boolean(start.drive);
  const run = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions = {}) => {
    const animation = el.animate(frames, {
      duration: DURATION,
      easing: EASE,
      fill: 'both',
      ...options,
      ...(driven && { easing: 'linear' }),
    });
    animations.push(animation);
    return animation;
  };
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
  // What of it is seen: its frame (the page's margin around it is empty).
  const pageFrame = pane.querySelector('[data-frame]');
  const seen = pageFrame ? boxIn(frameRect, pageFrame.getBoundingClientRect()) : page;
  const moved = area ? (spot?.zoomIn ? clone : pane) : null;
  const unpin = pinStrip(pane);
  // A part may still be scaled as a pinch left it (`followed`): it moves from there.
  const moves = moved
    ? [...moved.querySelectorAll<HTMLElement>('[data-seg]')].map(
        (seg) =>
          [
            seg,
            seg.style.transform || 'none',
            `${shift(seg, mapping(area!, whole))} ${seg.style.transform}`,
          ] as const,
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
  const titleNow = start.title
    ? [...start.title.el.querySelectorAll<HTMLElement>('[data-word]')].map((el) => ({
        el,
        text: el.textContent ?? '',
        rect: el.getBoundingClientRect(),
      }))
    : [];

  let opening: { box: ReturnType<typeof local>; gx: number; gy: number; grow: number } | null =
    null;
  if (area && spot?.zoomIn) {
    // In: the old page's parts move apart from the spot, and the spot opens – a hole in the copy,
    // growing with them to the whole, the new page in it (coming in under the spot where the old
    // page has no frame, below).
    for (const [seg, from, to] of moves)
      run(seg, [{ transform: from }, { transform: to }], { easing: SPRING });
    const hole = (b: ReturnType<typeof local>) =>
      `polygon(evenodd, -1px -1px, ${w + 1}px -1px, ${w + 1}px ${h + 1}px, -1px ${h + 1}px, -1px -1px, ${b.left}px ${b.top}px, ${b.right}px ${b.top}px, ${b.right}px ${b.bottom}px, ${b.left}px ${b.bottom}px, ${b.left}px ${b.top}px)`;
    const opened = local({ x: -2, y: -2, w: whole.w + 4, h: whole.h + 4 });
    run(clone, [{ clipPath: hole(local(area)) }, { clipPath: hole(opened) }], { easing: SETTLE });
    // The new page grows out of the spot as one piece, as small as it still fills it (a month
    // from the year's small one: its size; a week from a month's row: as it is, moving there).
    // Its frame fills the spot (measured with the empty margin, it fell short of the hole's edges).
    const grow = Math.min(1, Math.max(area.w / seen.w, area.h / seen.h));
    const gx = area.x + area.w / 2 - page.x - grow * (seen.x + seen.w / 2 - page.x);
    const gy = area.y + area.h / 2 - page.y - grow * (seen.y + seen.h / 2 - page.y);
    run(
      pane,
      [
        { transformOrigin: '0 0', transform: `translate(${gx}px, ${gy}px) scale(${grow})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { easing: SETTLE },
    );
    // Out of a page without a frame (the year): it comes in under what the spot showed – the
    // frame's glass there at once, over a small month's bare numbers, read as a jump. Out of a
    // frame (a month's row, a week's day) the spot is glass already: it is there at once.
    if (!clone.querySelector('[data-frame]')) {
      run(pane, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], {
        easing: 'linear',
      });
      opening = { box: local(area), gx, gy, grow };
    } else {
      // Out of a frame the glass stays; what is in it – the new view's lines, hours, columns,
      // grounds – comes in as it opens (not there at once, a week's lines in a month's row before
      // the zoom is under way), the old view's parts going as they move away.
      for (const part of followed(pane)) run(part, ARRIVING, { easing: 'linear' });
      for (const [seg] of moves) run(seg, LEAVING, { easing: 'linear' });
    }
  } else if (area) {
    // Out: the new page is there at once, its parts coming together on the spot; the old one,
    // over it, is cut down to the spot as they come (not squashed) and fades into it at the end.
    for (const [seg, , from] of moves)
      run(seg, [{ transform: from }, { transform: 'none' }], { easing: SPRING });
    // What the new view shows comes in as it comes together (not there at once around the old).
    for (const part of followed(pane)) run(part, ARRIVING_OUT, { easing: 'linear' });
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
      { easing: SETTLE },
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
    hidden.push(before.el, after.el);
  }
  // In: what the spot showed stays over the new page as it begins, growing with it (the copy of
  // the old page put where the new one is, as the new one moves), and gives way to it.
  if (opening) {
    const { box, gx, gy, grow } = opening;
    const inner = clone.cloneNode(true) as HTMLElement;
    inner.style.clipPath = `inset(${box.top}px ${w - box.right}px ${h - box.bottom}px ${box.left}px)`;
    overlay.append(inner);
    const scrolled = clone.querySelectorAll<HTMLElement>('[data-scroller]');
    inner.querySelectorAll<HTMLElement>('[data-scroller]').forEach((el, index) => {
      el.scrollTop = scrolled[index]?.scrollTop ?? 0;
      el.scrollLeft = scrolled[index]?.scrollLeft ?? 0;
    });
    run(
      inner,
      [
        { transformOrigin: '0 0', transform: 'translate(0px, 0px) scale(1)' },
        {
          transformOrigin: '0 0',
          transform: `translate(${-gx / grow}px, ${-gy / grow}px) scale(${1 / grow})`,
        },
      ],
      { easing: SETTLE },
    );
    run(inner, [{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], {
      easing: 'linear',
    });
  }
  // The title, word by word, on the same way: a word both have moves to its place („2026“ into
  // „Oktober 2026“, „Nov.“ from the week into the day), the others fade, a little blurred.
  const titled = new Set<Animation>();
  let leavingWords: HTMLElement | null = null;
  if (start.title) {
    const left = [...start.title.words];
    for (const word of titleNow) {
      const at = left.findIndex((old) => old.text === word.text);
      if (at === -1) {
        titled.add(run(word.el, WORD_IN, { easing: 'linear' }));
        continue;
      }
      const [old] = left.splice(at, 1);
      const dx = old!.rect.left - word.rect.left;
      const dy = old!.rect.top - word.rect.top;
      if (Math.abs(dx) + Math.abs(dy) < 0.5) continue;
      titled.add(
        run(word.el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          easing: SPRING,
        }),
      );
    }
    if (left.length) {
      // Out of the page's way (the title is not in the zoom's overlay): over everything, unheard.
      leavingWords = document.createElement('div');
      leavingWords.setAttribute('aria-hidden', 'true');
      Object.assign(leavingWords.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '50',
      });
      for (const old of left) {
        const el = document.createElement('span');
        el.textContent = old.text;
        for (const [name, value] of start.title.look) el.style.setProperty(name, value);
        Object.assign(el.style, {
          position: 'absolute',
          left: `${old.rect.left}px`,
          top: `${old.rect.top}px`,
          height: `${old.rect.height}px`,
          whiteSpace: 'nowrap',
        });
        leavingWords.append(el);
        titled.add(run(el, WORD_OUT, { easing: 'linear' }));
      }
      document.body.append(leavingWords);
    }
  }

  let done = false;
  let goingBack = false;
  let tick = 0;
  const finish = () => {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(tick);
    for (const animation of animations) animation.cancel();
    for (const el of hidden) el.style.visibility = '';
    pane.style.visibility = '';
    unpin();
    leavingWords?.remove();
    overlay.replaceChildren();
    if (running === finish) running = null;
  };
  // Let go short of the way: back at its start, the old page's copy whole again over everything
  // until the old view is there again (`drive.back`), the new one under it unseen.
  const back = () => {
    if (done) return;
    // The title back at its start (it looks as the old one) until the old view is there again.
    for (const animation of animations) {
      if (!titled.has(animation)) animation.cancel();
      else animation.currentTime = 0;
    }
    for (const el of hidden) el.style.visibility = '';
    overlay.replaceChildren(clone);
    pane.style.visibility = 'hidden';
    window.setTimeout(finish, 1000); // the old view never came: nothing stays over the page
    if (start.drive?.back) start.drive.back(finish);
    else finish();
  };
  running = finish;
  // Played, it ends with its animations; held, where the fingers' spring arrives (below).
  if (!driven)
    void Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);

  const drive = start.drive;
  if (!drive) return;
  // Held by the fingers. How far the spot opens (a month's row into the week: some 6 times, a
  // year's small month into the month: twice) is how far they stretch for the whole way – one to
  // one where a hand can, at most `WHOLE_MOST` – and what opens grows by as much as they spread:
  // twice as far apart, twice as big, all the way (`way`: of the zoom's even clock).
  const opens = area ? Math.max(whole.w / area.w, whole.h / area.h) : 1;
  const sized = spot?.zoomIn ? opens : 1 / opens;
  const even = Math.abs(Math.log(sized)) < 0.01;
  drive.whole = Math.min(WHOLE_MOST, Math.max(WHOLE_LEAST, Math.log(opens)));
  const wayAt = (part: number) => (even ? part : (sized ** part - 1) / (sized - 1));
  const lengths = animations.map((animation) =>
    Number(animation.effect?.getComputedTiming().duration ?? DURATION),
  );
  for (const animation of animations) animation.pause();
  let way = 0;
  const show = () =>
    animations.forEach((animation, index) => {
      animation.currentTime = Math.min(way * DURATION, lengths[index]!);
    });
  const seek = () => {
    if (done || goingBack || tick) return;
    way = wayAt(Math.max(0, Math.min(1, drive.stretch / drive.whole!)));
    show();
  };
  // Let go: on to its end or back to its start as a spring does that never overshoots, going on as
  // fast as the fingers went (no jump into the zoom's own pace).
  const release = (commit: boolean, speed: number) => {
    if (done || goingBack || tick) return;
    if (!commit) goingBack = true;
    const target = commit ? 1 : 0;
    const part = Math.max(0, Math.min(1, drive.stretch / drive.whole!));
    const velocity = speed * (even ? 1 : (sized ** part * Math.log(sized)) / (sized - 1));
    const rate = SETTLE_RATE / (DURATION / 1000);
    // Where it is at each moment (not stepped frame by frame: a slow frame would throw it about).
    const away = way - target;
    const begun = performance.now();
    const step = (now: number) => {
      if (done) return;
      const t = (now - begun) / 1000;
      way = target + (away + (velocity + rate * away) * t) * Math.exp(-rate * t);
      const there = (commit ? way >= 1 - 1e-3 : way <= 1e-3) || t > 1.5;
      if (there) way = target;
      show();
      if (there) return commit ? finish() : back();
      tick = window.requestAnimationFrame(step);
    };
    tick = window.requestAnimationFrame(step);
  };
  drive.to = { seek, release };
  seek();
  if (drive.released) release(drive.released.commit, drive.released.speed);
}

/**
 * A view's lines and grounds coming in, by the zoom's way: zoomed in, from a tenth until most of
 * the way (held, the fingers' first stretch opens slowly – barely seen yet); out, by half.
 * The parts leaving go once they are mostly out of sight.
 */
const ARRIVING: Keyframe[] = [
  { opacity: 0 },
  { opacity: 0, offset: 0.1 },
  { opacity: 1, offset: 0.6 },
  { opacity: 1 },
];
const ARRIVING_OUT: Keyframe[] = [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }];
const LEAVING: Keyframe[] = [
  { opacity: 1 },
  { opacity: 1, offset: 0.3 },
  { opacity: 0, offset: 0.9 },
  { opacity: 0 },
];

/** A title's word coming in (after the old ones begin to go) and going, a little blurred. */
const WORD_IN: Keyframe[] = [
  { opacity: 0, filter: 'blur(4px)' },
  { opacity: 0, filter: 'blur(4px)', offset: 0.15 },
  { opacity: 1, filter: 'blur(0px)', offset: 0.6 },
  { opacity: 1, filter: 'blur(0px)' },
];
const WORD_OUT: Keyframe[] = [
  { opacity: 1, filter: 'blur(0px)' },
  { opacity: 0, filter: 'blur(4px)', offset: 0.4 },
  { opacity: 0, filter: 'blur(4px)' },
];

type TextLook = (readonly [string, string])[];
/** How a thing's text looks, to be carried onto a copy (out of its place: its font too). */
function textLook(el: HTMLElement, font = false): TextLook {
  const style = getComputedStyle(el);
  return [...TEXT, ...(font ? ['font-family'] : [])].map(
    (name) => [name, style.getPropertyValue(name)] as const,
  );
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

/** Ctrl and a mouse's wheel: this far (its units) changes the view in one played step; short of it, the page follows a little. */
const STEP = 40;
const FOLLOW = 0.04;
/**
 * Two fingers – on a touch screen, on a trackpad – hold the zoom: moved apart or together past
 * `HOLD` (of their distance, as a logarithm: 3 %) it begins and goes as far as they have come, the
 * whole way as far as the zoom says (`ZoomDrive.whole`). Let go past `COMMIT` of it, or flicked on
 * (`FLICK` of the way a second), it goes on to its end, else back.
 */
const HOLD = 0.03;
const COMMIT = 0.4;
const FLICK = 1.5;
/** Nothing moves (reduced motion): the view changes at once, so only as far as a wheel's step. */
const STILL = 0.25;
/**
 * A trackpad's pinch comes as the wheel (Ctrl): its units for a stretch of 1 – so that `STEP`, a
 * pinch's units for the view's change before it was held, still takes it on.
 */
const WHEEL_STRETCH = 100;
/** The wheel has no end: a trackpad's fingers still this long have let go. */
const QUIET_MS = 200;
/** A wheel's turn this big at once is a mouse's notch, not fingers: a played step. */
const NOTCH = 50;

/**
 * Pinching on the calendar: a trackpad (Chrome, Edge, Firefox, the desktop app: the wheel with
 * Ctrl; Safari: its gesture events), two fingers on a touch screen, Ctrl and the mouse's wheel.
 * Fingers hold the zoom as it goes (`ZoomDrive`, given to `onZoom`: 1 in, -1 out, where – false
 * where there is no further, and what is in the page's frame gives a little, springing back).
 * A mouse's notches: what is in the frame follows a little, past `STEP` the zoom is played.
 * One step per pinch.
 */
export function useZoomGestures(
  frameRef: RefObject<HTMLElement | null>,
  onZoom: (direction: 1 | -1, x: number, y: number, drive?: ZoomDrive) => boolean,
) {
  const zoom = useEffectEvent(onZoom);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let scaled: HTMLElement[] = [];
    let unpin: (() => void) | null = null;
    const page = () => frame.querySelector<HTMLElement>('[data-pane="0"]');
    const scaleTo = (scale: number, x: number, y: number) => {
      const el = page();
      if (!el || !motionOk()) return;
      const parts = followed(el);
      const places = parts.map(laidOut); // all read before any is written
      if (parts[0] === el) unpin ??= pinStrip(el);
      parts.forEach((part, index) => {
        part.style.transition = 'none';
        part.style.transformOrigin = '0 0';
        part.style.transform = scaledAbout(scale, x - places[index]!.left, y - places[index]!.top);
      });
      scaled = parts;
    };
    const springBack = () => {
      for (const part of scaled) {
        if (!part.style.transform) continue;
        part.style.transition = `transform 180ms ${EASE}`;
        part.style.transform = '';
      }
      scaled = [];
      const pinned = unpin;
      unpin = null;
      if (pinned) window.setTimeout(pinned, 200);
    };

    // Fingers holding the zoom, whichever way they come.
    let hold: {
      direction: 0 | 1 | -1;
      drive: ZoomDrive | null;
      time: number;
      speed: number;
    } | null = null;
    const holdMove = (stretch: number, x: number, y: number, time: number) => {
      const held = hold;
      if (!held) return;
      if (!held.direction) {
        if (Math.abs(stretch) < (motionOk() ? HOLD : STILL)) return;
        held.direction = stretch > 0 ? 1 : -1;
        const drive: ZoomDrive = { stretch: 0, released: null };
        if (zoom(held.direction, x, y, drive)) held.drive = drive;
      }
      // No further that way: what is in the frame gives a little, springing back once let go.
      if (!held.drive) return scaleTo(1 + Math.tanh(stretch / WHOLE) * FOLLOW, x, y);
      const whole = held.drive.whole ?? WHOLE;
      const past = Math.max(0, stretch * held.direction - HOLD);
      const seconds = (time - held.time) / 1000;
      if (seconds > 0)
        held.speed =
          held.speed / 2 +
          (Math.min(1, past / whole) - Math.min(1, held.drive.stretch / whole)) / seconds / 2;
      held.time = time;
      held.drive.stretch = past;
      held.drive.to?.seek();
    };
    /** `time`: when the fingers last moved; held still a moment before, no flick. */
    const holdEnd = (canCommit: boolean, time: number, lastMoved = hold?.time ?? time) => {
      const held = hold;
      hold = null;
      if (!held) return;
      if (!held.drive) return springBack();
      const speed = time - lastMoved > 100 ? 0 : held.speed;
      const part = Math.min(1, held.drive.stretch / (held.drive.whole ?? WHOLE));
      const commit = canCommit && (speed > FLICK || (speed > -FLICK && part >= COMMIT));
      held.drive.released = { commit, speed };
      held.drive.to?.release(commit, speed);
    };
    const holdStart = (time: number) => {
      hold = { direction: 0, drive: null, time, speed: 0 };
    };

    // The wheel with Ctrl: a trackpad's fingers (held), or a mouse's notches (a played step).
    let wheel: 'held' | 'step' | null = null;
    let sum = 0;
    let stepped = false;
    let timer = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      window.clearTimeout(timer);
      const delta = -event.deltaY * (event.deltaMode === 1 ? 20 : 1);
      if (!wheel) {
        wheel = event.deltaMode !== 0 || Math.abs(delta) >= NOTCH ? 'step' : 'held';
        sum = 0;
        stepped = false;
        if (wheel === 'held') holdStart(event.timeStamp);
      }
      sum += delta;
      if (wheel === 'held') {
        const moved = event.timeStamp;
        timer = window.setTimeout(() => {
          wheel = null;
          holdEnd(true, moved, moved);
        }, QUIET_MS);
        holdMove(sum / WHEEL_STRETCH, event.clientX, event.clientY, event.timeStamp);
        return;
      }
      timer = window.setTimeout(() => {
        if (!stepped) springBack();
        wheel = null;
      }, 220);
      if (stepped) return;
      if (Math.abs(sum) < STEP)
        return scaleTo(
          1 + Math.max(-1, Math.min(1, sum / STEP)) * FOLLOW,
          event.clientX,
          event.clientY,
        );
      stepped = true;
      if (!zoom(sum > 0 ? 1 : -1, event.clientX, event.clientY)) springBack();
    };

    // Safari's trackpad pinch (iOS sends its gestures beside the touches: those are theirs).
    let touching = false;
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      if (!touching) holdStart(event.timeStamp);
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (touching) return;
      const gesture = event as Gesture;
      holdMove(Math.log(gesture.scale), gesture.clientX, gesture.clientY, event.timeStamp);
    };
    const onGestureEnd = (event: Event) => {
      if (!touching) holdEnd(true, event.timeStamp);
    };

    // Two fingers on a touch screen.
    const apart = (touches: TouchList) =>
      Math.hypot(
        touches[0]!.clientX - touches[1]!.clientX,
        touches[0]!.clientY - touches[1]!.clientY,
      );
    /** The fingers' distance as the second came down. */
    let base = 0;
    // Moves and lifts are heard on what the fingers came down on: zoomed, the page they touched is
    // gone from the document, and what is sent to it no longer reaches the frame.
    const watched = new Set<EventTarget>();
    let last: Event | null = null;
    const once = (event: Event) => {
      if (event === last) return false;
      last = event;
      return true;
    };
    const unwatch = () => {
      for (const target of watched) {
        target.removeEventListener('touchmove', onTouchMove as EventListener);
        target.removeEventListener('touchend', onTouchEnd as EventListener);
        target.removeEventListener('touchcancel', onTouchEnd as EventListener);
      }
      watched.clear();
    };
    const onTouchStart = (event: TouchEvent) => {
      touching = true;
      for (const touch of event.touches) {
        if (watched.has(touch.target)) continue;
        watched.add(touch.target);
        touch.target.addEventListener('touchmove', onTouchMove as EventListener, {
          passive: false,
        });
        touch.target.addEventListener('touchend', onTouchEnd as EventListener);
        touch.target.addEventListener('touchcancel', onTouchEnd as EventListener);
      }
      if (event.touches.length !== 2 || hold) return;
      base = apart(event.touches);
      holdStart(event.timeStamp);
    };
    function onTouchMove(event: TouchEvent) {
      if (!once(event) || !hold || event.touches.length !== 2) return;
      // The browser already scrolls (one finger swiped before the other came): a swipe, not a
      // pinch – never both at once. A zoom under way goes on with the fingers all the same.
      if (event.cancelable) event.preventDefault();
      else if (!hold.direction) {
        hold = null;
        return;
      }
      holdMove(
        Math.log(apart(event.touches) / base),
        (event.touches[0]!.clientX + event.touches[1]!.clientX) / 2,
        (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2,
        event.timeStamp,
      );
    }
    function onTouchEnd(event: TouchEvent) {
      if (!once(event)) return;
      touching = event.touches.length > 0;
      if (!touching) unwatch();
      if (event.touches.length >= 2) return;
      holdEnd(event.type === 'touchend', event.timeStamp);
    }
    frame.addEventListener('wheel', onWheel, { passive: false });
    frame.addEventListener('gesturestart', onGestureStart);
    frame.addEventListener('gesturechange', onGestureChange);
    frame.addEventListener('gestureend', onGestureEnd);
    frame.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => {
      window.clearTimeout(timer);
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('gesturestart', onGestureStart);
      frame.removeEventListener('gesturechange', onGestureChange);
      frame.removeEventListener('gestureend', onGestureEnd);
      frame.removeEventListener('touchstart', onTouchStart);
      unwatch();
    };
  }, [frameRef]);
}
