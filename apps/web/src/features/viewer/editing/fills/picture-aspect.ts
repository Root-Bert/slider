import { coverCrop, type PictureCrop, type PictureFocus } from '@slider/shared';
import { useEffect, useSyncExternalStore } from 'react';

/*
 * The proportions of pictures by their address, read once from the picture itself: a layer
 * filled with a picture shows its part („Ausschnitt“, `coverCrop`) as soon as they are known –
 * the same in every place that draws it (the slide's background, a preview, a layer's swatch).
 */

const aspects = new Map<string, number>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

/** `url`'s width over its height, known from elsewhere (a picture read in a script). */
export function rememberPictureAspect(url: string, aspect: number): void {
  if (!(aspect > 0) || aspects.get(url) === aspect) return;
  aspects.set(url, aspect);
  for (const listener of listeners) listener();
}

function load(url: string) {
  if (aspects.has(url) || loading.has(url) || typeof Image === 'undefined') return;
  loading.add(url);
  const image = new Image();
  image.onload = () => {
    loading.delete(url);
    rememberPictureAspect(url, image.naturalWidth / Math.max(1, image.naturalHeight));
  };
  image.onerror = () => loading.delete(url);
  image.src = url;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The picture's width over its height (`null`: not read yet – it is being read). */
export function usePictureAspect(url: string | null): number | null {
  const aspect = useSyncExternalStore(
    subscribe,
    () => (url ? (aspects.get(url) ?? null) : null),
    () => (url ? (aspects.get(url) ?? null) : null),
  );
  useEffect(() => {
    if (url) load(url);
  }, [url]);
  return aspect;
}

/** `crop` of the picture at `url` laid over a box as a CSS background (it fills the box). */
export function cropBackground(url: string, crop: PictureCrop): string {
  // A position of p % lays p % of the picture on p % of the box.
  const at = (start: number, size: number) =>
    size < 1 - 1e-6 ? Math.round((start / (1 - size)) * 1e5) / 1e3 : 0;
  const size = (part: number) => Math.round((100 / part) * 1e3) / 1e3;
  return `${at(crop.x, crop.w)}% ${at(crop.y, crop.h)}% / ${size(crop.w)}% ${size(crop.h)}% no-repeat url("${url}")`;
}

/**
 * A picture filling a box of `frameAspect` with its part `focus` as CSS: cut as `coverCrop` says
 * once its proportions are known, centred until then.
 */
export function filledBackground(
  url: string,
  aspect: number | null,
  frameAspect: number,
  focus: PictureFocus | null | undefined,
): string {
  return aspect
    ? cropBackground(url, coverCrop(aspect, frameAspect, focus ?? null))
    : `center / cover no-repeat url("${url}")`;
}

/**
 * The square middle of the part of a picture (`aspect`) a box of `frameAspect` filled with it
 * shows – a layer's swatch: the part, not the whole picture.
 */
export function squareOfCrop(aspect: number, frameAspect: number, focus: PictureFocus | null) {
  const crop = coverCrop(aspect, frameAspect, focus);
  // In units of the picture's height.
  const side = Math.min(crop.w * aspect, crop.h);
  const w = side / aspect;
  const h = side;
  return { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h };
}
