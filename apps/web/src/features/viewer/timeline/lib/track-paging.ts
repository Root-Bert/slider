import { clamp } from '@slider/shared';
import { wheelPixels } from '@/lib/wheel';
import type { TrackStack } from './timeline-layout';

/*
 * Paging the band's tracks like a phone's pages (`useTrackSwipe`): the band follows the fingers
 * 1:1, gives way like rubber past the first and last track, and on release a spring carries it to
 * the page the swipe was heading for. Offsets are in px, positive downwards (the track over the
 * one shown comes into view), velocities in px/ms.
 */

/** How stiff the past-the-end rubber is (iOS: 0.55). */
const RUBBER = 0.55;
/** The spring: its period undamped (ms) and how much of critical damping it has (iOS-like). */
const SPRING_RESPONSE_MS = 280;
const SPRING_DAMPING = 0.9;
const OMEGA = (2 * Math.PI) / SPRING_RESPONSE_MS;
/** Where a release lands if left to coast (ms of its velocity) – past half a page goes on. */
const PROJECT_MS = 180;
/** A release at least this fast (px/ms) goes on to the next page however far it got … */
const FLICK_VELOCITY = 0.4;
/** … once it went this far that way (px). */
const FLICK_MIN_PX = 8;
/** Fastest velocity a spring starts with (px/ms): a wilder flick does not shoot past the page. */
const MAX_VELOCITY = 8;

/** `x` px pulled past the end of a band `h` tall: how far it goes (iOS' rubber band, under `h`). */
export const rubberBand = (x: number, h: number): number =>
  Math.sign(x) * (1 - 1 / ((Math.abs(x) * RUBBER) / h + 1)) * h;

/** The pull that {@link rubberBand} turns into `offset`. */
export const unrubber = (offset: number, h: number): number => {
  const share = Math.min(Math.abs(offset) / h, 0.99);
  return (Math.sign(offset) * (1 / (1 - share) - 1) * h) / RUBBER;
};

/**
 * A spring towards 0 that started at `x0` with velocity `v0`, `t` ms on: where it is and how
 * fast it goes. Slightly under-damped – a fast page may overshoot a pixel or so, as on iOS.
 */
export function springAt(t: number, x0: number, v0: number): { x: number; v: number } {
  const v = clamp(v0, -MAX_VELOCITY, MAX_VELOCITY);
  const zw = SPRING_DAMPING * OMEGA;
  const wd = OMEGA * Math.sqrt(1 - SPRING_DAMPING ** 2);
  const decay = Math.exp(-zw * t);
  const b = (v + zw * x0) / wd;
  const cos = Math.cos(wd * t);
  const sin = Math.sin(wd * t);
  const x = decay * (x0 * cos + b * sin);
  return { x, v: -zw * x + decay * wd * (b * cos - x0 * sin) };
}

/** The spring is at rest (snaps to 0 from here). */
const springDone = ({ x, v }: { x: number; v: number }) => Math.abs(x) < 0.5 && Math.abs(v) < 0.05;

/**
 * Where a swipe released at `offset` px from its page with `velocity` goes: -1 the page over it,
 * 1 the one under it, 0 back. Past half a page once coasted, or flicked that way, it goes on.
 */
export function pageStep(offset: number, velocity: number, h: number): -1 | 0 | 1 {
  const projected = offset + velocity * PROJECT_MS;
  if (projected > h / 2) return -1;
  if (projected < -h / 2) return 1;
  if (
    Math.abs(velocity) >= FLICK_VELOCITY &&
    Math.sign(velocity) === Math.sign(offset) &&
    Math.abs(offset) >= FLICK_MIN_PX
  )
    return velocity > 0 ? -1 : 1;
  return 0;
}

/** Legacy `wheelDeltaY` (Chrome, Safari): 120 a notch for a mouse, -3 × deltaY for a trackpad. */
type LegacyWheel = Pick<WheelEvent, 'deltaY' | 'deltaMode'> & { wheelDeltaY?: number };

/** A wheel event this big starting a gesture, without `wheelDeltaY` to tell, is a mouse notch. */
const NOTCH_PX = 50;

/**
 * A mouse wheel's notch (a page each) rather than a trackpad's stream of small deltas: lines or
 * pages (Firefox), whole 120s of `wheelDeltaY` that aren't a trackpad's pixels (Chrome, Safari),
 * or else a big delta starting a gesture.
 */
export function isWheelNotch(event: LegacyWheel, starts: boolean): boolean {
  if (event.deltaMode !== 0) return true;
  const legacy = event.wheelDeltaY;
  if (legacy) return legacy % 120 === 0 && legacy !== -3 * event.deltaY;
  return starts && Math.abs(event.deltaY) >= NOTCH_PX;
}

/** No wheel this long while the fingers swipe: they let go without a fling. */
const RELEASE_GAP_MS = 90;
/** Quiet this long after a release, the fling's momentum is over. */
const QUIET_MS = 120;
/** Wheel deltas shrinking this many times in a row: the fingers let go, momentum coasts … */
const RELEASE_FALLS = 3;
/** … once below this share of the swipe's biggest delta. */
const RELEASE_SHARE = 0.8;
/** Momentum's deltas growing this many times in a row (to at least `CATCH_PX`): a new swipe. */
const CATCH_RISES = 3;
const CATCH_PX = 6;
/**
 * Shrinking deltas only count as a fling this fast (px/ms): slower, the fingers may still be on
 * it (a swipe slowing down), and a slow fling's small deltas only move the band a little more –
 * it follows them until the wheel stops.
 */
const FLING_VELOCITY = 0.3;
/** The velocity is measured over the wheel's last this many ms. */
const VELOCITY_MS = 64;
/** A notch at the first or last track nudges the band this fast (px/ms), then it springs back. */
const EDGE_NUDGE = 0.6;

/** What the pager drives in React: the track shown, the levels drawn. */
export interface TrackPagerHost {
  /** The track shown from now on. */
  show: (track: number) => void;
  /** Draws `levels` too while the band moves (added to those drawn); `null`: at rest, none. */
  draw: (levels: number[] | null) => void;
  reducedMotion: () => boolean;
}

/**
 * The band's tracks paged like a phone's pages, outside React (nothing renders per frame): the
 * band follows a trackpad swipe 1:1 – past the first and last track like rubber – and when the
 * fingers let go (the deltas start to shrink: momentum; or stop) a spring carries it on to the
 * next track – past half way, or flicked – or back, and the momentum that follows is spent. A
 * mouse notch pages once, `go` to any track, on the same spring.
 *
 * The band is measured from an anchor track: it lies `offset` px from its place. The track React
 * has drawn as shown may lag behind the anchor for a frame; `--track-drag` makes up for it, so
 * switching the shown track mid-move doesn't jump.
 */
export class TrackPager {
  private phase: 'idle' | 'drag' | 'spring' = 'idle';
  private anchor = 0;
  private offset = 0;
  /** The band's velocity (px/ms). */
  private velocity = 0;
  /** What React drew last (`sync`). */
  private drawn = 0;
  private stack: TrackStack = { above: 0, below: 0 };
  private height = 0;
  /** While dragging: the pull before the rubber, the track it started on, the last deltas. */
  private pull = 0;
  private start = 0;
  private recent: { t: number; d: number }[] = [];
  /** Shrinking deltas in a row, the swipe's biggest delta, the last one's size. */
  private falls = 0;
  private peak = 0;
  private last = 0;
  /** A fling's momentum is still coming in: which way it went, how often it grew since. */
  private spent = false;
  private fling = 0;
  private rises = 0;
  private spring: { x0: number; v0: number; t0: number } | null = null;
  private frame: number | null = null;
  private timer: number | null = null;
  /** The band, whose `--track-drag` (px) is added to every drawn track's place. */
  private band: HTMLElement | null = null;
  private readonly host: TrackPagerHost;

  constructor(host: TrackPagerHost) {
    this.host = host;
  }

  /** React drew `track` as shown, for `stack` on a band `height` tall. */
  sync(track: number, stack: TrackStack, height: number) {
    this.drawn = track;
    this.stack = stack;
    this.height = height;
    if (this.phase === 'idle') this.anchor = track;
    this.paint();
  }

  /** The band the tracks move in. */
  attach(band: HTMLElement | null) {
    this.band = band;
    this.paint();
  }

  /** Writes where the band is as `--track-drag`, for what React drew. */
  private paint() {
    const px = this.offset - (this.anchor - this.drawn) * this.height;
    this.band?.style.setProperty('--track-drag', `${px}px`);
  }

  dispose() {
    this.clearTimer();
    this.stopFrame();
  }

  /** Goes to track `to` on the spring. */
  go(to: number) {
    if (this.phase === 'drag') return;
    this.springNow();
    if (to === this.anchor && this.phase === 'idle') return;
    this.springTo(to, this.phase === 'spring' ? this.velocity : 0);
  }

  /** A vertical wheel over the band: pages its tracks (and takes the event); `false` with none. */
  wheel(event: WheelEvent): boolean {
    const h = this.height;
    if (this.stack.above + this.stack.below === 0 || h <= 0) return false;
    event.preventDefault();
    // As content scrolls: the wheel's down (fingers up) moves the band up, to what is under it.
    const d = -wheelPixels(event.deltaY, event.deltaMode);
    const now = event.timeStamp || performance.now();

    if (isWheelNotch(event, this.phase !== 'drag' && !this.spent)) {
      if (this.phase === 'drag') this.release(false);
      this.springNow();
      const to = this.anchor + (d > 0 ? -1 : 1);
      if (this.open(to)) this.springTo(to, this.velocity);
      else this.springTo(this.anchor, Math.sign(d) * EDGE_NUDGE);
      return true;
    }

    if (this.spent) {
      // Momentum only shrinks, and the same way: grown again or turned, it is a new swipe.
      const turned = Math.sign(d) !== this.fling && Math.abs(d) >= 2;
      this.rises = Math.abs(d) > this.last ? this.rises + 1 : 0;
      this.last = Math.abs(d);
      if (!turned && !(this.rises >= CATCH_RISES && Math.abs(d) >= CATCH_PX)) {
        this.wait(QUIET_MS, () => (this.spent = false));
        return true;
      }
    }

    if (this.phase !== 'drag') this.startDrag();
    this.recent.push({ t: now, d });
    while (this.recent.length > 2 && now - this.recent[0]!.t > VELOCITY_MS) this.recent.shift();
    if (this.recent.length >= 2) {
      const moved = this.recent.slice(1).reduce((sum, e) => sum + e.d, 0);
      this.velocity = moved / Math.max(now - this.recent[0]!.t, 8);
    }
    const size = Math.abs(d);
    if (size < this.last) this.falls += 1;
    else if (size > this.last) this.falls = 0;
    this.last = size;
    this.peak = Math.max(this.peak, size);

    // 1:1 up to the next track either way; past the first or last one, rubber.
    this.pull = clamp(this.pull + d, -h, h);
    this.offset = this.open(this.start - Math.sign(this.pull))
      ? this.pull
      : rubberBand(this.pull, h);
    this.paint();

    const coasting = this.falls >= RELEASE_FALLS && size < this.peak * RELEASE_SHARE;
    if (coasting && Math.abs(this.velocity) >= FLING_VELOCITY) this.release(true);
    else this.wait(RELEASE_GAP_MS, () => this.release(false));
    return true;
  }

  private open(level: number) {
    return level >= -this.stack.above && level <= this.stack.below;
  }

  private clearTimer() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private wait(ms: number, then: () => void) {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      then();
    }, ms);
  }

  private stopFrame() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /** At rest on the anchor: only the track shown is drawn, untransformed. */
  private rest() {
    this.stopFrame();
    this.phase = 'idle';
    this.offset = 0;
    this.velocity = 0;
    this.spring = null;
    this.paint();
    this.host.draw(null);
  }

  /** Brings offset and velocity up to where the spring is now. */
  private springNow() {
    if (this.phase !== 'spring' || !this.spring) return;
    const at = springAt(performance.now() - this.spring.t0, this.spring.x0, this.spring.v0);
    this.offset = at.x;
    this.velocity = at.v;
  }

  private readonly step = (now: number) => {
    if (!this.spring) return;
    // A frame's time is when it began: one begun before the release shows where it let go, and
    // the spring starts from that frame – the next one moves a whole frame on, as the fingers did.
    if (now < this.spring.t0) this.spring.t0 = now;
    const at = springAt(now - this.spring.t0, this.spring.x0, this.spring.v0);
    if (springDone(at)) return this.rest();
    this.offset = at.x;
    this.velocity = at.v;
    this.paint();
    this.frame = requestAnimationFrame(this.step);
  };

  /** Springs to track `to` (shown from now on) with `velocity`, from where the band is. */
  private springTo(to: number, velocity: number) {
    const h = this.height;
    const target = clamp(to, -this.stack.above, this.stack.below);
    // Where the band is, as a track: those between it and the target are passed.
    const at = this.anchor - this.offset / h;
    const levels: number[] = [];
    const [low, high] = [Math.min(at, target), Math.max(at, target)];
    for (let level = Math.floor(low); level <= Math.ceil(high); level++) levels.push(level);
    this.offset += (target - this.anchor) * h;
    this.anchor = target;
    this.host.show(target);
    if (this.host.reducedMotion()) return this.rest();
    this.host.draw(levels.filter((level) => this.open(level)));
    this.phase = 'spring';
    this.spring = { x0: this.offset, v0: velocity, t0: performance.now() };
    this.stopFrame();
    this.frame = requestAnimationFrame(this.step);
  }

  /** The fingers let go: on to the track the swipe was heading for, or back. */
  private release(momentum: boolean) {
    this.clearTimer();
    const step = pageStep(this.offset, this.velocity, this.height);
    const to = clamp(this.start + step, -this.stack.above, this.stack.below);
    // Let go past the first or last track while still pulling out: it only springs back.
    const beyond = this.offset !== 0 && !this.open(this.start - Math.sign(this.offset));
    this.fling = Math.sign(this.velocity);
    this.spent = momentum;
    this.rises = 0;
    this.springTo(to, beyond && this.fling === Math.sign(this.offset) ? 0 : this.velocity);
    if (this.spent) this.wait(QUIET_MS, () => (this.spent = false));
  }

  /** A swipe begins – or catches the band mid-spring – on the track nearest where it is. */
  private startDrag() {
    this.springNow();
    this.stopFrame();
    const h = this.height;
    const nearest = Math.round(this.anchor - this.offset / h);
    this.offset += (nearest - this.anchor) * h;
    this.anchor = nearest;
    this.start = nearest;
    if (nearest !== this.drawn) this.host.show(nearest);
    const pulledOut = this.offset !== 0 && !this.open(nearest - Math.sign(this.offset));
    this.pull = pulledOut ? unrubber(this.offset, h) : this.offset;
    this.phase = 'drag';
    this.spring = null;
    this.recent = [];
    this.velocity = 0;
    this.falls = 0;
    this.peak = 0;
    this.last = 0;
    this.spent = false;
    this.host.draw([nearest - 1, nearest, nearest + 1].filter((level) => this.open(level)));
  }
}
