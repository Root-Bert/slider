import { describe, expect, it } from 'vitest';
import {
  anchoredScrollLeft,
  busRoom,
  cardMode,
  computeTrackGeometry,
  gapWidth,
  layoutTrack,
  revealScrollLeft,
  slideHeightAt,
  unitAt,
  visibleRange,
  xAt,
  zoomForHeight,
  zoomForWidth,
} from './timeline-layout';

const Q4 = Array.from({ length: 12 }, () => 16 / 9);

const desktop = (viewportW: number, viewportH: number, controlsH = 64) =>
  computeTrackGeometry({ aspectRatios: Q4, viewportW, viewportH, controlsH, narrow: false });

describe('track geometry', () => {
  it('keeps 40 % for comments at 1440×1024 and floors the slides at 120px', () => {
    const geo = desktop(1440, 1024);
    expect(geo.hMax).toBe(518);
    expect(geo.trackH).toBe(550);
    expect(geo.trackH + 64).toBeLessThanOrEqual(0.6 * 1024);
    // 12 slides only fit 1440px at 93px – narrower than the floor, so the track scrolls.
    expect(geo.hMin * (16 / 9)).toBeCloseTo(120, 6);
    expect(layoutTrack(Q4, geo.hMin).contentW).toBeGreaterThan(1440);
  });

  it('fits a short deck into the viewport at min zoom', () => {
    const short = Q4.slice(0, 6);
    const geo = computeTrackGeometry({
      aspectRatios: short,
      viewportW: 1440,
      viewportH: 1024,
      controlsH: 64,
      narrow: false,
    });
    const layout = layoutTrack(short, geo.hMin);
    expect(layout.slides[0]!.w).toBeGreaterThan(120);
    expect(layout.contentW).toBeLessThanOrEqual(1440 + 1e-6);
    expect(layout.contentW).toBeGreaterThan(1430);
  });

  it('floors the slide width at 1280×800', () => {
    const geo = desktop(1280, 800);
    expect(geo.hMax).toBe(384);
    expect(geo.trackH).toBe(416);
    expect(geo.hMin * (16 / 9)).toBeCloseTo(120, 6);
  });

  it('fills the width on phones and never zooms', () => {
    const geo = computeTrackGeometry({
      aspectRatios: Q4,
      viewportW: 375,
      viewportH: 812,
      controlsH: 120,
      narrow: true,
    });
    expect(geo.hMax * (16 / 9)).toBeCloseTo(343, 0);
    expect(geo.hMin).toBe(geo.hMax);
  });

  it('keeps the track height independent of the zoom', () => {
    const geo = desktop(1440, 1024);
    for (const t of [0, 0.5, 1]) expect(slideHeightAt(t, geo)).toBeLessThanOrEqual(geo.hMax);
    expect(geo.trackH).toBe(550);
  });
});

describe('zoom scale', () => {
  const geo = desktop(1440, 1024);

  it('maps 0 and 1 to the ends and the middle to the geometric mean', () => {
    expect(slideHeightAt(0, geo)).toBeCloseTo(geo.hMin, 9);
    expect(slideHeightAt(1, geo)).toBeCloseTo(518, 9);
    expect(slideHeightAt(0.5, geo)).toBeCloseTo(Math.sqrt(geo.hMin * 518), 9);
  });

  it('round-trips between height and zoom, clamped', () => {
    for (const t of [0, 0.2, 0.5, 0.93, 1])
      expect(zoomForHeight(slideHeightAt(t, geo), geo)).toBeCloseTo(t, 9);
    expect(zoomForHeight(10_000, geo)).toBe(1);
    expect(zoomForHeight(1, geo)).toBe(0);
  });

  it('finds the zoom for a minimum column width', () => {
    const t = zoomForWidth(300, 16 / 9, geo);
    expect(slideHeightAt(t, geo) * (16 / 9)).toBeCloseTo(300, 6);
  });
});

describe('track layout', () => {
  it('scales the gap with the slide height', () => {
    expect(gapWidth(518)).toBe(83);
    expect(gapWidth(552)).toBe(88);
    expect(gapWidth(52)).toBe(24);
    expect(gapWidth(165)).toBe(26);
  });

  it('places slides and gaps back to back, so columns are disjoint', () => {
    const layout = layoutTrack(Q4, 200);
    for (let i = 0; i + 1 < layout.slides.length; i++) {
      const slide = layout.slides[i]!;
      const gap = layout.gaps[i]!;
      expect(gap.x).toBeCloseTo(slide.x + slide.w, 9);
      expect(layout.slides[i + 1]!.x).toBeCloseTo(gap.x + gap.w, 9);
    }
  });

  it('keeps the pointer over the same slide fraction while zooming', () => {
    const before = layoutTrack(Q4, 165);
    const after = layoutTrack(Q4, 300);
    const slide = before.slides[2]!;
    const contentX = slide.x + slide.w * 0.37;
    const viewportX = 700;
    const scrollLeft = anchoredScrollLeft(before, after, contentX, viewportX, 1440);
    const next = after.slides[2]!;
    expect((scrollLeft + viewportX - next.x) / next.w).toBeCloseTo(0.37, 9);
  });

  it('round-trips units outside the slides', () => {
    const layout = layoutTrack(Q4, 120);
    for (const x of [-30, 5, 16, 400, layout.contentW - 10, layout.contentW + 50])
      expect(xAt(layout, unitAt(layout, x))).toBeCloseTo(x, 9);
  });

  it('reveals a slide with a margin, centred, or not at all when visible', () => {
    const layout = layoutTrack(Q4, 518);
    const slide = layout.slides[3]!;
    const left = revealScrollLeft(layout, 3, 0, 1440, 'nearest');
    expect(slide.x + slide.w).toBeCloseTo(left + 1440 - 48, 6);
    expect(revealScrollLeft(layout, 3, left, 1440, 'nearest')).toBe(left);
    const centre = revealScrollLeft(layout, 3, 0, 1440, 'center');
    expect(slide.x + slide.w / 2 - centre).toBeCloseTo(720, 6);
    expect(revealScrollLeft(layout, 0, 500, 1440, 'center')).toBe(0);
  });

  it('windows a long deck to a few viewports', () => {
    const long = Array.from({ length: 150 }, () => 16 / 9);
    const layout = layoutTrack(long, 300);
    const range = visibleRange(layout, 20_000, 1440);
    expect(range.first).toBeGreaterThan(0);
    expect(range.last - range.first + 1).toBeLessThan(20);
    expect(layout.slides[range.first]!.x).toBeLessThanOrEqual(20_000 - 1440);
    expect(layout.slides[range.last]!.x + 300 * (16 / 9)).toBeGreaterThanOrEqual(20_000 + 2 * 1440);
    expect(visibleRange(layout, layout.contentW - 1440, 1440).last).toBe(149);
  });
});

describe('card modes', () => {
  it('switches at 140 and 260px column width', () => {
    expect(cardMode(120)).toBe('bubble');
    expect(cardMode(139)).toBe('bubble');
    expect(cardMode(140)).toBe('compact');
    expect(cardMode(259)).toBe('compact');
    expect(cardMode(260)).toBe('full');
  });

  it('reserves bus room for the lines above the cards', () => {
    expect(busRoom(1)).toBe(48);
    expect(busRoom(7)).toBe(98);
  });
});
