import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';

export interface StripPage {
  /** The same page keeps its key as it moves from beside to the middle (its hours stay scrolled). */
  key: string;
  node: ReactNode;
}

export interface StripHandle {
  /** One page back or on, sliding as a swipe does; false where it cannot (no room to slide). */
  slide: (by: 1 | -1) => boolean;
}

/** A swipe by wheel this far (of the page's width, at most `TURN_PX`) turns the page; short of it, it springs back. */
const TURN = 0.12;
const TURN_PX = 80;
/** The wheel quiet this long: the swipe (and a trackpad's running on after it) is over. */
const QUIET_MS = 160;
/** A whole page's glide; a shorter way takes less (the browser's own smooth scroll took ~480 ms). */
const GLIDE_MS = 240;

/**
 * The calendar's pages side by side, as Apple's: swiped sideways (a trackpad's two fingers, a
 * finger, Shift and the wheel) the page before or after comes in and stays – one page per swipe.
 * Once it rests the middle is moved on (`onStep`) and the strip is put back on it unseen.
 * Only the middle can be reached by Tab; the ones beside are there to be swiped in.
 *
 * A finger is the browser's own (snapping to the pages). The wheel is not: it comes as steps
 * without a beginning or end, which snapping takes one by one and sends back – so the page follows
 * the wheel here, turns once past `TURN` and takes nothing more of that swipe: a trackpad's
 * running on after it is let pass, a new swipe (rising again, or the other way) turns again.
 * A swipe keeps the axis it began on: scrolling the hours never pulls the page sideways.
 */
export function CalendarStrip({
  pages,
  onStep,
  onStay,
  ref,
}: {
  pages: readonly [StripPage, StripPage, StripPage];
  onStep: (by: 1 | -1) => void;
  /** It came to rest on the page it was on (a slide sent back). */
  onStay?: () => void;
  ref?: Ref<StripHandle>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const step = useEffectEvent(onStep);
  const stay = useEffectEvent(() => onStay?.());
  const middle = pages[1].key;
  const glider = useRef<(left: number) => void>(null);
  const arrived = useRef<() => void>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    // Another page in the middle: a glide still on its way (another view or day asked meanwhile)
    // ends here instead of turning the new one.
    arrived.current?.();
    if (el) el.scrollLeft = el.clientWidth;
  }, [middle]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let timer = 0;
    // The wheel's swipe: following it (`pull`), turning or springing back (`glide`), its trackpad
    // running on after it was turned (`tail`).
    let phase: 'idle' | 'pull' | 'glide' | 'tail' = 'idle';
    let axis: 'x' | 'y' | null = null;
    let pulled = 0;
    let quiet = 0;
    let last = 0;
    let least = Infinity;
    let frame = 0;
    // Turned, the new middle not in yet (the router renders it as a transition): the glide's last
    // `scrollend` comes meanwhile and would turn again, past the day a slide was for.
    let turned = false;
    let unturn = 0;
    const settle = () => {
      if (phase === 'pull' || frame || turned) return; // following the wheel, gliding or turned
      const at = Math.round(el.scrollLeft / el.clientWidth);
      el.style.scrollSnapType = '';
      if (phase === 'glide') phase = axis ? 'tail' : 'idle';
      if (at === 1) return stay();
      turned = true;
      // A turn overtaken (another day asked, the same page again) brings no new middle: the strip
      // does not stay deaf for that.
      window.clearTimeout(unturn);
      unturn = window.setTimeout(() => (turned = false), 1500);
      step(at > 1 ? 1 : -1);
    };
    // Safari before 26 has no `scrollend`: resting is a pause in the scrolling there.
    const hasEnd = 'onscrollend' in window;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, 140);
    };
    el.addEventListener(hasEnd ? 'scrollend' : 'scroll', hasEnd ? settle : onScroll);
    // Its own glide, not the browser's smooth scroll: quicker, fast at first and easing out, and
    // the page turns the frame it arrives (no waiting for `scrollend`). Snapping is off meanwhile
    // (it would pull each step back); a finger takes over at once.
    const stop = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const glide = (left: number) => {
      phase = 'glide';
      stop();
      const from = el.scrollLeft;
      const way = left - from;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still || Math.abs(way) < 1) {
        el.scrollLeft = left;
        settle();
        return;
      }
      el.style.scrollSnapType = 'none';
      const duration = GLIDE_MS * (0.5 + 0.5 * Math.min(1, Math.abs(way) / el.clientWidth));
      const begun = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - begun) / duration);
        el.scrollLeft = from + way * (1 - (1 - t) ** 3);
        if (t < 1) {
          frame = window.requestAnimationFrame(tick);
          return;
        }
        frame = 0;
        settle();
      };
      frame = window.requestAnimationFrame(tick);
    };
    glider.current = glide;
    arrived.current = () => {
      turned = false;
      window.clearTimeout(unturn);
      if (!frame) return;
      stop();
      el.style.scrollSnapType = '';
      phase = 'idle';
    };
    const onTouch = () => {
      if (!frame) return;
      stop();
      el.style.scrollSnapType = '';
      phase = 'idle';
    };
    el.addEventListener('touchstart', onTouch, { passive: true });
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // a pinch (`zoom.ts`)
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      axis ??= event.shiftKey || Math.abs(dx) > Math.abs(event.deltaY) ? 'x' : 'y';
      window.clearTimeout(quiet);
      quiet = window.setTimeout(() => {
        axis = null;
        if (phase === 'pull')
          glide(el.clientWidth); // not far enough: back to the page one is on
        else if (phase === 'tail') phase = 'idle';
      }, QUIET_MS);
      if (axis === 'y' || !dx) return;
      event.preventDefault();
      const size = Math.abs(dx);
      const again =
        Math.sign(dx) !== Math.sign(last) ||
        (size > Math.max(3 * least, 6) && size > Math.abs(last));
      last = dx;
      least = Math.min(least, size);
      if (phase === 'glide' || (phase === 'tail' && !again)) return;
      if (phase !== 'pull') {
        phase = 'pull';
        pulled = 0;
      }
      const width = el.clientWidth;
      el.style.scrollSnapType = 'none';
      pulled = Math.max(-width, Math.min(width, pulled + dx * (event.deltaMode === 1 ? 20 : 1)));
      if (Math.abs(pulled) < Math.min(width * TURN, TURN_PX)) {
        el.scrollLeft = width + pulled;
        return;
      }
      least = Infinity;
      glide(width * (pulled > 0 ? 2 : 0));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const resized = new ResizeObserver(() => {
      el.scrollLeft = el.clientWidth;
    });
    resized.observe(el);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(quiet);
      window.clearTimeout(unturn);
      stop();
      glider.current = null;
      arrived.current = null;
      el.removeEventListener('touchstart', onTouch);
      el.removeEventListener(hasEnd ? 'scrollend' : 'scroll', hasEnd ? settle : onScroll);
      el.removeEventListener('wheel', onWheel);
      resized.disconnect();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    slide: (by) => {
      const el = scroller.current;
      if (!el || !el.clientWidth || !glider.current) return false;
      glider.current(el.clientWidth * (1 + by));
      return true;
    },
  }));

  return (
    // Wider than the page by the gap on each side: the pages' gap shows only while one swipes.
    // `overscroll-x-contain`: a swipe past the last page does not go back in the browser's history.
    // `relative`: the pages' offsets are the strip's (`zoom.ts` puts its copy where the page is).
    <div
      ref={scroller}
      data-strip
      className="relative -mx-3 flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {pages.map((page, index) => (
        <div
          key={page.key}
          data-pane={index - 1}
          inert={index !== 1}
          aria-hidden={index !== 1 || undefined}
          className="flex min-h-0 w-full shrink-0 snap-start snap-always flex-col px-3"
        >
          {page.node}
        </div>
      ))}
    </div>
  );
}
