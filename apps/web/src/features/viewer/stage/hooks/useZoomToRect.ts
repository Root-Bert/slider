import { clamp, type Rect } from '@slider/shared';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { loadWorkPreferences, type WorkPreferences } from '@/lib/preferences/work-preferences';
import { useViewerDispatch } from '../../state/viewer-state';
import { useViewerStore } from '../../state/viewer-store';
import { isCropped, NO_COVER, startView, type Cover, type SlideZoom } from '../lib/slide-zoom';

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
/** A box counts as seen only this far (px) inside the visible part – a pin on the edge is not. */
const SEEN_INSET_PX = 24;

type View = Pick<SlideZoom, 'scale' | 'x' | 'y'>;

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

/**
 * `rect` shows in `view` – all of it, `inset` (slide units each way) clear of the edges, or, where
 * it is larger than the visible part, across all of it.
 */
const shows = (view: View, rect: Rect, cover: Cover, inset: { x: number; y: number }) => {
  const axis = (from: number, size: number, start: number, seen: number, pad: number) =>
    size <= seen - 2 * pad
      ? from >= start + pad && from + size <= start + seen - pad
      : from <= start + pad && from + size >= start + seen - pad;
  return (
    axis(rect.x, rect.w, view.x, 1 / (view.scale * cover.x), inset.x) &&
    axis(rect.y, rect.h, view.y, 1 / (view.scale * cover.y), inset.y)
  );
};

/** What to zoom in on: a box on a slide, `key` naming it (a new key zooms anew). */
export interface ZoomTarget {
  key: string;
  slideId: string;
  rect: Rect;
}

/**
 * A box too small or too thin to see well zooms its slide in on it; one outside the part of a
 * zoomed (or cropped) slide that shows is moved into view, at the same zoom. Once there is none (or
 * another) the slide goes back to what it showed before – unless someone zoomed by hand since
 * (only moving the zoomed part around still goes back). Both glide. `preference`: the setting
 * that switches it off, read whenever the target changes, so a change applies at once.
 */
export function useZoomToRect(
  target: ZoomTarget | null,
  preference: keyof Pick<WorkPreferences, 'autoZoom' | 'commentZoom'>,
) {
  const store = useViewerStore();
  const dispatch = useViewerDispatch();
  const key = target?.key ?? null;
  const slideId = target?.slideId ?? null;
  // The zoom this set and the one it replaced, for going back.
  const auto = useRef<{ slideId: string; before: SlideZoom | null; zoom: SlideZoom } | null>(null);
  // Glides running, by slide: their next frame.
  const animations = useRef(new Map<string, number>());
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
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
      // Each step drawn in the frame it is dispatched in (`flushSync`, as the wheel zoom does):
      // left to React's scheduler it would land a frame later – or be pulled into the next sync
      // render, in the middle of that frame's ResizeObserver callbacks (`FormatBar` places itself
      // there), resizing the slide they observe: „ResizeObserver loop completed …“ every frame.
      const show = (zoom: SlideZoom | null) =>
        flushSync(() => dispatch({ type: 'slideZoomChanged', slideId: id, zoom }));
      const step = (now: number) => {
        const t = Math.min(1, (now - began) / ANIMATION_MS);
        if (t >= 1) {
          animations.current.delete(id);
          show(to);
          return;
        }
        const k = easeOut(t);
        const scale = start.scale * (end.scale / start.scale) ** k;
        const view = centredView(scale, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, cover);
        show({ slideId: id, ...view });
        animations.current.set(id, requestAnimationFrame(step));
      };
      animations.current.set(id, requestAnimationFrame(step));
    };

    const target = latest.current;
    const { slideZooms } = store.getState();
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
    const small = (long < SMALL_PX || short < THIN_PX) && long > 0 && scale < MAX_SCALE;
    const wanted = Math.max(SMALL_PX / long, THIN_PX / Math.max(short, 1)) ** DAMPING;
    const fits = Math.min(
      (FIT * width) / Math.max(shownW, 1),
      (FIT * height) / Math.max(shownH, 1),
    );
    const zoomedIn = small ? Math.min(MAX_SCALE, scale * Math.min(wanted, fits)) : scale;
    // Not worth zooming in: still moved into view when it is out of it.
    const targetScale = zoomedIn < scale * MIN_FACTOR ? scale : zoomedIn;
    if (targetScale === scale) {
      const shown = before ?? startView(cover);
      const inset = {
        x: SEEN_INSET_PX / (width * cover.x * scale),
        y: SEEN_INSET_PX / (height * cover.y * scale),
      };
      if ((!before && !isCropped(cover)) || shows(shown, target.rect, cover, inset)) {
        return restore();
      }
    }
    const zoom: SlideZoom = {
      slideId,
      ...centredView(targetScale, x + w / 2, y + h / 2, cover),
    };
    if (previous?.slideId !== slideId) restore();
    auto.current = { slideId, before, zoom };
    glide(slideId, slideZooms.get(slideId) ?? null, zoom, cover);
  }, [key, slideId, preference, dispatch, store]);

  // Unmounted mid-glide: the frames stop.
  useEffect(() => {
    const running = animations.current;
    return () => {
      for (const frame of running.values()) cancelAnimationFrame(frame);
    };
  }, []);
}
