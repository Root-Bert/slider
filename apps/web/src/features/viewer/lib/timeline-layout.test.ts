import { describe, expect, it } from 'vitest';
import {
  anchoredScrollLeft,
  busRoom,
  cardMode,
  COMMENT_MIN_H,
  computeTrackGeometry,
  DEFAULT_SLIDE_H_MAX,
  gapWidth,
  layoutTrack,
  MIN_SLIDE_H,
  resolvedSplit,
  revealScrollLeft,
  slideHeightAt,
  splitForHeight,
  splitForWidth,
  TRACK_PAD_TOP,
  unitAt,
  visibleRange,
  xAt,
} from './timeline-layout';

const Q4 = Array.from({ length: 12 }, () => 16 / 9);
/** Minimap, controls row and split handle as measured at desktop sizes. */
const BAND = 150;

const desktop = (viewportW: number, viewportH: number, controlsH = BAND) =>
  computeTrackGeometry({ aspectRatios: Q4, viewportW, viewportH, controlsH, narrow: false });

/** Height of everything above the comment area for slides of height `h`. */
const headerH = (h: number, controlsH = BAND) => TRACK_PAD_TOP + h + controlsH;

describe('track geometry', () => {
  it('keeps 40 % for comments by default at 1440×1024 and allows 25 % at the bottom', () => {
    const geo = desktop(1440, 1024);
    expect(geo.hDefault).toBe(448);
    expect(1024 - headerH(geo.hDefault)).toBeGreaterThanOrEqual(0.4 * 1024 - 1);
    expect(geo.hMax).toBe(602);
    expect(1024 - headerH(geo.hMax)).toBe(256);
    expect(geo.hMin).toBe(MIN_SLIDE_H);
  });

  it('keeps at least 160px for comments on short windows', () => {
    const geo = desktop(1280, 500);
    expect(500 - headerH(geo.hMax)).toBe(COMMENT_MIN_H);
    expect(geo.hDefault).toBeLessThanOrEqual(geo.hMax);
    expect(geo.hDefault).toBeGreaterThanOrEqual(geo.hMin);
  });

  it('never makes the default taller than Desktop-1, but the handle may', () => {
    const geo = desktop(2560, 1440);
    expect(geo.hDefault).toBe(DEFAULT_SLIDE_H_MAX);
    expect(geo.hMax).toBeGreaterThan(DEFAULT_SLIDE_H_MAX);
  });

  it('keeps the widest slide narrow enough for its divider and a peek of the next one', () => {
    const geo = desktop(900, 2000);
    expect(geo.hMax * (16 / 9) + gapWidth(geo.hMax) + 48).toBeLessThanOrEqual(900 - 32);
  });

  it('collapses to one size when the window is too small for the limits', () => {
    const geo = desktop(1280, 380);
    expect(geo.hMin).toBe(geo.hMax);
    expect(geo.hDefault).toBe(geo.hMax);
    expect(geo.hMax).toBeGreaterThanOrEqual(40);
  });

  it('fills the width on phones and has no split', () => {
    const geo = computeTrackGeometry({
      aspectRatios: Q4,
      viewportW: 375,
      viewportH: 812,
      controlsH: 120,
      narrow: true,
    });
    expect(geo.hMax * (16 / 9)).toBeCloseTo(343, 0);
    expect(geo.hMin).toBe(geo.hMax);
    expect(geo.hDefault).toBe(geo.hMax);
  });
});

describe('split scale', () => {
  const geo = desktop(1440, 1024);

  it('maps 0 and 1 to the ends linearly and null to the default', () => {
    expect(slideHeightAt(0, geo)).toBe(geo.hMin);
    expect(slideHeightAt(1, geo)).toBe(geo.hMax);
    expect(slideHeightAt(0.5, geo)).toBeCloseTo((geo.hMin + geo.hMax) / 2, 9);
    expect(slideHeightAt(null, geo)).toBe(geo.hDefault);
    expect(slideHeightAt(-2, geo)).toBe(geo.hMin);
    expect(slideHeightAt(7, geo)).toBe(geo.hMax);
  });

  it('moves the comment area by exactly as much as the slides grow', () => {
    const a = slideHeightAt(0.2, geo);
    const b = slideHeightAt(0.7, geo);
    expect(1024 - headerH(a) - (1024 - headerH(b))).toBeCloseTo(b - a, 9);
  });

  it('round-trips between height and split, clamped', () => {
    for (const t of [0, 0.2, 0.5, 0.93, 1])
      expect(splitForHeight(slideHeightAt(t, geo), geo)).toBeCloseTo(t, 9);
    expect(splitForHeight(10_000, geo)).toBe(1);
    expect(splitForHeight(1, geo)).toBe(0);
  });

  it('resolves the default split for this geometry', () => {
    expect(slideHeightAt(resolvedSplit(null, geo), geo)).toBeCloseTo(geo.hDefault, 9);
    expect(resolvedSplit(0.3, geo)).toBe(0.3);
  });

  it('finds the split for a minimum column width', () => {
    const t = splitForWidth(300, 16 / 9, geo);
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

  it('keeps the pointer over the same slide fraction while the slides resize', () => {
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
