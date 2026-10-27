import type { Rect } from '@slider/shared';
import { useEffect, useRef } from 'react';
import { loadWorkPreferences, type WorkPreferences } from '@/lib/preferences/work-preferences';
import { useViewerDispatch, useViewerState } from '../../state/viewer-state';
import { NO_COVER, startView, type Cover, type SlideZoom } from '../lib/slide-zoom';

/** A box is zoomed in on when its longer side on screen is shorter than this (px) … */
const SMALL_PX = 260;
/** … or its shorter side is – a thin line of text, a narrow bar. */
const THIN_PX = 68;
/**
 * How far it is zoomed in: by how much it falls short of those, softened by this power – a bit
 * at the edge, more the smaller it is (70 px long: about 2×) …
 */
const DAMPING = 0.55;
/** … while it still fits this share of the frame each way … */
const FIT = 0.8;
/** … and never further than this. */
const MAX_SCALE = 3;
/** A zoom by less than this is not worth the glide. */
const MIN_FACTOR = 1.1;
const ANIMATION_MS = 300;

type View = Pick<SlideZoom, 'scale' | 'x' | 'y'>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** How much the frame's slide overflows it unzoomed (`SlideFrame`'s `data-slide-cover`). */
const coverIn = (frame: HTMLElement): Cover => {
  const [x, y] = frame.dataset.slideCover?.split(',').map(Number) ?? [];
  return x && y ? { x, y } : NO_COVER;
};

/** Visible part of `scale` centred on `cx`/`cy` (slide coordinates), kept on the slide. */
const centredView = (scale: number, cx: number, cy: number, cover: Cover): View => {
  const seenX = 1 / (scale * cover.x);
  const seenY = 1 / (scale * cover.y);
  return {
    scale,
    x: clamp(cx - seenX / 2, 0, Math.max(0, 1 - seenX)),
    y: clamp(cy - seenY / 2, 0, Math.max(0, 1 - seenY)),
  };
};

/** What to zoom in on: a box on a slide, `key` naming it (a new key zooms anew). */
export interface ZoomTarget {
  key: string;
  slideId: string;
  rect: Rect;
}

/**
 * A box too small or too thin to see well zooms its slide in on it; once there is none (or
 * another) the slide zooms back to what it showed before – unless someone zoomed by hand since
 * (only moving the zoomed part around still goes back). Both glide. `preference`: the setting
 * that switches it off, read whenever the target changes, so a change applies at once.
 */
export function useZoomToRect(
  target: ZoomTarget | null,
  preference: keyof Pick<WorkPreferences, 'autoZoom' | 'commentZoom'>,
) {
  const { slideZooms } = useViewerState();
  const dispatch = useViewerDispatch();
  const key = target?.key ?? null;
  const slideId = target?.slideId ?? null;
  // The zoom this set and the one it replaced, for going back.
  const auto = useRef<{ slideId: string; before: SlideZoom | null; zoom: SlideZoom } | null>(null);
  // Glides running, by slide: their next frame.
  const animations = useRef(new Map<string, number>());
  const latest = useRef({ target, slideZooms });
  useEffect(() => {
    latest.current = { target, slideZooms };
  });

  useEffect(() => {
    const frameOf = (id: string) =>
      document.querySelector<HTMLElement>(`[data-slide-frame="${CSS.escape(id)}"]`);

    /** Glides a slide from what it shows to `to` (`null`: whole again). */
    const glide = (id: string, from: SlideZoom | null, to: SlideZoom | null, cover: Cover) => {
      const running = animations.current.get(id);
      if (running !== undefined) cancelAnimationFrame(running);
      const start: View = from ?? startView(cover);
      const end: View = to ?? startView(cover);
      const centre = (view: View) => ({
        x: view.x + 1 / (2 * view.scale * cover.x),
        y: view.y + 1 / (2 * view.scale * cover.y),
      });
      const [a, b] = [centre(start), centre(end)];
      const began = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - began) / ANIMATION_MS);
        if (t >= 1) {
          animations.current.delete(id);
          dispatch({ type: 'slideZoomChanged', slideId: id, zoom: to });
          return;
        }
        const k = easeOut(t);
        const scale = start.scale * (end.scale / start.scale) ** k;
        const view = centredView(scale, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, cover);
        dispatch({ type: 'slideZoomChanged', slideId: id, zoom: { slideId: id, ...view } });
        animations.current.set(id, requestAnimationFrame(step));
      };
      animations.current.set(id, requestAnimationFrame(step));
    };

    const { target, slideZooms } = latest.current;
    const previous = auto.current;
    // Still the zoom this set (or gliding towards it), maybe moved around – not zoomed by hand.
    const ours = (id: string) =>
      previous?.slideId === id &&
      (animations.current.has(id) || slideZooms.get(id)?.scale === previous.zoom.scale);
    // Back to the slide's own zoom, unless it was changed by hand meanwhile.
    const restore = () => {
      if (!previous) return;
      auto.current = null;
      if (!ours(previous.slideId)) return;
      const frame = frameOf(previous.slideId);
      const current = slideZooms.get(previous.slideId) ?? null;
      if (frame) glide(previous.slideId, current, previous.before, coverIn(frame));
      else dispatch({ type: 'slideZoomChanged', slideId: previous.slideId, zoom: previous.before });
    };
    if (!target || !slideId || !loadWorkPreferences()[preference]) return restore();
    const frame = frameOf(slideId);
    if (!frame) return restore();
    // Measured at the zoom the slide had before any of this.
    const before = ours(slideId) ? previous!.before : (slideZooms.get(slideId) ?? null);
    const cover = coverIn(frame);
    const scale = before?.scale ?? 1;
    const { width, height } = frame.getBoundingClientRect();
    const { x, y, w, h } = target.rect;
    const shownW = w * width * cover.x * scale;
    const shownH = h * height * cover.y * scale;
    const long = Math.max(shownW, shownH);
    const short = Math.min(shownW, shownH);
    if ((long >= SMALL_PX && short >= THIN_PX) || long === 0 || scale >= MAX_SCALE) {
      return restore();
    }
    const wanted = Math.max(SMALL_PX / long, THIN_PX / Math.max(short, 1)) ** DAMPING;
    const fits = Math.min(
      (FIT * width) / Math.max(shownW, 1),
      (FIT * height) / Math.max(shownH, 1),
    );
    const targetScale = Math.min(MAX_SCALE, scale * Math.min(wanted, fits));
    if (targetScale < scale * MIN_FACTOR) return restore();
    const zoom: SlideZoom = {
      slideId,
      ...centredView(targetScale, x + w / 2, y + h / 2, cover),
    };
    if (previous?.slideId !== slideId) restore();
    auto.current = { slideId, before, zoom };
    glide(slideId, slideZooms.get(slideId) ?? null, zoom, cover);
  }, [key, slideId, preference, dispatch]);

  // Unmounted mid-glide: the frames stop.
  useEffect(() => {
    const running = animations.current;
    return () => {
      for (const frame of running.values()) cancelAnimationFrame(frame);
    };
  }, []);
}
