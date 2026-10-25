import { describe, expect, it } from 'vitest';
import {
  coverOf,
  isCropped,
  panBy,
  SLIDE_ZOOM_MAX,
  startView,
  zoomAround,
  zoomedBox,
} from './slide-zoom';

describe('zoomAround', () => {
  it('keeps the spot under the pointer in place', () => {
    const focus = { x: 0.25, y: 0.75 };
    const view = zoomAround(null, 2, focus)!;
    expect(view.scale).toBe(2);
    // The slide spot at the focus is still at the focus: x + focus / scale.
    expect(view.x + focus.x / view.scale).toBeCloseTo(0.25);
    expect(view.y + focus.y / view.scale).toBeCloseTo(0.75);
  });

  it('ends at 1× and below', () => {
    expect(zoomAround(null, 0.9, { x: 0.5, y: 0.5 })).toBeNull();
    expect(zoomAround({ scale: 2, x: 0.5, y: 0.5 }, 0.5, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('stops at the deepest zoom and stays inside the slide', () => {
    const view = zoomAround({ scale: 6, x: 0, y: 0 }, 4, { x: 1, y: 1 })!;
    expect(view.scale).toBe(SLIDE_ZOOM_MAX);
    expect(view.x).toBeLessThanOrEqual(1 - 1 / SLIDE_ZOOM_MAX);
    expect(view.x).toBeGreaterThanOrEqual(0);
  });
});

describe('panBy', () => {
  it('moves by a share of the frame and stops at the edges', () => {
    expect(panBy({ scale: 2, x: 0.25, y: 0.25 }, 0.2, -0.2)).toEqual({
      scale: 2,
      x: 0.35,
      y: 0.15,
    });
    expect(panBy({ scale: 2, x: 0.25, y: 0.25 }, 5, -5)).toEqual({ scale: 2, x: 0.5, y: 0 });
  });
});

describe('zoomedBox', () => {
  it('lays the slide out bigger, shifted to the visible part', () => {
    expect(zoomedBox({ scale: 2, x: 0.5, y: 0.25 }, 400, 300)).toEqual({
      left: -400,
      top: -150,
      width: 800,
      height: 600,
    });
  });
});

describe('cover (a slide filling a frame of another shape)', () => {
  // A 3:4 portrait page in a 16:9 frame: as wide as the frame, 16/9 / 0.75 ≈ 2.37 frames tall.
  const cover = coverOf(0.75, 16 / 9);

  it('lays the slide out as wide as the frame and taller', () => {
    expect(cover.x).toBe(1);
    expect(cover.y).toBeCloseTo(2.37, 3);
    expect(isCropped(cover)).toBe(true);
    expect(isCropped(coverOf(16 / 9, 16 / 9))).toBe(false);
  });

  it('starts at the top and moves down to the bottom edge, not past it', () => {
    const start = startView(cover);
    expect(start).toEqual({ scale: 1, x: 0, y: 0 });
    const bottom = panBy(start, 0, 10, cover);
    expect(bottom.y).toBeCloseTo(1 - 1 / cover.y);
    expect(zoomedBox(bottom, 800, 450, cover).top).toBeCloseTo(-(800 / 0.75 - 450));
  });

  it('stays at 1× when zooming out instead of ending', () => {
    const view = zoomAround({ scale: 2, x: 0, y: 0.3 }, 0.25, { x: 0.5, y: 0.5 }, cover);
    expect(view).not.toBeNull();
    expect(view!.scale).toBe(1);
    expect(view!.y).toBeGreaterThanOrEqual(0);
    expect(view!.y).toBeLessThanOrEqual(1 - 1 / cover.y);
  });
});
